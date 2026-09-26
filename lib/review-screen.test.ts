/**
 * The imported-stock review, after the hundred-phone measurement (docs/55): rows carry
 * light named actions, every filter is in view and a full target, the pinned footer says
 * what is ready and what stands in the way, and nothing about the rules moved — unresolved
 * rows stay listed, payment stays out of reach until every one is resolved.
 *
 *   node lib/review-screen.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { devTiming } from './dev-timing.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  try { fn(); passed++; } catch (e) { console.error(`✗ ${name}`); throw e; }
};
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const code = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const screen = code(read('../app/receive/file.tsx'));
const between = (s: string, from: string, to: string) => s.slice(s.indexOf(from), s.indexOf(to, s.indexOf(from)));
const entryRow = between(screen, 'const EntryRow = React.memo(', 'function Field(');

it('a row\'s Accept, Edit, Exclude and Include again are light named actions — no Button, no icon, in the row', () => {
  for (const key of ['fileReceive.action.accept', 'fileReceive.action.edit', 'fileReceive.remove', 'fileReceive.include']) {
    assert.match(entryRow, new RegExp(`<RowAction title=\\{t\\('${key.replace(/\\./g, '\\\\.')}'\\)`), key);
  }
  assert.ok(!/<Button\b/.test(entryRow), 'no design-system Button inside a row');
  assert.ok(!/icon=\{/.test(entryRow), 'no icon inside a row');
  assert.match(entryRow, /disabled=\{!acceptable\}/);
  assert.match(entryRow, /tone="danger" onPress=\{\(\) => onRemove\(entryKey\)\}/);
});

it('the row action is a plain Pressable and one Text, 48 points tall, with no animation library', () => {
  const action = code(read('../components/receive/RowAction.tsx'));
  assert.match(action, /import \{ Pressable \} from 'react-native';/);
  assert.ok(!/reanimated|lucide/.test(action));
  assert.match(action, /minHeight: touch\.min/);
  assert.match(action, /accessibilityRole="button"/);
  assert.match(action, /accessibilityState=\{\{ disabled \}\}/);
});

it('the four filters wrap into view and are full targets; the sideways scroll is gone', () => {
  const header = between(screen, "ListHeaderComponent={", 'ListFooterComponent={');
  assert.ok(!/<ScrollView horizontal/.test(header));
  assert.match(header, /<View style=\{styles\.filters\}>/);
  assert.equal((header.match(/style=\{styles\.filterChip\}/g) ?? []).length, 4);
  assert.match(screen, /filters: \{ flexDirection: 'row', flexWrap: 'wrap', gap: space\.sm \},/);
  assert.match(screen, /filterChip: \{ height: touch\.min \},/);
});

it('the footer: ready and its total beside what stands in the way; Continue disabled until every row is resolved', () => {
  const footer = between(screen, 'footer={\n        <View style={styles.footer}>', 'ListHeaderComponent={');
  assert.match(footer, /fileReceive\.footer\.readyTotal/);
  assert.match(footer, /\{!ready \? \(\s*<Text variant="caption" tone="warning" align="end"/);
  assert.match(footer, /disabled=\{!ready \|\| counts\.ready === 0\}/);
  assert.match(screen, /const ready = reviewComplete\(batch\);/);
  // The payment step exists only behind that button.
  assert.equal((screen.match(/setStep\('payment'\)/g) ?? []).length, 1);
});

it('no row is hidden by the screen: the list is what reviewRows gives it, unresolved rows included', () => {
  assert.match(screen, /const rows = useMemo\(\(\) => \(batch \? reviewRows\(batch, groups, summaries, openKey, filter\) : \[\]\)/);
  assert.match(screen, /data=\{rows\}/);
  const rowsLib = code(read('./file-review-rows.ts'));
  assert.match(rowsLib, /const shown = filter === 'all' \? group\.entries : group\.entries\.filter\(\(e\) => entryState\(batch, e\) === filter\);/);
});

it('native text in a row may shrink and wrap; the group\'s name keeps at least half its row', () => {
  assert.match(screen, /shrink: \{ flexShrink: 1, minWidth: 0 \},/);
  assert.match(screen, /groupTrail: \{ alignItems: 'flex-end', flexShrink: 1, maxWidth: '48%' \},/);
  assert.match(entryRow, /<Identifier style=\{styles\.shrink\}>/);
});

it('the stage timings are marked at the tap and logged at the commit, and are off outside the development build', () => {
  assert.match(screen, /devTiming\.mark\('review\.expand'\);\s*setOpenKey/);
  assert.match(screen, /useLayoutEffect\(\(\) => devTiming\.end\('review\.expand', 'review: group opened'\), \[openKey\]\);/);
  assert.match(screen, /useLayoutEffect\(\(\) => devTiming\.end\('review\.filter', 'review: filter applied'\), \[filter\]\);/);
  assert.match(screen, /devTiming\.end\('review\.parsed', 'review: first list shown'\);/);
  assert.match(code(read('./file-receiving.ts')), /devTiming\.end\('review\.parse', 'review: file parsed \(round trip\)'\);/);
  assert.match(code(read('./offline/use-draft.ts')), /devTiming\.time\(`draft written \(\$\{form\}\)`, \(\) => saveDraft/);
  // Under node __DEV__ is undefined: nothing is printed and the work still runs.
  const logs: unknown[] = [];
  const original = console.log;
  console.log = (...a: unknown[]) => { logs.push(a); };
  try {
    devTiming.mark('x');
    devTiming.end('x', 'x');
    assert.equal(devTiming.time('y', () => 42), 42);
  } finally {
    console.log = original;
  }
  assert.equal(logs.length, 0);
});

it('the sheet\'s Close is a full 48-point target (docs/55 D49)', () => {
  const sheet = code(read('../components/overlay/BottomSheet.tsx'));
  assert.match(sheet, /accessibilityLabel=\{t\('action\.close'\)\}\s*onPress=\{animateOut\}\s*size=\{touch\.min\}/);
  assert.match(read('./design/tokens.ts'), /min: 48,/);
});

it('a group offers Match product only where a shared choice exists; Match products opens the first such group (docs/55 D50)', () => {
  assert.match(screen, /matchable=\{summary\.matchableKeys\.length > 0 && \(candidateCounts\.get\(item\.groupKey\) \?\? 0\) > 0\}/);
  assert.match(screen, /const first = groups\.find\(\(g\) => \(summaries\.get\(g\.key\)\?\.matchableKeys\.length \?\? 0\) > 0 && \(candidateCounts\.get\(g\.key\) \?\? 0\) > 0\);/);
  assert.match(screen, /new Map\(groups\.map\(\(g\) => \[g\.key, batch \? groupCandidates\(batch, g\)\.length : 0\]\)\)/);
});

console.log(`review-screen: ${passed} passed`);
