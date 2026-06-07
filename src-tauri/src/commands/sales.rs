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
pub struct PaymentModeRow {
    pub value: String,
    pub icon: String,
    pub treasury_account_id: Option<String>,
    pub fixed: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClientRow {
    pub id: String,
    pub name: String,
    pub phone: Option<String>,
    pub group_name: String,
    pub credit_limit: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct SaleRow {
    pub id: String,
    #[serde(rename = "ref")]
    pub sale_ref: String,
    pub client_id: Option<String>,
    pub client_name: Option<String>,
    pub seller_id: String,
    pub seller_name: String,
    pub state: String,
    pub subtotal: f64,
    pub discount: f64,
    pub total: f64,
    pub received: f64,
    pub remaining: f64,
    pub created_at: String,
    pub payment_labels: String, // "Comptant, Orange Money"
    pub returned_total: f64,    // somme des remboursements de retour sur cette vente
}

#[derive(Debug, Clone, Serialize)]
pub struct SaleItemRow {
    pub id: String,
    pub sale_id: String,
    pub product_id: Option<String>,
    pub product_code: String,
    pub product_name: String,
    pub variant: Option<String>,
    pub unit_name: Option<String>,
    pub qty: f64,
    pub unit_price: f64,
    pub orig_price: Option<f64>,
    pub line_total: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct SalePaymentRow {
    pub id: String,
    pub mode_label: String,
    pub amount: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct SaleDetail {
    pub sale: SaleRow,
    pub items: Vec<SaleItemRow>,
    pub payments: Vec<SalePaymentRow>,
}

// ---------------------------------------------------------------------------
// Structs d'entrée
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct SaleItemInput {
    pub product_id: String,
    pub product_code: String,
    pub product_name: String,
    pub variant: Option<String>,
    pub unit_name: Option<String>,
    pub qty: f64,
    pub unit_price: f64,
    pub orig_price: Option<f64>,
    /// Nombre d'unités de base par unité vendue (1 balle = 20 → facteur 20). Défaut 1.
    #[serde(default = "default_factor")]
    pub unit_factor: f64,
}

fn default_factor() -> f64 { 1.0 }

#[derive(Deserialize)]
pub struct SalePaymentInput {
    pub treasury_account_id: Option<String>,
    pub mode_label: String,
    pub amount: f64,
}

#[derive(Deserialize)]
pub struct CreateSaleInput {
    pub client_id: Option<String>,
    pub items: Vec<SaleItemInput>,
    pub payments: Vec<SalePaymentInput>,
    pub discount: f64,
    pub cash_session_id: Option<String>,
    /// Jeton anti-doublon : un même jeton ne crée qu'une seule vente.
    #[serde(default)]
    pub idempotency_key: Option<String>,
}

#[derive(Deserialize)]
pub struct CancelSaleInput {
    pub sale_id: String,
    pub reason: Option<String>,
}

#[derive(Deserialize)]
pub struct ReturnItemInput {
    pub sale_item_id: String,
    pub qty: f64,
}

#[derive(Deserialize)]
pub struct CreateReturnInput {
    pub sale_id: String,
    pub items: Vec<ReturnItemInput>,
    pub reason: Option<String>,
    pub refund_mode: String,
    /// Compte de trésorerie remboursé (None = espèces / caisse).
    pub refund_account_id: Option<String>,
    pub cash_session_id: Option<String>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn next_sale_ref(conn: &rusqlite::Connection, commerce_id: &str) -> KomersaResult<String> {
    let max: i64 = conn.query_row(
        "SELECT COALESCE(MAX(CAST(REPLACE(ref,'VTE-','') AS INTEGER)), 1000)
         FROM sales WHERE commerce_id = ?1",
        [commerce_id],
        |row| row.get(0),
    )?;
    Ok(format!("VTE-{:04}", max + 1))
}

fn icon_for_mode(mode: &str) -> &'static str {
    match mode {
        m if m.contains("Orange") => "wallet",
        m if m.contains("MTN") => "wallet",
        m if m.contains("Crédit") => "credits",
        m if m.contains("Carte") => "coin",
        _ => "cash",
    }
}

/// Compte de trésorerie « espèces » par défaut du commerce (pour tracer une
/// vente comptant faite hors session de caisse). None si aucun compte cash.
fn default_cash_account(conn: &rusqlite::Connection, commerce_id: &str) -> Option<String> {
    conn.query_row(
        "SELECT id FROM treasury_accounts
         WHERE commerce_id=?1 AND active=1 AND deleted=0 AND type='cash'
         ORDER BY ROWID LIMIT 1",
        [commerce_id], |r| r.get(0),
    ).ok()
}

/// Recharge une vente existante (utilisé pour la réponse idempotente).
fn load_sale_row(conn: &rusqlite::Connection, sale_id: &str) -> KomersaResult<SaleRow> {
    conn.query_row(
        "SELECT s.id, s.ref, s.client_id, cl.name, s.seller_id, a.name,
                s.state, s.subtotal, s.discount, s.total, s.received, s.remaining, s.created_at,
                (SELECT GROUP_CONCAT(mode_label, ', ') FROM sale_payments WHERE sale_id = s.id),
                (SELECT COALESCE(SUM(refund_amount),0) FROM sale_returns WHERE sale_id = s.id)
         FROM sales s
         LEFT JOIN clients cl ON cl.id = s.client_id
         LEFT JOIN accounts a ON a.id = s.seller_id
         WHERE s.id = ?1",
        [sale_id],
        |row| Ok(SaleRow {
            id: row.get(0)?, sale_ref: row.get(1)?,
            client_id: row.get(2)?, client_name: row.get(3)?,
            seller_id: row.get(4)?,
            seller_name: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
            state: row.get(6)?, subtotal: row.get(7)?, discount: row.get(8)?,
            total: row.get(9)?, received: row.get(10)?, remaining: row.get(11)?,
            created_at: row.get(12)?,
            payment_labels: row.get::<_, Option<String>>(13)?.unwrap_or_default(),
            returned_total: row.get(14)?,
        }),
    ).map_err(|_| KomersaError::NotFound)
}

// ---------------------------------------------------------------------------
// Commandes
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_payment_modes(
    db: State<Database>,
    session: State<SessionState>,
) -> KomersaResult<Vec<PaymentModeRow>> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();

    // Comptant (fixe)
    let mut modes = vec![PaymentModeRow {
        value: "Comptant".into(),
        icon: "cash".into(),
        treasury_account_id: None,
        fixed: true,
    }];

    // Comptes de trésorerie actifs marqués comme moyen de paiement
    let mut stmt = conn.prepare(
        "SELECT id, title, type FROM treasury_accounts
         WHERE commerce_id = ?1 AND active = 1 AND as_payment = 1
         ORDER BY ROWID",
    )?;
    let accounts = stmt.query_map([&sess.commerce_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
    })?;

    for acc in accounts.flatten() {
        let icon = match acc.2.as_str() {
            "momo" => "wallet",
            "bank" => "treasury",
            "card" => "coin",
            _ => "cash",
        };
        modes.push(PaymentModeRow {
            value: acc.1,
            icon: icon.into(),
            treasury_account_id: Some(acc.0),
            fixed: false,
        });
    }

    // Crédit client (fixe, en dernier)
    modes.push(PaymentModeRow {
        value: "Crédit client".into(),
        icon: "credits".into(),
        treasury_account_id: None,
        fixed: true,
    });

    Ok(modes)
}

#[tauri::command]
pub fn list_clients(
    db: State<Database>,
    session: State<SessionState>,
) -> KomersaResult<Vec<ClientRow>> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();

    let mut stmt = conn.prepare(
        "SELECT id, name, phone, group_name, credit_limit
         FROM clients WHERE commerce_id = ?1 AND status = 'Actif'
         ORDER BY name COLLATE NOCASE",
    )?;
    let rows = stmt
        .query_map([&sess.commerce_id], |row| {
            Ok(ClientRow {
                id: row.get(0)?,
                name: row.get(1)?,
                phone: row.get(2)?,
                group_name: row.get(3)?,
                credit_limit: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn create_sale(
    db: State<Database>,
    session: State<SessionState>,
    input: CreateSaleInput,
) -> KomersaResult<SaleRow> {
    if input.items.is_empty() {
        return Err(KomersaError::Validation("Le ticket est vide.".into()));
    }

    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::CreerVente)?;

    // Anti-doublon : si ce jeton a déjà créé une vente, renvoyer celle-ci sans rien refaire.
    if let Some(ref key) = input.idempotency_key {
        let existing: Option<String> = conn.query_row(
            "SELECT id FROM sales WHERE commerce_id=?1 AND idempotency_key=?2",
            rusqlite::params![sess.commerce_id, key], |r| r.get(0),
        ).ok();
        if let Some(id) = existing {
            return load_sale_row(&conn, &id);
        }
    }

    // Caisse du vendeur : chaque utilisateur a SA propre caisse. On résout sa session
    // ouverte côté serveur (on ne fait pas confiance au cash_session_id envoyé par le front).
    let my_open_session: Option<String> = conn.query_row(
        "SELECT id FROM cash_sessions WHERE commerce_id=?1 AND seller_id=?2 AND status='open' LIMIT 1",
        rusqlite::params![sess.commerce_id, sess.account_id], |r| r.get(0),
    ).ok();

    // Règle de caisse : si require_cash_open est actif, le vendeur doit avoir SA caisse ouverte.
    if crate::commands::settings::get_bool(&conn, &sess.commerce_id, "require_cash_open", false)
        && my_open_session.is_none()
    {
        return Err(KomersaError::Validation(
            "Aucune caisse ouverte à votre nom. Ouvrez votre caisse avant d'enregistrer une vente.".into(),
        ));
    }

    // Vérifier la permission crédit si applicable
    let has_credit = input.payments.iter().any(|p| p.mode_label == "Crédit client");
    if has_credit {
        permissions::check(&conn, &sess.membership_id, &sess.role, Permission::VenteACredit)?;
    }

    // Calculer le sous-total
    let subtotal: f64 = input.items.iter().map(|it| it.qty * it.unit_price).sum();
    let discount = input.discount.max(0.0).min(subtotal);
    let total = subtotal - discount;

    // Montant reçu (hors crédit). Capé au total : un surpaiement comptant = rendu, pas un "reçu".
    let received_raw: f64 = input
        .payments
        .iter()
        .filter(|p| p.mode_label != "Crédit client")
        .map(|p| p.amount)
        .sum();
    let received = received_raw.min(total);
    let credit_amount: f64 = input
        .payments
        .iter()
        .filter(|p| p.mode_label == "Crédit client")
        .map(|p| p.amount)
        .sum();
    let remaining = (total - received).max(0.0);

    // Une part à crédit exige un client (sinon créance perdue).
    if credit_amount > 0.0 && input.client_id.is_none() {
        return Err(KomersaError::Validation(
            "Une vente à crédit nécessite un client. Sélectionnez un client ou changez le mode de paiement.".into(),
        ));
    }

    // Déterminer le statut
    let state = if credit_amount > 0.0 && received == 0.0 {
        "Crédit"
    } else if received < total && credit_amount == 0.0 {
        "Paiement partiel"
    } else if credit_amount > 0.0 && received > 0.0 {
        "Paiement partiel"
    } else {
        "Payée"
    };

    let sale_id = format!("SAL-{}", Uuid::new_v4().as_simple());
    let sale_ref = next_sale_ref(&conn, &sess.commerce_id)?;
    let now = chrono::Utc::now().to_rfc3339();

    // Transaction : toutes les écritures de la vente réussissent, ou aucune (rollback à la sortie).
    let tx = conn.unchecked_transaction()?;

    // Insérer la vente
    conn.execute(
        "INSERT INTO sales
           (id, commerce_id, ref, cash_session_id, client_id, seller_id, state,
            subtotal, discount, total, received, remaining, created_at, updated_at, idempotency_key)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?13,?14)",
        rusqlite::params![
            sale_id, sess.commerce_id, sale_ref,
            my_open_session,
            input.client_id, sess.account_id, state,
            subtotal, discount, total, received, remaining, now,
            input.idempotency_key,
        ],
    )?;

    // Insérer les lignes + décrémenter le stock
    for item in &input.items {
        let item_id = format!("SIT-{}", Uuid::new_v4().as_simple());
        let line_total = item.qty * item.unit_price;
        // Quantité en unités de base (1 balle vendue = 20 rouleaux retirés du stock).
        let factor = if item.unit_factor > 0.0 { item.unit_factor } else { 1.0 };
        let base_qty = item.qty * factor;

        // Jamais de stock négatif : on ne vend pas plus que le disponible.
        // Vérifié AVANT décrément ; les lignes multiples du même produit cumulent
        // (chaque itération relit le stock déjà diminué).
        let available: f64 = conn.query_row(
            "SELECT stock FROM products WHERE id=?1 AND commerce_id=?2",
            rusqlite::params![item.product_id, sess.commerce_id], |r| r.get(0),
        ).unwrap_or(0.0);
        if base_qty > available + 1e-6 {
            return Err(KomersaError::Validation(format!(
                "Stock insuffisant pour « {} » : {} en stock, {} demandé.",
                item.product_name, available, base_qty,
            )));
        }
        // Déclinaison à stock distinct : même garde.
        if let Some(ref variant_value) = item.variant {
            let vstock: Option<f64> = conn.query_row(
                "SELECT stock FROM product_variants WHERE product_id=?1 AND value=?2",
                rusqlite::params![item.product_id, variant_value],
                |r| r.get::<_, Option<f64>>(0),
            ).ok().flatten();
            if let Some(vs) = vstock {
                if base_qty > vs + 1e-6 {
                    return Err(KomersaError::Validation(format!(
                        "Stock insuffisant pour « {} » ({}) : {} en stock.",
                        item.product_name, variant_value, vs,
                    )));
                }
            }
        }

        conn.execute(
            "INSERT INTO sale_items
               (id, sale_id, product_id, product_code, product_name, variant,
                unit_name, qty, unit_price, orig_price, line_total, unit_factor)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            rusqlite::params![
                item_id, sale_id, item.product_id, item.product_code,
                item.product_name, item.variant, item.unit_name,
                item.qty, item.unit_price, item.orig_price, line_total, factor,
            ],
        )?;

        // Décrémenter le stock global du produit (en unités de base).
        conn.execute(
            "UPDATE products SET stock = stock - ?2, updated_at = ?3
             WHERE id = ?1 AND commerce_id = ?4",
            rusqlite::params![item.product_id, base_qty, now, sess.commerce_id],
        )?;
        // Si la vente concerne une déclinaison à stock distinct, décrémenter aussi son stock.
        if let Some(ref variant_value) = item.variant {
            conn.execute(
                "UPDATE product_variants SET stock = stock - ?3
                 WHERE product_id = ?1 AND value = ?2 AND stock IS NOT NULL",
                rusqlite::params![item.product_id, variant_value, base_qty],
            )?;
        }
    }

    // Insérer les paiements
    let mut payment_labels: Vec<String> = vec![];
    for payment in &input.payments {
        let pay_id = format!("PAY-{}", Uuid::new_v4().as_simple());
        conn.execute(
            "INSERT INTO sale_payments (id, sale_id, treasury_account_id, mode_label, amount)
             VALUES (?1,?2,?3,?4,?5)",
            rusqlite::params![
                pay_id, sale_id,
                payment.treasury_account_id, payment.mode_label, payment.amount,
            ],
        )?;
        payment_labels.push(payment.mode_label.clone());

        if payment.mode_label != "Crédit client" {
            // Mouvement de caisse uniquement pour les ESPÈCES (Comptant, sans compte) et
            // seulement si une session est ouverte. Les paiements adossés à un compte
            // (Mobile Money, banque…) ne touchent pas le tiroir → ils sont tracés dans le
            // relevé du compte, pas dans la caisse.
            if payment.treasury_account_id.is_none() {
                if let Some(ref session_id) = my_open_session {
                    let mv_id = format!("CMV-{}", Uuid::new_v4().as_simple());
                    conn.execute(
                        "INSERT INTO cash_movements
                           (id, cash_session_id, commerce_id, ref, type, detail, mode_label,
                            amount, seller_id, created_at)
                         VALUES (?1,?2,?3,?4,'Vente',?5,'Comptant',?6,?7,?8)",
                        rusqlite::params![
                            mv_id, session_id, sess.commerce_id, sale_ref,
                            format!("{} ×{}", input.items[0].product_name, input.items.len()),
                            payment.amount, sess.account_id, now,
                        ],
                    )?;
                }
            }

            // Suivi de l'argent dans la trésorerie :
            //  - paiement adossé à un compte (Mobile Money, banque, carte) → on crédite ce compte ;
            //  - paiement comptant SANS session de caisse → on crédite le compte « espèces » par défaut
            //    (avec session, l'espèce est suivie par le cycle caisse → remise, on ne double pas).
            let credit_target: Option<String> = if let Some(ref aid) = payment.treasury_account_id {
                Some(aid.clone())
            } else if my_open_session.is_none() {
                default_cash_account(&conn, &sess.commerce_id)
            } else {
                None
            };
            if let Some(account_id) = credit_target {
                conn.execute(
                    "UPDATE treasury_accounts SET balance=balance+?2, updated_at=?3
                     WHERE id=?1 AND commerce_id=?4",
                    rusqlite::params![account_id, payment.amount.round(), now, sess.commerce_id],
                )?;
                crate::commands::treasury::record_movement(
                    &conn, &sess.commerce_id, &account_id, payment.amount.round(), "sale",
                    &format!("Vente {sale_ref}"), &now,
                )?;
            }
        }
    }

    // Créer un crédit client si nécessaire
    if credit_amount > 0.0 {
        if let Some(ref client_id) = input.client_id {
            let credit_id = format!("CRD-{}", Uuid::new_v4().as_simple());
            conn.execute(
                "INSERT INTO customer_credits
                   (id, commerce_id, client_id, sale_id, initial, paid, remaining,
                    status, created_at, updated_at)
                 VALUES (?1,?2,?3,?4,?5,0,?5,'Ouvert',?6,?6)",
                rusqlite::params![
                    credit_id, sess.commerce_id, client_id, sale_id, credit_amount, now,
                ],
            )?;
        }
    }

    // Log sync
    conn.execute(
        "INSERT INTO sync_operations (id, commerce_id, entity_type, entity_id, operation, created_at)
         VALUES (?1,?2,'sale',?3,'insert',?4)",
        rusqlite::params![
            format!("SYN-{}", Uuid::new_v4().as_simple()),
            sess.commerce_id, sale_id, now
        ],
    )?;

    tx.commit()?;

    // Nom du vendeur
    let seller_name: String = conn
        .query_row("SELECT name FROM accounts WHERE id=?1", [&sess.account_id], |r| r.get(0))
        .unwrap_or_else(|_| sess.account_name.clone());

    // Nom du client
    let client_name: Option<String> = input.client_id.as_deref().and_then(|cid| {
        conn.query_row("SELECT name FROM clients WHERE id=?1", [cid], |r| r.get(0)).ok()
    });

    Ok(SaleRow {
        id: sale_id,
        sale_ref,
        client_id: input.client_id,
        client_name,
        seller_id: sess.account_id,
        seller_name,
        state: state.into(),
        subtotal, discount, total, received, remaining,
        created_at: now,
        payment_labels: payment_labels.join(", "),
        returned_total: 0.0,
    })
}

#[tauri::command]
pub fn list_sales(
    db: State<Database>,
    session: State<SessionState>,
    from: Option<String>,
    to: Option<String>,
    offset: Option<i64>,
    limit: Option<i64>,
) -> KomersaResult<Vec<SaleRow>> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::VoirVentes)?;

    let lim = limit.unwrap_or(50).clamp(1, 10000);
    let off = offset.unwrap_or(0).max(0);

    let mut stmt = conn.prepare(
        "SELECT s.id, s.ref, s.client_id, cl.name, s.seller_id, a.name,
                s.state, s.subtotal, s.discount, s.total, s.received, s.remaining,
                s.created_at,
                (SELECT GROUP_CONCAT(mode_label, ', ') FROM sale_payments WHERE sale_id = s.id) as modes,
                (SELECT COALESCE(SUM(refund_amount),0) FROM sale_returns WHERE sale_id = s.id) as returned
         FROM sales s
         LEFT JOIN clients cl ON cl.id = s.client_id
         LEFT JOIN accounts a ON a.id = s.seller_id
         WHERE s.commerce_id = ?1
           AND (?2 IS NULL OR date(s.created_at) >= date(?2))
           AND (?3 IS NULL OR date(s.created_at) <= date(?3))
         ORDER BY s.created_at DESC
         LIMIT ?4 OFFSET ?5",
    )?;

    let rows = stmt
        .query_map(rusqlite::params![sess.commerce_id, from, to, lim, off], |row| {
            Ok(SaleRow {
                id: row.get(0)?,
                sale_ref: row.get(1)?,
                client_id: row.get(2)?,
                client_name: row.get(3)?,
                seller_id: row.get(4)?,
                seller_name: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                state: row.get(6)?,
                subtotal: row.get(7)?,
                discount: row.get(8)?,
                total: row.get(9)?,
                received: row.get(10)?,
                remaining: row.get(11)?,
                created_at: row.get(12)?,
                payment_labels: row.get::<_, Option<String>>(13)?.unwrap_or_default(),
                returned_total: row.get(14)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(rows)
}

#[derive(Debug, Clone, Serialize)]
pub struct SalesMetrics {
    pub today_ca: f64,       // CA net du jour (ventes − retours)
    pub today_tickets: i64,
    pub avg_basket: f64,
    pub open_credits: i64,   // tickets en Crédit / Paiement partiel
}

#[tauri::command]
pub fn get_sales_metrics(
    db: State<Database>,
    session: State<SessionState>,
) -> KomersaResult<SalesMetrics> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::VoirVentes)?;

    let (gross, tickets): (f64, i64) = conn.query_row(
        "SELECT COALESCE(SUM(total),0), COUNT(*) FROM sales
         WHERE commerce_id=?1 AND state!='Annulée' AND date(created_at)=date('now')",
        [&sess.commerce_id], |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let returns: f64 = conn.query_row(
        "SELECT COALESCE(SUM(sr.refund_amount),0) FROM sale_returns sr
         JOIN sales s ON s.id=sr.sale_id
         WHERE s.commerce_id=?1 AND date(sr.created_at)=date('now')",
        [&sess.commerce_id], |r| r.get(0),
    ).unwrap_or(0.0);
    let today_ca = (gross - returns).max(0.0);
    let avg_basket = if tickets > 0 { today_ca / tickets as f64 } else { 0.0 };
    let open_credits: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sales WHERE commerce_id=?1 AND state IN ('Crédit','Paiement partiel')",
        [&sess.commerce_id], |r| r.get(0),
    )?;
    Ok(SalesMetrics { today_ca, today_tickets: tickets, avg_basket, open_credits })
}

#[tauri::command]
pub fn get_sale_detail(
    db: State<Database>,
    session: State<SessionState>,
    sale_id: String,
) -> KomersaResult<SaleDetail> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::VoirVentes)?;

    // Vente
    let sale = conn.query_row(
        "SELECT s.id, s.ref, s.client_id, cl.name, s.seller_id, a.name,
                s.state, s.subtotal, s.discount, s.total, s.received, s.remaining, s.created_at,
                (SELECT GROUP_CONCAT(mode_label, ', ') FROM sale_payments WHERE sale_id = s.id),
                (SELECT COALESCE(SUM(refund_amount),0) FROM sale_returns WHERE sale_id = s.id)
         FROM sales s
         LEFT JOIN clients cl ON cl.id = s.client_id
         LEFT JOIN accounts a ON a.id = s.seller_id
         WHERE s.id = ?1 AND s.commerce_id = ?2",
        rusqlite::params![sale_id, sess.commerce_id],
        |row| {
            Ok(SaleRow {
                id: row.get(0)?, sale_ref: row.get(1)?,
                client_id: row.get(2)?, client_name: row.get(3)?,
                seller_id: row.get(4)?,
                seller_name: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                state: row.get(6)?,
                subtotal: row.get(7)?, discount: row.get(8)?,
                total: row.get(9)?, received: row.get(10)?, remaining: row.get(11)?,
                created_at: row.get(12)?,
                payment_labels: row.get::<_, Option<String>>(13)?.unwrap_or_default(),
                returned_total: row.get(14)?,
            })
        },
    )
    .map_err(|_| KomersaError::NotFound)?;

    // Lignes
    let mut s_items = conn.prepare(
        "SELECT id, sale_id, product_id, product_code, product_name, variant,
                unit_name, qty, unit_price, orig_price, line_total
         FROM sale_items WHERE sale_id = ?1 ORDER BY rowid",
    )?;
    let items = s_items
        .query_map([&sale_id], |row| {
            Ok(SaleItemRow {
                id: row.get(0)?, sale_id: row.get(1)?,
                product_id: row.get(2)?, product_code: row.get(3)?,
                product_name: row.get(4)?, variant: row.get(5)?,
                unit_name: row.get(6)?, qty: row.get(7)?,
                unit_price: row.get(8)?, orig_price: row.get(9)?,
                line_total: row.get(10)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    // Paiements
    let mut s_pays = conn.prepare(
        "SELECT id, mode_label, amount FROM sale_payments WHERE sale_id = ?1 ORDER BY rowid",
    )?;
    let payments = s_pays
        .query_map([&sale_id], |row| {
            Ok(SalePaymentRow { id: row.get(0)?, mode_label: row.get(1)?, amount: row.get(2)? })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(SaleDetail { sale, items, payments })
}

#[tauri::command]
pub fn cancel_sale(
    db: State<Database>,
    session: State<SessionState>,
    input: CancelSaleInput,
) -> KomersaResult<()> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::AnnulerVente)?;

    let now = chrono::Utc::now().to_rfc3339();

    // Vérifier que la vente est annulable
    let state: String = conn
        .query_row(
            "SELECT state FROM sales WHERE id = ?1 AND commerce_id = ?2",
            rusqlite::params![input.sale_id, sess.commerce_id],
            |row| row.get(0),
        )
        .map_err(|_| KomersaError::NotFound)?;

    if state == "Annulée" {
        return Err(KomersaError::Validation("Cette vente est déjà annulée.".into()));
    }

    // Transaction : remise en stock + solde crédit + annulation atomiques.
    let tx = conn.unchecked_transaction()?;

    // Remettre le stock (en unités de base = qty × facteur), déclinaison incluse.
    let mut items_stmt = conn.prepare(
        "SELECT product_id, qty, unit_factor, variant FROM sale_items WHERE sale_id = ?1",
    )?;
    let items: Vec<(String, f64, f64, Option<String>)> = items_stmt
        .query_map([&input.sale_id], |row| {
            Ok((
                row.get::<_, Option<String>>(0)?.unwrap_or_default(),
                row.get::<_, f64>(1)?,
                row.get::<_, f64>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    for (product_id, qty, factor, variant) in items {
        if !product_id.is_empty() {
            let base_qty = qty * if factor > 0.0 { factor } else { 1.0 };
            conn.execute(
                "UPDATE products SET stock = stock + ?2, updated_at = ?3 WHERE id = ?1",
                rusqlite::params![product_id, base_qty, now],
            )?;
            if let Some(variant_value) = variant {
                conn.execute(
                    "UPDATE product_variants SET stock = stock + ?3
                     WHERE product_id = ?1 AND value = ?2 AND stock IS NOT NULL",
                    rusqlite::params![product_id, variant_value, base_qty],
                )?;
            }
        }
    }

    // Annuler les crédits de trésorerie produits par cette vente (symétrie avec create_sale) :
    //  - paiement adossé à un compte → débiter ce compte ;
    //  - paiement comptant d'une vente faite SANS session de caisse → débiter le compte « espèces ».
    let had_session: bool = conn.query_row(
        "SELECT cash_session_id IS NOT NULL FROM sales WHERE id=?1",
        [&input.sale_id], |r| r.get(0),
    ).unwrap_or(false);
    let mut pay_stmt = conn.prepare(
        "SELECT mode_label, treasury_account_id, amount FROM sale_payments WHERE sale_id=?1",
    )?;
    let pays: Vec<(String, Option<String>, f64)> = pay_stmt.query_map([&input.sale_id], |r| {
        Ok((r.get(0)?, r.get(1)?, r.get(2)?))
    })?.collect::<Result<Vec<_>, _>>()?;
    drop(pay_stmt);
    for (mode, account_id, amount) in pays {
        if mode == "Crédit client" { continue; }
        let target = if let Some(aid) = account_id {
            Some(aid)
        } else if !had_session {
            default_cash_account(&conn, &sess.commerce_id)
        } else {
            None
        };
        if let Some(aid) = target {
            conn.execute(
                "UPDATE treasury_accounts SET balance=balance-?2, updated_at=?3 WHERE id=?1 AND commerce_id=?4",
                rusqlite::params![aid, amount.round(), now, sess.commerce_id],
            )?;
            crate::commands::treasury::record_movement(
                &conn, &sess.commerce_id, &aid, -amount.round(), "sale_cancel", "Annulation vente", &now,
            )?;
        }
    }

    // Solder le crédit client éventuellement créé par cette vente (plus de créance fantôme).
    conn.execute(
        "UPDATE customer_credits SET remaining = 0, status = 'Soldé', updated_at = ?2
         WHERE sale_id = ?1 AND status != 'Soldé'",
        rusqlite::params![input.sale_id, now],
    )?;

    conn.execute(
        "UPDATE sales SET state = 'Annulée', cancelled_reason = ?2, updated_at = ?3
         WHERE id = ?1",
        rusqlite::params![input.sale_id, input.reason, now],
    )?;

    // Mouvement de caisse visible pour l'annulation (part espèces remboursée).
    // Il porte la référence de la vente, donc il est exclu du calcul de l'attendu
    // comme la vente d'origine : l'attendu reste juste, et la sortie apparaît dans la liste.
    let (sale_ref, cs_id): (String, Option<String>) = conn.query_row(
        "SELECT ref, cash_session_id FROM sales WHERE id=?1",
        [&input.sale_id], |r| Ok((r.get(0)?, r.get(1)?)),
    ).map_err(|_| KomersaError::NotFound)?;
    let cash_amount: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount),0) FROM sale_payments WHERE sale_id=?1 AND mode_label='Comptant'",
        [&input.sale_id], |r| r.get(0),
    ).unwrap_or(0.0);
    if let (Some(session_id), true) = (cs_id, cash_amount > 0.0) {
        conn.execute(
            "INSERT INTO cash_movements
               (id, cash_session_id, commerce_id, ref, type, detail, mode_label, amount, seller_id, created_at)
             VALUES (?1,?2,?3,?4,'Annulation',?5,'Comptant',?6,?7,?8)",
            rusqlite::params![
                format!("CMV-{}", Uuid::new_v4().as_simple()),
                session_id, sess.commerce_id, sale_ref,
                format!("Annulation vente {sale_ref}"),
                -cash_amount.round(), sess.account_id, now,
            ],
        )?;
    }

    let sale_total: f64 = conn.query_row("SELECT total FROM sales WHERE id=?1", [&input.sale_id], |r| r.get(0)).unwrap_or(0.0);
    crate::commands::audit::record_audit(&conn, &sess.commerce_id, &sess.account_id, &sess.account_name,
        "sale_cancel",
        &format!("Vente {} annulée{}", sale_ref,
            input.reason.as_deref().map(|r| format!(" — {r}")).unwrap_or_default()),
        Some(&sale_ref), Some(sale_total));

    tx.commit()?;
    Ok(())
}

#[tauri::command]
pub fn create_sale_return(
    db: State<Database>,
    session: State<SessionState>,
    input: CreateReturnInput,
) -> KomersaResult<f64> {
    if input.items.is_empty() {
        return Err(KomersaError::Validation("Aucun article à retourner.".into()));
    }

    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::AnnulerVente)?;

    let now = chrono::Utc::now().to_rfc3339();

    // Vente : état + ratio net (pour rembourser au prorata d'une éventuelle remise).
    let (state, subtotal, total): (String, f64, f64) = conn
        .query_row(
            "SELECT state, subtotal, total FROM sales WHERE id = ?1 AND commerce_id = ?2",
            rusqlite::params![input.sale_id, sess.commerce_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|_| KomersaError::NotFound)?;

    if state == "Annulée" {
        return Err(KomersaError::Validation("Vente annulée : retour impossible.".into()));
    }
    let ratio = if subtotal > 0.0 { total / subtotal } else { 1.0 };

    let tx = conn.unchecked_transaction()?;

    // Valider chaque ligne + préparer restock et remboursement.
    struct Prepared { sale_item_id: String, qty: f64, refund: f64, product_id: Option<String>, base_qty: f64, variant: Option<String> }
    let mut prepared: Vec<Prepared> = Vec::new();
    let mut total_refund = 0.0;

    for it in &input.items {
        if it.qty <= 0.0 { continue; }

        // Ligne d'origine (et appartenance à la vente).
        let (product_id, orig_qty, unit_price, factor, variant): (Option<String>, f64, f64, f64, Option<String>) = conn
            .query_row(
                "SELECT product_id, qty, unit_price, unit_factor, variant
                 FROM sale_items WHERE id = ?1 AND sale_id = ?2",
                rusqlite::params![it.sale_item_id, input.sale_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .map_err(|_| KomersaError::NotFound)?;

        // Déjà retourné sur cette ligne ?
        let already: f64 = conn.query_row(
            "SELECT COALESCE(SUM(qty),0) FROM sale_return_items WHERE sale_item_id = ?1",
            [&it.sale_item_id], |r| r.get(0),
        ).unwrap_or(0.0);

        if already + it.qty > orig_qty + 0.0001 {
            return Err(KomersaError::Validation(
                "Quantité retournée supérieure à la quantité vendue.".into(),
            ));
        }

        let refund = (it.qty * unit_price * ratio).round();
        total_refund += refund;
        let base_qty = it.qty * if factor > 0.0 { factor } else { 1.0 };
        prepared.push(Prepared {
            sale_item_id: it.sale_item_id.clone(), qty: it.qty, refund,
            product_id, base_qty, variant,
        });
    }

    if prepared.is_empty() {
        return Err(KomersaError::Validation("Aucune quantité valide à retourner.".into()));
    }

    // Enregistrer le retour.
    let return_id = format!("RET-{}", Uuid::new_v4().as_simple());
    conn.execute(
        "INSERT INTO sale_returns (id, sale_id, seller_id, reason, refund_amount, refund_mode, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7)",
        rusqlite::params![
            return_id, input.sale_id, sess.account_id, input.reason,
            total_refund, input.refund_mode, now,
        ],
    )?;

    for p in &prepared {
        conn.execute(
            "INSERT INTO sale_return_items (id, return_id, sale_item_id, qty, refund)
             VALUES (?1,?2,?3,?4,?5)",
            rusqlite::params![
                format!("RTI-{}", Uuid::new_v4().as_simple()),
                return_id, p.sale_item_id, p.qty, p.refund,
            ],
        )?;
        // Remettre le stock (unités de base), déclinaison incluse.
        if let Some(ref pid) = p.product_id {
            conn.execute(
                "UPDATE products SET stock = stock + ?2, updated_at = ?3 WHERE id = ?1",
                rusqlite::params![pid, p.base_qty, now],
            )?;
            if let Some(ref variant_value) = p.variant {
                conn.execute(
                    "UPDATE product_variants SET stock = stock + ?3
                     WHERE product_id = ?1 AND value = ?2 AND stock IS NOT NULL",
                    rusqlite::params![pid, variant_value, p.base_qty],
                )?;
            }
        }
    }

    // Caisse du vendeur pour un remboursement espèces (résolue côté serveur).
    let my_open_session: Option<String> = conn.query_row(
        "SELECT id FROM cash_sessions WHERE commerce_id=?1 AND seller_id=?2 AND status='open' LIMIT 1",
        rusqlite::params![sess.commerce_id, sess.account_id], |r| r.get(0),
    ).ok();

    // Sortie d'argent : compte de trésorerie OU caisse (espèces).
    if let Some(ref account_id) = input.refund_account_id {
        crate::commands::treasury::ensure_balance(&conn, &sess.commerce_id, account_id, total_refund.round())?;
        conn.execute(
            "UPDATE treasury_accounts SET balance = balance - ?2, updated_at = ?3
             WHERE id = ?1 AND commerce_id = ?4",
            rusqlite::params![account_id, total_refund, now, sess.commerce_id],
        )?;
        crate::commands::treasury::record_movement(
            &conn, &sess.commerce_id, account_id, -total_refund.round(), "return", "Remboursement retour", &now,
        )?;
    } else if let Some(ref session_id) = my_open_session {
        // Remboursement espèces : mouvement négatif compté dans la caisse.
        conn.execute(
            "INSERT INTO cash_movements
               (id, cash_session_id, commerce_id, ref, type, detail, mode_label, amount, seller_id, created_at)
             VALUES (?1,?2,?3,?4,'Retour',?5,'Comptant',?6,?7,?8)",
            rusqlite::params![
                format!("CMV-{}", Uuid::new_v4().as_simple()),
                session_id, sess.commerce_id,
                format!("RET-{}", &return_id[4..10.min(return_id.len())]),
                input.reason.clone().unwrap_or_else(|| "Retour client".into()),
                -total_refund, sess.account_id, now,
            ],
        )?;
    }

    // Marquer la vente comme retournée (au moins partiellement).
    conn.execute(
        "UPDATE sales SET state = 'Retour partiel', updated_at = ?2 WHERE id = ?1",
        rusqlite::params![input.sale_id, now],
    )?;

    tx.commit()?;
    Ok(total_refund)
}
