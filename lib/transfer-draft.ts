import type { TransferStatus } from '../types/api';

/**
 * The rules of a transfer draft, kept pure so they can be tested without a
 * device, a camera or a server.
 *
 * Everything here is about what the user may add to a draft and when a retry is
 * the SAME request rather than a new one. Nothing here decides whether stock is
 * really transferable — that is the server's answer, and asking it twice would
 * be two answers. What it does do is stop the app sending a request it can
 * already see is wrong, because a refusal that arrives after a round trip is a
 * worse experience than one that never needed to happen.
 */

/** One specific device, named by the number printed on it. */
export interface DraftUnitLine {
  kind: 'unit';
  identifier: string;
  /** What the scanner or the server said this is. Shown before submitting. */
  product: string | null;
}

/** Some of what this branch holds of one accessory. */
export interface DraftStockLine {
  kind: 'stock';
  productId: string;
  product: string;
  variant: string | null;
  barcode: string | null;
  /** How many the user has chosen to send. */
  quantity: number;
  /** Owned here. Never labelled "available" — reservations are still owned. */
  physicalQuantity: number;
  /** Promised to another open transfer. */
  reservedQuantity: number;
  /** The ceiling for this line: physical minus reserved, as the server saw it. */
  availableQuantity: number;
}

export type DraftLine = DraftUnitLine | DraftStockLine;

/** Why something cannot join the draft. `null` means it can. */
export type RejectReason = 'duplicate' | 'blank' | 'none_available' | 'over_available';

export interface AddResult {
  ok: boolean;
  reason: RejectReason | null;
  lines: DraftLine[];
  /** Set when an existing quantity line grew instead of a new one appearing. */
  merged?: boolean;
}

export const isUnitLine = (l: DraftLine): l is DraftUnitLine => l.kind === 'unit';
export const isStockLine = (l: DraftLine): l is DraftStockLine => l.kind === 'stock';

/**
 * Add a scanned or typed serialized identifier.
 *
 * A duplicate is REPORTED, never silently collapsed: scanning the same phone
 * twice must not look like adding two, and it must not look like success
 * either. One IMEI is one object — there is nothing to merge.
 */
export function addUnitToDraft(
  lines: DraftLine[],
  identifier: string,
  opts: { product?: string | null } = {},
): AddResult {
  const id = identifier.trim();
  if (!id) return { ok: false, reason: 'blank', lines };
  if (lines.some((l) => isUnitLine(l) && l.identifier === id)) {
    return { ok: false, reason: 'duplicate', lines };
  }
  return {
    ok: true,
    reason: null,
    lines: [...lines, { kind: 'unit', identifier: id, product: opts.product ?? null }],
  };
}

export interface StockCandidate {
  productId: string;
  product: string;
  variant?: string | null;
  barcode?: string | null;
  physicalQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
}

/**
 * Add an accessory, or add MORE of one already in the draft.
 *
 * Quantity is the opposite case to a serialized line: scanning the same box of
 * cables twice means two of them, so the right answer is to merge and count up.
 * Two separate lines for one product would also be rejected by the server —
 * the database refuses a duplicate `(transfer, product)` — so merging is both
 * kinder and the only shape that can succeed.
 *
 * The ceiling is what the SERVER said was available. It is a courtesy, not the
 * rule: stock can be claimed by someone else between this screen and the
 * request, and the server decides for real.
 */
export function addStockToDraft(
  lines: DraftLine[],
  candidate: StockCandidate,
  amount = 1,
): AddResult {
  if (candidate.availableQuantity <= 0) {
    return { ok: false, reason: 'none_available', lines };
  }
  const wanted = Math.max(1, Math.trunc(amount));
  const existing = lines.find(
    (l): l is DraftStockLine => isStockLine(l) && l.productId === candidate.productId,
  );

  if (existing) {
    const combined = existing.quantity + wanted;
    if (combined > existing.availableQuantity) {
      return { ok: false, reason: 'over_available', lines };
    }
    return {
      ok: true,
      reason: null,
      merged: true,
      lines: lines.map((l) =>
        isStockLine(l) && l.productId === candidate.productId ? { ...l, quantity: combined } : l,
      ),
    };
  }

  if (wanted > candidate.availableQuantity) {
    return { ok: false, reason: 'over_available', lines };
  }
  return {
    ok: true,
    reason: null,
    lines: [
      ...lines,
      {
        kind: 'stock',
        productId: candidate.productId,
        product: candidate.product,
        variant: candidate.variant ?? null,
        barcode: candidate.barcode ?? null,
        quantity: wanted,
        physicalQuantity: candidate.physicalQuantity,
        reservedQuantity: candidate.reservedQuantity,
        availableQuantity: candidate.availableQuantity,
      },
    ],
  };
}

/**
 * Set a quantity line to an exact number — the stepper and the number field.
 *
 * Clamped rather than refused, because both controls are things a thumb slides
 * past. Zero removes the line, which is what "take it down to none" means.
 */
export function setLineQuantity(
  lines: DraftLine[],
  productId: string,
  quantity: number,
): DraftLine[] {
  const wanted = Math.trunc(Number.isFinite(quantity) ? quantity : 0);
  if (wanted <= 0) return lines.filter((l) => !(isStockLine(l) && l.productId === productId));
  return lines.map((l) =>
    isStockLine(l) && l.productId === productId
      ? { ...l, quantity: Math.min(wanted, l.availableQuantity) }
      : l,
  );
}

export function removeUnitFromDraft(lines: DraftLine[], identifier: string): DraftLine[] {
  return lines.filter((l) => !(isUnitLine(l) && l.identifier === identifier));
}

export function removeStockFromDraft(lines: DraftLine[], productId: string): DraftLine[] {
  return lines.filter((l) => !(isStockLine(l) && l.productId === productId));
}

/** What the draft is about to move, in the words the summary uses. */
export interface DraftCounts {
  unitCount: number;
  quantityLineCount: number;
  totalQuantity: number;
}

export function countDraft(lines: DraftLine[]): DraftCounts {
  let unitCount = 0;
  let quantityLineCount = 0;
  let totalQuantity = 0;
  for (const l of lines) {
    if (isUnitLine(l)) {
      unitCount += 1;
      totalQuantity += 1;
    } else {
      quantityLineCount += 1;
      totalQuantity += l.quantity;
    }
  }
  return { unitCount, quantityLineCount, totalQuantity };
}

/**
 * May this draft be sent?
 *
 * A destination is required and must be a different branch — the server refuses
 * a same-branch transfer with a 400, and letting the user reach that is a
 * wasted round trip on a shop's connection. A line asking for more than the
 * branch has blocks it too, for the same reason.
 */
export function canSubmitDraft(input: {
  lines: DraftLine[];
  toBranchId: string | null;
  fromBranchId: string | null;
}): boolean {
  if (input.lines.length === 0) return false;
  if (!input.toBranchId || !input.fromBranchId) return false;
  if (input.toBranchId === input.fromBranchId) return false;
  return input.lines.every((l) =>
    isUnitLine(l) ? true : l.quantity > 0 && l.quantity <= l.availableQuantity,
  );
}

/** The request body, in the discriminated shape the server now takes. */
export function draftToBody(lines: DraftLine[]) {
  return lines.map((l) =>
    isUnitLine(l)
      ? { kind: 'unit' as const, identifier: l.identifier }
      : { kind: 'stock' as const, productId: l.productId, quantity: l.quantity },
  );
}

/**
 * When the request id may be replaced.
 *
 * One id per ATTEMPT, reused for every retry of that attempt — that is what
 * makes a timeout safe to retry: the server recognises the replay and returns
 * the original transfer instead of moving stock twice. A new id is only correct
 * once the previous attempt has definitively finished, or when the user
 * deliberately starts a fresh draft.
 *
 * Generating one per submit would defeat idempotency entirely, which is why
 * this is a function and not an inline `uuid()` at the call site.
 */
export function shouldMintNewRequestId(phase: 'draft_started' | 'submitting' | 'retry' | 'completed'): boolean {
  return phase === 'draft_started' || phase === 'completed';
}

/**
 * Does leaving now lose work?
 *
 * A half-scanned transfer is several minutes of somebody walking around a shop
 * with a phone. Back must ask first.
 */
export function hasUnsavedDraft(lines: DraftLine[], submitted: boolean): boolean {
  return lines.length > 0 && !submitted;
}

/**
 * What the submit button should promise.
 *
 * A manager's request is created already approved; an employee's waits. Saying
 * so on the button — rather than discovering it afterwards — is the difference
 * between a workflow someone understands and one that surprises them.
 */
export function submitIntent(canApproveHere: boolean): 'creates_approved' | 'awaits_approval' {
  return canApproveHere ? 'creates_approved' : 'awaits_approval';
}

/** Statuses that are finished: history, never work. */
const FINISHED: TransferStatus[] = ['received', 'rejected', 'cancelled'];

export function isFinishedStatus(status: TransferStatus): boolean {
  return FINISHED.includes(status);
}
