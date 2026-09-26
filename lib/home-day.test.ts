/**
 * Home and the Closing screens' own small rules (docs/50).
 *
 *   node lib/home-day.test.ts
 */
import assert from 'node:assert/strict';
import {
  axisTicks,
  changeText,
  changeTone,
  dayChoices,
  daySpan,
  dayWordKey,
  freshness,
  openingPrompt,
  historyKey,
  labelledEvery,
  lastFour,
  openingKey,
  looksLikeFullIdentifier,
  reopenOptions,
  shiftDay,
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

it('the opening line: explicit open or reopen, today or on a past date, else no time recorded (0077)', () => {
  assert.equal(openingKey(null, true), 'closingHistory.noOpening');
  assert.equal(openingKey({ kind: 'opened' }, true), 'closingHistory.openedToday');
  assert.equal(openingKey({ kind: 'opened' }, false), 'closingHistory.openedOn');
  assert.equal(openingKey({ kind: 'reopened' }, true), 'closingHistory.reopenedToday');
  assert.equal(openingKey({ kind: 'auto_reopened' }, false), 'closingHistory.reopenedOn');
  assert.equal(historyKey('opened'), 'closing.history.opened');
  assert.equal(historyKey('first_activity'), 'closing.history.first_activity');
});

it('the date selector offers today first and walks back across month and year edges', () => {
  assert.equal(shiftDay('2026-10-01', -1), '2026-09-30');
  assert.equal(shiftDay('2027-01-01', -15), '2026-12-17');
  const days = dayChoices('2026-09-24', 15);
  assert.equal(days.length, 16);
  assert.equal(days[0], '2026-09-24');
  assert.equal(days[15], '2026-09-09');
  assert.equal(dayWordKey('2026-09-24', '2026-09-24'), 'closingHistory.today');
  assert.equal(dayWordKey('2026-09-23', '2026-09-24'), 'closingHistory.yesterday');
  assert.equal(dayWordKey('2026-09-09', '2026-09-24'), null);
});

it('Open the boutique asks the Owner before 06:00, tells anybody else which day it is, and asks nothing after (docs/56)', () => {
  // 03:41 on the 26th: the calendar has moved on, the business date has not.
  assert.equal(openingPrompt(['continue', 'start_new'], '2026-09-26', '2026-09-25'), 'choice');
  assert.equal(openingPrompt(['continue'], '2026-09-26', '2026-09-25'), 'notice');
  // An older server offers nothing at all; the notice still names the day.
  assert.equal(openingPrompt(undefined, '2026-09-26', '2026-09-25'), 'notice');
  // After 06:00, or once the day was started early, the two dates agree.
  assert.equal(openingPrompt(['continue'], '2026-09-26', '2026-09-26'), 'none');
  assert.equal(openingPrompt(undefined, '2026-09-26', '2026-09-26'), 'none');
});

it('a comparison is printed only when the server supplied one, rounded to a whole percent, with its sign', () => {
  assert.equal(changeText(12.4), '+12 %');
  assert.equal(changeText(-7.6), '−8 %');
  assert.equal(changeText(0.2), '0 %');
  assert.equal(changeText(null), null);
  assert.equal(changeText(undefined), null);
  assert.equal(changeText(Number.NaN), null);
  assert.equal(changeText(Number.POSITIVE_INFINITY), null);
  assert.deepEqual([changeTone(12.4), changeTone(-7.6), changeTone(0.2)], ['positive', 'negative', 'muted']);
});

it('a day span is inclusive: the seven days before a week are seven', () => {
  assert.equal(daySpan('2026-09-13', '2026-09-19'), 7);
  assert.equal(daySpan('2026-09-25', '2026-09-25'), 1);
  assert.equal(daySpan('2026-08-31', '2026-09-25'), 26);
});

console.log(`home-day: ${passed} passed`);
