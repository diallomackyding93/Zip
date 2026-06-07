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
pub struct InventorySessionRow {
    pub id: String,
    pub title: String,
    pub scope: String,
    pub scope_value: Option<String>,
    pub blind_count: bool,
    pub responsible_name: Option<String>,
    pub status: String,
    pub created_at: String,
    pub closed_at: Option<String>,
    pub total_lines: i64,
    pub counted_lines: i64,
    pub variances: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct InventoryCountRow {
    pub id: String,
    pub product_id: String,
    pub product_code: String,
    pub product_name: String,
    pub variant_id: Option<String>,
    pub variant_value: Option<String>,
    pub location: Option<String>,
    pub system_qty: Option<f64>,
    pub counted_qty: Option<f64>,
    pub variance: Option<f64>,
    pub applied: bool,
}

// ---------------------------------------------------------------------------
// Structs d'entrée
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct CreateInventorySessionInput {
    pub title: String,
    pub scope: String,        // 'all' | 'category' | 'alert'
    pub scope_value: Option<String>,
    pub blind_count: bool,
}

#[derive(Deserialize)]
pub struct SaveCountInput {
    pub count_id: String,
    pub counted_qty: f64,
}

// ---------------------------------------------------------------------------
// Commandes
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_inventory_sessions(
    db: State<Database>,
    session: State<SessionState>,
) -> KomersaResult<Vec<InventorySessionRow>> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::GererInventaire)?;

    let mut stmt = conn.prepare(
        "SELECT s.id, s.title, s.scope, s.scope_value, s.blind_count,
                a.name, s.status, s.created_at, s.closed_at,
                (SELECT COUNT(*) FROM inventory_counts WHERE session_id=s.id),
                (SELECT COUNT(*) FROM inventory_counts WHERE session_id=s.id AND counted_qty IS NOT NULL),
                (SELECT COUNT(*) FROM inventory_counts WHERE session_id=s.id AND variance IS NOT NULL AND variance != 0)
         FROM inventory_sessions s
         LEFT JOIN accounts a ON a.id = s.responsible_id
         WHERE s.commerce_id=?1
         ORDER BY s.created_at DESC LIMIT 50",
    )?;
    let rows = stmt.query_map([&sess.commerce_id], |row| {
        Ok(InventorySessionRow {
            id: row.get(0)?, title: row.get(1)?, scope: row.get(2)?,
            scope_value: row.get(3)?, blind_count: row.get::<_, i32>(4)? != 0,
            responsible_name: row.get(5)?, status: row.get(6)?,
            created_at: row.get(7)?, closed_at: row.get(8)?,
            total_lines: row.get(9)?, counted_lines: row.get(10)?, variances: row.get(11)?,
        })
    })?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn create_inventory_session(
    db: State<Database>,
    session: State<SessionState>,
    input: CreateInventorySessionInput,
) -> KomersaResult<InventorySessionRow> {
    if input.title.trim().is_empty() {
        return Err(KomersaError::Validation("L'intitulé est requis.".into()));
    }

    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::GererInventaire)?;

    let id = format!("INV-{}", Uuid::new_v4().as_simple());
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO inventory_sessions
           (id, commerce_id, title, scope, scope_value, blind_count, responsible_id, status, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,'open',?8)",
        rusqlite::params![
            id, sess.commerce_id, input.title.trim(), input.scope,
            input.scope_value.as_deref(), input.blind_count as i32, sess.account_id, now,
        ],
    )?;

    // Snapshot des produits dans le périmètre → lignes de comptage
    let products_sql = match input.scope.as_str() {
        "category" => "SELECT id, code, name, stock FROM products
                       WHERE commerce_id=?1 AND active=1 AND category_id=(
                         SELECT id FROM categories WHERE commerce_id=?1 AND name=?2 LIMIT 1)",
        "alert" => "SELECT id, code, name, stock FROM products
                    WHERE commerce_id=?1 AND active=1 AND stock_min>0 AND stock<=stock_min",
        _ => "SELECT id, code, name, stock FROM products WHERE commerce_id=?1 AND active=1",
    };

    let products: Vec<(String, String, String, f64)> = {
        let mut stmt = conn.prepare(products_sql)?;
        let mapped = if input.scope == "category" {
            stmt.query_map(
                rusqlite::params![sess.commerce_id, input.scope_value.as_deref().unwrap_or("")],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )?.collect::<Result<Vec<_>, _>>()?
        } else {
            stmt.query_map(
                [&sess.commerce_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )?.collect::<Result<Vec<_>, _>>()?
        };
        mapped
    };

    let mut total_lines = 0i64;
    for (pid, _code, _name, stock) in &products {
        // Déclinaisons à stock distinct (stock IS NOT NULL) → une ligne de comptage par déclinaison.
        let mut vstmt = conn.prepare(
            "SELECT id, COALESCE(stock,0) FROM product_variants
             WHERE product_id=?1 AND stock IS NOT NULL ORDER BY sort_order",
        )?;
        let variants: Vec<(String, f64)> = vstmt
            .query_map([pid], |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        drop(vstmt);

        if variants.is_empty() {
            let count_id = format!("CNT-{}", Uuid::new_v4().as_simple());
            conn.execute(
                "INSERT INTO inventory_counts (id, session_id, product_id, system_qty)
                 VALUES (?1,?2,?3,?4)",
                rusqlite::params![count_id, id, pid, stock],
            )?;
            total_lines += 1;
        } else {
            for (vid, vstock) in &variants {
                let count_id = format!("CNT-{}", Uuid::new_v4().as_simple());
                conn.execute(
                    "INSERT INTO inventory_counts (id, session_id, product_id, product_variant_id, system_qty)
                     VALUES (?1,?2,?3,?4,?5)",
                    rusqlite::params![count_id, id, pid, vid, vstock],
                )?;
                total_lines += 1;
            }
        }
    }

    let responsible_name: Option<String> = conn.query_row(
        "SELECT name FROM accounts WHERE id=?1", [&sess.account_id], |r| r.get(0),
    ).ok();

    Ok(InventorySessionRow {
        id, title: input.title.trim().into(), scope: input.scope,
        scope_value: input.scope_value, blind_count: input.blind_count,
        responsible_name, status: "open".into(),
        created_at: now, closed_at: None,
        total_lines, counted_lines: 0, variances: 0,
    })
}

#[tauri::command]
pub fn list_inventory_counts(
    db: State<Database>,
    session: State<SessionState>,
    session_id: String,
) -> KomersaResult<Vec<InventoryCountRow>> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::GererInventaire)?;

    // Vérifier appartenance
    let belongs: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM inventory_sessions WHERE id=?1 AND commerce_id=?2)",
        rusqlite::params![session_id, sess.commerce_id], |r| r.get(0),
    )?;
    if !belongs { return Err(KomersaError::NotFound); }

    let mut stmt = conn.prepare(
        "SELECT ic.id, ic.product_id, p.code, p.name, ic.product_variant_id, pv.value,
                ic.location, ic.system_qty, ic.counted_qty, ic.variance, ic.applied
         FROM inventory_counts ic
         JOIN products p ON p.id = ic.product_id
         LEFT JOIN product_variants pv ON pv.id = ic.product_variant_id
         WHERE ic.session_id=?1
         ORDER BY p.name COLLATE NOCASE, pv.sort_order",
    )?;
    let rows = stmt.query_map([&session_id], |row| {
        Ok(InventoryCountRow {
            id: row.get(0)?, product_id: row.get(1)?, product_code: row.get(2)?,
            product_name: row.get(3)?, variant_id: row.get(4)?, variant_value: row.get(5)?,
            location: row.get(6)?, system_qty: row.get(7)?, counted_qty: row.get(8)?,
            variance: row.get(9)?, applied: row.get::<_, i32>(10)? != 0,
        })
    })?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn save_inventory_count(
    db: State<Database>,
    session: State<SessionState>,
    input: SaveCountInput,
) -> KomersaResult<f64> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::GererInventaire)?;

    let system_qty: f64 = conn.query_row(
        "SELECT ic.system_qty FROM inventory_counts ic
         JOIN inventory_sessions s ON s.id = ic.session_id
         WHERE ic.id=?1 AND s.commerce_id=?2 AND s.status='open'",
        rusqlite::params![input.count_id, sess.commerce_id], |r| r.get(0),
    ).map_err(|_| KomersaError::NotFound)?;

    let variance = input.counted_qty - system_qty;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE inventory_counts SET counted_qty=?2, variance=?3, counted_at=?4 WHERE id=?1",
        rusqlite::params![input.count_id, input.counted_qty, variance, now],
    )?;
    Ok(variance)
}

#[tauri::command]
pub fn close_inventory_session(
    db: State<Database>,
    session: State<SessionState>,
    session_id: String,
) -> KomersaResult<i64> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::GererInventaire)?;

    let status: String = conn.query_row(
        "SELECT status FROM inventory_sessions WHERE id=?1 AND commerce_id=?2",
        rusqlite::params![session_id, sess.commerce_id], |r| r.get(0),
    ).map_err(|_| KomersaError::NotFound)?;

    if status != "open" {
        return Err(KomersaError::Validation("Cette session est déjà clôturée.".into()));
    }

    let now = chrono::Utc::now().to_rfc3339();
    let tx = conn.unchecked_transaction()?;

    // Lignes comptées : (count_id, product_id, variant_id, counted_qty)
    let mut counted_stmt = conn.prepare(
        "SELECT id, product_id, product_variant_id, counted_qty FROM inventory_counts
         WHERE session_id=?1 AND counted_qty IS NOT NULL AND applied=0",
    )?;
    let counted: Vec<(String, String, Option<String>, f64)> = counted_stmt
        .query_map([&session_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?.collect::<Result<Vec<_>, _>>()?;
    drop(counted_stmt);

    let mut applied = 0i64;
    let mut variant_products: std::collections::HashSet<String> = std::collections::HashSet::new();
    for (count_id, product_id, variant_id, counted_qty) in &counted {
        match variant_id {
            // Ligne de déclinaison → ajuster le stock de la déclinaison.
            Some(vid) => {
                conn.execute(
                    "UPDATE product_variants SET stock=?2 WHERE id=?1",
                    rusqlite::params![vid, counted_qty],
                )?;
                variant_products.insert(product_id.clone());
            }
            // Ligne produit → ajuster le stock global.
            None => {
                conn.execute(
                    "UPDATE products SET stock=?2, updated_at=?3 WHERE id=?1 AND commerce_id=?4",
                    rusqlite::params![product_id, counted_qty, now, sess.commerce_id],
                )?;
            }
        }
        conn.execute("UPDATE inventory_counts SET applied=1 WHERE id=?1", [count_id])?;
        applied += 1;
    }

    // Pour les produits comptés par déclinaison : stock produit = somme des déclinaisons.
    for pid in &variant_products {
        conn.execute(
            "UPDATE products SET stock=COALESCE((SELECT SUM(stock) FROM product_variants
                WHERE product_id=?1 AND stock IS NOT NULL),0), updated_at=?2
             WHERE id=?1 AND commerce_id=?3",
            rusqlite::params![pid, now, sess.commerce_id],
        )?;
    }

    conn.execute(
        "UPDATE inventory_sessions SET status='closed', closed_at=?2 WHERE id=?1",
        rusqlite::params![session_id, now],
    )?;

    tx.commit()?;
    Ok(applied)
}
