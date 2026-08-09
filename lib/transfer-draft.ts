import type { TransferStatus } from '../types/api';

/**
 * The rules of a transfer draft, kept pure so they can be tested without a
 * device, a camera or a server.
 *
 * Everything here is about what the user may add to a draft and when a retry is
 * the SAME request rather than a new one. Nothing here decides whether a unit is
 * really transferable — that is the server's answer, and asking it twice would
 * be two answers.
 */

export interface DraftItem {
  identifier: string;
  /** What the scanner or the server said this is. Shown before submitting. */
  product: string | null;
}

/** Why an identifier cannot join the draft. `null` means it can. */
export type RejectReason = 'duplicate' | 'blank' | 'quantity_product';

export interface AddResult {
  ok: boolean;
  reason: RejectReason | null;
  items: DraftItem[];
}

/**
 * Add a scanned or typed identifier to the draft.
 *
 * A duplicate is REPORTED, never silently collapsed: scanning the same phone
 * twice must not look like adding two, and it must not look like success
 * either. The user is standing in front of the stock and needs to know their
 * count is wrong before they send it.
 *
 * Quantity-tracked products are refused with their own reason so the screen can
 * explain that accessories are coming next, rather than dropping the scan on
 * the floor.
 */
export function addToDraft(
  items: DraftItem[],
  identifier: string,
  opts: { product?: string | null; trackingType?: string | null } = {},
): AddResult {
  const id = identifier.trim();
  if (!id) return { ok: false, reason: 'blank', items };

  if (opts.trackingType === 'quantity') {
    return { ok: false, reason: 'quantity_product', items };
  }
  if (items.some((i) => i.identifier === id)) {
    return { ok: false, reason: 'duplicate', items };
  }
  return { ok: true, reason: null, items: [...items, { identifier: id, product: opts.product ?? null }] };
}

export function removeFromDraft(items: DraftItem[], identifier: string): DraftItem[] {
  return items.filter((i) => i.identifier !== identifier);
}

/**
 * May this draft be sent?
 *
 * A destination is required and must be a different branch — the server refuses
 * a same-branch transfer with a 400, and letting the user reach that is a
 * wasted round trip on a shop's connection.
 */
export function canSubmitDraft(input: {
  items: DraftItem[];
  toBranchId: string | null;
  fromBranchId: string | null;
}): boolean {
  return (
    input.items.length > 0 &&
    Boolean(input.toBranchId) &&
    Boolean(input.fromBranchId) &&
    input.toBranchId !== input.fromBranchId
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
export function hasUnsavedDraft(items: DraftItem[], submitted: boolean): boolean {
  return items.length > 0 && !submitted;
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
