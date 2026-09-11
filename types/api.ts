import type { ReturnEligibilityReason } from '../lib/return-policy';

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
  /**
   * The generated identifier this person can sign in with instead of a phone
   * number (CP3). Shown in Settings so nobody has to ask support for it.
   */
  personalId: string;
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

/**
 * One phone number, more than one shop (CP3).
 *
 * Returned by `/auth/login` INSTEAD of tokens, and only ever after the password
 * has already been verified — which is why it is safe for it to name shops at
 * all. It carries no access token and cannot be used as one.
 */
export interface AccountChoice {
  status: 'choose_account';
  continuationToken: string;
  expiresIn: number;
  accounts: { accountRef: string; companyName: string; userName: string }[];
}

/** What `/auth/login` may answer: signed in, or "which shop did you mean?". */
export type LoginResult = AuthResponse | AccountChoice;

export function isAccountChoice(r: LoginResult): r is AccountChoice {
  return (r as AccountChoice).status === 'choose_account';
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
  /** False once stock/purchase/sale history exists — the edit form locks the control. */
  canChangeTracking: boolean;
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
  /**
   * Whether this identifier is ALREADY a phone in stock.
   *
   * Kept apart from `recognized` deliberately: that says the server knows what
   * product the TAC belongs to, which is true for every iPhone 15 ever made.
   * Only this says the shop already holds **this handset**. The client used to
   * have to guess from `recognized`, and guessing either way is wrong — as a
   * duplicate check it refuses the second phone of every model, and as a
   * product hint it offers to create a unit that already exists.
   *
   * Null for a barcode: a barcode names a reusable product, not a physical
   * thing, so the question does not apply to it.
   */
  inventory: ScanInventoryMatch | null;
  /** English, for older clients. Never shown — translate `hintCode`. */
  hint?: string;
  hintCode?: string;
  hintParams?: Record<string, string>;
}

/** What the server will say about an identifier it has seen before. */
export interface ScanInventoryMatch {
  alreadyInInventory: boolean;
  matchedIdentifierPosition: 'primary' | 'secondary' | null;
  /** Populated only for a unit this user may actually see. */
  unit: { productLabel: string; branchName: string; status: string } | null;
  /**
   * Taken by a unit outside this company or this user's branches.
   *
   * Intake is still refused — IMEI uniqueness is global — but nothing may be
   * shown about whose it is. The screen says "already in inventory" and stops.
   */
  elsewhere: boolean;
  /** Two identifiers matched two different units — never one phone. */
  conflictingUnits: boolean;
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
  /**
   * PHYSICAL stock owned at this branch (H1.1).
   *
   * Deliberately NOT reduced by reservations — the goods are still the
   * company's and still count in inventory valuation. Never label this
   * "available".
   */
  quantity: number;
  /** Promised to an open transfer, so not sellable. */
  reservedQuantity: number;
  /** What can actually be sold: `quantity - reservedQuantity`. */
  availableQuantity: number;
  /** Absent without `cost.view`. */
  cost?: number;
  /**
   * `null` means UNPRICED, not free (H1.4).
   *
   * Stock a transfer delivered into a branch that has never priced this product
   * arrives without one, because a selling price is a decision made with
   * authority in one branch and must not travel with the goods.
   */
  price: number | null;
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

/**
 * One phone model, and how many are on the shelf.
 *
 * Server-calculated from the Unit rows on every request. There is deliberately
 * no client-side counter: a number that is maintained rather than derived
 * drifts the first time a sale or a transfer takes a path nobody updated.
 */
/**
 * One exact variant on the shelf — `GET /inventory/summary`.
 *
 * What the Stock screen lists. Server-derived on every request: `available`
 * excludes reserved quantity and non-`in_stock` units, `lowStock` is the shop's
 * own threshold (the dashboard's rule), and `price` comes from the sale's own
 * price ladder. **There is no cost or margin in this row, ever.**
 */
export interface StockSummaryRow {
  productId: string;
  brand: string;
  model: string;
  variant: string | null;
  barcode: string | null;
  trackingType: TrackingType;
  specifications: Record<string, unknown> | null;
  category: 'phone' | 'accessory' | 'other';
  /** Sellable now: in-stock units, or physical quantity minus reserved. */
  available: number;
  /** Physically held — what the low-stock rule compares. */
  onHand: number;
  /** Promised to an open transfer; 0 for serialized goods. */
  reserved: number;
  lowStock: boolean;
  lowStockThreshold: number;
  /**
   * Null when nothing in the row has a selling price — "no price set", never
   * zero. When units resolve to different prices (a unit override), `min` and
   * `max` differ and the client must show a range, not one of them.
   */
  price: { min: number; max: number; pricedCount: number; unpricedCount: number } | null;
}

export interface ModelStockRow {
  brand: string;
  model: string;
  trackingType: TrackingType;
  inStock: number;
  /** The product rows folded into this line — several is normal, not a fault. */
  productIds: string[];
  /** Storage and colour. Detail only; never splits the headline count. */
  variants: { variant: string | null; inStock: number }[];
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
    /**
     * Mirrors the server's `SummaryLanguage` enum, widened to French in
     * migration `0053`. Kept in step deliberately: this type is an assertion
     * over whatever the server sent, not a check of it, so a value the server
     * accepts and this union omits fails silently rather than loudly.
     */
    language: 'en' | 'ar' | 'fr';
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

// ─────────────────────────── Pricing (G2A-CP3/CP4) ───────────────────────────

/**
 * Which rung of the server's price ladder produced the effective price.
 *
 * **The app must never re-derive this order.** The server owns precedence
 * (`unit_override` → `branch_variant` → `stock_item` → `product_default` →
 * `unpriced`); the app only renders what came back. Two implementations of the
 * same ladder is how a screen and a till start disagreeing about a price.
 */
export type PriceSource =
  | 'unit_override'
  | 'branch_variant'
  | 'stock_item'
  | 'product_default'
  | 'unpriced';

/** What would have to be edited to change the effective price. */
export type PriceTargetType = 'unit' | 'branch_variant' | 'stock_item';

/**
 * The server's answer to "what does this cost here?".
 *
 * `version` is the compare-and-swap token: send back exactly what was received,
 * or the server answers 409 rather than letting one edit silently overwrite
 * another. It is `null` when the price comes from a fallback, because a fallback
 * is not a row anyone can edit.
 */
export interface EffectivePrice {
  /** `null` only when `source` is `unpriced` — never render this as 0. */
  price: number | null;
  source: PriceSource;
  version: number | null;
  targetType: PriceTargetType | null;
  branchId: string;
  /** True when a real row (not a fallback) is producing the price. */
  canRemove: boolean;
  /** What the price would become if that row were removed. Null when nothing to remove. */
  fallback: { price: number | null; source: PriceSource } | null;
  /**
   * An override exists but does not apply in this branch — reported so the UI
   * can explain the price instead of looking broken. Never applied.
   */
  staleOverrideIgnored: boolean;
}

/** Exact-unit pricing also identifies which unit answered, and whether it may be priced. */
export interface UnitEffectivePrice extends EffectivePrice {
  unitId: string;
  /** Backend unit status: in_stock, sold, returned, faulty, in_transit, … */
  status: string;
  /**
   * False for a phone that is not on the shelf here. The UI hides the edit
   * action rather than offering one the server will refuse.
   */
  canPrice: boolean;
}

/**
 * `PUT /pricing/products/:id/branch-price` and `PUT /pricing/units/:identifier/price`.
 *
 * `expectedVersion` is required when a price already exists and must be omitted
 * when creating the first one — the server answers 409 `refresh_required` either
 * way rather than guessing. `reason` is required only when the server says the
 * price is below cost.
 */
export interface SetPriceBody {
  price: number;
  expectedVersion?: number;
  reason?: string;
}

/** `PUT /pricing/products/:id/stock-price` — quantity stock always has a row. */
export interface SetStockPriceBody {
  price: number;
  expectedVersion: number;
  reason?: string;
}

/** Removal always states the version it believed it was removing. */
export interface RemovePriceBody {
  expectedVersion: number;
  reason?: string;
}

/**
 * One entry in the append-only price history.
 *
 * `initiator` is `user` or `system` — deliberately not a role. The actor's name
 * is recorded at the time; a role read today could have changed since, and
 * history must not move. `newPrice` is `null` when the price was removed.
 */
export interface PriceHistoryRow {
  id: string;
  productId: string;
  unitId: string | null;
  scope: 'unit' | 'branch_variant' | 'stock_item';
  initiator: 'user' | 'system';
  previousPrice: number | null;
  newPrice: number | null;
  reason: string | null;
  actorName: string | null;
  at: string;
}

/** Keyset-paginated, newest first. Never fetch it unbounded. */
export interface PriceHistoryPage {
  rows: PriceHistoryRow[];
  nextCursor: string | null;
}

// ─────────────────────────── Notifications (CP4.5) ───────────────────────────

/**
 * One in-app notification exactly as the server stored it.
 *
 * The app never recomposes the wording: a `price.changed` message must say what
 * the Owner was told when it happened, and by CP3's design it carries no cost
 * and no margin.
 */
export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  /** In-app route the server chose. The app follows it; it does not invent one. */
  actionLink: string | null;
  /**
   * The fields behind the message, when the server stored them (H1.3). The app
   * composes the sentence from these in the reader's language; `title`/`body`
   * remain the fallback for any type this build does not recognise.
   */
  payload: TransferNotificationPayload | DiscountApprovalNotificationPayload | null;
  isRead: boolean;
  createdAt: string;
}

/**
 * What an approval notification carries, so the sentence can be built in the
 * reader's language rather than shipped from the server in English.
 *
 * Prices only. No cost and no margin: a notification is read outside the
 * request that authorised it, by whoever happens to pick the phone up.
 * `belowCost` is a flag and discloses no amount.
 */
export interface DiscountApprovalNotificationPayload {
  event: 'requested' | 'approved' | 'rejected';
  configuredPrice?: number;
  requestedPrice?: number;
  discountAmount?: number;
  approvedPrice?: number | null;
  belowCost?: boolean;
  note?: string | null;
}

/** Keyset-paginated and bounded by the server (default 25, hard max 50). */
export interface NotificationPage {
  rows: AppNotification[];
  nextCursor: string | null;
  unreadCount: number;
}

/**
 * The fields a transfer notification carries so the app can say the same thing
 * in Arabic (H1.3). `title`/`body` remain the fallback for any type this build
 * does not recognise. Deliberately no cost, price or margin.
 */
export interface TransferNotificationPayload {
  event: TransferEvent;
  transferNo: string;
  fromBranch: string;
  toBranch: string;
  units: number;
  actor: string;
  reason: string | null;
}

// ──────────────────────────── Transfers (H1.3) ────────────────────────────

export type TransferStatus =
  | 'pending_approval'
  | 'approved'
  | 'in_transit'
  | 'received'
  | 'rejected'
  | 'cancelled';

export type TransferEvent =
  | 'requested'
  | 'created_approved'
  | 'approved'
  | 'rejected'
  | 'shipped'
  | 'received'
  | 'cancelled';

export interface TransferBranchRef {
  id: string;
  name: string;
}

/** Which way the stock moves, as seen from the branch the user is standing in. */
export type TransferDirection = 'outgoing' | 'incoming';

// ───────────────────────────── Sales history (I1) ─────────────────────────────

export type { ReturnEligibilityReason };

export type SalePayStatus = 'paid' | 'partial' | 'credit';
export type PaymentMethod = 'cash' | 'card' | 'mobile' | 'bank' | 'other';

/**
 * The return policy the SALE was sold under, plus what the server says about it
 * right now. Never recomputed on the device: the shop's promise is not a thing
 * a phone's clock gets to decide.
 */
export interface SaleReturnPolicy {
  windowHours: number;
  deadlineAt: string | null;
  eligible: boolean;
  reason: ReturnEligibilityReason;
  remainingMs: number | null;
  requiresOwnerException: boolean;
  overriddenBy?: string | null;
  overrideReason?: string | null;
}

export interface SaleListRow {
  id: string;
  invoiceNo: string;
  soldAt: string;
  total: number;
  /** Both absent without `cost.view` — stripped by the server, not hidden here. */
  totalCost?: number;
  margin?: number;
  amountPaid: number;
  balanceDue: number;
  payStatus: SalePayStatus;
  isReversed: boolean;
  /** Rows on the sale. NOT how many things — see `itemCount`. */
  lineCount: number;
  /** Everything sold, counted as things: 1 phone + 10 cables = 11. */
  itemCount: number;
  serializedCount: number;
  soldBy: string | null;
  customer: string | null;
  paymentMethods: PaymentMethod[];
  returnPolicy: SaleReturnPolicy;
}

export interface SalePage {
  rows: SaleListRow[];
  nextCursor: string | null;
}

export interface SaleLine {
  id: string;
  unitId: string | null;
  imei: string | null;
  imeiSecondary: string | null;
  serialNo: string | null;
  product: string | null;
  barcode: string | null;
  trackingType: string | null;
  quantity: number;
  price: number;
  discount: number;
  taxAmount: number;
  /** Absent without `cost.view`. */
  cost?: number;
  voided: boolean;
}

export interface SalePaymentRecord {
  id: string;
  method: PaymentMethod;
  amount: number;
  paidAt: string;
}

export interface SaleDetail {
  id: string;
  invoiceNo: string;
  soldAt: string;
  branch: TransferBranchRef;
  soldBy: string | null;
  customer: { id: string; name: string | null; phone: string | null } | null;
  subtotal: number;
  discount: number;
  taxTotal: number;
  total: number;
  /** Absent without `cost.view`. */
  totalCost?: number;
  margin?: number;
  amountPaid: number;
  balanceDue: number;
  payStatus: SalePayStatus;
  dueDate: string | null;
  isReversed: boolean;
  lines: SaleLine[];
  payments: SalePaymentRecord[];
  returnPolicy: SaleReturnPolicy;
}

export interface TransferListRow {
  id: string;
  transferNo: string | null;
  status: TransferStatus;
  direction: TransferDirection;
  from: TransferBranchRef;
  to: TransferBranchRef;
  /** Rows on the transfer. NOT how many things — see `totalQuantity`. */
  itemCount: number;
  unitCount: number;
  quantityLineCount: number;
  /** Everything being moved, counted as things: 2 phones + 10 cables = 12. */
  totalQuantity: number;
  requestedBy: string | null;
  requestedAt: string;
  approvedAt: string | null;
  sentAt: string | null;
  receivedAt: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  autoApproved: boolean;
}

export interface TransferPage {
  rows: TransferListRow[];
  nextCursor: string | null;
}

/** How much transfer work is waiting at this branch — the navigation badge. */
export interface TransferCounts {
  pendingApproval: number;
  approved: number;
  inTransit: number;
}

/**
 * Why an action is unavailable. The distinction matters: a missing permission
 * is a different sentence from standing in the wrong branch, and only one of
 * them has a button.
 */
export type TransferActionReason = 'status' | 'permission' | 'branch' | 'ownership' | null;

export interface TransferAction {
  allowed: boolean;
  reason: TransferActionReason;
  /** The branch this action must be performed from — what "Switch to…" needs. */
  branchId: string;
  branchName: string;
}

export type TransferActionName = 'approve' | 'reject' | 'ship' | 'receive' | 'cancel';

export interface TransferDetail {
  id: string;
  transferNo: string | null;
  status: TransferStatus;
  /** Send this back with every action, so a stale decision is refused. */
  version: number;
  direction: TransferDirection;
  from: TransferBranchRef;
  to: TransferBranchRef;
  autoApproved: boolean;
  decisionReason: string | null;
  people: {
    requestedBy: string | null;
    approvedBy: string | null;
    decidedBy: string | null;
    sentBy: string | null;
    receivedBy: string | null;
  };
  timestamps: {
    requestedAt: string;
    approvedAt: string | null;
    sentAt: string | null;
    receivedAt: string | null;
    decidedAt: string | null;
  };
  /** Individual devices carried. */
  unitCount: number;
  /** How many distinct accessories, NOT how many of them. */
  quantityLineCount: number;
  /** Everything being moved, counted as things: 2 phones + 10 cables = 12. */
  totalQuantity: number;
  items: TransferDetailLine[];
  actions: Record<TransferActionName, TransferAction>;
}

/**
 * One line of a transfer, discriminated by `kind`.
 *
 * The server states which kind it is rather than leaving the app to infer it
 * from which fields are null — a client guessing from absent fields is a client
 * that will eventually guess wrong.
 */
export type TransferDetailLine =
  | {
      kind: 'unit';
      id: string;
      identifier: string | null;
      product: string | null;
      variant: string | null;
      quantity: 1;
      unitStatus: string | null;
    }
  | {
      kind: 'stock';
      id: string;
      productId: string | null;
      product: string | null;
      variant: string | null;
      barcode: string | null;
      /** How many were requested. */
      quantity: number;
      /** Source stock as the server sees it now — null once shipped. */
      physicalQuantity: number | null;
      reservedQuantity: number | null;
      availableQuantity: number | null;
      identifier: null;
      unitStatus: null;
    };

export type CreateTransferLine =
  | { kind: 'unit'; identifier: string }
  | { kind: 'stock'; productId: string; quantity: number };

export interface CreateTransferBody {
  clientUuid: string;
  toBranchId: string;
  /** Mixed serialized and quantity lines (H1.4). */
  lines: CreateTransferLine[];
}

export interface CreateTransferResult {
  id: string;
  transferNo: string | null;
  status: TransferStatus;
  autoApproved: boolean;
  version: number;
  /** Individual devices. */
  units: number;
  quantityLines: number;
  totalQuantity: number;
}

/** Every lifecycle action carries the version the caller last saw. */
export interface TransferDecisionBody {
  expectedVersion: number;
  reason?: string;
}

// ───────────────────────────── Returns (I2) ─────────────────────────────────
// Shapes match the SERIALIZED HTTP responses of `ReturnsService`, not the
// Prisma models: binary ids arrive as UUID strings and Decimals as numbers.

export type ReturnStatus =
  | 'pending_investigation'
  | 'under_review'
  | 'approved_refund_due'
  | 'rejected';

export type ReturnCustody = 'customer_holds' | 'store_holds' | 'handed_back' | 'retained_hold';

export type ReturnResponsibility =
  | 'pending_investigation'
  | 'store_or_product_fault'
  | 'customer_damage'
  | 'other';

export type ReturnAdjustmentKind =
  | 'screen_protector'
  | 'accessory_retained'
  | 'restocking_fee'
  | 'other';

export interface ReturnListRow {
  id: string;
  status: ReturnStatus;
  custody: ReturnCustody;
  responsibility: ReturnResponsibility;
  invoiceNo: string;
  product: string;
  identifier: string | null;
  requestedBy: string | null;
  requestedAt: string;
  /** The eligibility reason snapshotted when the request was raised. */
  policyReason: ReturnEligibilityReason;
  requiresException: boolean;
  /** PROVISIONAL until approval writes the immutable reversal. */
  provisionalGrossRefund: number;
  provisionalAdjustmentTotal: number;
  provisionalNetRefundDue: number;
}

export interface ReturnPage {
  rows: ReturnListRow[];
  nextCursor: string | null;
}

export interface ReturnAdjustmentRow {
  id: string;
  kind: ReturnAdjustmentKind;
  label: string;
  quantity: number;
  unitAmount: number;
  totalAmount: number;
  addedBy: string | null;
  addedAt: string;
}

export interface ReturnTimelineEntry {
  at: string;
  event: string;
  by: string | null;
}


/**
 * The refund payout on a return (I3).
 *
 * `null` on `ReturnDetail` means **nobody has reported a payout yet**, which is
 * a different thing from reported-and-unconfirmed. The screen must not blur the
 * two: one owes the customer money, the other is waiting on a signature.
 */
export type RefundMethod = 'cash' | 'account';

/** A correction raised against a confirmed payment (Milestone B). */
export interface PaymentCorrectionRef {
  id: string;
  status: FinancialCorrectionStatus;
  reason: string;
  supportingReference?: string | null;
  requestedBy: string | null;
  requestedAt: string;
  decidedBy: string | null;
  /** The day the money went back. Null until approved. */
  correctionDate: string | null;
  version: number;
}

export interface ReturnPayout {
  /** The payout's own id — the correction's target. */
  id: string;
  /** `reported_pending_confirmation` is a CLAIM. Only `confirmed` is the record. */
  status: 'reported_pending_confirmation' | 'confirmed';
  /** The payout version — NOT the return version. Send it with correct/confirm. */
  version: number;
  /** The immutable amount owed. There is no partial payout. */
  netAmountDue: number;
  reportedAmount: number;
  method: RefundMethod;
  /**
   * The account label as it read WHEN the payout was reported, frozen at
   * confirmation. A later rename must not retitle a movement that already
   * happened, so this is never re-resolved from the account.
   */
  accountLabel: string | null;
  transactionReference: string | null;
  note: string | null;
  reportedBy: string | null;
  reportedAt: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
  /** Any correction raised against this payout. Null means none. */
  correction: PaymentCorrectionRef | null;
}

/** What the customer receipt says. Available only once confirmed. */
export interface RefundReceipt {
  store: { name: string; branch: string; phone: string | null };
  reference: string;
  originalInvoiceNo: string;
  confirmedAt: string;
  product: string;
  identifier: string | null;
  grossRefund: number;
  adjustments: { label: string; quantity: number; amount: number }[];
  netAmountReturned: number;
  method: RefundMethod;
  accountLabel: string | null;
  transactionReference: string | null;
  status: 'confirmed';
  reportedBy: string | null;
  confirmedBy: string | null;
}

/**
 * Refund money, with the three timings kept apart.
 *
 * `approved` is the approval-date profit effect; `confirmed` is the
 * confirmation-date cash movement. Collapsing them is how a refund gets counted
 * twice, so the screen shows them separately too.
 */
export interface RefundSummary {
  approved: {
    count: number;
    grossRefund: number;
    adjustments: number;
    /** Absent without `cost.view` — the gating interceptor strips it. */
    cogsCredited?: number;
    profitEffect: number;
  };
  /** Approved and not yet confirmed, all time. Derived, never stored. */
  outstandingLiability: { count: number; amount: number };
  /** Reported and waiting on a manager or owner. NOT a cash movement. */
  awaitingConfirmation: { count: number; amount: number };
  confirmed: {
    count: number;
    total: number;
    cash: number;
    byAccount: { label: string; amount: number; count: number }[];
  };
}

export interface ReturnDetail {
  id: string;
  status: ReturnStatus;
  /** Send with every write. A stale value is a 409 `refresh_required`. */
  version: number;
  custody: ReturnCustody;
  custodyReceivedAt: string | null;
  custodyReturnedAt: string | null;
  responsibility: ReturnResponsibility;
  responsibilityNotes: string | null;
  requestReason: string;
  conditionNotes: string | null;
  sale: { id: string; invoiceNo: string; soldAt: string };
  phone: {
    unitId: string;
    imei: string | null;
    serialNo: string | null;
    product: string;
    /** So a screen can say "held, not sellable" from the same fact inventory uses. */
    unitStatus: string;
  };
  policy: {
    windowHours: number;
    deadlineAt: string | null;
    reason: ReturnEligibilityReason;
    requiresException: boolean;
  };
  money: {
    /** True until approval. The screen must never call these figures final. */
    provisional: boolean;
    grossRefund: number;
    adjustmentTotal: number;
    netRefundDue: number;
    /** Absent without `cost.view` — show "Hidden", never 0. */
    cost?: number;
  };
  adjustments: ReturnAdjustmentRow[];
  timeline: ReturnTimelineEntry[];
  requestedBy: string | null;
  requestedAt: string;
  /** `null` until somebody reports a payout. See `ReturnPayout`. */
  payout: ReturnPayout | null;
}

// ── Suppliers and payables (J1) ──────────────────────────────────────────────

/**
 * One supplier in a list.
 *
 * `outstanding` is ABSENT — not zero — for anyone without permission to see
 * what the shop owes. Receiving needs the name; it does not need the debt.
 */
export interface SupplierRow {
  id: string;
  name: string;
  phone: string | null;
  isActive: boolean;
  outstanding?: number;
}

export interface SupplierPage {
  rows: SupplierRow[];
  nextCursor: string | null;
}

/** One purchase and how much of it is still owed. Derived, never stored. */
export interface SupplierLedgerPurchase {
  purchaseId: string;
  referenceNo: string | null;
  date: string;
  dueDate: string | null;
  branch: { id: string; name: string };
  total: number;
  paid: number;
  outstanding: number;
  status: 'unpaid' | 'partial' | 'paid';
}

export interface SupplierSettlement {
  id: string;
  /** `reported` is a CLAIM. Only `confirmed` moved money. */
  status: 'reported' | 'confirmed';
  /** The SETTLEMENT version — send it with correct and confirm. */
  version: number;
  amount: number;
  method: 'cash' | 'account';
  /** Frozen when reported. A later rename never rewrites it. */
  accountLabel: string | null;
  transactionReference: string | null;
  note: string | null;
  branch: string | null;
  reportedBy: string | null;
  reportedAt: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
  confirmationDate: string | null;
  allocations: { purchaseId: string; amount: number }[];
  supplier?: { id: string; name: string };
  /** Any correction raised against this settlement. Null means none. */
  correction: PaymentCorrectionRef | null;
}

/** The financial half of a supplier. `null` when the caller may not see it. */
export interface SupplierLedger {
  totalPurchased: number;
  totalConfirmedPaid: number;
  /** Still owed. Derived from immutable rows, all time. */
  outstanding: number;
  /** Reported and waiting on a manager. NOT a cash movement. */
  awaitingConfirmation: number;
  purchases: SupplierLedgerPurchase[];
  settlements: SupplierSettlement[];
}

export interface SupplierDetail {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
  isActive: boolean;
  ledger: SupplierLedger | null;
}

/** Open purchases, with the server's suggested oldest-first split. */
export interface SupplierPayable {
  supplier: { id: string; name: string; isActive: boolean };
  outstanding: number;
  purchases: {
    purchaseId: string;
    total: number;
    paid: number;
    outstanding: number;
    date: string;
  }[];
  /** A SUGGESTION the screen shows before anything is sent. */
  suggested: { purchaseId: string; amount: number }[];
}

/**
 * Correcting a payment that was already confirmed (Milestone B).
 *
 * The correction never rewrites the payment it corrects. It sits beside it, and
 * the liability comes back because the server excludes a corrected payment from
 * every derivation of "what is owed".
 *
 * `requested` moves no money. Only `approved` does — and only an Owner can
 * cause it.
 */
export type FinancialCorrectionKind = 'refund_payout' | 'supplier_settlement';
export type FinancialCorrectionStatus = 'requested' | 'approved' | 'rejected';

export interface FinancialCorrection {
  id: string;
  targetKind: FinancialCorrectionKind;
  targetId: string | null;
  status: FinancialCorrectionStatus;
  reason: string;
  supportingReference: string | null;
  /** Copied from the target — never entered by hand. */
  amount: number;
  method: RefundMethod;
  accountLabel: string | null;
  requestedBy: string | null;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  /** The business day the compensating movement posts to. Null until approved. */
  correctionDate: string | null;
  /** Send with approve/reject. A stale one is a 409. */
  version: number;
}

export interface CorrectionPage {
  rows: FinancialCorrection[];
  nextCursor: string | null;
}

/**
 * An expense (Milestone D).
 *
 * `reported` moves no money and reaches no report. Only `confirmed` does — and
 * only an Owner can cause it.
 *
 * Two accounting classes, and the difference is not cosmetic: a `variable`
 * expense belongs to the day it was CONFIRMED; a `fixed` one to its DUE date,
 * and is never spread across every day.
 */
export type ExpenseStatus = 'reported' | 'confirmed' | 'rejected';
export type ExpenseClass = 'variable' | 'fixed';

export interface Expense {
  id: string;
  category: string;
  amount: number;
  status: ExpenseStatus;
  expenseClass: ExpenseClass;
  /** Salaries stay separately reportable from other fixed costs. */
  isSalary: boolean;
  /** The date a FIXED expense is recognised on. Null for variable. */
  dueDate: string | null;
  /** Only `cash` touches the drawer. */
  method: 'cash' | 'account';
  /** Frozen when reported; a later rename never rewrites it. */
  accountLabel: string | null;
  reference: string | null;
  note: string | null;
  /** True when the Owner knowingly confirmed without stating a reason. */
  reasonOmitted: boolean;
  rejectedReason: string | null;
  spentOn: string;
  reportedBy: string | null;
  reportedAt: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  /** The business day the money is counted against. Null until confirmed. */
  confirmationDate: string | null;
  /** Send with confirm/reject. A stale one is a 409. */
  version: number;
}

export interface ExpensePage {
  rows: Expense[];
}

/**
 * What  answers.
 *
 * Deliberately NOT a session. Registration proves somebody filled a form; it
 * does not prove they can read the address they typed, so it cannot sign them
 * in. The continuation carries the attempt forward and buys exactly one thing:
 * the completion of THIS registration, once, after the bound code is proved.
 */
export interface RegistrationStarted {
  status: string;
  created: boolean;
  publicStoreId: string;
  /** Where the code goes. Masked by the server; taken from the Owner record. */
  verification: { destination: string; channel: 'email' | 'phone' } | null;
  continuation: { token: string; expiresAt: string; expiresInSeconds: number } | null;
  next: string;
}

/** The ordinary session pair, as any sign-in returns it. */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}
