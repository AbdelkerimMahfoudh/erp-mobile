import { parseAmount } from './price-input.ts';
import { pendingExchanges } from './offline/agent-exchange.ts';
import type { LegDirection } from './agent-rules.ts';
import type { QueueItem } from './offline/queue-rules.ts';

/**
 * The counter's money outside the exchanges themselves, as pure rules
 * (docs/73 §4.3–4.5, §5.3; D154, D155):
 *
 *  - **setting a float** — which accounts the Owner may set (each provider
 *    float and each commission a provider holds, at this branch only);
 *  - **rebalancing** — money moved between the drawer and the floats, or with
 *    the outside: the form's lines, their balance, and the one body the server
 *    accepts. The legs net to zero, or an outside party is named for exactly
 *    the difference — computed here, never typed, so the two cannot disagree;
 *  - **the closing** — the floats a lock still waits for, a count's words, and
 *    the refusal to start the closing while this phone holds exchanges.
 *
 * Nothing here decides a figure the server keeps: the phone checks what it
 * sends so a slip is caught before it is sent, and the server checks again.
 *
 *   node lib/agent-money.test.ts
 */

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

// ── Setting a float (the Owner's) ───────────────────────────────────────────

export type FloatAccountKind = 'provider' | 'commission_held';

export interface FloatTarget {
  /** `provider:<id>` or `commission_held:<id>` — the positions' own keys. */
  key: string;
  providerId: string;
  accountKind: FloatAccountKind;
  label: string;
  known: boolean;
  /** The server's figure; null while unknown — never 0. */
  position: number | null;
}

interface FloatLike {
  providerId: string;
  providerLabel: string;
  accountKind: FloatAccountKind;
  known: boolean;
  position: number | null;
}

/**
 * What the Owner may set at this branch: every float the positions list, then
 * every commission a provider holds — in the server's order. The drawer is not
 * one of them: its amount is the opening's or the closing's (D102), never a
 * float's.
 */
export function floatTargets(positions: { floats: readonly FloatLike[]; commissionHeld: readonly FloatLike[] }): FloatTarget[] {
  const target = (f: FloatLike): FloatTarget => ({
    key: `${f.accountKind}:${f.providerId}`,
    providerId: f.providerId,
    accountKind: f.accountKind,
    label: f.providerLabel,
    known: f.known && f.position !== null,
    position: f.known ? f.position : null,
  });
  return [...positions.floats.map(target), ...positions.commissionHeld.map(target)];
}

// ── Rebalancing ─────────────────────────────────────────────────────────────

export type RebalancingAccount = 'cash' | 'provider' | 'commission_held';
export type ExternalCounterparty = 'owner_capital' | 'provider_settlement' | 'other';
export const EXTERNAL_COUNTERPARTIES: readonly ExternalCounterparty[] = ['owner_capital', 'provider_settlement', 'other'];
export const REBALANCING_REASON_MAX = 255;
export const REBALANCING_NOTE_MAX = 500;

/** One line of the form, as typed: the amount is the text in its field. */
export interface RebalancingLine {
  /** Stable identity of the line in the form, never sent. */
  id: string;
  account: RebalancingAccount;
  /** The provider of a float or a held commission; null for the drawer. */
  providerId: string | null;
  direction: LegDirection;
  amount: string;
}

/** A line's account as one value — `cash`, `provider:<id>`, `commission_held:<id>` — the positions' keys. */
export function accountKeyOf(line: Pick<RebalancingLine, 'account' | 'providerId'>): string {
  return line.account === 'cash' ? 'cash' : `${line.account}:${line.providerId ?? ''}`;
}

export interface AccountChoice {
  key: string;
  account: RebalancingAccount;
  providerId: string | null;
  /** The provider's name; empty for the drawer, which the screen names in its own language. */
  label: string;
}

interface ProviderLike {
  id: string;
  label: string;
  isActive: boolean;
  config: { commissionDestination: string | null } | null;
}

/**
 * The accounts a rebalancing may move, at this branch: the drawer; each active
 * provider's float, and any float that still holds or moved money; each
 * commission a provider holds for the branch — where the configuration keeps
 * it there, or where some is held already. Nothing else: the outside is never
 * a line, it is named for the difference.
 */
export function rebalancingAccounts(
  providers: readonly ProviderLike[],
  positions: { floats: readonly { providerId: string; providerLabel: string }[]; commissionHeld: readonly { providerId: string; providerLabel: string }[] } | null,
): AccountChoice[] {
  const out: AccountChoice[] = [{ key: 'cash', account: 'cash', providerId: null, label: '' }];
  const add = (account: 'provider' | 'commission_held', providerId: string, label: string) => {
    const key = `${account}:${providerId}`;
    if (!out.some((c) => c.key === key)) out.push({ key, account, providerId, label });
  };
  for (const p of providers) if (p.isActive) add('provider', p.id, p.label);
  for (const f of positions?.floats ?? []) add('provider', f.providerId, f.providerLabel);
  for (const p of providers) if (p.isActive && p.config?.commissionDestination === 'held_separately') add('commission_held', p.id, p.label);
  for (const f of positions?.commissionHeld ?? []) add('commission_held', f.providerId, f.providerLabel);
  return out;
}

/** The account a key names, or null for a key that names none. */
export function accountOfKey(key: string): Pick<RebalancingLine, 'account' | 'providerId'> | null {
  if (key === 'cash') return { account: 'cash', providerId: null };
  const at = key.indexOf(':');
  const account = key.slice(0, at);
  const providerId = key.slice(at + 1);
  if (at < 0 || !providerId || (account !== 'provider' && account !== 'commission_held')) return null;
  return { account, providerId };
}

/**
 * The form as it opens: cash out of the drawer, into the first float — buying
 * float with cash, the move a counter makes most — amounts empty. Every line
 * can be changed; nothing is sent until the person has typed the amounts.
 */
export function startingLines(firstProviderId: string | null, newId: () => string): RebalancingLine[] {
  const cash: RebalancingLine = { id: newId(), account: 'cash', providerId: null, direction: 'outflow', amount: '' };
  if (!firstProviderId) return [cash];
  return [cash, { id: newId(), account: 'provider', providerId: firstProviderId, direction: 'inflow', amount: '' }];
}

/**
 * An amount typed on one line. With exactly two lines going opposite ways — a
 * move from one account to another — the other line follows it until the
 * person types there themselves: one amount typed once, never twice.
 */
export function withAmount(lines: readonly RebalancingLine[], id: string, amount: string, typedByHand: ReadonlySet<string>): RebalancingLine[] {
  const next = lines.map((l) => (l.id === id ? { ...l, amount } : l));
  if (next.length !== 2 || next[0].direction === next[1].direction) return next;
  const other = next.find((l) => l.id !== id);
  if (!other || typedByHand.has(other.id)) return next;
  return next.map((l) => (l.id === other.id ? { ...l, amount } : l));
}

export interface RebalancingBalance {
  inflows: number;
  outflows: number;
  /** In − out: above zero, more came in than went out — the difference came from outside. */
  net: number;
  /** Every line has a valid amount above zero. */
  complete: boolean;
}

/** What the lines move, from the amounts that parse; the balance the outside party must cover. */
export function rebalancingBalance(lines: readonly Pick<RebalancingLine, 'direction' | 'amount'>[]): RebalancingBalance {
  let inflows = 0;
  let outflows = 0;
  let complete = lines.length > 0;
  for (const line of lines) {
    const parsed = parseAmount(line.amount);
    if (!parsed.ok || parsed.value <= 0) {
      complete = false;
      continue;
    }
    if (line.direction === 'inflow') inflows += parsed.value;
    else outflows += parsed.value;
  }
  return { inflows: round2(inflows), outflows: round2(outflows), net: round2(inflows - outflows), complete };
}

export interface RebalancingBody {
  reason: string;
  note?: string;
  legs: { account: RebalancingAccount; providerId?: string; direction: LegDirection; amount: number }[];
  externalCounterparty?: ExternalCounterparty;
  externalAmount?: number;
}

export type RebalancingProblem = 'reason_missing' | 'reason_too_long' | 'note_too_long' | 'no_lines' | 'amount_invalid' | 'provider_missing' | 'outside_needed';

export type RebalancingCheck = { ok: true; body: RebalancingBody; balance: RebalancingBalance } | { ok: false; problems: RebalancingProblem[]; balance: RebalancingBalance };

/**
 * The one body the server records (docs/73 §4.3, A8), or every reason it cannot
 * be sent yet. The legs net to zero — then no outside party is sent, even one
 * chosen earlier — or an outside party is named, and its amount is the lines'
 * own difference: positive when money came in from outside.
 */
export function rebalancingCheck(input: {
  reason: string;
  note: string;
  lines: readonly RebalancingLine[];
  external: ExternalCounterparty | null;
}): RebalancingCheck {
  const balance = rebalancingBalance(input.lines);
  const problems: RebalancingProblem[] = [];
  const reason = input.reason.trim();
  const note = input.note.trim();
  if (!reason) problems.push('reason_missing');
  else if (reason.length > REBALANCING_REASON_MAX) problems.push('reason_too_long');
  if (note.length > REBALANCING_NOTE_MAX) problems.push('note_too_long');
  if (input.lines.length === 0) problems.push('no_lines');
  else if (!balance.complete) problems.push('amount_invalid');
  if (input.lines.some((l) => l.account !== 'cash' && !l.providerId)) problems.push('provider_missing');
  if (balance.complete && balance.net !== 0 && !input.external) problems.push('outside_needed');
  if (problems.length > 0) return { ok: false, problems, balance };

  const body: RebalancingBody = {
    reason,
    ...(note ? { note } : {}),
    legs: input.lines.map((l) => ({
      account: l.account,
      ...(l.account === 'cash' ? {} : { providerId: l.providerId as string }),
      direction: l.direction,
      amount: round2(Number((parseAmount(l.amount) as { value: number }).value)),
    })),
    ...(balance.net !== 0 && input.external ? { externalCounterparty: input.external, externalAmount: balance.net } : {}),
  };
  return { ok: true, body, balance };
}

/** One account a refused rebalancing would take below zero, as the server names it (409 `rebalancing_negative`). */
export interface NegativeProblem {
  account: RebalancingAccount;
  providerId: string | null;
  after: number;
}

/** The accounts named by a `rebalancing_negative` refusal; empty for any other answer. */
export function negativeProblems(body: unknown): NegativeProblem[] {
  const problems = (body as { problems?: unknown } | null)?.problems;
  if (!Array.isArray(problems)) return [];
  return problems.flatMap((p) => {
    const row = p as { account?: unknown; providerId?: unknown; after?: unknown };
    if ((row.account !== 'cash' && row.account !== 'provider' && row.account !== 'commission_held') || typeof row.after !== 'number') return [];
    return [{ account: row.account, providerId: typeof row.providerId === 'string' ? row.providerId : null, after: row.after }];
  });
}

// ── The closing ─────────────────────────────────────────────────────────────

/** One provider float at a closing, as the open view and the report list it. */
export interface FloatCountLike {
  providerId: string;
  label: string;
  expected: number | null;
  counted: number | null;
  difference: number | null;
  isSkipped: boolean;
}

export type FloatCountState = 'counted' | 'skipped' | 'not_counted';

export function floatCountState(f: Pick<FloatCountLike, 'counted' | 'isSkipped'>): FloatCountState {
  if (f.counted !== null) return 'counted';
  return f.isSkipped ? 'skipped' : 'not_counted';
}

/**
 * The floats a lock still waits for (the server's `floatsToCount`): neither
 * counted nor skipped with a reason. The closing lists an inactive provider
 * only once it was counted or skipped, so every uncounted float it lists is an
 * active one — owed a count whether or not it moved today.
 */
export function floatsOutstanding<F extends Pick<FloatCountLike, 'counted' | 'isSkipped'>>(floats: readonly F[]): F[] {
  return floats.filter((f) => floatCountState(f) === 'not_counted');
}

/** A difference in words as well as a sign — colour never carries it alone: short, over, or none. */
export function differenceKind(difference: number | null): 'short' | 'over' | 'none' | null {
  if (difference === null) return null;
  if (difference === 0) return 'none';
  return difference < 0 ? 'short' : 'over';
}

export const FLOAT_TEXT_MAX = 255;

export type FloatCountBody =
  | { providerId: string; counted: number; explanation?: string }
  | { providerId: string; skip: true; skipReason: string };

export type FloatCountCheck = { ok: true; body: FloatCountBody } | { ok: false; reason: 'amount_invalid' | 'reason_missing' | 'too_long' };

/**
 * One float's count as the server takes it (`POST closings/:date/float-counts`):
 * the amount the provider's app shows — zero is a count; nothing below it — or
 * a skip with its reason, never both. An explanation travels only with a count.
 */
export function floatCountCheck(input: { providerId: string; skip: boolean; amount: string; explanation: string; skipReason: string }): FloatCountCheck {
  if (input.skip) {
    const reason = input.skipReason.trim();
    if (!reason) return { ok: false, reason: 'reason_missing' };
    if (reason.length > FLOAT_TEXT_MAX) return { ok: false, reason: 'too_long' };
    return { ok: true, body: { providerId: input.providerId, skip: true, skipReason: reason } };
  }
  const parsed = parseAmount(input.amount);
  if (!parsed.ok) return { ok: false, reason: 'amount_invalid' };
  const explanation = input.explanation.trim();
  if (explanation.length > FLOAT_TEXT_MAX) return { ok: false, reason: 'too_long' };
  return { ok: true, body: { providerId: input.providerId, counted: parsed.value, ...(explanation ? { explanation } : {}) } };
}

/**
 * Whether to ask why the figures differ: only once the typed amount is a valid
 * count and the app knows what it expected. Against an unknown float there is
 * no difference to explain — nothing is fabricated to compare with.
 */
export function asksExplanation(expected: number | null, typed: string): boolean {
  if (expected === null) return false;
  const parsed = parseAmount(typed);
  return parsed.ok && round2(parsed.value - expected) !== 0;
}

/**
 * The exchanges this phone still holds for the branch — waiting to be sent, on
 * their way, or waiting for a person. While there is one, the phone does not
 * start the closing or count a float (D155): the day's figures would be closed
 * without an exchange that already happened at the counter.
 */
export function exchangesHeld(items: readonly QueueItem[], branchId: string | null): number {
  return pendingExchanges(items, branchId).length;
}
