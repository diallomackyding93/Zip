use serde::Deserialize;
use tauri::State;
use uuid::Uuid;

use crate::db::Database;
use crate::error::{KomersaError, KomersaResult};
use crate::permissions::{self, Permission};
use crate::session::SessionState;

#[derive(Deserialize)]
pub struct CreateExpenseInput {
    pub label: String,
    pub beneficiary: Option<String>,
    pub category: Option<String>,
    pub amount: f64,
    pub mode_label: Option<String>,
    pub treasury_account_id: Option<String>,
    pub status: Option<String>,
    pub recurring: bool,
    pub note: Option<String>,
    pub expense_date: String,
}

#[derive(Deserialize)]
pub struct UpdateExpenseStatusInput {
    pub expense_id: String,
    pub status: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ExpenseRow {
    pub id: String,
    pub expense_ref: Option<String>,
    pub label: String,
    pub beneficiary: Option<String>,
    pub category: Option<String>,
    pub amount: f64,
    pub mode_label: Option<String>,
    pub treasury_account_id: Option<String>,
    pub treasury_account_title: Option<String>,
    pub status: String,
    pub recurring: bool,
    pub note: Option<String>,
    pub created_by_name: Option<String>,
    pub expense_date: String,
    pub created_at: String,
}

fn next_expense_ref(conn: &rusqlite::Connection, commerce_id: &str) -> KomersaResult<String> {
    let max: i64 = conn.query_row(
        "SELECT COALESCE(MAX(CAST(REPLACE(ref,'DEP-','') AS INTEGER)), 999)
         FROM expenses WHERE commerce_id = ?1",
        [commerce_id],
        |row| row.get(0),
    )?;
    Ok(format!("DEP-{:04}", max + 1))
}

#[tauri::command]
pub fn create_expense(
    db: State<Database>,
    session: State<SessionState>,
    input: CreateExpenseInput,
) -> KomersaResult<ExpenseRow> {
    if input.label.trim().is_empty() {
        return Err(KomersaError::Validation("Le libellé est requis.".into()));
    }
    if input.amount <= 0.0 {
        return Err(KomersaError::Validation("Le montant doit être supérieur à 0.".into()));
    }

    // ✅ FIX #1 : Forcer compte obligatoire
    if input.treasury_account_id.is_none() {
        return Err(KomersaError::Validation(
            "Le compte débité est obligatoire. Sélectionnez un compte de trésorerie.".into(),
        ));
    }

    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::GererDepenses)?;

    // Vérifier le solde
    if let Some(ref account_id) = input.treasury_account_id {
        crate::commands::treasury::ensure_balance(&conn, &sess.commerce_id, account_id, input.amount.round())?;
    }

    let id = format!("EXP-{}", Uuid::new_v4().as_simple());
    let expense_ref = next_expense_ref(&conn, &sess.commerce_id)?;
    let now = chrono::Utc::now().to_rfc3339();
    let status = input.status.as_deref().unwrap_or("Validée");

    conn.execute(
        "INSERT INTO expenses
           (id, commerce_id, ref, label, beneficiary, category, amount, mode_label,
            treasury_account_id, status, recurring, note, created_by, expense_date, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
        rusqlite::params![
            id, sess.commerce_id, expense_ref, input.label.trim(),
            input.beneficiary.as_deref(), input.category.as_deref(), input.amount,
            input.mode_label.as_deref(), input.treasury_account_id.as_deref(),
            status, input.recurring as i32, input.note.as_deref(),
            sess.account_id, input.expense_date, now,
        ],
    )?;

    // Impact trésorerie : débiter le compte
    if let Some(ref account_id) = input.treasury_account_id {
        conn.execute(
            "UPDATE treasury_accounts SET balance=balance-?2, updated_at=?3 WHERE id=?1 AND commerce_id=?4",
            rusqlite::params![account_id, input.amount.round(), now, sess.commerce_id],
        )?;
        crate::commands::treasury::record_movement(
            &conn, &sess.commerce_id, account_id, -input.amount.round(), "expense",
            &format!("Dépense : {}", input.label.trim()), &now,
        )?;
    }

    let treasury_title: Option<String> = input.treasury_account_id.as_deref().and_then(|aid| {
        conn.query_row("SELECT title FROM treasury_accounts WHERE id=?1", [aid], |r| r.get(0)).ok()
    });
    let by_name: Option<String> = conn.query_row(
        "SELECT name FROM accounts WHERE id=?1", [&sess.account_id], |r| r.get(0),
    ).ok();

    crate::commands::audit::record_audit(&conn, &sess.commerce_id, &sess.account_id, &sess.account_name,
        "expense", &format!("Dépense : {}", input.label.trim()), Some(&expense_ref), Some(input.amount));

    Ok(ExpenseRow {
        id, expense_ref: Some(expense_ref), label: input.label.trim().into(),
        beneficiary: input.beneficiary, category: input.category, amount: input.amount,
        mode_label: input.mode_label, treasury_account_id: input.treasury_account_id,
        treasury_account_title: treasury_title, status: status.into(),
        recurring: input.recurring, note: input.note, created_by_name: by_name,
        expense_date: input.expense_date, created_at: now,
    })
}

#[tauri::command]
pub fn list_expenses(
    db: State<Database>,
    session: State<SessionState>,
    from: Option<String>,
    to: Option<String>,
    offset: Option<usize>,
    limit: Option<usize>,
) -> KomersaResult<Vec<ExpenseRow>> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::GererDepenses)?;

    let lim = limit.unwrap_or(50).clamp(1, 10000);
    let off = offset.unwrap_or(0);

    let mut stmt = conn.prepare(
        "SELECT e.id, e.ref, e.label, e.beneficiary, e.category, e.amount, e.mode_label,
                e.treasury_account_id, t.title, e.status, e.recurring, e.note,
                a.name, e.expense_date, e.created_at
         FROM expenses e
         LEFT JOIN treasury_accounts t ON t.id = e.treasury_account_id
         LEFT JOIN accounts a ON a.id = e.created_by
         WHERE e.commerce_id = ?1
           AND (?2 IS NULL OR date(e.expense_date) >= date(?2))
           AND (?3 IS NULL OR date(e.expense_date) <= date(?3))
         ORDER BY e.created_at DESC
         LIMIT ?4 OFFSET ?5",
    )?;

    let rows = stmt.query_map(
        rusqlite::params![&sess.commerce_id, from, to, lim, off],
        |r| Ok(ExpenseRow {
            id: r.get(0)?,
            expense_ref: r.get(1)?,
            label: r.get(2)?,
            beneficiary: r.get(3)?,
            category: r.get(4)?,
            amount: r.get(5)?,
            mode_label: r.get(6)?,
            treasury_account_id: r.get(7)?,
            treasury_account_title: r.get(8)?,
            status: r.get(9)?,
            recurring: r.get::<_, i32>(10)? != 0,
            note: r.get(11)?,
            created_by_name: r.get(12)?,
            expense_date: r.get(13)?,
            created_at: r.get(14)?,
        }),
    )?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| KomersaError::from(e))
}
