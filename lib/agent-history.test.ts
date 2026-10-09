/**
 * The exchanges list and one exchange, as pure rules (docs/73 §5, D157):
 * periods on the branch's business day, the masked search, the phone's own
 * exchanges first, the words of each leg, the reversal's counter-legs apart.
 * And the drawer and floats: the server's figure, Provisional with queued legs,
 * Unknown kept Unknown.
 *
 *   node lib/agent-history.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addDays, directionRowKey, legKindKey, legWordsKey, periodRange, queuedFirst, searchFilter, splitLegs } from './agent-history.ts';
import { positionRows, provisionalFigure, type PositionsLike } from './agent-positions.ts';
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

it('periods end on the branch’s business day, counted in the calendar', () => {
  assert.deepEqual(periodRange('today', '2026-10-09'), { from: '2026-10-09', to: '2026-10-09' });
  assert.deepEqual(periodRange('yesterday', '2026-10-01'), { from: '2026-09-30', to: '2026-09-30' });
  assert.deepEqual(periodRange('week', '2026-10-03'), { from: '2026-09-27', to: '2026-10-03' });
  assert.deepEqual(periodRange('month', '2026-10-09'), { from: '2026-10-01', to: '2026-10-09' });
  assert.deepEqual(periodRange('all', '2026-10-09'), {});
  assert.equal(addDays('2024-03-01', -1), '2024-02-29');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

it('the number is searched by its last four digits only; a reference exactly', () => {
  assert.deepEqual(searchFilter('number', '3456'), { last4: '3456' });
  assert.deepEqual(searchFilter('number', '٣٤٥٦'), { last4: '3456' }, 'Arabic digits read as the same digits');
  assert.deepEqual(searchFilter('number', ' 34 56 '), { last4: '3456' });
  assert.equal(searchFilter('number', '36123456'), null, 'more than four digits is never sent: the list stays masked');
  assert.equal(searchFilter('number', '345'), null);
  assert.deepEqual(searchFilter('number', ''), {});
  assert.deepEqual(searchFilter('reference', ' TX-77 '), { reference: 'TX-77' });
  assert.equal(searchFilter('reference', 'x'.repeat(121)), null);
});

const q = (over: Partial<QueueItem>): QueueItem => ({
  id: 'x', kind: 'agent.exchange.record', clientUuid: 'k', companyId: 'c', branchId: 'b1', userId: 'u', payloadVersion: 1, payload: {},
  state: 'waiting_for_connection', createdAt: 1, lastAttemptAt: null, attempts: 0, summary: '', lastError: null, ...over,
});

it('the phone’s own exchanges head the list, newest first, until the server has them — never twice', () => {
  const items = [
    q({ id: 'a', createdAt: 1 }),
    q({ id: 'b', createdAt: 3, state: 'needs_attention' }),
    q({ id: 'c', createdAt: 2, state: 'synced' }),
    q({ id: 'd', createdAt: 4, state: 'cancelled' }),
    q({ id: 'e', createdAt: 5, branchId: 'b2' }),
    q({ id: 'f', createdAt: 6, kind: 'expense.submit' }),
  ];
  assert.deepEqual(queuedFirst(items, 'b1').map((i) => i.id), ['b', 'a']);
});

it('every leg and every direction has its words, in all three languages', () => {
  const keys = [
    ...(['cash', 'provider', 'commission_held', 'external'] as const).flatMap((account) => (['inflow', 'outflow'] as const).map((direction) => legWordsKey({ account, direction }))),
    ...(['principal', 'commission', 'reversal', 'rebalancing'] as const).map(legKindKey),
    directionRowKey('cash_in_credit_out'),
    directionRowKey('cash_out_credit_in'),
    ...['today', 'yesterday', 'week', 'month', 'all'].map((p) => `agent.period.${p}`),
    ...['wrong_amount', 'wrong_direction', 'wrong_provider', 'wrong_number', 'other'].map((k) => `agent.mistake.kind.${k}`),
    ...['open', 'reversed', 'dismissed'].map((s) => `agent.mistake.status.${s}`),
  ];
  for (const lang of ['en', 'fr', 'ar']) {
    const src = readFileSync(new URL(`./i18n/${lang}.ts`, import.meta.url), 'utf8');
    for (const key of keys) assert.ok(src.includes(`'${key}':`), `${lang}: ${key}`);
  }
});

it('a reversal’s counter-legs are shown apart from what the exchange moved', () => {
  const legs = [
    { kind: 'principal' as const, n: 1 },
    { kind: 'commission' as const, n: 2 },
    { kind: 'reversal' as const, n: 3 },
    { kind: 'reversal' as const, n: 4 },
  ];
  const { original, reversal } = splitLegs(legs);
  assert.deepEqual(original.map((l) => l.n), [1, 2]);
  assert.deepEqual(reversal.map((l) => l.n), [3, 4]);
});

// ── The drawer and the floats ──────────────────────────────────────────────

const day = (net: number) => ({ businessDate: '2026-10-09', inflows: Math.max(net, 0), outflows: Math.max(-net, 0), net });
/** The combined branch's positions as the server sent them (2026-10-09), trimmed. */
const positions: PositionsLike = {
  cash: { known: true, position: 99_400, movement: day(89_400) },
  floats: [
    { providerId: 'bankily', providerLabel: 'Bankily', accountKind: 'provider', known: true, position: 12_490, movement: day(-37_510) },
    { providerId: 'masrvi', providerLabel: 'Masrvi', accountKind: 'provider', known: false, position: null, movement: day(200) },
  ],
  commissionHeld: [{ providerId: 'moov', providerLabel: 'Moov', accountKind: 'commission_held', known: false, position: null, movement: day(50) }],
};

it('the server’s positions, drawer first; Unknown stays null with its day’s movement — never 0', () => {
  const rows = positionRows(positions);
  assert.deepEqual(rows.map((r) => [r.key, r.position, r.provisional]), [
    ['cash', 99_400, false],
    ['provider:bankily', 12_490, false],
    ['provider:masrvi', null, false],
    ['commission_held:moov', null, false],
  ]);
  assert.equal(rows[2].movement?.net, 200);
  assert.ok(rows.every((r) => !r.provisional));
});

it('with exchanges on the phone, known figures move by their legs and say Provisional; unknown ones stay Unknown', () => {
  const net = { cash: 15_000, 'provider:bankily': -14_750, 'provider:masrvi': 300 };
  const rows = positionRows(positions, net);
  assert.deepEqual(rows.map((r) => [r.key, r.position, r.provisional]), [
    ['cash', 114_400, true],
    ['provider:bankily', -2_260, true],
    ['provider:masrvi', null, false],
    ['commission_held:moov', null, false],
  ]);
});

it('Money’s drawer line with this phone’s exchanges: the server’s figure plus the queued net — never for an unknown drawer', () => {
  assert.equal(provisionalFigure(99400, 5000.5), 104400.5);
  assert.equal(provisionalFigure(99400, -10000), 89400);
  assert.equal(provisionalFigure(null, 5000), null, 'unknown stays unknown, however much is queued');
  assert.equal(provisionalFigure(99400, 0), null, 'nothing queued: nothing provisional to say');
  assert.equal(provisionalFigure(0.1, 0.2), 0.3, 'to the cent');
});

console.log(`agent history and positions: ${passed} passed`);
