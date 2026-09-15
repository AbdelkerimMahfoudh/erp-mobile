/**
 * How a variant's selling price is worded on the Stock screen.
 *
 * Kept pure — no React Native — so the rules can be proved by the node test
 * runner rather than asserted by reading a component.
 *
 * The rules exist because a stock list is where a wrong price is believed:
 *
 * - **Nothing priced** → "No price set". Never `0`, which would read as free.
 * - **One price for every unit** → "Price 42 000 MRU".
 * - **Units resolve to different prices** (one phone has its own override) →
 *   "From 39 000 MRU". Showing either figure alone would be a lie about the
 *   other phones, and the maximum is on the unit list for whoever needs it.
 * - **Some units unpriced** → how many, instead of hiding them behind the price
 *   of the ones that are.
 */

export interface SummaryPrice {
  min: number;
  max: number;
  pricedCount: number;
  unpricedCount: number;
}

export type PriceWording =
  | { kind: 'unset' }
  | { kind: 'single'; amount: number; unpriced: number }
  | { kind: 'from'; amount: number; unpriced: number };

export function priceWording(price: SummaryPrice | null): PriceWording {
  if (!price) return { kind: 'unset' };
  if (price.min === price.max) {
    return { kind: 'single', amount: price.min, unpriced: price.unpricedCount };
  }
  return { kind: 'from', amount: price.min, unpriced: price.unpricedCount };
}

/**
 * A fact, not a forecast: nothing sellable is on the shelf. There is no "low"
 * state — reorder thresholds are not a first-release concept.
 */
export function stockStatus(available: number): 'out' | null {
  return available <= 0 ? 'out' : null;
}
