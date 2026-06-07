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
pub struct ClientFull {
    pub id: String,
    pub name: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub city: Option<String>,
    pub group_name: String,
    pub credit_limit: f64,
    pub note: Option<String>,
    pub status: String,
    pub purchases30d: f64,
    pub credit_remaining: f64,
    pub last_purchase: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CustomerCreditRow {
    pub id: String,
    pub client_id: String,
    pub client_name: String,
    pub sale_id: Option<String>,
    pub sale_ref: Option<String>,
    pub initial: f64,
    pub paid: f64,
    pub remaining: f64,
    pub status: String,
    pub due_date: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CreditPaymentRow {
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
pub struct CreateClientInput {
    pub name: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub city: Option<String>,
    pub group_name: Option<String>,
    pub credit_limit: Option<f64>,
    pub note: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateClientInput {
    pub id: String,
    pub name: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub city: Option<String>,
    pub group_name: Option<String>,
    pub credit_limit: Option<f64>,
    pub note: Option<String>,
}

#[derive(Deserialize)]
pub struct AddCreditPaymentInput {
    pub credit_id: String,
    pub amount: f64,
    pub mode_label: String,
    pub treasury_account_id: Option<String>,
}

// ---------------------------------------------------------------------------
// Commandes
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_clients_full(
    db: State<Database>,
    session: State<SessionState>,
) -> KomersaResult<Vec<ClientFull>> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::VoirVentes)?;

    let mut stmt = conn.prepare(
        "SELECT c.id, c.name, c.phone, c.email, c.city, c.group_name,
                c.credit_limit, c.note, c.status, c.created_at,
                COALESCE((SELECT SUM(s.total) FROM sales s
                  WHERE s.client_id=c.id AND s.state!='Annulée'
                  AND s.created_at >= datetime('now','-30 days')),0) as purchases30d,
                COALESCE((SELECT SUM(cc.remaining) FROM customer_credits cc
                  WHERE cc.client_id=c.id AND cc.status!='Soldé'),0) as credit_remaining,
                (SELECT MAX(s.created_at) FROM sales s WHERE s.client_id=c.id) as last_purchase
         FROM clients c
         WHERE c.commerce_id=?1
         ORDER BY c.name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([&sess.commerce_id], |row| {
        Ok(ClientFull {
            id: row.get(0)?,
            name: row.get(1)?,
            phone: row.get(2)?,
            email: row.get(3)?,
            city: row.get(4)?,
            group_name: row.get(5)?,
            credit_limit: row.get(6)?,
            note: row.get(7)?,
            status: row.get(8)?,
            created_at: row.get(9)?,
            purchases30d: row.get(10)?,
            credit_remaining: row.get(11)?,
            last_purchase: row.get(12)?,
        })
    })?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn create_client(
    db: State<Database>,
    session: State<SessionState>,
    input: CreateClientInput,
) -> KomersaResult<ClientFull> {
    if input.name.trim().is_empty() {
        return Err(KomersaError::Validation("Le nom du client est requis.".into()));
    }
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::CreerVente)?;

    let id = format!("CL-{}", Uuid::new_v4().as_simple());
    let now = chrono::Utc::now().to_rfc3339();
    let group = input.group_name.as_deref().unwrap_or("Régulier");
    let credit_limit = input.credit_limit.unwrap_or(0.0);

    conn.execute(
        "INSERT INTO clients
           (id, commerce_id, name, phone, email, city, group_name, credit_limit, note, created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)",
        rusqlite::params![
            id, sess.commerce_id, input.name.trim(), input.phone.as_deref(),
            input.email.as_deref(), input.city.as_deref(), group, credit_limit,
            input.note.as_deref(), now,
        ],
    )?;
    Ok(ClientFull {
        id, name: input.name.trim().into(), phone: input.phone, email: input.email,
        city: input.city, group_name: group.into(), credit_limit, note: input.note,
        status: "Actif".into(), purchases30d: 0.0, credit_remaining: 0.0,
        last_purchase: None, created_at: now,
    })
}

#[tauri::command]
pub fn update_client(
    db: State<Database>,
    session: State<SessionState>,
    input: UpdateClientInput,
) -> KomersaResult<()> {
    if input.name.trim().is_empty() {
        return Err(KomersaError::Validation("Le nom du client est requis.".into()));
    }
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::CreerVente)?;
    let now = chrono::Utc::now().to_rfc3339();
    let group = input.group_name.as_deref().unwrap_or("Régulier");
    let credit_limit = input.credit_limit.unwrap_or(0.0);

    // Modifier le PLAFOND de crédit est sensible (risque de fraude au crédit) :
    // réservé à un superviseur. Un simple vendeur ne peut pas relever un plafond.
    let current_limit: f64 = conn.query_row(
        "SELECT credit_limit FROM clients WHERE id=?1 AND commerce_id=?2",
        rusqlite::params![input.id, sess.commerce_id], |r| r.get(0),
    ).unwrap_or(0.0);
    if (credit_limit - current_limit).abs() > 0.01 {
        permissions::check(&conn, &sess.membership_id, &sess.role, Permission::VoirRapports)?;
    }

    let affected = conn.execute(
        "UPDATE clients SET name=?2,phone=?3,email=?4,city=?5,group_name=?6,
         credit_limit=?7,note=?8,updated_at=?9 WHERE id=?1 AND commerce_id=?10",
        rusqlite::params![
            input.id, input.name.trim(), input.phone.as_deref(), input.email.as_deref(),
            input.city.as_deref(), group, credit_limit, input.note.as_deref(), now, sess.commerce_id,
        ],
    )?;
    if affected == 0 { return Err(KomersaError::NotFound); }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub struct CreditMetrics {
    pub total_due: f64,
    pub overdue: f64,
    pub open_count: i64,
    pub settled_count: i64,
}

#[tauri::command]
pub fn get_credit_metrics(
    db: State<Database>,
    session: State<SessionState>,
) -> KomersaResult<CreditMetrics> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::VoirVentes)?;

    conn.query_row(
        "SELECT
           COALESCE(SUM(CASE WHEN status!='Soldé' THEN remaining ELSE 0 END),0),
           COALESCE(SUM(CASE WHEN status='En retard' THEN remaining ELSE 0 END),0),
           COUNT(CASE WHEN status!='Soldé' THEN 1 END),
           COUNT(CASE WHEN status='Soldé' THEN 1 END)
         FROM customer_credits WHERE commerce_id=?1",
        [&sess.commerce_id],
        |r| Ok(CreditMetrics {
            total_due: r.get(0)?, overdue: r.get(1)?,
            open_count: r.get(2)?, settled_count: r.get(3)?,
        }),
    ).map_err(KomersaError::Database)
}

#[tauri::command]
pub fn list_customer_credits(
    db: State<Database>,
    session: State<SessionState>,
    from: Option<String>,
    to: Option<String>,
    offset: Option<i64>,
    limit: Option<i64>,
) -> KomersaResult<Vec<CustomerCreditRow>> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::VoirVentes)?;

    let lim = limit.unwrap_or(50).clamp(1, 10000);
    let off = offset.unwrap_or(0).max(0);

    let mut stmt = conn.prepare(
        "SELECT cc.id, cc.client_id, c.name, cc.sale_id, s.ref,
                cc.initial, cc.paid, cc.remaining, cc.status, cc.due_date,
                cc.created_at, cc.updated_at
         FROM customer_credits cc
         JOIN clients c ON c.id = cc.client_id
         LEFT JOIN sales s ON s.id = cc.sale_id
         WHERE cc.commerce_id=?1
           AND (?2 IS NULL OR date(cc.created_at) >= date(?2))
           AND (?3 IS NULL OR date(cc.created_at) <= date(?3))
         ORDER BY cc.created_at DESC
         LIMIT ?4 OFFSET ?5",
    )?;
    let rows = stmt.query_map(rusqlite::params![sess.commerce_id, from, to, lim, off], |row| {
        Ok(CustomerCreditRow {
            id: row.get(0)?, client_id: row.get(1)?, client_name: row.get(2)?,
            sale_id: row.get(3)?, sale_ref: row.get(4)?,
            initial: row.get(5)?, paid: row.get(6)?, remaining: row.get(7)?,
            status: row.get(8)?, due_date: row.get(9)?,
            created_at: row.get(10)?, updated_at: row.get(11)?,
        })
    })?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn list_credit_payments(
    db: State<Database>,
    session: State<SessionState>,
    credit_id: String,
) -> KomersaResult<Vec<CreditPaymentRow>> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::VoirVentes)?;

    let mut stmt = conn.prepare(
        "SELECT cp.id, cp.amount, cp.mode_label, a.name, cp.paid_at
         FROM customer_credit_payments cp
         LEFT JOIN accounts a ON a.id = cp.paid_by
         WHERE cp.credit_id=?1
         ORDER BY cp.paid_at DESC",
    )?;
    // Verify the credit belongs to this commerce
    let belongs: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM customer_credits WHERE id=?1 AND commerce_id=?2)",
        rusqlite::params![credit_id, sess.commerce_id], |r| r.get(0),
    )?;
    if !belongs { return Err(KomersaError::NotFound); }

    let rows = stmt.query_map([&credit_id], |row| {
        Ok(CreditPaymentRow {
            id: row.get(0)?, amount: row.get(1)?,
            mode_label: row.get(2)?, paid_by: row.get(3)?, paid_at: row.get(4)?,
        })
    })?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn add_credit_payment(
    db: State<Database>,
    session: State<SessionState>,
    input: AddCreditPaymentInput,
) -> KomersaResult<()> {
    if input.amount <= 0.0 {
        return Err(KomersaError::Validation("Le montant doit être supérieur à 0.".into()));
    }
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    // Encaisser une créance = mouvement d'argent : exiger le droit d'enregistrer une vente.
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::CreerVente)?;

    let (remaining, commerce_id): (f64, String) = conn.query_row(
        "SELECT remaining, commerce_id FROM customer_credits WHERE id=?1",
        [&input.credit_id], |r| Ok((r.get(0)?, r.get(1)?)),
    ).map_err(|_| KomersaError::NotFound)?;

    if commerce_id != sess.commerce_id { return Err(KomersaError::NotFound); }
    if input.amount > remaining + 0.01 {
        return Err(KomersaError::Validation(format!(
            "Le paiement dépasse le solde restant ({} GNF).", remaining as i64
        )));
    }

    let now = chrono::Utc::now().to_rfc3339();
    let payment_id = format!("CRP-{}", Uuid::new_v4().as_simple());
    let new_paid: f64 = conn.query_row(
        "SELECT paid FROM customer_credits WHERE id=?1", [&input.credit_id], |r| r.get::<_, f64>(0),
    )? + input.amount;
    let new_remaining = (remaining - input.amount).max(0.0);
    let new_status = if new_remaining <= 0.01 { "Soldé" } else { "Partiel" };

    let tx = conn.unchecked_transaction()?;
    conn.execute(
        "INSERT INTO customer_credit_payments
           (id, credit_id, amount, mode_label, treasury_account_id, paid_by, paid_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7)",
        rusqlite::params![
            payment_id, input.credit_id, input.amount, input.mode_label,
            input.treasury_account_id, sess.account_id, now,
        ],
    )?;
    conn.execute(
        "UPDATE customer_credits SET paid=?2, remaining=?3, status=?4, updated_at=?5 WHERE id=?1",
        rusqlite::params![input.credit_id, new_paid, new_remaining, new_status, now],
    )?;

    // Encaissement : créditer le compte de trésorerie choisi (l'argent entre).
    if let Some(ref account_id) = input.treasury_account_id {
        conn.execute(
            "UPDATE treasury_accounts SET balance=balance+?2, updated_at=?3 WHERE id=?1 AND commerce_id=?4",
            rusqlite::params![account_id, input.amount.round(), now, sess.commerce_id],
        )?;
        crate::commands::treasury::record_movement(
            &conn, &sess.commerce_id, account_id, input.amount.round(), "credit_payment",
            "Encaissement crédit client", &now,
        )?;
    }

    // Mettre à jour le solde de la vente liée si elle est en mode crédit
    conn.execute(
        "UPDATE sales SET received=received+?2, remaining=MAX(0,remaining-?2), updated_at=?3
         WHERE id=(SELECT sale_id FROM customer_credits WHERE id=?1)",
        rusqlite::params![input.credit_id, input.amount, now],
    )?;
    tx.commit()?;
    Ok(())
}
