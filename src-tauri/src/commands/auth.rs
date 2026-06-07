use serde::{Deserialize, Serialize};
use tauri::State;
use argon2::{Argon2, PasswordVerifier};
use argon2::password_hash::PasswordHash;

use crate::db::Database;
use crate::error::{KomersaError, KomersaResult};
use crate::permissions;
use crate::session::{ActiveSession, SessionState};

/// Indique si l'utilisateur connecté possède une permission donnée (clé).
/// Sert à l'interface pour adapter l'affichage (la vérification métier reste
/// faite par le cœur Rust à chaque action).
#[tauri::command]
pub fn has_permission(
    db: State<Database>,
    session: State<SessionState>,
    permission: String,
) -> KomersaResult<bool> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    match permissions::from_key(&permission) {
        Some(perm) => Ok(permissions::allowed(&conn, &sess.membership_id, &sess.role, perm)),
        None => Ok(false),
    }
}

/// Liste les clés de permission accordées au connecté (pour filtrer la navigation côté UI).
#[tauri::command]
pub fn list_my_permissions(
    db: State<Database>,
    session: State<SessionState>,
) -> KomersaResult<Vec<String>> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    Ok(permissions::ALL_PERMISSIONS
        .iter()
        .filter(|p| permissions::allowed(&conn, &sess.membership_id, &sess.role, **p))
        .map(|p| p.key().to_string())
        .collect())
}

#[derive(Serialize, Clone)]
pub struct SessionInfo {
    pub account_id: String,
    pub account_name: String,
    pub membership_id: String,
    pub commerce_id: String,
    pub commerce_name: String,
    pub role: String,
    pub mstatus: String,
}

#[derive(Deserialize)]
pub struct LoginInput {
    pub identifier: String, // téléphone ou e-mail
    pub password: String,
}

/// Connexion par mot de passe.
/// Vérifie l'identifiant (téléphone ou e-mail), le hash, le statut du membership.
#[tauri::command]
pub fn login(
    db: State<Database>,
    session: State<SessionState>,
    input: LoginInput,
) -> KomersaResult<SessionInfo> {
    if input.identifier.trim().is_empty() || input.password.is_empty() {
        return Err(KomersaError::Auth("Identifiant et mot de passe requis.".into()));
    }

    let conn = db.0.lock().unwrap();

    // Chercher le compte par téléphone ou e-mail
    let row = conn.query_row(
        "SELECT id, name, password_hash FROM accounts
         WHERE (phone = ?1 OR email = ?1)
         LIMIT 1",
        [input.identifier.trim()],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        },
    );

    let (account_id, account_name, password_hash) = match row {
        Ok(r) => r,
        Err(_) => return Err(KomersaError::Auth("Identifiant ou mot de passe incorrect.".into())),
    };

    // Vérifier le mot de passe
    let hash_str = password_hash.ok_or_else(|| {
        KomersaError::Auth("Aucun mot de passe défini pour ce compte.".into())
    })?;

    let parsed = PasswordHash::new(&hash_str)
        .map_err(|e| KomersaError::Hash(e.to_string()))?;
    Argon2::default()
        .verify_password(input.password.as_bytes(), &parsed)
        .map_err(|_| KomersaError::Auth("Identifiant ou mot de passe incorrect.".into()))?;

    // Récupérer le membership (un seul commerce en Phase 1)
    let mbr = conn.query_row(
        "SELECT m.id, m.commerce_id, m.role, m.mstatus, c.name
         FROM memberships m
         JOIN commerces c ON c.id = m.commerce_id
         WHERE m.account_id = ?1
         ORDER BY m.created_at ASC
         LIMIT 1",
        [&account_id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        },
    )
    .map_err(|_| KomersaError::Auth("Aucun commerce associé à ce compte.".into()))?;

    let (membership_id, commerce_id, role, mstatus, commerce_name) = mbr;

    if mstatus == "Suspendu" || mstatus == "Désactivé" {
        return Err(KomersaError::Auth(format!(
            "Accès refusé — votre compte est {mstatus}."
        )));
    }

    let info = SessionInfo {
        account_id: account_id.clone(),
        account_name: account_name.clone(),
        membership_id: membership_id.clone(),
        commerce_id: commerce_id.clone(),
        commerce_name: commerce_name.clone(),
        role: role.clone(),
        mstatus,
    };

    session.set(ActiveSession {
        account_id,
        account_name,
        membership_id,
        commerce_id,
        role,
        commerce_name,
    });

    Ok(info)
}

#[derive(Deserialize)]
pub struct LoginPinInput {
    pub account_id: String,
    pub pin: String,
}

/// Connexion rapide par code PIN (poste partagé).
#[tauri::command]
pub fn login_pin(
    db: State<Database>,
    session: State<SessionState>,
    input: LoginPinInput,
) -> KomersaResult<SessionInfo> {
    if input.pin.len() != 4 || !input.pin.chars().all(|c| c.is_ascii_digit()) {
        return Err(KomersaError::Auth("Code PIN invalide.".into()));
    }

    let conn = db.0.lock().unwrap();

    let row = conn.query_row(
        "SELECT name, pin_hash FROM accounts WHERE id = ?1",
        [&input.account_id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
            ))
        },
    )
    .map_err(|_| KomersaError::Auth("Compte introuvable.".into()))?;

    let (account_name, pin_hash) = row;
    let hash_str = pin_hash
        .ok_or_else(|| KomersaError::Auth("Aucun code PIN défini pour ce compte.".into()))?;

    let parsed = PasswordHash::new(&hash_str)
        .map_err(|e| KomersaError::Hash(e.to_string()))?;
    Argon2::default()
        .verify_password(input.pin.as_bytes(), &parsed)
        .map_err(|_| KomersaError::Auth("Code PIN incorrect.".into()))?;

    let mbr = conn.query_row(
        "SELECT m.id, m.commerce_id, m.role, m.mstatus, c.name
         FROM memberships m
         JOIN commerces c ON c.id = m.commerce_id
         WHERE m.account_id = ?1
         ORDER BY m.created_at ASC
         LIMIT 1",
        [&input.account_id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        },
    )
    .map_err(|_| KomersaError::Auth("Aucun commerce associé.".into()))?;

    let (membership_id, commerce_id, role, mstatus, commerce_name) = mbr;

    if mstatus == "Suspendu" || mstatus == "Désactivé" {
        return Err(KomersaError::Auth(format!("Accès refusé — compte {mstatus}.")));
    }

    let info = SessionInfo {
        account_id: input.account_id.clone(),
        account_name: account_name.clone(),
        membership_id: membership_id.clone(),
        commerce_id: commerce_id.clone(),
        commerce_name: commerce_name.clone(),
        role: role.clone(),
        mstatus,
    };

    session.set(ActiveSession {
        account_id: input.account_id,
        account_name,
        membership_id,
        commerce_id,
        role,
        commerce_name,
    });

    Ok(info)
}

/// Compte affichable sur l'écran de connexion (sélecteur de profil).
#[derive(Serialize)]
pub struct LoginAccount {
    pub account_id: String,
    pub name: String,
    pub role: String,
    pub commerce_name: String,
    pub photo_path: Option<String>,
    pub has_pin: bool,
}

/// Liste les membres connus de l'appareil pour le sélecteur de connexion.
/// Volontairement sans session : appelé avant toute authentification.
/// Ne renvoie aucun secret (ni hash, ni identifiant de contact).
#[tauri::command]
pub fn list_login_accounts(db: State<Database>) -> KomersaResult<Vec<LoginAccount>> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT a.id, a.name, m.role, c.name, a.photo_path, (a.pin_hash IS NOT NULL)
         FROM accounts a
         JOIN memberships m ON m.account_id = a.id
         JOIN commerces c ON c.id = m.commerce_id
         WHERE m.mstatus = 'Actif' AND a.password_hash IS NOT NULL
         ORDER BY CASE m.role WHEN 'Propriétaire' THEN 0 ELSE 1 END, a.name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(LoginAccount {
            account_id: row.get(0)?,
            name: row.get(1)?,
            role: row.get(2)?,
            commerce_name: row.get(3)?,
            photo_path: row.get(4)?,
            has_pin: row.get::<_, i64>(5)? != 0,
        })
    })?;
    Ok(rows.flatten().collect())
}

#[derive(Deserialize)]
pub struct LoginAccountInput {
    pub account_id: String,
    pub password: String,
}

/// Connexion par sélection d'un compte (sélecteur de profil) + mot de passe.
#[tauri::command]
pub fn login_account(
    db: State<Database>,
    session: State<SessionState>,
    input: LoginAccountInput,
) -> KomersaResult<SessionInfo> {
    if input.password.is_empty() {
        return Err(KomersaError::Auth("Mot de passe requis.".into()));
    }

    let conn = db.0.lock().unwrap();

    let (account_name, password_hash) = conn
        .query_row(
            "SELECT name, password_hash FROM accounts WHERE id = ?1",
            [&input.account_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
        )
        .map_err(|_| KomersaError::Auth("Compte introuvable.".into()))?;

    let hash_str = password_hash.ok_or_else(|| {
        KomersaError::Auth("Aucun mot de passe défini pour ce compte.".into())
    })?;
    let parsed = PasswordHash::new(&hash_str).map_err(|e| KomersaError::Hash(e.to_string()))?;
    Argon2::default()
        .verify_password(input.password.as_bytes(), &parsed)
        .map_err(|_| KomersaError::Auth("Mot de passe incorrect.".into()))?;

    let mbr = conn
        .query_row(
            "SELECT m.id, m.commerce_id, m.role, m.mstatus, c.name
             FROM memberships m
             JOIN commerces c ON c.id = m.commerce_id
             WHERE m.account_id = ?1
             ORDER BY m.created_at ASC
             LIMIT 1",
            [&input.account_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            },
        )
        .map_err(|_| KomersaError::Auth("Aucun commerce associé à ce compte.".into()))?;

    let (membership_id, commerce_id, role, mstatus, commerce_name) = mbr;

    if mstatus == "Suspendu" || mstatus == "Désactivé" {
        return Err(KomersaError::Auth(format!("Accès refusé — votre compte est {mstatus}.")));
    }

    let account_id = input.account_id;
    let info = SessionInfo {
        account_id: account_id.clone(),
        account_name: account_name.clone(),
        membership_id: membership_id.clone(),
        commerce_id: commerce_id.clone(),
        commerce_name: commerce_name.clone(),
        role: role.clone(),
        mstatus,
    };

    session.set(ActiveSession {
        account_id,
        account_name,
        membership_id,
        commerce_id,
        role,
        commerce_name,
    });

    Ok(info)
}

/// Déconnecte l'utilisateur courant (efface la session mémoire).
#[tauri::command]
pub fn logout(session: State<SessionState>) -> KomersaResult<()> {
    session.clear();
    Ok(())
}

/// Retourne la session active, ou None si personne n'est connecté.
#[tauri::command]
pub fn get_session(session: State<SessionState>) -> Option<SessionInfo> {
    session.get().map(|s| SessionInfo {
        account_id: s.account_id,
        account_name: s.account_name,
        membership_id: s.membership_id,
        commerce_id: s.commerce_id,
        commerce_name: s.commerce_name,
        role: s.role,
        mstatus: "Actif".into(),
    })
}
