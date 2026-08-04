import type { TrackingType } from '../../types/api';

/**
 * One product line in the delivery being staged.
 *
 * Grouped by product, not by scan: receiving twenty identical phones is one
 * line holding twenty identifiers, so the employee is asked for cost once
 * rather than twenty times. That grouping is the whole reason receiving a
 * delivery is fast.
 *
 * Nothing is committed until "Finish receiving" — the backend creates the
 * purchase, the units and the audit entry in a single transaction.
 */
export interface StagedItem {
  key: string;
  productId: string;
  label: string;
  variant: string | null;
  trackingType: TrackingType;
  /** Per-unit purchase cost. */
  unitCost: number;
  /** Optional selling price — receiving is when the shop decides it. */
  price?: number;
  /** Quantity-tracked products only. */
  quantity?: number;
  /** Serialized products only — one entry per physical unit. */
  identifiers?: string[];
  /**
   * Echoed back to the server on confirm so recognition learns this code.
   * Receiving is the strongest learning signal the system gets.
   */
  recognitionKey?: { codeType: string; code: string } | null;
}

/** How many physical units a line represents. */
export function itemCount(item: StagedItem): number {
  return item.quantity ?? item.identifiers?.length ?? 0;
}

export function stagedUnitTotal(items: StagedItem[]): number {
  return items.reduce((sum, item) => sum + itemCount(item), 0);
}

export function stagedCostTotal(items: StagedItem[]): number {
  return items.reduce((sum, item) => sum + item.unitCost * itemCount(item), 0);
}
