/**
 * The counter flow's states (docs/73 §5.2, D155): direction, provider,
 * details, review; what stops the review; what the queue is given at Confirm;
 * where a confirmed exchange stands; a refused one prepared again.
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
  formProblems,
  type CounterForm,
} from './agent-counter.ts';
import type { AgentProvider, ReadyConfig } from './agent-rules.ts';
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

const config: ReadyConfig = {
  id: 'cfg-7',
  rateInBp: 200,
  rateOutBp: 200,
  sameRateBothDirections: true,
  commissionDestination: 'provider_float',
  principalFeeMode: 'separate',
  referenceRule: 'optional',
  effectiveFrom: '2026-10-09T11:11:02.585Z',
  recordedByName: 'Owner',
  reason: 'INVENTED fixture',
};
const ready = { id: 'bankily', kind: 'bankily', label: 'Bankily', isActive: true, sortOrder: 0, config, readyForTransactions: true, missing: [] } as AgentProvider & { config: ReadyConfig };
const blank: AgentProvider = { ...ready, id: 'blank', label: 'Blank Co', config: null, readyForTransactions: false, missing: ['rateInBp'] };
const form = (over: Partial<CounterForm> = {}): CounterForm => ({ ...emptyCounterForm('key-1'), ...over });

it('the flow asks for the direction first, then a provider that is set up, then the details, then the review', () => {
  assert.equal(counterStep(form(), null), 'direction');
  assert.equal(counterStep(form({ direction: 'cash_in_credit_out' }), null), 'provider');
  assert.equal(counterStep(form({ direction: 'cash_in_credit_out', providerId: 'blank' }), blank), 'provider', 'a provider not set up cannot be chosen');
  assert.equal(counterStep(form({ direction: 'cash_in_credit_out', providerId: 'bankily' }), ready), 'details');
  assert.equal(counterStep(form({ direction: 'cash_in_credit_out', providerId: 'bankily', reviewing: true }), ready), 'review');
});

it('the review waits for an amount above zero, a number the server takes, and a required reference', () => {
  const ok = formProblems({ amount: '10000', reference: '' }, '36 12 34 56', config);
  assert.deepEqual(ok, {});
  assert.equal(canReview(ok), true);
  assert.equal(formProblems({ amount: '', reference: '' }, '36123456', config).amount, 'empty');
  assert.equal(formProblems({ amount: '0', reference: '' }, '36123456', config).amount, 'zero');
  assert.equal(formProblems({ amount: '10.123', reference: '' }, '36123456', config).amount, 'too_precise');
  assert.equal(formProblems({ amount: '100', reference: '' }, '', config).number, 'missing');
  assert.equal(formProblems({ amount: '100', reference: '' }, '12', config).number, 'too_short');
  assert.equal(formProblems({ amount: '100', reference: '' }, '36-AB', config).number, 'invalid');
  const required = { ...config, referenceRule: 'required' as const };
  assert.equal(formProblems({ amount: '100', reference: '  ' }, '36123456', required).reference, 'required');
  assert.deepEqual(formProblems({ amount: '100', reference: 'TX-1' }, '36123456', required), {});
  assert.equal(formProblems({ amount: '100', reference: 'x'.repeat(121) }, '36123456', config).reference, 'too_long');
  // A provider that issues no reference never asks for one, whatever was typed before.
  assert.deepEqual(formProblems({ amount: '100', reference: 'x'.repeat(500) }, '36123456', { referenceRule: 'none' }), {});
  assert.equal(canReview({ amount: 'zero' }), false);
});

it('Confirm gives the queue the version the review showed and the phone’s clock — never the number, never a person', () => {
  const now = new Date('2026-10-09T10:00:00.000Z');
  const payload = counterPayload(form({ direction: 'cash_in_credit_out', providerId: 'bankily', amount: '10000', reference: '  REF-9 ' }), ready, now);
  assert.deepEqual(payload, {
    providerId: 'bankily',
    direction: 'cash_in_credit_out',
    amount: 10_000,
    providerReference: 'REF-9',
    configVersionId: 'cfg-7',
    deviceRecordedAt: '2026-10-09T10:00:00.000Z',
  });
  const none = { ...ready, config: { ...config, referenceRule: 'none' as const } };
  assert.equal(counterPayload(form({ direction: 'cash_out_credit_in', amount: '5', reference: 'typed earlier' }), none, now)!.providerReference, undefined, 'no reference for a provider that issues none');
  assert.equal(counterPayload(form({ direction: 'cash_out_credit_in', amount: '5', reference: '' }), ready, now)!.providerReference, undefined, 'a blank optional reference is not sent');
  assert.equal(counterPayload(form({ amount: '5' }), ready, now), null, 'no direction, no exchange');
  assert.equal(counterPayload(form({ direction: 'cash_in_credit_out', amount: '0' }), ready, now), null);
});

it('a confirmed exchange is pending until the server accepts it, then recorded — never in between', () => {
  const expected: Record<QueueState, string> = {
    draft: 'pending',
    waiting_for_connection: 'pending',
    sending: 'pending',
    synced: 'recorded',
    needs_attention: 'attention',
    cancelled: 'cancelled',
  };
  for (const [state, outcome] of Object.entries(expected)) assert.equal(exchangeOutcome(state as QueueState), outcome, state);
});

it('a refused exchange is prepared again under a new key, with its words and figures', () => {
  const again = againForm({ providerId: 'bankily', direction: 'cash_out_credit_in', amount: 2500.5, providerReference: 'R1', configVersionId: 'old', deviceRecordedAt: 'x' }, 'key-2');
  assert.deepEqual(again, { clientUuid: 'key-2', direction: 'cash_out_credit_in', providerId: 'bankily', amount: '2500.5', reference: 'R1', reviewing: false });
  assert.equal(againForm({ nonsense: true }, 'k'), null);
});

console.log(`agent counter: ${passed} passed`);
