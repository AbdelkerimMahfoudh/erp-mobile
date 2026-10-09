import { parsePayerNumber, PAYER_NUMBER_MAX_DIGITS } from './payer-number.ts';

/**
 * The money services counter, as the phone reads it (docs/73 §4–§5, D154–D157).
 *
 * The server decides every figure an exchange records: the commission, the
 * legs, the instant, the business day and who recorded it. The phone needs the
 * same rules for three things only, and never posts anything they compute:
 *
 *  - the **review** before Confirm names both movements and the commission in
 *    words and figures, from the provider's configuration as the server sent it
 *    (the rate is the configured one — never a guess, never a zero for a blank);
 *  - the **provisional** figures while exchanges wait in the queue: the server's
 *    position plus the legs those exchanges will post, said as Provisional;
 *  - the **customer number**, checked as the server will check it, so a typing
 *    slip is caught at the counter rather than a queue later.
 *
 * Mirrors `erp-backend/src/agent/agent-rules.ts`; the two are kept identical by
 * their tests. Pure and dependency-free so it runs under plain Node:
 *   node lib/agent-rules.test.ts
 */

export type AgentDirection = 'cash_in_credit_out' | 'cash_out_credit_in';
export type CommissionDestination = 'cash' | 'provider_float' | 'held_separately';
export type PrincipalFeeMode = 'separate' | 'deducted';
export type ReferenceRule = 'required' | 'optional' | 'none';
export type LegAccount = 'cash' | 'provider' | 'commission_held' | 'external';
export type LegDirection = 'inflow' | 'outflow';
export type LegKind = 'principal' | 'commission' | 'reversal' | 'rebalancing';

export const DIRECTIONS: readonly AgentDirection[] = ['cash_in_credit_out', 'cash_out_credit_in'];

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** A provider's configuration version in force, as `GET agent/providers` sends it. NULL is a blank, never zero. */
export interface ProviderConfig {
  id: string;
  rateInBp: number | null;
  rateOutBp: number | null;
  sameRateBothDirections: boolean;
  commissionDestination: CommissionDestination | null;
  principalFeeMode: PrincipalFeeMode | null;
  referenceRule: ReferenceRule | null;
  effectiveFrom: string;
  recordedByName: string | null;
  reason: string | null;
}

export interface AgentProvider {
  id: string;
  kind: 'bankily' | 'sedad' | 'other';
  label: string;
  isActive: boolean;
  sortOrder: number;
  config: ProviderConfig | null;
  /** The server's verdict: every required field of the version in force is filled. */
  readyForTransactions: boolean;
  /** The blank required fields, e.g. `['rateInBp', 'commissionDestination']`. */
  missing: string[];
}

/** A provider configured completely — what the counter flow may post with. */
export type ReadyConfig = ProviderConfig & {
  rateInBp: number;
  rateOutBp: number;
  commissionDestination: CommissionDestination;
  principalFeeMode: PrincipalFeeMode;
  referenceRule: ReferenceRule;
};

// ── Choosing a provider ─────────────────────────────────────────────────────

export type ProviderChoice = { selectable: true; config: ReadyConfig } | { selectable: false; reason: 'not_set_up' | 'switched_off' };

/**
 * Whether the counter may choose a provider (docs/73 §1.2, D157): only one the
 * server says is ready, with every field of its version in force filled. A
 * provider with a blank is listed as *Not set up yet* and cannot be chosen; one
 * switched off is not offered at all. The phone trusts the server's
 * `readyForTransactions` and still refuses a version it sees a blank in, so a
 * half-read answer can never post a guess.
 */
export function providerChoice(provider: AgentProvider): ProviderChoice {
  if (!provider.isActive) return { selectable: false, reason: 'switched_off' };
  const c = provider.config;
  if (
    !provider.readyForTransactions ||
    !c ||
    c.rateInBp === null ||
    c.rateOutBp === null ||
    c.commissionDestination === null ||
    c.principalFeeMode === null ||
    c.referenceRule === null
  ) {
    return { selectable: false, reason: 'not_set_up' };
  }
  return { selectable: true, config: c as ReadyConfig };
}

/** The providers the counter lists: active ones, in the Owner's order, then by name. */
export function counterProviders(providers: readonly AgentProvider[]): AgentProvider[] {
  return providers.filter((p) => p.isActive).sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
}

/** How the reference field is offered: asked for, offered, or not shown at all (docs/73 §4.6). */
export function referenceField(rule: ReferenceRule): 'required' | 'optional' | 'hidden' {
  return rule === 'none' ? 'hidden' : rule;
}

// ── Commission and legs (mirrors the server) ────────────────────────────────

/** The direction's own rate: a real schedule may charge the two directions differently (A4). */
export function rateFor(direction: AgentDirection, config: Pick<ProviderConfig, 'rateInBp' | 'rateOutBp'>): number | null {
  return direction === 'cash_in_credit_out' ? config.rateInBp : config.rateOutBp;
}

/**
 * The whole amount at the rate, never brackets (A4), to the cent, a half cent up — counted in whole cents and basis
 * points, exactly, as the server counts it: in floating point the same half cent rounded up or down with the amount's
 * binary form (837 MRU at 0.50 % is 4.19, as 879 MRU is 4.40).
 */
export function commissionOf(amount: number, rateBp: number): number {
  const scaled = BigInt(Math.round(amount * 100)) * BigInt(rateBp);
  const whole = scaled / BigInt(10_000);
  const cents = (scaled % BigInt(10_000)) * BigInt(2) >= BigInt(10_000) ? whole + BigInt(1) : whole;
  return Number(cents) / 100;
}

export interface Leg {
  account: LegAccount;
  /** The provider whose float or held commission moves; null for the drawer and the outside world. */
  providerId: string | null;
  direction: LegDirection;
  amount: number;
  kind: LegKind;
}

/**
 * The legs an exchange posts at completion (docs/73 §4.2–4.3), exactly as the
 * server writes them: the cash leg, the float leg (netted by the commission
 * when the provider deducts it), and the commission leg where it is settled
 * apart. A leg of zero moves nothing and is left out.
 */
export function exchangeLegs(input: {
  direction: AgentDirection;
  amount: number;
  commission: number;
  providerId: string;
  commissionDestination: CommissionDestination;
  principalFeeMode: PrincipalFeeMode;
}): Leg[] {
  const amount = round2(input.amount);
  const commission = round2(input.commission);
  const cashIn = input.direction === 'cash_in_credit_out';
  const floatDirection: LegDirection = cashIn ? 'outflow' : 'inflow';
  const legs: Leg[] = [{ account: 'cash', providerId: null, direction: cashIn ? 'inflow' : 'outflow', amount, kind: 'principal' }];
  if (input.principalFeeMode === 'deducted') {
    // Only ever with the float as the destination: the server refuses any other configuration (docs/73 §4.2).
    legs.push({ account: 'provider', providerId: input.providerId, direction: floatDirection, amount: round2(cashIn ? amount - commission : amount + commission), kind: 'principal' });
  } else {
    legs.push({ account: 'provider', providerId: input.providerId, direction: floatDirection, amount, kind: 'principal' });
    const account: LegAccount = input.commissionDestination === 'cash' ? 'cash' : input.commissionDestination === 'provider_float' ? 'provider' : 'commission_held';
    legs.push({ account, providerId: account === 'cash' ? null : input.providerId, direction: 'inflow', amount: commission, kind: 'commission' });
  }
  return legs.filter((leg) => leg.amount !== 0);
}

/** What the review shows: the commission, its rate and the legs, from a provider ready to post. */
export interface ExchangePreview {
  rateBp: number;
  commission: number;
  destination: CommissionDestination;
  feeMode: PrincipalFeeMode;
  legs: Leg[];
  /** The cash leg's amount and the float leg's — what the drawer and the float move by. */
  cash: { direction: LegDirection; amount: number };
  float: { direction: LegDirection; amount: number };
}

export function previewExchange(direction: AgentDirection, amount: number, providerId: string, config: ReadyConfig): ExchangePreview {
  const rateBp = rateFor(direction, config) as number;
  const commission = commissionOf(amount, rateBp);
  const legs = exchangeLegs({ direction, amount, commission, providerId, commissionDestination: config.commissionDestination, principalFeeMode: config.principalFeeMode });
  const principal = (account: LegAccount) => legs.find((l) => l.account === account && l.kind === 'principal');
  const cash = principal('cash');
  const float = principal('provider');
  return {
    rateBp,
    commission,
    destination: config.commissionDestination,
    feeMode: config.principalFeeMode,
    legs,
    cash: { direction: cash?.direction ?? (direction === 'cash_in_credit_out' ? 'inflow' : 'outflow'), amount: cash?.amount ?? 0 },
    float: { direction: float?.direction ?? (direction === 'cash_in_credit_out' ? 'outflow' : 'inflow'), amount: float?.amount ?? 0 },
  };
}

/** A rate in basis points as people say it: 200 → "2", 150 → "1.5", 5 → "0.05" (percent). */
export function percentOfBp(rateBp: number): string {
  return String(round2(rateBp / 100));
}

// ── The customer number ─────────────────────────────────────────────────────

export const CUSTOMER_NUMBER_MIN_DIGITS = 4;
export const CUSTOMER_NUMBER_MAX_DIGITS = PAYER_NUMBER_MAX_DIGITS;

export type ParsedCustomerNumber =
  | { ok: true; value: string; last4: string }
  | { ok: false; reason: 'missing' | 'invalid' | 'too_short' | 'too_long' };

/**
 * The customer number (A6, docs/73 §4.6): the payer number's digits rule — an
 * optional leading `+`, Arabic-Indic digits read as the same digits, spaces and
 * hyphens dropped, no country guessed — but mandatory, and at least four digits
 * so the masked `•••• 1234` has something to show.
 */
export function parseCustomerNumber(raw: string | null | undefined): ParsedCustomerNumber {
  const parsed = parsePayerNumber(raw);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  if (parsed.value === null) return { ok: false, reason: 'missing' };
  const digits = parsed.value.replace(/^\+/, '');
  if (digits.length < CUSTOMER_NUMBER_MIN_DIGITS) return { ok: false, reason: 'too_short' };
  return { ok: true, value: parsed.value, last4: digits.slice(-4) };
}

/** What a list shows of a number: its last four digits, as the server masks them. */
export function maskedNumber(last4: string): string {
  return `•••• ${last4}`;
}

// ── The server's refusals, in the counter's words ───────────────────────────

/**
 * What the person can do about a refused exchange:
 *  - `prepare_again` — the exchange cannot post as it was written (the rate
 *    changed, a field is wrong, the key was used): it is prepared again, read
 *    again by a person, and confirmed under a new key;
 *  - `retry` — nothing about the exchange is wrong; the moment is (the store is
 *    closed, the branch's activity or the business's access): it may be sent
 *    again unchanged, under the same key, once that changes;
 *  - `cancel` — nothing to do but drop it;
 *  - `check_list` — the key already holds a record: what the server recorded is
 *    in the exchanges list, and nothing is prepared again or confirmed as new.
 */
export type RefusalAction = 'prepare_again' | 'retry' | 'cancel' | 'check_list';

export interface AgentRefusal {
  /** The i18n key of the sentence the counter shows for it. */
  key: string;
  action: RefusalAction;
}

/** Every refusal of `POST agent/transactions` the counter names in its own words (the codes, never the English). */
export const AGENT_REFUSALS: Readonly<Record<string, AgentRefusal>> = {
  idempotency_conflict: { key: 'agent.refusal.idempotency_conflict', action: 'check_list' },
  stale_configuration: { key: 'agent.refusal.stale_configuration', action: 'prepare_again' },
  provider_not_configured: { key: 'agent.refusal.provider_not_configured', action: 'prepare_again' },
  provider_inactive: { key: 'agent.refusal.provider_inactive', action: 'prepare_again' },
  customer_number_invalid: { key: 'agent.refusal.customer_number_invalid', action: 'prepare_again' },
  reference_required: { key: 'agent.refusal.reference_required', action: 'prepare_again' },
  customer_number_missing: { key: 'agent.refusal.customer_number_missing', action: 'prepare_again' },
  store_closed: { key: 'agent.refusal.store_closed', action: 'retry' },
  activity_not_subscribed: { key: 'agent.refusal.activity_not_subscribed', action: 'retry' },
  ENTITLEMENT_WRITE_BLOCKED: { key: 'agent.refusal.entitlement', action: 'retry' },
  already_reversed: { key: 'agent.refusal.already_reversed', action: 'cancel' },
};

export function agentRefusal(code: string | null | undefined): AgentRefusal | null {
  return code ? (AGENT_REFUSALS[code] ?? null) : null;
}
