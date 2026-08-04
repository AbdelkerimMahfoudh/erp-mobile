/** Centralized React Query keys so invalidation stays consistent. */
export const qk = {
  me: ['me'] as const,
  branches: ['branches'] as const,
  permissions: (branchId: string | null) => ['permissions', branchId] as const,
  products: (q?: string) => ['products', q ?? ''] as const,
  categories: ['categories'] as const,
  suppliers: ['suppliers'] as const,
  /** Serialized units and quantity stock together, discriminated by `kind`. */
  inventory: (branchId: string | null, status?: string) => ['inventory', branchId, status ?? ''] as const,
  sales: (branchId: string | null) => ['sales', branchId] as const,
  sale: (id: string) => ['sale', id] as const,
  transfers: (branchId: string | null) => ['transfers', branchId] as const,
  home: (branchId: string | null) => ['home', branchId] as const,
  dashboard: (branchId: string | null) => ['dashboard', branchId] as const,
  analyticsProducts: (branchId: string | null) => ['analytics-products', branchId] as const,
  analyticsCategories: (branchId: string | null) => ['analytics-categories', branchId] as const,
  inventoryValue: (branchId: string | null) => ['inventory-value', branchId] as const,
  health: (branchId: string | null) => ['health', branchId] as const,
  expenses: (branchId: string | null, date?: string) => ['expenses', branchId, date ?? ''] as const,
  notifications: ['notifications'] as const,
};
