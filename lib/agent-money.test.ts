/**
 * The counter's money outside the exchanges (docs/73 §4.3–4.5, §5.3; D155):
 * which floats the Owner sets, the rebalancing form's balance rule and the one
 * body it sends, the refusal of a negative position read back, and the
 * closing's floats — outstanding, counted or skipped, a difference in words —
 * with the phone refusing to start the closing while it holds exchanges.
 *
 *   node lib/agent-money.test.ts
 */
import assert from 'node:assert/strict';
import {
  accountKeyOf,
  accountOfKey,
  asksExplanation,
  differenceKind,
  exchangesHeld,
  floatCountCheck,
  floatCountState,
  floatsOutstanding,
  floatTargets,
  negativeProblems,
  rebalancingAccounts,
  rebalancingBalance,
  rebalancingCheck,
  startingLines,
  withAmount,
  type RebalancingLine,
} from './agent-money.ts';
import type { QueueItem } from './offline/queue-rules.ts';

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

const float = (providerId: string, label: string, position: number | null, accountKind: 'provider' | 'commission_held' = 'provider') => ({
  providerId,
  providerLabel: label,
  accountKind,
  known: position !== null,
  position,
});

it('the Owner sets each float and each held commission of the branch — never the drawer, never a guessed figure', () => {
  const targets = floatTargets({ floats: [float('b', 'Bankily', 12490), float('m', 'Masrvi', null)], commissionHeld: [float('v', 'Moov', null, 'commission_held')] });
  assert.deepEqual(
    targets.map((t) => [t.key, t.label, t.known, t.position]),
    [
      ['provider:b', 'Bankily', true, 12490],
      ['provider:m', 'Masrvi', false, null],
      ['commission_held:v', 'Moov', false, null],
    ],
  );
  assert.ok(!targets.some((t) => t.key === 'cash'), 'the drawer is the opening’s and the closing’s, not a float');
});

let n = 0;
const id = () => `l${++n}`;
const line = (over: Partial<RebalancingLine>): RebalancingLine => ({ id: id(), account: 'cash', providerId: null, direction: 'outflow', amount: '', ...over });

it('the form opens on buying float with cash: cash out, the first float in, amounts empty', () => {
  const lines = startingLines('bankily', id);
  assert.deepEqual(
    lines.map((l) => [l.account, l.providerId, l.direction, l.amount]),
    [
      ['cash', null, 'outflow', ''],
      ['provider', 'bankily', 'inflow', ''],
    ],
  );
  assert.equal(startingLines(null, id).length, 1, 'no provider yet: the drawer alone');
});

it('a rebalancing moves the drawer, the floats and the held commissions of the branch — never the outside as a line', () => {
  const providers = [
    { id: 'b', label: 'Bankily', isActive: true, config: { commissionDestination: 'provider_float' } },
    { id: 'v', label: 'Moov', isActive: true, config: { commissionDestination: 'held_separately' } },
    { id: 'x', label: 'Blank Co', isActive: true, config: null },
    { id: 'o', label: 'Old', isActive: false, config: { commissionDestination: 'held_separately' } },
  ];
  const positions = { floats: [{ providerId: 'b', providerLabel: 'Bankily' }, { providerId: 'o', providerLabel: 'Old' }], commissionHeld: [{ providerId: 'o', providerLabel: 'Old' }] };
  assert.deepEqual(
    rebalancingAccounts(providers, positions).map((c) => c.key),
    ['cash', 'provider:b', 'provider:v', 'provider:x', 'provider:o', 'commission_held:v', 'commission_held:o'],
    'a switched-off provider’s float stays movable while it holds money',
  );
  assert.deepEqual(rebalancingAccounts([], null).map((c) => c.key), ['cash']);
});

it('an account is one value, the positions’ own key, and back', () => {
  assert.equal(accountKeyOf({ account: 'cash', providerId: null }), 'cash');
  assert.equal(accountKeyOf({ account: 'commission_held', providerId: 'v' }), 'commission_held:v');
  assert.deepEqual(accountOfKey('provider:b'), { account: 'provider', providerId: 'b' });
  assert.deepEqual(accountOfKey('cash'), { account: 'cash', providerId: null });
  assert.equal(accountOfKey('external:x'), null, 'the outside is never a line: it is named for the difference');
  assert.equal(accountOfKey('provider:'), null);
});

it('a move from one account to another is typed once: the other line follows until typed by hand', () => {
  const lines = startingLines('b', id);
  const [a, b] = lines;
  const once = withAmount(lines, a.id, '5000', new Set());
  assert.deepEqual(once.map((l) => l.amount), ['5000', '5000']);
  const own = withAmount(once, a.id, '6000', new Set([b.id]));
  assert.deepEqual(own.map((l) => l.amount), ['6000', '5000'], 'a line typed by hand is never overwritten');
  const three = withAmount([...lines, line({ direction: 'inflow' })], a.id, '10', new Set());
  assert.deepEqual(three.map((l) => l.amount), ['10', '', ''], 'three lines: each its own amount');
  const same = withAmount([line({}), line({})], 'l-none', '10', new Set());
  assert.deepEqual(same.map((l) => l.amount), ['', ''], 'an unknown line changes nothing');
});

it('the balance is in − out, from the amounts that parse; incomplete until every line has one above zero', () => {
  assert.deepEqual(rebalancingBalance([line({ direction: 'outflow', amount: '10000' }), line({ direction: 'inflow', amount: '10000' })]), { inflows: 10000, outflows: 10000, net: 0, complete: true });
  assert.deepEqual(rebalancingBalance([line({ direction: 'inflow', amount: '50000' })]), { inflows: 50000, outflows: 0, net: 50000, complete: true });
  assert.equal(rebalancingBalance([line({ amount: '0' })]).complete, false, 'a line of zero moves nothing');
  assert.equal(rebalancingBalance([line({ amount: '1.005' })]).complete, false, 'at most two decimals');
  assert.equal(rebalancingBalance([]).complete, false);
  assert.equal(rebalancingBalance([line({ direction: 'inflow', amount: '0.1' }), line({ direction: 'inflow', amount: '0.2' }), line({ direction: 'outflow', amount: '0.3' })]).net, 0, 'cents add up exactly');
});

it('balanced lines send no outside party, even one chosen earlier', () => {
  const check = rebalancingCheck({
    reason: '  bought float with cash ',
    note: '',
    lines: [line({ account: 'cash', direction: 'outflow', amount: '5000' }), line({ account: 'provider', providerId: 'b', direction: 'inflow', amount: '5 000' })],
    external: 'owner_capital',
  });
  assert.ok(check.ok);
  assert.deepEqual(check.body, {
    reason: 'bought float with cash',
    legs: [
      { account: 'cash', direction: 'outflow', amount: 5000 },
      { account: 'provider', providerId: 'b', direction: 'inflow', amount: 5000 },
    ],
  });
});

it('unbalanced lines need the outside named — and its amount is the lines’ own difference, never typed', () => {
  const lines = [line({ account: 'cash', direction: 'inflow', amount: '50000' })];
  const refused = rebalancingCheck({ reason: 'Owner brings cash', note: '', lines, external: null });
  assert.ok(!refused.ok);
  assert.deepEqual(refused.problems, ['outside_needed']);
  assert.equal(refused.balance.net, 50000);
  const brought = rebalancingCheck({ reason: 'Owner brings cash', note: 'for tomorrow', lines, external: 'owner_capital' });
  assert.ok(brought.ok);
  assert.equal(brought.body.externalCounterparty, 'owner_capital');
  assert.equal(brought.body.externalAmount, 50000, 'positive: the money came in from outside');
  assert.equal(brought.body.note, 'for tomorrow');
  const sent = rebalancingCheck({ reason: 'paid the provider', note: '', lines: [line({ account: 'provider', providerId: 'b', direction: 'outflow', amount: '2000' })], external: 'provider_settlement' });
  assert.ok(sent.ok);
  assert.equal(sent.body.externalAmount, -2000, 'negative: the money went out');
});

it('every reason the form cannot be sent is said, together', () => {
  const check = rebalancingCheck({ reason: ' ', note: 'x'.repeat(501), lines: [line({ account: 'provider', providerId: null, amount: 'abc' })], external: null });
  assert.ok(!check.ok);
  assert.deepEqual(check.problems, ['reason_missing', 'note_too_long', 'amount_invalid', 'provider_missing']);
  const none = rebalancingCheck({ reason: 'x', note: '', lines: [], external: null });
  assert.ok(!none.ok);
  assert.deepEqual(none.problems, ['no_lines']);
  const long = rebalancingCheck({ reason: 'x'.repeat(256), note: '', lines: [line({ amount: '1' }), line({ direction: 'inflow', amount: '1' })], external: null });
  assert.ok(!long.ok);
  assert.deepEqual(long.problems, ['reason_too_long']);
});

it('a negative refusal is read back by account, and nothing else is', () => {
  const body = { code: 'rebalancing_negative', problems: [{ account: 'cash', providerId: null, position: 35000, after: -65000 }, { account: 'provider', providerId: 'b', position: 10, after: -90 }, { account: 'x', after: 1 }] };
  assert.deepEqual(negativeProblems(body), [
    { account: 'cash', providerId: null, after: -65000 },
    { account: 'provider', providerId: 'b', after: -90 },
  ]);
  assert.deepEqual(negativeProblems({ code: 'store_closed' }), []);
  assert.deepEqual(negativeProblems(null), []);
});

const fc = (providerId: string, counted: number | null, isSkipped = false, expected: number | null = 100) => ({
  providerId,
  label: providerId,
  expected,
  counted,
  difference: counted !== null && expected !== null ? counted - expected : null,
  isSkipped,
});

it('a lock waits for every float neither counted nor skipped; zero counted is a count', () => {
  const floats = [fc('b', 15000), fc('s', null, true), fc('m', null), fc('z', 0)];
  assert.deepEqual(floatsOutstanding(floats).map((f) => f.providerId), ['m']);
  assert.deepEqual(floats.map(floatCountState), ['counted', 'skipped', 'not_counted', 'counted']);
});

it('a difference is said in words: short, over, none — and nothing against an unknown float', () => {
  assert.equal(differenceKind(-100), 'short');
  assert.equal(differenceKind(50), 'over');
  assert.equal(differenceKind(0), 'none');
  assert.equal(differenceKind(null), null);
});

it('a float is counted (zero included) or skipped with a reason — never both, never a negative', () => {
  assert.deepEqual(floatCountCheck({ providerId: 'b', skip: false, amount: '15 000', explanation: ' app shows 15 000 ', skipReason: 'ignored' }), {
    ok: true,
    body: { providerId: 'b', counted: 15000, explanation: 'app shows 15 000' },
  });
  assert.deepEqual(floatCountCheck({ providerId: 'b', skip: false, amount: '0', explanation: '', skipReason: '' }), { ok: true, body: { providerId: 'b', counted: 0 } });
  assert.deepEqual(floatCountCheck({ providerId: 'b', skip: false, amount: '-5', explanation: '', skipReason: '' }), { ok: false, reason: 'amount_invalid' });
  assert.deepEqual(floatCountCheck({ providerId: 'b', skip: false, amount: '', explanation: '', skipReason: '' }), { ok: false, reason: 'amount_invalid' });
  assert.deepEqual(floatCountCheck({ providerId: 's', skip: true, amount: '500', explanation: 'x', skipReason: ' not used today ' }), {
    ok: true,
    body: { providerId: 's', skip: true, skipReason: 'not used today' },
  });
  assert.deepEqual(floatCountCheck({ providerId: 's', skip: true, amount: '', explanation: '', skipReason: '  ' }), { ok: false, reason: 'reason_missing' });
  assert.deepEqual(floatCountCheck({ providerId: 's', skip: true, amount: '', explanation: '', skipReason: 'x'.repeat(256) }), { ok: false, reason: 'too_long' });
});

it('why the figures differ is asked only when both are known and they differ', () => {
  assert.equal(asksExplanation(15100, '15000'), true);
  assert.equal(asksExplanation(15100, '15100'), false);
  assert.equal(asksExplanation(15100, ''), false);
  assert.equal(asksExplanation(null, '15000'), false, 'against an unknown float there is no difference to explain');
});

const queued = (over: Partial<QueueItem>): QueueItem => ({
  id: 'q', kind: 'agent.exchange.record', clientUuid: 'k', companyId: 'c', branchId: 'b1', userId: 'u', payloadVersion: 1,
  payload: { providerId: 'b', direction: 'cash_in_credit_out', amount: 100, configVersionId: 'v', deviceRecordedAt: '2026-10-09T10:00:00.000Z' },
  state: 'waiting_for_connection', createdAt: 1, lastAttemptAt: null, attempts: 0, summary: '', lastError: null, ...over,
});

it('the closing waits while this phone holds an exchange for the branch — sent, cancelled or another branch’s do not count', () => {
  const items = [
    queued({ id: '1', state: 'waiting_for_connection' }),
    queued({ id: '2', state: 'needs_attention' }),
    queued({ id: '3', state: 'synced' }),
    queued({ id: '4', state: 'cancelled' }),
    queued({ id: '5', branchId: 'b2' }),
    queued({ id: '6', kind: 'expense.report' }),
    queued({ id: '7', state: 'uncertain' }),
    queued({ id: '8', state: 'rejected_resubmit' }),
    queued({ id: '9', state: 'rejected_reenter' }),
    queued({ id: '10', state: 'sending' }),
  ];
  // Every state short of confirmed or removed is the day's (D161): waiting, on its way, uncertain, refused.
  assert.equal(exchangesHeld(items, 'b1'), 6, 'waiting, an older build’s attention item, uncertain, both refusals and on its way');
  assert.equal(exchangesHeld(items, 'b2'), 1);
  assert.equal(exchangesHeld([], 'b1'), 0);
});

console.log(`agent-money: ${passed} passed`);
