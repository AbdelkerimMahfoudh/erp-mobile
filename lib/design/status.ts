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
} as const satisfies Record<string, StatusMeta>;

/** `TransferStatus` — a stock movement between branches. */
export const transferStatus = {
  ready_to_ship: { tone: 'warning', labelKey: 'status.transfer.ready_to_ship' },
  in_transit: { tone: 'info', labelKey: 'status.transfer.in_transit' },
  received: { tone: 'success', labelKey: 'status.transfer.received' },
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

export const statusRegistry = {
  unit: unitStatus,
  transfer: transferStatus,
  sale: salePayStatus,
  purchase: purchaseStatus,
  tracking: trackingType,
  payment: paymentMethod,
  user: userStatus,
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
