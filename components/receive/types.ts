import type { TrackingType } from '../../types/api';
import type { NewProductDraft } from '../../lib/receive-outcome';

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
  /** Empty while the line creates its product (D223). */
  productId: string;
  /** The product this delivery creates with this line, in the same request. */
  newProduct?: NewProductDraft;
  label: string;
  variant: string | null;
  trackingType: TrackingType;
  /** Per-unit buying cost, or `null` when it was left out after the warning (0107). Never a selling price. */
  unitCost: number | null;
  /** Quantity-tracked products only. */
  quantity?: number;
  /** Serialized products only — one entry per physical unit. */
  identifiers?: string[];
  /** IMEI 2 by IMEI 1, for dual-SIM phones. Optional for every phone. */
  secondaries?: Record<string, string>;
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
  // The KNOWN cost: a line without one adds nothing, and the row says its cost is missing.
  return items.reduce((sum, item) => sum + (item.unitCost ?? 0) * itemCount(item), 0);
}
