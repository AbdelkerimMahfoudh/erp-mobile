import { it } from 'node:test';
import assert from 'node:assert/strict';
import { businessDateOf, calendarWeekOf, monthToDate, weekToDate } from './calendar.ts';
import { periodRange } from './period.ts';
import { en } from './i18n/en.ts';
import { fr } from './i18n/fr.ts';
import { ar } from './i18n/ar.ts';

/**
 * The calendar week on the store's clock (D225, owner's final decision): the business day starts at
 * 06:00 Africa/Nouakchott (UTC+0, no daylight saving); "this week" is Monday 06:00 through the next
 * Monday 05:59:59.999; month and year cut at 06:00 too.
 *
 * WEEK_TABLE is copied, literal for literal, into the server's `src/common/calendar-week.spec.ts`:
 * both suites assert the same instants against the same weeks, so the phone and the server cannot
 * disagree about which week a sale belongs to.
 *
 *   node lib/calendar-week.test.ts
 *   TZ=America/New_York node lib/calendar-week.test.ts
 *   TZ=Asia/Tokyo node lib/calendar-week.test.ts
 */

const ZONE = 'Africa/Nouakchott';

// ---- shared table (identical in erp-backend src/common/calendar-week.spec.ts) ----
const WEEK_TABLE = [
  { at: '2026-11-02T05:59:00.000Z', businessDate: '2026-11-01', weekFrom: '2026-10-26', weekTo: '2026-11-01', weekStart: '2026-10-26T06:00:00.000Z', weekEnd: '2026-11-02T05:59:59.999Z', monthStart: '2026-11-01T06:00:00.000Z', yearStart: '2026-01-01T06:00:00.000Z' },
  { at: '2026-11-02T06:00:00.000Z', businessDate: '2026-11-02', weekFrom: '2026-11-02', weekTo: '2026-11-08', weekStart: '2026-11-02T06:00:00.000Z', weekEnd: '2026-11-09T05:59:59.999Z', monthStart: '2026-11-01T06:00:00.000Z', yearStart: '2026-01-01T06:00:00.000Z' },
  { at: '2026-11-01T23:30:00.000Z', businessDate: '2026-11-01', weekFrom: '2026-10-26', weekTo: '2026-11-01', weekStart: '2026-10-26T06:00:00.000Z', weekEnd: '2026-11-02T05:59:59.999Z', monthStart: '2026-11-01T06:00:00.000Z', yearStart: '2026-01-01T06:00:00.000Z' },
  { at: '2026-11-02T03:00:00.000Z', businessDate: '2026-11-01', weekFrom: '2026-10-26', weekTo: '2026-11-01', weekStart: '2026-10-26T06:00:00.000Z', weekEnd: '2026-11-02T05:59:59.999Z', monthStart: '2026-11-01T06:00:00.000Z', yearStart: '2026-01-01T06:00:00.000Z' },
  { at: '2026-11-01T05:59:00.000Z', businessDate: '2026-10-31', weekFrom: '2026-10-26', weekTo: '2026-11-01', weekStart: '2026-10-26T06:00:00.000Z', weekEnd: '2026-11-02T05:59:59.999Z', monthStart: '2026-10-01T06:00:00.000Z', yearStart: '2026-01-01T06:00:00.000Z' },
  { at: '2026-11-01T06:00:00.000Z', businessDate: '2026-11-01', weekFrom: '2026-10-26', weekTo: '2026-11-01', weekStart: '2026-10-26T06:00:00.000Z', weekEnd: '2026-11-02T05:59:59.999Z', monthStart: '2026-11-01T06:00:00.000Z', yearStart: '2026-01-01T06:00:00.000Z' },
  { at: '2026-12-01T05:59:00.000Z', businessDate: '2026-11-30', weekFrom: '2026-11-30', weekTo: '2026-12-06', weekStart: '2026-11-30T06:00:00.000Z', weekEnd: '2026-12-07T05:59:59.999Z', monthStart: '2026-11-01T06:00:00.000Z', yearStart: '2026-01-01T06:00:00.000Z' },
  { at: '2026-12-01T06:00:00.000Z', businessDate: '2026-12-01', weekFrom: '2026-11-30', weekTo: '2026-12-06', weekStart: '2026-11-30T06:00:00.000Z', weekEnd: '2026-12-07T05:59:59.999Z', monthStart: '2026-12-01T06:00:00.000Z', yearStart: '2026-01-01T06:00:00.000Z' },
  { at: '2027-01-01T05:59:00.000Z', businessDate: '2026-12-31', weekFrom: '2026-12-28', weekTo: '2027-01-03', weekStart: '2026-12-28T06:00:00.000Z', weekEnd: '2027-01-04T05:59:59.999Z', monthStart: '2026-12-01T06:00:00.000Z', yearStart: '2026-01-01T06:00:00.000Z' },
  { at: '2027-01-01T06:00:00.000Z', businessDate: '2027-01-01', weekFrom: '2026-12-28', weekTo: '2027-01-03', weekStart: '2026-12-28T06:00:00.000Z', weekEnd: '2027-01-04T05:59:59.999Z', monthStart: '2027-01-01T06:00:00.000Z', yearStart: '2027-01-01T06:00:00.000Z' },
  { at: '2027-01-04T05:59:59.999Z', businessDate: '2027-01-03', weekFrom: '2026-12-28', weekTo: '2027-01-03', weekStart: '2026-12-28T06:00:00.000Z', weekEnd: '2027-01-04T05:59:59.999Z', monthStart: '2027-01-01T06:00:00.000Z', yearStart: '2027-01-01T06:00:00.000Z' },
  { at: '2027-01-04T06:00:00.000Z', businessDate: '2027-01-04', weekFrom: '2027-01-04', weekTo: '2027-01-10', weekStart: '2027-01-04T06:00:00.000Z', weekEnd: '2027-01-11T05:59:59.999Z', monthStart: '2027-01-01T06:00:00.000Z', yearStart: '2027-01-01T06:00:00.000Z' },
] as const;
// ---- end shared table ----

const ms = (iso: string) => new Date(iso).getTime();

function assertTable(label: string) {
  for (const row of WEEK_TABLE) {
    const at = new Date(row.at);
    const date = businessDateOf(at, ZONE);
    assert.equal(date, row.businessDate, `${label} ${row.at}: business date`);
    assert.deepEqual(calendarWeekOf(date), { from: row.weekFrom, to: row.weekTo }, `${label} ${row.at}: week`);
    // The instant lies inside its week window, both ends included.
    assert.ok(ms(row.weekStart) <= at.getTime() && at.getTime() <= ms(row.weekEnd), `${label} ${row.at}: inside the window`);
    // The window's edges are the 06:00 cut: its first instant is Monday's day, the one before is last week's Sunday.
    assert.equal(businessDateOf(new Date(row.weekStart), ZONE), row.weekFrom, `${label} ${row.at}: week start`);
    assert.equal(businessDateOf(new Date(ms(row.weekStart) - 1), ZONE) < row.weekFrom, true);
    assert.equal(businessDateOf(new Date(row.weekEnd), ZONE), row.weekTo, `${label} ${row.at}: week end`);
    assert.equal(businessDateOf(new Date(ms(row.weekEnd) + 1), ZONE) > row.weekTo, true);
    assert.equal(ms(row.weekEnd) + 1 - ms(row.weekStart), 7 * 86_400_000, `${label} ${row.at}: seven whole days`);
    // Month and year: the first of the month (and January 1st) starts at 06:00 too.
    assert.equal(monthToDate(date).from, businessDateOf(new Date(row.monthStart), ZONE));
    assert.equal(businessDateOf(new Date(ms(row.monthStart) - 1), ZONE).slice(0, 7) < date.slice(0, 7), true);
    assert.equal(businessDateOf(new Date(row.yearStart), ZONE), `${date.slice(0, 4)}-01-01`);
    assert.equal(businessDateOf(new Date(ms(row.yearStart) - 1), ZONE).slice(0, 4), String(Number(date.slice(0, 4)) - 1));
  }
}

it('every instant of the shared table falls in the week, month and year the owner set (06:00 Africa/Nouakchott)', () => {
  assertTable(`TZ=${process.env.TZ ?? '(unset)'}`);
});

it('the zone is Africa/Nouakchott whatever zone the phone is set to', () => {
  const original = process.env.TZ;
  try {
    for (const tz of ['UTC', 'America/New_York', 'Asia/Tokyo', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
      process.env.TZ = tz;
      assertTable(`TZ=${tz}`);
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

it('Monday 05:59 is still last week; Monday 06:00 starts the new one', () => {
  assert.deepEqual(calendarWeekOf(businessDateOf(new Date('2026-11-02T05:59:00Z'), ZONE)), { from: '2026-10-26', to: '2026-11-01' });
  assert.deepEqual(calendarWeekOf(businessDateOf(new Date('2026-11-02T06:00:00Z'), ZONE)), { from: '2026-11-02', to: '2026-11-08' });
  // Sunday 23:30 and Monday 03:00 are one night, one business day, one week.
  assert.equal(businessDateOf(new Date('2026-11-01T23:30:00Z'), ZONE), businessDateOf(new Date('2026-11-02T03:00:00Z'), ZONE));
});

it('the 06:00 rule is the local clock: a zone east of UTC cuts earlier, one west of it later', () => {
  // 02:30 UTC is 06:30 in Dubai (UTC+4): the new day has begun; 01:30 UTC is 05:30 there.
  assert.equal(businessDateOf(new Date('2026-09-23T02:30:00Z'), 'Asia/Dubai'), '2026-09-23');
  assert.equal(businessDateOf(new Date('2026-09-23T01:30:00Z'), 'Asia/Dubai'), '2026-09-22');
  // A zone this device cannot read falls back to UTC's clock, never the phone's.
  assert.equal(businessDateOf(new Date('2026-11-02T05:59:00Z'), 'Mars/Olympus'), '2026-11-01');
});

it('while the server has not answered yet, Money’s range applies the same 06:00 rule (no new week at Monday 05:59)', () => {
  assert.deepEqual(periodRange('week', new Date('2026-11-02T05:59:00Z')), { from: '2026-10-26', to: '2026-11-01' });
  assert.deepEqual(periodRange('today', new Date('2026-11-02T05:59:00Z')), { from: '2026-11-01', to: '2026-11-01' });
  assert.deepEqual(periodRange('week', new Date('2026-11-02T06:00:00Z')), { from: '2026-11-02', to: '2026-11-02' });
  assert.deepEqual(periodRange('month', new Date('2026-12-01T05:59:00Z')), { from: '2026-11-01', to: '2026-11-30' });
  assert.deepEqual(periodRange('month', new Date('2026-12-01T06:00:00Z')), { from: '2026-12-01', to: '2026-12-01' });
  // The server's date, once known, always wins.
  assert.deepEqual(periodRange('week', new Date('2026-11-02T05:59:00Z'), '2026-11-02'), weekToDate('2026-11-02'));
});

it('the period labels are pinned: Today / This week / This month in EN, FR and AR', () => {
  assert.deepEqual([en['period.today'], en['period.week'], en['period.month']], ['Today', 'This week', 'This month']);
  assert.deepEqual([fr['period.today'], fr['period.week'], fr['period.month']], ['Aujourd’hui', 'Cette semaine', 'Ce mois-ci']);
  assert.deepEqual([ar['period.today'], ar['period.week'], ar['period.month']], ['هذا اليوم', 'هذا الأسبوع', 'هذا الشهر']);
});
