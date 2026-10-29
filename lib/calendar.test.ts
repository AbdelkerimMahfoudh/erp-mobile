import { it } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, calendarWeekOf, daysIn, isoWeekday, monthToDate, weekToDate } from './calendar.ts';
import { periodRange } from './period.ts';
import { periodRange as historyRange } from './agent-history.ts';
import { en } from './i18n/en.ts';
import { fr } from './i18n/fr.ts';
import { ar } from './i18n/ar.ts';

/**
 * The calendar week (D225): Monday through Sunday in business dates, the same cases the server's
 * `business-day.spec.ts` pins, so the app's filter and the API's totals cover the same days.
 *
 *   node lib/calendar.test.ts
 */

it('Monday is day 1 and Sunday day 7', () => {
  assert.equal(isoWeekday('2026-10-26'), 1);
  assert.equal(isoWeekday('2026-10-29'), 4);
  assert.equal(isoWeekday('2026-11-01'), 7);
});

it('every day of a week belongs to the same Monday-to-Sunday week, Sunday included', () => {
  for (const day of ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']) {
    assert.deepEqual(calendarWeekOf(day), { from: '2026-10-26', to: '2026-11-01' });
  }
});

it('Sunday to Monday is the boundary', () => {
  assert.deepEqual(weekToDate('2026-11-01'), { from: '2026-10-26', to: '2026-11-01' });
  assert.deepEqual(weekToDate('2026-11-02'), { from: '2026-11-02', to: '2026-11-02' });
  assert.equal(daysIn(weekToDate('2026-11-01')), 7);
  assert.equal(daysIn(weekToDate('2026-11-02')), 1);
});

it('crosses month and year boundaries', () => {
  assert.deepEqual(calendarWeekOf('2026-10-01'), { from: '2026-09-28', to: '2026-10-04' });
  assert.deepEqual(calendarWeekOf('2026-01-01'), { from: '2025-12-29', to: '2026-01-04' });
  assert.deepEqual(calendarWeekOf('2026-12-31'), { from: '2026-12-28', to: '2027-01-03' });
  assert.deepEqual(calendarWeekOf('2028-02-29'), { from: '2028-02-28', to: '2028-03-05' });
  assert.deepEqual(monthToDate('2026-10-29'), { from: '2026-10-01', to: '2026-10-29' });
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

it('Money, Results, Home and the exchanges list all use the same week, given the server’s business date', () => {
  // Africa/Nouakchott is UTC+0: Monday 2 November at 05:59 is still Sunday's business date, and the
  // server says so — the app ranges from the date it is given, never from the phone's clock.
  for (const businessDate of ['2026-11-01', '2026-11-02', '2026-10-29', '2026-01-01']) {
    const shared = periodRange('week', new Date('2000-01-01T00:00:00Z'), businessDate);
    assert.deepEqual(shared, weekToDate(businessDate));
    assert.deepEqual(historyRange('week', businessDate), weekToDate(businessDate));
  }
});

it('the period labels say what the period is, in every language', () => {
  assert.equal(en['period.week'], 'This week');
  assert.equal(fr['period.week'], 'Cette semaine');
  // The owner's Arabic labels, word for word.
  assert.equal(ar['period.today'], 'هذا اليوم');
  assert.equal(ar['period.week'], 'هذا الأسبوع');
  assert.equal(ar['period.month'], 'هذا الشهر');
  assert.equal(ar['agent.period.today'], 'هذا اليوم');
  assert.equal(ar['agent.period.week'], 'هذا الأسبوع');
  assert.equal(ar['agent.period.month'], 'هذا الشهر');
  for (const catalogue of [en, fr, ar]) {
    for (const key of ['period.week', 'money.period.week', 'home.chart.week', 'agent.period.week'] as const) {
      assert.doesNotMatch(catalogue[key], /7/, `${key} must not say "7 days": the week is a calendar week`);
    }
  }
});
