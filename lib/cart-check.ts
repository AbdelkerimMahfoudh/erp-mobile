/**
 * The basket as the server sees it just before confirming (D227). Prices on the Stock list and in the cart are what was known
 * when an item was added; this is what the sale would charge now. It reads and holds nothing: Charge decides again.
 */
export interface CheckedLine {
  index: number;
  ok: boolean;
  problem: 'unavailable' | 'not_enough' | 'price_required' | null;
  setPrice: number | null;
  charged: number | null;
  quantity: number;
  quantityAvailable: number | null;
  lineTotal: number;
}

export interface CartCheck {
  ok: boolean;
  lines: CheckedLine[];
  subtotal: number;
  discount: number;
  total: number;
  cartHash: string;
}

interface SellLine {
  kind: string;
  identifier?: string;
  productId?: string;
  quantity: number;
  price: number;
}

/** The same lines the sale sends, so the check, the approval and the sale all describe one cart. */
export const saleLines = (lines: readonly SellLine[]) =>
  lines.map((line) =>
    line.kind === 'unit'
      ? { identifier: line.identifier, price: line.price }
      : { productId: line.productId, quantity: line.quantity, price: line.price },
  );

const differs = (a: number | null, b: number | null) => a !== null && b !== null && Math.abs(a - b) > 0.005;

/** A line sold at something other than the shop's set price right now: worth saying, and never blocking. */
export const priceDiffers = (line: CheckedLine) => differs(line.setPrice, line.charged);

/**
 * One device at its set price goes straight to payment, so the counter keeps moving: the payment screen already shows its
 * one amount. Several items, a price that moved or a line that cannot be sold are always shown first.
 */
export const needsReview = (check: CartCheck) => !check.ok || check.lines.length > 1 || check.lines.some(priceDiffers);

/** A review belongs to one exact cart; any change means checking again. */
export const reviewKey = (lines: readonly SellLine[], discount: number) => JSON.stringify([saleLines(lines), discount]);
