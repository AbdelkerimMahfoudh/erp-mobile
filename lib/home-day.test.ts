/**
 * Home and the Closing screens' own small rules (docs/50).
 *
 *   node lib/home-day.test.ts
 */
import assert from 'node:assert/strict';
import {
  axisTicks,
  freshness,
  historyKey,
  labelledEvery,
  lastFour,
  looksLikeFullIdentifier,
  reopenOptions,
  shortAmount,
  sinceLastCountTone,
  standingKey,
  standingTone,
} from './home-day.ts';

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

it('every standing has a word and a colour, and the two warnings are the ones that need a look', () => {
  for (const s of ['open', 'counting', 'counted', 'closed', 'reopened', 'needs_review'] as const) {
    assert.equal(standingKey(s), `closing.standing.${s}`);
  }
  assert.equal(standingTone('closed'), 'success');
  assert.equal(standingTone('reopened'), 'warning');
  assert.equal(standingTone('needs_review'), 'warning');
  assert.equal(standingTone('open'), 'neutral');
});

it('axis ticks are round and reach above the tallest bar', () => {
  assert.deepEqual(axisTicks(0), [0]);
  assert.deepEqual(axisTicks(2350), [0, 2000, 4000]);
  assert.deepEqual(axisTicks(9250), [0, 5000, 10000]);
  assert.deepEqual(axisTicks(150), [0, 100, 200]);
  assert.deepEqual(axisTicks(40000), [0, 20000, 40000]);
  const t = axisTicks(128000);
  assert.ok(t[t.length - 1] >= 128000);
});

it('short amounts read like a person says them', () => {
  assert.equal(shortAmount(0), '0');
  assert.equal(shortAmount(950), '950');
  assert.equal(shortAmount(1000), '1k');
  assert.equal(shortAmount(2500), '2.5k');
  assert.equal(shortAmount(128000), '128k');
  assert.equal(shortAmount(1_500_000), '1.5M');
});

it('twenty-four hours print every third label; days and weeks print all', () => {
  assert.equal(labelledEvery('hour', 393), 3);
  assert.equal(labelledEvery('hour', 320), 4);
  assert.equal(labelledEvery('day', 320), 1);
  assert.equal(labelledEvery('week', 393), 1);
});

it('an identifier on Home is four digits and never a full one', () => {
  assert.equal(lastFour('•••• 7330'), '7330');
  assert.equal(lastFour('358888000000014'), '0014');
  assert.equal(looksLikeFullIdentifier('IMEI •••• 7330'), false);
  assert.equal(looksLikeFullIdentifier('IMEI 3588 8800 0000 014'), true);
});

it('freshness: within a minute is now, later is stale, unknown is nothing', () => {
  const now = 1_000_000;
  assert.equal(freshness(null, now), null);
  assert.equal(freshness(now - 30_000, now), 'now');
  assert.equal(freshness(now - 61_000, now), 'stale');
});

it('the reopen sheet selects the safe default and shows the early start only when offered', () => {
  assert.deepEqual(reopenOptions(['continue']), [{ mode: 'continue', selected: true }]);
  assert.deepEqual(reopenOptions(['continue', 'start_new']), [
    { mode: 'continue', selected: true },
    { mode: 'start_new', selected: false },
  ]);
  assert.deepEqual(reopenOptions([]), [{ mode: 'continue', selected: true }]);
});

it('movement since the last count is coloured by its sign, and named by a word beside it', () => {
  assert.equal(sinceLastCountTone(null), 'neutral');
  assert.equal(sinceLastCountTone(0), 'neutral');
  assert.equal(sinceLastCountTone(2500), 'success');
  assert.equal(sinceLastCountTone(-300), 'danger');
});

it('every history kind has a catalogue key, and an unknown one falls back rather than crashing', () => {
  assert.equal(historyKey('sale'), 'closing.history.sale');
  assert.equal(historyKey('auto_reopened'), 'closing.history.auto_reopened');
  assert.equal(historyKey('something_new'), 'closing.history.other');
});

console.log(`home-day: ${passed} passed`);
