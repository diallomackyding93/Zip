use thiserror::Error;

#[derive(Debug, Error)]
pub enum KomersaError {
    #[error("Base de données : {0}")]
    Database(#[from] rusqlite::Error),

    #[error("Hachage du mot de passe : {0}")]
    Hash(String),

    #[error("Authentification : {0}")]
    Auth(String),

    #[error("Permission refusée : {0}")]
    PermissionDenied(String),

    #[error("Ressource non trouvée")]
    NotFound,

    #[error("Validation : {0}")]
    Validation(String),

    #[error("Session inactive — veuillez vous reconnecter")]
    NoSession,

    #[error("Erreur interne : {0}")]
    Internal(String),
}

// Tauri exige que les erreurs de commandes soient sérialisables.
impl serde::Serialize for KomersaError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type KomersaResult<T> = Result<T, KomersaError>;

impl From<argon2::password_hash::Error> for KomersaError {
    fn from(e: argon2::password_hash::Error) -> Self {
        KomersaError::Hash(e.to_string())
    }
}
