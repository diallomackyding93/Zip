// Types partagés frontend ↔ Rust (doivent rester en sync avec les structs Rust)

export interface SessionInfo {
  account_id: string;
  account_name: string;
  membership_id: string;
  commerce_id: string;
  commerce_name: string;
  role: string;
  mstatus: string;
}

export interface SetupStatus {
  needs_setup: boolean;
}

export interface CommerceCreated {
  commerce_id: string;
}

export interface AdminCreated {
  account_id: string;
  membership_id: string;
}

export interface LoginInput {
  identifier: string;
  password: string;
}

export interface LoginPinInput {
  account_id: string;
  pin: string;
}

export interface LoginAccountInput {
  account_id: string;
  password: string;
}

export interface LoginAccount {
  account_id: string;
  name: string;
  role: string;
  commerce_name: string;
  photo_path?: string;
  has_pin: boolean;
}

export interface CreateCommerceInput {
  name: string;
  short_name?: string;
  commerce_type?: string;
  city?: string;
  currency: string;
  color?: string;
  initials?: string;
}

export interface CreateAdminInput {
  commerce_id: string;
  name: string;
  phone?: string;
  email?: string;
  password: string;
  pin?: string;
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export interface StockMetrics {
  total: number;
  low_stock: number;
  rupture: number;
  stock_value: number;
}

export interface CategoryRow {
  id: string;
  name: string;
  sort_order: number;
}

export interface SupplierRow {
  id: string;
  code?: string;
  name: string;
  phone?: string;
  email?: string;
  city?: string;
  category?: string;
  status: string;
  note?: string;
}

export interface UnitRow {
  id: string;
  product_id: string;
  name: string;
  factor: number;
  price: number;
  ref_unit_id?: string;
  sort_order: number;
}

export interface VariantRow {
  id: string;
  product_id: string;
  value: string;
  stock?: number;
  price?: number;
  barcode?: string;
  sort_order: number;
}

export interface PriceCell {
  unit: string;      // nom de l'unité (l'unité de base est nommée par base_unit du produit)
  variant: string;   // valeur de la déclinaison
  price: number;
}

export interface ProductRow {
  id: string;
  code: string;
  name: string;
  category_id?: string;
  category_name?: string;
  supplier_id?: string;
  supplier_name?: string;
  base_unit: string;
  stock: number;
  stock_min: number;
  stock_max?: number;
  cost: number;
  price: number;
  active: boolean;
  photo_path?: string;
  created_at: string;
  updated_at: string;
  units: UnitRow[];
  variants: VariantRow[];
  prices: PriceCell[];
}

export interface UnitInput {
  name: string;
  factor: number;
  price: number;
  ref_unit_id?: string;
}

export interface VariantInput {
  value: string;
  stock?: number;
  price?: number;
  barcode?: string;
}

export interface CreateProductInput {
  code: string;
  name: string;
  category_id?: string;
  category_name?: string;
  supplier_id?: string;
  supplier_name?: string;
  base_unit: string;
  stock: number;
  stock_min: number;
  stock_max?: number;
  cost: number;
  price: number;
  units: UnitInput[];
  variants: VariantInput[];
  prices: PriceCell[];
}

export interface UpdateProductInput {
  id: string;
  code: string;
  name: string;
  category_id?: string;
  category_name?: string;
  supplier_id?: string;
  supplier_name?: string;
  base_unit: string;
  stock_min: number;
  stock_max?: number;
  cost: number;
  price: number;
  units: UnitInput[];
  variants: VariantInput[];
  prices: PriceCell[];
}

export interface AdjustStockInput {
  product_id: string;
  qty: number;
  adjustment_type: 'Entrée' | 'Sortie' | 'Correction';
  note?: string;
}

export interface CreateSupplierInput {
  name: string;
  phone?: string;
  email?: string;
  city?: string;
  category?: string;
  note?: string;
}

export interface SupplierFull {
  id: string;
  code?: string;
  name: string;
  phone?: string;
  email?: string;
  city?: string;
  category?: string;
  status: string;
  note?: string;
  balance_due: number;
  total_purchases: number;
  orders_count: number;
  last_order?: string;
}

export interface UpdateSupplierInput {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  city?: string;
  category?: string;
  note?: string;
}

// ---------------------------------------------------------------------------
// Administration (E11)
// ---------------------------------------------------------------------------

export interface MemberRow {
  membership_id: string;
  account_id: string;
  name: string;
  phone?: string;
  email?: string;
  role: string;
  mstatus: string;
  photo_path?: string;
  joined_at?: string;
}

export interface PermissionEntry {
  key: string;
  label: string;
  group: string;
  role_default: boolean;
  effective: boolean;
  overridden: boolean;
}

export interface CreateMemberInput {
  name: string;
  phone?: string;
  email?: string;
  role: string;
  password: string;
  pin?: string;
}

export interface UpdateMemberStatusInput {
  membership_id: string;
  mstatus: string;
}

export interface UpdateMemberRoleInput {
  membership_id: string;
  role: string;
}

export interface SetPermissionInput {
  membership_id: string;
  permission: string;
  granted?: boolean | null;
}

export interface ResetPinInput {
  membership_id: string;
  pin: string;
}

export interface ActivityRow {
  kind: 'sale' | 'expense' | 'cash';
  label: string;
  amount?: number;
  at: string;
}

export interface PosteRow {
  id: string;
  name: string;
  poste_type?: string;
  os?: string;
  scanner: boolean;
  printer?: string;
  drawer: boolean;
  status: string;
  last_seen_at?: string;
}

export interface CreatePosteInput {
  name: string;
  poste_type?: string;
  os?: string;
  scanner: boolean;
  printer?: string;
  drawer: boolean;
}

export interface UpdatePosteInput {
  id: string;
  name: string;
  poste_type?: string;
  os?: string;
  scanner: boolean;
  printer?: string;
  drawer: boolean;
}

export interface LicenseInfo {
  plan: string;
  status: string;
  activated_at?: string;
  renew_at?: string;
  last_check_at?: string;
  grace_days: number;
  max_users: number;
  max_postes: number;
  used_users: number;
  used_postes: number;
}

export type PhotoEntityType = 'product' | 'client' | 'supplier' | 'account' | 'treasury';

// Photo en mode brouillon (formulaire de création/édition) : tenue en mémoire,
// persistée par le parent une fois l'entité créée.
export interface PhotoDraft {
  dataUrl: string | null;
  dirty: boolean;
}

// ---------------------------------------------------------------------------
// Alertes & Paramètres (E10)
// ---------------------------------------------------------------------------

export interface AlertRow {
  id: string;
  title: string;
  detail?: string;
  recommendation?: string;
  category?: string;
  severity: string;
  status: string;
  entity_type?: string;
  entity_id?: string;
  created_at: string;
}

export interface AlertMetrics {
  critical: number;
  warning: number;
  total: number;
}

export interface UpdateAlertStatusInput {
  alert_id: string;
  status: string;
}

export type AlertRuleType =
  | 'stock' | 'customer_credit' | 'supplier_debt' | 'cash_session'
  | 'credit_due_soon' | 'debt_due_soon' | 'credit_limit' | 'cash_gap'
  | 'loss_sale' | 'dormant_stock' | 'month_goal' | 'low_balance'
  | 'inventory_variance' | 'cash_closed';

export interface AlertRuleRow {
  id: string;
  label: string;
  type: AlertRuleType;
  trigger_config?: string;
  severity: string;
  channels: string;
  active: boolean;
}

export interface CreateAlertRuleInput {
  label: string;
  rule_type: AlertRuleType;
  trigger_config?: string;
  severity: string;
  channels?: string;
  active: boolean;
}

export interface UpdateAlertRuleInput {
  id: string;
  label: string;
  rule_type: AlertRuleType;
  trigger_config?: string;
  severity: string;
  channels?: string;
  active: boolean;
}

export interface CommerceInfo {
  id: string;
  name: string;
  short_name?: string;
  commerce_type?: string;
  city?: string;
  currency: string;
  color: string;
}

export interface UpdateCommerceInput {
  name: string;
  short_name?: string;
  commerce_type?: string;
  city?: string;
  currency: string;
}

export interface SetSettingInput {
  key: string;
  value: string;
}

// ---------------------------------------------------------------------------
// Tableau de bord & Rapports (E9)
// ---------------------------------------------------------------------------

export interface TopProduct {
  product_name: string;
  qty: number;
  amount: number;
}

export interface ModeBreakdown {
  mode_label: string;
  amount: number;
}

export interface DayPoint {
  date: string;   // 'YYYY-MM-DD'
  amount: number;
}

export interface DbInfo {
  path: string;
  size_bytes: number;
  modified?: string | null;
}

export interface LowStockItem {
  name: string;
  stock: number;
  stock_min: number;
}

export interface DashboardSnapshot {
  today_sales: number;
  today_tickets: number;
  avg_basket: number;
  yesterday_sales: number;
  first_ticket_time?: string | null;
  month_sales: number;
  month_collected: number;
  month_goal: number;
  days_remaining: number;
  cash_expected: number;
  open_sessions: number;
  customer_debts: number;
  supplier_debts: number;
  low_stock_count: number;
  sales_by_day: number[];
  top_products: TopProduct[];
  low_stock_items: LowStockItem[];
}

export interface ReportInput {
  period: string;          // 'today'|'7d'|'30d'|'month'|'year'|'custom'
  from?: string;           // 'YYYY-MM-DD' (si period='custom')
  to?: string;
}

export interface ReportData {
  total_sales: number;
  tickets: number;
  margin: number;
  avg_ticket: number;
  purchases: number;
  purchases_due: number;
  low_stock_count: number;
  stock_value: number;
  cash_expected: number;
  payment_modes: ModeBreakdown[];
  top_products: TopProduct[];
  top_qty: TopProduct | null;
  categories: ModeBreakdown[];
  series: DayPoint[];
}

// ---------------------------------------------------------------------------
// Dépenses (E8)
// ---------------------------------------------------------------------------

export interface ExpenseRow {
  id: string;
  expense_ref?: string;
  label: string;
  beneficiary?: string;
  category?: string;
  amount: number;
  mode_label?: string;
  treasury_account_id?: string;
  treasury_account_title?: string;
  status: string;
  recurring: boolean;
  note?: string;
  created_by_name?: string;
  expense_date: string;
  created_at: string;
}

export interface ExpenseMetrics {
  total_month: number;
  count: number;
  pending: number;
  recurring: number;
}

export interface CategoryTotal {
  category: string;
  amount: number;
}

export interface CreateExpenseInput {
  label: string;
  beneficiary?: string;
  category?: string;
  amount: number;
  mode_label?: string;
  treasury_account_id?: string;
  status?: string;
  recurring: boolean;
  note?: string;
  expense_date: string;
}

export interface UpdateExpenseStatusInput {
  expense_id: string;
  status: string;
}

export interface AttachmentRow {
  id: string;
  data_url: string;
}

export type AttachmentOwner = 'expense' | 'purchase' | 'supplier_debt';

// ---------------------------------------------------------------------------
// Inventaire (E8)
// ---------------------------------------------------------------------------

export interface InventorySessionRow {
  id: string;
  title: string;
  scope: string;
  scope_value?: string;
  blind_count: boolean;
  responsible_name?: string;
  status: string;
  created_at: string;
  closed_at?: string;
  total_lines: number;
  counted_lines: number;
  variances: number;
}

export interface InventoryCountRow {
  id: string;
  product_id: string;
  product_code: string;
  product_name: string;
  variant_id?: string;
  variant_value?: string;
  location?: string;
  system_qty?: number;
  counted_qty?: number;
  variance?: number;
  applied: boolean;
}

export interface CreateInventorySessionInput {
  title: string;
  scope: string;
  scope_value?: string;
  blind_count: boolean;
}

export interface SaveCountInput {
  count_id: string;
  counted_qty: number;
}

// ---------------------------------------------------------------------------
// Trésorerie (E5)
// ---------------------------------------------------------------------------

export interface TreasuryAccountRow {
  id: string;
  title: string;
  subtitle?: string;
  account_type: string;
  balance: number;
  active: boolean;
  as_payment: boolean;
  note?: string;
}

export interface TreasurySummary {
  net_treasury: number;
  liquid_assets: number;
  receivables: number;
  payables: number;
  open_sessions_count: number;
  open_sessions_amount: number;
  pending_handovers_count: number;
  pending_handovers_amount: number;
}

export interface TransferRow {
  id: string;
  title?: string;
  from_account_id: string;
  from_account_title: string;
  to_account_id: string;
  to_account_title: string;
  amount: number;
  created_by?: string;
  created_at: string;
}

export interface HandoverRow {
  id: string;
  cash_session_id: string;
  session_ref: string;
  seller_name: string;
  counted: number;
  expected: number;
  gap: number;
  status: string;
  created_at: string;
}

export interface AccountMovementRow {
  id: string;
  amount: number;       // > 0 entrée · < 0 sortie
  kind: string;
  label?: string;
  created_at: string;
}

export interface CreateAccountInput {
  title: string;
  subtitle?: string;
  account_type: string;
  balance: number;
  as_payment: boolean;
  note?: string;
}

export interface UpdateAccountInput {
  id: string;
  title: string;
  subtitle?: string;
  account_type: string;
  note?: string;
}

export interface CreateTransferInput {
  title?: string;
  from_account_id: string;
  to_account_id: string;
  amount: number;
}

export interface ValidateHandoverInput {
  handover_id: string;
  cash_account_id: string;
}

// ---------------------------------------------------------------------------
// Clients & Crédits (E6)
// ---------------------------------------------------------------------------

export interface ClientFull {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  city?: string;
  group_name: string;
  credit_limit: number;
  note?: string;
  status: string;
  purchases30d: number;
  credit_remaining: number;
  last_purchase?: string;
  created_at: string;
}

export interface CustomerCreditRow {
  id: string;
  client_id: string;
  client_name: string;
  sale_id?: string;
  sale_ref?: string;
  initial: number;
  paid: number;
  remaining: number;
  status: string;
  due_date?: string;
  created_at: string;
  updated_at: string;
}

export interface CreditPaymentRow {
  id: string;
  amount: number;
  mode_label: string;
  paid_by?: string;
  paid_at: string;
}

export interface CreateClientInput {
  name: string;
  phone?: string;
  email?: string;
  city?: string;
  group_name?: string;
  credit_limit?: number;
  note?: string;
}

export interface UpdateClientInput {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  city?: string;
  group_name?: string;
  credit_limit?: number;
  note?: string;
}

export interface AddCreditPaymentInput {
  credit_id: string;
  amount: number;
  mode_label: string;
  treasury_account_id?: string;
}

// ---------------------------------------------------------------------------
// Achats & Dettes fournisseurs (E7)
// ---------------------------------------------------------------------------

export interface PurchaseRow {
  id: string;
  purchase_ref: string;
  supplier_id: string;
  supplier_name: string;
  ordered_by?: string;
  ordered_by_name?: string;
  state: string;
  mode_label?: string;
  amount: number;
  paid: number;
  remaining: number;
  ordered_at: string;
  received_at?: string;
  note?: string;
}

export interface PurchaseItemRow {
  id: string;
  product_id?: string;
  product_name: string;
  variant?: string;
  qty: number;
  unit_name?: string;
  unit_cost: number;
  line_total: number;
}

export interface PurchaseDetail {
  purchase: PurchaseRow;
  items: PurchaseItemRow[];
}

export interface PurchaseItemInput {
  product_id?: string;
  product_name: string;
  variant?: string;
  qty: number;
  unit_name?: string;
  unit_cost: number;
}

export interface CreatePurchaseInput {
  supplier_id?: string;
  supplier_name?: string;
  mode_label?: string;
  items: PurchaseItemInput[];
  note?: string;
  receive_now: boolean;
  treasury_account_id?: string;
  idempotency_key?: string;
}

export interface ReceivePurchaseInput {
  purchase_id: string;
  treasury_account_id?: string;
}

export interface SupplierDebtRow {
  id: string;
  supplier_id: string;
  supplier_name: string;
  purchase_id?: string;
  purchase_ref?: string;
  invoice_ref?: string;
  invoice_date?: string;
  due_date?: string;
  initial: number;
  paid: number;
  remaining: number;
  status: string;
  created_at: string;
}

export interface AddDebtPaymentInput {
  debt_id: string;
  amount: number;
  mode_label: string;
  treasury_account_id?: string;
}

// ---------------------------------------------------------------------------
// Caisse
// ---------------------------------------------------------------------------

export interface ModeTotal {
  mode_label: string;
  amount: number;
  count: number;
}

export interface CashSessionInfo {
  id: string;
  session_ref: string;
  seller_id: string;
  seller_name: string;
  status: string;
  initial_fund: number;
  opened_at: string;
  closed_at?: string;
  cash_expected: number;
  counted_cash?: number;
  gap?: number;
  by_mode: ModeTotal[];
  sales_count: number;
}

export interface CashMovementRow {
  id: string;
  movement_type: string;
  detail?: string;
  mode_label?: string;
  amount: number;
  seller_name: string;
  created_at: string;
  sale_ref?: string;
}

export interface CashSessionSummary {
  id: string;
  session_ref: string;
  seller_name: string;
  status: string;
  initial_fund: number;
  cash_expected?: number;
  counted_cash?: number;
  gap?: number;
  opened_at: string;
  closed_at?: string;
}

export interface OpenSessionInput {
  initial_fund: number;
}

export interface AddMovementInput {
  movement_type: 'Apport' | 'Sortie';
  amount: number;
  detail?: string;
}

export interface CloseSessionInput {
  session_id: string;
  counted_cash: number;
  treasury_account_id?: string;
}

// ---------------------------------------------------------------------------
// Ventes & POS
// ---------------------------------------------------------------------------

export interface PaymentModeRow {
  value: string;
  icon: string;
  treasury_account_id?: string;
  fixed: boolean;
}

export interface ClientRow {
  id: string;
  name: string;
  phone?: string;
  group_name: string;
  credit_limit: number;
}

export interface SaleItemInput {
  product_id: string;
  product_code: string;
  product_name: string;
  variant?: string;
  unit_name?: string;
  qty: number;
  unit_price: number;
  orig_price?: number;
  unit_factor: number;   // unités de base par unité vendue
}

export interface SalePaymentInput {
  treasury_account_id?: string;
  mode_label: string;
  amount: number;
}

export interface CreateSaleInput {
  client_id?: string;
  items: SaleItemInput[];
  payments: SalePaymentInput[];
  discount: number;
  cash_session_id?: string;
  idempotency_key?: string;
}

export interface SaleRow {
  id: string;
  ref: string;
  client_id?: string;
  client_name?: string;
  seller_id: string;
  seller_name: string;
  state: string;
  subtotal: number;
  discount: number;
  total: number;
  received: number;
  remaining: number;
  created_at: string;
  payment_labels: string;
  returned_total: number;
}

export interface SaleItemRow {
  id: string;
  sale_id: string;
  product_id?: string;
  product_code: string;
  product_name: string;
  variant?: string;
  unit_name?: string;
  qty: number;
  unit_price: number;
  orig_price?: number;
  line_total: number;
}

export interface SalePaymentRow {
  id: string;
  mode_label: string;
  amount: number;
}

export interface SaleDetail {
  sale: SaleRow;
  items: SaleItemRow[];
  payments: SalePaymentRow[];
}

export interface CancelSaleInput {
  sale_id: string;
  reason?: string;
}

export interface SalesMetrics {
  today_ca: number;
  today_tickets: number;
  avg_basket: number;
  open_credits: number;
}

export interface CreditMetrics {
  total_due: number;
  overdue: number;
  open_count: number;
  settled_count: number;
}

export interface PurchaseMetrics {
  total_amount: number;
  total_due: number;
  count: number;
}

export interface DebtMetrics {
  total_due: number;
  overdue: number;
  open_count: number;
  settled_count: number;
}

export interface ReturnItemInput {
  sale_item_id: string;
  qty: number;
}

export interface CreateReturnInput {
  sale_id: string;
  items: ReturnItemInput[];
  reason?: string;
  refund_mode: string;
  refund_account_id?: string;
  cash_session_id?: string;
}

// Ticket POS (état local uniquement, pas de struct Rust correspondante)
export interface TicketItem {
  product_id: string;
  product_code: string;
  product_name: string;
  variant?: string;
  unit_name: string;
  unit_factor: number; // unités de base par unité choisie
  qty: number;
  unit_price: number;
  orig_price: number;  // prix catalogue (pour afficher le barré)
}

// Navigation
export type NavItemId =
  | 'dashboard'
  | 'sales'
  | 'pos'
  | 'cash'
  | 'treasury'
  | 'customer_credits'
  | 'supplier_debts'
  | 'expenses'
  | 'stock'
  | 'purchases'
  | 'inventory'
  | 'clients'
  | 'suppliers'
  | 'reports'
  | 'alerts'
  | 'audit'
  | 'settings';

export interface AuditRow {
  id: string;
  account_name: string;
  action: string;
  detail: string;
  entity_ref?: string | null;
  amount?: number | null;
  created_at: string;
}

export interface NavItem {
  id: NavItemId;
  label: string;
  icon: string;
  badge?: string;
}

export interface NavGroup {
  group: string;
  items: NavItem[];
}

export type NavEntry = NavItem | NavGroup;

export function isNavGroup(entry: NavEntry): entry is NavGroup {
  return 'group' in entry;
}
