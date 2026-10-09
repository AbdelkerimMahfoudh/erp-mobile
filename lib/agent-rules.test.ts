/**
 * The counter's rules as the phone reads them (docs/73 §4–§5), on the cases of
 * the server's own spec (`erp-backend/src/agent/agent-rules.spec.ts`): the
 * commission, the legs of each configured settlement, the providers the counter
 * may choose, the customer number, and the refusals in the counter's words.
 *
 *   node lib/agent-rules.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AGENT_REFUSALS,
  agentRefusal,
  commissionOf,
  counterProviders,
  exchangeLegs,
  maskedNumber,
  parseCustomerNumber,
  percentOfBp,
  previewExchange,
  providerChoice,
  rateFor,
  referenceField,
  type AgentProvider,
  type ProviderConfig,
  type ReadyConfig,
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

/** The fixture rates of docs/73 §4.7 — INVENTED: 1.00 % both ways, settled separately, credited to the float. */
const config = (over: Partial<ProviderConfig> = {}): ProviderConfig => ({
  id: 'cfg-1',
  rateInBp: 100,
  rateOutBp: 100,
  sameRateBothDirections: true,
  commissionDestination: 'provider_float',
  principalFeeMode: 'separate',
  referenceRule: 'optional',
  effectiveFrom: '2026-10-09T08:00:00.000Z',
  recordedByName: 'Owner',
  reason: 'INVENTED fixture',
  ...over,
});
const provider = (over: Partial<AgentProvider> = {}): AgentProvider => ({
  id: 'bankily',
  kind: 'bankily',
  label: 'Bankily',
  isActive: true,
  sortOrder: 0,
  config: config(),
  readyForTransactions: true,
  missing: [],
  ...over,
});

it('a provider is chosen only when the server says it is ready and nothing required is blank', () => {
  const ready = providerChoice(provider());
  assert.equal(ready.selectable, true);
  // A blank is "Not set up yet" — never a zero, never a guess (docs/73 §1.2).
  assert.deepEqual(providerChoice(provider({ config: null, readyForTransactions: false, missing: ['rateInBp'] })), { selectable: false, reason: 'not_set_up' });
  assert.deepEqual(providerChoice(provider({ readyForTransactions: false })), { selectable: false, reason: 'not_set_up' });
  // A half-read answer that claims ready with a blank still cannot post.
  for (const blank of ['rateInBp', 'rateOutBp', 'commissionDestination', 'principalFeeMode', 'referenceRule'] as const) {
    assert.deepEqual(providerChoice(provider({ config: config({ [blank]: null }) })), { selectable: false, reason: 'not_set_up' }, blank);
  }
  assert.deepEqual(providerChoice(provider({ isActive: false })), { selectable: false, reason: 'switched_off' });
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

it('commission: the whole amount at the direction’s own rate, to the cent, never brackets', () => {
  const two = config({ rateInBp: 150, rateOutBp: 50, sameRateBothDirections: false });
  assert.equal(rateFor('cash_in_credit_out', two), 150);
  assert.equal(rateFor('cash_out_credit_in', two), 50);
  assert.equal(commissionOf(20_000, 100), 200);
  assert.equal(commissionOf(15_000, 150), 225);
  assert.equal(commissionOf(333, 150), 5); // 4.995 → 5.00
  assert.equal(commissionOf(1234.56, 75), 9.26);
  // A half cent always rounds up, whatever the amount's binary form (the server's own cases, 2026-10-09 review).
  assert.equal(commissionOf(837, 50), 4.19);
  assert.equal(commissionOf(879, 50), 4.4);
  assert.equal(commissionOf(0.5, 100), 0.01);
  assert.equal(commissionOf(999_999_999_999.99, 9_999), 999_899_999_999.99);
  assert.equal(percentOfBp(200), '2');
  assert.equal(percentOfBp(150), '1.5');
  assert.equal(percentOfBp(5), '0.05');
});

it('the legs of each settlement, as the server posts them (docs/73 §4.2–4.3)', () => {
  const base = { amount: 20_000, commission: 200, providerId: 'p' } as const;
  // Separate, to the float: principal on cash and float, commission in on the float.
  assert.deepEqual(exchangeLegs({ ...base, direction: 'cash_in_credit_out', commissionDestination: 'provider_float', principalFeeMode: 'separate' }), [
    { account: 'cash', providerId: null, direction: 'inflow', amount: 20_000, kind: 'principal' },
    { account: 'provider', providerId: 'p', direction: 'outflow', amount: 20_000, kind: 'principal' },
    { account: 'provider', providerId: 'p', direction: 'inflow', amount: 200, kind: 'commission' },
  ]);
  // Separate, in cash: the drawer gains the commission.
  assert.deepEqual(exchangeLegs({ ...base, direction: 'cash_out_credit_in', commissionDestination: 'cash', principalFeeMode: 'separate' })[2], { account: 'cash', providerId: null, direction: 'inflow', amount: 200, kind: 'commission' });
  // Held by the provider: a third account.
  assert.deepEqual(exchangeLegs({ ...base, direction: 'cash_in_credit_out', commissionDestination: 'held_separately', principalFeeMode: 'separate' })[2], { account: 'commission_held', providerId: 'p', direction: 'inflow', amount: 200, kind: 'commission' });
  // Deducted: the float leg is netted, no commission leg.
  assert.deepEqual(exchangeLegs({ ...base, direction: 'cash_in_credit_out', commissionDestination: 'provider_float', principalFeeMode: 'deducted' }), [
    { account: 'cash', providerId: null, direction: 'inflow', amount: 20_000, kind: 'principal' },
    { account: 'provider', providerId: 'p', direction: 'outflow', amount: 19_800, kind: 'principal' },
  ]);
  assert.equal(exchangeLegs({ ...base, direction: 'cash_out_credit_in', commissionDestination: 'provider_float', principalFeeMode: 'deducted' })[1].amount, 20_200);
  // A zero commission moves nothing and is not written.
  assert.equal(exchangeLegs({ ...base, commission: 0, direction: 'cash_in_credit_out', commissionDestination: 'cash', principalFeeMode: 'separate' }).length, 2);
});

it('docs/73 §4.7 event 1: receive 20 000, send Bankily credit — the float ends 200 short of the principal', () => {
  const p = previewExchange('cash_in_credit_out', 20_000, 'bankily', config() as ReadyConfig);
  assert.equal(p.commission, 200);
  assert.equal(p.rateBp, 100);
  assert.deepEqual(p.cash, { direction: 'inflow', amount: 20_000 });
  assert.deepEqual(p.float, { direction: 'outflow', amount: 20_000 });
  const floatNet = p.legs.filter((l) => l.account === 'provider').reduce((n, l) => n + (l.direction === 'inflow' ? l.amount : -l.amount), 0);
  assert.equal(50_000 + floatNet, 30_200);
  // Deducted, the same float figure by one netted leg — which is why the mode is configuration, not a guess.
  const d = previewExchange('cash_in_credit_out', 20_000, 'bankily', config({ principalFeeMode: 'deducted' }) as ReadyConfig);
  assert.deepEqual(d.float, { direction: 'outflow', amount: 19_800 });
  assert.equal(d.commission, 200);
});

it('the customer number: the payer number’s digits, mandatory, at least four digits; no country guessed', () => {
  assert.deepEqual(parseCustomerNumber(' +222 36 12-34-56 '), { ok: true, value: '+22236123456', last4: '3456' });
  assert.deepEqual(parseCustomerNumber('٣٦١٢٣٤٥٦'), { ok: true, value: '36123456', last4: '3456' });
  assert.deepEqual(parseCustomerNumber('0036'), { ok: true, value: '0036', last4: '0036' });
  assert.deepEqual(parseCustomerNumber(''), { ok: false, reason: 'missing' });
  assert.deepEqual(parseCustomerNumber('   '), { ok: false, reason: 'missing' });
  assert.deepEqual(parseCustomerNumber('123'), { ok: false, reason: 'too_short' });
  assert.deepEqual(parseCustomerNumber('+123'), { ok: false, reason: 'too_short' });
  assert.deepEqual(parseCustomerNumber('abc'), { ok: false, reason: 'invalid' });
  assert.deepEqual(parseCustomerNumber('36+12'), { ok: false, reason: 'invalid' });
  assert.deepEqual(parseCustomerNumber('1'.repeat(31)), { ok: false, reason: 'too_long' });
  assert.equal(maskedNumber('3456'), '•••• 3456');
});

it('every refusal the exchange route names has the counter’s own words and one honest action', () => {
  // The contract's needs-attention codes (D155): each maps to its own sentence.
  const expected: Record<string, string> = {
    // The key already holds a record: the list says what it is; nothing is confirmed as new (review).
    idempotency_conflict: 'check_list',
    stale_configuration: 'prepare_again',
    provider_not_configured: 'prepare_again',
    customer_number_invalid: 'prepare_again',
    reference_required: 'prepare_again',
    store_closed: 'retry',
    activity_not_subscribed: 'retry',
    ENTITLEMENT_WRITE_BLOCKED: 'retry',
  };
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
