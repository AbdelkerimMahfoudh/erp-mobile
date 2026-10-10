import { AGENT_REFUSALS, type AgentRefusal, type RefusalAction } from '../agent-rules.ts';
import { AGENT_EXCHANGE_KIND, isExchangePayload, type ExchangeConfirmation } from './agent-exchange.ts';
import { mayQueue } from './policy.ts';
import { backoffMs, belongsToSession, MAX_ATTEMPTS, type ClassifiedError, type QueueItem, type QueueState } from './queue-rules.ts';

/**
 * A refused offline exchange has a clear outcome (D161).
 *
 * The queue's rules for the one money record it holds — an exchange at the
 * agent counter — on top of Milestone J's. Six states, each said in words:
 *
 * | Stage               | Queue state              | What it means                                                         |
 * |---------------------|--------------------------|-----------------------------------------------------------------------|
 * | `pending`           | `waiting_for_connection` | on this phone; nothing recorded yet; sent when the connection allows  |
 * | `synchronizing`     | `sending`                | on its way                                                            |
 * | `confirmed`         | `synced`                 | the server's record: its time, business day, recorder and commission  |
 * | `uncertain`         | `uncertain`              | an answer was lost: the status lookup decides, never a blind resend   |
 * | `rejected_resubmit` | `rejected_resubmit`      | not recorded; the person fixes it (send again, review, edit)          |
 * | `rejected_reenter`  | `rejected_reenter`       | not recorded here; someone else enters it (a Manager, the branch)     |
 *
 * Nothing rejected is retried on its own, and nothing rejected is ever shown
 * as waiting. Pure, so every row of the refusal table is tested under node:
 *   node lib/offline/exchange-rules.test.ts
 */

// ── Classification ──────────────────────────────────────────────────────────

/**
 * The refusal an error names, in the table's terms: the server's code when the
 * counter knows it; otherwise what the status says — a 403 is a permission (or
 * the business's access), a 409/404/410 a conflict, any other 4xx a field.
 */
export function refusalCodeOf(e: ClassifiedError): string {
  if (e.code && AGENT_REFUSALS[e.code]) return e.code;
  if (e.kind === 'entitlement_blocked') return 'ENTITLEMENT_WRITE_BLOCKED';
  if (e.kind === 'permission_denied') return 'permission_denied';
  if (e.kind === 'conflict') return 'conflict';
  return 'validation';
}

/** The refusal's words and what fixes it. */
export function refusalOf(e: ClassifiedError | null | undefined): AgentRefusal | null {
  return e ? AGENT_REFUSALS[refusalCodeOf(e)] : null;
}

/**
 * Where a failed attempt leaves an exchange (the D161 table).
 *
 * `mayBeRecorded` — whether an earlier attempt may already be recorded (the
 * item was `uncertain`): a refusal raised in front of the ledger proves nothing
 * about it, so the lookup decides first.
 */
export function exchangeStateAfterError(e: ClassifiedError, mayBeRecorded: boolean): QueueState {
  // A lost answer — a timeout, a 5xx, an answer nobody could read: it may be recorded. The lookup decides.
  if (e.kind === 'timeout_uncertain' || e.kind === 'server_error') return 'uncertain';
  // Nothing was decided: a request that never left, a session to renew (sent after sign-in), a server asking to slow
  // down. It stays where it was — waiting, or uncertain.
  if (e.kind === 'no_network' || e.kind === 'api_unreachable' || e.kind === 'session_expired' || e.status === 429) {
    return mayBeRecorded ? 'uncertain' : 'waiting_for_connection';
  }
  const refusal = AGENT_REFUSALS[refusalCodeOf(e)];
  if (refusal.beforeKey && mayBeRecorded) return 'uncertain';
  return refusal.action === 'reenter' ? 'rejected_reenter' : 'rejected_resubmit';
}

/**
 * Past the bounded attempts, an exchange that would wait again is `uncertain`:
 * the lookup — a read, never a resend — says whether it was recorded, and
 * "Check again" is there for a person.
 */
export function exchangeStateWhenExhausted(next: QueueState): QueueState {
  return next === 'waiting_for_connection' ? 'uncertain' : next;
}

export type ResubmitAction = Extract<RefusalAction, 'send_again' | 'review_and_send' | 'edit_and_send'>;

/** What fixes a `rejected_resubmit` exchange, by its refusal; null for anything else. */
export function resubmitAction(item: Pick<QueueItem, 'state' | 'lastError'>): ResubmitAction | null {
  if (item.state !== 'rejected_resubmit') return null;
  const action = refusalOf(item.lastError)?.action;
  return action === 'send_again' || action === 'review_and_send' || action === 'edit_and_send' ? action : null;
}

/**
 * Whether a person may send an item again, unchanged, under its own key: any
 * other kind waiting for a person (Milestone J); an exchange only when nothing
 * about it is wrong — the business's access, a closed store, a provider
 * switched off — never one whose terms or fields must change first.
 */
export function mayResend(item: QueueItem): boolean {
  if (item.kind === AGENT_EXCHANGE_KIND) return resubmitAction(item) === 'send_again';
  return item.state === 'needs_attention';
}

// ── An older build's file ────────────────────────────────────────────────────

/**
 * An exchange written by an earlier build, in this build's states — without
 * bumping the file's version, which would quarantine every waiting exchange:
 * one that may have been recorded (its `mayBeRecorded` flag), or that was
 * mid-send when the app stopped, is `uncertain`; one that needed a person is
 * `rejected_*` by its refusal. Every other kind is untouched.
 */
export function normaliseExchange(item: QueueItem): QueueItem {
  if (item.kind !== AGENT_EXCHANGE_KIND) return item;
  const { mayBeRecorded, ...rest } = item;
  if (rest.state === 'synced' || rest.state === 'cancelled') return mayBeRecorded === undefined ? item : rest;
  if (mayBeRecorded || rest.state === 'sending') return { ...rest, state: 'uncertain' };
  if (rest.state === 'needs_attention') {
    if (!rest.lastError) return { ...rest, state: 'uncertain' };
    const state = exchangeStateAfterError(rest.lastError, false);
    // Waiting again (an older build stopped asking the network after its attempts): a fresh count of attempts.
    return state === 'waiting_for_connection' ? { ...rest, state, attempts: 0, lastAttemptAt: null } : { ...rest, state };
  }
  return mayBeRecorded === undefined ? item : rest;
}

/** A whole file's items, normalised; `changed` when anything moved, so the file is written back once. */
export function normaliseQueue(items: readonly QueueItem[]): { items: QueueItem[]; changed: boolean } {
  let changed = false;
  const out = items.map((i) => {
    const n = normaliseExchange(i);
    if (n !== i) changed = true;
    return n;
  });
  return { items: out, changed };
}

// ── The status lookup ────────────────────────────────────────────────────────

/** `GET agent/transactions/client/:clientUuid` — company-scoped, readable in every subscription state. */
export function exchangeStatusPath(clientUuid: string): string {
  return `/agent/transactions/client/${encodeURIComponent(clientUuid)}`;
}

/** The server's masked view of the exchange recorded under a key: never the full number. */
export interface ServerExchange {
  id: string;
  branchId: string | null;
  status: string;
  direction: string;
  providerId: string;
  providerLabel: string;
  amount: number;
  commission: number;
  customerNumberMasked: string;
  businessDate: string;
  recordedAt: string;
  recordedByName: string;
  configVersionId: string | null;
  deviceRecordedAt: string | null;
}

export type LookupAnswer = { recorded: false } | { recorded: true; transaction: ServerExchange };

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** The lookup's answer, or null when it is not one (an older server, a proxy page): then nothing is decided. */
export function lookupAnswerOf(response: unknown): LookupAnswer | null {
  const r = response as { recorded?: unknown; transaction?: Record<string, unknown> | null } | null;
  if (!r || typeof r !== 'object') return null;
  if (r.recorded === false) return { recorded: false };
  if (r.recorded !== true || !r.transaction || typeof r.transaction !== 'object') return null;
  const t = r.transaction;
  const commission = t.commission as unknown;
  const recordedBy = t.recordedBy as { name?: unknown } | null | undefined;
  if (!str(t.id) || !str(t.recordedAt) || !str(t.businessDate) || !str(t.providerId) || !str(t.direction) || typeof t.amount !== 'number') return null;
  return {
    recorded: true,
    transaction: {
      id: t.id as string,
      branchId: str(t.branchId),
      status: str(t.status) ?? 'completed',
      direction: t.direction as string,
      providerId: t.providerId as string,
      providerLabel: str(t.providerLabel) ?? '',
      amount: t.amount,
      commission: typeof commission === 'number' ? commission : typeof (commission as { amount?: unknown } | null)?.amount === 'number' ? (commission as { amount: number }).amount : 0,
      customerNumberMasked: str(t.customerNumberMasked) ?? '',
      businessDate: t.businessDate as string,
      recordedAt: t.recordedAt as string,
      recordedByName: str(t.recordedByName) ?? str(recordedBy?.name) ?? '',
      configVersionId: str(t.configVersionId) ?? str((commission as { configVersionId?: unknown } | null)?.configVersionId),
      deviceRecordedAt: str(t.deviceRecordedAt),
    },
  };
}

/** The last four digits of a number or of its masked form (`•••• 1234`); null when there are not four. */
export function lastFour(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

/**
 * Whether the record under the key is this exchange: the same branch, provider,
 * direction and amount, the same configuration version when the exchange has
 * one, and the same last four digits as the number sealed on this phone (when
 * it is still there to compare).
 */
export function sameExchange(item: QueueItem, tx: ServerExchange, localNumber: string | null): boolean {
  const p = item.payload;
  if (!isExchangePayload(p)) return false;
  if (tx.branchId !== null && item.branchId !== null && tx.branchId !== item.branchId) return false;
  if (tx.providerId !== p.providerId || tx.direction !== p.direction) return false;
  if (Math.abs(tx.amount - p.amount) >= 0.005) return false;
  if (p.configVersionId && tx.configVersionId && tx.configVersionId !== p.configVersionId) return false;
  const mine = lastFour(localNumber);
  const theirs = lastFour(tx.customerNumberMasked);
  return !(mine && theirs && mine !== theirs);
}

/** The server's record, reduced to what the counter shows once confirmed. */
export function confirmationFrom(tx: ServerExchange): ExchangeConfirmation {
  return { id: tx.id, recordedAt: tx.recordedAt, businessDate: tx.businessDate, recordedByName: tx.recordedByName, commission: tx.commission };
}

/** Another exchange recorded under this key, as the person is shown it: masked, never the full number. */
export function serverRecordOf(tx: ServerExchange): Record<string, string | number> {
  return {
    id: tx.id,
    direction: tx.direction,
    amount: tx.amount,
    providerLabel: tx.providerLabel,
    numberMasked: tx.customerNumberMasked,
    recordedAt: tx.recordedAt,
    businessDate: tx.businessDate,
    recordedByName: tx.recordedByName,
  };
}

export const CONFLICT_ERROR: ClassifiedError = {
  kind: 'conflict',
  status: 409,
  code: 'idempotency_conflict',
  message: 'Another exchange is recorded under this exchange’s key.',
};

export type Resolution =
  | { kind: 'confirmed'; changes: Partial<QueueItem> }
  | { kind: 'different'; changes: Partial<QueueItem> }
  | { kind: 'not_recorded'; changes: Partial<QueueItem> };

/**
 * What the lookup decides about an uncertain exchange:
 *  - recorded, and it is this exchange → `confirmed`, with the server's time,
 *    business day, recorder and commission (its number then leaves the phone);
 *  - recorded, and it is another → `rejected_reenter` (`idempotency_conflict`),
 *    with the server's masked record to show;
 *  - not recorded → `pending` again, sent under the SAME key — at once. A
 *    person's "Check again" also starts a fresh count of attempts.
 */
export function resolveLookup(item: QueueItem, answer: LookupAnswer, localNumber: string | null, options: { manual: boolean }): Resolution {
  if (!answer.recorded) {
    return {
      kind: 'not_recorded',
      changes: { state: 'waiting_for_connection', lastAttemptAt: null, serverRecord: null, ...(options.manual ? { attempts: 0 } : {}) },
    };
  }
  if (sameExchange(item, answer.transaction, localNumber)) {
    return { kind: 'confirmed', changes: { state: 'synced', lastError: null, serverRecord: null, result: { ...confirmationFrom(answer.transaction) } } };
  }
  return { kind: 'different', changes: { state: 'rejected_reenter', lastError: CONFLICT_ERROR, serverRecord: serverRecordOf(answer.transaction) } };
}

/**
 * Whether an uncertain exchange's lookup is due in an automatic pass: its own
 * person and place, within the bounded attempts, after the same backoff a
 * resend would wait. Past the bound only a person's "Check again" asks.
 */
export function lookupDue(item: QueueItem, session: { companyId: string; branchId: string | null; userId: string }, now: number): boolean {
  if (item.kind !== AGENT_EXCHANGE_KIND || !mayQueue(item.kind) || item.state !== 'uncertain') return false;
  if (!belongsToSession(item, session) || item.attempts >= MAX_ATTEMPTS) return false;
  return item.lastAttemptAt === null || now - item.lastAttemptAt >= backoffMs(item.attempts);
}

export function lookupsDue(items: readonly QueueItem[], session: { companyId: string; branchId: string | null; userId: string }, now: number): QueueItem[] {
  return items.filter((i) => lookupDue(i, session, now)).sort((a, b) => a.createdAt - b.createdAt);
}

/** Whether "Check again" may ask about this exchange now: uncertain (or an older build's attention item), its own session. */
export function mayCheckAgain(item: QueueItem, session: { companyId: string; branchId: string | null; userId: string } | null): boolean {
  return (
    item.kind === AGENT_EXCHANGE_KIND &&
    session !== null &&
    belongsToSession(item, session) &&
    (item.state === 'uncertain' || item.state === 'needs_attention')
  );
}
