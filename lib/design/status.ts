/**
 * The status registry — every backend enum value mapped to a tone *and* a
 * translatable label, in one place.
 *
 * This exists so UX rule "status by colour AND words" is structural rather than
 * remembered: `StatusChip` takes a domain + value and cannot render a colour
 * without also rendering its word. Adding a status to the backend surfaces here
 * as a type error, not as a silently grey chip.
 */

import type { Intent } from './colors';
import type { TranslationKey } from '../i18n/keys';

export interface StatusMeta {
  tone: Intent;
  labelKey: TranslationKey;
}

/** `UnitStatus` — the lifecycle of one physical serialized item. */
export const unitStatus = {
  in_stock: { tone: 'success', labelKey: 'status.unit.in_stock' },
  reserved: { tone: 'warning', labelKey: 'status.unit.reserved' },
  sold: { tone: 'neutral', labelKey: 'status.unit.sold' },
  returned: { tone: 'warning', labelKey: 'status.unit.returned' },
  faulty: { tone: 'danger', labelKey: 'status.unit.faulty' },
  in_transit: { tone: 'info', labelKey: 'status.unit.in_transit' },
  transferred_out: { tone: 'neutral', labelKey: 'status.unit.transferred_out' },
  /** Its purchase was cancelled (0079): the phone never entered the books. */
  voided: { tone: 'neutral', labelKey: 'status.unit.voided' },
} as const satisfies Record<string, StatusMeta>;

/**
 * `TransferStatus` — a stock movement between branches.
 *
 * H1.2 replaced `ready_to_ship` with the approval lifecycle: a request now
 * waits for someone to agree before it can be sent. `pending_approval` is
 * warning-toned because it is somebody's outstanding work, not a healthy
 * resting state.
 */
export const transferStatus = {
  pending_approval: { tone: 'warning', labelKey: 'status.transfer.pending_approval' },
  approved: { tone: 'info', labelKey: 'status.transfer.approved' },
  in_transit: { tone: 'info', labelKey: 'status.transfer.in_transit' },
  received: { tone: 'success', labelKey: 'status.transfer.received' },
  rejected: { tone: 'danger', labelKey: 'status.transfer.rejected' },
  cancelled: { tone: 'neutral', labelKey: 'status.transfer.cancelled' },
} as const satisfies Record<string, StatusMeta>;

/** `SalePayStatus` — how fully a sale has been paid for. */
export const salePayStatus = {
  paid: { tone: 'success', labelKey: 'status.sale.paid' },
  partial: { tone: 'warning', labelKey: 'status.sale.partial' },
  credit: { tone: 'danger', labelKey: 'status.sale.credit' },
} as const satisfies Record<string, StatusMeta>;

/** `PurchaseStatus` — how fully a supplier has been paid. */
export const purchaseStatus = {
  paid: { tone: 'success', labelKey: 'status.purchase.paid' },
  partial: { tone: 'warning', labelKey: 'status.purchase.partial' },
  unpaid: { tone: 'danger', labelKey: 'status.purchase.unpaid' },
} as const satisfies Record<string, StatusMeta>;

/**
 * `TrackingType` — how a product's stock is counted. Deliberately neutral in
 * tone: it is a *fact about the product*, not a state needing attention.
 */
export const trackingType = {
  imei: { tone: 'neutral', labelKey: 'tracking.imei' },
  serial: { tone: 'neutral', labelKey: 'tracking.serial' },
  quantity: { tone: 'neutral', labelKey: 'tracking.quantity' },
} as const satisfies Record<string, StatusMeta>;

/** `PaymentMethod` — how the customer paid. */
export const paymentMethod = {
  cash: { tone: 'neutral', labelKey: 'payment.cash' },
  card: { tone: 'neutral', labelKey: 'payment.card' },
  mobile: { tone: 'neutral', labelKey: 'payment.mobile' },
  bank: { tone: 'neutral', labelKey: 'payment.bank' },
  other: { tone: 'neutral', labelKey: 'payment.other' },
} as const satisfies Record<string, StatusMeta>;

/**
 * `UserStatus` — a team member's state. `active` (usable and contactable),
 * `inactive` (deactivated, never deleted), `pending_contact` (active but no
 * phone yet, so unreachable for OTP/recovery). Warning, not danger, for pending:
 * it is a to-do, not a fault.
 */
export const userStatus = {
  active: { tone: 'success', labelKey: 'status.user.active' },
  inactive: { tone: 'neutral', labelKey: 'status.user.inactive' },
  pending_contact: { tone: 'warning', labelKey: 'status.user.pending_contact' },
} as const satisfies Record<string, StatusMeta>;

/**
 * `ReturnStatus` — a reviewed return (I2).
 *
 * `approved_refund_due` is deliberately `info`, not `success`. Nothing good has
 * finished happening: the shop now OWES money it has not paid, and colouring it
 * green would read as "settled" to the person glancing at a list.
 */
export const returnStatus = {
  pending_investigation: { tone: 'warning', labelKey: 'status.return.pending_investigation' },
  under_review: { tone: 'info', labelKey: 'status.return.under_review' },
  approved_refund_due: { tone: 'info', labelKey: 'status.return.approved_refund_due' },
  rejected: { tone: 'neutral', labelKey: 'status.return.rejected' },
} as const satisfies Record<string, StatusMeta>;

/** Where the phone physically is. */
export const returnCustody = {
  customer_holds: { tone: 'warning', labelKey: 'status.custody.customer_holds' },
  store_holds: { tone: 'info', labelKey: 'status.custody.store_holds' },
  handed_back: { tone: 'neutral', labelKey: 'status.custody.handed_back' },
  retained_hold: { tone: 'danger', labelKey: 'status.custody.retained_hold' },
} as const satisfies Record<string, StatusMeta>;

/** Who the investigation found responsible. */
export const returnResponsibility = {
  pending_investigation: { tone: 'neutral', labelKey: 'status.responsibility.pending_investigation' },
  store_or_product_fault: { tone: 'info', labelKey: 'status.responsibility.store_or_product_fault' },
  customer_damage: { tone: 'warning', labelKey: 'status.responsibility.customer_damage' },
  other: { tone: 'neutral', labelKey: 'status.responsibility.other' },
} as const satisfies Record<string, StatusMeta>;

/**
 * `DiscountApprovalStatus` — one Owner-approved exception to the set price.
 *
 * Six values, kept apart on purpose. "Rejected" is an answer, "expired" is
 * nobody answering, and "voided" is the world moving underneath — a seller told
 * only "not approved" would go and ask again in the one case where the Owner
 * has already said no. `consumed` is the success state and reads as one.
 */
export const discountApprovalStatus = {
  pending: { tone: 'warning', labelKey: 'status.approval.pending' },
  approved: { tone: 'success', labelKey: 'status.approval.approved' },
  rejected: { tone: 'danger', labelKey: 'status.approval.rejected' },
  expired: { tone: 'neutral', labelKey: 'status.approval.expired' },
  voided: { tone: 'neutral', labelKey: 'status.approval.voided' },
  consumed: { tone: 'success', labelKey: 'status.approval.consumed' },
} as const satisfies Record<string, StatusMeta>;

export const statusRegistry = {
  unit: unitStatus,
  transfer: transferStatus,
  sale: salePayStatus,
  purchase: purchaseStatus,
  tracking: trackingType,
  payment: paymentMethod,
  user: userStatus,
  return: returnStatus,
  custody: returnCustody,
  responsibility: returnResponsibility,
  approval: discountApprovalStatus,
} as const;

export type StatusDomain = keyof typeof statusRegistry;
export type StatusValue<D extends StatusDomain> = keyof (typeof statusRegistry)[D];

/**
 * Look up a status, tolerating values this build has not seen. The backend can
 * gain an enum member before the app ships; an unknown value degrades to a
 * neutral chip showing the raw value rather than crashing a sale in progress.
 */
export function resolveStatus(domain: StatusDomain, value: string): StatusMeta | null {
  const table = statusRegistry[domain] as Record<string, StatusMeta | undefined>;
  return table[value] ?? null;
}
