use serde::Serialize;
use tauri::State;
use uuid::Uuid;

use crate::db::Database;
use crate::error::{KomersaError, KomersaResult};
use crate::permissions::{self, Permission};
use crate::session::SessionState;

// ---------------------------------------------------------------------------
// Pièces jointes génériques (justificatifs InvoiceGallery).
// owner_type ∈ { "expense", "purchase", "supplier_debt" }.
// Images redimensionnées côté client, stockées en data URL.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct AttachmentRow {
    pub id: String,
    pub data_url: String,
}

/// Table SQL + permission d'écriture associées à un type de propriétaire.
fn owner_meta(owner_type: &str) -> KomersaResult<(&'static str, Permission)> {
    match owner_type {
        "expense" => Ok(("expenses", Permission::GererDepenses)),
        "purchase" => Ok(("purchases", Permission::GererProduits)),
        "supplier_debt" => Ok(("supplier_debts", Permission::PaiementFournisseur)),
        _ => Err(KomersaError::Validation("Type de pièce jointe inconnu.".into())),
    }
}

/// Vérifie que le propriétaire existe et appartient au commerce actif.
fn owner_belongs(
    conn: &rusqlite::Connection,
    owner_type: &str,
    owner_id: &str,
    commerce_id: &str,
) -> KomersaResult<()> {
    let (table, _) = owner_meta(owner_type)?;
    let sql = format!(
        "SELECT EXISTS(SELECT 1 FROM {table} WHERE id=?1 AND commerce_id=?2)"
    );
    let ok: bool = conn.query_row(&sql, rusqlite::params![owner_id, commerce_id], |r| r.get(0))?;
    if ok { Ok(()) } else { Err(KomersaError::NotFound) }
}

#[tauri::command]
pub fn list_attachments(
    db: State<Database>,
    session: State<SessionState>,
    owner_type: String,
    owner_id: String,
) -> KomersaResult<Vec<AttachmentRow>> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    owner_belongs(&conn, &owner_type, &owner_id, &sess.commerce_id)?;

    let mut stmt = conn.prepare(
        "SELECT id, data_url FROM attachments
         WHERE commerce_id=?1 AND owner_type=?2 AND owner_id=?3 ORDER BY created_at",
    )?;
    let rows = stmt.query_map(
        rusqlite::params![sess.commerce_id, owner_type, owner_id],
        |row| Ok(AttachmentRow { id: row.get(0)?, data_url: row.get(1)? }),
    )?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn add_attachment(
    db: State<Database>,
    session: State<SessionState>,
    owner_type: String,
    owner_id: String,
    data_url: String,
) -> KomersaResult<AttachmentRow> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    let (_, perm) = owner_meta(&owner_type)?;
    permissions::check(&conn, &sess.membership_id, &sess.role, perm)?;
    owner_belongs(&conn, &owner_type, &owner_id, &sess.commerce_id)?;

    if !data_url.starts_with("data:image/") {
        return Err(KomersaError::Validation("Format d'image invalide.".into()));
    }
    if data_url.len() > 2_500_000 {
        return Err(KomersaError::Validation("Image trop volumineuse.".into()));
    }

    let id = format!("ATT-{}", Uuid::new_v4().as_simple());
    conn.execute(
        "INSERT INTO attachments (id, commerce_id, owner_type, owner_id, data_url)
         VALUES (?1,?2,?3,?4,?5)",
        rusqlite::params![id, sess.commerce_id, owner_type, owner_id, data_url],
    )?;
    Ok(AttachmentRow { id, data_url })
}

#[tauri::command]
pub fn delete_attachment(
    db: State<Database>,
    session: State<SessionState>,
    attachment_id: String,
) -> KomersaResult<()> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();

    // Récupérer le type pour vérifier la permission d'écriture adéquate.
    let owner_type: Option<String> = conn.query_row(
        "SELECT owner_type FROM attachments WHERE id=?1 AND commerce_id=?2",
        rusqlite::params![attachment_id, sess.commerce_id], |r| r.get(0),
    ).ok();
    let Some(owner_type) = owner_type else { return Err(KomersaError::NotFound); };
    let (_, perm) = owner_meta(&owner_type)?;
    permissions::check(&conn, &sess.membership_id, &sess.role, perm)?;

    let affected = conn.execute(
        "DELETE FROM attachments WHERE id=?1 AND commerce_id=?2",
        rusqlite::params![attachment_id, sess.commerce_id],
    )?;
    if affected == 0 { return Err(KomersaError::NotFound); }
    Ok(())
}
