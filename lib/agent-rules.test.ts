/**
 * The counter's rules as the phone reads them (docs/73 §4–§5, D164), on the
 * cases of the server's own spec (`erp-backend/src/agent/agent-rules.spec.ts`):
 * the commission the employee types, the legs, the review, the providers the
 * counter may choose, the customer number, and the refusals in the counter's words.
 *
 *   node lib/agent-rules.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AGENT_REFUSALS,
  agentRefusal,
  commissionRefusal,
  counterProviders,
  exchangeLegs,
  maskCommission,
  maskedNumber,
  parseCommission,
  parseCustomerNumber,
  percentOfBp,
  previewExchange,
  providerChoice,
  providerOf,
  referenceField,
  type AgentProvider,
} from './agent-rules.ts';

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

const provider = (over: Partial<AgentProvider> = {}): AgentProvider => ({
  id: 'bankily',
  kind: 'bankily',
  label: 'Bankily',
  isActive: true,
  sortOrder: 0,
  referenceRule: 'optional',
  config: null,
  ...over,
});

it('any provider switched on can be chosen: nothing is configured before it is used (D164)', () => {
  assert.deepEqual(providerChoice(provider()), { selectable: true, referenceRule: 'optional' });
  assert.deepEqual(providerChoice(provider({ referenceRule: 'required' })), { selectable: true, referenceRule: 'required' });
  assert.deepEqual(providerChoice(provider({ isActive: false })), { selectable: false, reason: 'switched_off' });
});

it('a provider kept by an earlier build reads in this build’s shape: its rates become history, never a price', () => {
  const old = {
    id: 'b',
    kind: 'bankily',
    label: 'Bankily',
    isActive: true,
    sortOrder: 2,
    readyForTransactions: true,
    missing: [],
    config: { id: 'cfg-1', rateInBp: 100, rateOutBp: 100, sameRateBothDirections: true, commissionDestination: 'provider_float', principalFeeMode: 'separate', referenceRule: 'required', effectiveFrom: '2026-10-09T08:00:00.000Z', recordedByName: 'Owner', reason: 'INVENTED' },
  };
  const read = providerOf(old)!;
  assert.equal(read.referenceRule, 'required');
  assert.deepEqual(read.config?.legacy, { rateInBp: 100, rateOutBp: 100, sameRateBothDirections: true, commissionDestination: 'provider_float', principalFeeMode: 'separate' });
  assert.equal('readyForTransactions' in read, false);
  // The server's own shape passes through; no version is the server's default rule.
  assert.deepEqual(providerOf({ id: 's', kind: 'sedad', label: 'Sedad', isActive: false, sortOrder: 0, referenceRule: 'none', config: null }), {
    id: 's',
    kind: 'sedad',
    label: 'Sedad',
    isActive: false,
    sortOrder: 0,
    referenceRule: 'none',
    config: null,
  });
  assert.equal(providerOf({ id: 'x', label: 'X', isActive: true })?.referenceRule, 'optional');
  assert.equal(providerOf({ label: 'no id' }), null);
  assert.equal(providerOf('nonsense'), null);
});

it('the counter lists the active providers in the Owner’s order, then by name', () => {
  const list = counterProviders([
    provider({ id: 'z', label: 'Sedad', sortOrder: 1 }),
    provider({ id: 'off', label: 'Moov', isActive: false }),
    provider({ id: 'b', label: 'Bankily', sortOrder: 0 }),
    provider({ id: 'a', label: 'Amanty', sortOrder: 0 }),
  ]);
  assert.deepEqual(list.map((p) => p.id), ['a', 'b', 'z']);
});

it('the reference is asked for, offered, or not shown, by the provider’s rule', () => {
  assert.equal(referenceField('required'), 'required');
  assert.equal(referenceField('optional'), 'optional');
  assert.equal(referenceField('none'), 'hidden');
});

it('the commission is typed: whole MRU, an empty field is empty — never zero — and 0 is typed for none (D164)', () => {
  assert.deepEqual(parseCommission('200'), { ok: true, value: 200 });
  assert.deepEqual(parseCommission(' ٢٠٠ '), { ok: true, value: 200 });
  assert.deepEqual(parseCommission('0'), { ok: true, value: 0 });
  assert.deepEqual(parseCommission('150.00'), { ok: true, value: 150 });
  assert.deepEqual(parseCommission(''), { ok: false, reason: 'empty' });
  assert.deepEqual(parseCommission('   '), { ok: false, reason: 'empty' });
  assert.deepEqual(parseCommission('12.5'), { ok: false, reason: 'not_whole' });
  assert.deepEqual(parseCommission('-5'), { ok: false, reason: 'negative' });
  assert.deepEqual(parseCommission('abc'), { ok: false, reason: 'not_a_number' });
  assert.equal(maskCommission('1a2-3.4'), '1234');
  assert.equal(maskCommission('٣٥'), '35');
});

it('the server’s own check of the commission, word for word', () => {
  for (const absent of [undefined, null, '']) assert.equal(commissionRefusal('cash_in_credit_out', 1_000, absent), 'commission_required');
  assert.equal(commissionRefusal('cash_in_credit_out', 1_000, 0), null);
  for (const bad of [-1, 12.5, '30', Number.NaN]) assert.equal(commissionRefusal('cash_in_credit_out', 1_000, bad), 'commission_invalid', String(bad));
  assert.equal(commissionRefusal('cash_out_credit_in', 1_000, 1_001), 'commission_exceeds_amount');
  assert.equal(commissionRefusal('cash_out_credit_in', 1_000, 1_000), null);
  // Receiving cash, the customer pays it on top: no ceiling.
  assert.equal(commissionRefusal('cash_in_credit_out', 1_000, 1_500), null);
});

it('the legs, as the server posts them (D164): the credit moves by the amount only; the commission is cash in', () => {
  const base = { amount: 20_000, commission: 200, providerId: 'p' } as const;
  assert.deepEqual(exchangeLegs({ ...base, direction: 'cash_in_credit_out' }), [
    { account: 'cash', providerId: null, direction: 'inflow', amount: 20_000, kind: 'principal' },
    { account: 'provider', providerId: 'p', direction: 'outflow', amount: 20_000, kind: 'principal' },
    { account: 'cash', providerId: null, direction: 'inflow', amount: 200, kind: 'commission' },
  ]);
  assert.deepEqual(exchangeLegs({ ...base, direction: 'cash_out_credit_in' }), [
    { account: 'cash', providerId: null, direction: 'outflow', amount: 20_000, kind: 'principal' },
    { account: 'provider', providerId: 'p', direction: 'inflow', amount: 20_000, kind: 'principal' },
    { account: 'cash', providerId: null, direction: 'inflow', amount: 200, kind: 'commission' },
  ]);
  // A zero commission moves nothing and is not written.
  assert.equal(exchangeLegs({ ...base, commission: 0, direction: 'cash_in_credit_out' }).length, 2);
});

it('the review: receive 20 000 with 200 commission — the customer hands over 20 200, the credit sent is 20 000', () => {
  const p = previewExchange('cash_in_credit_out', 20_000, 200, 'bankily');
  assert.equal(p.amount, 20_000);
  assert.equal(p.commission, 200);
  assert.deepEqual(p.cash, { direction: 'inflow', amount: 20_200 });
  assert.deepEqual(p.credit, { direction: 'outflow', amount: 20_000 });
  const floatNet = p.legs.filter((l) => l.account === 'provider').reduce((n, l) => n + (l.direction === 'inflow' ? l.amount : -l.amount), 0);
  assert.equal(50_000 + floatNet, 30_000);
  // Giving cash: the credit received is the amount; the customer is handed the amount less the commission.
  const out = previewExchange('cash_out_credit_in', 15_000, 150, 'sedad');
  assert.deepEqual(out.cash, { direction: 'outflow', amount: 14_850 });
  assert.deepEqual(out.credit, { direction: 'inflow', amount: 15_000 });
  const drawerNet = out.legs.filter((l) => l.account === 'cash').reduce((n, l) => n + (l.direction === 'inflow' ? l.amount : -l.amount), 0);
  assert.equal(drawerNet, -14_850);
  // A rate is said only for a legacy exchange's history.
  assert.equal(percentOfBp(150), '1.5');
});

it('the customer number: a Mauritanian number, exactly eight digits, mandatory, no + (D162)', () => {
  assert.deepEqual(parseCustomerNumber(' 36 12-34-56 '), { ok: true, value: '36123456', last4: '3456' });
  assert.deepEqual(parseCustomerNumber('٣٦١٢٣٤٥٦'), { ok: true, value: '36123456', last4: '3456' });
  assert.deepEqual(parseCustomerNumber('00000036'), { ok: true, value: '00000036', last4: '0036' });
  assert.deepEqual(parseCustomerNumber(''), { ok: false, reason: 'missing' });
  assert.deepEqual(parseCustomerNumber('   '), { ok: false, reason: 'missing' });
  assert.deepEqual(parseCustomerNumber('3612345'), { ok: false, reason: 'too_short' }, 'seven digits');
  assert.deepEqual(parseCustomerNumber('361234567'), { ok: false, reason: 'too_long' }, 'nine digits');
  assert.deepEqual(parseCustomerNumber('+36123456'), { ok: false, reason: 'invalid' });
  assert.deepEqual(parseCustomerNumber('+222 36 12 34 56'), { ok: false, reason: 'invalid' });
  assert.deepEqual(parseCustomerNumber('abc'), { ok: false, reason: 'invalid' });
  assert.deepEqual(parseCustomerNumber('36+12345'), { ok: false, reason: 'invalid' });
  assert.deepEqual(parseCustomerNumber('1'.repeat(31)), { ok: false, reason: 'too_long' });
  assert.equal(maskedNumber('3456'), '•••• 3456');
});

it('every refusal the exchange route names has the counter’s own words and one honest action', () => {
  // The contract's needs-attention codes (D155): each maps to its own sentence.
  // The D161 table: what fixes each refusal — sent again unchanged, reviewed, edited, or entered by someone else.
  const expected: Record<string, string> = {
    idempotency_conflict: 'reenter',
    conflict: 'review_and_send',
    customer_number_invalid: 'edit_and_send',
    reference_required: 'edit_and_send',
    commission_required: 'edit_and_send',
    commission_invalid: 'edit_and_send',
    commission_exceeds_amount: 'edit_and_send',
    validation: 'edit_and_send',
    customer_number_missing: 'edit_and_send',
    provider_inactive: 'send_again',
    store_closed: 'send_again',
    ENTITLEMENT_WRITE_BLOCKED: 'send_again',
    activity_not_subscribed: 'reenter',
    permission_denied: 'reenter',
    branch_access_denied: 'reenter',
    branch_inactive: 'reenter',
    already_reversed: 'cancel',
  };
  assert.deepEqual(Object.keys(AGENT_REFUSALS).sort(), Object.keys(expected).sort(), 'every refusal has its row');
  // Raised before the server reads the key: these alone prove nothing about an exchange that may be recorded.
  assert.deepEqual(
    Object.entries(AGENT_REFUSALS).filter(([, r]) => r.beforeKey).map(([code]) => code).sort(),
    ['ENTITLEMENT_WRITE_BLOCKED', 'activity_not_subscribed', 'branch_access_denied', 'branch_inactive', 'permission_denied'],
  );
  for (const [code, action] of Object.entries(expected)) {
    assert.equal(agentRefusal(code)?.action, action, code);
    assert.match(agentRefusal(code)!.key, /^agent\.refusal\./);
  }
  assert.equal(agentRefusal('something_else'), null);
  assert.equal(agentRefusal(undefined), null);
  // Every key exists in all three catalogues, with the same placeholders.
  for (const lang of ['en', 'fr', 'ar']) {
    const src = readFileSync(new URL(`./i18n/${lang}.ts`, import.meta.url), 'utf8');
    for (const refusal of Object.values(AGENT_REFUSALS)) assert.ok(src.includes(`'${refusal.key}':`), `${lang}: ${refusal.key}`);
  }
});

console.log(`agent rules: ${passed} passed`);
