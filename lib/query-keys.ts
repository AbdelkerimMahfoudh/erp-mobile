/** Centralized React Query keys so invalidation stays consistent. */
export const qk = {
  me: ['me'] as const,
  branches: ['branches'] as const,
  permissions: (branchId: string | null) => ['permissions', branchId] as const,
  products: (q?: string) => ['products', q ?? ''] as const,
  product: (id: string) => ['product', id] as const,
  categories: ['categories'] as const,
  suppliers: ['suppliers'] as const,
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
  transferCounts: (branchId: string | null) => ['transfer-counts', branchId] as const,
  home: (branchId: string | null) => ['home', branchId] as const,
  dashboard: (branchId: string | null) => ['dashboard', branchId] as const,
  analyticsProducts: (branchId: string | null) => ['analytics-products', branchId] as const,
  analyticsCategories: (branchId: string | null) => ['analytics-categories', branchId] as const,
  inventoryValue: (branchId: string | null) => ['inventory-value', branchId] as const,
  health: (branchId: string | null) => ['health', branchId] as const,
  expenses: (branchId: string | null, date?: string) => ['expenses', branchId, date ?? ''] as const,
  /** The signed-in user's own devices (F1 Stage 3). */
  devices: ['devices'] as const,
  notifications: ['notifications'] as const,
  /** Company-scoped, not branch-scoped — one policy for the whole business. */
  settings: ['settings'] as const,
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
};
