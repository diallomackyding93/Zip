use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::db::Database;
use crate::error::{KomersaError, KomersaResult};
use crate::permissions::{self, Permission};
use crate::session::SessionState;

// ---------------------------------------------------------------------------
// Structs de sortie
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct PurchaseRow {
    pub id: String,
    pub purchase_ref: String,
    pub supplier_id: String,
    pub supplier_name: String,
    pub ordered_by: Option<String>,
    pub ordered_by_name: Option<String>,
    pub state: String,
    pub mode_label: Option<String>,
    pub amount: f64,
    pub paid: f64,
    pub remaining: f64,
    pub ordered_at: String,
    pub received_at: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PurchaseItemRow {
    pub id: String,
    pub product_id: Option<String>,
    pub product_name: String,
    pub variant: Option<String>,
    pub qty: f64,
    pub unit_name: Option<String>,
    pub unit_cost: f64,
    pub line_total: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PurchaseDetail {
    pub purchase: PurchaseRow,
    pub items: Vec<PurchaseItemRow>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SupplierDebtRow {
    pub id: String,
    pub supplier_id: String,
    pub supplier_name: String,
    pub purchase_id: Option<String>,
    pub purchase_ref: Option<String>,
    pub invoice_ref: Option<String>,
    pub invoice_date: Option<String>,
    pub due_date: Option<String>,
    pub initial: f64,
    pub paid: f64,
    pub remaining: f64,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DebtPaymentRow {
    pub id: String,
    pub amount: f64,
    pub mode_label: String,
    pub paid_by: Option<String>,
    pub paid_at: String,
}

// ---------------------------------------------------------------------------
// Structs d'entrée
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct PurchaseItemInput {
    pub product_id: Option<String>,
    pub product_name: String,
    pub variant: Option<String>,
    pub qty: f64,
    pub unit_name: Option<String>,
    pub unit_cost: f64,
}

#[derive(Deserialize)]
pub struct CreatePurchaseInput {
    pub supplier_id: Option<String>,
    pub supplier_name: Option<String>,
    pub mode_label: Option<String>,
    pub items: Vec<PurchaseItemInput>,
    pub note: Option<String>,
    /// true = réception immédiate, false = commande uniquement
    pub receive_now: bool,
    /// Compte de trésorerie débité quand l'achat est payé (hors crédit fournisseur).
    #[serde(default)]
    pub treasury_account_id: Option<String>,
    /// Jeton anti-doublon.
    #[serde(default)]
    pub idempotency_key: Option<String>,
}

#[derive(Deserialize)]
pub struct ReceivePurchaseInput {
    pub purchase_id: String,
    /// Compte débité si l'achat est payé comptant à la réception.
    pub treasury_account_id: Option<String>,
}

#[derive(Deserialize)]
pub struct AddDebtPaymentInput {
    pub debt_id: String,
    pub amount: f64,
    pub mode_label: String,
    pub treasury_account_id: Option<String>,
}

// ---------------------------------------------------------------------------
// Helper : générer référence achat
// ---------------------------------------------------------------------------
fn next_purchase_ref(conn: &rusqlite::Connection, commerce_id: &str) -> KomersaResult<String> {
    let max: i64 = conn.query_row(
        "SELECT COALESCE(MAX(CAST(REPLACE(ref,'ACH-','') AS INTEGER)), 0)
         FROM purchases WHERE commerce_id=?1",
        [commerce_id], |r| r.get(0),
    )?;
    Ok(format!("ACH-{:04}", max + 1))
}

/// Charge un achat (en-tête) par id.
fn load_purchase_row(conn: &rusqlite::Connection, id: &str, commerce_id: &str) -> KomersaResult<PurchaseRow> {
    conn.query_row(
        "SELECT p.id, p.ref, p.supplier_id, s.name, p.ordered_by, a.name,
                p.state, p.mode_label, p.amount, p.paid, p.remaining,
                p.ordered_at, p.received_at, p.note
         FROM purchases p
         JOIN suppliers s ON s.id=p.supplier_id
         LEFT JOIN accounts a ON a.id=p.ordered_by
         WHERE p.id=?1 AND p.commerce_id=?2",
        rusqlite::params![id, commerce_id],
        |row| Ok(PurchaseRow {
            id: row.get(0)?, purchase_ref: row.get(1)?,
            supplier_id: row.get(2)?, supplier_name: row.get(3)?,
            ordered_by: row.get(4)?, ordered_by_name: row.get(5)?,
            state: row.get(6)?, mode_label: row.get(7)?,
            amount: row.get(8)?, paid: row.get(9)?, remaining: row.get(10)?,
            ordered_at: row.get(11)?, received_at: row.get(12)?, note: row.get(13)?,
        }),
    ).map_err(|_| KomersaError::NotFound)
}

/// Mode « crédit fournisseur » ?
fn is_credit_mode(mode: Option<&str>) -> bool {
    mode.map(|m| m.contains("Crédit")).unwrap_or(false)
}

/// Quantité en unités de base = qty × facteur de l'unité choisie (1 si base/inconnue).
/// Évite d'ajouter « 1 carton » comme « 1 pièce » au stock.
fn base_qty_for(conn: &rusqlite::Connection, product_id: &str, unit_name: Option<&str>, qty: f64) -> f64 {
    let Some(name) = unit_name else { return qty; };
    let factor: Option<f64> = conn.query_row(
        "SELECT factor FROM product_units WHERE product_id=?1 AND name=?2 LIMIT 1",
        rusqlite::params![product_id, name], |r| r.get(0),
    ).ok();
    qty * factor.filter(|f| *f > 0.0).unwrap_or(1.0)
}

/// Met le stock à jour (base + déclinaison) pour une ligne reçue.
fn receive_stock(conn: &rusqlite::Connection, item_product_id: Option<&str>, variant: Option<&str>,
                 unit_name: Option<&str>, qty: f64, now: &str) -> KomersaResult<()> {
    if let Some(pid) = item_product_id {
        let base = base_qty_for(conn, pid, unit_name, qty);
        conn.execute(
            "UPDATE products SET stock=stock+?2, updated_at=?3 WHERE id=?1",
            rusqlite::params![pid, base, now],
        )?;
        if let Some(v) = variant {
            conn.execute(
                "UPDATE product_variants SET stock=COALESCE(stock,0)+?3
                 WHERE product_id=?1 AND value=?2 AND stock IS NOT NULL",
                rusqlite::params![pid, v, base],
            )?;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Commandes
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct PurchaseMetrics {
    pub total_amount: f64,
    pub total_due: f64,
    pub count: i64,
}

#[tauri::command]
pub fn get_purchase_metrics(
    db: State<Database>,
    session: State<SessionState>,
) -> KomersaResult<PurchaseMetrics> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check_any(&conn, &sess.membership_id, &sess.role,
        &[Permission::GererProduits, Permission::VoirTresorerie, Permission::VoirRapports])?;
    conn.query_row(
        "SELECT COALESCE(SUM(amount),0), COALESCE(SUM(remaining),0), COUNT(*)
         FROM purchases WHERE commerce_id=?1",
        [&sess.commerce_id],
        |r| Ok(PurchaseMetrics { total_amount: r.get(0)?, total_due: r.get(1)?, count: r.get(2)? }),
    ).map_err(KomersaError::Database)
}

#[derive(Debug, Clone, Serialize)]
pub struct DebtMetrics {
    pub total_due: f64,
    pub overdue: f64,
    pub open_count: i64,
    pub settled_count: i64,
}

#[tauri::command]
pub fn get_debt_metrics(
    db: State<Database>,
    session: State<SessionState>,
) -> KomersaResult<DebtMetrics> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check_any(&conn, &sess.membership_id, &sess.role,
        &[Permission::PaiementFournisseur, Permission::VoirTresorerie, Permission::VoirRapports])?;
    conn.query_row(
        "SELECT
           COALESCE(SUM(CASE WHEN status!='Soldée' THEN remaining ELSE 0 END),0),
           COALESCE(SUM(CASE WHEN status='En retard' THEN remaining ELSE 0 END),0),
           COUNT(CASE WHEN status!='Soldée' THEN 1 END),
           COUNT(CASE WHEN status='Soldée' THEN 1 END)
         FROM supplier_debts WHERE commerce_id=?1",
        [&sess.commerce_id],
        |r| Ok(DebtMetrics {
            total_due: r.get(0)?, overdue: r.get(1)?,
            open_count: r.get(2)?, settled_count: r.get(3)?,
        }),
    ).map_err(KomersaError::Database)
}

#[tauri::command]
pub fn list_purchases(
    db: State<Database>,
    session: State<SessionState>,
    from: Option<String>,
    to: Option<String>,
    offset: Option<i64>,
    limit: Option<i64>,
) -> KomersaResult<Vec<PurchaseRow>> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check_any(&conn, &sess.membership_id, &sess.role,
        &[Permission::GererProduits, Permission::VoirTresorerie, Permission::VoirRapports])?;

    let lim = limit.unwrap_or(50).clamp(1, 10000);
    let off = offset.unwrap_or(0).max(0);

    let mut stmt = conn.prepare(
        "SELECT p.id, p.ref, p.supplier_id, s.name, p.ordered_by, a.name,
                p.state, p.mode_label, p.amount, p.paid, p.remaining,
                p.ordered_at, p.received_at, p.note
         FROM purchases p
         JOIN suppliers s ON s.id = p.supplier_id
         LEFT JOIN accounts a ON a.id = p.ordered_by
         WHERE p.commerce_id=?1
           AND (?2 IS NULL OR date(p.ordered_at) >= date(?2))
           AND (?3 IS NULL OR date(p.ordered_at) <= date(?3))
         ORDER BY p.ordered_at DESC
         LIMIT ?4 OFFSET ?5",
    )?;
    let rows = stmt.query_map(rusqlite::params![sess.commerce_id, from, to, lim, off], |row| {
        Ok(PurchaseRow {
            id: row.get(0)?, purchase_ref: row.get(1)?,
            supplier_id: row.get(2)?, supplier_name: row.get(3)?,
            ordered_by: row.get(4)?, ordered_by_name: row.get(5)?,
            state: row.get(6)?, mode_label: row.get(7)?,
            amount: row.get(8)?, paid: row.get(9)?, remaining: row.get(10)?,
            ordered_at: row.get(11)?, received_at: row.get(12)?, note: row.get(13)?,
        })
    })?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn get_purchase_detail(
    db: State<Database>,
    session: State<SessionState>,
    purchase_id: String,
) -> KomersaResult<PurchaseDetail> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check_any(&conn, &sess.membership_id, &sess.role,
        &[Permission::GererProduits, Permission::VoirTresorerie, Permission::VoirRapports])?;

    let purchase = conn.query_row(
        "SELECT p.id, p.ref, p.supplier_id, s.name, p.ordered_by, a.name,
                p.state, p.mode_label, p.amount, p.paid, p.remaining,
                p.ordered_at, p.received_at, p.note
         FROM purchases p
         JOIN suppliers s ON s.id=p.supplier_id
         LEFT JOIN accounts a ON a.id=p.ordered_by
         WHERE p.id=?1 AND p.commerce_id=?2",
        rusqlite::params![purchase_id, sess.commerce_id],
        |row| Ok(PurchaseRow {
            id: row.get(0)?, purchase_ref: row.get(1)?,
            supplier_id: row.get(2)?, supplier_name: row.get(3)?,
            ordered_by: row.get(4)?, ordered_by_name: row.get(5)?,
            state: row.get(6)?, mode_label: row.get(7)?,
            amount: row.get(8)?, paid: row.get(9)?, remaining: row.get(10)?,
            ordered_at: row.get(11)?, received_at: row.get(12)?, note: row.get(13)?,
        }),
    ).map_err(|_| KomersaError::NotFound)?;

    let mut items_stmt = conn.prepare(
        "SELECT id, product_id, product_name, variant, qty, unit_name, unit_cost, line_total
         FROM purchase_items WHERE purchase_id=?1 ORDER BY rowid",
    )?;
    let items = items_stmt.query_map([&purchase_id], |row| {
        Ok(PurchaseItemRow {
            id: row.get(0)?, product_id: row.get(1)?, product_name: row.get(2)?,
            variant: row.get(3)?, qty: row.get(4)?, unit_name: row.get(5)?,
            unit_cost: row.get(6)?, line_total: row.get(7)?,
        })
    })?.collect::<Result<Vec<_>, _>>()?;

    Ok(PurchaseDetail { purchase, items })
}

#[tauri::command]
pub fn create_purchase(
    db: State<Database>,
    session: State<SessionState>,
    input: CreatePurchaseInput,
) -> KomersaResult<PurchaseRow> {
    if input.items.is_empty() {
        return Err(KomersaError::Validation("La commande doit contenir au moins un article.".into()));
    }

    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::GererProduits)?;

    // Anti-doublon : renvoyer l'achat déjà créé pour ce jeton.
    if let Some(ref key) = input.idempotency_key {
        let existing: Option<String> = conn.query_row(
            "SELECT id FROM purchases WHERE commerce_id=?1 AND idempotency_key=?2",
            rusqlite::params![sess.commerce_id, key], |r| r.get(0),
        ).ok();
        if let Some(id) = existing {
            return load_purchase_row(&conn, &id, &sess.commerce_id);
        }
    }

    // Transaction : fournisseur + commande + lignes + stock + dette atomiques.
    let tx = conn.unchecked_transaction()?;

    // Résoudre le fournisseur
    let supplier_id = if let Some(id) = input.supplier_id.as_deref() {
        id.to_string()
    } else if let Some(name) = input.supplier_name.as_deref() {
        let existing: Option<String> = conn.query_row(
            "SELECT id FROM suppliers WHERE commerce_id=?1 AND lower(name)=lower(?2) LIMIT 1",
            rusqlite::params![sess.commerce_id, name], |r| r.get(0),
        ).ok();
        if let Some(id) = existing { id } else {
            let id = format!("SUP-{}", Uuid::new_v4().as_simple());
            let now2 = chrono::Utc::now().to_rfc3339();
            conn.execute(
                "INSERT INTO suppliers (id, commerce_id, name, created_at, updated_at) VALUES (?1,?2,?3,?4,?4)",
                rusqlite::params![id, sess.commerce_id, name, now2],
            )?;
            id
        }
    } else {
        return Err(KomersaError::Validation("Le fournisseur est requis.".into()));
    };

    let amount: f64 = (input.items.iter().map(|it| it.qty * it.unit_cost).sum::<f64>()).round();
    let now = chrono::Utc::now().to_rfc3339();
    let id = format!("PRC-{}", Uuid::new_v4().as_simple());
    let purchase_ref = next_purchase_ref(&conn, &sess.commerce_id)?;
    let credit = is_credit_mode(input.mode_label.as_deref());

    // Solde payé / restant selon mode et réception :
    //  - crédit fournisseur → rien payé, reste = montant (dette à la réception) ;
    //  - autre mode + réception → payé comptant intégralement, on débite la trésorerie ;
    //  - simple commande non reçue → rien payé, rien dû encore.
    let (paid, remaining, actual_state) = if credit {
        (0.0, amount, if input.receive_now { "À payer" } else { "Commandé" })
    } else if input.receive_now {
        (amount, 0.0, "Reçu")
    } else {
        (0.0, 0.0, "Commandé")
    };

    conn.execute(
        "INSERT INTO purchases
           (id, commerce_id, ref, supplier_id, ordered_by, state, mode_label,
            amount, paid, remaining, ordered_at, received_at, note, treasury_account_id, idempotency_key)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
        rusqlite::params![
            id, sess.commerce_id, purchase_ref, supplier_id, sess.account_id,
            actual_state, input.mode_label, amount, paid, remaining, now,
            if input.receive_now { Some(now.clone()) } else { None },
            input.note.as_deref(), input.treasury_account_id.as_deref(), input.idempotency_key.as_deref(),
        ],
    )?;

    for item in &input.items {
        let item_id = format!("PIT-{}", Uuid::new_v4().as_simple());
        let line_total = (item.qty * item.unit_cost).round();
        conn.execute(
            "INSERT INTO purchase_items
               (id, purchase_id, product_id, product_name, variant, qty, unit_name, unit_cost, line_total)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            rusqlite::params![
                item_id, id, item.product_id.as_deref(), item.product_name,
                item.variant.as_deref(), item.qty, item.unit_name.as_deref(), item.unit_cost, line_total,
            ],
        )?;

        // Mise en stock si réception immédiate (conversion d'unité appliquée).
        if input.receive_now {
            receive_stock(&conn, item.product_id.as_deref(), item.variant.as_deref(),
                          item.unit_name.as_deref(), item.qty, &now)?;
        }
    }

    // Créer la dette fournisseur si crédit ET reçu (la dette naît à la réception).
    if credit && input.receive_now && remaining > 0.0 {
        let debt_id = format!("DEB-{}", Uuid::new_v4().as_simple());
        conn.execute(
            "INSERT INTO supplier_debts
               (id, commerce_id, supplier_id, purchase_id, invoice_date, initial, paid, remaining, status, created_by, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,0,?6,'Ouverte',?7,?8,?8)",
            rusqlite::params![
                debt_id, sess.commerce_id, supplier_id, id, now, remaining, sess.account_id, now,
            ],
        )?;
    }

    // Décaissement immédiat : débiter le compte de trésorerie choisi (l'argent sort).
    if paid > 0.0 {
        if let Some(ref account_id) = input.treasury_account_id {
            crate::commands::treasury::ensure_balance(&conn, &sess.commerce_id, account_id, paid.round())?;
            conn.execute(
                "UPDATE treasury_accounts SET balance=balance-?2, updated_at=?3 WHERE id=?1 AND commerce_id=?4",
                rusqlite::params![account_id, paid.round(), now, sess.commerce_id],
            )?;
            crate::commands::treasury::record_movement(
                &conn, &sess.commerce_id, account_id, -paid.round(), "purchase",
                &format!("Achat {purchase_ref}"), &now,
            )?;
        }
    }

    tx.commit()?;

    let supplier_name: String = conn.query_row(
        "SELECT name FROM suppliers WHERE id=?1", [&supplier_id], |r| r.get(0),
    ).unwrap_or_default();
    let ordered_by_name: Option<String> = conn.query_row(
        "SELECT name FROM accounts WHERE id=?1", [&sess.account_id], |r| r.get(0),
    ).ok();

    Ok(PurchaseRow {
        id, purchase_ref, supplier_id, supplier_name,
        ordered_by: Some(sess.account_id), ordered_by_name,
        state: actual_state.into(), mode_label: input.mode_label,
        amount, paid, remaining,
        ordered_at: now.clone(), received_at: if input.receive_now { Some(now) } else { None },
        note: input.note,
    })
}

#[tauri::command]
pub fn receive_purchase(
    db: State<Database>,
    session: State<SessionState>,
    input: ReceivePurchaseInput,
) -> KomersaResult<PurchaseRow> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::GererProduits)?;

    let (cur_state, mode_label, amount, supplier_id): (String, Option<String>, f64, String) = conn.query_row(
        "SELECT state, mode_label, amount, supplier_id FROM purchases WHERE id=?1 AND commerce_id=?2",
        rusqlite::params![input.purchase_id, sess.commerce_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    ).map_err(|_| KomersaError::NotFound)?;

    if cur_state != "Commandé" {
        return Err(KomersaError::Validation("Cette commande est déjà réceptionnée.".into()));
    }

    let credit = is_credit_mode(mode_label.as_deref());
    let now = chrono::Utc::now().to_rfc3339();
    let tx = conn.unchecked_transaction()?;

    // Mise en stock de chaque ligne (avec conversion d'unité).
    let mut items_stmt = conn.prepare(
        "SELECT product_id, variant, unit_name, qty FROM purchase_items WHERE purchase_id=?1",
    )?;
    let items: Vec<(Option<String>, Option<String>, Option<String>, f64)> = items_stmt
        .query_map([&input.purchase_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    drop(items_stmt);
    for (pid, variant, unit, qty) in &items {
        receive_stock(&conn, pid.as_deref(), variant.as_deref(), unit.as_deref(), *qty, &now)?;
    }

    // Paiement selon le mode.
    let (paid, remaining, new_state) = if credit { (0.0, amount, "À payer") } else { (amount, 0.0, "Reçu") };

    if credit && remaining > 0.0 {
        let debt_id = format!("DEB-{}", Uuid::new_v4().as_simple());
        conn.execute(
            "INSERT INTO supplier_debts
               (id, commerce_id, supplier_id, purchase_id, invoice_date, initial, paid, remaining, status, created_by, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,0,?6,'Ouverte',?7,?8,?8)",
            rusqlite::params![debt_id, sess.commerce_id, supplier_id, input.purchase_id, now, remaining, sess.account_id, now],
        )?;
    } else if paid > 0.0 {
        if let Some(ref account_id) = input.treasury_account_id {
            crate::commands::treasury::ensure_balance(&conn, &sess.commerce_id, account_id, paid.round())?;
            conn.execute(
                "UPDATE treasury_accounts SET balance=balance-?2, updated_at=?3 WHERE id=?1 AND commerce_id=?4",
                rusqlite::params![account_id, paid.round(), now, sess.commerce_id],
            )?;
            crate::commands::treasury::record_movement(
                &conn, &sess.commerce_id, account_id, -paid.round(), "purchase",
                "Achat (réception)", &now,
            )?;
        }
    }

    conn.execute(
        "UPDATE purchases SET state=?2, paid=?3, remaining=?4, received_at=?5,
           treasury_account_id=COALESCE(?6, treasury_account_id)
         WHERE id=?1 AND commerce_id=?7",
        rusqlite::params![
            input.purchase_id, new_state, paid, remaining, now,
            input.treasury_account_id.as_deref(), sess.commerce_id,
        ],
    )?;
    tx.commit()?;

    load_purchase_row(&conn, &input.purchase_id, &sess.commerce_id)
}

#[tauri::command]
pub fn list_supplier_debts(
    db: State<Database>,
    session: State<SessionState>,
    from: Option<String>,
    to: Option<String>,
    offset: Option<i64>,
    limit: Option<i64>,
) -> KomersaResult<Vec<SupplierDebtRow>> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check_any(&conn, &sess.membership_id, &sess.role,
        &[Permission::PaiementFournisseur, Permission::VoirTresorerie, Permission::VoirRapports])?;

    let lim = limit.unwrap_or(50).clamp(1, 10000);
    let off = offset.unwrap_or(0).max(0);

    let mut stmt = conn.prepare(
        "SELECT sd.id, sd.supplier_id, s.name, sd.purchase_id, p.ref,
                sd.invoice_ref, sd.invoice_date, sd.due_date,
                sd.initial, sd.paid, sd.remaining, sd.status, sd.created_at
         FROM supplier_debts sd
         JOIN suppliers s ON s.id=sd.supplier_id
         LEFT JOIN purchases p ON p.id=sd.purchase_id
         WHERE sd.commerce_id=?1
           AND (?2 IS NULL OR date(sd.created_at) >= date(?2))
           AND (?3 IS NULL OR date(sd.created_at) <= date(?3))
         ORDER BY sd.created_at DESC
         LIMIT ?4 OFFSET ?5",
    )?;
    let rows = stmt.query_map(rusqlite::params![sess.commerce_id, from, to, lim, off], |row| {
        Ok(SupplierDebtRow {
            id: row.get(0)?, supplier_id: row.get(1)?, supplier_name: row.get(2)?,
            purchase_id: row.get(3)?, purchase_ref: row.get(4)?,
            invoice_ref: row.get(5)?, invoice_date: row.get(6)?, due_date: row.get(7)?,
            initial: row.get(8)?, paid: row.get(9)?, remaining: row.get(10)?,
            status: row.get(11)?, created_at: row.get(12)?,
        })
    })?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn add_debt_payment(
    db: State<Database>,
    session: State<SessionState>,
    input: AddDebtPaymentInput,
) -> KomersaResult<()> {
    if input.amount <= 0.0 {
        return Err(KomersaError::Validation("Le montant doit être supérieur à 0.".into()));
    }
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::PaiementFournisseur)?;

    let (remaining, commerce_id): (f64, String) = conn.query_row(
        "SELECT remaining, commerce_id FROM supplier_debts WHERE id=?1",
        [&input.debt_id], |r| Ok((r.get(0)?, r.get(1)?)),
    ).map_err(|_| KomersaError::NotFound)?;

    if commerce_id != sess.commerce_id { return Err(KomersaError::NotFound); }
    if input.amount > remaining + 0.01 {
        return Err(KomersaError::Validation(format!(
            "Le paiement dépasse le solde restant ({} GNF).", remaining as i64
        )));
    }
    // Jamais de compte négatif : vérifier le solde disponible avant tout.
    if let Some(ref account_id) = input.treasury_account_id {
        crate::commands::treasury::ensure_balance(&conn, &sess.commerce_id, account_id, input.amount.round())?;
    }

    let now = chrono::Utc::now().to_rfc3339();
    let pay_id = format!("DPY-{}", Uuid::new_v4().as_simple());
    let new_paid: f64 = conn.query_row(
        "SELECT paid FROM supplier_debts WHERE id=?1", [&input.debt_id], |r| r.get::<_, f64>(0),
    )? + input.amount;
    let new_remaining = (remaining - input.amount).max(0.0);
    let new_status = if new_remaining <= 0.01 { "Soldée" } else { "Partiel" };

    let tx = conn.unchecked_transaction()?;
    conn.execute(
        "INSERT INTO supplier_debt_payments
           (id, debt_id, amount, mode_label, treasury_account_id, paid_by, paid_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7)",
        rusqlite::params![
            pay_id, input.debt_id, input.amount, input.mode_label,
            input.treasury_account_id, sess.account_id, now,
        ],
    )?;
    conn.execute(
        "UPDATE supplier_debts SET paid=?2, remaining=?3, status=?4, updated_at=?5 WHERE id=?1",
        rusqlite::params![input.debt_id, new_paid, new_remaining, new_status, now],
    )?;

    // Décaissement : débiter le compte de trésorerie choisi (l'argent sort).
    if let Some(ref account_id) = input.treasury_account_id {
        conn.execute(
            "UPDATE treasury_accounts SET balance=balance-?2, updated_at=?3 WHERE id=?1 AND commerce_id=?4",
            rusqlite::params![account_id, input.amount.round(), now, sess.commerce_id],
        )?;
        crate::commands::treasury::record_movement(
            &conn, &sess.commerce_id, account_id, -input.amount.round(), "debt_payment",
            "Paiement fournisseur", &now,
        )?;
    }

    // Mettre à jour la commande liée (la table purchases n'a pas de colonne updated_at)
    conn.execute(
        "UPDATE purchases SET paid=paid+?2, remaining=MAX(0,remaining-?2)
         WHERE id=(SELECT purchase_id FROM supplier_debts WHERE id=?1)",
        rusqlite::params![input.debt_id, input.amount],
    )?;

    let supplier: String = conn.query_row(
        "SELECT s.name FROM supplier_debts d JOIN suppliers s ON s.id=d.supplier_id WHERE d.id=?1",
        [&input.debt_id], |r| r.get(0)).unwrap_or_default();
    crate::commands::audit::record_audit(&conn, &sess.commerce_id, &sess.account_id, &sess.account_name,
        "supplier_payment", &format!("Paiement fournisseur — {supplier}"), Some(&input.debt_id), Some(input.amount));

    tx.commit()?;
    Ok(())
}
