/**
 * The one queueable money record (D155), pinned: the customer's number never
 * reaches the queue file or a draft, it is sealed to the scope it was typed in,
 * the summary never carries it, one exchange never holds another back, and the
 * figures that include a queued exchange are the server's plus its legs.
 *
 *   node lib/offline/agent-exchange.test.ts
 */
import assert from 'node:assert/strict';
import {
  AGENT_EXCHANGE_KIND,
  confirmationOf,
  containsPersonalNumber,
  exchangeBody,
  exchangeSummary,
  isExchangePayload,
  legKey,
  numberKey,
  openNumber,
  pendingExchanges,
  provisionalNet,
  queuedLegs,
  sealNumber,
  type ExchangePayload,
} from './agent-exchange.ts';
import { isQueueItem } from './queue-schema.ts';
import { isWritable } from './draft-schema.ts';
import { classify, mayQueue, specFor, DRAFTABLE_FORMS } from './policy.ts';
import { dependencyGroup, nextSendable, type QueueItem } from './queue-rules.ts';
import type { AgentProvider } from '../agent-rules.ts';

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

const scope = { companyId: 'c1', branchId: 'b1', userId: 'u1' };
const NUMBER = '+22236123456';
const payload: ExchangePayload = {
  providerId: 'bankily',
  direction: 'cash_in_credit_out',
  amount: 20_000,
  configVersionId: 'cfg-1',
  deviceRecordedAt: '2026-10-09T10:00:00.000Z',
};
const item = (over: Partial<QueueItem> = {}): QueueItem => ({
  id: 'i1',
  kind: AGENT_EXCHANGE_KIND,
  clientUuid: '11111111-1111-4111-8111-111111111111',
  companyId: 'c1',
  branchId: 'b1',
  userId: 'u1',
  payloadVersion: 1,
  payload,
  state: 'waiting_for_connection',
  createdAt: 1,
  lastAttemptAt: null,
  attempts: 0,
  summary: 'Cash in, credit out · 20 000 MRU · Bankily',
  lastError: null,
  ...over,
});
const providers: AgentProvider[] = [
  {
    id: 'bankily',
    kind: 'bankily',
    label: 'Bankily',
    isActive: true,
    sortOrder: 0,
    readyForTransactions: true,
    missing: [],
    config: { id: 'cfg-1', rateInBp: 100, rateOutBp: 100, sameRateBothDirections: true, commissionDestination: 'provider_float', principalFeeMode: 'separate', referenceRule: 'optional', effectiveFrom: '', recordedByName: null, reason: null },
  },
];

// ── The policy ─────────────────────────────────────────────────────────────

it('the exchange is queueable, with the D155 reason and proven idempotency; its draft becomes it', () => {
  assert.equal(classify(AGENT_EXCHANGE_KIND), 'queueable');
  assert.equal(mayQueue(AGENT_EXCHANGE_KIND), true);
  assert.equal(specFor(AGENT_EXCHANGE_KIND)!.idempotency, 'client_uuid_with_fingerprint');
  assert.match(specFor(AGENT_EXCHANGE_KIND)!.why, /already happened/);
  assert.ok(DRAFTABLE_FORMS.some((d) => d.form === 'agent.exchange' && d.becomes === AGENT_EXCHANGE_KIND));
});

// ── The number, kept apart ─────────────────────────────────────────────────

it('the number is sealed to its company, branch and person, and opens for nobody else', () => {
  const sealed = sealNumber(scope, NUMBER);
  assert.ok(sealed.length < 2048, 'well under SecureStore’s 2 KB per value');
  assert.equal(openNumber(sealed, scope), NUMBER);
  assert.equal(openNumber(sealed, { ...scope, companyId: 'c2' }), null, 'another company');
  assert.equal(openNumber(sealed, { ...scope, branchId: 'b2' }), null, 'another branch');
  assert.equal(openNumber(sealed, { ...scope, userId: 'u2' }), null, 'another person on the same phone');
  assert.equal(openNumber(null, scope), null);
  assert.equal(openNumber('not json', scope), null);
  assert.equal(openNumber(JSON.stringify({ ...scope, customerNumber: '' }), scope), null);
});

it('the SecureStore key is the exchange’s own key, in the characters SecureStore takes', () => {
  assert.equal(numberKey('11111111-1111-4111-8111-111111111111'), 'agent.exchange.number.11111111-1111-4111-8111-111111111111');
  assert.match(numberKey('../../etc/passwd x'), /^agent\.exchange\.number\.[a-zA-Z0-9-]*$/);
});

it('a payload, a queue item or a draft that holds a customer number is refused, however deep', () => {
  assert.equal(containsPersonalNumber({ customerNumber: NUMBER }), true);
  assert.equal(containsPersonalNumber({ a: { b: [{ customer_number: NUMBER }] } }), true);
  assert.equal(containsPersonalNumber(payload), false);
  assert.equal(isExchangePayload(payload), true);
  assert.equal(isExchangePayload({ ...payload, customerNumber: NUMBER }), false);
  // The queue file and the draft file refuse it at their own gates.
  assert.equal(isQueueItem(item()), true);
  assert.equal(isQueueItem(item({ payload: { ...payload, customerNumber: NUMBER } })), false);
  assert.deepEqual(isWritable({ direction: 'cash_in_credit_out', customerNumber: NUMBER }), { ok: false, reason: 'forbidden_field' });
});

it('the number is joined only in the body that is sent', () => {
  const body = exchangeBody(payload, NUMBER);
  assert.equal(body.customerNumber, NUMBER);
  assert.equal((payload as unknown as Record<string, unknown>).customerNumber, undefined, 'the stored payload is untouched');
  // Nothing about the person recording it: the server takes that from the session (A6).
  for (const forbidden of ['employeeId', 'userId', 'recordedBy', 'recordedById']) assert.ok(!(forbidden in body), forbidden);
});

it('the summary names the direction, the amount and the provider — never the number', () => {
  const summary = exchangeSummary({ direction: 'Cash in, credit out', amount: '20 000 MRU', provider: 'Bankily' });
  assert.equal(summary, 'Cash in, credit out · 20 000 MRU · Bankily');
  assert.ok(!summary.includes('3456') && !summary.includes(NUMBER));
  assert.equal(exchangeSummary.length, 1, 'one argument: the three words, nothing else');
});

// ── Sending ────────────────────────────────────────────────────────────────

it('each exchange is its own subject: one needing a person never holds the next customer’s back', () => {
  const a = item({ id: 'a', clientUuid: 'aaaa', state: 'needs_attention', createdAt: 1 });
  const b = item({ id: 'b', clientUuid: 'bbbb', createdAt: 2 });
  const c = item({ id: 'c', clientUuid: 'cccc', createdAt: 3 });
  assert.notEqual(dependencyGroup(a), dependencyGroup(b));
  assert.deepEqual(nextSendable([a, b, c], scope, 10).map((i) => i.id), ['b', 'c']);
  // And never under another session.
  assert.deepEqual(nextSendable([b], { ...scope, userId: 'u2' }, 10), []);
});

it('the server’s answer is kept as the server said it: its id, instant, business day, name and commission', () => {
  const answer = { id: 't1', recordedAt: '2026-10-09T11:11:02.660Z', businessDate: '2026-10-09', recordedBy: { id: 'x', name: 'Employee Boutique 2' }, commission: { amount: 200 }, customerNumberMasked: '•••• 3456' };
  assert.deepEqual(confirmationOf(answer), { id: 't1', recordedAt: '2026-10-09T11:11:02.660Z', businessDate: '2026-10-09', recordedByName: 'Employee Boutique 2', commission: 200 });
  assert.equal(confirmationOf(null), null);
  assert.equal(confirmationOf({ id: 't1' }), null, 'no server time, no confirmation');
  assert.ok(!JSON.stringify(confirmationOf(answer)).includes('3456'), 'not even the masked number is kept');
});

// ── Provisional figures ────────────────────────────────────────────────────

it('the branch’s pending exchanges are the ones not yet accepted, oldest first, of this branch only', () => {
  const items = [
    item({ id: 'x', createdAt: 5 }),
    item({ id: 'y', createdAt: 2, state: 'sending' }),
    item({ id: 'z', createdAt: 3, state: 'synced' }),
    item({ id: 'w', createdAt: 4, state: 'cancelled' }),
    item({ id: 'v', createdAt: 1, branchId: 'b2' }),
    item({ id: 'u', createdAt: 0, kind: 'expense.submit' }),
    item({ id: 'n', createdAt: 6, state: 'needs_attention' }),
  ];
  assert.deepEqual(pendingExchanges(items, 'b1').map((i) => i.id), ['y', 'x', 'n']);
});

it('a queued exchange moves the drawer and the float by its legs; a rate the phone no longer sees adds no commission', () => {
  assert.deepEqual(queuedLegs(payload, providers).map((l) => [legKey(l), l.direction, l.amount]), [
    ['cash', 'inflow', 20_000],
    ['provider:bankily', 'outflow', 20_000],
    ['provider:bankily', 'inflow', 200],
  ]);
  const stale = queuedLegs({ ...payload, configVersionId: 'cfg-0' }, providers);
  assert.deepEqual(stale.map((l) => [legKey(l), l.direction, l.amount]), [
    ['cash', 'inflow', 20_000],
    ['provider:bankily', 'outflow', 20_000],
  ]);
});

it('provisional = the net of the exchanges still to be sent; a refused one moves nothing until it is sent again', () => {
  const net = provisionalNet(
    [
      item({ id: 'a', clientUuid: 'a' }),
      item({ id: 'b', clientUuid: 'b', payload: { ...payload, direction: 'cash_out_credit_in', amount: 5_000 } }),
      item({ id: 'c', clientUuid: 'c', state: 'needs_attention' }),
      item({ id: 'd', clientUuid: 'd', state: 'synced' }),
    ],
    'b1',
    providers,
  );
  // Cash: +20 000 − 5 000. Bankily: −20 000 + 200 + 5 000 + 50.
  assert.deepEqual(net, { cash: 15_000, 'provider:bankily': -14_750 });
  assert.deepEqual(provisionalNet([], 'b1', providers), {});
});

console.log(`agent exchange queue: ${passed} passed`);
