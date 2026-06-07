use tauri::State;

use crate::db::Database;
use crate::error::{KomersaError, KomersaResult};
use crate::permissions::{self, Permission};
use crate::session::{ActiveSession, SessionState};

// Système de photos — comme la maquette : l'image est redimensionnée côté client
// (canvas → JPEG ≤480px) en data URL, puis stockée telle quelle dans la colonne
// photo_path de l'entité. Pas de dialogue natif, pas de fichier sur disque.

/// Table SQL correspondant au type d'entité.
fn table_for(entity_type: &str) -> Option<&'static str> {
    match entity_type {
        "product" => Some("products"),
        "client" => Some("clients"),
        "supplier" => Some("suppliers"),
        "account" => Some("accounts"),
        "treasury" => Some("treasury_accounts"),
        _ => None,
    }
}

/// Vérifie que l'entité appartient bien au commerce actif (sécurité).
fn verify_entity(
    conn: &rusqlite::Connection,
    table: &str,
    entity_id: &str,
    commerce_id: &str,
) -> KomersaResult<()> {
    let ok: bool = if table == "accounts" {
        conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM memberships WHERE account_id=?1 AND commerce_id=?2)",
            rusqlite::params![entity_id, commerce_id], |r| r.get(0),
        )?
    } else {
        let sql = format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE id=?1 AND commerce_id=?2)");
        conn.query_row(&sql, rusqlite::params![entity_id, commerce_id], |r| r.get(0))?
    };
    if ok { Ok(()) } else { Err(KomersaError::NotFound) }
}

/// Droit d'écriture sur la photo selon le type d'entité.
/// Sa propre photo de profil reste modifiable ; celle d'un autre compte exige GererUtilisateurs.
fn check_photo_write(
    conn: &rusqlite::Connection,
    sess: &ActiveSession,
    entity_type: &str,
    entity_id: &str,
) -> KomersaResult<()> {
    match entity_type {
        "product" | "supplier" =>
            permissions::check(conn, &sess.membership_id, &sess.role, Permission::GererProduits),
        "treasury" =>
            permissions::check(conn, &sess.membership_id, &sess.role, Permission::TransfertsTresorerie),
        "client" =>
            permissions::check(conn, &sess.membership_id, &sess.role, Permission::CreerVente),
        "account" => {
            if entity_id == sess.account_id {
                Ok(())
            } else {
                permissions::check(conn, &sess.membership_id, &sess.role, Permission::GererUtilisateurs)
            }
        }
        _ => Err(KomersaError::Validation("Type d'entité invalide.".into())),
    }
}

/// Enregistre (ou remplace) la photo d'une entité. `data_url` = image déjà
/// redimensionnée côté client (data:image/jpeg;base64,...).
#[tauri::command]
pub fn set_photo(
    db: State<Database>,
    session: State<SessionState>,
    entity_type: String,
    entity_id: String,
    data_url: String,
) -> KomersaResult<()> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let table = table_for(&entity_type)
        .ok_or_else(|| KomersaError::Validation("Type d'entité invalide.".into()))?;

    // Types matriciels uniquement : on rejette le SVG (peut embarquer du script).
    let allowed = ["data:image/jpeg", "data:image/jpg", "data:image/png", "data:image/webp"];
    if !allowed.iter().any(|p| data_url.starts_with(p)) {
        return Err(KomersaError::Validation("Format d'image non autorisé (JPEG, PNG ou WebP).".into()));
    }
    // Garde-fou taille (≈ 1,5 Mo de base64 max)
    if data_url.len() > 1_500_000 {
        return Err(KomersaError::Validation("Image trop volumineuse.".into()));
    }

    let conn = db.0.lock().unwrap();
    verify_entity(&conn, table, &entity_id, &sess.commerce_id)?;
    check_photo_write(&conn, &sess, &entity_type, &entity_id)?;

    if table == "accounts" {
        conn.execute("UPDATE accounts SET photo_path=?2 WHERE id=?1",
            rusqlite::params![entity_id, data_url])?;
    } else {
        let sql = format!("UPDATE {table} SET photo_path=?2 WHERE id=?1 AND commerce_id=?3");
        conn.execute(&sql, rusqlite::params![entity_id, data_url, sess.commerce_id])?;
    }
    Ok(())
}

/// Renvoie la photo (data URL) d'une entité, ou None.
#[tauri::command]
pub fn get_photo(
    db: State<Database>,
    session: State<SessionState>,
    entity_type: String,
    entity_id: String,
) -> KomersaResult<Option<String>> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let table = table_for(&entity_type)
        .ok_or_else(|| KomersaError::Validation("Type d'entité invalide.".into()))?;
    let conn = db.0.lock().unwrap();

    let val: Option<String> = if table == "accounts" {
        conn.query_row("SELECT photo_path FROM accounts WHERE id=?1", [&entity_id], |r| r.get(0)).ok().flatten()
    } else {
        let sql = format!("SELECT photo_path FROM {table} WHERE id=?1 AND commerce_id=?2");
        conn.query_row(&sql, rusqlite::params![entity_id, sess.commerce_id], |r| r.get(0)).ok().flatten()
    };
    Ok(val.filter(|s| !s.is_empty()))
}

/// Supprime la photo d'une entité.
#[tauri::command]
pub fn delete_photo(
    db: State<Database>,
    session: State<SessionState>,
    entity_type: String,
    entity_id: String,
) -> KomersaResult<()> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let table = table_for(&entity_type)
        .ok_or_else(|| KomersaError::Validation("Type d'entité invalide.".into()))?;
    let conn = db.0.lock().unwrap();
    verify_entity(&conn, table, &entity_id, &sess.commerce_id)?;
    check_photo_write(&conn, &sess, &entity_type, &entity_id)?;

    if table == "accounts" {
        conn.execute("UPDATE accounts SET photo_path=NULL WHERE id=?1", [&entity_id])?;
    } else {
        let sql = format!("UPDATE {table} SET photo_path=NULL WHERE id=?1 AND commerce_id=?2");
        conn.execute(&sql, rusqlite::params![entity_id, sess.commerce_id])?;
    }
    Ok(())
}
