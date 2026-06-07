use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;
use argon2::{Argon2, PasswordHasher};
use argon2::password_hash::SaltString;
use rand::rngs::OsRng;

use crate::db::Database;
use crate::error::{KomersaError, KomersaResult};
use crate::permissions::{self, Permission, ALL_PERMISSIONS};
use crate::session::SessionState;

// ---------------------------------------------------------------------------
// Membres
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct MemberRow {
    pub membership_id: String,
    pub account_id: String,
    pub name: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub role: String,
    pub mstatus: String,
    pub photo_path: Option<String>,
    pub joined_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PermissionEntry {
    pub key: String,
    pub label: String,
    pub group: String,
    pub role_default: bool,
    pub effective: bool,
    pub overridden: bool,
}

#[derive(Deserialize)]
pub struct CreateMemberInput {
    pub name: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub role: String,
    pub password: String,
    pub pin: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateMemberStatusInput {
    pub membership_id: String,
    pub mstatus: String,
}

#[derive(Deserialize)]
pub struct UpdateMemberRoleInput {
    pub membership_id: String,
    pub role: String,
}

#[derive(Deserialize)]
pub struct SetPermissionInput {
    pub membership_id: String,
    pub permission: String,
    /// Some(true/false) = override explicite ; None = revenir au défaut du rôle
    pub granted: Option<bool>,
}

const VALID_ROLES: &[&str] = &[
    "Propriétaire", "Administrateur", "Responsable des ventes",
    "Caissier", "Gestionnaire de stock", "Comptable", "Vendeur",
];

#[tauri::command]
pub fn list_members(
    db: State<Database>,
    session: State<SessionState>,
) -> KomersaResult<Vec<MemberRow>> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::GererUtilisateurs)?;

    let mut stmt = conn.prepare(
        "SELECT m.id, a.id, a.name, a.phone, a.email, m.role, m.mstatus, a.photo_path, m.joined_at
         FROM memberships m
         JOIN accounts a ON a.id = m.account_id
         WHERE m.commerce_id=?1
         ORDER BY CASE m.role WHEN 'Propriétaire' THEN 0 ELSE 1 END, a.name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([&sess.commerce_id], |row| {
        Ok(MemberRow {
            membership_id: row.get(0)?, account_id: row.get(1)?, name: row.get(2)?,
            phone: row.get(3)?, email: row.get(4)?, role: row.get(5)?,
            mstatus: row.get(6)?, photo_path: row.get(7)?, joined_at: row.get(8)?,
        })
    })?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn create_member(
    db: State<Database>,
    session: State<SessionState>,
    input: CreateMemberInput,
) -> KomersaResult<MemberRow> {
    if input.name.trim().is_empty() {
        return Err(KomersaError::Validation("Le nom est requis.".into()));
    }
    if !VALID_ROLES.contains(&input.role.as_str()) {
        return Err(KomersaError::Validation("Rôle invalide.".into()));
    }
    let phone_empty = input.phone.as_deref().map(str::trim).unwrap_or("").is_empty();
    let email_empty = input.email.as_deref().map(str::trim).unwrap_or("").is_empty();
    if phone_empty && email_empty {
        return Err(KomersaError::Validation("Un téléphone ou un e-mail est requis.".into()));
    }
    if input.password.len() < 6 {
        return Err(KomersaError::Validation("Le mot de passe doit comporter au moins 6 caractères.".into()));
    }

    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::GererUtilisateurs)?;

    // Seul un Propriétaire peut créer un autre Propriétaire
    if input.role == "Propriétaire" && sess.role != "Propriétaire" {
        return Err(KomersaError::PermissionDenied(
            "Seul un Propriétaire peut nommer un autre Propriétaire.".into(),
        ));
    }

    // Vérifier l'unicité du téléphone
    if let Some(phone) = input.phone.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
        let exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM accounts WHERE phone=?1)", [phone], |r| r.get(0),
        )?;
        if exists {
            return Err(KomersaError::Validation("Ce numéro de téléphone est déjà utilisé.".into()));
        }
    }

    let argon2 = Argon2::default();
    let salt = SaltString::generate(&mut OsRng);
    let password_hash = argon2
        .hash_password(input.password.as_bytes(), &salt)
        .map_err(|e| KomersaError::Hash(e.to_string()))?
        .to_string();

    let pin_hash = if let Some(ref pin) = input.pin {
        if pin.len() != 4 || !pin.chars().all(|c| c.is_ascii_digit()) {
            return Err(KomersaError::Validation("Le code PIN doit comporter 4 chiffres.".into()));
        }
        let salt2 = SaltString::generate(&mut OsRng);
        Some(argon2.hash_password(pin.as_bytes(), &salt2)
            .map_err(|e| KomersaError::Hash(e.to_string()))?.to_string())
    } else { None };

    let account_id = format!("USR-{}", Uuid::new_v4().as_simple());
    let membership_id = format!("MBR-{}", Uuid::new_v4().as_simple());
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO accounts (id, phone, email, name, password_hash, pin_hash, created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?7)",
        rusqlite::params![
            account_id,
            input.phone.as_deref().map(str::trim).filter(|p| !p.is_empty()),
            input.email.as_deref().map(str::trim).filter(|e| !e.is_empty()),
            input.name.trim(), password_hash, pin_hash, now,
        ],
    )?;
    conn.execute(
        "INSERT INTO memberships (id, account_id, commerce_id, role, mstatus, invited_by, joined_at, created_at)
         VALUES (?1,?2,?3,?4,'Actif',?5,?6,?6)",
        rusqlite::params![membership_id, account_id, sess.commerce_id, input.role, sess.account_id, now],
    )?;

    Ok(MemberRow {
        membership_id, account_id, name: input.name.trim().into(),
        phone: input.phone, email: input.email, role: input.role,
        mstatus: "Actif".into(), photo_path: None, joined_at: Some(now),
    })
}

#[tauri::command]
pub fn update_member_status(
    db: State<Database>,
    session: State<SessionState>,
    input: UpdateMemberStatusInput,
) -> KomersaResult<()> {
    let valid = ["Actif", "Suspendu", "Désactivé", "Invité"];
    if !valid.contains(&input.mstatus.as_str()) {
        return Err(KomersaError::Validation("Statut invalide.".into()));
    }
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::GererUtilisateurs)?;

    // Empêcher de se désactiver soi-même
    if input.membership_id == sess.membership_id {
        return Err(KomersaError::Validation("Vous ne pouvez pas modifier votre propre statut.".into()));
    }
    // Protéger le dernier Propriétaire actif
    let target_role: String = conn.query_row(
        "SELECT role FROM memberships WHERE id=?1 AND commerce_id=?2",
        rusqlite::params![input.membership_id, sess.commerce_id], |r| r.get(0),
    ).map_err(|_| KomersaError::NotFound)?;
    if target_role == "Propriétaire" && input.mstatus != "Actif" {
        let active_owners: i64 = conn.query_row(
            "SELECT COUNT(*) FROM memberships WHERE commerce_id=?1 AND role='Propriétaire' AND mstatus='Actif'",
            [&sess.commerce_id], |r| r.get(0),
        )?;
        if active_owners <= 1 {
            return Err(KomersaError::Validation("Impossible : c'est le dernier propriétaire actif.".into()));
        }
    }

    conn.execute(
        "UPDATE memberships SET mstatus=?2 WHERE id=?1 AND commerce_id=?3",
        rusqlite::params![input.membership_id, input.mstatus, sess.commerce_id],
    )?;
    let target_name: String = conn.query_row(
        "SELECT a.name FROM memberships m JOIN accounts a ON a.id=m.account_id WHERE m.id=?1",
        [&input.membership_id], |r| r.get(0)).unwrap_or_default();
    crate::commands::audit::record_audit(&conn, &sess.commerce_id, &sess.account_id, &sess.account_name,
        "member_status", &format!("Statut « {} » appliqué à {}", input.mstatus, target_name),
        Some(&input.membership_id), None);
    Ok(())
}

#[tauri::command]
pub fn update_member_role(
    db: State<Database>,
    session: State<SessionState>,
    input: UpdateMemberRoleInput,
) -> KomersaResult<()> {
    if !VALID_ROLES.contains(&input.role.as_str()) {
        return Err(KomersaError::Validation("Rôle invalide.".into()));
    }
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::GererUtilisateurs)?;

    // Anti auto-escalade : on ne modifie jamais son propre rôle.
    if input.membership_id == sess.membership_id {
        return Err(KomersaError::PermissionDenied(
            "Vous ne pouvez pas modifier votre propre rôle.".into(),
        ));
    }

    if input.role == "Propriétaire" && sess.role != "Propriétaire" {
        return Err(KomersaError::PermissionDenied(
            "Seul un Propriétaire peut nommer un Propriétaire.".into(),
        ));
    }

    conn.execute(
        "UPDATE memberships SET role=?2 WHERE id=?1 AND commerce_id=?3",
        rusqlite::params![input.membership_id, input.role, sess.commerce_id],
    )?;
    let target_name: String = conn.query_row(
        "SELECT a.name FROM memberships m JOIN accounts a ON a.id=m.account_id WHERE m.id=?1",
        [&input.membership_id], |r| r.get(0)).unwrap_or_default();
    crate::commands::audit::record_audit(&conn, &sess.commerce_id, &sess.account_id, &sess.account_name,
        "role_change", &format!("Rôle « {} » attribué à {}", input.role, target_name),
        Some(&input.membership_id), None);
    Ok(())
}

#[tauri::command]
pub fn get_member_permissions(
    db: State<Database>,
    session: State<SessionState>,
    membership_id: String,
) -> KomersaResult<Vec<PermissionEntry>> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::GererUtilisateurs)?;

    let role: String = conn.query_row(
        "SELECT role FROM memberships WHERE id=?1 AND commerce_id=?2",
        rusqlite::params![membership_id, sess.commerce_id], |r| r.get(0),
    ).map_err(|_| KomersaError::NotFound)?;

    let mut entries = Vec::new();
    for perm in ALL_PERMISSIONS {
        let def = permissions::role_default(&role, perm);
        let override_val: Option<bool> = conn.query_row(
            "SELECT granted FROM membership_permissions WHERE membership_id=?1 AND permission=?2",
            rusqlite::params![membership_id, perm.key()],
            |r| r.get::<_, i32>(0).map(|v| v != 0),
        ).ok();
        let overridden = override_val.is_some();
        let effective = override_val.unwrap_or(def);
        entries.push(PermissionEntry {
            key: perm.key().into(), label: perm.label().into(),
            group: perm.group().into(), role_default: def, effective, overridden,
        });
    }
    Ok(entries)
}

#[tauri::command]
pub fn set_member_permission(
    db: State<Database>,
    session: State<SessionState>,
    input: SetPermissionInput,
) -> KomersaResult<()> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::GererUtilisateurs)?;

    // Anti auto-escalade : on ne modifie jamais ses propres permissions.
    if input.membership_id == sess.membership_id {
        return Err(KomersaError::PermissionDenied(
            "Vous ne pouvez pas modifier vos propres permissions.".into(),
        ));
    }

    // Valider la clé de permission contre la liste connue (intégrité).
    if permissions::from_key(&input.permission).is_none() {
        return Err(KomersaError::Validation("Permission inconnue.".into()));
    }

    // Vérifier appartenance
    let belongs: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM memberships WHERE id=?1 AND commerce_id=?2)",
        rusqlite::params![input.membership_id, sess.commerce_id], |r| r.get(0),
    )?;
    if !belongs { return Err(KomersaError::NotFound); }

    match input.granted {
        None => {
            // Revenir au défaut du rôle : supprimer l'override
            conn.execute(
                "DELETE FROM membership_permissions WHERE membership_id=?1 AND permission=?2",
                rusqlite::params![input.membership_id, input.permission],
            )?;
        }
        Some(granted) => {
            let now = chrono::Utc::now().to_rfc3339();
            let id = format!("PRM-{}", Uuid::new_v4().as_simple());
            conn.execute(
                "INSERT INTO membership_permissions (id, membership_id, permission, granted, set_by, set_at)
                 VALUES (?1,?2,?3,?4,?5,?6)
                 ON CONFLICT(membership_id, permission) DO UPDATE SET granted=?4, set_by=?5, set_at=?6",
                rusqlite::params![id, input.membership_id, input.permission, granted as i32, sess.account_id, now],
            )?;
        }
    }
    let target_name: String = conn.query_row(
        "SELECT a.name FROM memberships m JOIN accounts a ON a.id=m.account_id WHERE m.id=?1",
        [&input.membership_id], |r| r.get(0)).unwrap_or_default();
    let verb = match input.granted { Some(true) => "accordée", Some(false) => "retirée", None => "réinitialisée" };
    crate::commands::audit::record_audit(&conn, &sess.commerce_id, &sess.account_id, &sess.account_name,
        "permission_change", &format!("Permission « {} » {} pour {}", input.permission, verb, target_name),
        Some(&input.membership_id), None);
    Ok(())
}

// ---------------------------------------------------------------------------
// Sécurité : réinitialisation du code PIN d'un membre
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct ResetPinInput {
    pub membership_id: String,
    pub pin: String,
}

#[tauri::command]
pub fn reset_member_pin(
    db: State<Database>,
    session: State<SessionState>,
    input: ResetPinInput,
) -> KomersaResult<()> {
    if input.pin.len() != 4 || !input.pin.chars().all(|c| c.is_ascii_digit()) {
        return Err(KomersaError::Validation("Le code PIN doit comporter 4 chiffres.".into()));
    }

    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::GererUtilisateurs)?;

    // Compte cible (et appartenance au commerce).
    let account_id: String = conn.query_row(
        "SELECT account_id FROM memberships WHERE id=?1 AND commerce_id=?2",
        rusqlite::params![input.membership_id, sess.commerce_id], |r| r.get(0),
    ).map_err(|_| KomersaError::NotFound)?;

    let argon2 = Argon2::default();
    let salt = SaltString::generate(&mut OsRng);
    let pin_hash = argon2.hash_password(input.pin.as_bytes(), &salt)
        .map_err(|e| KomersaError::Hash(e.to_string()))?.to_string();

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE accounts SET pin_hash=?2, updated_at=?3 WHERE id=?1",
        rusqlite::params![account_id, pin_hash, now],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Activité d'un membre (ventes, dépenses, sessions de caisse récentes)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct ActivityRow {
    pub kind: String,    // 'sale' | 'expense' | 'cash'
    pub label: String,
    pub amount: Option<f64>,
    pub at: String,
}

#[tauri::command]
pub fn get_member_activity(
    db: State<Database>,
    session: State<SessionState>,
    membership_id: String,
) -> KomersaResult<Vec<ActivityRow>> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::GererUtilisateurs)?;

    let account_id: String = conn.query_row(
        "SELECT account_id FROM memberships WHERE id=?1 AND commerce_id=?2",
        rusqlite::params![membership_id, sess.commerce_id], |r| r.get(0),
    ).map_err(|_| KomersaError::NotFound)?;

    let mut events: Vec<ActivityRow> = Vec::new();

    // Ventes encaissées par ce membre
    {
        let mut stmt = conn.prepare(
            "SELECT ref, total, state, created_at FROM sales
             WHERE commerce_id=?1 AND seller_id=?2
             ORDER BY created_at DESC LIMIT 15",
        )?;
        let rows = stmt.query_map(rusqlite::params![sess.commerce_id, account_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?))
        })?;
        for r in rows.flatten() {
            let (sref, total, state, at) = r;
            events.push(ActivityRow {
                kind: "sale".into(),
                label: format!("Vente {sref}{}", if state == "Annulée" { " (annulée)" } else { "" }),
                amount: Some(total), at,
            });
        }
    }

    // Dépenses enregistrées par ce membre
    {
        let mut stmt = conn.prepare(
            "SELECT label, amount, created_at FROM expenses
             WHERE commerce_id=?1 AND created_by=?2
             ORDER BY created_at DESC LIMIT 15",
        )?;
        let rows = stmt.query_map(rusqlite::params![sess.commerce_id, account_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?, r.get::<_, String>(2)?))
        })?;
        for r in rows.flatten() {
            let (label, amount, at) = r;
            events.push(ActivityRow { kind: "expense".into(), label: format!("Dépense : {label}"), amount: Some(amount), at });
        }
    }

    // Sessions de caisse ouvertes par ce membre
    {
        let mut stmt = conn.prepare(
            "SELECT ref, status, opened_at FROM cash_sessions
             WHERE commerce_id=?1 AND seller_id=?2
             ORDER BY opened_at DESC LIMIT 10",
        )?;
        let rows = stmt.query_map(rusqlite::params![sess.commerce_id, account_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
        })?;
        for r in rows.flatten() {
            let (sref, status, at) = r;
            events.push(ActivityRow {
                kind: "cash".into(),
                label: format!("Caisse {sref} ({})", if status == "open" { "ouverte" } else { "clôturée" }),
                amount: None, at,
            });
        }
    }

    // Trier par date décroissante, limiter à 25.
    events.sort_by(|a, b| b.at.cmp(&a.at));
    events.truncate(25);
    Ok(events)
}

// ---------------------------------------------------------------------------
// Postes / terminaux
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct PosteRow {
    pub id: String,
    pub name: String,
    pub poste_type: Option<String>,
    pub os: Option<String>,
    pub scanner: bool,
    pub printer: Option<String>,
    pub drawer: bool,
    pub status: String,
    pub last_seen_at: Option<String>,
}

#[derive(Deserialize)]
pub struct CreatePosteInput {
    pub name: String,
    pub poste_type: Option<String>,
    pub os: Option<String>,
    pub scanner: bool,
    pub printer: Option<String>,
    pub drawer: bool,
}

#[derive(Deserialize)]
pub struct UpdatePosteInput {
    pub id: String,
    pub name: String,
    pub poste_type: Option<String>,
    pub os: Option<String>,
    pub scanner: bool,
    pub printer: Option<String>,
    pub drawer: bool,
}

#[tauri::command]
pub fn list_postes(
    db: State<Database>,
    session: State<SessionState>,
) -> KomersaResult<Vec<PosteRow>> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();

    let mut stmt = conn.prepare(
        "SELECT id, name, type, os, scanner, printer, drawer, status, last_seen_at
         FROM postes WHERE commerce_id=?1 ORDER BY created_at",
    )?;
    let rows = stmt.query_map([&sess.commerce_id], |row| {
        Ok(PosteRow {
            id: row.get(0)?, name: row.get(1)?, poste_type: row.get(2)?, os: row.get(3)?,
            scanner: row.get::<_, i32>(4)? != 0, printer: row.get(5)?,
            drawer: row.get::<_, i32>(6)? != 0, status: row.get(7)?, last_seen_at: row.get(8)?,
        })
    })?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn create_poste(
    db: State<Database>,
    session: State<SessionState>,
    input: CreatePosteInput,
) -> KomersaResult<PosteRow> {
    if input.name.trim().is_empty() {
        return Err(KomersaError::Validation("Le nom du poste est requis.".into()));
    }
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::ModifierParametres)?;

    let id = format!("PST-{}", Uuid::new_v4().as_simple());
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO postes (id, commerce_id, name, type, os, scanner, printer, drawer, status, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'offline',?9)",
        rusqlite::params![
            id, sess.commerce_id, input.name.trim(), input.poste_type.as_deref(),
            input.os.as_deref(), input.scanner as i32, input.printer.as_deref(),
            input.drawer as i32, now,
        ],
    )?;
    Ok(PosteRow {
        id, name: input.name.trim().into(), poste_type: input.poste_type, os: input.os,
        scanner: input.scanner, printer: input.printer, drawer: input.drawer,
        status: "offline".into(), last_seen_at: None,
    })
}

#[tauri::command]
pub fn update_poste(
    db: State<Database>,
    session: State<SessionState>,
    input: UpdatePosteInput,
) -> KomersaResult<()> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::ModifierParametres)?;

    let affected = conn.execute(
        "UPDATE postes SET name=?2, type=?3, os=?4, scanner=?5, printer=?6, drawer=?7
         WHERE id=?1 AND commerce_id=?8",
        rusqlite::params![
            input.id, input.name.trim(), input.poste_type.as_deref(), input.os.as_deref(),
            input.scanner as i32, input.printer.as_deref(), input.drawer as i32, sess.commerce_id,
        ],
    )?;
    if affected == 0 { return Err(KomersaError::NotFound); }
    Ok(())
}

#[tauri::command]
pub fn delete_poste(
    db: State<Database>,
    session: State<SessionState>,
    poste_id: String,
) -> KomersaResult<()> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::ModifierParametres)?;

    conn.execute(
        "DELETE FROM postes WHERE id=?1 AND commerce_id=?2",
        rusqlite::params![poste_id, sess.commerce_id],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Licence (Phase 1 : locale, vérifiée localement)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct LicenseInfo {
    pub plan: String,
    pub status: String,
    pub activated_at: Option<String>,
    pub renew_at: Option<String>,
    pub last_check_at: Option<String>,
    pub grace_days: i32,
    pub max_users: i32,
    pub max_postes: i32,
    pub used_users: i64,
    pub used_postes: i64,
}

#[tauri::command]
pub fn get_license(
    db: State<Database>,
    session: State<SessionState>,
) -> KomersaResult<LicenseInfo> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();

    // Initialiser une licence par défaut si absente
    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM license WHERE id=1)", [], |r| r.get(0),
    )?;
    if !exists {
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO license (id, plan, status, activated_at, last_check_at, grace_days, max_users, max_postes)
             VALUES (1,'Standard','active',?1,?1,7,10,5)",
            [&now],
        )?;
    }

    let (plan, status, activated_at, renew_at, last_check_at, grace_days, max_users, max_postes):
        (String, String, Option<String>, Option<String>, Option<String>, i32, i32, i32) =
        conn.query_row(
            "SELECT plan, status, activated_at, renew_at, last_check_at, grace_days, max_users, max_postes
             FROM license WHERE id=1",
            [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?)),
        )?;

    let used_users: i64 = conn.query_row(
        "SELECT COUNT(*) FROM memberships WHERE commerce_id=?1 AND mstatus != 'Désactivé'",
        [&sess.commerce_id], |r| r.get(0),
    )?;
    let used_postes: i64 = conn.query_row(
        "SELECT COUNT(*) FROM postes WHERE commerce_id=?1",
        [&sess.commerce_id], |r| r.get(0),
    )?;

    Ok(LicenseInfo {
        plan, status, activated_at, renew_at, last_check_at,
        grace_days, max_users, max_postes, used_users, used_postes,
    })
}
