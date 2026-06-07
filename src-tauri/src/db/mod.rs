pub mod migrations;

use rusqlite::Connection;
use std::sync::Mutex;

/// Connexion SQLite partagée (Mutex pour accès exclusif entre commandes Tauri).
/// WAL activé pour de meilleures performances en lecture concurrente.
pub struct Database(pub Mutex<Connection>);

impl Database {
    pub fn open(path: &std::path::Path) -> Result<Self, rusqlite::Error> {
        let conn = Connection::open(path)?;

        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;
             PRAGMA synchronous = NORMAL;",
        )?;

        migrations::run(&conn)?;

        Ok(Database(Mutex::new(conn)))
    }
}
