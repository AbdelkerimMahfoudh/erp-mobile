import { parseAmount } from './price-input.ts';
import { parseCustomerNumber, providerChoice, referenceField, type AgentDirection, type AgentProvider, type ParsedCustomerNumber, type ReadyConfig } from './agent-rules.ts';
import { isExchangePayload, type ExchangePayload } from './offline/agent-exchange.ts';
import type { QueueState } from './offline/queue-rules.ts';

/**
 * The counter flow's own rules (docs/73 §5.2, D157): direction first, then the
 * provider, the amount, the customer's number and — when the provider issues
 * them — the reference; then one review, then Confirm. Short enough for a
 * queue at the counter; nothing typed twice.
 *
 * Pure, so the flow's states are tested without a screen:
 *   node lib/agent-counter.test.ts
 */

/** The unsent form, as the draft keeps it. The customer's number is NOT here: it is in SecureStore (D155). */
export interface CounterForm {
  /** The exchange's key from the moment the form opens: the draft, the SecureStore entry and the queue item share it. */
  clientUuid: string;
  direction: AgentDirection | null;
  providerId: string | null;
  /** As typed, so a half-typed amount survives a restart exactly as it was. */
  amount: string;
  reference: string;
  /** On the review rather than the form. */
  reviewing: boolean;
  /**
   * The phone's clock at the first Confirm under this key, kept: the server fingerprints it with the rest, so a
   * second Confirm after a lost answer is the SAME request (answered with its record), never a different one.
   */
  stampedAt?: string | null;
}

export const COUNTER_DRAFT_FORM = 'agent.exchange';
export const COUNTER_DRAFT_VERSION = 1;

export function emptyCounterForm(clientUuid: string): CounterForm {
  return { clientUuid, direction: null, providerId: null, amount: '', reference: '', reviewing: false, stampedAt: null };
}

/** The step the form is on: what the person is asked next. */
export type CounterStep = 'direction' | 'provider' | 'details' | 'review';

export function counterStep(form: CounterForm, provider: AgentProvider | null): CounterStep {
  if (!form.direction) return 'direction';
  if (!provider || !providerChoice(provider).selectable) return 'provider';
  return form.reviewing ? 'review' : 'details';
}

export interface FormProblems {
  amount?: 'empty' | 'not_a_number' | 'zero' | 'too_precise';
  number?: Exclude<ParsedCustomerNumber, { ok: true }>['reason'];
  reference?: 'required' | 'too_long';
}

/** The provider's reference: up to 120 characters, as the server takes it. */
export const REFERENCE_MAX = 120;

/**
 * What stops the review: an amount above zero with at most two decimals, a
 * customer number the server will accept, and a reference when the provider
 * issues one for every exchange. Each problem is said beside its own field.
 */
export function formProblems(form: Pick<CounterForm, 'amount' | 'reference'>, customerNumber: string, config: Pick<ReadyConfig, 'referenceRule'>): FormProblems {
  const problems: FormProblems = {};
  const amount = parseAmount(form.amount);
  if (!amount.ok) problems.amount = amount.reason === 'negative' ? 'not_a_number' : amount.reason;
  else if (!(amount.value > 0)) problems.amount = 'zero';
  const number = parseCustomerNumber(customerNumber);
  if (!number.ok) problems.number = number.reason;
  const field = referenceField(config.referenceRule);
  if (field !== 'hidden') {
    if (form.reference.trim().length > REFERENCE_MAX) problems.reference = 'too_long';
    else if (field === 'required' && form.reference.trim() === '') problems.reference = 'required';
  }
  return problems;
}

export function canReview(problems: FormProblems): boolean {
  return Object.keys(problems).length === 0;
}

/**
 * What the queue is given at Confirm: the provider, the direction, the amount,
 * the reference only when the provider takes one, the configuration version the
 * review showed, and the phone's clock as a claim. Never the number, never a
 * person — the server derives who recorded it from the session (A6).
 */
export function counterPayload(form: CounterForm, provider: AgentProvider & { config: ReadyConfig }, now: Date): ExchangePayload | null {
  const amount = parseAmount(form.amount);
  if (!form.direction || !amount.ok || !(amount.value > 0)) return null;
  const reference = form.reference.trim();
  return {
    providerId: provider.id,
    direction: form.direction,
    amount: amount.value,
    ...(referenceField(provider.config.referenceRule) !== 'hidden' && reference ? { providerReference: reference } : {}),
    configVersionId: provider.config.id,
    deviceRecordedAt: now.toISOString(),
  };
}

/**
 * Where a confirmed exchange stands, in the counter's words (D155):
 *  - `pending` — on this phone, not yet accepted: *Pending synchronization*,
 *    never shown with a time the server did not give it;
 *  - `recorded` — the server accepted it, with its own instant;
 *  - `attention` — the server refused it by name; a person decides;
 *  - `cancelled` — dropped before it was sent.
 */
export type ExchangeOutcome = 'pending' | 'recorded' | 'attention' | 'cancelled';

export function exchangeOutcome(state: QueueState): ExchangeOutcome {
  switch (state) {
    case 'synced':
      return 'recorded';
    case 'needs_attention':
      return 'attention';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'pending';
  }
}

/**
 * A refused exchange, prepared again: its direction, provider, amount and
 * reference as a fresh form under a NEW key — a different payload under the
 * old key would be refused as a conflict — back on the form, so the person
 * reads the review again with the rate in force before confirming.
 */
export function againForm(payload: unknown, clientUuid: string): CounterForm | null {
  if (!isExchangePayload(payload)) return null;
  return {
    ...emptyCounterForm(clientUuid),
    direction: payload.direction,
    providerId: payload.providerId,
    amount: String(payload.amount),
    reference: payload.providerReference ?? '',
  };
}
