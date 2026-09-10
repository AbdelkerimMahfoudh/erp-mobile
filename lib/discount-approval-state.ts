/**
 * What the phone may say about an Owner approval — and what it may never
 * decide (A2/CP4).
 *
 * Pure. No React, no network, no clock of its own: every function takes the
 * server's row and the current time and returns what to render. That boundary
 * is the point. **Approval is a server fact.** This module can say "the server
 * told us this was approved"; it can never conclude that something is approved
 * because it looks like it should be. The sale is completed by the server
 * against its own row, and a phone that guessed would show a person a discount
 * that does not exist.
 *
 * The six states are kept distinct because they mean different things to the
 * person who asked. "Rejected" is an answer. "Expired" is nobody answering.
 * "Voided" is the world moving underneath. Collapsing them into "not approved"
 * would send an employee back to ask again when the Owner has already said no.
 */

/** The server's own lifecycle. Mirrors `DiscountApprovalStatus`. */
export type ApprovalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'voided'
  | 'consumed';

/** Why an approval stopped being usable, when the server says. */
export type VoidReason =
  | 'price_changed'
  | 'cost_changed'
  | 'unit_sold'
  | 'unit_transferred'
  | 'expired'
  | 'cancelled';

export interface DiscountApproval {
  id: string;
  status: ApprovalStatus;
  unitId: string;
  requesterId: string;
  approverId: string | null;
  configuredPrice: number;
  requestedPrice: number;
  discountAmount: number;
  approvedPrice: number | null;
  belowCost: boolean;
  reason: string | null;
  decisionNote: string | null;
  voidReason: VoidReason | string | null;
  expiresAt: string;
  createdAt: string;
  version: number;
  /** Stripped for anyone without `cost.view` — the gate does it, not this app. */
  unitCost?: number;
  product: { name: string; variant: string | null } | null;
  identifier: string | null;
  branchName: string | null;
  requesterName: string | null;
  approverName: string | null;
}

/** Terminal states. Asking again means a NEW request, never reviving one. */
const TERMINAL: ReadonlySet<ApprovalStatus> = new Set<ApprovalStatus>([
  'rejected',
  'expired',
  'voided',
  'consumed',
]);

export const isTerminal = (status: ApprovalStatus): boolean => TERMINAL.has(status);

/**
 * Has this lapsed, as far as the reader can tell?
 *
 * The server expires lazily, on read — so a row fetched a minute ago can be
 * past its expiry while still saying `pending`. Showing it as live would put a
 * countdown at zero beside an Approve button that is going to fail. Display
 * only: the server still decides, and its refusal is what is authoritative.
 */
export function hasLapsed(row: Pick<DiscountApproval, 'status' | 'expiresAt'>, now: Date): boolean {
  if (row.status !== 'pending' && row.status !== 'approved') return false;
  return new Date(row.expiresAt).getTime() <= now.getTime();
}

/** Whole minutes left, floored, never negative. Zero means gone. */
export function minutesLeft(expiresAt: string, now: Date): number {
  const ms = new Date(expiresAt).getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.floor(ms / 60_000);
}

/**
 * What the screen shows. One value, so a component never assembles a state out
 * of three booleans and gets the fourth combination wrong.
 */
export type ApprovalView =
  | 'pending'
  | 'lapsed'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'voided'
  | 'consumed';

export function viewOf(row: Pick<DiscountApproval, 'status' | 'expiresAt'>, now: Date): ApprovalView {
  if (hasLapsed(row, now)) return 'lapsed';
  return row.status;
}

/** Only the person who asked, and only while nobody has answered. */
export function canCancel(row: DiscountApproval, viewerId: string | null, now: Date): boolean {
  if (viewOf(row, now) !== 'pending') return false;
  return viewerId !== null && row.requesterId === viewerId;
}

/**
 * Only an Owner, only while it is still pending and still live.
 *
 * `mayApprove` is the client's read of `discount.override`, which is UX and not
 * security — the server refuses regardless. Hiding the buttons stops the app
 * lying about what this person can do.
 */
export function canDecide(row: DiscountApproval, mayApprove: boolean, now: Date): boolean {
  return mayApprove && viewOf(row, now) === 'pending';
}

/** Two money amounts are the same amount. The server uses the same epsilon. */
const SAME = (a: number, b: number): boolean => Math.abs(a - b) < 0.005;

/**
 * The approval this sale line may use, if the server has already granted one.
 *
 * **Exact unit, exact price.** Not "closest", not "cheapest", not "the most
 * recent one for this phone" — an approval for 15 000 must never be offered to
 * a sale at 1 500. The server enforces exactly this, and the client matches the
 * same way so the two never disagree about which request is being discussed.
 */
export function approvalFor(
  rows: readonly DiscountApproval[],
  unitId: string,
  price: number,
  now: Date,
): DiscountApproval | null {
  return (
    rows.find(
      (r) =>
        r.unitId === unitId &&
        viewOf(r, now) === 'approved' &&
        r.approvedPrice !== null &&
        SAME(r.approvedPrice, price),
    ) ?? null
  );
}

/** A pending request for this exact unit and price — "you already asked". */
export function pendingFor(
  rows: readonly DiscountApproval[],
  unitId: string,
  price: number,
  now: Date,
): DiscountApproval | null {
  return (
    rows.find(
      (r) => r.unitId === unitId && viewOf(r, now) === 'pending' && SAME(r.requestedPrice, price),
    ) ?? null
  );
}

/**
 * What the shop is giving up, as a percentage of its own set price.
 *
 * Deliberately not a margin: a percentage off the configured price reveals
 * nothing about cost, so it is safe in front of whoever is asking. Null rather
 * than a division by zero.
 */
export function discountPercent(
  row: Pick<DiscountApproval, 'configuredPrice' | 'requestedPrice'>,
): number | null {
  if (!(row.configuredPrice > 0)) return null;
  return Math.round(((row.configuredPrice - row.requestedPrice) / row.configuredPrice) * 100);
}

/**
 * The loss, for a reader who may see cost.
 *
 * `unitCost` arrives only when `CostGatingInterceptor` let it through, so an
 * absent cost is not an error — it is the gate working, and the caller shows
 * the neutral wording instead of inventing a figure.
 */
export function lossIfBelowCost(row: DiscountApproval): number | null {
  if (row.unitCost === undefined || !row.belowCost) return null;
  const price = row.approvedPrice ?? row.requestedPrice;
  const loss = row.unitCost - price;
  return loss > 0 ? Math.round(loss * 100) / 100 : null;
}

/**
 * How the sale screen must react to a refusal it did not expect.
 *
 * Every one of these is a server code, never matched prose. The app runs in
 * three languages; a regular expression over an English sentence works in
 * exactly one of them, and it is the developer's.
 */
export type SaleRefusal =
  | 'approval_required'
  | 'approval_price_changed'
  | 'approval_expired'
  | 'approval_already_used'
  | 'approval_unit_sold'
  | 'approval_unit_transferred'
  | 'approval_cost_changed'
  | 'acknowledgement_rejected'
  | 'unknown';

const REFUSALS: ReadonlySet<string> = new Set<SaleRefusal>([
  'approval_required',
  'approval_price_changed',
  'approval_expired',
  'approval_already_used',
  'approval_unit_sold',
  'approval_unit_transferred',
  'approval_cost_changed',
  'acknowledgement_rejected',
]);

export function refusalOf(code: string | undefined): SaleRefusal {
  return code && REFUSALS.has(code) ? (code as SaleRefusal) : 'unknown';
}
