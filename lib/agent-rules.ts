import { parsePayerNumber } from './payer-number.ts';
import { toAsciiDigits } from './price-input.ts';

/**
 * The money services counter, as the phone reads it (docs/73 §4–§5, D154–D157, D164).
 *
 * The commission is the employee's to type, for every exchange (D164): there is
 * no rate, the provider neither pays nor checks it, the customer pays it to the
 * business. The server records it as typed, with the legs, the instant, the
 * business day and who recorded it — the person signed in, never one the phone
 * names. The phone needs the same rules for three things only:
 *
 *  - the **review** before Confirm: the amount, the commission the customer
 *    pays, the cash received or handed over and the credit sent or received;
 *  - the **provisional** figures while exchanges wait in the queue: the server's
 *    position plus the legs those exchanges will post, said as Provisional;
 *  - the **customer number** and the **commission**, checked as the server will
 *    check them, so a typing slip is caught at the counter rather than a queue later.
 *
 * Mirrors `erp-backend/src/agent/agent-rules.ts`; the two are kept identical by
 * their tests. Pure and dependency-free so it runs under plain Node:
 *   node lib/agent-rules.test.ts
 */

export type AgentDirection = 'cash_in_credit_out' | 'cash_out_credit_in';
/** How an exchange recorded before D164 was priced: history only, never a choice. */
export type CommissionDestination = 'cash' | 'provider_float' | 'held_separately';
export type PrincipalFeeMode = 'separate' | 'deducted';
export type ReferenceRule = 'required' | 'optional' | 'none';
export type LegAccount = 'cash' | 'provider' | 'commission_held' | 'external';
export type LegDirection = 'inflow' | 'outflow';
export type LegKind = 'principal' | 'commission' | 'reversal' | 'rebalancing';
/** `manual` — typed by the employee (D164); `legacy_rate` — what an exchange recorded under a rate stored. */
export type CommissionSource = 'manual' | 'legacy_rate';

export const DIRECTIONS: readonly AgentDirection[] = ['cash_in_credit_out', 'cash_out_credit_in'];

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** The pricing a version written before D164 held, exactly as stored: history only, it prices nothing. */
export interface LegacyPricing {
  rateInBp: number | null;
  rateOutBp: number | null;
  sameRateBothDirections: boolean;
  commissionDestination: CommissionDestination | null;
  principalFeeMode: PrincipalFeeMode | null;
}

/** A provider's configuration version, as `GET agent/providers` sends it: the reference rule, and its history. */
export interface ProviderConfig {
  id: string;
  referenceRule: ReferenceRule;
  effectiveFrom: string;
  recordedByName: string | null;
  reason: string | null;
  legacy: LegacyPricing | null;
}

export interface AgentProvider {
  id: string;
  kind: 'bankily' | 'sedad' | 'other';
  label: string;
  isActive: boolean;
  sortOrder: number;
  /** The rule of the version in force; `optional` when no version names one. */
  referenceRule: ReferenceRule;
  config: ProviderConfig | null;
}

const isRule = (v: unknown): v is ReferenceRule => v === 'required' || v === 'optional' || v === 'none';

/**
 * A provider as this build reads it, whatever build wrote it: a list kept on the
 * phone by an earlier build carried its rates at the top of the version and no
 * rule of its own. The rule then comes from that version, else `optional` (the
 * server's own default), and the rates become history.
 */
export function providerOf(raw: unknown): AgentProvider | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.id !== 'string' || typeof p.label !== 'string' || typeof p.isActive !== 'boolean') return null;
  const c = (typeof p.config === 'object' && p.config !== null ? p.config : null) as Record<string, unknown> | null;
  const config: ProviderConfig | null =
    c && typeof c.id === 'string'
      ? {
          id: c.id,
          referenceRule: isRule(c.referenceRule) ? c.referenceRule : 'optional',
          effectiveFrom: typeof c.effectiveFrom === 'string' ? c.effectiveFrom : '',
          recordedByName: typeof c.recordedByName === 'string' ? c.recordedByName : null,
          reason: typeof c.reason === 'string' ? c.reason : null,
          legacy:
            typeof c.legacy === 'object' && c.legacy !== null
              ? (c.legacy as LegacyPricing)
              : typeof c.rateInBp === 'number' || typeof c.rateOutBp === 'number'
                ? {
                    rateInBp: typeof c.rateInBp === 'number' ? c.rateInBp : null,
                    rateOutBp: typeof c.rateOutBp === 'number' ? c.rateOutBp : null,
                    sameRateBothDirections: c.sameRateBothDirections === true,
                    commissionDestination: (c.commissionDestination as CommissionDestination | null) ?? null,
                    principalFeeMode: (c.principalFeeMode as PrincipalFeeMode | null) ?? null,
                  }
                : null,
        }
      : null;
  return {
    id: p.id,
    kind: p.kind === 'bankily' || p.kind === 'sedad' ? p.kind : 'other',
    label: p.label,
    isActive: p.isActive,
    sortOrder: typeof p.sortOrder === 'number' ? p.sortOrder : 0,
    referenceRule: isRule(p.referenceRule) ? p.referenceRule : (config?.referenceRule ?? 'optional'),
    config,
  };
}

// ── Choosing a provider ─────────────────────────────────────────────────────

export type ProviderChoice = { selectable: true; referenceRule: ReferenceRule } | { selectable: false; reason: 'switched_off' };

/**
 * Whether the counter may choose a provider (D164): any provider switched on.
 * Nothing is configured before it is used — the commission is typed with each
 * exchange — so the only thing a provider brings is whether it asks for its
 * reference.
 */
export function providerChoice(provider: Pick<AgentProvider, 'isActive' | 'referenceRule'>): ProviderChoice {
  if (!provider.isActive) return { selectable: false, reason: 'switched_off' };
  return { selectable: true, referenceRule: provider.referenceRule };
}

/** The providers the counter lists: active ones, in the Owner's order, then by name. */
export function counterProviders(providers: readonly AgentProvider[]): AgentProvider[] {
  return providers.filter((p) => p.isActive).sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
}

/** How the reference field is offered: asked for, offered, or not shown at all (docs/73 §4.6). */
export function referenceField(rule: ReferenceRule): 'required' | 'optional' | 'hidden' {
  return rule === 'none' ? 'hidden' : rule;
}

// ── The commission the employee types (D164) ────────────────────────────────

export type CommissionRefusal = 'commission_required' | 'commission_invalid' | 'commission_exceeds_amount';

/**
 * The server's own check of a commission, word for word: required — absent,
 * null or empty is never zero —, a whole MRU, zero or more, and when cash is
 * handed over never more than the amount (the customer would be handed a
 * negative sum). Receiving cash, the customer pays it on top: no ceiling.
 */
export function commissionRefusal(direction: AgentDirection, amount: number, commission: unknown): CommissionRefusal | null {
  if (commission === undefined || commission === null || commission === '') return 'commission_required';
  if (typeof commission !== 'number' || !Number.isInteger(commission) || commission < 0) return 'commission_invalid';
  if (direction === 'cash_out_credit_in' && commission > amount) return 'commission_exceeds_amount';
  return null;
}

export type ParsedCommission = { ok: true; value: number } | { ok: false; reason: 'empty' | 'not_a_number' | 'not_whole' | 'negative' };

/**
 * The commission as typed: whole MRU, Arabic-Indic digits read as the same
 * digits. An empty field is empty — never zero: `0` is typed when the customer
 * paid none.
 */
export function parseCommission(text: string): ParsedCommission {
  const normalised = toAsciiDigits(text.trim()).replace(/\s/g, '');
  if (!normalised) return { ok: false, reason: 'empty' };
  if (/^-/.test(normalised)) return { ok: false, reason: 'negative' };
  if (/^\d+[.,]\d*$/.test(normalised)) return /^\d+[.,]0*$/.test(normalised) ? { ok: true, value: Number(normalised.split(/[.,]/)[0]) } : { ok: false, reason: 'not_whole' };
  if (!/^\d+$/.test(normalised)) return { ok: false, reason: 'not_a_number' };
  return { ok: true, value: Number(normalised) };
}

/** What a commission field keeps of each keystroke: digits only (Arabic-Indic ones as ASCII). */
export function maskCommission(text: string): string {
  return toAsciiDigits(text).replace(/[^0-9]/g, '');
}

// ── Legs and the review (mirrors the server) ────────────────────────────────

export interface Leg {
  account: LegAccount;
  /** The provider whose float or held commission moves; null for the drawer and the outside world. */
  providerId: string | null;
  direction: LegDirection;
  amount: number;
  kind: LegKind;
}

/**
 * The legs an exchange posts at completion (D164), exactly as the server
 * writes them: the provider's credit moves by the amount only, in both
 * directions; the commission the customer pays is one cash inflow. Receiving
 * cash: cash in A, credit out A, cash in C. Giving cash: cash out A, credit in
 * A, cash in C — the customer is handed A − C. A leg of zero is left out.
 */
export function exchangeLegs(input: { direction: AgentDirection; amount: number; commission: number; providerId: string }): Leg[] {
  const amount = round2(input.amount);
  const commission = round2(input.commission);
  const cashIn = input.direction === 'cash_in_credit_out';
  const legs: Leg[] = [
    { account: 'cash', providerId: null, direction: cashIn ? 'inflow' : 'outflow', amount, kind: 'principal' },
    { account: 'provider', providerId: input.providerId, direction: cashIn ? 'outflow' : 'inflow', amount, kind: 'principal' },
    { account: 'cash', providerId: null, direction: 'inflow', amount: commission, kind: 'commission' },
  ];
  return legs.filter((leg) => leg.amount !== 0);
}

/** What the review shows before Confirm (D164): the amount, the commission, and what each side moves. */
export interface ExchangePreview {
  amount: number;
  commission: number;
  /** The cash the customer hands over (receiving cash: A + C) or is handed (giving cash: A − C). */
  cash: { direction: LegDirection; amount: number };
  /** The provider's credit: always the amount. */
  credit: { direction: LegDirection; amount: number };
  legs: Leg[];
}

export function previewExchange(direction: AgentDirection, amount: number, commission: number, providerId: string): ExchangePreview {
  const cashIn = direction === 'cash_in_credit_out';
  return {
    amount: round2(amount),
    commission: round2(commission),
    cash: { direction: cashIn ? 'inflow' : 'outflow', amount: round2(cashIn ? amount + commission : amount - commission) },
    credit: { direction: cashIn ? 'outflow' : 'inflow', amount: round2(amount) },
    legs: exchangeLegs({ direction, amount, commission, providerId }),
  };
}

/** A rate in basis points as people say it: 200 → "2", 150 → "1.5", 5 → "0.05" (percent). History only (D164). */
export function percentOfBp(rateBp: number): string {
  return String(round2(rateBp / 100));
}

// ── The customer number ─────────────────────────────────────────────────────

/** A Mauritanian number: exactly eight digits — never seven, never nine (D162). */
export const CUSTOMER_NUMBER_DIGITS = 8;

export type ParsedCustomerNumber =
  | { ok: true; value: string; last4: string }
  | { ok: false; reason: 'missing' | 'invalid' | 'too_short' | 'too_long' };

/**
 * The customer number (A6, docs/73 §4.6; D162): read as the payer number is —
 * Arabic-Indic digits read as the same digits, spaces and hyphens dropped — but
 * mandatory, and exactly eight digits with no `+` or country code, the server's
 * own rule. The sale's payer number keeps its open format (D151).
 */
export function parseCustomerNumber(raw: string | null | undefined): ParsedCustomerNumber {
  const parsed = parsePayerNumber(raw);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  if (parsed.value === null) return { ok: false, reason: 'missing' };
  const digits = parsed.value;
  if (digits.startsWith('+')) return { ok: false, reason: 'invalid' };
  if (digits.length < CUSTOMER_NUMBER_DIGITS) return { ok: false, reason: 'too_short' };
  if (digits.length > CUSTOMER_NUMBER_DIGITS) return { ok: false, reason: 'too_long' };
  return { ok: true, value: digits, last4: digits.slice(-4) };
}

/** What a list shows of a number: its last four digits, as the server masks them. */
export function maskedNumber(last4: string): string {
  return `•••• ${last4}`;
}

// ── The server's refusals, in the counter's words ───────────────────────────

/**
 * What fixes a refused exchange (D161) — the queue's two kinds of "not recorded":
 *  - `send_again` — nothing about the exchange is wrong; the moment is (the
 *    business's access, a closed store, a provider switched off): it is sent
 *    again unchanged, under the same key, once that changes;
 *  - `review_and_send` — the provider is not the one it was prepared with (a
 *    provider gone, a conflict the server named no other way): it is prepared
 *    again, read again, and sent under a new key;
 *  - `edit_and_send` — a field the server would not take (the number, the
 *    commission, the reference, the request as written): prepared again for the
 *    person to fix — an exchange queued by an earlier build without a commission
 *    lands here, the commission then typed before it is sent again (D164);
 *  - `reenter` — it cannot be recorded from here (another exchange holds its
 *    key, the person may no longer record, the branch left the counter or the
 *    person left the branch): a Manager or someone allowed enters it, and it is
 *    removed from this phone;
 *  - `cancel` — nothing to do but drop it.
 */
export type RefusalAction = 'send_again' | 'review_and_send' | 'edit_and_send' | 'reenter' | 'cancel';

export interface AgentRefusal {
  /** The i18n key of the sentence the counter shows for it. */
  key: string;
  action: RefusalAction;
  /**
   * Raised in front of the ledger — before the server reads the exchange's key — so it proves nothing about an
   * exchange that may already be recorded: the status lookup decides that one first (D161).
   */
  beforeKey?: boolean;
}

/**
 * Every refusal of `POST agent/transactions` the counter names in its own words (the codes, never the English).
 * `validation` is a 400 without a code, `conflict` a 409/404/410 without a known one, and
 * `customer_number_missing` the phone's own: the number is no longer in SecureStore.
 */
export const AGENT_REFUSALS: Readonly<Record<string, AgentRefusal>> = {
  idempotency_conflict: { key: 'agent.refusal.idempotency_conflict', action: 'reenter' },
  conflict: { key: 'agent.refusal.conflict', action: 'review_and_send' },
  provider_inactive: { key: 'agent.refusal.provider_inactive', action: 'send_again' },
  customer_number_invalid: { key: 'agent.refusal.customer_number_invalid', action: 'edit_and_send' },
  reference_required: { key: 'agent.refusal.reference_required', action: 'edit_and_send' },
  commission_required: { key: 'agent.refusal.commission_required', action: 'edit_and_send' },
  commission_invalid: { key: 'agent.refusal.commission_invalid', action: 'edit_and_send' },
  commission_exceeds_amount: { key: 'agent.refusal.commission_exceeds_amount', action: 'edit_and_send' },
  validation: { key: 'agent.refusal.validation', action: 'edit_and_send' },
  customer_number_missing: { key: 'agent.refusal.customer_number_missing', action: 'edit_and_send' },
  store_closed: { key: 'agent.refusal.store_closed', action: 'send_again' },
  ENTITLEMENT_WRITE_BLOCKED: { key: 'agent.refusal.entitlement', action: 'send_again', beforeKey: true },
  activity_not_subscribed: { key: 'agent.refusal.activity_not_subscribed', action: 'reenter', beforeKey: true },
  permission_denied: { key: 'agent.refusal.permission_denied', action: 'reenter', beforeKey: true },
  branch_access_denied: { key: 'agent.refusal.branch_access_denied', action: 'reenter', beforeKey: true },
  branch_inactive: { key: 'agent.refusal.branch_inactive', action: 'reenter', beforeKey: true },
  already_reversed: { key: 'agent.refusal.already_reversed', action: 'cancel' },
};

/**
 * The codes the queue names for an exchange only: said in another context — a provider's settings, a float's
 * count — they would name the wrong thing, so a screen outside the queue says them its own way.
 */
export const QUEUE_ONLY_REFUSALS: readonly string[] = [
  'ENTITLEMENT_WRITE_BLOCKED',
  'idempotency_conflict',
  'permission_denied',
  'branch_access_denied',
  'branch_inactive',
  'validation',
  'conflict',
  'customer_number_missing',
];

export function agentRefusal(code: string | null | undefined): AgentRefusal | null {
  return code ? (AGENT_REFUSALS[code] ?? null) : null;
}
