/**
 * Money as text — proved without a screen.
 *
 *   node lib/money-format.test.ts
 *
 * The separator is the point of this suite. It was a narrow no-break space,
 * about 2 px at body size, so the charge button read "1015 MRU" while the big
 * total beside it read "1 015 MRU" — the same string, one of them unreadable.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ABSENT,
  CURRENCY_CODE,
  formatMoney,
  formatNumber,
  formatPercent,
  formatQuantity,
  isMoneyHidden,
} from './money-format.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log('  ok  ' + name);
};

const NBSP = ' ';
const NARROW = ' ';
const codes = (s: string) => [...s].map((c) => c.codePointAt(0).toString(16)).join(' ');

// ── the separator ────────────────────────────────────────────────────────────

it('thousands are grouped with a non-breaking space, not a narrow one', () => {
  assert.equal(formatMoney(1030), `1${NBSP}030${NBSP}${CURRENCY_CODE}`);
  assert.ok(!formatMoney(1030).includes(NARROW), 'the narrow space is what nobody could see');
  // Spelled out once, so a regression is readable in the failure message.
  assert.equal(codes(formatMoney(1030)), '31 a0 30 33 30 a0 4d 52 55');
});

it('the amount never wraps away from MRU, and digits never wrap apart', () => {
  const text = formatMoney(1500000);
  assert.ok(!/ /.test(text), 'no ordinary space may appear: every gap must be non-breaking');
  assert.equal(text, `1${NBSP}500${NBSP}000${NBSP}${CURRENCY_CODE}`);
});

// ── the sizes a shop actually sees ───────────────────────────────────────────

it('small amounts are not grouped', () => {
  assert.equal(formatMoney(45), `45${NBSP}${CURRENCY_CODE}`);
  assert.equal(formatMoney(999), `999${NBSP}${CURRENCY_CODE}`);
});

it('four figures group once', () => {
  assert.equal(formatMoney(1030), `1${NBSP}030${NBSP}${CURRENCY_CODE}`);
  assert.equal(formatMoney(9999), `9${NBSP}999${NBSP}${CURRENCY_CODE}`);
});

it('six figures group twice', () => {
  assert.equal(formatMoney(38000), `38${NBSP}000${NBSP}${CURRENCY_CODE}`);
  assert.equal(formatMoney(123456), `123${NBSP}456${NBSP}${CURRENCY_CODE}`);
});

it('negatives keep their sign in front of the grouped number', () => {
  assert.equal(formatMoney(-60000), `-60${NBSP}000${NBSP}${CURRENCY_CODE}`);
  assert.equal(formatNumber(-1234), `-1${NBSP}234`);
});

it('decimals survive, with a comma, and grouping applies only to the whole part', () => {
  assert.equal(formatMoney(1234.5, { decimals: 2 }), `1${NBSP}234,50${NBSP}${CURRENCY_CODE}`);
  assert.equal(formatMoney(0.5, { decimals: 2 }), `0,50${NBSP}${CURRENCY_CODE}`);
});

it('a signed value leads with + only when asked, and only when positive', () => {
  assert.equal(formatMoney(2500, { signed: true }), `+2${NBSP}500${NBSP}${CURRENCY_CODE}`);
  assert.equal(formatMoney(-2500, { signed: true }), `-2${NBSP}500${NBSP}${CURRENCY_CODE}`);
  assert.equal(formatMoney(2500), `2${NBSP}500${NBSP}${CURRENCY_CODE}`);
});

it('a column already labelled as money can drop the currency', () => {
  assert.equal(formatMoney(1030, { showCurrency: false }), `1${NBSP}030`);
});

it('absent is not zero', () => {
  assert.equal(formatMoney(null), ABSENT);
  assert.equal(formatMoney(undefined), ABSENT);
  assert.equal(formatMoney(0), `0${NBSP}${CURRENCY_CODE}`, 'a measured zero is a number');
  assert.equal(isMoneyHidden(null), true);
  assert.equal(isMoneyHidden(0), false);
});

// ── Arabic ───────────────────────────────────────────────────────────────────

it('Arabic keeps Latin digits and the same grouping, so the run can be isolated', () => {
  /*
   * Mauritanian commerce writes prices in Western Arabic numerals even in
   * Arabic text (see USE_LATIN_DIGITS). The screens wrap the result in
   * `isolateLtr`, which only works if the amount is one unbroken run — which is
   * exactly what non-breaking spaces make it.
   */
  const text = formatMoney(1030);
  assert.match(text, /^[\d ]+ MRU$/, 'no bidi-sensitive punctuation inside the amount');
  assert.ok(!/[٠-٩]/.test(text), 'never Eastern Arabic-Indic digits');
});

// ── quantities and percentages ───────────────────────────────────────────────

it('quantities group but never carry currency', () => {
  assert.equal(formatQuantity(1284), `1${NBSP}284`);
  assert.equal(formatQuantity(7), '7');
  assert.equal(formatQuantity(null), ABSENT);
});

it('percentages are whole by default and grouped when large', () => {
  assert.equal(formatPercent(12), '12%');
  assert.equal(formatPercent(141531), `141${NBSP}531%`);
});

// ── identifiers are never numbers ────────────────────────────────────────────

it('no screen passes an identifier, year or storage size through a number formatter', () => {
  /*
   * `2026` must never render as `2 026`, and an IMEI must never be grouped at
   * all. Identifiers go through the `Identifier` primitive, which formats
   * nothing. This scans the call sites rather than trusting the convention.
   */
  const here = path.dirname(fileURLToPath(import.meta.url));
  const mobile = path.resolve(here, '..');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) files.push(full);
    }
  };
  for (const dir of ['app', 'components', 'lib']) walk(path.join(mobile, dir));

  const forbidden = /\b(?:formatNumber|formatQuantity|formatMoney)\(\s*[^)]*\b(imei|serial|barcode|phone|year|storage|identifier)\b/i;
  const offenders = files
    .map((f) => ({ f, hit: fs.readFileSync(f, 'utf8').match(forbidden) }))
    .filter((x) => x.hit !== null)
    .map((x) => path.relative(mobile, x.f) + ': ' + x.hit![0]);

  assert.deepEqual(offenders, [], 'an identifier must never be grouped like an amount');
});

console.log('\n' + passed + ' passed');
