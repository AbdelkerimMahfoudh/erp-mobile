import type { TrackingType } from '../../types/api';

/**
 * One line in the sale being built.
 *
 * A serialized line is a specific physical unit (`identifier`, always quantity
 * 1 — you cannot sell two of the same IMEI). A quantity line is a product plus
 * a count. The backend's `SaleLineDto` is the same shape, so a line maps to a
 * payload entry with no translation.
 */
export interface CartLine {
  /** Stable client key — never sent. */
  key: string;
  kind: 'unit' | 'quantity';
  /** IMEI or serial, for `unit` lines. */
  identifier?: string;
  /** Product template id, for `quantity` lines. */
  productId?: string;
  label: string;
  variant?: string | null;
  trackingType: TrackingType;
  quantity: number;
  /** Unit price, editable at the counter. */
  price: number;
  /**
   * Per-unit cost, present only for callers with `cost.view` — the server
   * strips it otherwise. Used solely to warn before selling below cost.
   */
  cost?: number;
}

export interface PaymentEntry {
  key: string;
  method: 'cash' | 'card' | 'mobile' | 'bank' | 'other';
  amount: number;
  /**
   * Which configured account this money reached. Required by the server for
   * every non-cash method and refused for cash — the drawer belongs to no
   * account. Money with no account used to be recorded as "unattributed",
   * which nothing could reconcile.
   */
  receivingAccountId?: string;
}

export function lineTotal(line: CartLine): number {
  return line.price * line.quantity;
}

export function cartSubtotal(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + lineTotal(line), 0);
}

/**
 * Total cost of what is being sold, or undefined when any line's cost is
 * hidden. Undefined means "we cannot judge margin here" — the server still
 * can, and will reject a below-cost sale without an override.
 */
export function cartCost(lines: CartLine[]): number | undefined {
  if (lines.some((line) => line.cost === undefined)) return undefined;
  return lines.reduce((sum, line) => sum + (line.cost ?? 0) * line.quantity, 0);
}
