use serde::Serialize;
use tauri::State;
use uuid::Uuid;

use crate::db::Database;
use crate::error::{KomersaError, KomersaResult};
use crate::permissions::{self, Permission};
use crate::session::SessionState;

/// Écrit une ligne dans le journal d'audit. Best-effort : une erreur d'écriture
/// du journal ne doit jamais faire échouer l'action métier (d'où le `let _`).
/// Le nom du compte est dénormalisé pour rester lisible même si le compte change.
pub fn record_audit(
    conn: &rusqlite::Connection,
    commerce_id: &str,
    account_id: &str,
    account_name: &str,
    action: &str,
    detail: &str,
    entity_ref: Option<&str>,
    amount: Option<f64>,
) {
    let id = format!("AUD-{}", Uuid::new_v4().as_simple());
    let now = chrono::Utc::now().to_rfc3339();
    let _ = conn.execute(
        "INSERT INTO audit_log
           (id, commerce_id, account_id, account_name, action, detail, entity_ref, amount, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        rusqlite::params![id, commerce_id, account_id, account_name, action, detail, entity_ref, amount, now],
    );
}

#[derive(Debug, Clone, Serialize)]
pub struct AuditRow {
    pub id: String,
    pub account_name: String,
    pub action: String,
    pub detail: String,
    pub entity_ref: Option<String>,
    pub amount: Option<f64>,
    pub created_at: String,
}

/// Lecture du journal d'audit (réservé propriétaire/admin). Filtre dates + type, paginé.
#[tauri::command]
pub fn list_audit_log(
    db: State<Database>,
    session: State<SessionState>,
    from: Option<String>,
    to: Option<String>,
    action: Option<String>,
    offset: Option<i64>,
    limit: Option<i64>,
) -> KomersaResult<Vec<AuditRow>> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::GererUtilisateurs)?;

    let lim = limit.unwrap_or(50).clamp(1, 10000);
    let off = offset.unwrap_or(0).max(0);
    let action = action.filter(|a| !a.is_empty());

    let mut stmt = conn.prepare(
        "SELECT id, account_name, action, detail, entity_ref, amount, created_at
         FROM audit_log
         WHERE commerce_id = ?1
           AND (?2 IS NULL OR date(created_at) >= date(?2))
           AND (?3 IS NULL OR date(created_at) <= date(?3))
           AND (?4 IS NULL OR action = ?4)
         ORDER BY created_at DESC
         LIMIT ?5 OFFSET ?6",
    )?;
    let rows = stmt
        .query_map(
            rusqlite::params![sess.commerce_id, from, to, action, lim, off],
            |r| Ok(AuditRow {
                id: r.get(0)?,
                account_name: r.get(1)?,
                action: r.get(2)?,
                detail: r.get(3)?,
                entity_ref: r.get(4)?,
                amount: r.get(5)?,
                created_at: r.get(6)?,
            }),
        )?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}
