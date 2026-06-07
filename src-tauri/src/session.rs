use std::sync::Mutex;
use serde::Serialize;

/// Session active d'un utilisateur connecté sur ce poste.
/// Stockée en mémoire uniquement — disparaît à la fermeture de l'app.
#[derive(Debug, Clone, Serialize)]
pub struct ActiveSession {
    pub account_id: String,
    pub membership_id: String,
    pub commerce_id: String,
    pub role: String,
    pub account_name: String,
    pub commerce_name: String,
}

/// État partagé global géré par Tauri (.manage()).
pub struct SessionState(pub Mutex<Option<ActiveSession>>);

impl Default for SessionState {
    fn default() -> Self {
        SessionState(Mutex::new(None))
    }
}

impl SessionState {
    pub fn get(&self) -> Option<ActiveSession> {
        self.0.lock().unwrap().clone()
    }

    pub fn set(&self, session: ActiveSession) {
        *self.0.lock().unwrap() = Some(session);
    }

    pub fn clear(&self) {
        *self.0.lock().unwrap() = None;
    }
}
