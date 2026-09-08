/**
 * How a selector sheet behaves when it opens.
 *
 *   node components/overlay/select-sheet.test.ts
 *
 * The failure this is written against is a picker that opens showing nothing
 * and waits to be searched. It is a small thing that makes an app feel hostile:
 * a shopkeeper choosing 256 GB should see 256 GB, not an empty box and a
 * cursor. Everything below is about what is on screen before anybody types.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { visibleOptions } from './select-filter.ts';

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

const withoutComments = (t: string): string =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

interface Option {
  key: string;
  label: string;
  description?: string;
  identifier?: string;
}

const STORAGE: Option[] = [
  { key: '64gb', label: '64 GB' },
  { key: '128gb', label: '128 GB' },
  { key: '256gb', label: '256 GB' },
  { key: '512gb', label: '512 GB' },
  { key: 'other', label: 'Other' },
];

const SUPPLIERS: Option[] = [
  { key: 's1', label: 'Nouakchott Wholesale', description: 'Owes 12,000', identifier: '+222 45 00 00 00' },
  { key: 's2', label: 'Atar Electronics', description: 'Settled', identifier: '+222 46 11 11 11' },
];

const filter = (items: Option[], query: string, serverFiltered = false) =>
  visibleOptions({
    items,
    query,
    serverFiltered,
    label: (o) => o.label,
    description: (o) => o.description,
    identifier: (o) => o.identifier,
  });

// ── what is on screen before anybody types ────────────────────────────────

it('shows every option before a single character is typed', () => {
  assert.deepEqual(filter(STORAGE, ''), STORAGE);
});

it('treats whitespace as no query, not as a search for a space', () => {
  // A stray space from a keyboard suggestion must not empty the list.
  for (const blank of ['   ', '\t', '\n']) {
    assert.deepEqual(filter(STORAGE, blank), STORAGE);
  }
});

it('never returns an empty list for an empty query, even with many options', () => {
  const many = Array.from({ length: 200 }, (_, i) => ({ key: String(i), label: `Option ${i}` }));
  assert.equal(filter(many, '').length, 200);
});

// ── searching, once somebody does type ────────────────────────────────────

it('matches on the label', () => {
  assert.deepEqual(filter(STORAGE, '256').map((o) => o.key), ['256gb']);
});

it('ignores case and surrounding whitespace', () => {
  assert.deepEqual(filter(SUPPLIERS, '  ATAR ').map((o) => o.key), ['s2']);
});

it('matches on the quiet lines too, not just the headline', () => {
  // Somebody looking for a supplier by the phone number on an invoice.
  assert.deepEqual(filter(SUPPLIERS, '46 11').map((o) => o.key), ['s2']);
  assert.deepEqual(filter(SUPPLIERS, 'settled').map((o) => o.key), ['s2']);
});

it('returns nothing when nothing matches, so "create" can be offered', () => {
  assert.deepEqual(filter(SUPPLIERS, 'zzzz'), []);
});

it('leaves a server-filtered list exactly as the server returned it', () => {
  /*
   * The server may have matched on a field the client never received. Filtering
   * again locally would hide rows the server deliberately included — the search
   * would appear to lose results as you type.
   */
  assert.deepEqual(filter(SUPPLIERS, 'zzzz', true), SUPPLIERS);
});

// ── the sheet's own presentation ──────────────────────────────────────────

it('the search box does not open the keyboard when the sheet appears', () => {
  /*
   * The whole point of the list being full on open: if the keyboard slides up
   * with it, it covers the options the user came to look at, and the sheet
   * effectively demands a search it did not need.
   *
   * `SearchInput` defaults `autoFocus` to false, so this asserts the sheet does
   * not opt in.
   */
  const sheet = withoutComments(readFileSync('components/overlay/SelectSheet.tsx', 'utf8'));
  const searchInput = withoutComments(readFileSync('components/ui/SearchInput.tsx', 'utf8'));
  assert.ok(!/autoFocus/.test(sheet), 'SelectSheet must not autoFocus its search box');
  assert.match(searchInput, /autoFocus = false/, 'SearchInput must default to not focused');
});

it('a selected row is announced as selected, not merely coloured', () => {
  // Colour alone is never a state signal — a screen reader has to hear it too.
  const row = withoutComments(readFileSync('components/ui/ListRow.tsx', 'utf8'));
  assert.match(row, /accessibilityState=\{\{[^}]*selected[^}]*\}\}/);
});

it('a selected row carries a checkmark as well as a background', () => {
  const sheet = withoutComments(readFileSync('components/overlay/SelectSheet.tsx', 'utf8'));
  assert.match(sheet, /isSelected \? \(/);
  assert.match(sheet, /<Check /);
});

it('the sheet keeps a grabber and a close action', () => {
  const sheet = withoutComments(readFileSync('components/overlay/BottomSheet.tsx', 'utf8'));
  assert.match(sheet, /styles\.handle/);
  assert.match(sheet, /icon=\{X\}/);
});

it('the sheet surface is opaque, so the list behind it cannot show through', () => {
  const sheet = readFileSync('components/overlay/BottomSheet.tsx', 'utf8');
  const sheetStyle = sheet.slice(sheet.indexOf('  sheet: {'));
  const decl = sheetStyle.slice(0, sheetStyle.indexOf('},'));
  assert.match(decl, /backgroundColor: colors\.surface\.card/);
  assert.ok(!/rgba|opacity/.test(decl), 'the sheet surface must not be translucent');
});

it('sheet motion comes from the shared tokens, not from local numbers', () => {
  const sheet = withoutComments(readFileSync('components/overlay/BottomSheet.tsx', 'utf8'));
  assert.match(sheet, /motionPlan\('sheet'/);
  // No bare millisecond literals left behind in the animation calls.
  assert.ok(!/duration:\s*\d+/.test(sheet), 'sheet durations must come from the motion layer');
});

it('Reduce Motion stops the sheet travelling', () => {
  const sheet = withoutComments(readFileSync('components/overlay/BottomSheet.tsx', 'utf8'));
  assert.match(sheet, /useReducedMotion\(\)/);
  // With movement off the offscreen position IS the resting position, so it
  // cross-fades in place rather than sliding.
  assert.match(sheet, /plan\.movement \? screenHeight : 0/);
});

console.log(`select sheet: ${passed} passed`);
