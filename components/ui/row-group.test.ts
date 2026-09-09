/**
 * Grouped rows, and the separator rules that make them read as a group.
 *
 *   node components/ui/row-group.test.ts
 *
 * These are cheap to get wrong and expensive to notice: a stray rule under the
 * last row looks like a rendering bug, a missing one makes two facts run
 * together, and a separator indented from the wrong side is invisible in
 * English and obvious in Arabic.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const src = (p: string) => strip(readFileSync(p, 'utf8'));

// ── the separator rule ────────────────────────────────────────────────────

it('a separator is drawn between rows, never before the first', () => {
  // `i > 0` is the whole rule. A leading hairline reads as a broken border.
  assert.match(src('components/ui/RowGroup.tsx'), /\{i > 0 \?/);
});

it('separators are never drawn after the last row either', () => {
  /*
   * Guaranteed by construction rather than by a length check: the separator is
   * rendered BEFORE each child except the first, so there is no code path that
   * can emit one with nothing under it.
   */
  const s = src('components/ui/RowGroup.tsx');
  assert.ok(!/rows\.length - 1/.test(s), 'a last-row special case means the rule is not structural');
  assert.match(s, /rows\.map\(\(child, i\)/);
});

it('the separator inset is a START margin, so it follows the writing direction', () => {
  /*
   * `marginLeft` would indent from the left in Arabic too, which puts the gap
   * on the wrong side of the row — the rule would cut under the text and stop
   * short of the icon, exactly inverted.
   */
  const s = src('components/ui/RowGroup.tsx');
  assert.match(s, /marginStart: separatorInset/);
  assert.ok(!/marginLeft|marginRight/.test(s), 'RowGroup must not use physical margins');
});

it('conditional rows cannot leave an orphaned separator', () => {
  // `Children.toArray` drops null and false, so `{cond ? <Row/> : null}` does
  // not count as a child. Without it, a hidden row still gets a rule.
  assert.match(src('components/ui/RowGroup.tsx'), /React\.Children\.toArray/);
});

it('the group clips its children, so first and last rows round with it', () => {
  assert.match(src('components/ui/RowGroup.tsx'), /overflow: 'hidden'/);
});

// ── flat rows do not separate themselves ──────────────────────────────────

it('a flat row draws no border of its own', () => {
  /*
   * The regression this guards: `flat` used to add `borderBottomWidth`, which
   * left a rule under the final row of every list and doubled up inside any
   * container that also separated them.
   */
  const s = src('components/ui/ListRow.tsx');
  const flat = s.slice(s.indexOf('flat: {'), s.indexOf('}', s.indexOf('flat: {')));
  assert.match(flat, /borderRadius: 0/);
  assert.match(flat, /borderWidth: 0/);
  assert.ok(!/borderBottomWidth/.test(flat), 'the container owns separation, not the row');
});

// ── the containers that own separation ────────────────────────────────────

it('the catalog list separates its own rows', () => {
  const s = src('app/catalog/index.tsx');
  assert.match(s, /ItemSeparatorComponent/);
  assert.match(s, /marginStart:/, 'the separator inset must be direction-aware');
  assert.ok(!/marginLeft/.test(s));
});

it('screens that map flat rows wrap them in a group', () => {
  /*
   * A run of borderless rows with a gap between them is worse than the cards it
   * replaced — floating blocks of text with nothing saying where one ends. If a
   * screen uses `flat` it must have something owning the separation.
   */
  for (const file of ['app/(tabs)/inventory.tsx', 'app/(tabs)/index.tsx', 'app/analytics.tsx']) {
    const s = src(file);
    if (!/\bflat\b/.test(s)) continue;
    assert.match(s, /<RowGroup/, `${file} uses flat rows without a group to separate them`);
  }
});

console.log(`row group: ${passed} passed`);
