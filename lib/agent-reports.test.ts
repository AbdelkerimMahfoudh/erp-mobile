/**
 * The counter's report periods (D157), exactly the server's: a day, a week
 * from Monday to Sunday, a calendar month, a year — and the step to the period
 * before or after, never past the branch's business day.
 *
 *   node lib/agent-reports.test.ts
 */
import assert from 'node:assert/strict';
import { hasLaterPeriod, isCurrentPeriod, isEmptyPeriod, reportRange, stepDate } from './agent-reports.ts';

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

it('the periods are the server’s: the week Monday to Sunday, the month and the year in the calendar', () => {
  assert.deepEqual(reportRange('day', '2026-10-09'), { from: '2026-10-09', to: '2026-10-09' });
  // 2026-10-09 is a Friday; 2026-10-11 a Sunday; 2026-10-05 a Monday.
  assert.deepEqual(reportRange('week', '2026-10-09'), { from: '2026-10-05', to: '2026-10-11' });
  assert.deepEqual(reportRange('week', '2026-10-11'), { from: '2026-10-05', to: '2026-10-11' }, 'a Sunday ends its week');
  assert.deepEqual(reportRange('week', '2026-10-05'), { from: '2026-10-05', to: '2026-10-11' }, 'a Monday starts it');
  assert.deepEqual(reportRange('week', '2027-01-01'), { from: '2026-12-28', to: '2027-01-03' }, 'across the year');
  assert.deepEqual(reportRange('month', '2026-10-09'), { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(reportRange('month', '2024-02-10'), { from: '2024-02-01', to: '2024-02-29' }, 'a leap February');
  assert.deepEqual(reportRange('month', '2026-12-31'), { from: '2026-12-01', to: '2026-12-31' });
  assert.deepEqual(reportRange('year', '2026-10-09'), { from: '2026-01-01', to: '2026-12-31' });
});

it('a step lands inside the period before or after, whatever the period', () => {
  const week = reportRange('week', '2026-10-09');
  assert.deepEqual(reportRange('week', stepDate(week, -1)), { from: '2026-09-28', to: '2026-10-04' });
  assert.deepEqual(reportRange('week', stepDate(week, 1)), { from: '2026-10-12', to: '2026-10-18' });
  const month = reportRange('month', '2026-03-15');
  assert.deepEqual(reportRange('month', stepDate(month, -1)), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(reportRange('year', stepDate(reportRange('year', '2026-06-01'), -1)), { from: '2025-01-01', to: '2025-12-31' });
  assert.equal(stepDate(reportRange('day', '2026-10-01'), -1), '2026-09-30');
});

it('no later period past the branch’s business day; the period that holds it is the current one', () => {
  const today = '2026-10-09';
  assert.equal(hasLaterPeriod(reportRange('day', today), today), false);
  assert.equal(hasLaterPeriod(reportRange('day', '2026-10-08'), today), true);
  assert.equal(hasLaterPeriod(reportRange('month', '2026-09-30'), today), true);
  assert.equal(hasLaterPeriod(reportRange('month', today), today), false);
  assert.equal(hasLaterPeriod(reportRange('day', '2026-10-08'), null), false, 'before the server says the day, nothing later is offered');
  assert.equal(isCurrentPeriod(reportRange('week', today), today), true);
  assert.equal(isCurrentPeriod(reportRange('week', '2026-10-01'), today), false);
});

it('an empty period is one with no exchange, no reversal and no rebalancing', () => {
  assert.equal(isEmptyPeriod({ count: 0, reversals: { count: 0 }, rebalancings: { count: 0 } }), true);
  assert.equal(isEmptyPeriod({ count: 0, reversals: { count: 1 }, rebalancings: { count: 0 } }), false, 'a reversal of an earlier exchange is the period’s');
  assert.equal(isEmptyPeriod({ count: 0, reversals: { count: 0 }, rebalancings: { count: 2 } }), false);
});

console.log(`agent-reports: ${passed} passed`);
