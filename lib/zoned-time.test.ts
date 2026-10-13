/**
 * A free trial's dates are the business's, on a phone set to any time zone (the owner's correction of 2026-10-13).
 *
 *   node lib/zoned-time.test.ts
 *
 * The server stores and sends every trial instant in UTC and names the business's configured zone beside it. The
 * app shows the instant on THAT zone's clock, followed by the zone's name — never the phone's own zone, never a
 * zone written in the app. The checks run again in child processes set to five zones — UTC, New York (UTC−4),
 * Tokyo (UTC+9), Kiritimati (UTC+14) and Pago Pago (UTC−11) — and every one must read the same words. The zones
 * shown are deliberately not GMT: Mauritania keeping GMT today must not be what makes these pass.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatInZone } from './zoned-time.ts';

const ENDS = new Date('2026-10-20T10:30:00.000Z');

/** What one phone reads, in its own zone. */
function readings() {
  return {
    tokyo: formatInZone(ENDS, 'Asia/Tokyo', 'en'),
    newYork: formatInZone(ENDS, 'America/New_York', 'en'),
    nouakchott: formatInZone(ENDS, 'Africa/Nouakchott', 'en'),
    // Across midnight both ways: the zone's calendar day, not the instant's UTC day.
    tokyoNextDay: formatInZone(new Date('2026-10-20T20:30:00.000Z'), 'Asia/Tokyo', 'en'),
    newYorkDayBefore: formatInZone(new Date('2026-10-20T02:15:00.000Z'), 'America/New_York', 'en'),
    // Paris leaves summer time at 01:00 UTC on 25 Oct 2026: the same 02:30 twice, told apart by the zone's name.
    parisSummer: formatInZone(new Date('2026-10-25T00:30:00.000Z'), 'Europe/Paris', 'en'),
    parisWinter: formatInZone(new Date('2026-10-25T01:30:00.000Z'), 'Europe/Paris', 'en'),
    unknownZone: formatInZone(ENDS, 'Mars/Olympus', 'en'),
    french: formatInZone(ENDS, 'Asia/Tokyo', 'fr'),
    arabic: formatInZone(ENDS, 'Asia/Tokyo', 'ar'),
  };
}

if (process.env.ZONED_TIME_CHILD) {
  process.stdout.write(JSON.stringify({ tz: process.env.TZ, ...readings() }));
} else {
  let passed = 0;
  const it = (name: string, fn: () => void) => {
    try { fn(); passed++; } catch (e) { console.error(`✗ ${name}`); throw e; }
  };
  const self = fileURLToPath(import.meta.url);
  const zones = ['UTC', 'America/New_York', 'Asia/Tokyo', 'Pacific/Kiritimati', 'Pacific/Pago_Pago'];
  const phones = zones.map((TZ) => JSON.parse(execFileSync(process.execPath, ['--no-warnings', self], { env: { ...process.env, TZ, ZONED_TIME_CHILD: '1' }, encoding: 'utf8' })));
  const one = phones[0];

  it('each child phone really ran in its own zone', () => {
    assert.deepEqual(phones.map((p) => p.tz), zones);
  });

  it('every phone reads exactly the same words, whatever its own zone', () => {
    for (const p of phones) assert.deepEqual({ ...p, tz: one.tz }, one, p.tz);
  });

  it('the instant on the business’s clock, then that clock’s name — a non-GMT zone, east and west', () => {
    assert.equal(one.tokyo, '20 Oct 2026 · 19:30 (Japan Standard Time)');
    assert.equal(one.newYork, '20 Oct 2026 · 06:30 (Eastern Daylight Time)');
    assert.equal(one.nouakchott, '20 Oct 2026 · 10:30 (Greenwich Mean Time)');
  });

  it('the calendar day is the zone’s, across midnight both ways', () => {
    assert.equal(one.tokyoNextDay, '21 Oct 2026 · 05:30 (Japan Standard Time)');
    assert.equal(one.newYorkDayBefore, '19 Oct 2026 · 22:15 (Eastern Daylight Time)');
  });

  it('summer time is the zone’s own rule, and its name says which 02:30 is meant', () => {
    assert.equal(one.parisSummer, '25 Oct 2026 · 02:30 (Central European Summer Time)');
    assert.equal(one.parisWinter, '25 Oct 2026 · 02:30 (Central European Standard Time)');
  });

  it('a zone this device cannot read is shown on UTC’s clock and named so — never on the phone’s', () => {
    assert.equal(one.unknownZone, '20 Oct 2026 · 10:30 (Coordinated Universal Time)');
  });

  it('French and Arabic read the same clock, in their own words, with Latin digits', () => {
    assert.match(one.french, /^20 oct\. 2026 · 19:30 \(.+\)$/);
    assert.match(one.arabic, /^20 أكتوبر 2026 · 19:30 \(.+\)$/);
    assert.notEqual(one.french, one.tokyo, 'the zone is named in French');
    assert.doesNotMatch(one.arabic, /[٠-٩]/, 'no Arabic-Indic digit, as everywhere in the app');
  });

  it('formatDateTime takes the zone as an option and hands it over with the active language', () => {
    const fmt = readFileSync(new URL('./format.ts', import.meta.url), 'utf8');
    assert.match(fmt, /export function formatDateTime\(value: string \| number \| Date, options: DateTimeOptions = \{\}\): string \{\s*if \(options\.timeZone\) return formatInZone\(toDate\(value\), options\.timeZone, getLanguage\(\)\);/);
    // Without the option, the phone's clock exactly as before.
    assert.match(fmt, /return formatDateFns\(toDate\(value\), 'd MMM yyyy · HH:mm', \{ locale: dateLocale\(\) \}\);/);
  });

  it('no zone is written anywhere in the app: the one shown is always the one the server names', () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const sources = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) return name === 'node_modules' ? [] : sources(p);
        return /\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts') ? [p] : [];
      });
    const code = (p: string) => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const f of ['app', 'components', 'hooks', 'lib', 'constants'].flatMap((d) => sources(join(root, d)))) {
      const text = code(f);
      // Only the fallback for a zone the device cannot read names one, and it says so in the output.
      if (f.endsWith('lib/zoned-time.ts')) continue;
      assert.doesNotMatch(text, /timeZone:\s*['"]|['"](Africa|Europe|America|Asia|Atlantic|Pacific|Etc)\/\w+['"]|['"](GMT|UTC)['"]/, `${f} writes a time zone of its own`);
    }
  });

  console.log(`zoned time: ${passed} passed`);
}
