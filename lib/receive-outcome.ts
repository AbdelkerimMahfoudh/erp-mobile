import { isValidImei } from './imei.ts';
import type { ProductSuggestion, ScanResult } from '../types/api';

/**
 * Receiving, as rules that can be proved without a screen.
 *
 * - what a delivery sends: every phone with its IMEI 1 and, when there is one,
 *   its IMEI 2;
 * - what the server's answer means: which lines were received, and which stay
 *   on the phone for correction — so correcting and finishing again can never
 *   send an accepted line a second time;
 * - whether an IMEI 2 may join the delivery.
 */

/**
 * A product this intake creates, sent with its stock in ONE request (D223).
 *
 * Nothing is created on the phone and nothing before the server commits: the
 * product, its units or counted stock and the cost exist together, or not at
 * all. No price and no cost on it — the buying cost is the line's.
 */
export interface NewProductDraft {
  brand: string;
  model: string;
  variant?: string;
  categoryId?: string;
  trackingType?: 'imei' | 'serial' | 'quantity';
  specifications?: Record<string, unknown>;
  barcode?: string;
}

/**
 * The confirmation card's view of a product that does not exist yet. It has no
 * id: the line carries the draft, and the server creates the product only when
 * it commits the stock.
 */
export function draftSuggestion(draft: NewProductDraft, kind: ScanResult['kind']): ProductSuggestion {
  const fallback = kind === 'imei' || kind === 'serial' ? kind : 'quantity';
  return {
    productId: '',
    brand: draft.brand,
    model: draft.model,
    variant: draft.variant ?? null,
    trackingType: draft.trackingType ?? fallback,
    keySpecifications: {},
    image: null,
    defaultCost: null,
    defaultPrice: null,
  };
}

/** The product a draft names, compared the way the server's unique key compares it. */
export function draftKey(d: Pick<NewProductDraft, 'brand' | 'model' | 'variant'>): string {
  return [d.brand, d.model, d.variant ?? ''].map((v) => v.trim().toLowerCase()).join('|');
}

export interface ReceiveLine {
  key: string;
  /** An existing product. Empty while the line creates its product (`newProduct`). */
  productId: string;
  newProduct?: NewProductDraft;
  trackingType: 'imei' | 'serial' | 'quantity';
  /**
   * The buying cost, or `null` when the person chose to continue without it
   * (D223, 0107): it is then sent as absent and the server records it as
   * UNKNOWN — never zero. Intake sets no selling price: that is the Sale's.
   */
  unitCost: number | null;
  quantity?: number;
  /** IMEI 1 or serial, one per physical unit. */
  identifiers?: string[];
  /** IMEI 2 by IMEI 1, for dual-SIM phones. Optional per phone. */
  secondaries?: Record<string, string>;
  recognitionKey?: { codeType: string; code: string } | null;
}

export interface RejectedLine {
  identifier: string;
  reason: string;
  secondary?: string;
}

export interface PurchaseOutcome {
  /** Null when every line was refused and nothing was written. */
  purchaseId: string | null;
  unitsCreated: number;
  stockLines: number;
  total: number;
  rejected?: RejectedLine[];
  /** What the purchase received, by name. Absent from servers before this field. */
  accepted?: { identifiers: string[]; stockProductIds: string[] };
  /** The products this purchase created (D223), so lines can be filed under their real ids. */
  createdProducts?: { productId: string; brand: string; model: string; variant: string | null }[];
  replayed?: boolean;
}

/** The `items` of `POST /purchases`. */
export function purchaseItems(lines: ReceiveLine[]) {
  return lines.map((line) => ({
    // Exactly one of the two: an existing product, or the one this intake creates.
    ...(line.newProduct ? { newProduct: line.newProduct } : { productId: line.productId }),
    // Absent, never 0, when it is not known (0107). No selling price is ever sent by intake.
    ...(line.unitCost !== null ? { unitCost: line.unitCost } : {}),
    ...(line.trackingType === 'quantity'
      ? { quantity: line.quantity }
      : {
          units: (line.identifiers ?? []).map((identifier) => {
            const secondary = line.secondaries?.[identifier];
            return secondary ? { identifier, imeiSecondary: secondary } : { identifier };
          }),
        }),
    ...(line.recognitionKey ? { recognitionKey: line.recognitionKey } : {}),
  }));
}

export interface Settlement<T extends ReceiveLine> {
  outcome: 'none' | 'all' | 'partial';
  /** Lines still to receive — only what the server did NOT take. */
  remaining: T[];
  /** Server-confirmed phones/serial units received. */
  receivedUnits: number;
  /** Pieces on quantity lines the server confirmed. */
  receivedPieces: number;
}

/**
 * Read the server's answer against what was sent.
 *
 * A line counts as received only when the server names it. An older server
 * that does not send `accepted` is read conservatively: every unit it did not
 * refuse was received, and quantity lines were received when a purchase exists.
 */
export function settle<T extends ReceiveLine>(sent: T[], res: PurchaseOutcome): Settlement<T> {
  if (res.purchaseId === null) {
    return { outcome: 'none', remaining: sent, receivedUnits: 0, receivedPieces: 0 };
  }

  /*
   * A line that created its product now has a real one. Filed under it here,
   * so a line left for correction is sent again against THAT product — sending
   * the draft a second time would be refused as a product that already exists.
   */
  const created = new Map((res.createdProducts ?? []).map((p) => [draftKey({ ...p, variant: p.variant ?? '' }), p.productId]));
  sent = sent.map((line) => {
    const id = line.newProduct ? created.get(draftKey(line.newProduct)) : undefined;
    if (!id) return line;
    const { newProduct: _created, ...rest } = line;
    return { ...rest, productId: id } as T;
  });

  const refused = new Set((res.rejected ?? []).map((r) => r.identifier));
  const acceptedIds = res.accepted
    ? new Set(res.accepted.identifiers)
    : new Set(sent.flatMap((l) => (l.identifiers ?? []).filter((id) => !refused.has(id))));
  const acceptedStock = res.accepted
    ? new Set(res.accepted.stockProductIds)
    : new Set(sent.filter((l) => l.trackingType === 'quantity').map((l) => l.productId));

  let receivedUnits = 0;
  let receivedPieces = 0;
  const remaining: T[] = [];

  for (const line of sent) {
    if (line.trackingType === 'quantity') {
      if (acceptedStock.has(line.productId)) receivedPieces += line.quantity ?? 0;
      else remaining.push(line);
      continue;
    }
    const ids = line.identifiers ?? [];
    const left = ids.filter((id) => !acceptedIds.has(id));
    receivedUnits += ids.length - left.length;
    if (left.length === 0) continue;
    const secondaries = line.secondaries
      ? Object.fromEntries(Object.entries(line.secondaries).filter(([id]) => left.includes(id)))
      : undefined;
    remaining.push({ ...line, identifiers: left, ...(secondaries ? { secondaries } : {}) });
  }

  return { outcome: remaining.length === 0 ? 'all' : 'partial', remaining, receivedUnits, receivedPieces };
}

/** Every IMEI 1, IMEI 2 and serial already in the delivery. */
export function codesInDelivery(lines: ReceiveLine[]): Set<string> {
  const codes = new Set<string>();
  for (const line of lines) {
    for (const id of line.identifiers ?? []) codes.add(id);
    for (const secondary of Object.values(line.secondaries ?? {})) codes.add(secondary);
  }
  return codes;
}

export type Imei2Problem = 'invalid' | 'same' | 'inDelivery' | null;

/** Whether an IMEI 2 may be attached to the phone carrying `primary`. Empty is fine. */
export function imei2Problem(primary: string, secondary: string, lines: ReceiveLine[]): Imei2Problem {
  const value = secondary.trim();
  if (!value) return null;
  if (!isValidImei(value)) return 'invalid';
  if (value === primary) return 'same';
  if (codesInDelivery(lines).has(value)) return 'inDelivery';
  return null;
}

/** Attach or replace the IMEI 2 of one phone. */
export function withSecondary<T extends ReceiveLine>(lines: T[], key: string, primary: string, secondary: string): T[] {
  return lines.map((line) =>
    line.key === key ? { ...line, secondaries: { ...(line.secondaries ?? {}), [primary]: secondary } } : line,
  );
}
