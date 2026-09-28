import { parseAmount } from './price-input.ts';

/**
 * The money a shop opens with (docs/63) — what the phone decides before it asks.
 *
 * Opening the boutique, or opening it again, carries a decision about the shop's
 * cash, recorded with the opening by the server:
 *
 * - the Owner chooses, explicitly — nothing is selected for them: **keep** the
 *   drawer as the app tracks it (an unknown one stays unknown), or **set** what
 *   is in it now (zero included, when chosen);
 * - anybody else who may open does so with the tracked amounts, and the day then
 *   awaits the Owner's review — never presented as checked;
 * - the company's accounts carry forward; a shop's opening never sets them.
 *
 * Pure, so the rules are tested without a device.
 */

export type OpeningChoice = 'keep' | 'set';

/** What an opening request carries (`openingMoney`): the Owner's decision, or only the key for anybody else. */
export interface OpeningMoneyInput {
  clientUuid: string;
  decision?: OpeningChoice;
  cashAmount?: number;
}

/** One method as the step shows it: the shop's cash, or a company account carried forward. */
export interface OpeningMethod {
  key: string;
  channel: 'cash' | 'account';
  accountId: string | null;
  label: string;
  scope: 'branch' | 'company';
  known: boolean;
  /** What Money shows for it now; null when unknown — never 0. */
  previous: number | null;
}

export type OpeningState = 'none' | 'owner_decided' | 'awaiting_owner_review' | 'reviewed';

export interface OpeningRecord {
  decision: 'keep' | 'set' | 'carried';
  at: string;
  byName: string;
  cash: number | null;
}

/** Where today's opening stands, as the server says it. */
export interface OpeningStatus {
  state: OpeningState;
  opening: OpeningRecord | null;
  review: OpeningRecord | null;
}

/** The step's figures, from the day's view (`openingMoney`). */
export interface OpeningStep extends OpeningStatus {
  /** The Owner: decides the amounts. Anybody else opens with them as tracked. */
  mayDecide: boolean;
  branchCount: number;
  methods: OpeningMethod[];
  total: number | null;
}

/** Money's tracked methods as the step shows them — the Owner's review starts from what Money shows. */
export function openingMethodsOf(
  methods: readonly { key: string; channel: 'cash' | 'account'; accountId: string | null; label: string; scope: 'branch' | 'company'; known: boolean; position: number | null }[],
): OpeningMethod[] {
  return methods.map((m) => ({ key: m.key, channel: m.channel, accountId: m.accountId, label: m.label, scope: m.scope, known: m.known, previous: m.position }));
}

/** Why the Owner's request cannot be sent yet, or what it is. */
export type OpeningDraft =
  | { ok: true; decision: 'keep' }
  | { ok: true; decision: 'set'; cashAmount: number }
  | { ok: false; reason: 'choose' | 'amount_required' | 'amount_invalid' };

/**
 * The Owner's decision from the step's state. Nothing is chosen until the Owner
 * chooses; a set amount must be typed or chosen as 0 — an empty field is not 0.
 */
export function openingDraft(choice: OpeningChoice | null, cashText: string): OpeningDraft {
  if (choice === null) return { ok: false, reason: 'choose' };
  if (choice === 'keep') return { ok: true, decision: 'keep' };
  const parsed = parseAmount(cashText);
  if (!parsed.ok) return { ok: false, reason: parsed.reason === 'empty' ? 'amount_required' : 'amount_invalid' };
  return { ok: true, decision: 'set', cashAmount: parsed.value };
}

/** The cash field when "set" is chosen: the drawer's previous amount when known, else empty — never a made-up 0. */
export function prefilledCash(methods: readonly OpeningMethod[]): string {
  const cash = methods.find((m) => m.channel === 'cash');
  return cash && cash.previous !== null ? String(cash.previous) : '';
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * The total shown before confirming: the cash as decided (kept, or the amount
 * set) plus every account as it carries forward — only when every one is known.
 * The phone adds only what it shows side by side; the figures are the server's.
 */
export function openingTotal(methods: readonly OpeningMethod[], draft: OpeningDraft): number | null {
  let sum = 0;
  for (const m of methods) {
    const amount = m.channel === 'cash' && draft.ok && draft.decision === 'set' ? draft.cashAmount : m.previous;
    if (amount === null) return null;
    sum += amount;
  }
  return round2(sum);
}

/**
 * The key for this attempt: the same request again — a retry, a second tap —
 * keeps its key and the server answers with what it recorded; a changed request
 * is a new attempt with a new key, never refused as a reused one.
 */
export function attemptKey(last: { key: string; payload: string } | null, payload: string, newKey: () => string): { key: string; payload: string } {
  return last && last.payload === payload ? last : { key: newKey(), payload };
}

/**
 * The opening request: the Owner's decision, or — for anybody else, whose amounts the server carries forward —
 * only the key, so a second tap is answered with the first. Nothing to send while the Owner has not decided.
 */
export function openingRequest(draft: OpeningDraft, key: string, mayDecide: boolean): OpeningMoneyInput | undefined {
  if (!mayDecide) return { clientUuid: key };
  if (!draft.ok) return undefined;
  return draft.decision === 'set' ? { clientUuid: key, decision: 'set', cashAmount: draft.cashAmount } : { clientUuid: key, decision: 'keep' };
}
