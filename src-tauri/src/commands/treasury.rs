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
pub struct TreasuryAccountRow {
    pub id: String,
    pub title: String,
    pub subtitle: Option<String>,
    pub account_type: String,
    pub balance: f64,
    pub active: bool,
    pub as_payment: bool,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TreasurySummary {
    pub net_treasury: f64,
    pub liquid_assets: f64,
    pub receivables: f64,
    pub payables: f64,
    // Circulation des espèces
    pub open_sessions_count: i64,
    pub open_sessions_amount: f64,
    pub pending_handovers_count: i64,
    pub pending_handovers_amount: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct TransferRow {
    pub id: String,
    pub title: Option<String>,
    pub from_account_id: String,
    pub from_account_title: String,
    pub to_account_id: String,
    pub to_account_title: String,
    pub amount: f64,
    pub created_by: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct HandoverRow {
    pub id: String,
    pub cash_session_id: String,
    pub session_ref: String,
    pub seller_name: String,
    pub counted: f64,
    pub expected: f64,
    pub gap: f64,
    pub status: String,
    pub created_at: String,
}

// ---------------------------------------------------------------------------
// Structs d'entrée
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct CreateAccountInput {
    pub title: String,
    pub subtitle: Option<String>,
    pub account_type: String,
    pub balance: f64,
    pub as_payment: bool,
    pub note: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateAccountInput {
    pub id: String,
    pub title: String,
    pub subtitle: Option<String>,
    pub account_type: String,
    pub note: Option<String>,
}

#[derive(Deserialize)]
pub struct CreateTransferInput {
    pub title: Option<String>,
    pub from_account_id: String,
    pub to_account_id: String,
    pub amount: f64,
}

#[derive(Deserialize)]
pub struct ValidateHandoverInput {
    pub handover_id: String,
    pub cash_account_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AccountMovementRow {
    pub id: String,
    pub amount: f64,
    pub kind: String,
    pub label: Option<String>,
    pub created_at: String,
}

// ---------------------------------------------------------------------------
// Garde-fou : un compte ne peut jamais passer en négatif sur une sortie.
// À appeler AVANT tout débit. (Compte introuvable → laissé passer ; l'UPDATE
// filtré par commerce ne fera alors rien.)
// ---------------------------------------------------------------------------
pub fn ensure_balance(
    conn: &rusqlite::Connection,
    commerce_id: &str,
    account_id: &str,
    amount: f64,
) -> KomersaResult<()> {
    let bal: Option<f64> = conn.query_row(
        "SELECT balance FROM treasury_accounts WHERE id=?1 AND commerce_id=?2 AND deleted=0",
        rusqlite::params![account_id, commerce_id], |r| r.get(0),
    ).ok();
    match bal {
        // Compte introuvable / supprimé / autre commerce : on refuse l'opération
        // (sinon le débit ne s'appliquerait pas mais l'écriture serait quand même enregistrée).
        None => Err(KomersaError::Validation(
            "Compte de trésorerie introuvable ou supprimé.".into(),
        )),
        Some(b) if b + 0.5 < amount => Err(KomersaError::Validation(format!(
            "Solde insuffisant sur ce compte : {} GNF disponible, {} GNF demandé.",
            b.round() as i64, amount.round() as i64,
        ))),
        Some(_) => Ok(()),
    }
}

// ---------------------------------------------------------------------------
// Registre : écrire une ligne de mouvement pour un compte (appelé partout où
// le solde d'un compte change). amount > 0 = entrée, < 0 = sortie.
// ---------------------------------------------------------------------------
pub fn record_movement(
    conn: &rusqlite::Connection,
    commerce_id: &str,
    account_id: &str,
    amount: f64,
    kind: &str,
    label: &str,
    now: &str,
) -> KomersaResult<()> {
    conn.execute(
        "INSERT INTO treasury_movements (id, commerce_id, account_id, amount, kind, label, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7)",
        rusqlite::params![
            format!("TMV-{}", Uuid::new_v4().as_simple()),
            commerce_id, account_id, amount, kind, label, now,
        ],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Commandes
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_account_movements(
    db: State<Database>,
    session: State<SessionState>,
    account_id: String,
    from: Option<String>,   // 'YYYY-MM-DD' inclus
    to: Option<String>,     // 'YYYY-MM-DD' inclus
    offset: i64,
    limit: i64,
) -> KomersaResult<Vec<AccountMovementRow>> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::VoirTresorerie)?;

    let lim = limit.clamp(1, 10000);
    let off = offset.max(0);
    let mut stmt = conn.prepare(
        "SELECT id, amount, kind, label, created_at FROM treasury_movements
         WHERE account_id=?1 AND commerce_id=?2
           AND (?3 IS NULL OR date(created_at) >= date(?3))
           AND (?4 IS NULL OR date(created_at) <= date(?4))
         ORDER BY created_at DESC, ROWID DESC
         LIMIT ?5 OFFSET ?6",
    )?;
    let rows = stmt.query_map(
        rusqlite::params![account_id, sess.commerce_id, from, to, lim, off],
        |row| Ok(AccountMovementRow {
            id: row.get(0)?, amount: row.get(1)?, kind: row.get(2)?,
            label: row.get(3)?, created_at: row.get(4)?,
        }),
    )?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn get_treasury_summary(
    db: State<Database>,
    session: State<SessionState>,
) -> KomersaResult<TreasurySummary> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::VoirTresorerie)?;

    let net_treasury: f64 = conn.query_row(
        "SELECT COALESCE(SUM(balance),0) FROM treasury_accounts WHERE commerce_id=?1 AND active=1",
        [&sess.commerce_id], |r| r.get(0),
    )?;

    let liquid_assets: f64 = conn.query_row(
        "SELECT COALESCE(SUM(balance),0) FROM treasury_accounts
         WHERE commerce_id=?1 AND active=1 AND type IN ('cash','momo')",
        [&sess.commerce_id], |r| r.get(0),
    )?;

    let receivables: f64 = conn.query_row(
        "SELECT COALESCE(SUM(remaining),0) FROM customer_credits
         WHERE commerce_id=?1 AND status != 'Soldé'",
        [&sess.commerce_id], |r| r.get(0),
    )?;

    let payables: f64 = conn.query_row(
        "SELECT COALESCE(SUM(remaining),0) FROM supplier_debts
         WHERE commerce_id=?1 AND status != 'Soldée'",
        [&sess.commerce_id], |r| r.get(0),
    )?;

    // Circulation : caisses ouvertes (montant = fond initial, proxy faute d'historique temps réel)
    let (open_sessions_count, open_sessions_amount): (i64, f64) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(initial_fund),0) FROM cash_sessions
         WHERE commerce_id=?1 AND status='open'",
        [&sess.commerce_id], |r| Ok((r.get(0)?, r.get(1)?)),
    )?;

    // Remises en attente de validation
    let (pending_handovers_count, pending_handovers_amount): (i64, f64) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(h.counted),0) FROM cash_handovers h
         JOIN cash_sessions cs ON cs.id = h.cash_session_id
         WHERE cs.commerce_id=?1 AND h.status='pending'",
        [&sess.commerce_id], |r| Ok((r.get(0)?, r.get(1)?)),
    )?;

    Ok(TreasurySummary {
        net_treasury, liquid_assets, receivables, payables,
        open_sessions_count, open_sessions_amount,
        pending_handovers_count, pending_handovers_amount,
    })
}

#[tauri::command]
pub fn list_treasury_accounts(
    db: State<Database>,
    session: State<SessionState>,
) -> KomersaResult<Vec<TreasuryAccountRow>> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::VoirTresorerie)?;

    let mut stmt = conn.prepare(
        "SELECT id, title, subtitle, type, balance, active, as_payment, note
         FROM treasury_accounts WHERE commerce_id=?1 AND deleted=0 ORDER BY type, title COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([&sess.commerce_id], |row| {
        Ok(TreasuryAccountRow {
            id: row.get(0)?,
            title: row.get(1)?,
            subtitle: row.get(2)?,
            account_type: row.get(3)?,
            balance: row.get(4)?,
            active: row.get::<_, i32>(5)? != 0,
            as_payment: row.get::<_, i32>(6)? != 0,
            note: row.get(7)?,
        })
    })?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn create_treasury_account(
    db: State<Database>,
    session: State<SessionState>,
    input: CreateAccountInput,
) -> KomersaResult<TreasuryAccountRow> {
    if input.title.trim().is_empty() {
        return Err(KomersaError::Validation("Le nom du compte est requis.".into()));
    }
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::TransfertsTresorerie)?;

    let id = format!("TRY-{}", Uuid::new_v4().as_simple());
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO treasury_accounts
           (id, commerce_id, title, subtitle, type, balance, active, as_payment, note, created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,1,?7,?8,?9,?9)",
        rusqlite::params![
            id, sess.commerce_id, input.title.trim(), input.subtitle.as_deref(),
            input.account_type, input.balance, input.as_payment as i32, input.note.as_deref(), now,
        ],
    )?;

    // Solde d'ouverture : inscrire une ligne au registre pour que le relevé reconcilie.
    if input.balance.abs() >= 0.5 {
        record_movement(&conn, &sess.commerce_id, &id, input.balance.round(), "opening", "Solde d'ouverture", &now)?;
    }
    Ok(TreasuryAccountRow {
        id, title: input.title.trim().into(), subtitle: input.subtitle,
        account_type: input.account_type, balance: input.balance,
        active: true, as_payment: input.as_payment, note: input.note,
    })
}

#[tauri::command]
pub fn update_treasury_account(
    db: State<Database>,
    session: State<SessionState>,
    input: UpdateAccountInput,
) -> KomersaResult<TreasuryAccountRow> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::TransfertsTresorerie)?;

    let now = chrono::Utc::now().to_rfc3339();
    let affected = conn.execute(
        "UPDATE treasury_accounts SET title=?2, subtitle=?3, type=?4, note=?5, updated_at=?6
         WHERE id=?1 AND commerce_id=?7",
        rusqlite::params![
            input.id, input.title.trim(), input.subtitle.as_deref(),
            input.account_type, input.note.as_deref(), now, sess.commerce_id,
        ],
    )?;
    if affected == 0 { return Err(KomersaError::NotFound); }

    let (balance, active, as_payment): (f64, i32, i32) = conn.query_row(
        "SELECT balance, active, as_payment FROM treasury_accounts WHERE id=?1",
        [&input.id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    Ok(TreasuryAccountRow {
        id: input.id, title: input.title.trim().into(), subtitle: input.subtitle,
        account_type: input.account_type, balance, active: active != 0,
        as_payment: as_payment != 0, note: input.note,
    })
}

#[tauri::command]
pub fn toggle_as_payment(
    db: State<Database>,
    session: State<SessionState>,
    account_id: String,
) -> KomersaResult<bool> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::TransfertsTresorerie)?;

    let current: i32 = conn.query_row(
        "SELECT as_payment FROM treasury_accounts WHERE id=?1 AND commerce_id=?2",
        rusqlite::params![account_id, sess.commerce_id], |r| r.get(0),
    ).map_err(|_| KomersaError::NotFound)?;

    let new_val = if current == 0 { 1 } else { 0 };
    conn.execute(
        "UPDATE treasury_accounts SET as_payment=?2 WHERE id=?1",
        rusqlite::params![account_id, new_val],
    )?;
    Ok(new_val != 0)
}

#[tauri::command]
pub fn toggle_account_active(
    db: State<Database>,
    session: State<SessionState>,
    account_id: String,
) -> KomersaResult<bool> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::TransfertsTresorerie)?;

    let current: i32 = conn.query_row(
        "SELECT active FROM treasury_accounts WHERE id=?1 AND commerce_id=?2",
        rusqlite::params![account_id, sess.commerce_id], |r| r.get(0),
    ).map_err(|_| KomersaError::NotFound)?;
    let new_val = if current == 0 { 1 } else { 0 };
    conn.execute(
        "UPDATE treasury_accounts SET active=?2 WHERE id=?1",
        rusqlite::params![account_id, new_val],
    )?;
    Ok(new_val != 0)
}

/// Supprime un compte (uniquement si solde nul). Si le compte a un historique
/// (transferts, mouvements, dépenses, paiements), il est masqué (deleted=1) pour
/// préserver la lisibilité de l'historique ; sinon il est réellement supprimé.
#[tauri::command]
pub fn delete_treasury_account(
    db: State<Database>,
    session: State<SessionState>,
    account_id: String,
) -> KomersaResult<()> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::TransfertsTresorerie)?;

    let balance: f64 = conn.query_row(
        "SELECT balance FROM treasury_accounts WHERE id=?1 AND commerce_id=?2 AND deleted=0",
        rusqlite::params![account_id, sess.commerce_id], |r| r.get(0),
    ).map_err(|_| KomersaError::NotFound)?;

    if balance.abs() >= 0.01 {
        return Err(KomersaError::Validation(
            "Impossible de supprimer un compte qui contient encore un solde. Videz-le d'abord (transfert).".into(),
        ));
    }

    // Le compte est-il référencé dans un historique ?
    let referenced: bool = conn.query_row(
        "SELECT
           EXISTS(SELECT 1 FROM treasury_transfers WHERE from_account_id=?1 OR to_account_id=?1)
           OR EXISTS(SELECT 1 FROM cash_movements WHERE treasury_account_id=?1)
           OR EXISTS(SELECT 1 FROM expenses WHERE treasury_account_id=?1)
           OR EXISTS(SELECT 1 FROM sale_payments WHERE treasury_account_id=?1)
           OR EXISTS(SELECT 1 FROM customer_credit_payments WHERE treasury_account_id=?1)
           OR EXISTS(SELECT 1 FROM supplier_debt_payments WHERE treasury_account_id=?1)",
        [&account_id],
        |r| r.get(0),
    )?;

    if referenced {
        // Conserver la ligne pour l'historique, mais la retirer de l'interface.
        conn.execute(
            "UPDATE treasury_accounts SET deleted=1, active=0 WHERE id=?1 AND commerce_id=?2",
            rusqlite::params![account_id, sess.commerce_id],
        )?;
    } else {
        // Aucun historique : suppression réelle.
        conn.execute(
            "DELETE FROM treasury_accounts WHERE id=?1 AND commerce_id=?2",
            rusqlite::params![account_id, sess.commerce_id],
        )?;
    }
    Ok(())
}

#[tauri::command]
pub fn create_transfer(
    db: State<Database>,
    session: State<SessionState>,
    input: CreateTransferInput,
) -> KomersaResult<TransferRow> {
    if input.amount <= 0.0 {
        return Err(KomersaError::Validation("Le montant doit être supérieur à 0.".into()));
    }
    if input.from_account_id == input.to_account_id {
        return Err(KomersaError::Validation("Les deux comptes doivent être différents.".into()));
    }

    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::TransfertsTresorerie)?;

    // Vérifier solde suffisant (compte source rattaché au commerce)
    let from_balance: f64 = conn.query_row(
        "SELECT balance FROM treasury_accounts WHERE id=?1 AND commerce_id=?2 AND deleted=0",
        rusqlite::params![input.from_account_id, sess.commerce_id], |r| r.get(0),
    ).map_err(|_| KomersaError::Validation("Compte source introuvable.".into()))?;

    // Le compte destination doit exister et appartenir au commerce (sinon l'argent disparaît).
    let to_exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM treasury_accounts WHERE id=?1 AND commerce_id=?2 AND deleted=0)",
        rusqlite::params![input.to_account_id, sess.commerce_id], |r| r.get(0),
    )?;
    if !to_exists {
        return Err(KomersaError::Validation("Compte destination introuvable.".into()));
    }

    if from_balance < input.amount {
        return Err(KomersaError::Validation(format!(
            "Solde insuffisant ({} GNF disponible).", from_balance as i64
        )));
    }

    let now = chrono::Utc::now().to_rfc3339();
    let id = format!("TRF-{}", Uuid::new_v4().as_simple());

    // Noms des comptes (pour des libellés clairs « vers / depuis »).
    let from_title: String = conn.query_row(
        "SELECT title FROM treasury_accounts WHERE id=?1", [&input.from_account_id], |r| r.get(0),
    ).unwrap_or_default();
    let to_title: String = conn.query_row(
        "SELECT title FROM treasury_accounts WHERE id=?1", [&input.to_account_id], |r| r.get(0),
    ).unwrap_or_default();
    // Libellé = chemin complet « source → destination », identique sur les deux comptes.
    let note = input.title.as_deref().filter(|t| !t.is_empty());
    let path = format!("{from_title} → {to_title}");
    let label = match note {
        Some(t) => format!("{t} · {path}"),
        None => path,
    };

    // Transaction : débit + crédit + traçabilité indissociables.
    let tx = conn.unchecked_transaction()?;
    conn.execute(
        "UPDATE treasury_accounts SET balance=balance-?2, updated_at=?3 WHERE id=?1 AND commerce_id=?4",
        rusqlite::params![input.from_account_id, input.amount, now, sess.commerce_id],
    )?;
    conn.execute(
        "UPDATE treasury_accounts SET balance=balance+?2, updated_at=?3 WHERE id=?1 AND commerce_id=?4",
        rusqlite::params![input.to_account_id, input.amount, now, sess.commerce_id],
    )?;

    record_movement(&conn, &sess.commerce_id, &input.from_account_id, -input.amount, "transfer_out", &label, &now)?;
    record_movement(&conn, &sess.commerce_id, &input.to_account_id, input.amount, "transfer_in", &label, &now)?;

    conn.execute(
        "INSERT INTO treasury_transfers
           (id, commerce_id, title, from_account_id, to_account_id, amount, created_by, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        rusqlite::params![
            id, sess.commerce_id, input.title.as_deref(),
            input.from_account_id, input.to_account_id,
            input.amount, sess.account_id, now,
        ],
    )?;

    crate::commands::audit::record_audit(&conn, &sess.commerce_id, &sess.account_id, &sess.account_name,
        "treasury_transfer", &format!("Transfert {from_title} → {to_title}"), Some(&id), Some(input.amount));

    tx.commit()?;

    let seller_name: String = conn.query_row(
        "SELECT name FROM accounts WHERE id=?1", [&sess.account_id], |r| r.get(0),
    ).ok().unwrap_or_default();

    Ok(TransferRow {
        id, title: input.title,
        from_account_id: input.from_account_id, from_account_title: from_title,
        to_account_id: input.to_account_id, to_account_title: to_title,
        amount: input.amount, created_by: Some(seller_name), created_at: now,
    })
}

#[tauri::command]
pub fn list_transfers(
    db: State<Database>,
    session: State<SessionState>,
) -> KomersaResult<Vec<TransferRow>> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::VoirTresorerie)?;

    let mut stmt = conn.prepare(
        "SELECT t.id, t.title, t.from_account_id, fa.title, t.to_account_id, ta.title,
                t.amount, a.name, t.created_at
         FROM treasury_transfers t
         LEFT JOIN treasury_accounts fa ON fa.id = t.from_account_id
         LEFT JOIN treasury_accounts ta ON ta.id = t.to_account_id
         LEFT JOIN accounts a ON a.id = t.created_by
         WHERE t.commerce_id=?1
         ORDER BY t.created_at DESC LIMIT 100",
    )?;
    let rows = stmt.query_map([&sess.commerce_id], |row| {
        Ok(TransferRow {
            id: row.get(0)?,
            title: row.get(1)?,
            from_account_id: row.get(2)?,
            from_account_title: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
            to_account_id: row.get(4)?,
            to_account_title: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
            amount: row.get(6)?,
            created_by: row.get(7)?,
            created_at: row.get(8)?,
        })
    })?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn list_pending_handovers(
    db: State<Database>,
    session: State<SessionState>,
) -> KomersaResult<Vec<HandoverRow>> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::VoirTresorerie)?;

    let mut stmt = conn.prepare(
        "SELECT h.id, h.cash_session_id, cs.ref, COALESCE(a.name,''),
                h.counted, h.expected, h.gap, h.status, h.created_at
         FROM cash_handovers h
         JOIN cash_sessions cs ON cs.id = h.cash_session_id
         LEFT JOIN accounts a ON a.id = h.seller_id
         WHERE cs.commerce_id=?1 AND h.status='pending'
         ORDER BY h.created_at DESC",
    )?;
    let rows = stmt.query_map([&sess.commerce_id], |row| {
        Ok(HandoverRow {
            id: row.get(0)?,
            cash_session_id: row.get(1)?,
            session_ref: row.get(2)?,
            seller_name: row.get(3)?,
            counted: row.get(4)?,
            expected: row.get(5)?,
            gap: row.get(6)?,
            status: row.get(7)?,
            created_at: row.get(8)?,
        })
    })?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn validate_handover(
    db: State<Database>,
    session: State<SessionState>,
    input: ValidateHandoverInput,
) -> KomersaResult<()> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::TransfertsTresorerie)?;

    // Montant compté de la remise (déposé en totalité, fond initial inclus).
    let counted: f64 = conn.query_row(
        "SELECT h.counted FROM cash_handovers h
         JOIN cash_sessions cs ON cs.id = h.cash_session_id
         WHERE h.id=?1 AND cs.commerce_id=?2 AND h.status='pending'",
        rusqlite::params![input.handover_id, sess.commerce_id], |r| r.get(0),
    ).map_err(|_| KomersaError::NotFound)?;

    // Le compte de dépôt doit appartenir au commerce.
    let account_ok: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM treasury_accounts WHERE id=?1 AND commerce_id=?2 AND deleted=0)",
        rusqlite::params![input.cash_account_id, sess.commerce_id], |r| r.get(0),
    )?;
    if !account_ok {
        return Err(KomersaError::Validation("Compte de dépôt introuvable.".into()));
    }

    // Dépôt = tout le compté (fond initial inclus).
    let deposit = counted.max(0.0).round();
    let now = chrono::Utc::now().to_rfc3339();

    // Transaction : crédit + clôture de la remise indissociables (pas de double validation).
    let tx = conn.unchecked_transaction()?;
    conn.execute(
        "UPDATE treasury_accounts SET balance=balance+?2, updated_at=?3 WHERE id=?1 AND commerce_id=?4",
        rusqlite::params![input.cash_account_id, deposit, now, sess.commerce_id],
    )?;
    record_movement(&conn, &sess.commerce_id, &input.cash_account_id, deposit, "cash_deposit", "Remise de caisse", &now)?;
    conn.execute(
        "UPDATE cash_handovers SET status='validated', validated_by=?2, validated_at=?3
         WHERE id=?1 AND status='pending'",
        rusqlite::params![input.handover_id, sess.account_id, now],
    )?;

    crate::commands::audit::record_audit(&conn, &sess.commerce_id, &sess.account_id, &sess.account_name,
        "handover_validate", "Validation d'une remise de caisse", Some(&input.handover_id), Some(deposit));

    tx.commit()?;
    Ok(())
}
