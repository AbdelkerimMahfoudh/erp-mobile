// Shapes returned by the NestJS backend (/api/v1). Money fields may be absent
// for callers without `cost.view` (server strips them).

export type TrackingType = 'imei' | 'serial' | 'quantity';

export interface AuthUser {
  id: string;
  name: string;
  login: string;
  companyId: string;
  /**
   * Public Store Account ID (Stage 3.2) — the client namespaces its device
   * credential by this, at login and on a restored session. NOT a secret.
   */
  publicStoreId: string;
}

export interface AuthResponse {
  tokenType: 'Bearer';
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  user: AuthUser;
  /**
   * Present ONLY when this login enrolled a new device. The secret appears in
   * this one response and nowhere else — store it, never log it.
   */
  device?: { deviceId: string; deviceSecret: string; trustMethod: DeviceTrustMethod };
}

/** How a device came to be trusted. `otp` is Stage 4 and is never set today. */
export type DeviceTrustMethod = 'legacy' | 'password' | 'otp';

/**
 * A device the user has signed in from. Contains no secret and no hash — the
 * server never selects them.
 */
export interface UserDeviceView {
  id: string;
  label: string | null;
  platform: string | null;
  model: string | null;
  appVersion: string | null;
  trustMethod: DeviceTrustMethod;
  /** Derived server-side, so nothing can mistake a column for a verification. */
  otpVerified: boolean;
  reverifyRequired: boolean;
  firstSeenAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  isCurrent: boolean;
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

// ── Catalog (G1) ─────────────────────────────────────────────────────────────

/** One catalog row. `label` is the exact-variant name, assembled server-side. */
export interface ProductListRow {
  id: string;
  brand: string;
  model: string;
  variant: string | null;
  label: string;
  trackingType: TrackingType;
  serialized: boolean;
  barcode: string | null;
  categoryId: string | null;
  isActive: boolean;
}

/** A page of catalog rows. `nextCursor` is null on the last page. */
export interface ProductPage {
  rows: ProductListRow[];
  nextCursor: string | null;
  totalActive: number;
}

export interface ProductStockRow {
  branchId: string;
  branchName: string;
  quantity: number;
  /** Per-branch quantity price; null for serialized stock. */
  price: number | null;
}

export interface ProductDetail extends ProductListRow {
  specifications: Record<string, unknown>;
  categoryName: string | null;
  reorderThreshold: number;
  stockByBranch: ProductStockRow[];
  totalStock: number;
  /** The existing authoritative fallback price. Editing it is the Pricing phase. */
  defaultPrice: number | null;
  /** Stripped by the server for anyone without `cost.view`. */
  defaultCost?: number | null;
  lastSoldPrice: number | null;
  lastSoldAt: string | null;
  createdAt: string;
  updatedAt: string;
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

// ── Team (F1 Stage 1) ────────────────────────────────────────────────────────
export type UserStatus = 'active' | 'inactive' | 'pending_contact';

export interface TeamUserBranch {
  branchId: string;
  branchName: string;
  role: string;
  /**
   * Whether this assignment may receive delegated authority at all — true only
   * for a Store Manager. The server decides; the UI must not infer it from the
   * role string, or the two definitions drift.
   */
  canDelegate: boolean;
  /**
   * Delegated permissions currently granted on THIS branch assignment. Empty
   * for almost every assignment. Authority is per branch, so the same person
   * can appear here in one branch and not another.
   */
  grantedPermissions: string[];
}

/**
 * A company user as the Owner's Team screen sees them. No password, PIN or token
 * material is ever part of this shape — the server never selects it. The
 * `*VerifiedAt` fields are null in Stage 1 (there is no verification mechanism
 * yet), so the UI shows whether a contact is present, never a "verified" claim.
 */
export interface TeamUser {
  id: string;
  name: string;
  login: string;
  phone: string | null;
  email: string | null;
  phoneVerifiedAt: string | null;
  emailVerifiedAt: string | null;
  isActive: boolean;
  status: UserStatus;
  lastLoginAt: string | null;
  branches: TeamUserBranch[];
  /**
   * Every permission an Owner is allowed to delegate — the server's allow-list.
   * The screen renders one explicit control per known key rather than a generic
   * picker, so a new entry here can never become a surprise UI that grants
   * something nobody designed a screen for.
   */
  delegatablePermissions: string[];
}
