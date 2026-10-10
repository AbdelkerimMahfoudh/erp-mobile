import { commissionOf, exchangeLegs, type AgentDirection, type AgentProvider, type Leg } from '../agent-rules.ts';
import type { QueueItem } from './queue-rules.ts';

/**
 * The one queueable money record: an exchange at the agent counter (D155).
 *
 * Milestone J queued only reports that settle no money. An exchange is queued
 * anyway because it is the counter's report of something that already happened
 * at the counter — the cash changed hands — and the server still decides
 * everything about it: the commission, the legs, the business day, who
 * recorded it. What this file adds to the queue's rules:
 *
 * - **the customer's number never reaches the queue file.** It is personal
 *   data, and the queue is a plain file in the app's documents. It is kept in
 *   SecureStore under the exchange's own key (the draft's UUID), sealed with
 *   the company, branch and person it belongs to, and joined to the payload
 *   only at the moment of sending. Another account signed in on the same phone
 *   opens neither the file nor the number;
 * - **the summary says what happened, never whose number it was;**
 * - **one exchange never holds another back:** each is its own subject, so an
 *   exchange that needs a person does not stop the next customer's;
 * - **the figures that include a queued exchange are provisional:** the
 *   server's position plus the legs the exchange will post.
 *
 * Pure: the SecureStore and file reads happen in `lib/agent-queue.ts`.
 */

export const AGENT_EXCHANGE_KIND = 'agent.exchange.record';

/** What the queue file holds of an exchange: everything the server is sent, except the customer's number. */
export interface ExchangePayload {
  providerId: string;
  direction: AgentDirection;
  amount: number;
  providerReference?: string;
  /** The configuration version the person saw on the review; a newer one in force is refused as stale. */
  configVersionId: string;
  /** The phone's clock at Confirm — a claim the server keeps beside its own instant, and part of the request's identity. */
  deviceRecordedAt: string;
}

/** The exchange's identity outside the queue file: who may send it, from where, and the number itself. */
export interface SealedNumber {
  companyId: string;
  branchId: string | null;
  userId: string;
  customerNumber: string;
}

export interface Scope {
  companyId: string;
  branchId: string | null;
  userId: string;
}

/** One segment of a SecureStore key: letters, digits and `-` only (SecureStore also takes `.` and `_`, the separators). */
function keySegment(value: string | null): string {
  return (value ?? 'none').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40);
}

/**
 * The SecureStore key of an exchange's number (D161): the company, the branch,
 * the person and the exchange's own UUID — so one account's key can never be
 * read, overwritten or deleted by another's on a shared counter phone. Anything
 * outside the characters SecureStore takes is dropped rather than trusted.
 */
export function numberKey(scope: Scope, clientUuid: string): string {
  return `agent.exchange.number.${keySegment(scope.companyId)}.${keySegment(scope.branchId)}.${keySegment(scope.userId)}.${keySegment(clientUuid)}`;
}

/**
 * The key an earlier build kept the number under: the exchange's UUID alone.
 * Never written again — read once, moved under {@link numberKey} for the scope
 * it was sealed in, and deleted.
 */
export function legacyNumberKey(clientUuid: string): string {
  return `agent.exchange.number.${keySegment(clientUuid)}`;
}

/** The number, sealed with the scope it was typed in — well under SecureStore's 2 KB per value. */
export function sealNumber(scope: Scope, customerNumber: string): string {
  const sealed: SealedNumber = { companyId: scope.companyId, branchId: scope.branchId, userId: scope.userId, customerNumber };
  return JSON.stringify(sealed);
}

/**
 * The number back, only for the scope it was sealed in. Anything unreadable,
 * or sealed for another company, branch or person, is no number at all — the
 * exchange then waits for a person rather than going out with a wrong one.
 */
export function openNumber(stored: string | null, scope: Scope): string | null {
  if (!stored) return null;
  try {
    const v = JSON.parse(stored) as Partial<SealedNumber>;
    if (v.companyId !== scope.companyId || v.branchId !== scope.branchId || v.userId !== scope.userId) return null;
    return typeof v.customerNumber === 'string' && v.customerNumber.length > 0 ? v.customerNumber : null;
  } catch {
    return null;
  }
}

/** Personal data a queued payload or a draft must never carry, in any spelling. */
const PERSONAL_KEYS = ['customernumber'];

/** Recursive, like the credential check: a number two objects deep is still a number. */
export function containsPersonalNumber(value: unknown, depth = 0): boolean {
  if (depth > 6 || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((v) => containsPersonalNumber(v, depth + 1));
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (PERSONAL_KEYS.includes(key.toLowerCase().replace(/[^a-z0-9]/g, ''))) return true;
    if (containsPersonalNumber(nested, depth + 1)) return true;
  }
  return false;
}

/** The request body at the moment of sending: the payload, the number joined in, and nothing else. */
export function exchangeBody(payload: ExchangePayload, customerNumber: string): ExchangePayload & { customerNumber: string } {
  return { ...payload, customerNumber };
}

export function isExchangePayload(v: unknown): v is ExchangePayload {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.providerId === 'string' &&
    (p.direction === 'cash_in_credit_out' || p.direction === 'cash_out_credit_in') &&
    typeof p.amount === 'number' &&
    p.amount > 0 &&
    typeof p.configVersionId === 'string' &&
    typeof p.deviceRecordedAt === 'string' &&
    (p.providerReference === undefined || typeof p.providerReference === 'string') &&
    !containsPersonalNumber(p)
  );
}

/**
 * The queue's line for an exchange: its direction, amount and provider, in the
 * person's words. It is built from those three alone — the number is not even
 * an argument — because the summary is shown on lists and in the Sync centre.
 */
export function exchangeSummary(words: { direction: string; amount: string; provider: string }): string {
  return `${words.direction} · ${words.amount} · ${words.provider}`;
}

/** What a confirmed exchange is remembered by on the phone: the server's record, never the number. */
export interface ExchangeConfirmation {
  id: string;
  recordedAt: string;
  businessDate: string;
  recordedByName: string;
  commission: number;
}

/** The server's answer to `POST agent/transactions`, reduced to what the counter shows; null when it is not one. */
export function confirmationOf(response: unknown): ExchangeConfirmation | null {
  const r = response as {
    id?: unknown;
    recordedAt?: unknown;
    businessDate?: unknown;
    recordedBy?: { name?: unknown } | null;
    commission?: { amount?: unknown } | null;
  } | null;
  if (!r || typeof r.id !== 'string' || typeof r.recordedAt !== 'string' || typeof r.businessDate !== 'string') return null;
  return {
    id: r.id,
    recordedAt: r.recordedAt,
    businessDate: r.businessDate,
    recordedByName: typeof r.recordedBy?.name === 'string' ? r.recordedBy.name : '',
    commission: typeof r.commission?.amount === 'number' ? r.commission.amount : 0,
  };
}

/** States in which an exchange has not reached the server: it is shown as Pending synchronization, never as recorded. */
const UNSENT: readonly QueueItem['state'][] = ['draft', 'waiting_for_connection', 'sending', 'needs_attention'];

/** The branch's exchanges this phone still holds, oldest first: the queue's own scope is the branch. */
export function pendingExchanges(items: readonly QueueItem[], branchId: string | null): QueueItem[] {
  return items
    .filter((i) => i.kind === AGENT_EXCHANGE_KIND && i.branchId === branchId && UNSENT.includes(i.state))
    .sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * The legs a queued exchange will post, for the provisional figures. The
 * provider's configuration is the one the exchange was confirmed with; when the
 * phone no longer holds that version, only the principal is counted — the
 * commission of a rate nobody can see is not guessed (the server will refuse
 * the exchange as stale anyway).
 */
export function queuedLegs(payload: ExchangePayload, providers: readonly AgentProvider[]): Leg[] {
  const config = providers.find((p) => p.id === payload.providerId)?.config;
  if (config && config.id === payload.configVersionId && config.commissionDestination && config.principalFeeMode) {
    const rate = payload.direction === 'cash_in_credit_out' ? config.rateInBp : config.rateOutBp;
    if (rate !== null) {
      return exchangeLegs({ ...payload, commission: commissionOf(payload.amount, rate), commissionDestination: config.commissionDestination, principalFeeMode: config.principalFeeMode });
    }
  }
  const cashIn = payload.direction === 'cash_in_credit_out';
  return [
    { account: 'cash', providerId: null, direction: cashIn ? 'inflow' : 'outflow', amount: payload.amount, kind: 'principal' },
    { account: 'provider', providerId: payload.providerId, direction: cashIn ? 'outflow' : 'inflow', amount: payload.amount, kind: 'principal' },
  ];
}

/** The account a leg moves, as the positions name it: `cash`, `provider:<id>`, `commission_held:<id>`. */
export function legKey(leg: Pick<Leg, 'account' | 'providerId'>): string {
  return leg.account === 'cash' ? 'cash' : `${leg.account}:${leg.providerId}`;
}

/**
 * The net each account moves by once the branch's queued exchanges post —
 * added to the server's positions and said as Provisional while it is not zero
 * (docs/73 §5.3). Only exchanges still to be sent count; one the server refused
 * moves nothing until a person sends it again.
 */
export function provisionalNet(items: readonly QueueItem[], branchId: string | null, providers: readonly AgentProvider[]): Record<string, number> {
  const net: Record<string, number> = {};
  for (const item of pendingExchanges(items, branchId)) {
    if (item.state === 'needs_attention' || !isExchangePayload(item.payload)) continue;
    for (const leg of queuedLegs(item.payload, providers)) {
      const key = legKey(leg);
      net[key] = Math.round(((net[key] ?? 0) + (leg.direction === 'inflow' ? leg.amount : -leg.amount)) * 100) / 100;
    }
  }
  return net;
}
