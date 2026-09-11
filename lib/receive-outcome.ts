import { isValidImei } from './imei.ts';

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

export interface ReceiveLine {
  key: string;
  productId: string;
  trackingType: 'imei' | 'serial' | 'quantity';
  unitCost: number;
  price?: number;
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
  replayed?: boolean;
}

/** The `items` of `POST /purchases`. */
export function purchaseItems(lines: ReceiveLine[]) {
  return lines.map((line) => ({
    productId: line.productId,
    unitCost: line.unitCost,
    ...(line.price !== undefined ? { price: line.price } : {}),
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
