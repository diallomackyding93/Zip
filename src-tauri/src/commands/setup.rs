use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;
use argon2::{Argon2, PasswordHasher};
use argon2::password_hash::SaltString;
use rand::rngs::OsRng;

use crate::db::Database;
use crate::error::{KomersaError, KomersaResult};

#[derive(Serialize)]
pub struct SetupStatus {
    pub needs_setup: bool,
}

/// Vérifie si le wizard de premier lancement est nécessaire.
/// Retourne true si aucun commerce n'existe encore dans la base.
#[tauri::command]
pub fn get_setup_status(db: State<Database>) -> KomersaResult<SetupStatus> {
    let conn = db.0.lock().unwrap();
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM commerces",
        [],
        |row| row.get(0),
    )?;
    Ok(SetupStatus { needs_setup: count == 0 })
}

#[derive(Deserialize)]
pub struct CreateCommerceInput {
    pub name: String,
    pub short_name: Option<String>,
    pub commerce_type: Option<String>,
    pub city: Option<String>,
    pub currency: String,
    pub color: Option<String>,
    pub initials: Option<String>,
}

#[derive(Serialize)]
pub struct CommerceCreated {
    pub commerce_id: String,
}

/// Crée le commerce (tenant) lors du wizard de premier lancement.
#[tauri::command]
pub fn create_commerce(
    db: State<Database>,
    input: CreateCommerceInput,
) -> KomersaResult<CommerceCreated> {
    if input.name.trim().is_empty() {
        return Err(KomersaError::Validation("Le nom du commerce est requis.".into()));
    }
    if input.currency.trim().is_empty() {
        return Err(KomersaError::Validation("La devise est requise.".into()));
    }

    let conn = db.0.lock().unwrap();
    let already: i64 = conn.query_row("SELECT COUNT(*) FROM commerces", [], |r| r.get(0))?;
    if already > 0 {
        return Err(KomersaError::Validation(
            "Un commerce existe déjà sur cette installation.".into(),
        ));
    }

    let id = format!("COM-{}", Uuid::new_v4().as_simple());
    let color = input.color.unwrap_or_else(|| "#d2592f".into());
    let initials = input.initials.unwrap_or_else(|| {
        input.name.split_whitespace().filter_map(|w| w.chars().next()).take(2)
            .collect::<String>().to_uppercase()
    });

    conn.execute(
        "INSERT INTO commerces (id, name, short_name, type, city, currency, color, initials)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            id,
            input.name.trim(),
            input.short_name.as_deref(),
            input.commerce_type.as_deref(),
            input.city.as_deref(),
            input.currency.trim(),
            color,
            initials,
        ],
    )?;

    Ok(CommerceCreated { commerce_id: id })
}

#[derive(Deserialize)]
pub struct CreateAdminInput {
    pub commerce_id: String,
    pub name: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub password: String,
    pub pin: Option<String>,
}

#[derive(Serialize)]
pub struct AdminCreated {
    pub account_id: String,
    pub membership_id: String,
}

/// Crée le compte propriétaire lors du wizard de premier lancement.
#[tauri::command]
pub fn create_admin_account(
    db: State<Database>,
    input: CreateAdminInput,
) -> KomersaResult<AdminCreated> {
    if input.name.trim().is_empty() {
        return Err(KomersaError::Validation("Le nom est requis.".into()));
    }
    if input.phone.as_deref().map(str::trim).unwrap_or("").is_empty()
        && input.email.as_deref().map(str::trim).unwrap_or("").is_empty()
    {
        return Err(KomersaError::Validation(
            "Un téléphone ou un e-mail est requis.".into(),
        ));
    }
    if input.password.len() < 6 {
        return Err(KomersaError::Validation(
            "Le mot de passe doit comporter au moins 6 caractères.".into(),
        ));
    }
    if let Some(ref pin) = input.pin {
        if pin.len() != 4 || !pin.chars().all(|c| c.is_ascii_digit()) {
            return Err(KomersaError::Validation("Le code PIN doit être composé de 4 chiffres.".into()));
        }
    }

    let conn = db.0.lock().unwrap();

    let argon2 = Argon2::default();
    let salt = SaltString::generate(&mut OsRng);
    let password_hash = argon2
        .hash_password(input.password.as_bytes(), &salt)
        .map_err(|e| KomersaError::Hash(e.to_string()))?
        .to_string();

    let pin_hash = if let Some(ref pin) = input.pin {
        let salt2 = SaltString::generate(&mut OsRng);
        Some(
            argon2
                .hash_password(pin.as_bytes(), &salt2)
                .map_err(|e| KomersaError::Hash(e.to_string()))?
                .to_string(),
        )
    } else {
        None
    };

    let account_id = format!("USR-{}", Uuid::new_v4().as_simple());
    let membership_id = format!("MBR-{}", Uuid::new_v4().as_simple());
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO accounts (id, phone, email, name, password_hash, pin_hash, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        rusqlite::params![
            account_id,
            input.phone.as_deref().map(str::trim),
            input.email.as_deref().map(str::trim),
            input.name.trim(),
            password_hash,
            pin_hash,
            now,
        ],
    )?;

    conn.execute(
        "INSERT INTO memberships (id, account_id, commerce_id, role, mstatus, joined_at, created_at)
         VALUES (?1, ?2, ?3, 'Propriétaire', 'Actif', ?4, ?4)",
        rusqlite::params![membership_id, account_id, input.commerce_id, now],
    )?;

    Ok(AdminCreated { account_id, membership_id })
}
