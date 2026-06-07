use std::path::PathBuf;
use serde::Serialize;
use tauri::{AppHandle, State};

use crate::db::Database;
use crate::error::{KomersaError, KomersaResult};
use crate::permissions::{self, Permission};
use crate::session::SessionState;

#[derive(Serialize)]
pub struct DbInfo {
    pub path: String,
    pub size_bytes: i64,
    pub modified: Option<String>,
}

/// Chemin du fichier de base dans le répertoire de données de l'app.
fn db_path(app: &AppHandle) -> KomersaResult<PathBuf> {
    let dir = app
        .path_resolver()
        .app_data_dir()
        .ok_or_else(|| KomersaError::Validation("Répertoire de données introuvable.".into()))?;
    Ok(dir.join("komersa.db"))
}

/// Emplacement + taille + date de la base (pour l'écran Paramètres).
#[tauri::command]
pub fn get_database_info(
    app: AppHandle,
    db: State<Database>,
    session: State<SessionState>,
) -> KomersaResult<DbInfo> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    {
        let conn = db.0.lock().unwrap();
        permissions::check(&conn, &sess.membership_id, &sess.role, Permission::ModifierParametres)?;
    }
    let p = db_path(&app)?;
    let (size_bytes, modified) = match std::fs::metadata(&p) {
        Ok(m) => {
            let modified = m.modified().ok().map(|t| {
                let dt: chrono::DateTime<chrono::Local> = t.into();
                dt.format("%d/%m/%Y %H:%M").to_string()
            });
            (m.len() as i64, modified)
        }
        Err(_) => (0, None),
    };
    Ok(DbInfo { path: p.to_string_lossy().to_string(), size_bytes, modified })
}

/// Sauvegarde : copie cohérente de la base vers `dest_path` (gère le WAL via VACUUM INTO).
#[tauri::command]
pub fn backup_database(
    db: State<Database>,
    session: State<SessionState>,
    dest_path: String,
) -> KomersaResult<()> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::ModifierParametres)?;

    // VACUUM INTO échoue si le fichier existe déjà → on l'écrase.
    if std::path::Path::new(&dest_path).exists() {
        std::fs::remove_file(&dest_path)
            .map_err(|e| KomersaError::Validation(format!("Impossible d'écraser le fichier : {e}")))?;
    }
    // Échappement SQL du chemin (guillemets simples) pour VACUUM INTO '...'.
    let escaped = dest_path.replace('\'', "''");
    conn.execute_batch(&format!("VACUUM INTO '{escaped}';"))
        .map_err(|e| KomersaError::Validation(format!("Échec de la sauvegarde : {e}")))?;

    crate::commands::audit::record_audit(&conn, &sess.commerce_id, &sess.account_id, &sess.account_name,
        "backup", "Sauvegarde de la base créée", None, None);
    Ok(())
}

/// Restauration : valide le fichier puis le dépose « en attente ». La bascule réelle se fait
/// au prochain démarrage (base fermée → remplacement sûr). Voir `db::apply_pending_restore`.
#[tauri::command]
pub fn restore_database(
    app: AppHandle,
    db: State<Database>,
    session: State<SessionState>,
    src_path: String,
) -> KomersaResult<()> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    {
        let conn = db.0.lock().unwrap();
        permissions::check(&conn, &sess.membership_id, &sess.role, Permission::ModifierParametres)?;
    }

    // Vérifier que c'est bien une base KOMERSA (ouverture lecture seule + table schema_version).
    let src = rusqlite::Connection::open_with_flags(
        &src_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|_| KomersaError::Validation("Fichier de sauvegarde illisible.".into()))?;
    let has_schema: i64 = src
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='schema_version'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    drop(src);
    if has_schema == 0 {
        return Err(KomersaError::Validation(
            "Ce fichier n'est pas une sauvegarde KOMERSA valide.".into(),
        ));
    }

    // Déposer la restauration en attente (appliquée au prochain démarrage).
    let dest = db_path(&app)?;
    let mut pending = dest.clone().into_os_string();
    pending.push(".restore-pending");
    std::fs::copy(&src_path, PathBuf::from(pending))
        .map_err(|e| KomersaError::Validation(format!("Échec de la préparation de la restauration : {e}")))?;
    Ok(())
}
