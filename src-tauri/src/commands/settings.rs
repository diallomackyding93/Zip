use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;

use crate::db::Database;
use crate::error::{KomersaError, KomersaResult};
use crate::permissions::{self, Permission};
use crate::session::SessionState;

// ---------------------------------------------------------------------------
// Helper public : lire un paramètre booléen (utilisé par d'autres modules)
// ---------------------------------------------------------------------------
pub fn get_bool(
    conn: &rusqlite::Connection,
    commerce_id: &str,
    key: &str,
    default: bool,
) -> bool {
    let val: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key=?1 AND commerce_id=?2",
            rusqlite::params![key, commerce_id],
            |r| r.get(0),
        )
        .ok();
    match val.as_deref() {
        Some("true") | Some("1") => true,
        Some("false") | Some("0") => false,
        _ => default,
    }
}

// ---------------------------------------------------------------------------
// Structs
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct CommerceInfo {
    pub id: String,
    pub name: String,
    pub short_name: Option<String>,
    pub commerce_type: Option<String>,
    pub city: Option<String>,
    pub currency: String,
    pub color: String,
}

#[derive(Deserialize)]
pub struct UpdateCommerceInput {
    pub name: String,
    pub short_name: Option<String>,
    pub commerce_type: Option<String>,
    pub city: Option<String>,
    pub currency: String,
}

#[derive(Deserialize)]
pub struct SetSettingInput {
    pub key: String,
    pub value: String,
}

// ---------------------------------------------------------------------------
// Commandes
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_commerce_info(
    db: State<Database>,
    session: State<SessionState>,
) -> KomersaResult<CommerceInfo> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();

    conn.query_row(
        "SELECT id, name, short_name, type, city, currency, color
         FROM commerces WHERE id=?1",
        [&sess.commerce_id],
        |row| Ok(CommerceInfo {
            id: row.get(0)?, name: row.get(1)?, short_name: row.get(2)?,
            commerce_type: row.get(3)?, city: row.get(4)?,
            currency: row.get(5)?, color: row.get(6)?,
        }),
    ).map_err(|_| KomersaError::NotFound)
}

#[tauri::command]
pub fn update_commerce_info(
    db: State<Database>,
    session: State<SessionState>,
    input: UpdateCommerceInput,
) -> KomersaResult<()> {
    if input.name.trim().is_empty() {
        return Err(KomersaError::Validation("Le nom du commerce est requis.".into()));
    }
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::ModifierParametres)?;

    conn.execute(
        "UPDATE commerces SET name=?2, short_name=?3, type=?4, city=?5, currency=?6 WHERE id=?1",
        rusqlite::params![
            sess.commerce_id, input.name.trim(), input.short_name.as_deref(),
            input.commerce_type.as_deref(), input.city.as_deref(), input.currency.trim(),
        ],
    )?;
    Ok(())
}

#[tauri::command]
pub fn get_settings(
    db: State<Database>,
    session: State<SessionState>,
) -> KomersaResult<HashMap<String, String>> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();

    let mut stmt = conn.prepare(
        "SELECT key, value FROM settings WHERE commerce_id=?1",
    )?;
    let rows = stmt.query_map([&sess.commerce_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?.unwrap_or_default()))
    })?;

    let mut map = HashMap::new();
    for r in rows.flatten() { map.insert(r.0, r.1); }
    Ok(map)
}

#[tauri::command]
pub fn set_setting(
    db: State<Database>,
    session: State<SessionState>,
    input: SetSettingInput,
) -> KomersaResult<()> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::ModifierParametres)?;

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO settings (key, commerce_id, value, updated_at)
         VALUES (?1,?2,?3,?4)
         ON CONFLICT(key, commerce_id) DO UPDATE SET value=?3, updated_at=?4",
        rusqlite::params![input.key, sess.commerce_id, input.value, now],
    )?;
    Ok(())
}
