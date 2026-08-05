// Shapes returned by the NestJS backend (/api/v1). Money fields may be absent
// for callers without `cost.view` (server strips them).

export type TrackingType = 'imei' | 'serial' | 'quantity';

export interface AuthUser {
  id: string;
  name: string;
  login: string;
  companyId: string;
}

export interface AuthResponse {
  tokenType: 'Bearer';
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  user: AuthUser;
}

export interface UserBranch {
  id: string;
  name: string;
  type: string;
  role: string;
}

export interface Category {
  id: string;
  name: string;
  defaultTrackingType: TrackingType;
  attributeSchema?: AttributeDef[] | null;
  isActive: boolean;
}

export interface AttributeDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'enum' | 'measurement';
  required?: boolean;
  unit?: string;
  options?: string[];
  min?: number;
  max?: number;
}

export interface Product {
  id: string;
  categoryId: string | null;
  brand: string;
  model: string;
  variant: string | null;
  trackingType: TrackingType;
  specifications?: Record<string, unknown> | null;
  barcode: string | null;
  defaultCost?: number | null;
  defaultPrice: number | null;
  reorderThreshold: number;
}

export interface ProductSuggestion {
  productId: string;
  brand: string;
  model: string;
  variant: string | null;
  trackingType: TrackingType;
  keySpecifications: Record<string, unknown>;
  image: string | null;
  defaultCost?: number | null;
  defaultPrice: number | null;
}

export interface ScanResult {
  code: string;
  kind: TrackingType | 'barcode' | 'unknown';
  recognized: boolean;
  confidence: number;
  recognitionKey: { codeType: string; code: string } | null;
  suggestion: ProductSuggestion | null;
  hint?: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  balance?: number;
}

export interface Unit {
  id: string;
  imeiPrimary: string | null;
  serialNo: string | null;
  status: string;
  cost?: number;
  branchId?: string;
  product?: { brand: string; model: string; variant: string | null; defaultPrice?: number | null; trackingType?: TrackingType };
}

/** Product identity carried by every inventory row. */
export interface InventoryProduct {
  brand: string;
  model: string;
  variant: string | null;
  barcode: string | null;
  trackingType: TrackingType;
  /**
   * Category-configured attributes — storage, colour, screen size and so on.
   * These are what distinguish one exact variant from another, which matters
   * most for aggregated rows that have no identifier to tell them apart.
   */
  specifications: Record<string, unknown> | null;
}

/** One serialized device: an identifier and a lifecycle status. */
export interface InventoryUnitRow {
  kind: 'unit';
  id: string;
  identifier: string;
  imeiPrimary: string | null;
  imeiSecondary: string | null;
  serialNo: string | null;
  status: string;
  /** Absent without `cost.view`. */
  cost?: number;
  dateIn: string;
  productId: string;
  product: InventoryProduct | null;
}

/** One product counted in bulk at this branch: a quantity, no status. */
export interface InventoryStockRow {
  kind: 'stock';
  id: string;
  productId: string;
  quantity: number;
  /** Absent without `cost.view`. */
  cost?: number;
  price: number;
  product: InventoryProduct | null;
}

/**
 * `GET /inventory` returns both shapes, discriminated by `kind`. They are not
 * forced into a common structure because they genuinely differ: a unit is one
 * device, a stock row is a count.
 */
export type InventoryRow = InventoryUnitRow | InventoryStockRow;

/**
 * One page of `GET /inventory`.
 *
 * `totals` counts everything matching the filter, not the rows returned — the
 * UI must never present a first page as if it were the whole stock.
 */
export interface InventoryPage {
  rows: InventoryRow[];
  /** Opaque. Pass back verbatim; null means this was the last page. */
  nextCursor: string | null;
  hasMore: boolean;
  totals: { units: number; stock: number };
}

export interface DashboardHome {
  today: { revenue: number; grossProfit?: number; netProfit?: number; salesCount: number; qtySold: number };
  month: { revenue: number; grossProfit?: number; netProfit?: number };
  inventory: { inventoryValue?: number; expectedProfit?: number; productCount: number };
  lowStockCount: number;
}

export interface HealthComponent {
  key: string;
  score: number;
  weight: number;
  contribution: number;
  insufficientData: boolean;
}
export interface HealthScore {
  score: number;
  status: 'red' | 'amber' | 'green';
  components: HealthComponent[];
}

// ── Business settings ───────────────────────────────────────────────────────

export type ReceivingProvider = 'bankily' | 'sedad' | 'bim_bank' | 'other';

/** What every caller receives — an employee gets exactly this and no more. */
export interface StaffReceivingAccount {
  id: string;
  provider: ReceivingProvider;
  providerName: string | null;
  label: string;
}

export interface OwnerReceivingAccount extends StaffReceivingAccount {
  isActive: boolean;
  sortOrder: number;
  version: number;
}

/**
 * The settings payload is discriminated by `canManage`, because the server
 * genuinely sends different shapes: an employee's response has no WhatsApp
 * preferences and no concurrency token at all. Modelling that as optional
 * fields would invite the UI to ask for something that was never sent.
 */
export interface StaffSettings {
  canManage: false;
  returnWindowHours: number;
  security: { autoLockMaxSeconds: number };
  receivingAccounts: StaffReceivingAccount[];
}

export interface OwnerSettings {
  canManage: true;
  returnWindowHours: number;
  whatsapp: {
    language: 'en' | 'ar';
    includeAmounts: boolean;
    dailyEnabled: boolean;
    monthlyEnabled: boolean;
  };
  security: { autoLockMaxSeconds: number };
  receivingAccounts: OwnerReceivingAccount[];
  version: number;
}

export type Settings = OwnerSettings | StaffSettings;
