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
pub struct StockMetrics {
    pub total: i64,
    pub low_stock: i64,
    pub rupture: i64,
    pub stock_value: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct CategoryRow {
    pub id: String,
    pub name: String,
    pub sort_order: i32,
}

#[derive(Debug, Clone, Serialize)]
pub struct SupplierRow {
    pub id: String,
    pub code: Option<String>,
    pub name: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub city: Option<String>,
    pub category: Option<String>,
    pub status: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct UnitRow {
    pub id: String,
    pub product_id: String,
    pub name: String,
    pub factor: f64,
    pub price: f64,
    pub ref_unit_id: Option<String>,
    pub sort_order: i32,
}

#[derive(Debug, Clone, Serialize)]
pub struct VariantRow {
    pub id: String,
    pub product_id: String,
    pub value: String,
    pub stock: Option<f64>,
    pub price: Option<f64>,
    pub barcode: Option<String>,
    pub sort_order: i32,
}

/// Cellule de la matrice de prix : prix d'un couple (unité, déclinaison).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceCell {
    pub unit: String,    // nom de l'unité (l'unité de base est nommée par base_unit)
    pub variant: String, // valeur de la déclinaison
    pub price: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProductRow {
    pub id: String,
    pub code: String,
    pub name: String,
    pub category_id: Option<String>,
    pub category_name: Option<String>,
    pub supplier_id: Option<String>,
    pub supplier_name: Option<String>,
    pub base_unit: String,
    pub stock: f64,
    pub stock_min: f64,
    pub stock_max: Option<f64>,
    pub cost: f64,
    pub price: f64,
    pub active: bool,
    pub photo_path: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub units: Vec<UnitRow>,
    pub variants: Vec<VariantRow>,
    pub prices: Vec<PriceCell>,
}

// ---------------------------------------------------------------------------
// Structs d'entrée
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct UnitInput {
    pub name: String,
    pub factor: f64,
    pub price: f64,
    pub ref_unit_id: Option<String>,
}

#[derive(Deserialize)]
pub struct VariantInput {
    pub value: String,
    pub stock: Option<f64>,
    pub price: Option<f64>,
    pub barcode: Option<String>,
}

#[derive(Deserialize)]
pub struct CreateProductInput {
    pub code: String,
    pub name: String,
    /// ID d'une catégorie existante, ou None si catégorie_name fourni
    pub category_id: Option<String>,
    /// Nom à créer à la volée si category_id absent
    pub category_name: Option<String>,
    pub supplier_id: Option<String>,
    pub supplier_name: Option<String>,
    pub base_unit: String,
    pub stock: f64,
    pub stock_min: f64,
    pub stock_max: Option<f64>,
    pub cost: f64,
    pub price: f64,
    pub units: Vec<UnitInput>,
    pub variants: Vec<VariantInput>,
    #[serde(default)]
    pub prices: Vec<PriceCell>,
}

#[derive(Deserialize)]
pub struct UpdateProductInput {
    pub id: String,
    pub code: String,
    pub name: String,
    pub category_id: Option<String>,
    pub category_name: Option<String>,
    pub supplier_id: Option<String>,
    pub supplier_name: Option<String>,
    pub base_unit: String,
    pub stock_min: f64,
    pub stock_max: Option<f64>,
    pub cost: f64,
    pub price: f64,
    pub units: Vec<UnitInput>,
    pub variants: Vec<VariantInput>,
    #[serde(default)]
    pub prices: Vec<PriceCell>,
}

#[derive(Deserialize)]
pub struct AdjustStockInput {
    pub product_id: String,
    pub qty: f64,
    pub adjustment_type: String, // 'Entrée' | 'Sortie' | 'Correction'
    pub note: Option<String>,
}

#[derive(Deserialize)]
pub struct CreateSupplierInput {
    pub name: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub city: Option<String>,
    pub category: Option<String>,
    pub note: Option<String>,
}

// ---------------------------------------------------------------------------
// Helpers internes
// ---------------------------------------------------------------------------

/// Résout ou crée une catégorie. Retourne l'ID.
fn resolve_category(
    conn: &rusqlite::Connection,
    commerce_id: &str,
    cat_id: Option<&str>,
    cat_name: Option<&str>,
) -> KomersaResult<Option<String>> {
    if let Some(id) = cat_id {
        return Ok(Some(id.to_string()));
    }
    let name = match cat_name {
        Some(n) if !n.trim().is_empty() => n.trim(),
        _ => return Ok(None),
    };
    // Chercher existante (case-insensitive)
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM categories WHERE commerce_id = ?1 AND lower(name) = lower(?2) LIMIT 1",
            rusqlite::params![commerce_id, name],
            |row| row.get(0),
        )
        .ok();
    if let Some(id) = existing {
        return Ok(Some(id));
    }
    // Créer
    let id = format!("CAT-{}", Uuid::new_v4().as_simple());
    conn.execute(
        "INSERT INTO categories (id, commerce_id, name) VALUES (?1, ?2, ?3)",
        rusqlite::params![id, commerce_id, name],
    )?;
    Ok(Some(id))
}

/// Résout ou crée un fournisseur. Retourne l'ID.
fn resolve_supplier(
    conn: &rusqlite::Connection,
    commerce_id: &str,
    sup_id: Option<&str>,
    sup_name: Option<&str>,
) -> KomersaResult<Option<String>> {
    if let Some(id) = sup_id {
        return Ok(Some(id.to_string()));
    }
    let name = match sup_name {
        Some(n) if !n.trim().is_empty() => n.trim(),
        _ => return Ok(None),
    };
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM suppliers WHERE commerce_id = ?1 AND lower(name) = lower(?2) LIMIT 1",
            rusqlite::params![commerce_id, name],
            |row| row.get(0),
        )
        .ok();
    if let Some(id) = existing {
        return Ok(Some(id));
    }
    let id = format!("SUP-{}", Uuid::new_v4().as_simple());
    conn.execute(
        "INSERT INTO suppliers (id, commerce_id, name) VALUES (?1, ?2, ?3)",
        rusqlite::params![id, commerce_id, name],
    )?;
    Ok(Some(id))
}

/// Charge les unités d'un produit.
fn load_units(conn: &rusqlite::Connection, product_id: &str) -> KomersaResult<Vec<UnitRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, product_id, name, factor, price, ref_unit_id, sort_order
         FROM product_units WHERE product_id = ?1 ORDER BY sort_order",
    )?;
    let rows = stmt.query_map([product_id], |row| {
        Ok(UnitRow {
            id: row.get(0)?,
            product_id: row.get(1)?,
            name: row.get(2)?,
            factor: row.get(3)?,
            price: row.get(4)?,
            ref_unit_id: row.get(5)?,
            sort_order: row.get(6)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(KomersaError::Database)
}

/// Charge les variantes d'un produit.
fn load_variants(conn: &rusqlite::Connection, product_id: &str) -> KomersaResult<Vec<VariantRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, product_id, value, stock, price, barcode, sort_order
         FROM product_variants WHERE product_id = ?1 ORDER BY sort_order",
    )?;
    let rows = stmt.query_map([product_id], |row| {
        Ok(VariantRow {
            id: row.get(0)?,
            product_id: row.get(1)?,
            value: row.get(2)?,
            stock: row.get(3)?,
            price: row.get(4)?,
            barcode: row.get(5)?,
            sort_order: row.get(6)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(KomersaError::Database)
}

/// Charge la matrice de prix (colonne JSON) d'un produit.
fn load_prices(conn: &rusqlite::Connection, product_id: &str) -> Vec<PriceCell> {
    let raw: Option<String> = conn
        .query_row("SELECT price_matrix FROM products WHERE id=?1", [product_id], |r| r.get(0))
        .ok()
        .flatten();
    match raw {
        Some(json) if !json.is_empty() => serde_json::from_str(&json).unwrap_or_default(),
        _ => Vec::new(),
    }
}

/// Sérialise et écrit la matrice de prix dans la colonne JSON.
fn save_prices(conn: &rusqlite::Connection, product_id: &str, prices: &[PriceCell]) -> KomersaResult<()> {
    let json = if prices.is_empty() { None } else { serde_json::to_string(prices).ok() };
    conn.execute(
        "UPDATE products SET price_matrix=?2 WHERE id=?1",
        rusqlite::params![product_id, json],
    )?;
    Ok(())
}

/// Insert les unités d'un produit (utilisé en create et update).
fn insert_units(
    conn: &rusqlite::Connection,
    product_id: &str,
    units: &[UnitInput],
) -> KomersaResult<()> {
    for (i, u) in units.iter().enumerate() {
        let id = format!("UNT-{}", Uuid::new_v4().as_simple());
        conn.execute(
            "INSERT INTO product_units (id, product_id, name, factor, price, ref_unit_id, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![id, product_id, u.name, u.factor, u.price, u.ref_unit_id, i as i32],
        )?;
    }
    Ok(())
}

/// Insert les variantes d'un produit.
fn insert_variants(
    conn: &rusqlite::Connection,
    product_id: &str,
    variants: &[VariantInput],
) -> KomersaResult<()> {
    for (i, v) in variants.iter().enumerate() {
        let id = format!("VAR-{}", Uuid::new_v4().as_simple());
        conn.execute(
            "INSERT INTO product_variants (id, product_id, value, stock, price, barcode, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![id, product_id, v.value, v.stock, v.price, v.barcode, i as i32],
        )?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Commandes Tauri
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_stock_metrics(
    db: State<Database>,
    session: State<SessionState>,
) -> KomersaResult<StockMetrics> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::VoirStock)?;

    let row = conn.query_row(
        "SELECT
           COUNT(*) as total,
           COUNT(CASE WHEN stock > 0 AND stock_min > 0 AND stock <= stock_min THEN 1 END) as low_stock,
           COUNT(CASE WHEN stock <= 0 THEN 1 END) as rupture,
           COALESCE(SUM(stock * cost), 0) as stock_value
         FROM products WHERE commerce_id = ?1 AND active = 1",
        [&sess.commerce_id],
        |row| {
            Ok(StockMetrics {
                total: row.get(0)?,
                low_stock: row.get(1)?,
                rupture: row.get(2)?,
                stock_value: row.get(3)?,
            })
        },
    )?;
    Ok(row)
}

#[tauri::command]
pub fn list_products(
    db: State<Database>,
    session: State<SessionState>,
) -> KomersaResult<Vec<ProductRow>> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    // Le catalogue est lisible par qui voit le stock OU peut créer une vente (POS / caissier).
    let can_read = permissions::check(&conn, &sess.membership_id, &sess.role, Permission::VoirStock).is_ok()
        || permissions::check(&conn, &sess.membership_id, &sess.role, Permission::CreerVente).is_ok();
    if !can_read {
        return Err(KomersaError::PermissionDenied("Accès au catalogue refusé.".into()));
    }

    let mut stmt = conn.prepare(
        "SELECT p.id, p.code, p.name,
                p.category_id, c.name as category_name,
                p.supplier_id, s.name as supplier_name,
                p.base_unit, p.stock, p.stock_min, p.stock_max,
                p.cost, p.price, p.active, p.photo_path,
                p.created_at, p.updated_at
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN suppliers s ON s.id = p.supplier_id
         WHERE p.commerce_id = ?1 AND p.active = 1
         ORDER BY p.name COLLATE NOCASE",
    )?;

    let products: Vec<ProductRow> = stmt
        .query_map([&sess.commerce_id], |row| {
            Ok(ProductRow {
                id: row.get(0)?,
                code: row.get(1)?,
                name: row.get(2)?,
                category_id: row.get(3)?,
                category_name: row.get(4)?,
                supplier_id: row.get(5)?,
                supplier_name: row.get(6)?,
                base_unit: row.get(7)?,
                stock: row.get(8)?,
                stock_min: row.get(9)?,
                stock_max: row.get(10)?,
                cost: row.get(11)?,
                price: row.get(12)?,
                active: row.get::<_, i32>(13)? != 0,
                photo_path: row.get(14)?,
                created_at: row.get(15)?,
                updated_at: row.get(16)?,
                units: vec![],
                variants: vec![],
                prices: vec![],
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    // Charger unités + variantes + matrice de prix pour chaque produit
    let mut result = Vec::with_capacity(products.len());
    for mut p in products {
        p.units = load_units(&conn, &p.id)?;
        p.variants = load_variants(&conn, &p.id)?;
        p.prices = load_prices(&conn, &p.id);
        result.push(p);
    }

    Ok(result)
}

#[tauri::command]
pub fn create_product(
    db: State<Database>,
    session: State<SessionState>,
    input: CreateProductInput,
) -> KomersaResult<ProductRow> {
    if input.name.trim().is_empty() {
        return Err(KomersaError::Validation("Le nom du produit est requis.".into()));
    }
    if input.code.trim().is_empty() {
        return Err(KomersaError::Validation("La référence (code) est requise.".into()));
    }
    if input.price < 0.0 || input.cost < 0.0 {
        return Err(KomersaError::Validation("Les prix ne peuvent pas être négatifs.".into()));
    }

    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::GererProduits)?;

    // Unicité du code : erreur seulement si un produit ACTIF porte déjà ce code.
    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM products WHERE commerce_id = ?1 AND code = ?2 AND active = 1)",
        rusqlite::params![sess.commerce_id, input.code.trim()],
        |row| row.get(0),
    )?;
    if exists {
        return Err(KomersaError::Validation(format!(
            "Un produit avec le code « {} » existe déjà.",
            input.code.trim()
        )));
    }
    // Transaction : libération de code + catégorie/fournisseur + produit + unités/variantes/prix + stock.
    let tx = conn.unchecked_transaction()?;
    // Libérer le code d'un éventuel produit SUPPRIMÉ (active=0) portant le même code,
    // sinon la contrainte UNIQUE(commerce_id, code) — qui compte aussi les supprimés — bloque l'insertion.
    conn.execute(
        "UPDATE products SET code = code || '~' || id WHERE commerce_id = ?1 AND code = ?2 AND active = 0",
        rusqlite::params![sess.commerce_id, input.code.trim()],
    )?;

    let category_id = resolve_category(
        &conn,
        &sess.commerce_id,
        input.category_id.as_deref(),
        input.category_name.as_deref(),
    )?;
    let supplier_id = resolve_supplier(
        &conn,
        &sess.commerce_id,
        input.supplier_id.as_deref(),
        input.supplier_name.as_deref(),
    )?;

    let id = format!("PRD-{}", Uuid::new_v4().as_simple());
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO products
           (id, commerce_id, code, name, category_id, supplier_id, base_unit,
            stock, stock_min, stock_max, cost, price, active, created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,1,?13,?13)",
        rusqlite::params![
            id, sess.commerce_id, input.code.trim(), input.name.trim(),
            category_id, supplier_id, input.base_unit.trim(),
            input.stock, input.stock_min, input.stock_max,
            input.cost, input.price, now,
        ],
    )?;

    insert_units(&conn, &id, &input.units)?;
    insert_variants(&conn, &id, &input.variants)?;
    save_prices(&conn, &id, &input.prices)?;

    // Stock distinct par déclinaison : le stock total = somme des déclinaisons.
    if input.variants.iter().any(|v| v.stock.is_some()) {
        let sum: f64 = input.variants.iter().filter_map(|v| v.stock).sum();
        conn.execute("UPDATE products SET stock=?2 WHERE id=?1", rusqlite::params![id, sum])?;
    }

    // Log sync
    conn.execute(
        "INSERT INTO sync_operations (id, commerce_id, entity_type, entity_id, operation, created_at)
         VALUES (?1,?2,'product',?3,'insert',?4)",
        rusqlite::params![
            format!("SYN-{}", Uuid::new_v4().as_simple()),
            sess.commerce_id, id, now
        ],
    )?;

    tx.commit()?;

    // Retourner le produit créé
    let units = load_units(&conn, &id)?;
    let variants = load_variants(&conn, &id)?;
    let prices = load_prices(&conn, &id);
    let final_stock: f64 = conn.query_row("SELECT stock FROM products WHERE id=?1", [&id], |r| r.get(0))
        .unwrap_or(input.stock);

    // Récupérer les noms de catégorie et fournisseur
    let cat_name: Option<String> = category_id.as_deref().and_then(|cid| {
        conn.query_row("SELECT name FROM categories WHERE id = ?1", [cid], |r| r.get(0)).ok()
    });
    let sup_name: Option<String> = supplier_id.as_deref().and_then(|sid| {
        conn.query_row("SELECT name FROM suppliers WHERE id = ?1", [sid], |r| r.get(0)).ok()
    });

    Ok(ProductRow {
        id, code: input.code.trim().into(), name: input.name.trim().into(),
        category_id, category_name: cat_name,
        supplier_id, supplier_name: sup_name,
        base_unit: input.base_unit.trim().into(),
        stock: final_stock, stock_min: input.stock_min, stock_max: input.stock_max,
        cost: input.cost, price: input.price, active: true,
        photo_path: None, created_at: now.clone(), updated_at: now,
        units, variants, prices,
    })
}

#[tauri::command]
pub fn update_product(
    db: State<Database>,
    session: State<SessionState>,
    input: UpdateProductInput,
) -> KomersaResult<ProductRow> {
    if input.name.trim().is_empty() {
        return Err(KomersaError::Validation("Le nom du produit est requis.".into()));
    }

    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::GererProduits)?;

    // Vérifier que le produit appartient bien à ce commerce
    let belongs: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM products WHERE id = ?1 AND commerce_id = ?2)",
        rusqlite::params![input.id, sess.commerce_id],
        |row| row.get(0),
    )?;
    if !belongs {
        return Err(KomersaError::NotFound);
    }

    // Unicité du code (hors produit courant) : erreur si un autre produit ACTIF l'utilise.
    let dup: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM products WHERE commerce_id=?1 AND code=?2 AND active=1 AND id!=?3)",
        rusqlite::params![sess.commerce_id, input.code.trim(), input.id],
        |row| row.get(0),
    )?;
    if dup {
        return Err(KomersaError::Validation(format!(
            "Un autre produit utilise déjà le code « {} ».", input.code.trim()
        )));
    }
    // Transaction : libération de code + produit + unités/variantes/prix + stock atomiques.
    let tx = conn.unchecked_transaction()?;
    // Libérer le code d'un produit supprimé portant le même code.
    conn.execute(
        "UPDATE products SET code = code || '~' || id WHERE commerce_id=?1 AND code=?2 AND active=0 AND id!=?3",
        rusqlite::params![sess.commerce_id, input.code.trim(), input.id],
    )?;

    let category_id = resolve_category(
        &conn, &sess.commerce_id,
        input.category_id.as_deref(), input.category_name.as_deref(),
    )?;
    let supplier_id = resolve_supplier(
        &conn, &sess.commerce_id,
        input.supplier_id.as_deref(), input.supplier_name.as_deref(),
    )?;

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE products SET
           code=?2, name=?3, category_id=?4, supplier_id=?5,
           base_unit=?6, stock_min=?7, stock_max=?8,
           cost=?9, price=?10, updated_at=?11
         WHERE id=?1",
        rusqlite::params![
            input.id, input.code.trim(), input.name.trim(),
            category_id, supplier_id, input.base_unit.trim(),
            input.stock_min, input.stock_max, input.cost, input.price, now,
        ],
    )?;

    // Remplacer les unités et variantes
    conn.execute("DELETE FROM product_units WHERE product_id = ?1", [&input.id])?;
    conn.execute("DELETE FROM product_variants WHERE product_id = ?1", [&input.id])?;
    insert_units(&conn, &input.id, &input.units)?;
    insert_variants(&conn, &input.id, &input.variants)?;
    save_prices(&conn, &input.id, &input.prices)?;

    // Stock distinct par déclinaison : recalculer le stock total = somme des déclinaisons.
    if input.variants.iter().any(|v| v.stock.is_some()) {
        let sum: f64 = input.variants.iter().filter_map(|v| v.stock).sum();
        conn.execute(
            "UPDATE products SET stock=?2, updated_at=?3 WHERE id=?1",
            rusqlite::params![input.id, sum, now],
        )?;
    }

    conn.execute(
        "INSERT INTO sync_operations (id, commerce_id, entity_type, entity_id, operation, created_at)
         VALUES (?1,?2,'product',?3,'update',?4)",
        rusqlite::params![
            format!("SYN-{}", Uuid::new_v4().as_simple()),
            sess.commerce_id, input.id, now
        ],
    )?;

    tx.commit()?;

    // Recharger
    let stock: f64 = conn.query_row("SELECT stock FROM products WHERE id=?1", [&input.id], |r| r.get(0))?;
    let cat_name: Option<String> = category_id.as_deref().and_then(|cid| {
        conn.query_row("SELECT name FROM categories WHERE id=?1", [cid], |r| r.get(0)).ok()
    });
    let sup_name: Option<String> = supplier_id.as_deref().and_then(|sid| {
        conn.query_row("SELECT name FROM suppliers WHERE id=?1", [sid], |r| r.get(0)).ok()
    });
    let units = load_units(&conn, &input.id)?;
    let variants = load_variants(&conn, &input.id)?;
    let prices = load_prices(&conn, &input.id);

    Ok(ProductRow {
        id: input.id, code: input.code.trim().into(), name: input.name.trim().into(),
        category_id, category_name: cat_name, supplier_id, supplier_name: sup_name,
        base_unit: input.base_unit.trim().into(),
        stock, stock_min: input.stock_min, stock_max: input.stock_max,
        cost: input.cost, price: input.price, active: true,
        photo_path: None, created_at: String::new(), updated_at: now,
        units, variants, prices,
    })
}

#[tauri::command]
pub fn delete_product(
    db: State<Database>,
    session: State<SessionState>,
    product_id: String,
) -> KomersaResult<()> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::GererProduits)?;

    let now = chrono::Utc::now().to_rfc3339();
    let affected = conn.execute(
        "UPDATE products SET active = 0, updated_at = ?2
         WHERE id = ?1 AND commerce_id = ?3",
        rusqlite::params![product_id, now, sess.commerce_id],
    )?;
    if affected == 0 {
        return Err(KomersaError::NotFound);
    }
    Ok(())
}

#[tauri::command]
pub fn adjust_stock(
    db: State<Database>,
    session: State<SessionState>,
    input: AdjustStockInput,
) -> KomersaResult<f64> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::AjusterStock)?;

    let current_stock: f64 = conn
        .query_row(
            "SELECT stock FROM products WHERE id = ?1 AND commerce_id = ?2 AND active = 1",
            rusqlite::params![input.product_id, sess.commerce_id],
            |row| row.get(0),
        )
        .map_err(|_| KomersaError::NotFound)?;

    let new_stock = match input.adjustment_type.as_str() {
        "Entrée" => current_stock + input.qty,
        "Sortie" => {
            let result = current_stock - input.qty;
            if result < 0.0 {
                return Err(KomersaError::Validation(
                    "Le stock ne peut pas descendre en dessous de zéro.".into(),
                ));
            }
            result
        }
        "Correction" => input.qty,
        _ => return Err(KomersaError::Validation("Type d'ajustement invalide.".into())),
    };

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE products SET stock = ?2, updated_at = ?3 WHERE id = ?1",
        rusqlite::params![input.product_id, new_stock, now],
    )?;

    conn.execute(
        "INSERT INTO sync_operations (id, commerce_id, entity_type, entity_id, operation, payload, created_at)
         VALUES (?1,?2,'stock_adjustment',?3,'update',?4,?5)",
        rusqlite::params![
            format!("SYN-{}", Uuid::new_v4().as_simple()),
            sess.commerce_id, input.product_id,
            format!(r#"{{"type":"{}","qty":{},"note":{:?}}}"#,
                input.adjustment_type, input.qty,
                input.note.as_deref().unwrap_or("")),
            now,
        ],
    )?;

    let pname: String = conn.query_row("SELECT name FROM products WHERE id=?1", [&input.product_id], |r| r.get(0)).unwrap_or_default();
    crate::commands::audit::record_audit(&conn, &sess.commerce_id, &sess.account_id, &sess.account_name,
        "stock_adjust",
        &format!("Ajustement stock « {} » — {} {} (nouveau : {})", pname, input.adjustment_type, input.qty, new_stock),
        Some(&input.product_id), Some(input.qty));

    Ok(new_stock)
}

#[tauri::command]
pub fn list_categories(
    db: State<Database>,
    session: State<SessionState>,
) -> KomersaResult<Vec<CategoryRow>> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();

    let mut stmt = conn.prepare(
        "SELECT id, name, sort_order FROM categories
         WHERE commerce_id = ?1 ORDER BY sort_order, name COLLATE NOCASE",
    )?;
    let rows = stmt
        .query_map([&sess.commerce_id], |row| {
            Ok(CategoryRow {
                id: row.get(0)?,
                name: row.get(1)?,
                sort_order: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn list_suppliers(
    db: State<Database>,
    session: State<SessionState>,
) -> KomersaResult<Vec<SupplierRow>> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();

    let mut stmt = conn.prepare(
        "SELECT id, code, name, phone, email, city, category, status, note
         FROM suppliers WHERE commerce_id = ?1 AND status != 'Inactif'
         ORDER BY name COLLATE NOCASE",
    )?;
    let rows = stmt
        .query_map([&sess.commerce_id], |row| {
            Ok(SupplierRow {
                id: row.get(0)?,
                code: row.get(1)?,
                name: row.get(2)?,
                phone: row.get(3)?,
                email: row.get(4)?,
                city: row.get(5)?,
                category: row.get(6)?,
                status: row.get(7)?,
                note: row.get(8)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn create_supplier(
    db: State<Database>,
    session: State<SessionState>,
    input: CreateSupplierInput,
) -> KomersaResult<SupplierRow> {
    if input.name.trim().is_empty() {
        return Err(KomersaError::Validation("Le nom du fournisseur est requis.".into()));
    }
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::GererProduits)?;

    let id = format!("SUP-{}", Uuid::new_v4().as_simple());
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO suppliers (id, commerce_id, name, phone, email, city, category, note, created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?9)",
        rusqlite::params![
            id, sess.commerce_id, input.name.trim(),
            input.phone.as_deref(), input.email.as_deref(),
            input.city.as_deref(), input.category.as_deref(),
            input.note.as_deref(), now,
        ],
    )?;
    Ok(SupplierRow {
        id, code: None, name: input.name.trim().into(),
        phone: input.phone, email: input.email, city: input.city,
        category: input.category, status: "Actif".into(), note: input.note,
    })
}

// ---------------------------------------------------------------------------
// Fournisseurs — vue enrichie (dette, achats, dernière commande)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct SupplierFull {
    pub id: String,
    pub code: Option<String>,
    pub name: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub city: Option<String>,
    pub category: Option<String>,
    pub status: String,
    pub note: Option<String>,
    pub balance_due: f64,
    pub total_purchases: f64,
    pub orders_count: i64,
    pub last_order: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateSupplierInput {
    pub id: String,
    pub name: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub city: Option<String>,
    pub category: Option<String>,
    pub note: Option<String>,
}

#[tauri::command]
pub fn list_suppliers_full(
    db: State<Database>,
    session: State<SessionState>,
) -> KomersaResult<Vec<SupplierFull>> {
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();

    let mut stmt = conn.prepare(
        "SELECT s.id, s.code, s.name, s.phone, s.email, s.city, s.category, s.status, s.note,
                COALESCE((SELECT SUM(sd.remaining) FROM supplier_debts sd
                   WHERE sd.supplier_id=s.id AND sd.status!='Soldée'),0) as balance_due,
                COALESCE((SELECT SUM(p.amount) FROM purchases p WHERE p.supplier_id=s.id),0) as total_purchases,
                (SELECT COUNT(*) FROM purchases p WHERE p.supplier_id=s.id) as orders_count,
                (SELECT MAX(p.ordered_at) FROM purchases p WHERE p.supplier_id=s.id) as last_order
         FROM suppliers s
         WHERE s.commerce_id=?1
         ORDER BY s.name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([&sess.commerce_id], |row| {
        Ok(SupplierFull {
            id: row.get(0)?, code: row.get(1)?, name: row.get(2)?,
            phone: row.get(3)?, email: row.get(4)?, city: row.get(5)?,
            category: row.get(6)?, status: row.get(7)?, note: row.get(8)?,
            balance_due: row.get(9)?, total_purchases: row.get(10)?,
            orders_count: row.get(11)?, last_order: row.get(12)?,
        })
    })?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn update_supplier(
    db: State<Database>,
    session: State<SessionState>,
    input: UpdateSupplierInput,
) -> KomersaResult<()> {
    if input.name.trim().is_empty() {
        return Err(KomersaError::Validation("Le nom du fournisseur est requis.".into()));
    }
    let sess = session.get().ok_or(KomersaError::NoSession)?;
    let conn = db.0.lock().unwrap();
    permissions::check(&conn, &sess.membership_id, &sess.role, Permission::GererProduits)?;

    let now = chrono::Utc::now().to_rfc3339();
    let affected = conn.execute(
        "UPDATE suppliers SET name=?2, phone=?3, email=?4, city=?5, category=?6, note=?7, updated_at=?8
         WHERE id=?1 AND commerce_id=?9",
        rusqlite::params![
            input.id, input.name.trim(), input.phone.as_deref(), input.email.as_deref(),
            input.city.as_deref(), input.category.as_deref(), input.note.as_deref(), now, sess.commerce_id,
        ],
    )?;
    if affected == 0 { return Err(KomersaError::NotFound); }
    Ok(())
}
