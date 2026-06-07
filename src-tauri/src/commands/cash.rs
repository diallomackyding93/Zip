use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::db::Database;
use crate::error::{KomersaError, KomersaResult};
use crate::permissions::{self, Permission};
use crate::session::SessionState;

// ---------------------------------------------------------------------------
// Structs de sortie
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct ModeTotal {
    pub mode_label: String,
    pub amount: f64,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct CashSessionInfo {
    pub id: String,
    pub session_ref: String,
    pub seller_id: String,
    pub seller_name: String,
    pub status: String,
    pub initial_fund: f64,
    pub opened_at: String,
    pub closed_at: Option<String>,
    pub cash_expected: f64,
    pub counted_cash: Option<f64>,
    pub gap: Option<f64>,
    pub by_mode: Vec<ModeTotal>,
    pub sales_count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct CashMovementRow {
    pub id: String,
    pub movement_type: String,
    pub detail: Option<String>,
    pub mode_label: Option<String>,
    pub amount: f64,
    pub seller_name: String,
    pub created_at: String,
    pub sale_ref: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CashSessionSummary {
    pub id: String,
    pub session_ref: String,
    pub seller_name: String,
    pub status: String,
    pub initial_fund: f64,
    pub cash_expected: Option<f64>,
    pub counted_cash: Option<f64>,
    pub gap: Option<f64>,
    pub opened_at: String,
    pub closed_at: Option<String>,
}

// ---------------------------------------------------------------------------
// Structs d'entrée
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct OpenSessionInput {
    pub initial_fund: f64,
}

#[derive(Deserialize)]
pub struct AddMovementInput {
    pub movement_type: String, // 'Apport' | 'Sortie'
    pub amount: f64,
    pub detail: Option<String>,
}

#[derive(Deserialize)]
pub struct CloseSessionInput {
    pub session_id: String,
    pub counted_cash: f64,
    /// Compte de trésorerie où déposer la recette. Si fourni, la remise est
    /// validée immédiatement (l'argent entre dans ce compte). Si absent, une
    /// remise « en attente » est créée, à valider plus tard depuis Trésorerie.
    #[serde(default)]
    pub treasury_account_id: Option<String>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn next_session_ref(conn: &rusqlite::Connection, commerce_id: &str) -> KomersaResult<String> {
    let max: i64 = conn.query_row(
        "SELECT COALESCE(MAX(CAST(REPLACE(ref,'CAISSE-','') AS INTEGER)), 0)
         FROM cash_sessions WHERE commerce_id = ?1",
        [commerce_id],
        |row| row.get(0),
    )?;
    Ok(format!("CAISSE-{:04}", max + 1))
}

/// Calcule l'espèces attendu dans la caisse pour une session donnée.
/// = fond initial + somme des mouvements liés aux espèces
fn calc_expected_cash(conn: &rusqlite::Connection, session_id: &str, initial_fund: f64) -> f64 {
    let sum: f64 = conn
        .query_row(
            "SELECT COALESCE(SUM(cm.amount), 0) FROM cash_movements cm
             WHERE cm.cash_session_id = ?1
               AND (cm.treasury_account_id IS NULL OR cm.mode_label = 'Comptant'
                    OR cm.type IN ('Apport', 'Sortie'))
               AND NOT EXISTS (SELECT 1 FROM sales s
                               WHERE s.ref = cm.ref AND s.state = 'Annulée')",
            [session_id],
            |row| row.get(0),
        )
        .unwrap_or(0.0);
    initial_fund + sum
}

fn load_by_mode(conn: &rusqlite::Connection, session_id: &str) -> Vec<ModeTotal> {
    let Ok(mut stmt) = conn.prepare(
        "SELECT sp.mode_label, COALESCE(SUM(sp.amount),0), COUNT(*)
         FROM sale_payments sp
         JOIN sales s ON s.id = sp.sale_id
         WHERE s.cash_session_id = ?1 AND s.state != 'Annulée'
         GROUP BY sp.mode_label
         ORDER BY SUM(sp.amount) DESC",
    ) else {
        return vec![];
    };
    let Ok(rows) = stmt.query_map([session_id], |row| {
        Ok(ModeTotal {
            mode_label: row.get(0)?,
            amount: row.get(1)?,
            count: row.get(2)?,
        })
    }) else {
        return vec![];
    };
    rows.flatten().collect()
}

fn load_session_info(
    conn: &rusqlite::Connection,
    session_id: &str,
    commerce_id: &str,
) -> KomersaResult<CashSessionInfo> {
    let (id, session_ref, seller_id, seller_name, status, initial_fund, opened_at, closed_at, counted_cash, gap): (
        String, String, String, String, String, f64, String, Option<String>, Option<f64>, Option<f64>
    ) = conn.query_row(
        "SELECT cs.id, cs.ref, cs.seller_id, COALESCE(a.name,''), cs.status,
                cs.initial_fund, cs.opened_at, cs.closed_at, cs.counted_cash, cs.gap
         FROM cash_sessions cs
         LEFT JOIN accounts a ON a.id = cs.seller_id
         WHERE cs.id = ?1 AND cs.commerce_id = ?2",
        rusqlite::params![session_id, commerce_id],
        |row| Ok((
            row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?,
            row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?,
            row.get(8)?, row.get(9)?,
        )),
    )?;

    let cash_expected = calc_expected_cash(conn, &id, initial_fund);
    let by_mode = load_by_mode(conn, &id);
    let sales_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sales WHERE cash_session_id = ?1 AND state != 'Annulée'",
        [&id],
        |row| row.get(0),
    ).unwrap_or(0);

    Ok(CashSessionInfo {
        id, session_ref, seller_id, seller_name, status,
        initial_fund, opened_at, closed_at,
        cash_expected, counted_cash, gap,
        by_mode, sales_count,
    })
}

// ---------------------------------------------------------------------------
// Commandes
// ---------------------------------------------------------------------------

/// Retourne la session de caisse ouverte du commerce (s'il y en a une).
#[tauri::command]
pub fn get_open_cash_session(
    db: State<Database>,
    session: State<SessionState>,
) -> KomersaResult<Option<CashSessionInfo>> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();

    // Chaque vendeur a SA propre caisse : on ne renvoie que la session ouverte du connecté.
    let open_id: Option<String> = conn
        .query_row(
            "SELECT id FROM cash_sessions
             WHERE commerce_id = ?1 AND seller_id = ?2 AND status = 'open' LIMIT 1",
            rusqlite::params![sess.commerce_id, sess.account_id],
            |row| row.get(0),
        )
        .ok();

    match open_id {
        None => Ok(None),
        Some(id) => Ok(Some(load_session_info(&conn, &id, &sess.commerce_id)?)),
    }
}

#[tauri::command]
pub fn open_cash_session(
    db: State<Database>,
    session: State<SessionState>,
    input: OpenSessionInput,
) -> KomersaResult<CashSessionInfo> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::OuvrirFermerCaisse)?;

    // Vérifier que CE vendeur n'a pas déjà une caisse ouverte (les autres peuvent avoir la leur).
    let already_open: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM cash_sessions
         WHERE commerce_id = ?1 AND seller_id = ?2 AND status = 'open')",
        rusqlite::params![sess.commerce_id, sess.account_id],
        |row| row.get(0),
    )?;
    if already_open {
        return Err(KomersaError::Validation(
            "Vous avez déjà une caisse ouverte. Clôturez-la avant d'en ouvrir une nouvelle.".into(),
        ));
    }

    if input.initial_fund < 0.0 {
        return Err(KomersaError::Validation("Le fond de caisse ne peut pas être négatif.".into()));
    }

    let id = format!("CSH-{}", Uuid::new_v4().as_simple());
    let session_ref = next_session_ref(&conn, &sess.commerce_id)?;
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO cash_sessions
           (id, commerce_id, ref, seller_id, status, initial_fund, opened_at)
         VALUES (?1,?2,?3,?4,'open',?5,?6)",
        rusqlite::params![id, sess.commerce_id, session_ref, sess.account_id, input.initial_fund, now],
    )?;

    load_session_info(&conn, &id, &sess.commerce_id)
}

#[tauri::command]
pub fn add_cash_movement(
    db: State<Database>,
    session: State<SessionState>,
    input: AddMovementInput,
) -> KomersaResult<CashMovementRow> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::OuvrirFermerCaisse)?;

    if input.amount <= 0.0 {
        return Err(KomersaError::Validation("Le montant doit être supérieur à 0.".into()));
    }
    if !matches!(input.movement_type.as_str(), "Apport" | "Sortie") {
        return Err(KomersaError::Validation("Type de mouvement invalide.".into()));
    }

    // Mouvement sur SA propre caisse uniquement.
    let session_id: String = conn
        .query_row(
            "SELECT id FROM cash_sessions
             WHERE commerce_id = ?1 AND seller_id = ?2 AND status = 'open' LIMIT 1",
            rusqlite::params![sess.commerce_id, sess.account_id],
            |row| row.get(0),
        )
        .map_err(|_| KomersaError::Validation("Aucune caisse ouverte à votre nom.".into()))?;

    let signed_amount = if input.movement_type == "Sortie" {
        -input.amount
    } else {
        input.amount
    };

    let id = format!("CMV-{}", Uuid::new_v4().as_simple());
    let now = chrono::Utc::now().to_rfc3339();
    let seller_name: String = conn
        .query_row("SELECT name FROM accounts WHERE id=?1", [&sess.account_id], |r| r.get(0))
        .unwrap_or_default();

    conn.execute(
        "INSERT INTO cash_movements
           (id, cash_session_id, commerce_id, type, detail, mode_label, amount, seller_id, created_at)
         VALUES (?1,?2,?3,?4,?5,'Espèces',?6,?7,?8)",
        rusqlite::params![
            id, session_id, sess.commerce_id,
            input.movement_type, input.detail, signed_amount, sess.account_id, now,
        ],
    )?;

    Ok(CashMovementRow {
        id,
        movement_type: input.movement_type,
        detail: input.detail,
        mode_label: Some("Espèces".into()),
        amount: signed_amount,
        seller_name,
        created_at: now,
        sale_ref: None,
    })
}

#[tauri::command]
pub fn list_cash_movements(
    db: State<Database>,
    session: State<SessionState>,
    session_id: String,
) -> KomersaResult<Vec<CashMovementRow>> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::OuvrirFermerCaisse)?;

    // Lecture autorisée si c'est SA caisse, ou s'il est superviseur (peut voir les rapports).
    let owner_id: String = conn
        .query_row(
            "SELECT seller_id FROM cash_sessions WHERE id = ?1 AND commerce_id = ?2",
            rusqlite::params![session_id, sess.commerce_id],
            |row| row.get(0),
        )
        .map_err(|_| KomersaError::NotFound)?;
    let can_view_all = permissions::allowed(
        &conn, &sess.membership_id, &sess.role, Permission::VoirRapports,
    );
    if owner_id != sess.account_id && !can_view_all {
        return Err(KomersaError::PermissionDenied(
            "Vous ne pouvez consulter que votre propre caisse.".into(),
        ));
    }

    let mut stmt = conn.prepare(
        "SELECT cm.id, cm.type, cm.detail, cm.mode_label, cm.amount,
                COALESCE(a.name,''), cm.created_at, cm.ref
         FROM cash_movements cm
         LEFT JOIN accounts a ON a.id = cm.seller_id
         WHERE cm.cash_session_id = ?1
         ORDER BY cm.created_at DESC
         LIMIT 200",
    )?;

    let rows = stmt
        .query_map([&session_id], |row| {
            Ok(CashMovementRow {
                id: row.get(0)?,
                movement_type: row.get(1)?,
                detail: row.get(2)?,
                mode_label: row.get(3)?,
                amount: row.get(4)?,
                seller_name: row.get(5)?,
                created_at: row.get(6)?,
                sale_ref: row.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(rows)
}

#[tauri::command]
pub fn close_cash_session(
    db: State<Database>,
    session: State<SessionState>,
    input: CloseSessionInput,
) -> KomersaResult<CashSessionInfo> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::OuvrirFermerCaisse)?;

    if input.counted_cash < 0.0 {
        return Err(KomersaError::Validation("Le montant compté ne peut pas être négatif.".into()));
    }

    // Vérifier que la session appartient au commerce et est ouverte
    let (initial_fund, status, seller_id): (f64, String, String) = conn
        .query_row(
            "SELECT initial_fund, status, seller_id FROM cash_sessions WHERE id = ?1 AND commerce_id = ?2",
            rusqlite::params![input.session_id, sess.commerce_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|_| KomersaError::NotFound)?;

    // On ne clôture que SA propre caisse — personne ne ferme celle d'un autre.
    if seller_id != sess.account_id {
        return Err(KomersaError::PermissionDenied(
            "Vous ne pouvez clôturer que votre propre caisse.".into(),
        ));
    }

    if status != "open" {
        return Err(KomersaError::Validation("Cette session est déjà clôturée.".into()));
    }

    let cash_expected = calc_expected_cash(&conn, &input.session_id, initial_fund);
    let gap = input.counted_cash - cash_expected;
    let now = chrono::Utc::now().to_rfc3339();

    // Dépôt = tout le contenu compté (fond initial inclus) → transféré au compte choisi.
    let deposit = input.counted_cash.max(0.0).round();
    let handover_id = format!("HOV-{}", Uuid::new_v4().as_simple());

    let tx = conn.unchecked_transaction()?;
    conn.execute(
        "UPDATE cash_sessions SET
           status='closed', closed_at=?2,
           expected_cash=?3, counted_cash=?4, gap=?5
         WHERE id=?1",
        rusqlite::params![input.session_id, now, cash_expected, input.counted_cash, gap],
    )?;

    // Le dépôt direct dans un compte est réservé à ceux qui peuvent gérer la trésorerie.
    // Les autres : leur clôture crée une remise « en attente » à confirmer par un responsable.
    let can_deposit = permissions::allowed(
        &conn, &sess.membership_id, &sess.role, Permission::TransfertsTresorerie,
    );
    let deposit_account = input.treasury_account_id.as_deref().filter(|_| can_deposit);

    match deposit_account {
        // Compte choisi + droit trésorerie : on crédite directement et la remise est déjà validée.
        Some(account_id) => {
            let account_ok: bool = conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM treasury_accounts WHERE id=?1 AND commerce_id=?2 AND deleted=0)",
                rusqlite::params![account_id, sess.commerce_id], |r| r.get(0),
            )?;
            if !account_ok {
                return Err(KomersaError::Validation("Compte de dépôt introuvable.".into()));
            }
            conn.execute(
                "UPDATE treasury_accounts SET balance=balance+?2, updated_at=?3 WHERE id=?1 AND commerce_id=?4",
                rusqlite::params![account_id, deposit, now, sess.commerce_id],
            )?;
            crate::commands::treasury::record_movement(
                &conn, &sess.commerce_id, account_id, deposit, "cash_deposit", "Remise de caisse", &now,
            )?;
            conn.execute(
                "INSERT INTO cash_handovers
                   (id, cash_session_id, seller_id, counted, expected, gap, status, validated_by, validated_at, created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,'validated',?3,?7,?7)",
                rusqlite::params![
                    handover_id, input.session_id, sess.account_id,
                    input.counted_cash, cash_expected, gap, now,
                ],
            )?;
        }
        // Aucun compte : remise en attente, à valider depuis Trésorerie.
        None => {
            conn.execute(
                "INSERT INTO cash_handovers
                   (id, cash_session_id, seller_id, counted, expected, gap, created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7)",
                rusqlite::params![
                    handover_id, input.session_id, sess.account_id,
                    input.counted_cash, cash_expected, gap, now,
                ],
            )?;
        }
    }

    crate::commands::audit::record_audit(&conn, &sess.commerce_id, &sess.account_id, &sess.account_name,
        "cash_close", &format!("Clôture de caisse — écart {} GNF", gap.round() as i64),
        Some(&input.session_id), Some(input.counted_cash));

    tx.commit()?;

    load_session_info(&conn, &input.session_id, &sess.commerce_id)
}

#[tauri::command]
pub fn list_cash_sessions(
    db: State<Database>,
    session: State<SessionState>,
    from: Option<String>,
    to: Option<String>,
    offset: Option<i64>,
    limit: Option<i64>,
) -> KomersaResult<Vec<CashSessionSummary>> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::OuvrirFermerCaisse)?;

    let lim = limit.unwrap_or(50).clamp(1, 10000);
    let off = offset.unwrap_or(0).max(0);

    // Superviseur (peut voir les rapports) → toutes les caisses ; sinon, uniquement les siennes.
    let can_view_all = permissions::allowed(
        &conn, &sess.membership_id, &sess.role, Permission::VoirRapports,
    );

    let mut stmt = conn.prepare(
        "SELECT cs.id, cs.ref, COALESCE(a.name,''), cs.status,
                cs.initial_fund, cs.expected_cash, cs.counted_cash, cs.gap,
                cs.opened_at, cs.closed_at
         FROM cash_sessions cs
         LEFT JOIN accounts a ON a.id = cs.seller_id
         WHERE cs.commerce_id = ?1
           AND (?6 = 1 OR cs.seller_id = ?7)
           AND (?2 IS NULL OR date(cs.opened_at) >= date(?2))
           AND (?3 IS NULL OR date(cs.opened_at) <= date(?3))
         ORDER BY cs.opened_at DESC
         LIMIT ?4 OFFSET ?5",
    )?;

    let rows = stmt
        .query_map(rusqlite::params![
            sess.commerce_id, from, to, lim, off,
            can_view_all as i64, sess.account_id
        ], |row| {
            Ok(CashSessionSummary {
                id: row.get(0)?,
                session_ref: row.get(1)?,
                seller_name: row.get(2)?,
                status: row.get(3)?,
                initial_fund: row.get(4)?,
                cash_expected: row.get(5)?,
                counted_cash: row.get(6)?,
                gap: row.get(7)?,
                opened_at: row.get(8)?,
                closed_at: row.get(9)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(rows)
}
