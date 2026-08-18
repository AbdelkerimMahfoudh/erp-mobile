import { mayQueue } from './policy.ts';

/**
 * The rules a queued submission obeys (Milestone J).
 *
 * Pure and dependency-free, so every one of them can be tested without a
 * device, a network or a clock. The engine that actually sends things is a thin
 * shell around this file.
 *
 * The rule that shapes the rest: **never silently change a payload to make it
 * pass, and never retry forever.** A submission the server refused on its
 * merits is not a network problem, and hiding it behind another attempt turns a
 * question somebody could have answered into a record that quietly never
 * existed.
 */

export type QueueState =
  | 'draft'
  | 'waiting_for_connection'
  | 'sending'
  | 'synced'
  | 'needs_attention'
  | 'cancelled';

/**
 * Deliberately no `failed`.
 *
 * A conflict is not a failure — it is a question for a person: the amount
 * changed, the permission went away, the branch moved. Calling it "failed"
 * invites an app to retry it, and invites an employee to ignore it.
 */
export const TERMINAL_STATES: readonly QueueState[] = ['synced', 'cancelled'] as const;

export interface QueueItem {
  id: string;
  kind: string;
  /** Reused on every attempt. A new one would create a second record. */
  clientUuid: string;
  /** Who and where. Checked again at replay, never trusted from the file. */
  companyId: string;
  branchId: string | null;
  userId: string;
  /** Bumped when the shape of `payload` changes between app versions. */
  payloadVersion: number;
  payload: unknown;
  state: QueueState;
  createdAt: number;
  lastAttemptAt: number | null;
  attempts: number;
  /** Plain words, safe to show on a list. Never the raw payload. */
  summary: string;
  lastError: ClassifiedError | null;
}

export type ErrorKind =
  | 'no_network'
  | 'api_unreachable'
  | 'timeout_uncertain'
  | 'session_expired'
  | 'permission_denied'
  | 'validation'
  | 'conflict'
  | 'server_error';

export interface ClassifiedError {
  kind: ErrorKind;
  message: string;
  status?: number;
}

/**
 * Which failures are worth another attempt.
 *
 * Only the ones where nothing was decided. A 4xx means the server read the
 * request and said no; sending it again unchanged produces the same no, and
 * every attempt costs the shop a little more trust in the queue.
 */
export function isTransient(kind: ErrorKind): boolean {
  return kind === 'no_network' || kind === 'api_unreachable' || kind === 'server_error' || kind === 'timeout_uncertain';
}

/**
 * Where an error leaves an item.
 *
 * A timeout is the interesting one: the request may well have succeeded, so it
 * goes back to waiting and is retried **with the same client UUID**. That is
 * precisely what idempotency is for — the retry either creates the record or
 * finds the one the lost response was about, and either way there is one.
 */
export function nextStateAfterError(e: ClassifiedError): QueueState {
  return isTransient(e.kind) ? 'waiting_for_connection' : 'needs_attention';
}

/** Attempts are bounded. Past this an item waits for a person, not a timer. */
export const MAX_ATTEMPTS = 8;

/**
 * Bounded exponential backoff with a ceiling, in milliseconds.
 *
 * Roughly 2s, 4s, 8s … capped at five minutes. The cap matters more than the
 * curve: a shop that reconnects after an hour should not then wait an hour more
 * because the delay kept doubling while nobody was watching.
 */
export function backoffMs(attempts: number): number {
  const base = 2000 * 2 ** Math.max(0, attempts - 1);
  return Math.min(base, 5 * 60_000);
}

export function shouldRetry(item: QueueItem, now: number): boolean {
  if (item.state !== 'waiting_for_connection') return false;
  if (item.attempts >= MAX_ATTEMPTS) return false;
  if (item.lastAttemptAt === null) return true;
  return now - item.lastAttemptAt >= backoffMs(item.attempts);
}

/**
 * Whether an item still belongs to the person and place now signed in.
 *
 * Checked at replay rather than only at enqueue, because everything about the
 * session can change while an item waits: a different user signs in on the
 * shared counter phone, somebody switches branch, a role is revoked. Replaying
 * under the wrong one of those would attribute a shop's money to the wrong
 * person, or send it to the wrong branch entirely.
 */
export function belongsToSession(
  item: QueueItem,
  session: { companyId: string; branchId: string | null; userId: string },
): boolean {
  return (
    item.companyId === session.companyId &&
    item.branchId === session.branchId &&
    item.userId === session.userId
  );
}

export type ReplayDecision =
  | { send: true }
  | { send: false; reason: 'not_queueable' | 'wrong_session' | 'not_waiting' | 'backing_off' | 'exhausted' };

/**
 * The single gate every item passes through before anything is sent.
 *
 * One function, so no caller can accidentally check three of the four rules.
 */
export function decideReplay(
  item: QueueItem,
  session: { companyId: string; branchId: string | null; userId: string },
  now: number,
): ReplayDecision {
  // Re-checked even though enqueue checked it: a build that reclassified an
  // operation must not replay what an older build was allowed to store.
  if (!mayQueue(item.kind)) return { send: false, reason: 'not_queueable' };
  if (!belongsToSession(item, session)) return { send: false, reason: 'wrong_session' };
  if (item.state !== 'waiting_for_connection') return { send: false, reason: 'not_waiting' };
  if (item.attempts >= MAX_ATTEMPTS) return { send: false, reason: 'exhausted' };
  if (!shouldRetry(item, now)) return { send: false, reason: 'backing_off' };
  return { send: true };
}

/**
 * Order of sending.
 *
 * FIFO by creation within a dependency group, so two payment reports against
 * the same loan reach the server in the order the shop made them. Different
 * groups are independent and one stuck item must never block them — a queue
 * where one bad expense freezes every notification is a queue people turn off.
 */
export function dependencyGroup(item: QueueItem): string {
  return `${item.kind}:${groupSubject(item)}`;
}

function groupSubject(item: QueueItem): string {
  const p = item.payload as Record<string, unknown> | null;
  const subject = p && typeof p === 'object' ? (p.loanId ?? p.consignmentId ?? p.id) : null;
  return typeof subject === 'string' ? subject : 'none';
}

export function orderForReplay(items: readonly QueueItem[]): QueueItem[] {
  return [...items].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/**
 * The next item to send per group, oldest first.
 *
 * Returns at most one per group: a later report must not overtake an earlier
 * one against the same subject, and must not be sent while the earlier one is
 * unresolved.
 */
export function nextSendable(
  items: readonly QueueItem[],
  session: { companyId: string; branchId: string | null; userId: string },
  now: number,
): QueueItem[] {
  const out: QueueItem[] = [];
  const blocked = new Set<string>();
  for (const item of orderForReplay(items)) {
    const group = dependencyGroup(item);
    if (blocked.has(group)) continue;
    // Anything unresolved in this group holds the rest of the group back,
    // whether it is mid-flight or waiting for somebody to look at it.
    if (item.state === 'sending' || item.state === 'needs_attention') {
      blocked.add(group);
      continue;
    }
    if (decideReplay(item, session, now).send) {
      out.push(item);
      blocked.add(group);
    }
  }
  return out;
}

/** Cancelling is only honest while nothing has been sent. */
export function mayCancel(item: QueueItem): boolean {
  return item.state === 'draft' || item.state === 'waiting_for_connection' || item.state === 'needs_attention';
}

/**
 * What the shop is told, per state.
 *
 * Never green until the server has agreed. `synced` is the only state that has
 * earned a success colour, and `needs_attention` is deliberately not red-as-in-
 * broken: something needs a decision, not a repair.
 */
export function toneFor(state: QueueState): 'neutral' | 'info' | 'warning' | 'success' {
  switch (state) {
    case 'synced':
      return 'success';
    case 'needs_attention':
      return 'warning';
    case 'sending':
    case 'waiting_for_connection':
      return 'info';
    default:
      return 'neutral';
  }
}
