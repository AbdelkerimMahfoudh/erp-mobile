/**
 * The counter flow's states (docs/73 §5.2, D155, D164): direction, provider,
 * details, review; what stops the review — the commission typed included; what
 * the queue is given at Confirm; where a confirmed exchange stands; a refused
 * one prepared again.
 *
 *   node lib/agent-counter.test.ts
 */
import assert from 'node:assert/strict';
import {
  againForm,
  canReview,
  counterPayload,
  counterStep,
  emptyCounterForm,
  exchangeOutcome,
  outcomeChip,
  formProblems,
  restoredForm,
  type CounterForm,
} from './agent-counter.ts';
import type { AgentProvider } from './agent-rules.ts';
import type { QueueState } from './offline/queue-rules.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`FAIL  ${name}`);
    throw e;
  }
};

const ready: AgentProvider = { id: 'bankily', kind: 'bankily', label: 'Bankily', isActive: true, sortOrder: 0, referenceRule: 'optional', config: null };
const off: AgentProvider = { ...ready, id: 'off', label: 'Off Co', isActive: false };
const optional = { referenceRule: 'optional' as const };
const form = (over: Partial<CounterForm> = {}): CounterForm => ({ ...emptyCounterForm('key-1'), ...over });
const typed = { amount: '10000', commission: '100', reference: '', direction: 'cash_in_credit_out' as const };

it('the flow asks for the direction first, then a provider switched on, then the details, then the review', () => {
  assert.equal(counterStep(form(), null), 'direction');
  assert.equal(counterStep(form({ direction: 'cash_in_credit_out' }), null), 'provider');
  assert.equal(counterStep(form({ direction: 'cash_in_credit_out', providerId: 'off' }), off), 'provider', 'a provider switched off cannot be chosen');
  assert.equal(counterStep(form({ direction: 'cash_in_credit_out', providerId: 'bankily' }), ready), 'details');
  assert.equal(counterStep(form({ direction: 'cash_in_credit_out', providerId: 'bankily', reviewing: true }), ready), 'review');
});

it('the review waits for an amount above zero, a typed commission, a number the server takes, and a required reference', () => {
  const ok = formProblems(typed, '36 12 34 56', optional);
  assert.deepEqual(ok, {});
  assert.equal(canReview(ok), true);
  assert.equal(formProblems({ ...typed, amount: '' }, '36123456', optional).amount, 'empty');
  assert.equal(formProblems({ ...typed, amount: '0' }, '36123456', optional).amount, 'zero');
  assert.equal(formProblems({ ...typed, amount: '10.123' }, '36123456', optional).amount, 'too_precise');
  assert.equal(formProblems({ ...typed, amount: '100' }, '', optional).number, 'missing');
  assert.equal(formProblems({ ...typed, amount: '100' }, '12', optional).number, 'too_short');
  assert.equal(formProblems({ ...typed, amount: '100' }, '36-AB', optional).number, 'invalid');
  const required = { referenceRule: 'required' as const };
  assert.equal(formProblems({ ...typed, reference: '  ' }, '36123456', required).reference, 'required');
  assert.deepEqual(formProblems({ ...typed, reference: 'TX-1' }, '36123456', required), {});
  assert.equal(formProblems({ ...typed, reference: 'x'.repeat(121) }, '36123456', optional).reference, 'too_long');
  // A provider that issues no reference never asks for one, whatever was typed before.
  assert.deepEqual(formProblems({ ...typed, reference: 'x'.repeat(500) }, '36123456', { referenceRule: 'none' }), {});
  assert.equal(canReview({ amount: 'zero' }), false);
});

it('the commission: required — an empty field is never zero —, whole MRU, and no more than the amount when cash is handed over (D164)', () => {
  assert.equal(formProblems({ ...typed, commission: '' }, '36123456', optional).commission, 'empty');
  assert.equal(canReview(formProblems({ ...typed, commission: '' }, '36123456', optional)), false);
  assert.deepEqual(formProblems({ ...typed, commission: '0' }, '36123456', optional), {}, 'a typed zero is a commission');
  assert.equal(formProblems({ ...typed, commission: '12.5' }, '36123456', optional).commission, 'not_whole');
  assert.equal(formProblems({ ...typed, commission: '-3' }, '36123456', optional).commission, 'negative');
  assert.equal(formProblems({ ...typed, direction: 'cash_out_credit_in', amount: '1000', commission: '1001' }, '36123456', optional).commission, 'exceeds_amount');
  assert.deepEqual(formProblems({ ...typed, direction: 'cash_out_credit_in', amount: '1000', commission: '1000' }, '36123456', optional), {});
  // Receiving cash, the customer pays it on top of the amount: no ceiling.
  assert.deepEqual(formProblems({ ...typed, amount: '1000', commission: '1500' }, '36123456', optional), {});
});

it('Confirm gives the queue the typed commission and the phone’s clock — never the number, never a person, never a version', () => {
  const now = new Date('2026-10-09T10:00:00.000Z');
  const payload = counterPayload(form({ direction: 'cash_in_credit_out', providerId: 'bankily', amount: '10000', commission: '150', reference: '  REF-9 ' }), ready, now);
  assert.deepEqual(payload, {
    providerId: 'bankily',
    direction: 'cash_in_credit_out',
    amount: 10_000,
    commissionAmount: 150,
    providerReference: 'REF-9',
    deviceRecordedAt: '2026-10-09T10:00:00.000Z',
  });
  for (const forbidden of ['configVersionId', 'recordedById', 'recordedByName', 'employeeId', 'customerNumber']) assert.equal(forbidden in payload!, false, forbidden);
  const none = { ...ready, referenceRule: 'none' as const };
  assert.equal(counterPayload(form({ direction: 'cash_out_credit_in', amount: '5', commission: '0', reference: 'typed earlier' }), none, now)!.providerReference, undefined, 'no reference for a provider that issues none');
  assert.equal(counterPayload(form({ direction: 'cash_out_credit_in', amount: '5', commission: '0', reference: '' }), ready, now)!.providerReference, undefined, 'a blank optional reference is not sent');
  assert.equal(counterPayload(form({ direction: 'cash_out_credit_in', amount: '5', commission: '0' }), ready, now)!.commissionAmount, 0);
  assert.equal(counterPayload(form({ amount: '5', commission: '0' }), ready, now), null, 'no direction, no exchange');
  assert.equal(counterPayload(form({ direction: 'cash_in_credit_out', amount: '0', commission: '0' }), ready, now), null);
  assert.equal(counterPayload(form({ direction: 'cash_in_credit_out', amount: '5', commission: '' }), ready, now), null, 'no commission typed, no exchange');
  assert.equal(counterPayload(form({ direction: 'cash_out_credit_in', amount: '5', commission: '6' }), ready, now), null, 'more than the cash handed over');
});

it('a draft kept by an earlier build comes back with the commission empty, on the form rather than the review', () => {
  const old = { clientUuid: 'key-9', direction: 'cash_in_credit_out', providerId: 'bankily', amount: '500', reference: '', reviewing: true, stampedAt: null } as unknown as CounterForm;
  assert.deepEqual(restoredForm(old), { ...old, commission: '', reviewing: false });
  const mine = form({ direction: 'cash_in_credit_out', amount: '500', commission: '5', reviewing: true });
  assert.deepEqual(restoredForm(mine), mine);
});

it('a confirmed exchange is pending until the server accepts it, then confirmed — the six states of D161, each in words', () => {
  const expected: Record<QueueState, string> = {
    draft: 'pending',
    waiting_for_connection: 'pending',
    sending: 'synchronizing',
    synced: 'confirmed',
    // An older build's item, in memory before its load: only the lookup resolves it.
    needs_attention: 'uncertain',
    uncertain: 'uncertain',
    rejected_resubmit: 'rejected_resubmit',
    rejected_reenter: 'rejected_reenter',
    cancelled: 'cancelled',
  };
  for (const [state, outcome] of Object.entries(expected)) assert.equal(exchangeOutcome(state as QueueState), outcome, state);
  // Words beside the colour, never colour alone; green only once the server agreed; a rejected one never "pending".
  assert.deepEqual(outcomeChip('pending'), { key: 'agent.pending', tone: 'info' });
  assert.deepEqual(outcomeChip('synchronizing'), { key: 'agent.pending', tone: 'info' });
  assert.deepEqual(outcomeChip('confirmed'), { key: 'agent.outcome.recorded.title', tone: 'success' });
  assert.deepEqual(outcomeChip('uncertain'), { key: 'agent.state.uncertain', tone: 'warning' });
  assert.deepEqual(outcomeChip('rejected_resubmit'), { key: 'agent.refusal.title', tone: 'warning' });
  assert.deepEqual(outcomeChip('rejected_reenter'), { key: 'agent.state.rejectedHere', tone: 'warning' });
});

it('a refused exchange is prepared again under a new key, with its words, figures and commission', () => {
  const again = againForm({ providerId: 'bankily', direction: 'cash_out_credit_in', amount: 2500.5, commissionAmount: 25, providerReference: 'R1', deviceRecordedAt: 'x' }, 'key-2');
  // Unstamped: a new key is a new request, its own claim of when taken at its own first Confirm.
  assert.deepEqual(again, { clientUuid: 'key-2', direction: 'cash_out_credit_in', providerId: 'bankily', amount: '2500.5', commission: '25', reference: 'R1', reviewing: false, stampedAt: null });
  // One an earlier build queued, with a version and no commission: back with the commission to type.
  const old = againForm({ providerId: 'bankily', direction: 'cash_in_credit_out', amount: 100, configVersionId: 'old', deviceRecordedAt: 'x' }, 'key-3');
  assert.equal(old?.commission, '');
  assert.equal(againForm({ nonsense: true }, 'k'), null);
});

console.log(`agent counter: ${passed} passed`);
