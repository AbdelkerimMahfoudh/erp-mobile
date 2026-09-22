/** Centralized React Query keys so invalidation stays consistent. */
export const qk = {
  me: ['me'] as const,
  branches: ['branches'] as const,
  permissions: (branchId: string | null) => ['permissions', branchId] as const,
  products: (q?: string) => ['products', q ?? ''] as const,
  product: (id: string) => ['product', id] as const,
  categories: ['categories'] as const,
  /** Reference data, not tenant data — safe to keep for the whole session. */
  deviceBrands: ['device-brands'] as const,
  /**
   * Serialized units and quantity stock together, discriminated by `kind`.
   * `search` is part of the key so changing it starts a fresh pagination run —
   * a cursor issued under one query is meaningless under another.
   */
  inventory: (branchId: string | null, status?: string, search?: string, productId?: string) =>
    ['inventory', branchId, status ?? '', search ?? '', productId ?? ''] as const,
  /**
   * Sale history is per branch, and `filters` joins search, status, method and
   * date range for the same reason the transfer key does: a cursor issued under
   * one query means nothing under another.
   */
  sales: (branchId: string | null, filters?: string) => ['sales', branchId, filters ?? ''] as const,
  sale: (id: string) => ['sale', id] as const,
  /**
   * Transfers are per branch: the list is scoped to the branch's two ends, so
   * the branch belongs in the key or switching would show the previous one's
   * work. `filters` joins the status and search terms for the same reason a
   * catalog cursor does — a cursor issued under one query means nothing under
   * another.
   */
  transfers: (branchId: string | null, filters?: string) =>
    ['transfers', branchId, filters ?? ''] as const,
  transfer: (id: string) => ['transfer', id] as const,
  /**
   * Returns are per branch, and `filters` joins status, responsibility,
   * eligibility, requester, date range and search — every server-side
   * parameter. A cursor issued under one query means nothing under another, so
   * changing any of them must start a fresh run rather than continue the old.
   */
  returns: (branchId: string | null, filters?: string) =>
    ['returns', branchId, filters ?? ''] as const,
  return: (id: string) => ['return', id] as const,
  /**
   * The refund receipt is keyed by branch AND return: it is only readable
   * from the branch holding the return, so a branch switch must not serve
   * another branch cached document.
   */
  refundReceipt: (branchId: string | null, id: string) =>
    ['refund-receipt', branchId, id] as const,
  /** Outstanding liability and settled refunds, per branch and window. */
  corrections: (branchId: string | null, status: string) =>
    ['corrections', branchId, status] as const,
  correction: (id: string) => ['correction', id] as const,
  refundSummary: (branchId: string | null, range?: string) =>
    ['refund-summary', branchId, range ?? ''] as const,
  transferCounts: (branchId: string | null) => ['transfer-counts', branchId] as const,
  home: (branchId: string | null) => ['home', branchId] as const,
  dashboard: (branchId: string | null) => ['dashboard', branchId] as const,
  analyticsProducts: (branchId: string | null) => ['analytics-products', branchId] as const,
  analyticsCategories: (branchId: string | null) => ['analytics-categories', branchId] as const,
  inventoryValue: (branchId: string | null) => ['inventory-value', branchId] as const,
  inventoryByModel: (branchId: string | null) => ['inventory-by-model', branchId] as const,
  /**
   * One row per variant. Keyed by branch so a switch never shows the previous
   * branch's shelf.
   *
   * Starts with `'inventory'` on purpose: catalog edits, consignments and
   * imports already invalidate the `['inventory']` prefix, and a summary outside
   * that prefix would go on showing counts those mutations just changed.
   */
  inventorySummary: (branchId: string | null) => ['inventory', 'summary', branchId] as const,
  health: (branchId: string | null) => ['health', branchId] as const,
  expenses: (branchId: string | null, filters?: string) =>
    ['expenses', branchId, filters ?? ''] as const,
  expense: (id: string) => ['expense', id] as const,
  /**
   * The progressive closing (Milestone E). Branch-and-day scoped, because two
   * branches counting on the same evening are two entirely separate drawers.
   */
  openClosing: (branchId: string | null, date: string) => ['open-closing', branchId, date] as const,
  discrepancies: (branchId: string | null) => ['discrepancies', branchId] as const,
  discrepancy: (id: string) => ['discrepancy', id] as const,
  /** The signed-in person's own ledger — theirs, not a branch's. */
  myDebt: () => ['my-debt'] as const,
  /** Goals (Milestone F). Branch-scoped: two branches aim at different things. */
  goals: (branchId: string | null, includeArchived: boolean) =>
    ['goals', branchId, includeArchived] as const,
  /** Stock imports (Milestone G). Branch-scoped: stock lands in one branch. */
  imports: (branchId: string | null) => ['imports', branchId] as const,
  import: (id: string) => ['import', id] as const,
  /**
   * Inter-store consignment (Milestone H). Store search is NOT branch-scoped —
   * discovery is a company-level act — while consignments are, because stock
   * leaves a particular branch.
   */
  storeSearch: (q: string) => ['store-search', q] as const,
  connections: () => ['connections'] as const,
  counterparties: () => ['counterparties'] as const,
  consignments: (branchId: string | null, group: string) =>
    ['consignments', branchId, group] as const,
  consignment: (id: string) => ['consignment', id] as const,
  /**
   * Money loans (Milestone I). Branch-scoped like consignments — a loan is
   * recorded by the branch that made it — while the closing reminders are a
   * company-level nudge and are not.
   */
  loans: (branchId: string | null, group: string) => ['loans', branchId, group] as const,
  loan: (id: string) => ['loan', id] as const,
  loanReminders: () => ['loan-reminders'] as const,
  /** Company-level, not branch-level: a subscription covers the whole shop. */
  entitlement: () => ['entitlement'] as const,
  /** Recorded money per channel for a period — branch-scoped, like the closing it reads. */
  moneyMovements: (branchId: string | null, from: string, to: string) =>
    ['money-movements', branchId, from, to] as const,
  /** The Money screen in one read (0074): drawer now, accounts today, period sales. */
  moneyOverview: (branchId: string | null, from: string, to: string) =>
    ['money-overview', branchId, from, to] as const,
  /** Every balance still owed at the branch, grouped by who owes it (0074). */
  outstanding: (branchId: string | null) => ['outstanding', branchId] as const,
  /** Sales per day for a period — the week and month views (0074). */
  salesByDay: (branchId: string | null, from: string, to: string) =>
    ['sales-by-day', branchId, from, to] as const,
  /** The consolidated period summary (L). Branch-scoped, like every read. */
  analyticsSummary: (branchId: string | null, from: string, to: string) =>
    ['analytics-summary', branchId, from, to] as const,
  /** The signed-in user's own devices (F1 Stage 3). */
  devices: ['devices'] as const,
  notifications: ['notifications'] as const,
  /** Company-scoped, not branch-scoped — one policy for the whole business. */
  settings: ['settings'] as const,
  /**
   * Customers are a company record, so the search term is the only key part.
   * `customersAll` is what a newly created customer invalidates: every search
   * is potentially stale, and the one just added has to be findable at once.
   */
  customers: (search: string) => ['customers', search] as const,
  customersAll: ['customers'] as const,
  /** Company-scoped team list — Owner-only, not per branch. */
  users: ['users'] as const,

  /**
   * Pricing is per branch: the same variant legitimately costs different
   * amounts in different shops, so the branch belongs in the key or switching
   * branches would show the previous one's price.
   */
  pricingProduct: (branchId: string | null, productId: string) =>
    ['pricing', 'product', branchId, productId] as const,
  pricingUnit: (branchId: string | null, identifier: string) =>
    ['pricing', 'unit', branchId, identifier] as const,
  priceHistory: (branchId: string | null, productId?: string) =>
    ['pricing', 'history', branchId, productId ?? ''] as const,

  /**
   * Owner approvals for a price below the set one (A2).
   *
   * Branch-scoped, because an approval is for one unit in one shop and the
   * server refuses one raised elsewhere — a list cached under the wrong branch
   * would offer a seller an approval they cannot use. `scope` separates the
   * Owner's queue from a requester's own history: the server returns different
   * rows to each, so they must not share a cache entry when the same person
   * gains or loses the permission mid-session.
   */
  discountApprovals: (branchId: string | null, scope: string, status?: string) =>
    ['discount-approvals', branchId, scope, status ?? ''] as const,
  discountApproval: (branchId: string | null, id: string) =>
    ['discount-approval', branchId, id] as const,
  /** What this exact unit already has outstanding, for the sale in progress. */
  discountApprovalsForUnit: (branchId: string | null, unitId: string) =>
    ['discount-approvals', 'unit', branchId, unitId] as const,

  /**
   * What needs attention (A3).
   *
   * Branch-scoped, because five of the six rules are about one shop's stock,
   * drawer and sellers — and because the server returns a different list to a
   * different branch. Never cached across a branch switch.
   */
  /**
   * Bare, the prefix every anomaly query shares — what an invalidation names.
   * With a page, one slice of the ordered list: the overview's three, or a
   * page of the full list (`'all'` marks the infinite list's own cache).
   */
  anomalies: (branchId: string | null, page?: { limit: number; page: number | 'all' }) =>
    page ? (['anomalies', branchId, page.limit, page.page] as const) : (['anomalies', branchId] as const),
};
