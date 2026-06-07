use rusqlite::Connection;

/// Toutes les migrations, dans l'ordre. Chaque entrée = (version, sql).
/// On applique uniquement celles dont la version n'est pas encore en base.
pub fn run(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_version (
            version    TEXT NOT NULL PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )?;

    let migrations: &[(&str, &str)] = &[
        ("0001_identity", MIGRATION_0001_IDENTITY),
        ("0002_catalog", MIGRATION_0002_CATALOG),
        ("0003_clients_sales", MIGRATION_0003_CLIENTS_SALES),
        ("0004_cash_treasury", MIGRATION_0004_CASH_TREASURY),
        ("0005_purchases_debts", MIGRATION_0005_PURCHASES_DEBTS),
        ("0006_expenses_credits", MIGRATION_0006_EXPENSES_CREDITS),
        ("0007_inventory_alerts", MIGRATION_0007_INVENTORY_ALERTS),
        ("0008_settings_sync", MIGRATION_0008_SETTINGS_SYNC),
        ("0009_account_photo", MIGRATION_0009_ACCOUNT_PHOTO),
        ("0010_price_matrix", MIGRATION_0010_PRICE_MATRIX),
        ("0011_treasury_photo_delete", MIGRATION_0011_TREASURY_PHOTO_DELETE),
        ("0012_generic_attachments", MIGRATION_0012_GENERIC_ATTACHMENTS),
        ("0013_money_integrity", MIGRATION_0013_MONEY_INTEGRITY),
        ("0014_treasury_ledger", MIGRATION_0014_TREASURY_LEDGER),
        ("0015_history_indexes", MIGRATION_0015_HISTORY_INDEXES),
        ("0016_audit_log", MIGRATION_0016_AUDIT_LOG),
    ];

    for (version, sql) in migrations {
        let already: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_version WHERE version = ?1)",
            [version],
            |row| row.get(0),
        )?;

        if !already {
            conn.execute_batch(sql)?;
            conn.execute(
                "INSERT INTO schema_version (version) VALUES (?1)",
                [version],
            )?;
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// 0001 — Identité : comptes, commerce, memberships, postes, licence
// ---------------------------------------------------------------------------
const MIGRATION_0001_IDENTITY: &str = "
CREATE TABLE accounts (
    id            TEXT PRIMARY KEY,
    phone         TEXT UNIQUE,
    email         TEXT,
    name          TEXT NOT NULL,
    password_hash TEXT,
    pin_hash      TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE commerces (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    short_name TEXT,
    type       TEXT,
    city       TEXT,
    currency   TEXT NOT NULL DEFAULT 'GNF',
    color      TEXT NOT NULL DEFAULT '#d2592f',
    initials   TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE memberships (
    id           TEXT PRIMARY KEY,
    account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    commerce_id  TEXT NOT NULL REFERENCES commerces(id) ON DELETE CASCADE,
    role         TEXT NOT NULL,
    mstatus      TEXT NOT NULL DEFAULT 'Actif',
    invited_by   TEXT REFERENCES accounts(id),
    joined_at    TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(account_id, commerce_id)
);

-- Overrides de permissions par membership (au-dessus du modèle de rôle).
CREATE TABLE membership_permissions (
    id            TEXT PRIMARY KEY,
    membership_id TEXT NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
    permission    TEXT NOT NULL,
    granted       INTEGER NOT NULL CHECK (granted IN (0, 1)),
    set_by        TEXT REFERENCES accounts(id),
    set_at        TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(membership_id, permission)
);

CREATE TABLE invitations (
    id          TEXT PRIMARY KEY,
    commerce_id TEXT NOT NULL REFERENCES commerces(id) ON DELETE CASCADE,
    name        TEXT,
    contact     TEXT NOT NULL,
    role        TEXT NOT NULL,
    sent_by     TEXT REFERENCES accounts(id),
    via         TEXT,
    status      TEXT NOT NULL DEFAULT 'pending',
    sent_at     TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at  TEXT
);

CREATE TABLE postes (
    id          TEXT PRIMARY KEY,
    commerce_id TEXT NOT NULL REFERENCES commerces(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    type        TEXT,
    os          TEXT,
    scanner     INTEGER NOT NULL DEFAULT 0,
    printer     TEXT,
    drawer      INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'offline',
    last_seen_at TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE license (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    plan          TEXT NOT NULL DEFAULT 'Standard',
    status        TEXT NOT NULL DEFAULT 'active',
    license_key   TEXT,
    activated_at  TEXT,
    renew_at      TEXT,
    last_check_at TEXT,
    grace_days    INTEGER NOT NULL DEFAULT 7,
    max_users     INTEGER NOT NULL DEFAULT 10,
    max_postes    INTEGER NOT NULL DEFAULT 5
);
";

// ---------------------------------------------------------------------------
// 0002 — Catalogue : catégories, fournisseurs, produits, unités, variantes
// ---------------------------------------------------------------------------
const MIGRATION_0002_CATALOG: &str = "
CREATE TABLE categories (
    id          TEXT PRIMARY KEY,
    commerce_id TEXT NOT NULL REFERENCES commerces(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE suppliers (
    id          TEXT PRIMARY KEY,
    commerce_id TEXT NOT NULL REFERENCES commerces(id) ON DELETE CASCADE,
    code        TEXT,
    name        TEXT NOT NULL,
    phone       TEXT,
    email       TEXT,
    city        TEXT,
    category    TEXT,
    status      TEXT NOT NULL DEFAULT 'Actif',
    note        TEXT,
    photo_path  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE products (
    id          TEXT PRIMARY KEY,
    commerce_id TEXT NOT NULL REFERENCES commerces(id) ON DELETE CASCADE,
    code        TEXT NOT NULL,
    name        TEXT NOT NULL,
    category_id TEXT REFERENCES categories(id),
    supplier_id TEXT REFERENCES suppliers(id),
    base_unit   TEXT NOT NULL DEFAULT 'pièce',
    stock       REAL NOT NULL DEFAULT 0,
    stock_min   REAL NOT NULL DEFAULT 0,
    stock_max   REAL,
    cost        REAL NOT NULL DEFAULT 0,
    price       REAL NOT NULL DEFAULT 0,
    active      INTEGER NOT NULL DEFAULT 1,
    photo_path  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(commerce_id, code)
);

CREATE INDEX idx_products_commerce ON products(commerce_id);
CREATE INDEX idx_products_active ON products(commerce_id, active);

-- Unités de vente chaînées (1 carton = 12 paquets → factor calculé vers l'unité de base)
CREATE TABLE product_units (
    id          TEXT PRIMARY KEY,
    product_id  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    factor      REAL NOT NULL DEFAULT 1,
    price       REAL NOT NULL DEFAULT 0,
    ref_unit_id TEXT REFERENCES product_units(id),
    sort_order  INTEGER NOT NULL DEFAULT 0
);

-- Déclinaisons (couleur, motif…)
CREATE TABLE product_variants (
    id         TEXT PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    value      TEXT NOT NULL,
    stock      REAL,
    price      REAL,
    barcode    TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0
);
";

// ---------------------------------------------------------------------------
// 0003 — Clients & Ventes
// ---------------------------------------------------------------------------
const MIGRATION_0003_CLIENTS_SALES: &str = "
CREATE TABLE clients (
    id           TEXT PRIMARY KEY,
    commerce_id  TEXT NOT NULL REFERENCES commerces(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    phone        TEXT,
    email        TEXT,
    city         TEXT,
    group_name   TEXT NOT NULL DEFAULT 'Régulier',
    credit_limit REAL NOT NULL DEFAULT 0,
    note         TEXT,
    photo_path   TEXT,
    status       TEXT NOT NULL DEFAULT 'Actif',
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_clients_commerce ON clients(commerce_id);

CREATE TABLE sales (
    id              TEXT PRIMARY KEY,
    commerce_id     TEXT NOT NULL REFERENCES commerces(id),
    ref             TEXT NOT NULL,
    cash_session_id TEXT REFERENCES cash_sessions(id),
    client_id       TEXT REFERENCES clients(id),
    seller_id       TEXT NOT NULL REFERENCES accounts(id),
    poste_id        TEXT REFERENCES postes(id),
    state           TEXT NOT NULL DEFAULT 'Payée',
    subtotal        REAL NOT NULL DEFAULT 0,
    discount        REAL NOT NULL DEFAULT 0,
    total           REAL NOT NULL DEFAULT 0,
    received        REAL NOT NULL DEFAULT 0,
    remaining       REAL NOT NULL DEFAULT 0,
    cancelled_reason TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_sales_commerce ON sales(commerce_id);
CREATE INDEX idx_sales_date ON sales(commerce_id, created_at);

CREATE TABLE sale_items (
    id           TEXT PRIMARY KEY,
    sale_id      TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id   TEXT REFERENCES products(id),
    product_code TEXT NOT NULL,
    product_name TEXT NOT NULL,
    variant      TEXT,
    unit_name    TEXT,
    qty          REAL NOT NULL,
    unit_price   REAL NOT NULL,
    orig_price   REAL,
    line_total   REAL NOT NULL
);

CREATE TABLE sale_payments (
    id                  TEXT PRIMARY KEY,
    sale_id             TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    treasury_account_id TEXT REFERENCES treasury_accounts(id),
    mode_label          TEXT NOT NULL,
    amount              REAL NOT NULL
);

CREATE TABLE sale_returns (
    id            TEXT PRIMARY KEY,
    sale_id       TEXT NOT NULL REFERENCES sales(id),
    seller_id     TEXT REFERENCES accounts(id),
    reason        TEXT,
    refund_amount REAL NOT NULL DEFAULT 0,
    refund_mode   TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sale_return_items (
    id           TEXT PRIMARY KEY,
    return_id    TEXT NOT NULL REFERENCES sale_returns(id) ON DELETE CASCADE,
    sale_item_id TEXT NOT NULL REFERENCES sale_items(id),
    qty          REAL NOT NULL,
    refund       REAL NOT NULL
);
";

// ---------------------------------------------------------------------------
// 0004 — Caisse & Trésorerie
// ---------------------------------------------------------------------------
const MIGRATION_0004_CASH_TREASURY: &str = "
CREATE TABLE treasury_accounts (
    id          TEXT PRIMARY KEY,
    commerce_id TEXT NOT NULL REFERENCES commerces(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    subtitle    TEXT,
    type        TEXT NOT NULL DEFAULT 'other',
    balance     REAL NOT NULL DEFAULT 0,
    active      INTEGER NOT NULL DEFAULT 1,
    as_payment  INTEGER NOT NULL DEFAULT 0,
    note        TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_treasury_commerce ON treasury_accounts(commerce_id);

CREATE TABLE cash_sessions (
    id            TEXT PRIMARY KEY,
    commerce_id   TEXT NOT NULL REFERENCES commerces(id),
    ref           TEXT NOT NULL,
    poste_id      TEXT REFERENCES postes(id),
    seller_id     TEXT NOT NULL REFERENCES accounts(id),
    status        TEXT NOT NULL DEFAULT 'open',
    initial_fund  REAL NOT NULL DEFAULT 0,
    expected_cash REAL,
    counted_cash  REAL,
    gap           REAL,
    opened_at     TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at     TEXT
);

CREATE INDEX idx_cash_sessions_commerce ON cash_sessions(commerce_id);
CREATE INDEX idx_cash_sessions_open ON cash_sessions(commerce_id, status);

CREATE TABLE cash_movements (
    id                  TEXT PRIMARY KEY,
    cash_session_id     TEXT NOT NULL REFERENCES cash_sessions(id),
    commerce_id         TEXT NOT NULL REFERENCES commerces(id),
    ref                 TEXT,
    type                TEXT NOT NULL,
    detail              TEXT,
    mode_label          TEXT,
    treasury_account_id TEXT REFERENCES treasury_accounts(id),
    amount              REAL NOT NULL,
    seller_id           TEXT REFERENCES accounts(id),
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE cash_handovers (
    id              TEXT PRIMARY KEY,
    cash_session_id TEXT NOT NULL REFERENCES cash_sessions(id),
    seller_id       TEXT REFERENCES accounts(id),
    counted         REAL NOT NULL DEFAULT 0,
    expected        REAL NOT NULL DEFAULT 0,
    gap             REAL NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'pending',
    validated_by    TEXT REFERENCES accounts(id),
    validated_at    TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE treasury_transfers (
    id              TEXT PRIMARY KEY,
    commerce_id     TEXT NOT NULL REFERENCES commerces(id),
    ref             TEXT,
    title           TEXT,
    from_account_id TEXT NOT NULL REFERENCES treasury_accounts(id),
    to_account_id   TEXT NOT NULL REFERENCES treasury_accounts(id),
    amount          REAL NOT NULL,
    created_by      TEXT REFERENCES accounts(id),
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
";

// ---------------------------------------------------------------------------
// 0005 — Achats & Dettes fournisseurs
// ---------------------------------------------------------------------------
const MIGRATION_0005_PURCHASES_DEBTS: &str = "
CREATE TABLE purchases (
    id          TEXT PRIMARY KEY,
    commerce_id TEXT NOT NULL REFERENCES commerces(id),
    ref         TEXT NOT NULL,
    supplier_id TEXT NOT NULL REFERENCES suppliers(id),
    ordered_by  TEXT REFERENCES accounts(id),
    state       TEXT NOT NULL DEFAULT 'Commandé',
    mode_label  TEXT,
    amount      REAL NOT NULL DEFAULT 0,
    paid        REAL NOT NULL DEFAULT 0,
    remaining   REAL NOT NULL DEFAULT 0,
    ordered_at  TEXT NOT NULL DEFAULT (datetime('now')),
    received_at TEXT,
    note        TEXT
);

CREATE INDEX idx_purchases_commerce ON purchases(commerce_id);

CREATE TABLE purchase_items (
    id           TEXT PRIMARY KEY,
    purchase_id  TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    product_id   TEXT REFERENCES products(id),
    product_name TEXT NOT NULL,
    variant      TEXT,
    qty          REAL NOT NULL,
    unit_name    TEXT,
    unit_cost    REAL NOT NULL DEFAULT 0,
    line_total   REAL NOT NULL DEFAULT 0
);

CREATE TABLE supplier_debts (
    id           TEXT PRIMARY KEY,
    commerce_id  TEXT NOT NULL REFERENCES commerces(id),
    supplier_id  TEXT NOT NULL REFERENCES suppliers(id),
    purchase_id  TEXT REFERENCES purchases(id),
    invoice_ref  TEXT,
    invoice_date TEXT,
    due_date     TEXT,
    initial      REAL NOT NULL DEFAULT 0,
    paid         REAL NOT NULL DEFAULT 0,
    remaining    REAL NOT NULL DEFAULT 0,
    status       TEXT NOT NULL DEFAULT 'Ouverte',
    created_by   TEXT REFERENCES accounts(id),
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE supplier_debt_payments (
    id                  TEXT PRIMARY KEY,
    debt_id             TEXT NOT NULL REFERENCES supplier_debts(id),
    amount              REAL NOT NULL DEFAULT 0,
    mode_label          TEXT NOT NULL,
    treasury_account_id TEXT REFERENCES treasury_accounts(id),
    paid_by             TEXT REFERENCES accounts(id),
    ref                 TEXT,
    paid_at             TEXT NOT NULL DEFAULT (datetime('now'))
);
";

// ---------------------------------------------------------------------------
// 0006 — Dépenses & Crédits clients
// ---------------------------------------------------------------------------
const MIGRATION_0006_EXPENSES_CREDITS: &str = "
CREATE TABLE expenses (
    id                  TEXT PRIMARY KEY,
    commerce_id         TEXT NOT NULL REFERENCES commerces(id),
    ref                 TEXT,
    label               TEXT NOT NULL,
    beneficiary         TEXT,
    category            TEXT,
    amount              REAL NOT NULL DEFAULT 0,
    mode_label          TEXT,
    treasury_account_id TEXT REFERENCES treasury_accounts(id),
    status              TEXT NOT NULL DEFAULT 'En attente',
    recurring           INTEGER NOT NULL DEFAULT 0,
    note                TEXT,
    created_by          TEXT REFERENCES accounts(id),
    expense_date        TEXT NOT NULL,
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_expenses_commerce ON expenses(commerce_id);

CREATE TABLE expense_attachments (
    id         TEXT PRIMARY KEY,
    expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    file_path  TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE customer_credits (
    id          TEXT PRIMARY KEY,
    commerce_id TEXT NOT NULL REFERENCES commerces(id),
    client_id   TEXT NOT NULL REFERENCES clients(id),
    sale_id     TEXT REFERENCES sales(id),
    initial     REAL NOT NULL DEFAULT 0,
    paid        REAL NOT NULL DEFAULT 0,
    remaining   REAL NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'Ouvert',
    due_date    TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_credits_commerce ON customer_credits(commerce_id);

CREATE TABLE customer_credit_payments (
    id                  TEXT PRIMARY KEY,
    credit_id           TEXT NOT NULL REFERENCES customer_credits(id),
    amount              REAL NOT NULL DEFAULT 0,
    mode_label          TEXT NOT NULL,
    treasury_account_id TEXT REFERENCES treasury_accounts(id),
    paid_by             TEXT REFERENCES accounts(id),
    ref                 TEXT,
    paid_at             TEXT NOT NULL DEFAULT (datetime('now'))
);
";

// ---------------------------------------------------------------------------
// 0007 — Inventaire & Alertes
// ---------------------------------------------------------------------------
const MIGRATION_0007_INVENTORY_ALERTS: &str = "
CREATE TABLE inventory_sessions (
    id             TEXT PRIMARY KEY,
    commerce_id    TEXT NOT NULL REFERENCES commerces(id),
    title          TEXT NOT NULL,
    scope          TEXT NOT NULL DEFAULT 'all',
    scope_value    TEXT,
    blind_count    INTEGER NOT NULL DEFAULT 0,
    responsible_id TEXT REFERENCES accounts(id),
    status         TEXT NOT NULL DEFAULT 'open',
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at      TEXT
);

CREATE TABLE inventory_counts (
    id                 TEXT PRIMARY KEY,
    session_id         TEXT NOT NULL REFERENCES inventory_sessions(id) ON DELETE CASCADE,
    product_id         TEXT NOT NULL REFERENCES products(id),
    product_variant_id TEXT REFERENCES product_variants(id),
    location           TEXT,
    system_qty         REAL,
    counted_qty        REAL,
    variance           REAL,
    applied            INTEGER NOT NULL DEFAULT 0,
    counted_at         TEXT
);

CREATE TABLE alert_rules (
    id             TEXT PRIMARY KEY,
    commerce_id    TEXT NOT NULL REFERENCES commerces(id) ON DELETE CASCADE,
    label          TEXT NOT NULL,
    type           TEXT NOT NULL,
    trigger_config TEXT,
    severity       TEXT NOT NULL DEFAULT 'Attention',
    channels       TEXT NOT NULL DEFAULT '{\"inapp\":true}',
    active         INTEGER NOT NULL DEFAULT 1,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE alerts (
    id             TEXT PRIMARY KEY,
    commerce_id    TEXT NOT NULL REFERENCES commerces(id) ON DELETE CASCADE,
    rule_id        TEXT REFERENCES alert_rules(id),
    title          TEXT NOT NULL,
    detail         TEXT,
    recommendation TEXT,
    category       TEXT,
    severity       TEXT NOT NULL DEFAULT 'Info',
    status         TEXT NOT NULL DEFAULT 'À traiter',
    entity_type    TEXT,
    entity_id      TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_alerts_commerce ON alerts(commerce_id, status);
";

// ---------------------------------------------------------------------------
// 0008 — Paramètres & Log de sync (stub Phase 2)
// ---------------------------------------------------------------------------
const MIGRATION_0008_SETTINGS_SYNC: &str = "
CREATE TABLE settings (
    key         TEXT NOT NULL,
    commerce_id TEXT NOT NULL REFERENCES commerces(id) ON DELETE CASCADE,
    value       TEXT,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (key, commerce_id)
);

-- Journal d'événements pour la synchro Phase 2.
-- En Phase 1 : toutes les mutations y écrivent, mais synced_at reste NULL.
CREATE TABLE sync_operations (
    id          TEXT PRIMARY KEY,
    commerce_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id   TEXT NOT NULL,
    operation   TEXT NOT NULL,
    payload     TEXT,
    synced_at   TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
";

// ---------------------------------------------------------------------------
// 0009 — Photo de profil sur les comptes (produits/clients/fournisseurs l'ont déjà)
// ---------------------------------------------------------------------------
const MIGRATION_0009_ACCOUNT_PHOTO: &str = "
ALTER TABLE accounts ADD COLUMN photo_path TEXT;
";

// ---------------------------------------------------------------------------
// 0010 — Matrice de prix (unité × déclinaison) en JSON + facteur sur les lignes de vente
//   products.price_matrix : JSON [{ \"unit\": \"balle\", \"variant\": \"Rouge\", \"price\": 7000000 }, …]
//   sale_items.unit_factor : nombre d'unités de base par unité vendue (pour décrément/annulation stock)
// ---------------------------------------------------------------------------
const MIGRATION_0010_PRICE_MATRIX: &str = "
ALTER TABLE products ADD COLUMN price_matrix TEXT;
ALTER TABLE sale_items ADD COLUMN unit_factor REAL NOT NULL DEFAULT 1;
";

// ---------------------------------------------------------------------------
// 0011 — Logo (photo_path) sur les comptes de trésorerie + suppression douce
//   deleted=1 : compte retiré de l'interface mais conservé pour l'historique
//   (transferts/mouvements qui le référencent restent lisibles).
// ---------------------------------------------------------------------------
const MIGRATION_0011_TREASURY_PHOTO_DELETE: &str = "
ALTER TABLE treasury_accounts ADD COLUMN photo_path TEXT;
ALTER TABLE treasury_accounts ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
";

// ---------------------------------------------------------------------------
// 0012 — Pièces jointes génériques (justificatifs InvoiceGallery)
//   Remplace expense_attachments par une table réutilisable pour dépenses,
//   achats et dettes fournisseurs. owner_type ∈ {expense, purchase, supplier_debt}.
//   Les justificatifs de dépenses existants sont migrés.
// ---------------------------------------------------------------------------
const MIGRATION_0012_GENERIC_ATTACHMENTS: &str = "
CREATE TABLE attachments (
    id          TEXT PRIMARY KEY,
    commerce_id TEXT NOT NULL REFERENCES commerces(id) ON DELETE CASCADE,
    owner_type  TEXT NOT NULL,
    owner_id    TEXT NOT NULL,
    data_url    TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_attachments_owner ON attachments(commerce_id, owner_type, owner_id);

INSERT INTO attachments (id, commerce_id, owner_type, owner_id, data_url, created_at)
SELECT ea.id, e.commerce_id, 'expense', ea.expense_id, ea.file_path, ea.created_at
FROM expense_attachments ea JOIN expenses e ON e.id = ea.expense_id;
";

// ---------------------------------------------------------------------------
// 0013 — Intégrité financière
//   - purchases.treasury_account_id : compte débité pour un achat payé
//   - idempotency_key sur sales/purchases : anti-doublon (double-clic / rejeu)
// ---------------------------------------------------------------------------
const MIGRATION_0013_MONEY_INTEGRITY: &str = "
ALTER TABLE purchases ADD COLUMN treasury_account_id TEXT;
ALTER TABLE sales ADD COLUMN idempotency_key TEXT;
ALTER TABLE purchases ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX idx_sales_idem ON sales(commerce_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX idx_purchases_idem ON purchases(commerce_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
";

// ---------------------------------------------------------------------------
// 0014 — Registre des mouvements de trésorerie (relevé par compte)
//   Chaque variation de solde d'un compte y écrit une ligne signée :
//   amount > 0 = entrée, amount < 0 = sortie. Permet d'afficher le relevé
//   d'un compte et de rendre la trésorerie auditable.
// ---------------------------------------------------------------------------
const MIGRATION_0014_TREASURY_LEDGER: &str = "
CREATE TABLE treasury_movements (
    id          TEXT PRIMARY KEY,
    commerce_id TEXT NOT NULL REFERENCES commerces(id) ON DELETE CASCADE,
    account_id  TEXT NOT NULL,
    amount      REAL NOT NULL,
    kind        TEXT NOT NULL,
    label       TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_treasury_mvt_account ON treasury_movements(account_id, created_at);
";

// ---------------------------------------------------------------------------
// 0015 — Index pour les historiques filtrés par date + pagination
//   (sales possède déjà idx_sales_date). Garde les requêtes rapides à grand volume.
// ---------------------------------------------------------------------------
const MIGRATION_0015_HISTORY_INDEXES: &str = "
CREATE INDEX IF NOT EXISTS idx_credits_date ON customer_credits(commerce_id, created_at);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(commerce_id, expense_date);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(commerce_id, ordered_at);
CREATE INDEX IF NOT EXISTS idx_debts_date ON supplier_debts(commerce_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cash_sessions_date ON cash_sessions(commerce_id, opened_at);
";

// ---------------------------------------------------------------------------
// 0016 — Journal d'audit (actions sensibles, append-only)
// ---------------------------------------------------------------------------
const MIGRATION_0016_AUDIT_LOG: &str = "
CREATE TABLE audit_log (
    id           TEXT PRIMARY KEY,
    commerce_id  TEXT NOT NULL REFERENCES commerces(id) ON DELETE CASCADE,
    account_id   TEXT,
    account_name TEXT NOT NULL,
    action       TEXT NOT NULL,
    detail       TEXT NOT NULL,
    entity_ref   TEXT,
    amount       REAL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_commerce ON audit_log(commerce_id, created_at);
CREATE INDEX idx_audit_action ON audit_log(commerce_id, action);
";
