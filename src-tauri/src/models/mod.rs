use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Identité
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub name: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Commerce {
    pub id: String,
    pub name: String,
    pub short_name: Option<String>,
    #[serde(rename = "type")]
    pub commerce_type: Option<String>,
    pub city: Option<String>,
    pub currency: String,
    pub color: String,
    pub initials: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Membership {
    pub id: String,
    pub account_id: String,
    pub commerce_id: String,
    pub role: String,
    pub mstatus: String,
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Product {
    pub id: String,
    pub commerce_id: String,
    pub code: String,
    pub name: String,
    pub category_id: Option<String>,
    pub supplier_id: Option<String>,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductUnit {
    pub id: String,
    pub product_id: String,
    pub name: String,
    pub factor: f64,
    pub price: f64,
    pub ref_unit_id: Option<String>,
    pub sort_order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductVariant {
    pub id: String,
    pub product_id: String,
    pub value: String,
    pub stock: Option<f64>,
    pub price: Option<f64>,
    pub barcode: Option<String>,
    pub sort_order: i32,
}

// ---------------------------------------------------------------------------
// Trésorerie
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreasuryAccount {
    pub id: String,
    pub commerce_id: String,
    pub title: String,
    pub subtitle: Option<String>,
    #[serde(rename = "type")]
    pub account_type: String,
    pub balance: f64,
    pub active: bool,
    pub as_payment: bool,
}

// ---------------------------------------------------------------------------
// Caisse
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CashSession {
    pub id: String,
    pub commerce_id: String,
    #[serde(rename = "ref")]
    pub session_ref: String,
    pub poste_id: Option<String>,
    pub seller_id: String,
    pub status: String,
    pub initial_fund: f64,
    pub opened_at: String,
    pub closed_at: Option<String>,
}

// ---------------------------------------------------------------------------
// Licence
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct License {
    pub plan: String,
    pub status: String,
    pub activated_at: Option<String>,
    pub renew_at: Option<String>,
    pub last_check_at: Option<String>,
    pub grace_days: i32,
    pub max_users: i32,
    pub max_postes: i32,
}
