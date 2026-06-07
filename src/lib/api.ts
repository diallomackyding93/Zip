import { invoke } from '@tauri-apps/api/tauri';
import type {
  MemberRow, PermissionEntry, CreateMemberInput, UpdateMemberStatusInput,
  UpdateMemberRoleInput, SetPermissionInput, ResetPinInput, ActivityRow,
  PosteRow, CreatePosteInput, UpdatePosteInput, LicenseInfo, PhotoEntityType,
  AlertRow, AlertMetrics, UpdateAlertStatusInput,
  AlertRuleRow, CreateAlertRuleInput, UpdateAlertRuleInput,
  CommerceInfo, UpdateCommerceInput, SetSettingInput,
  DashboardSnapshot, ReportInput, ReportData, DbInfo, AuditRow,
  ExpenseRow, ExpenseMetrics, CategoryTotal, CreateExpenseInput, UpdateExpenseStatusInput, AttachmentRow, AttachmentOwner,
  InventorySessionRow, InventoryCountRow, CreateInventorySessionInput, SaveCountInput,
  TreasuryAccountRow, TreasurySummary, TransferRow, HandoverRow, AccountMovementRow,
  CreateAccountInput, UpdateAccountInput, CreateTransferInput, ValidateHandoverInput,
  ClientFull, CustomerCreditRow, CreditPaymentRow,
  CreateClientInput, UpdateClientInput, AddCreditPaymentInput,
  PurchaseRow, PurchaseDetail, CreatePurchaseInput, ReceivePurchaseInput,
  SupplierDebtRow, AddDebtPaymentInput,
  SessionInfo,
  SetupStatus,
  CommerceCreated,
  AdminCreated,
  LoginInput,
  LoginPinInput,
  LoginAccountInput,
  LoginAccount,
  CreateCommerceInput,
  CreateAdminInput,
  StockMetrics,
  CategoryRow,
  SupplierRow,
  ProductRow,
  CreateProductInput,
  UpdateProductInput,
  AdjustStockInput,
  CreateSupplierInput,
  SupplierFull,
  UpdateSupplierInput,
  PaymentModeRow,
  ClientRow,
  SaleRow,
  SaleDetail,
  CreateSaleInput,
  CancelSaleInput,
  CreateReturnInput,
  SalesMetrics, CreditMetrics, PurchaseMetrics, DebtMetrics,
  CashSessionInfo,
  CashMovementRow,
  CashSessionSummary,
  OpenSessionInput,
  AddMovementInput,
  CloseSessionInput,
} from './types';

// Chaque fonction wrape un invoke() Tauri.
// Les erreurs Rust arrivent comme des strings rejetées — on les propage telles quelles.

export const api = {
  setup: {
    getStatus: () =>
      invoke<SetupStatus>('get_setup_status'),

    createCommerce: (input: CreateCommerceInput) =>
      invoke<CommerceCreated>('create_commerce', { input }),

    createAdminAccount: (input: CreateAdminInput) =>
      invoke<AdminCreated>('create_admin_account', { input }),
  },

  auth: {
    login: (input: LoginInput) =>
      invoke<SessionInfo>('login', { input }),

    loginPin: (input: LoginPinInput) =>
      invoke<SessionInfo>('login_pin', { input }),

    loginAccount: (input: LoginAccountInput) =>
      invoke<SessionInfo>('login_account', { input }),

    listMyPermissions: () =>
      invoke<string[]>('list_my_permissions'),

    listAccounts: () =>
      invoke<LoginAccount[]>('list_login_accounts'),

    logout: () =>
      invoke<void>('logout'),

    getSession: () =>
      invoke<SessionInfo | null>('get_session'),

    hasPermission: (permission: string) =>
      invoke<boolean>('has_permission', { permission }),
  },

  catalog: {
    getStockMetrics: () =>
      invoke<StockMetrics>('get_stock_metrics'),

    listProducts: () =>
      invoke<ProductRow[]>('list_products'),

    createProduct: (input: CreateProductInput) =>
      invoke<ProductRow>('create_product', { input }),

    updateProduct: (input: UpdateProductInput) =>
      invoke<ProductRow>('update_product', { input }),

    deleteProduct: (productId: string) =>
      invoke<void>('delete_product', { productId }),

    adjustStock: (input: AdjustStockInput) =>
      invoke<number>('adjust_stock', { input }),

    listCategories: () =>
      invoke<CategoryRow[]>('list_categories'),

    listSuppliers: () =>
      invoke<SupplierRow[]>('list_suppliers'),

    listSuppliersFull: () =>
      invoke<SupplierFull[]>('list_suppliers_full'),

    createSupplier: (input: CreateSupplierInput) =>
      invoke<SupplierRow>('create_supplier', { input }),

    updateSupplier: (input: UpdateSupplierInput) =>
      invoke<void>('update_supplier', { input }),
  },

  sales: {
    listPaymentModes: () =>
      invoke<PaymentModeRow[]>('list_payment_modes'),

    listClients: () =>
      invoke<ClientRow[]>('list_clients'),

    createSale: (input: CreateSaleInput) =>
      invoke<SaleRow>('create_sale', { input }),

    listSales: (opts?: { from?: string | null; to?: string | null; offset?: number; limit?: number }) =>
      invoke<SaleRow[]>('list_sales', {
        from: opts?.from ?? null, to: opts?.to ?? null,
        offset: opts?.offset ?? 0, limit: opts?.limit ?? 50,
      }),

    getMetrics: () => invoke<SalesMetrics>('get_sales_metrics'),

    getSaleDetail: (saleId: string) =>
      invoke<SaleDetail>('get_sale_detail', { saleId }),

    cancelSale: (input: CancelSaleInput) =>
      invoke<void>('cancel_sale', { input }),

    createReturn: (input: CreateReturnInput) =>
      invoke<number>('create_sale_return', { input }),
  },

  cash: {
    getOpenSession: () =>
      invoke<CashSessionInfo | null>('get_open_cash_session'),

    openSession: (input: OpenSessionInput) =>
      invoke<CashSessionInfo>('open_cash_session', { input }),

    addMovement: (input: AddMovementInput) =>
      invoke<CashMovementRow>('add_cash_movement', { input }),

    listMovements: (sessionId: string) =>
      invoke<CashMovementRow[]>('list_cash_movements', { sessionId }),

    closeSession: (input: CloseSessionInput) =>
      invoke<CashSessionInfo>('close_cash_session', { input }),

    listSessions: (opts?: { from?: string | null; to?: string | null; offset?: number; limit?: number }) =>
      invoke<CashSessionSummary[]>('list_cash_sessions', {
        from: opts?.from ?? null, to: opts?.to ?? null, offset: opts?.offset ?? 0, limit: opts?.limit ?? 50,
      }),
  },

  treasury: {
    getSummary: () => invoke<TreasurySummary>('get_treasury_summary'),
    listAccounts: () => invoke<TreasuryAccountRow[]>('list_treasury_accounts'),
    createAccount: (input: CreateAccountInput) => invoke<TreasuryAccountRow>('create_treasury_account', { input }),
    updateAccount: (input: UpdateAccountInput) => invoke<TreasuryAccountRow>('update_treasury_account', { input }),
    toggleAsPayment: (accountId: string) => invoke<boolean>('toggle_as_payment', { accountId }),
    toggleActive: (accountId: string) => invoke<boolean>('toggle_account_active', { accountId }),
    deleteAccount: (accountId: string) => invoke<void>('delete_treasury_account', { accountId }),
    createTransfer: (input: CreateTransferInput) => invoke<TransferRow>('create_transfer', { input }),
    listTransfers: () => invoke<TransferRow[]>('list_transfers'),
    listAccountMovements: (accountId: string, from: string | null, to: string | null, offset: number, limit: number) =>
      invoke<AccountMovementRow[]>('list_account_movements', { accountId, from, to, offset, limit }),
    listPendingHandovers: () => invoke<HandoverRow[]>('list_pending_handovers'),
    validateHandover: (input: ValidateHandoverInput) => invoke<void>('validate_handover', { input }),
  },

  clients: {
    listFull: () => invoke<ClientFull[]>('list_clients_full'),
    create: (input: CreateClientInput) => invoke<ClientFull>('create_client', { input }),
    update: (input: UpdateClientInput) => invoke<void>('update_client', { input }),
    listCredits: (opts?: { from?: string | null; to?: string | null; offset?: number; limit?: number }) =>
      invoke<CustomerCreditRow[]>('list_customer_credits', {
        from: opts?.from ?? null, to: opts?.to ?? null,
        offset: opts?.offset ?? 0, limit: opts?.limit ?? 50,
      }),
    getCreditMetrics: () => invoke<CreditMetrics>('get_credit_metrics'),
    listCreditPayments: (creditId: string) => invoke<CreditPaymentRow[]>('list_credit_payments', { creditId }),
    addCreditPayment: (input: AddCreditPaymentInput) => invoke<void>('add_credit_payment', { input }),
  },

  purchases: {
    list: (opts?: { from?: string | null; to?: string | null; offset?: number; limit?: number }) =>
      invoke<PurchaseRow[]>('list_purchases', {
        from: opts?.from ?? null, to: opts?.to ?? null, offset: opts?.offset ?? 0, limit: opts?.limit ?? 50,
      }),
    getMetrics: () => invoke<PurchaseMetrics>('get_purchase_metrics'),
    getDebtMetrics: () => invoke<DebtMetrics>('get_debt_metrics'),
    getDetail: (purchaseId: string) => invoke<PurchaseDetail>('get_purchase_detail', { purchaseId }),
    create: (input: CreatePurchaseInput) => invoke<PurchaseRow>('create_purchase', { input }),
    receive: (input: ReceivePurchaseInput) => invoke<PurchaseRow>('receive_purchase', { input }),
    listDebts: (opts?: { from?: string | null; to?: string | null; offset?: number; limit?: number }) =>
      invoke<SupplierDebtRow[]>('list_supplier_debts', {
        from: opts?.from ?? null, to: opts?.to ?? null, offset: opts?.offset ?? 0, limit: opts?.limit ?? 50,
      }),
    addDebtPayment: (input: AddDebtPaymentInput) => invoke<void>('add_debt_payment', { input }),
  },

  expenses: {
    getMetrics: () => invoke<ExpenseMetrics>('get_expense_metrics'),
    list: (opts?: { from?: string | null; to?: string | null; offset?: number; limit?: number }) =>
      invoke<ExpenseRow[]>('list_expenses', {
        from: opts?.from ?? null, to: opts?.to ?? null,
        offset: opts?.offset ?? 0, limit: opts?.limit ?? 50,
      }),
    listCategories: () => invoke<CategoryTotal[]>('list_expense_categories'),
    create: (input: CreateExpenseInput) => invoke<ExpenseRow>('create_expense', { input }),
    updateStatus: (input: UpdateExpenseStatusInput) => invoke<void>('update_expense_status', { input }),
    delete: (expenseId: string) => invoke<void>('delete_expense', { expenseId }),
  },

  // Pièces jointes génériques (justificatifs) — owner_type ∈ expense|purchase|supplier_debt
  attachments: {
    list: (ownerType: AttachmentOwner, ownerId: string) =>
      invoke<AttachmentRow[]>('list_attachments', { ownerType, ownerId }),
    add: (ownerType: AttachmentOwner, ownerId: string, dataUrl: string) =>
      invoke<AttachmentRow>('add_attachment', { ownerType, ownerId, dataUrl }),
    delete: (attachmentId: string) =>
      invoke<void>('delete_attachment', { attachmentId }),
  },

  inventory: {
    listSessions: () => invoke<InventorySessionRow[]>('list_inventory_sessions'),
    createSession: (input: CreateInventorySessionInput) => invoke<InventorySessionRow>('create_inventory_session', { input }),
    listCounts: (sessionId: string) => invoke<InventoryCountRow[]>('list_inventory_counts', { sessionId }),
    saveCount: (input: SaveCountInput) => invoke<number>('save_inventory_count', { input }),
    closeSession: (sessionId: string) => invoke<number>('close_inventory_session', { sessionId }),
  },

  reports: {
    getDashboard: () => invoke<DashboardSnapshot>('get_dashboard_snapshot'),
    getReport: (input: ReportInput) => invoke<ReportData>('get_report', { input }),
  },

  alerts: {
    generate: () => invoke<number>('generate_alerts'),
    list: () => invoke<AlertRow[]>('list_alerts'),
    getMetrics: () => invoke<AlertMetrics>('get_alert_metrics'),
    updateStatus: (input: UpdateAlertStatusInput) => invoke<void>('update_alert_status', { input }),
    listRules: () => invoke<AlertRuleRow[]>('list_alert_rules'),
    createRule: (input: CreateAlertRuleInput) => invoke<AlertRuleRow>('create_alert_rule', { input }),
    updateRule: (input: UpdateAlertRuleInput) => invoke<void>('update_alert_rule', { input }),
    deleteRule: (ruleId: string) => invoke<void>('delete_alert_rule', { ruleId }),
  },

  settings: {
    getCommerceInfo: () => invoke<CommerceInfo>('get_commerce_info'),
    updateCommerceInfo: (input: UpdateCommerceInput) => invoke<void>('update_commerce_info', { input }),
    getSettings: () => invoke<Record<string, string>>('get_settings'),
    setSetting: (input: SetSettingInput) => invoke<void>('set_setting', { input }),
  },

  admin: {
    listMembers: () => invoke<MemberRow[]>('list_members'),
    createMember: (input: CreateMemberInput) => invoke<MemberRow>('create_member', { input }),
    updateMemberStatus: (input: UpdateMemberStatusInput) => invoke<void>('update_member_status', { input }),
    updateMemberRole: (input: UpdateMemberRoleInput) => invoke<void>('update_member_role', { input }),
    getMemberPermissions: (membershipId: string) => invoke<PermissionEntry[]>('get_member_permissions', { membershipId }),
    setMemberPermission: (input: SetPermissionInput) => invoke<void>('set_member_permission', { input }),
    resetMemberPin: (input: ResetPinInput) => invoke<void>('reset_member_pin', { input }),
    getMemberActivity: (membershipId: string) => invoke<ActivityRow[]>('get_member_activity', { membershipId }),
    listPostes: () => invoke<PosteRow[]>('list_postes'),
    createPoste: (input: CreatePosteInput) => invoke<PosteRow>('create_poste', { input }),
    updatePoste: (input: UpdatePosteInput) => invoke<void>('update_poste', { input }),
    deletePoste: (posteId: string) => invoke<void>('delete_poste', { posteId }),
    getLicense: () => invoke<LicenseInfo>('get_license'),
  },

  photos: {
    set: (entityType: PhotoEntityType, entityId: string, dataUrl: string) =>
      invoke<void>('set_photo', { entityType, entityId, dataUrl }),
    get: (entityType: PhotoEntityType, entityId: string) =>
      invoke<string | null>('get_photo', { entityType, entityId }),
    delete: (entityType: PhotoEntityType, entityId: string) =>
      invoke<void>('delete_photo', { entityType, entityId }),
  },

  backup: {
    getInfo: () => invoke<DbInfo>('get_database_info'),
    save: (destPath: string) => invoke<void>('backup_database', { destPath }),
    restore: (srcPath: string) => invoke<void>('restore_database', { srcPath }),
  },

  audit: {
    list: (opts?: { from?: string | null; to?: string | null; action?: string | null; offset?: number; limit?: number }) =>
      invoke<AuditRow[]>('list_audit_log', {
        from: opts?.from ?? null, to: opts?.to ?? null, action: opts?.action ?? null,
        offset: opts?.offset ?? 0, limit: opts?.limit ?? 50,
      }),
  },
};
