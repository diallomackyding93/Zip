use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use chrono::Datelike;
use tauri::State;

use crate::db::Database;
use crate::error::{KomersaError, KomersaResult};
use crate::permissions::{self, Permission};
use crate::session::SessionState;

// ---------------------------------------------------------------------------
// Tableau de bord
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct TopProduct {
    pub product_name: String,
    pub qty: f64,
    pub amount: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModeBreakdown {
    pub mode_label: String,
    pub amount: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DayPoint {
    pub date: String,   // 'YYYY-MM-DD'
    pub amount: f64,    // CA net du jour
}

#[derive(Debug, Clone, Serialize)]
pub struct LowStockItem {
    pub name: String,
    pub stock: f64,
    pub stock_min: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DashboardSnapshot {
    pub today_sales: f64,
    pub today_tickets: i64,
    pub avg_basket: f64,
    pub yesterday_sales: f64,
    pub first_ticket_time: Option<String>,
    pub month_sales: f64,
    pub month_collected: f64,
    pub month_goal: f64,                  // objectif mensuel (paramètre), 0 = non défini
    pub days_remaining: i64,              // jours restants dans le mois
    pub cash_expected: f64,
    pub open_sessions: i64,
    pub customer_debts: f64,
    pub supplier_debts: f64,
    pub low_stock_count: i64,
    pub sales_by_day: Vec<f64>,          // 30 valeurs, ancien → récent
    pub top_products: Vec<TopProduct>,
    pub low_stock_items: Vec<LowStockItem>,
}

// ---------------------------------------------------------------------------
// Rapports
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct ReportInput {
    pub period: String, // 'today'|'7d'|'30d'|'month'|'year'|'custom'
    #[serde(default)]
    pub from: Option<String>, // 'YYYY-MM-DD' (si period='custom')
    #[serde(default)]
    pub to: Option<String>,
}

/// Vérifie un format de date strict YYYY-MM-DD (anti-injection pour clause inline).
fn valid_date(s: &str) -> bool {
    s.len() == 10
        && s.as_bytes().iter().enumerate().all(|(i, &b)| {
            if i == 4 || i == 7 { b == b'-' } else { b.is_ascii_digit() }
        })
}

#[derive(Debug, Clone, Serialize)]
pub struct ReportData {
    pub total_sales: f64,
    pub tickets: i64,
    pub margin: f64,
    pub avg_ticket: f64,
    pub purchases: f64,
    pub purchases_due: f64,          // dette restante sur les achats de la période
    pub low_stock_count: i64,        // produits sous le seuil
    pub stock_value: f64,            // valeur du stock (Σ stock × coût)
    pub cash_expected: f64,          // espèces attendues en caisse (sessions ouvertes)
    pub payment_modes: Vec<ModeBreakdown>,
    pub top_products: Vec<TopProduct>,
    pub top_qty: Option<TopProduct>, // produit le plus vendu (en quantité)
    pub categories: Vec<ModeBreakdown>,
    pub series: Vec<DayPoint>,       // évolution du CA net, jour par jour
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Clause SQL de filtre sur created_at selon la période.
fn period_clause(period: &str) -> &'static str {
    match period {
        "today" => "date(s.created_at) = date('now')",
        "7d" => "s.created_at >= datetime('now','-7 days')",
        "month" => "strftime('%Y-%m', s.created_at) = strftime('%Y-%m','now')",
        "year" => "strftime('%Y', s.created_at) = strftime('%Y','now')",
        _ => "s.created_at >= datetime('now','-30 days')", // 30d par défaut
    }
}

fn load_top_products(
    conn: &rusqlite::Connection,
    commerce_id: &str,
    clause: &str,
    limit: usize,
) -> Vec<TopProduct> {
    let sql = format!(
        "SELECT si.product_name, COALESCE(SUM(si.qty),0), COALESCE(SUM(si.line_total),0)
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         WHERE s.commerce_id = ?1 AND s.state != 'Annulée' AND {clause}
         GROUP BY si.product_name
         ORDER BY SUM(si.line_total) DESC
         LIMIT {limit}"
    );
    let Ok(mut stmt) = conn.prepare(&sql) else { return vec![]; };
    let Ok(rows) = stmt.query_map([commerce_id], |row| {
        Ok(TopProduct {
            product_name: row.get(0)?,
            qty: row.get(1)?,
            amount: row.get(2)?,
        })
    }) else { return vec![]; };
    rows.flatten().collect()
}

// ---------------------------------------------------------------------------
// Commandes
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_dashboard_snapshot(
    db: State<Database>,
    session: State<SessionState>,
) -> KomersaResult<DashboardSnapshot> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::VoirRapports)?;

    // Ventes du jour (brutes) puis nettes (− remboursements de retour du jour)
    let (today_gross, today_tickets): (f64, i64) = conn.query_row(
        "SELECT COALESCE(SUM(total),0), COUNT(*)
         FROM sales WHERE commerce_id=?1 AND state!='Annulée' AND date(created_at)=date('now')",
        [&sess.commerce_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let today_returns: f64 = conn.query_row(
        "SELECT COALESCE(SUM(sr.refund_amount),0) FROM sale_returns sr
         JOIN sales s ON s.id = sr.sale_id
         WHERE s.commerce_id=?1 AND date(sr.created_at)=date('now')",
        [&sess.commerce_id], |r| r.get(0),
    ).unwrap_or(0.0);
    let today_sales = (today_gross - today_returns).max(0.0);
    let avg_basket = if today_tickets > 0 { today_sales / today_tickets as f64 } else { 0.0 };

    // Ventes d'hier (nettes) — pour la comparaison « vs hier »
    let y_gross: f64 = conn.query_row(
        "SELECT COALESCE(SUM(total),0) FROM sales
         WHERE commerce_id=?1 AND state!='Annulée' AND date(created_at)=date('now','-1 day')",
        [&sess.commerce_id], |r| r.get(0),
    ).unwrap_or(0.0);
    let y_returns: f64 = conn.query_row(
        "SELECT COALESCE(SUM(sr.refund_amount),0) FROM sale_returns sr JOIN sales s ON s.id=sr.sale_id
         WHERE s.commerce_id=?1 AND date(sr.created_at)=date('now','-1 day')",
        [&sess.commerce_id], |r| r.get(0),
    ).unwrap_or(0.0);
    let yesterday_sales = (y_gross - y_returns).max(0.0);

    // Heure du premier ticket du jour (HH:MM, UTC ≈ heure locale en Guinée)
    let first_ticket_time: Option<String> = conn.query_row(
        "SELECT strftime('%H:%M', MIN(created_at)) FROM sales
         WHERE commerce_id=?1 AND state!='Annulée' AND date(created_at)=date('now')",
        [&sess.commerce_id], |r| r.get::<_, Option<String>>(0),
    ).ok().flatten();

    // Ventes du mois (nettes des retours du mois)
    let month_gross: f64 = conn.query_row(
        "SELECT COALESCE(SUM(total),0) FROM sales
         WHERE commerce_id=?1 AND state!='Annulée'
         AND strftime('%Y-%m',created_at)=strftime('%Y-%m','now')",
        [&sess.commerce_id], |r| r.get(0),
    )?;
    let month_returns: f64 = conn.query_row(
        "SELECT COALESCE(SUM(sr.refund_amount),0) FROM sale_returns sr
         JOIN sales s ON s.id = sr.sale_id
         WHERE s.commerce_id=?1 AND strftime('%Y-%m',sr.created_at)=strftime('%Y-%m','now')",
        [&sess.commerce_id], |r| r.get(0),
    ).unwrap_or(0.0);
    let month_sales = (month_gross - month_returns).max(0.0);

    // Encaissé du mois (hors crédit client) = somme des paiements réellement reçus
    let month_collected: f64 = conn.query_row(
        "SELECT COALESCE(SUM(sp.amount),0) FROM sale_payments sp
         JOIN sales s ON s.id = sp.sale_id
         WHERE s.commerce_id=?1 AND s.state!='Annulée'
           AND sp.mode_label != 'Crédit client'
           AND strftime('%Y-%m', s.created_at) = strftime('%Y-%m','now')",
        [&sess.commerce_id], |r| r.get(0),
    ).unwrap_or(0.0);

    // Objectif mensuel (paramètre) + jours restants dans le mois
    let month_goal: f64 = conn.query_row(
        "SELECT value FROM settings WHERE key='dashboard_month_goal' AND commerce_id=?1",
        [&sess.commerce_id], |r| r.get::<_, String>(0),
    ).ok().and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);
    let days_remaining: i64 = conn.query_row(
        "SELECT CAST(julianday(date('now','start of month','+1 month')) - julianday(date('now')) AS INTEGER)",
        [], |r| r.get(0),
    ).unwrap_or(0);

    // Caisse : espèces attendues = fond initial + mouvements espèces des sessions ouvertes
    // (même logique que la clôture de caisse : on compte le comptant et les apports/sorties,
    // hors ventes annulées).
    let open_sessions: i64 = conn.query_row(
        "SELECT COUNT(*) FROM cash_sessions WHERE commerce_id=?1 AND status='open'",
        [&sess.commerce_id], |r| r.get(0),
    )?;
    let initial_sum: f64 = conn.query_row(
        "SELECT COALESCE(SUM(initial_fund),0) FROM cash_sessions WHERE commerce_id=?1 AND status='open'",
        [&sess.commerce_id], |r| r.get(0),
    )?;
    let movements_sum: f64 = conn.query_row(
        "SELECT COALESCE(SUM(cm.amount),0)
         FROM cash_movements cm
         JOIN cash_sessions cs ON cs.id = cm.cash_session_id
         WHERE cs.commerce_id=?1 AND cs.status='open'
           AND (cm.treasury_account_id IS NULL OR cm.mode_label='Comptant'
                OR cm.type IN ('Apport','Sortie'))
           AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.ref = cm.ref AND s.state='Annulée')",
        [&sess.commerce_id], |r| r.get(0),
    ).unwrap_or(0.0);
    let cash_expected = initial_sum + movements_sum;

    // Créances / dettes
    let customer_debts: f64 = conn.query_row(
        "SELECT COALESCE(SUM(remaining),0) FROM customer_credits WHERE commerce_id=?1 AND status!='Soldé'",
        [&sess.commerce_id], |r| r.get(0),
    )?;
    let supplier_debts: f64 = conn.query_row(
        "SELECT COALESCE(SUM(remaining),0) FROM supplier_debts WHERE commerce_id=?1 AND status!='Soldée'",
        [&sess.commerce_id], |r| r.get(0),
    )?;

    // Stock faible
    let low_stock_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM products WHERE commerce_id=?1 AND active=1 AND stock_min>0 AND stock<=stock_min",
        [&sess.commerce_id], |r| r.get(0),
    )?;

    // Ventes par jour (30 derniers jours)
    let mut day_map: HashMap<String, f64> = HashMap::new();
    {
        let mut stmt = conn.prepare(
            "SELECT date(created_at), COALESCE(SUM(total),0)
             FROM sales WHERE commerce_id=?1 AND state!='Annulée'
             AND created_at >= datetime('now','-30 days')
             GROUP BY date(created_at)",
        )?;
        let rows = stmt.query_map([&sess.commerce_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?))
        })?;
        for r in rows.flatten() { day_map.insert(r.0, r.1); }
    }
    // Retrancher les remboursements de retour, par jour (CA net).
    {
        let mut stmt = conn.prepare(
            "SELECT date(sr.created_at), COALESCE(SUM(sr.refund_amount),0)
             FROM sale_returns sr JOIN sales s ON s.id = sr.sale_id
             WHERE s.commerce_id=?1 AND sr.created_at >= datetime('now','-30 days')
             GROUP BY date(sr.created_at)",
        )?;
        let rows = stmt.query_map([&sess.commerce_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?))
        })?;
        for r in rows.flatten() {
            let entry = day_map.entry(r.0).or_insert(0.0);
            *entry = (*entry - r.1).max(0.0);
        }
    }
    // Générer 30 jours continus (ancien → récent)
    let today = chrono::Utc::now().date_naive();
    let mut sales_by_day = Vec::with_capacity(30);
    for i in (0..30).rev() {
        let d = today - chrono::Duration::days(i);
        let key = d.format("%Y-%m-%d").to_string();
        sales_by_day.push(*day_map.get(&key).unwrap_or(&0.0));
    }

    // Top produits (30j)
    let top_products = load_top_products(
        &conn, &sess.commerce_id, "s.created_at >= datetime('now','-30 days')", 5,
    );

    // Produits sous le seuil (3 plus critiques)
    let mut low_stock_items = vec![];
    {
        let mut stmt = conn.prepare(
            "SELECT name, stock, stock_min FROM products
             WHERE commerce_id=?1 AND active=1 AND stock_min>0 AND stock<=stock_min
             ORDER BY (stock*1.0/NULLIF(stock_min,0)) ASC LIMIT 5",
        )?;
        let rows = stmt.query_map([&sess.commerce_id], |row| {
            Ok(LowStockItem { name: row.get(0)?, stock: row.get(1)?, stock_min: row.get(2)? })
        })?;
        for r in rows.flatten() { low_stock_items.push(r); }
    }

    Ok(DashboardSnapshot {
        today_sales, today_tickets, avg_basket,
        yesterday_sales, first_ticket_time,
        month_sales, month_collected,
        month_goal, days_remaining,
        cash_expected, open_sessions, customer_debts, supplier_debts,
        low_stock_count, sales_by_day, top_products, low_stock_items,
    })
}

#[tauri::command]
pub fn get_report(
    db: State<Database>,
    session: State<SessionState>,
    input: ReportInput,
) -> KomersaResult<ReportData> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::VoirRapports)?;

    let clause: String = if input.period == "custom" {
        let from = input.from.as_deref().filter(|d| valid_date(d));
        let to = input.to.as_deref().filter(|d| valid_date(d));
        match (from, to) {
            (Some(f), Some(t)) =>
                format!("date(s.created_at) BETWEEN date('{f}') AND date('{t}')"),
            _ => return Err(KomersaError::Validation("Plage de dates invalide.".into())),
        }
    } else {
        period_clause(&input.period).to_string()
    };
    let clause = clause.as_str();

    // Clause équivalente sur la date des retours (sale_returns.created_at).
    let returns_clause = clause.replace("s.created_at", "sr.created_at");

    // Ventes brutes (hors annulées)
    let sales_sql = format!(
        "SELECT COALESCE(SUM(s.total),0), COUNT(*)
         FROM sales s WHERE s.commerce_id=?1 AND s.state!='Annulée' AND {clause}"
    );
    let (gross_sales, tickets): (f64, i64) = conn.query_row(
        &sales_sql, [&sess.commerce_id], |r| Ok((r.get(0)?, r.get(1)?)),
    )?;

    // Remboursements de retour de la période (réduisent le CA).
    let refund_sql = format!(
        "SELECT COALESCE(SUM(sr.refund_amount),0)
         FROM sale_returns sr JOIN sales s ON s.id = sr.sale_id
         WHERE s.commerce_id=?1 AND {returns_clause}"
    );
    let returns_refund: f64 = conn.query_row(&refund_sql, [&sess.commerce_id], |r| r.get(0)).unwrap_or(0.0);

    // Coût des marchandises retournées (revient en stock → la marge se réajuste).
    let returns_cost_sql = format!(
        "SELECT COALESCE(SUM(sri.qty * COALESCE(p.cost,0)),0)
         FROM sale_return_items sri
         JOIN sale_returns sr ON sr.id = sri.return_id
         JOIN sales s ON s.id = sr.sale_id
         LEFT JOIN sale_items si ON si.id = sri.sale_item_id
         LEFT JOIN products p ON p.id = si.product_id
         WHERE s.commerce_id=?1 AND {returns_clause}"
    );
    let returns_cost: f64 = conn.query_row(&returns_cost_sql, [&sess.commerce_id], |r| r.get(0)).unwrap_or(0.0);

    // CA net = ventes brutes − remboursements
    let total_sales = (gross_sales - returns_refund).max(0.0);
    let avg_ticket = if tickets > 0 { total_sales / tickets as f64 } else { 0.0 };

    // Marge brute = somme (prix_vente - coût) par ligne vendue
    let margin_sql = format!(
        "SELECT COALESCE(SUM(si.line_total - (si.qty * COALESCE(p.cost,0))),0)
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         LEFT JOIN products p ON p.id = si.product_id
         WHERE s.commerce_id=?1 AND s.state!='Annulée' AND {clause}"
    );
    let gross_margin: f64 = conn.query_row(&margin_sql, [&sess.commerce_id], |r| r.get(0))?;
    // Marge nette = marge brute − revenu remboursé + coût des marchandises revenues
    let margin = gross_margin - returns_refund + returns_cost;

    // Achats sur la période (utilise ordered_at)
    let purchases_clause = clause.replace("s.created_at", "p.ordered_at");
    let purchases_sql = format!(
        "SELECT COALESCE(SUM(p.amount),0) FROM purchases p
         WHERE p.commerce_id=?1 AND {}",
        purchases_clause.replace("s.state != 'Annulée' AND ", "")
    );
    let purchases: f64 = conn.query_row(&purchases_sql, [&sess.commerce_id], |r| r.get(0)).unwrap_or(0.0);

    // Répartition par mode de paiement
    let modes_sql = format!(
        "SELECT sp.mode_label, COALESCE(SUM(sp.amount),0)
         FROM sale_payments sp
         JOIN sales s ON s.id = sp.sale_id
         WHERE s.commerce_id=?1 AND s.state!='Annulée' AND {clause}
         GROUP BY sp.mode_label ORDER BY SUM(sp.amount) DESC"
    );
    let mut payment_modes = vec![];
    {
        let mut stmt = conn.prepare(&modes_sql)?;
        let rows = stmt.query_map([&sess.commerce_id], |row| {
            Ok(ModeBreakdown { mode_label: row.get(0)?, amount: row.get(1)? })
        })?;
        for r in rows.flatten() { payment_modes.push(r); }
    }

    // Top produits
    let top_products = load_top_products(&conn, &sess.commerce_id, clause, 8);

    // Répartition par catégorie
    let cat_sql = format!(
        "SELECT COALESCE(c.name,'Sans catégorie'), COALESCE(SUM(si.line_total),0)
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         LEFT JOIN products p ON p.id = si.product_id
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE s.commerce_id=?1 AND s.state!='Annulée' AND {clause}
         GROUP BY c.name ORDER BY SUM(si.line_total) DESC"
    );
    let mut categories = vec![];
    {
        let mut stmt = conn.prepare(&cat_sql)?;
        let rows = stmt.query_map([&sess.commerce_id], |row| {
            Ok(ModeBreakdown { mode_label: row.get(0)?, amount: row.get(1)? })
        })?;
        for r in rows.flatten() { categories.push(r); }
    }

    // Dette restante sur les achats de la période
    let due_sql = format!(
        "SELECT COALESCE(SUM(p.remaining),0) FROM purchases p
         WHERE p.commerce_id=?1 AND {}",
        purchases_clause.replace("s.state != 'Annulée' AND ", "")
    );
    let purchases_due: f64 = conn.query_row(&due_sql, [&sess.commerce_id], |r| r.get(0)).unwrap_or(0.0);

    // Stock : nb produits sous le seuil + valeur du stock (Σ stock × coût)
    let low_stock_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM products WHERE commerce_id=?1 AND active=1 AND stock_min>0 AND stock<=stock_min",
        [&sess.commerce_id], |r| r.get(0),
    ).unwrap_or(0);
    let stock_value: f64 = conn.query_row(
        "SELECT COALESCE(SUM(stock * cost),0) FROM products WHERE commerce_id=?1 AND active=1",
        [&sess.commerce_id], |r| r.get(0),
    ).unwrap_or(0.0);

    // Caisse attendue (sessions ouvertes) — même logique que le tableau de bord.
    let initial_sum: f64 = conn.query_row(
        "SELECT COALESCE(SUM(initial_fund),0) FROM cash_sessions WHERE commerce_id=?1 AND status='open'",
        [&sess.commerce_id], |r| r.get(0),
    ).unwrap_or(0.0);
    let movements_sum: f64 = conn.query_row(
        "SELECT COALESCE(SUM(cm.amount),0) FROM cash_movements cm
         JOIN cash_sessions cs ON cs.id = cm.cash_session_id
         WHERE cs.commerce_id=?1 AND cs.status='open'
           AND (cm.treasury_account_id IS NULL OR cm.mode_label='Comptant' OR cm.type IN ('Apport','Sortie'))
           AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.ref = cm.ref AND s.state='Annulée')",
        [&sess.commerce_id], |r| r.get(0),
    ).unwrap_or(0.0);
    let cash_expected = initial_sum + movements_sum;

    // Produit le plus vendu (en quantité)
    let top_qty: Option<TopProduct> = {
        let sql = format!(
            "SELECT si.product_name, COALESCE(SUM(si.qty),0), COALESCE(SUM(si.line_total),0)
             FROM sale_items si JOIN sales s ON s.id = si.sale_id
             WHERE s.commerce_id=?1 AND s.state!='Annulée' AND {clause}
             GROUP BY si.product_name ORDER BY SUM(si.qty) DESC LIMIT 1"
        );
        conn.query_row(&sql, [&sess.commerce_id], |r| Ok(TopProduct {
            product_name: r.get(0)?, qty: r.get(1)?, amount: r.get(2)?,
        })).ok()
    };

    // Série journalière du CA net sur la période (pour le graphe d'évolution).
    let today = chrono::Utc::now().date_naive();
    let (start, end) = match input.period.as_str() {
        "today" => (today, today),
        "7d" => (today - chrono::Duration::days(6), today),
        "month" => (chrono::NaiveDate::from_ymd_opt(today.year(), today.month(), 1).unwrap_or(today), today),
        "year" => (chrono::NaiveDate::from_ymd_opt(today.year(), 1, 1).unwrap_or(today), today),
        "custom" => {
            let f = input.from.as_deref().and_then(|d| chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").ok()).unwrap_or(today);
            let t = input.to.as_deref().and_then(|d| chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").ok()).unwrap_or(today);
            (f, t)
        }
        _ => (today - chrono::Duration::days(29), today),
    };
    let mut gross_day: HashMap<String, f64> = HashMap::new();
    {
        let sql = format!(
            "SELECT date(s.created_at), COALESCE(SUM(s.total),0) FROM sales s
             WHERE s.commerce_id=?1 AND s.state!='Annulée' AND {clause} GROUP BY date(s.created_at)"
        );
        if let Ok(mut stmt) = conn.prepare(&sql) {
            if let Ok(rows) = stmt.query_map([&sess.commerce_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?))) {
                for r in rows.flatten() { gross_day.insert(r.0, r.1); }
            }
        }
    }
    {
        let sql = format!(
            "SELECT date(sr.created_at), COALESCE(SUM(sr.refund_amount),0)
             FROM sale_returns sr JOIN sales s ON s.id = sr.sale_id
             WHERE s.commerce_id=?1 AND {returns_clause} GROUP BY date(sr.created_at)"
        );
        if let Ok(mut stmt) = conn.prepare(&sql) {
            if let Ok(rows) = stmt.query_map([&sess.commerce_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?))) {
                for r in rows.flatten() {
                    let e = gross_day.entry(r.0).or_insert(0.0);
                    *e = (*e - r.1).max(0.0);
                }
            }
        }
    }
    let mut series = Vec::new();
    if end >= start {
        let mut d = start;
        // Garde-fou : plafonner à ~400 points.
        let mut guard = 0;
        while d <= end && guard < 400 {
            let key = d.format("%Y-%m-%d").to_string();
            series.push(DayPoint { date: key.clone(), amount: *gross_day.get(&key).unwrap_or(&0.0) });
            d += chrono::Duration::days(1);
            guard += 1;
        }
    }

    Ok(ReportData {
        total_sales, tickets, margin, avg_ticket, purchases,
        purchases_due, low_stock_count, stock_value, cash_expected,
        payment_modes, top_products, top_qty, categories, series,
    })
}
