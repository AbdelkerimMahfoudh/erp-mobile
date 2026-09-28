/**
 * A financial amount is never cut (docs/61 §8): the fit's order, its floor, the
 * split into number and currency, and that nothing in the app can put a line
 * limit — the "…" — on a money figure.
 *
 *   node lib/money-fit.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESTABLISHED_MIN_SCALE, FULL, fitMoney, fittedWidth, isFull, nextRoom, shrinkFloor } from './money-fit.ts';
import { breakableNumber, formatMoney, joinMoney, moneyParts } from './money-format.ts';
import { type } from './design/tokens.ts';

const BODY = type.body.fontSize;
const floorOf = (size: { fontSize: number }) => shrinkFloor(size.fontSize, BODY);

test('the floor is the app’s established 0.7, never below body size, never above full size', () => {
  assert.equal(ESTABLISHED_MIN_SCALE, 0.7);
  assert.equal(floorOf(type.moneyDisplay), 0.7); // 32 → 22.4, above body
  assert.equal(floorOf(type.moneyLarge), 0.7); // 22 → 15.4, above body
  assert.ok(floorOf(type.money) * type.money.fontSize >= BODY - 1e-9); // 17 → no smaller than body
  assert.equal(floorOf(type.moneySmall), 1); // already body size: never shrinks
  for (const size of [type.moneyDisplay, type.moneyLarge, type.money, type.moneySmall]) {
    assert.ok(floorOf(size) * size.fontSize >= Math.min(size.fontSize, BODY) - 1e-9, 'never below body size');
  }
});

test('1 — it fits: full size on one line', () => {
  assert.deepEqual(fitMoney(300, 180, 260, 0.7), FULL);
  assert.deepEqual(fitMoney(260, 180, 260, 0.7), FULL);
  assert.deepEqual(fitMoney(259.5, 180, 260, 0.7), FULL, 'a sub-pixel difference is not a lack of room');
});

test('2 — a little short: one line, a little smaller, rounded down so it fits', () => {
  // Results' Profit at 320 pt with text 1.3×: 269 px wanted, 254 px given.
  const fit = fitMoney(254, 190, 269, 0.7);
  assert.equal(fit.currencyBelow, false);
  assert.equal(fit.wrapNumber, false);
  assert.equal(fit.scale, 0.94);
  assert.ok(269 * fit.scale <= 254);
});

test('3 — too short for one line even at the floor: MRU on the next line, the number as large as fits', () => {
  // Expenses' Cash in store now: 240 px wanted, 198 given → 0.82 ≥ 0.7, still one line.
  assert.equal(fitMoney(198, 170, 240, 0.7).currencyBelow, false);
  // A long figure in half a card: one line would need 0.55.
  const fit = fitMoney(120, 110, 220, 0.7);
  assert.equal(fit.currencyBelow, true);
  assert.equal(fit.scale, 1, 'the number alone fits at full size');
  const shrunk = fitMoney(120, 150, 240, 0.7);
  assert.equal(shrunk.currencyBelow, true);
  assert.equal(shrunk.scale, 0.8);
  assert.ok(150 * shrunk.scale <= 120);
  assert.equal(shrunk.wrapNumber, false);
});

test('4 — the number itself too long at the floor: broken between digit groups, never cut', () => {
  const fit = fitMoney(100, 300, 380, 0.7);
  assert.deepEqual(fit, { scale: 0.7, currencyBelow: true, wrapNumber: true });
  // Without a currency there is nothing to move: the floor, then the groups.
  assert.deepEqual(fitMoney(100, 300, 300, 0.7), { scale: 0.7, currencyBelow: false, wrapNumber: true });
  assert.equal(fittedWidth(fit, 300, 380), null);
});

test('a small figure never shrinks: it moves MRU instead', () => {
  const fit = fitMoney(100, 90, 130, 1);
  assert.deepEqual(fit, { scale: 1, currencyBelow: true, wrapNumber: false });
});

test('nothing measured yet: full size, as today', () => {
  assert.deepEqual(fitMoney(0, 100, 150, 0.7), FULL);
  assert.deepEqual(fitMoney(200, 0, 150, 0.7), FULL);
  assert.ok(isFull(FULL));
});

test('the room: a stretched box is the room; a box hugging the fitted figure is not; a squeeze or more space is', () => {
  // Full size: whatever the box says.
  assert.equal(nextRoom(0, 254, FULL, 190, 269), 254);
  assert.equal(nextRoom(254, 300, FULL, 190, 269), 300);
  const fit = fitMoney(254, 190, 269, 0.7); // 0.94 → 252.86 px wide
  // At the end of a row the box now hugs the fitted figure: the room stays, or it would shrink again and again.
  assert.equal(nextRoom(254, 252.9, fit, 190, 269), 254);
  // More space arrived (a rotation): it is taken.
  assert.equal(nextRoom(254, 320, fit, 190, 269), 320);
  // Squeezed below the fitted figure: it is taken.
  assert.equal(nextRoom(254, 200, fit, 190, 269), 200);
});

test('the boundary figures split and join back exactly as formatMoney writes them', () => {
  const cases: Array<[number, boolean, string]> = [
    [0, false, '0 MRU'],
    [-9500, false, '-9 500 MRU'],
    [27648, false, '27 648 MRU'],
    [999999, false, '999 999 MRU'],
    [12345678, false, '12 345 678 MRU'],
    [38350, true, '+38 350 MRU'],
  ];
  for (const [value, signed, shown] of cases) {
    const parts = moneyParts(value, { signed });
    assert.equal(joinMoney(parts), formatMoney(value, { signed }));
    assert.equal(joinMoney(parts).replace(/ /g, ' '), shown);
    assert.equal(parts.currency, 'MRU');
  }
  assert.equal(joinMoney(moneyParts(1234.5, { decimals: 2 })).replace(/ /g, ' '), '1 234,50 MRU');
  assert.deepEqual(moneyParts(700, { showCurrency: false }), { number: '700', currency: null });
  // The last resort breaks between whole groups, the sign kept on the first.
  assert.equal(breakableNumber(moneyParts(-12345678).number), '-12 345 678');
  assert.ok(!/ /.test(breakableNumber(moneyParts(-12345678).number)));
});

// ── the source: nothing may put a line limit on a money figure ──

const M = fileURLToPath(new URL('../', import.meta.url));
const code = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.tsx') ? [p] : [];
  });

test('MoneyValue never limits its lines, never shrinks by itself past the fit, and reads as one figure', () => {
  const src = code(readFileSync(join(M, 'components/ui/MoneyValue.tsx'), 'utf8'));
  assert.ok(!/numberOfLines|adjustsFontSizeToFit|ellipsizeMode/.test(src), 'no line limit and no silent shrink');
  assert.match(src, /fitMoney\(m\.room, m\.number, m\.inline, shrinkFloor\(base\.fontSize as number, type\.body\.fontSize\)\)/);
  assert.match(src, /accessibilityLabel=\{accessibilityLabel \?\? \(text === whole \? undefined : whole\)\}/);
  assert.match(src, /maxWidth: '100%'/);
});

test('no money figure anywhere is drawn in a line-limited text (the scan)', () => {
  const limited: string[] = [];
  let seen = 0;
  for (const file of [...files(join(M, 'app')), ...files(join(M, 'components'))]) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/formatMoney\(|formatSignedMoney\(/g)) {
      // The nearest <Text> still open at this call.
      let i = m.index ?? 0;
      let open = -1;
      let depth = 0;
      while (i > 0) {
        const o = src.lastIndexOf('<Text', i - 1);
        const c = src.lastIndexOf('</Text>', i - 1);
        if (o < 0) break;
        if (c > o) { depth += 1; i = c; continue; }
        if (depth > 0) { depth -= 1; i = o; continue; }
        open = o;
        break;
      }
      if (open < 0) continue;
      let j = open + 5;
      let brace = 0;
      for (; j < src.length; j++) {
        const ch = src[j];
        if (ch === '{') brace++;
        else if (ch === '}') brace--;
        else if (ch === '>' && brace === 0) break;
      }
      if (j > (m.index ?? 0)) continue; // inside the tag's props (an accessibility label), not its text
      seen++;
      if (/numberOfLines|adjustsFontSizeToFit/.test(src.slice(open, j))) limited.push(`${file}:${src.slice(0, m.index).split('\n').length}`);
    }
  }
  assert.ok(seen > 30, `the scan saw the money text (${seen})`);
  assert.deepEqual(limited, []);
  // A formatted money string is never handed to something that draws it on one line: a row's or tile's value, a
  // picker's value, a confirmation card's button — and a button whose label carries an amount wraps instead.
  const oneLine: string[] = [];
  for (const file of [...files(join(M, 'app')), ...files(join(M, 'components'))]) {
    const flat = code(readFileSync(file, 'utf8')).replace(/\s+/g, ' ');
    if (/<(?:ListRow|StatTile)\b[^>]*\bvalue=\{formatMoney\(/.test(flat)) oneLine.push(`${file}: a row or tile value`);
    if (/valueExtractor=\{[^}]*formatMoney\(/.test(flat)) oneLine.push(`${file}: a picker value`);
    if (/confirmLabel=\{[^}]*formatMoney\(/.test(flat)) oneLine.push(`${file}: a confirmation label`);
    for (const b of flat.matchAll(/<Button\b((?:[^<>]|=>)*?)\/>/g)) {
      // The title's own expression only — an amount in a dialog opened by the button is not in its label.
      const title = b[1].match(/\btitle=\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}/)?.[1] ?? '';
      if (/formatMoney\(/.test(title) && !/\bwrap\b/.test(b[1])) oneLine.push(`${file}: a button label with an amount`);
    }
  }
  assert.deepEqual(oneLine, []);
  // A standalone amount — a text holding nothing but a formatted figure — is a MoneyValue, which fits and never
  // runs past its card; a plain text cannot break "12 345 678 MRU" (its spaces do not break).
  const standalone: string[] = [];
  for (const file of [...files(join(M, 'app')), ...files(join(M, 'components'))]) {
    const src = code(readFileSync(file, 'utf8'));
    for (const m of src.matchAll(/<Text\b[^>]*>\s*\{\s*formatMoney\((?:[^()]|\([^()]*\))*\)\s*\}\s*<\/Text>/g)) {
      standalone.push(`${file}:${src.slice(0, m.index).split('\n').length}`);
    }
  }
  assert.deepEqual(standalone, [], 'a standalone amount drawn as plain text');
  const button = code(readFileSync(join(M, 'components/ui/Button.tsx'), 'utf8'));
  assert.match(button, /numberOfLines=\{wrap \? undefined : 1\}/);
  assert.match(code(readFileSync(join(M, 'app/(tabs)/sell.tsx'), 'utf8')), /title=\{t\('sell\.charge', \{ amount: isolateLtr\(formatMoney\(total\)\) \}\)\}\s*size="lg"\s*fullWidth\s*wrap/);
});

test('a label and its amount: side by side while the amount needs at most half the row, the amount below it after that', () => {
  const rule = code(readFileSync(join(M, 'lib/design/amount-row.ts'), 'utf8'));
  assert.match(rule, /AMOUNT_ROW = \{\s*flexDirection: 'row',\s*flexWrap: 'wrap',/, 'the amount may move to its own line');
  assert.match(rule, /AMOUNT_LABEL = \{\s*flexGrow: 1,\s*flexShrink: 1,\s*flexBasis: '50%',\s*minWidth: 0,\s*\}/, 'the label keeps at least half the row');
  // The shared list row and the statement lines of Results, the Daily closing and its popup all follow it.
  const listRow = code(readFileSync(join(M, 'components/ui/ListRow.tsx'), 'utf8'));
  assert.match(listRow, /main: \{\s*flex: 1,\s*\.\.\.AMOUNT_ROW,\s*\}/);
  assert.match(listRow, /body: \{\s*\.\.\.AMOUNT_LABEL,/);
  assert.match(listRow, /<View style=\{styles\.main\}>\s*<View style=\{styles\.body\}>/);
  for (const file of ['app/money.tsx', 'app/closing/index.tsx', 'components/closing/CloseDaySheet.tsx']) {
    const src = code(readFileSync(join(M, file), 'utf8'));
    assert.match(src, /line: \{ \.\.\.AMOUNT_ROW,/, file);
    assert.match(src, /lineLabel: AMOUNT_LABEL,/, file);
    assert.match(src, /style=\{styles\.lineLabel\}>\s*\{label\}\s*<\/Text>\s*<MoneyValue/, file);
  }
});
