/**
 * Home's dates and times are the store's, on a phone set to any timezone (docs/54).
 *
 *   node lib/store-time.test.ts
 *
 * The test runs its own checks again in child processes set to five zones — UTC,
 * New York (UTC−4), Tokyo (UTC+9), Kiritimati (UTC+14) and Pago Pago (UTC−11) — and
 * requires every one to read the same words. It also shows the defect it replaces:
 * a date read as UTC midnight and shown in the phone's zone lands on the day before
 * west of UTC.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { format } from 'date-fns';
import { arrivalDay } from './home-day.ts';
import { calendarDate } from './day-range.ts';

/** What one phone reads, in its own zone. */
function readings() {
  return {
    today: arrivalDay('2026-09-25', '2026-09-25'),
    yesterday: arrivalDay('2026-09-24', '2026-09-25'),
    older: arrivalDay('2026-09-23', '2026-09-25'),
    acrossMonth: arrivalDay('2026-02-28', '2026-03-01'),
    acrossYear: arrivalDay('2026-12-31', '2027-01-01'),
    tomorrowIsNotToday: arrivalDay('2026-09-26', '2026-09-25'),
    // Home's range caption and the Daily closing's dates: the calendar day named, on any phone.
    rangeDay: format(calendarDate('2026-09-25'), 'd MMM yyyy'),
    firstOfMonth: format(calendarDate('2026-03-01'), 'EEE d MMM'),
    // The way it was done before: UTC midnight, shown in the phone's zone.
    before: format(new Date('2026-09-25T00:00:00Z'), 'd MMM yyyy'),
  };
}

if (process.env.STORE_TIME_CHILD) {
  process.stdout.write(JSON.stringify({ tz: process.env.TZ, ...readings() }));
} else {
  let passed = 0;
  const it = (name: string, fn: () => void) => {
    try { fn(); passed++; } catch (e) { console.error(`✗ ${name}`); throw e; }
  };
  const self = fileURLToPath(import.meta.url);
  const zones = ['UTC', 'America/New_York', 'Asia/Tokyo', 'Pacific/Kiritimati', 'Pacific/Pago_Pago'];
  const phones = zones.map((TZ) => JSON.parse(execFileSync(process.execPath, [self], { env: { ...process.env, TZ, STORE_TIME_CHILD: '1' }, encoding: 'utf8' })));

  it('each child phone really ran in its own zone', () => {
    assert.deepEqual(phones.map((p) => p.tz), zones);
  });

  it('"Today" and "Yesterday" follow the store\'s calendar, across months and years, on every phone', () => {
    for (const p of phones) {
      assert.deepEqual(
        [p.today, p.yesterday, p.older, p.acrossMonth, p.acrossYear, p.tomorrowIsNotToday],
        ['today', 'yesterday', 'date', 'yesterday', 'yesterday', 'date'],
        p.tz,
      );
    }
  });

  it('a store date reads as that day on every phone', () => {
    for (const p of phones) assert.deepEqual([p.rangeDay, p.firstOfMonth], ['25 Sep 2026', 'Sun 1 Mar'], p.tz);
  });

  it('the defect replaced: UTC midnight shown in the phone\'s zone was the day before, west of UTC', () => {
    const before = Object.fromEntries(phones.map((p) => [p.tz, p.before]));
    assert.equal(before.UTC, '25 Sep 2026');
    assert.equal(before['America/New_York'], '24 Sep 2026');
    assert.equal(before['Pacific/Pago_Pago'], '24 Sep 2026');
  });

  it('Home shows the arrival\'s store-local date and time, never the phone\'s clock or zone', () => {
    const screen = readFileSync(new URL('../app/(tabs)/index.tsx', import.meta.url), 'utf8');
    assert.match(screen, /switch \(arrivalDay\(arrival\.receivedLocalDate, storeToday\)\)/);
    assert.match(screen, /const time = isolateLtr\(arrival\.receivedLocalTime\);/);
    assert.match(screen, /<ArrivalRow arrival=\{a\} storeToday=\{data\.businessDay\.localDate\} \/>/);
    assert.ok(!/isToday|isYesterday|formatTime\(/.test(screen), 'no phone-clock date test is left on Home');
    assert.ok(!/T00:00:00Z`|T12:00:00Z`/.test(screen), 'no date is read as a UTC instant on Home');
    const fmt = readFileSync(new URL('./format.ts', import.meta.url), 'utf8');
    assert.match(fmt, /if \(typeof value === 'string' && \/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(value\)\) return calendarDate\(value\);/);
  });

  console.log(`store-time: ${passed} passed`);
}

