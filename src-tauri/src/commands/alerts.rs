use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::Database;
use crate::error::{KomersaError, KomersaResult};
use crate::permissions::{self, Permission};
use crate::session::SessionState;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Structs
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct AlertRow {
    pub id: String,
    pub title: String,
    pub detail: Option<String>,
    pub recommendation: Option<String>,
    pub category: Option<String>,
    pub severity: String,
    pub status: String,
    pub entity_type: Option<String>,
    pub entity_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AlertMetrics {
    pub critical: i64,
    pub warning: i64,
    pub total: i64,
}

#[derive(Deserialize)]
pub struct UpdateAlertStatusInput {
    pub alert_id: String,
    pub status: String, // 'À traiter' | 'En surveillance' | 'Résolue' | 'Masquée'
}

// Définition interne d'une alerte candidate générée par le moteur
struct Candidate {
    id: String,
    title: String,
    detail: String,
    reco: String,
    category: &'static str,
    severity: String,
}

// Règle d'alerte chargée (type → activation / sévérité / config).
struct LoadedRule {
    active: bool,
    severity: String,
    trigger_config: Option<String>,
}

// ---------------------------------------------------------------------------
// Moteur de génération d'alertes (idempotent)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn generate_alerts(
    db: State<Database>,
    session: State<SessionState>,
) -> KomersaResult<i64> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();

    // Charger les règles configurées (type → activation / sévérité / config).
    let mut rules: std::collections::HashMap<String, LoadedRule> = std::collections::HashMap::new();
    {
        let mut stmt = conn.prepare(
            "SELECT type, active, severity, trigger_config FROM alert_rules WHERE commerce_id=?1",
        )?;
        let rows = stmt.query_map([&sess.commerce_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? != 0,
                row.get::<_, String>(2)?, row.get::<_, Option<String>>(3)?))
        })?;
        for r in rows.flatten() {
            rules.insert(r.0, LoadedRule { active: r.1, severity: r.2, trigger_config: r.3 });
        }
    }
    // Catégorie active par défaut si aucune règle ne la concerne (rétro-compat).
    let cat_active = |t: &str| rules.get(t).map(|r| r.active).unwrap_or(true);
    // Sévérité imposée par la règle, sinon défaut.
    let cat_sev = |t: &str, default: &str| -> String {
        rules.get(t).map(|r| r.severity.clone()).unwrap_or_else(|| default.to_string())
    };

    let mut candidates: Vec<Candidate> = Vec::new();

    // --- Stock faible / rupture ---
    if cat_active("stock") {
        let sev_warn = cat_sev("stock", "Attention");
        // Seuil absolu personnalisé via trigger_config {"threshold": N}, sinon stock_min produit.
        let threshold: Option<f64> = rules.get("stock")
            .and_then(|r| r.trigger_config.as_deref())
            .and_then(|c| serde_json::from_str::<serde_json::Value>(c).ok())
            .and_then(|v| v.get("threshold").and_then(|t| t.as_f64()));

        let sql = if threshold.is_some() {
            "SELECT id, name, stock, ?2 FROM products
             WHERE commerce_id=?1 AND active=1 AND stock<=?2"
        } else {
            "SELECT id, name, stock, stock_min FROM products
             WHERE commerce_id=?1 AND active=1 AND stock_min>0 AND stock<=stock_min"
        };
        let mut stmt = conn.prepare(sql)?;
        let map_row = |row: &rusqlite::Row| Ok((
            row.get::<_, String>(0)?, row.get::<_, String>(1)?,
            row.get::<_, f64>(2)?, row.get::<_, f64>(3)?,
        ));
        let collected: Vec<(String, String, f64, f64)> = if let Some(t) = threshold {
            stmt.query_map(rusqlite::params![sess.commerce_id, t], map_row)?.flatten().collect()
        } else {
            stmt.query_map([&sess.commerce_id], map_row)?.flatten().collect()
        };
        for (pid, name, stock, min) in collected {
            let rupture = stock <= 0.0;
            candidates.push(Candidate {
                id: format!("AL-STK-{pid}"),
                title: if rupture { format!("{name} en rupture") }
                       else { format!("{name} sous le seuil") },
                detail: format!("Stock actuel : {} / seuil {}.", stock as i64, min as i64),
                reco: "Lancer un réassort auprès du fournisseur.".into(),
                category: "Stock",
                severity: if rupture { "Critique".to_string() } else { sev_warn.clone() },
            });
        }
    }

    // --- Crédits clients en retard (échéance dépassée) ---
    if cat_active("customer_credit") {
        let sev = cat_sev("customer_credit", "Critique");
        let mut stmt = conn.prepare(
            "SELECT cc.id, c.name, cc.remaining, cc.due_date FROM customer_credits cc
             JOIN clients c ON c.id = cc.client_id
             WHERE cc.commerce_id=?1 AND cc.status!='Soldé' AND cc.remaining>0
               AND cc.due_date IS NOT NULL AND date(cc.due_date) < date('now')",
        )?;
        let rows = stmt.query_map([&sess.commerce_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?,
                row.get::<_, f64>(2)?, row.get::<_, String>(3)?))
        })?;
        for r in rows.flatten() {
            let (cid, name, remaining, due) = r;
            candidates.push(Candidate {
                id: format!("AL-CRD-{cid}"),
                title: format!("Crédit en retard — {name}"),
                detail: format!("Échéance dépassée ({}). Solde restant dû : {} GNF.",
                                &due[..due.len().min(10)], remaining as i64),
                reco: "Relancer le client ou planifier un échéancier.".into(),
                category: "Crédit client",
                severity: sev.clone(),
            });
        }
    }

    // --- Crédits clients à échéance proche (sous 3 jours) ---
    if cat_active("credit_due_soon") {
        let sev = cat_sev("credit_due_soon", "Attention");
        let mut stmt = conn.prepare(
            "SELECT cc.id, c.name, cc.remaining, cc.due_date FROM customer_credits cc
             JOIN clients c ON c.id = cc.client_id
             WHERE cc.commerce_id=?1 AND cc.status!='Soldé' AND cc.remaining>0
               AND cc.due_date IS NOT NULL
               AND date(cc.due_date) BETWEEN date('now') AND date('now','+3 days')",
        )?;
        let rows = stmt.query_map([&sess.commerce_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?,
                row.get::<_, f64>(2)?, row.get::<_, String>(3)?))
        })?;
        for r in rows.flatten() {
            let (cid, name, remaining, due) = r;
            candidates.push(Candidate {
                id: format!("AL-CRDS-{cid}"),
                title: format!("Crédit à échéance — {name}"),
                detail: format!("Échéance le {}. Solde restant dû : {} GNF.",
                                &due[..due.len().min(10)], remaining as i64),
                reco: "Prévenir le client avant l'échéance.".into(),
                category: "Crédit client",
                severity: sev.clone(),
            });
        }
    }

    // --- Clients proches/au-delà de leur plafond de crédit ---
    if cat_active("credit_limit") {
        let warn = cat_sev("credit_limit", "Attention");
        let mut stmt = conn.prepare(
            "SELECT c.id, c.name, c.credit_limit, COALESCE(SUM(cc.remaining),0) AS due
             FROM clients c
             JOIN customer_credits cc ON cc.client_id = c.id
               AND cc.status!='Soldé' AND cc.remaining>0
             WHERE c.commerce_id=?1 AND c.credit_limit>0
             GROUP BY c.id
             HAVING due >= 0.8 * c.credit_limit",
        )?;
        let rows = stmt.query_map([&sess.commerce_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?,
                row.get::<_, f64>(2)?, row.get::<_, f64>(3)?))
        })?;
        for r in rows.flatten() {
            let (cid, name, limit, due) = r;
            let over = due >= limit;
            candidates.push(Candidate {
                id: format!("AL-CLIM-{cid}"),
                title: if over { format!("Plafond de crédit dépassé — {name}") }
                       else { format!("Plafond de crédit bientôt atteint — {name}") },
                detail: format!("Dû : {} GNF / plafond {} GNF.", due as i64, limit as i64),
                reco: "Éviter de nouvelles ventes à crédit pour ce client.".into(),
                category: "Crédit client",
                severity: if over { "Critique".to_string() } else { warn.clone() },
            });
        }
    }

    // --- Dettes fournisseurs en retard (échéance dépassée) ---
    if cat_active("supplier_debt") {
        let sev = cat_sev("supplier_debt", "Critique");
        let mut stmt = conn.prepare(
            "SELECT sd.id, s.name, sd.remaining, sd.due_date FROM supplier_debts sd
             JOIN suppliers s ON s.id = sd.supplier_id
             WHERE sd.commerce_id=?1 AND sd.status!='Soldée' AND sd.remaining>0
               AND sd.due_date IS NOT NULL AND date(sd.due_date) < date('now')",
        )?;
        let rows = stmt.query_map([&sess.commerce_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?,
                row.get::<_, f64>(2)?, row.get::<_, String>(3)?))
        })?;
        for r in rows.flatten() {
            let (did, name, remaining, due) = r;
            candidates.push(Candidate {
                id: format!("AL-DBT-{did}"),
                title: format!("Dette fournisseur en retard — {name}"),
                detail: format!("Échéance dépassée ({}). Solde restant : {} GNF.",
                                &due[..due.len().min(10)], remaining as i64),
                reco: "Régler la facture ou négocier un délai.".into(),
                category: "Dette fournisseur",
                severity: sev.clone(),
            });
        }
    }

    // --- Dettes fournisseurs à échéance proche (sous 3 jours) ---
    if cat_active("debt_due_soon") {
        let sev = cat_sev("debt_due_soon", "Attention");
        let mut stmt = conn.prepare(
            "SELECT sd.id, s.name, sd.remaining, sd.due_date FROM supplier_debts sd
             JOIN suppliers s ON s.id = sd.supplier_id
             WHERE sd.commerce_id=?1 AND sd.status!='Soldée' AND sd.remaining>0
               AND sd.due_date IS NOT NULL
               AND date(sd.due_date) BETWEEN date('now') AND date('now','+3 days')",
        )?;
        let rows = stmt.query_map([&sess.commerce_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?,
                row.get::<_, f64>(2)?, row.get::<_, String>(3)?))
        })?;
        for r in rows.flatten() {
            let (did, name, remaining, due) = r;
            candidates.push(Candidate {
                id: format!("AL-DBTS-{did}"),
                title: format!("Dette à échéance — {name}"),
                detail: format!("Échéance le {}. Solde restant : {} GNF.",
                                &due[..due.len().min(10)], remaining as i64),
                reco: "Préparer le règlement avant l'échéance.".into(),
                category: "Dette fournisseur",
                severity: sev.clone(),
            });
        }
    }

    // --- Session de caisse ouverte depuis longtemps (> 12 h) ---
    if cat_active("cash_session") {
        let sev = cat_sev("cash_session", "Attention");
        let mut stmt = conn.prepare(
            "SELECT id, ref FROM cash_sessions
             WHERE commerce_id=?1 AND status='open'
             AND opened_at <= datetime('now','-12 hours')",
        )?;
        let rows = stmt.query_map([&sess.commerce_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        for r in rows.flatten() {
            let (sid, sref) = r;
            candidates.push(Candidate {
                id: format!("AL-CSH-{sid}"),
                title: format!("Caisse {sref} ouverte depuis longtemps"),
                detail: "La session est ouverte depuis plus de 12 heures sans clôture.".into(),
                reco: "Procéder à un comptage et une clôture.".into(),
                category: "Caisse",
                severity: sev.clone(),
            });
        }
    }

    // --- Aucune caisse ouverte → suggérer d'en ouvrir une ---
    if cat_active("cash_closed") {
        let open_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM cash_sessions WHERE commerce_id=?1 AND status='open'",
            [&sess.commerce_id], |r| r.get(0),
        ).unwrap_or(0);
        if open_count == 0 {
            candidates.push(Candidate {
                id: "AL-NOCASH".into(),
                title: "Aucune caisse ouverte".into(),
                detail: "Aucune session de caisse n'est ouverte actuellement.".into(),
                reco: "Ouvrir une caisse pour enregistrer les ventes en espèces.".into(),
                category: "Caisse",
                severity: cat_sev("cash_closed", "Info"),
            });
        }
    }

    // --- Écart de caisse important à la clôture (7 derniers jours) ---
    if cat_active("cash_gap") {
        let warn = cat_sev("cash_gap", "Attention");
        let mut stmt = conn.prepare(
            "SELECT id, ref, gap FROM cash_sessions
             WHERE commerce_id=?1 AND status='closed' AND gap IS NOT NULL
               AND ABS(gap) >= 5000 AND closed_at >= datetime('now','-7 days')",
        )?;
        let rows = stmt.query_map([&sess.commerce_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, f64>(2)?))
        })?;
        for r in rows.flatten() {
            let (sid, sref, gap) = r;
            let sens = if gap < 0.0 { "manquant" } else { "excédent" };
            candidates.push(Candidate {
                id: format!("AL-GAP-{sid}"),
                title: format!("Écart de caisse — {sref}"),
                detail: format!("Écart de {} GNF ({sens}) constaté à la clôture.", gap.abs() as i64),
                reco: "Vérifier le comptage et les mouvements de la session.".into(),
                category: "Caisse",
                severity: if gap.abs() >= 20000.0 { "Critique".to_string() } else { warn.clone() },
            });
        }
    }

    // --- Produits vendus à perte (prix de vente sous le coût) ---
    if cat_active("loss_sale") {
        let sev = cat_sev("loss_sale", "Attention");
        let mut stmt = conn.prepare(
            "SELECT id, name, price, cost FROM products
             WHERE commerce_id=?1 AND active=1 AND cost>0 AND price < cost",
        )?;
        let rows = stmt.query_map([&sess.commerce_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?,
                row.get::<_, f64>(2)?, row.get::<_, f64>(3)?))
        })?;
        for r in rows.flatten() {
            let (pid, name, price, cost) = r;
            candidates.push(Candidate {
                id: format!("AL-LOSS-{pid}"),
                title: format!("Vente à perte — {name}"),
                detail: format!("Prix de vente {} GNF inférieur au coût {} GNF.",
                                price as i64, cost as i64),
                reco: "Corriger le prix de vente ou le coût d'achat.".into(),
                category: "Marge",
                severity: sev.clone(),
            });
        }
    }

    // --- Stock dormant (aucune vente depuis 30 jours) ---
    if cat_active("dormant_stock") {
        let sev = cat_sev("dormant_stock", "Attention");
        let mut stmt = conn.prepare(
            "SELECT p.id, p.name, p.stock FROM products p
             WHERE p.commerce_id=?1 AND p.active=1 AND p.stock>0
               AND p.created_at <= datetime('now','-30 days')
               AND NOT EXISTS (
                 SELECT 1 FROM sale_items si JOIN sales s ON s.id = si.sale_id
                 WHERE si.product_id = p.id AND s.state!='Annulée'
                   AND s.created_at >= datetime('now','-30 days'))",
        )?;
        let rows = stmt.query_map([&sess.commerce_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, f64>(2)?))
        })?;
        for r in rows.flatten() {
            let (pid, name, stock) = r;
            candidates.push(Candidate {
                id: format!("AL-DORM-{pid}"),
                title: format!("Stock dormant — {name}"),
                detail: format!("Aucune vente depuis 30 jours — {} en stock.", stock as i64),
                reco: "Envisager une promotion ou arrêter le réassort.".into(),
                category: "Stock",
                severity: sev.clone(),
            });
        }
    }

    // --- Compte de paiement à sec (solde nul ou négatif) ---
    if cat_active("low_balance") {
        let sev = cat_sev("low_balance", "Attention");
        let mut stmt = conn.prepare(
            "SELECT id, title, balance FROM treasury_accounts
             WHERE commerce_id=?1 AND active=1 AND as_payment=1 AND balance<=0",
        )?;
        let rows = stmt.query_map([&sess.commerce_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, f64>(2)?))
        })?;
        for r in rows.flatten() {
            let (aid, title, balance) = r;
            candidates.push(Candidate {
                id: format!("AL-BAL-{aid}"),
                title: format!("Compte à sec — {title}"),
                detail: format!("Solde {} GNF — ce compte de paiement est vide.", balance as i64),
                reco: "Approvisionner le compte avant de l'utiliser pour payer.".into(),
                category: "Trésorerie",
                severity: sev.clone(),
            });
        }
    }

    // --- Écarts d'inventaire (session clôturée, 7 derniers jours) ---
    if cat_active("inventory_variance") {
        let sev = cat_sev("inventory_variance", "Attention");
        let mut stmt = conn.prepare(
            "SELECT s.id, s.title, COUNT(c.id), COALESCE(SUM(ABS(c.variance)),0)
             FROM inventory_sessions s
             JOIN inventory_counts c ON c.session_id = s.id
               AND c.variance IS NOT NULL AND c.variance <> 0
             WHERE s.commerce_id=?1 AND s.status!='open'
               AND s.closed_at >= datetime('now','-7 days')
             GROUP BY s.id HAVING COUNT(c.id) > 0",
        )?;
        let rows = stmt.query_map([&sess.commerce_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?, row.get::<_, f64>(3)?))
        })?;
        for r in rows.flatten() {
            let (sid, title, count, total) = r;
            candidates.push(Candidate {
                id: format!("AL-INV-{sid}"),
                title: format!("Écarts d'inventaire — {title}"),
                detail: format!("{count} écart(s) détecté(s), {} unités au total.", total as i64),
                reco: "Vérifier la démarque et corriger les stocks.".into(),
                category: "Inventaire",
                severity: sev.clone(),
            });
        }
    }

    // --- Objectif mensuel : cadence en retard ---
    if cat_active("month_goal") {
        let goal: f64 = conn.query_row(
            "SELECT value FROM settings WHERE key='dashboard_month_goal' AND commerce_id=?1",
            [&sess.commerce_id], |r| r.get::<_, String>(0),
        ).ok().and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);
        let day: f64 = conn.query_row(
            "SELECT CAST(strftime('%d','now') AS INTEGER)", [], |r| r.get::<_, i64>(0),
        ).unwrap_or(0) as f64;
        let days_in_month: f64 = conn.query_row(
            "SELECT CAST(strftime('%d', date('now','start of month','+1 month','-1 day')) AS INTEGER)",
            [], |r| r.get::<_, i64>(0),
        ).unwrap_or(30) as f64;
        // On n'alerte qu'à partir du 6 du mois pour éviter le bruit en début de mois.
        if goal > 0.0 && day >= 6.0 && days_in_month > 0.0 {
            let month_gross: f64 = conn.query_row(
                "SELECT COALESCE(SUM(total),0) FROM sales
                 WHERE commerce_id=?1 AND state!='Annulée'
                   AND strftime('%Y-%m',created_at)=strftime('%Y-%m','now')",
                [&sess.commerce_id], |r| r.get(0),
            ).unwrap_or(0.0);
            let month_returns: f64 = conn.query_row(
                "SELECT COALESCE(SUM(sr.refund_amount),0) FROM sale_returns sr
                 JOIN sales s ON s.id = sr.sale_id
                 WHERE s.commerce_id=?1
                   AND strftime('%Y-%m',sr.created_at)=strftime('%Y-%m','now')",
                [&sess.commerce_id], |r| r.get(0),
            ).unwrap_or(0.0);
            let month_sales = (month_gross - month_returns).max(0.0);
            let expected = goal * day / days_in_month;
            if month_sales < expected * 0.7 {
                candidates.push(Candidate {
                    id: "AL-GOAL".into(),
                    title: "Objectif mensuel en retard".into(),
                    detail: format!(
                        "CA du mois {} GNF, sous la cadence attendue (≈ {} GNF) pour l'objectif {} GNF.",
                        month_sales as i64, expected as i64, goal as i64),
                    reco: "Intensifier les ventes ou ajuster l'objectif.".into(),
                    category: "Ventes",
                    severity: cat_sev("month_goal", "Attention"),
                });
            }
        }
    }

    let now = chrono::Utc::now().to_rfc3339();
    let current_ids: Vec<String> = candidates.iter().map(|c| c.id.clone()).collect();

    // Upsert idempotent : préserve les statuts 'Masquée' / 'Résolue'
    for c in &candidates {
        conn.execute(
            "INSERT INTO alerts
               (id, commerce_id, title, detail, recommendation, category, severity, status,
                entity_type, entity_id, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,'À traiter','auto',?1,?8,?8)
             ON CONFLICT(id) DO UPDATE SET
               title=?3, detail=?4, recommendation=?5, severity=?7, updated_at=?8
             WHERE alerts.status NOT IN ('Masquée','Résolue')",
            rusqlite::params![
                c.id, sess.commerce_id, c.title, c.detail, c.reco,
                c.category, c.severity, now,
            ],
        )?;
    }

    // Supprimer les alertes auto dont la condition n'est plus vraie (et non masquées)
    let placeholders: String = if current_ids.is_empty() {
        "''".to_string()
    } else {
        current_ids.iter().map(|id| format!("'{}'", id.replace('\'', "''"))).collect::<Vec<_>>().join(",")
    };
    let cleanup_sql = format!(
        "DELETE FROM alerts WHERE commerce_id=?1 AND entity_type='auto'
         AND status='À traiter' AND id NOT IN ({placeholders})"
    );
    conn.execute(&cleanup_sql, [&sess.commerce_id])?;

    // Compter les alertes actives
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM alerts WHERE commerce_id=?1 AND status IN ('À traiter','En surveillance')",
        [&sess.commerce_id], |r| r.get(0),
    )?;
    Ok(count)
}

#[tauri::command]
pub fn list_alerts(
    db: State<Database>,
    session: State<SessionState>,
) -> KomersaResult<Vec<AlertRow>> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();

    let mut stmt = conn.prepare(
        "SELECT id, title, detail, recommendation, category, severity, status,
                entity_type, entity_id, created_at
         FROM alerts WHERE commerce_id=?1 AND status != 'Masquée'
         ORDER BY
           CASE severity WHEN 'Critique' THEN 0 WHEN 'Attention' THEN 1 ELSE 2 END,
           created_at DESC",
    )?;
    let rows = stmt.query_map([&sess.commerce_id], |row| {
        Ok(AlertRow {
            id: row.get(0)?, title: row.get(1)?, detail: row.get(2)?,
            recommendation: row.get(3)?, category: row.get(4)?,
            severity: row.get(5)?, status: row.get(6)?,
            entity_type: row.get(7)?, entity_id: row.get(8)?, created_at: row.get(9)?,
        })
    })?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn get_alert_metrics(
    db: State<Database>,
    session: State<SessionState>,
) -> KomersaResult<AlertMetrics> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();

    conn.query_row(
        "SELECT
           COUNT(CASE WHEN severity='Critique' AND status IN ('À traiter','En surveillance') THEN 1 END),
           COUNT(CASE WHEN severity='Attention' AND status IN ('À traiter','En surveillance') THEN 1 END),
           COUNT(CASE WHEN status IN ('À traiter','En surveillance') THEN 1 END)
         FROM alerts WHERE commerce_id=?1",
        [&sess.commerce_id],
        |r| Ok(AlertMetrics { critical: r.get(0)?, warning: r.get(1)?, total: r.get(2)? }),
    ).map_err(KomersaError::Database)
}

#[tauri::command]
pub fn update_alert_status(
    db: State<Database>,
    session: State<SessionState>,
    input: UpdateAlertStatusInput,
) -> KomersaResult<()> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();

    let now = chrono::Utc::now().to_rfc3339();
    let affected = conn.execute(
        "UPDATE alerts SET status=?2, updated_at=?3 WHERE id=?1 AND commerce_id=?4",
        rusqlite::params![input.alert_id, input.status, now, sess.commerce_id],
    )?;
    if affected == 0 { return Err(KomersaError::NotFound); }
    Ok(())
}

// ---------------------------------------------------------------------------
// Règles d'alerte personnalisées (AlertRuleForm)
//   type ∈ { stock, customer_credit, supplier_debt, cash_session }
//   trigger_config : JSON optionnel (ex. {"threshold": 5} pour le stock)
//   channels       : JSON (ex. {"inapp":true,"email":false,"sms":false})
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct AlertRuleRow {
    pub id: String,
    pub label: String,
    #[serde(rename = "type")]
    pub rule_type: String,
    pub trigger_config: Option<String>,
    pub severity: String,
    pub channels: String,
    pub active: bool,
}

#[derive(Deserialize)]
pub struct CreateAlertRuleInput {
    pub label: String,
    pub rule_type: String,
    pub trigger_config: Option<String>,
    pub severity: String,
    pub channels: Option<String>,
    pub active: bool,
}

#[derive(Deserialize)]
pub struct UpdateAlertRuleInput {
    pub id: String,
    pub label: String,
    pub rule_type: String,
    pub trigger_config: Option<String>,
    pub severity: String,
    pub channels: Option<String>,
    pub active: bool,
}

const RULE_TYPES: &[&str] = &[
    "stock", "customer_credit", "supplier_debt", "cash_session",
    "credit_due_soon", "debt_due_soon", "credit_limit", "cash_gap",
    "loss_sale", "dormant_stock", "month_goal", "low_balance",
    "inventory_variance", "cash_closed",
];

fn validate_rule_type(t: &str) -> KomersaResult<()> {
    if RULE_TYPES.contains(&t) { Ok(()) }
    else { Err(KomersaError::Validation("Type de règle inconnu.".into())) }
}

#[tauri::command]
pub fn list_alert_rules(
    db: State<Database>,
    session: State<SessionState>,
) -> KomersaResult<Vec<AlertRuleRow>> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();

    let mut stmt = conn.prepare(
        "SELECT id, label, type, trigger_config, severity, channels, active
         FROM alert_rules WHERE commerce_id=?1 ORDER BY created_at",
    )?;
    let rows = stmt.query_map([&sess.commerce_id], |row| {
        Ok(AlertRuleRow {
            id: row.get(0)?, label: row.get(1)?, rule_type: row.get(2)?,
            trigger_config: row.get(3)?, severity: row.get(4)?,
            channels: row.get(5)?, active: row.get::<_, i64>(6)? != 0,
        })
    })?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn create_alert_rule(
    db: State<Database>,
    session: State<SessionState>,
    input: CreateAlertRuleInput,
) -> KomersaResult<AlertRuleRow> {
    if input.label.trim().is_empty() {
        return Err(KomersaError::Validation("L'intitulé de la règle est requis.".into()));
    }
    validate_rule_type(&input.rule_type)?;

    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::ModifierParametres)?;

    let id = format!("ARL-{}", Uuid::new_v4().as_simple());
    let channels = input.channels.unwrap_or_else(|| "{\"inapp\":true}".into());
    conn.execute(
        "INSERT INTO alert_rules (id, commerce_id, label, type, trigger_config, severity, channels, active)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        rusqlite::params![
            id, sess.commerce_id, input.label.trim(), input.rule_type,
            input.trigger_config, input.severity, channels, input.active as i64,
        ],
    )?;
    Ok(AlertRuleRow {
        id, label: input.label.trim().into(), rule_type: input.rule_type,
        trigger_config: input.trigger_config, severity: input.severity,
        channels, active: input.active,
    })
}

#[tauri::command]
pub fn update_alert_rule(
    db: State<Database>,
    session: State<SessionState>,
    input: UpdateAlertRuleInput,
) -> KomersaResult<()> {
    if input.label.trim().is_empty() {
        return Err(KomersaError::Validation("L'intitulé de la règle est requis.".into()));
    }
    validate_rule_type(&input.rule_type)?;

    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::ModifierParametres)?;

    let channels = input.channels.unwrap_or_else(|| "{\"inapp\":true}".into());
    let affected = conn.execute(
        "UPDATE alert_rules SET label=?2, type=?3, trigger_config=?4, severity=?5, channels=?6, active=?7
         WHERE id=?1 AND commerce_id=?8",
        rusqlite::params![
            input.id, input.label.trim(), input.rule_type, input.trigger_config,
            input.severity, channels, input.active as i64, sess.commerce_id,
        ],
    )?;
    if affected == 0 { return Err(KomersaError::NotFound); }
    Ok(())
}

#[tauri::command]
pub fn delete_alert_rule(
    db: State<Database>,
    session: State<SessionState>,
    rule_id: String,
) -> KomersaResult<()> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::ModifierParametres)?;

    let affected = conn.execute(
        "DELETE FROM alert_rules WHERE id=?1 AND commerce_id=?2",
        rusqlite::params![rule_id, sess.commerce_id],
    )?;
    if affected == 0 { return Err(KomersaError::NotFound); }
    Ok(())
}
