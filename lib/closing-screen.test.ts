/**
 * The Daily Closing screen's structure — the rules the handset lag came from.
 *
 *   node lib/closing-screen.test.ts
 *
 * Read from source, because these are guarantees about SHAPE: what sits above
 * the rows, what answers a touch, what re-renders when one count is saved. A
 * screen that scrolls today proves nothing about the one after somebody wraps
 * a row in a Pressable; a screen with no such wrapper does.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync(new URL('../app/closing/count.tsx', import.meta.url), 'utf8');
const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** The open-day component only — the locked day and the loading state keep `Screen`. */
const between = (from: string, to: string) => {
  const start = code.indexOf(from);
  const end = code.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `${from} … ${to} not found`);
  return code.slice(start, end);
};
const COUNTING = between('function CountingDay', 'interface ChannelLineProps');
const ROW = between('const ChannelLine = memo(', 'function SettledLine');

describe('no gesture layer above the rows', () => {
  it('the counting screen composes its own safe area and list, not the body-dismissing Screen', () => {
    assert.ok(COUNTING.includes('<SafeAreaView'), 'own safe area');
    assert.ok(COUNTING.includes('<KeyboardAvoidingView'), 'own keyboard avoidance');
    assert.ok(COUNTING.includes('<FlatList'), 'a virtualised list');
    assert.equal(COUNTING.includes('<Screen'), false, 'no Screen — its body Pressable would sit above every row');
  });

  it('nothing wraps a row or the list in a Pressable or Touchable', () => {
    assert.doesNotMatch(code, /<Pressable|<Touchable|TouchableOpacity|TouchableWithoutFeedback/);
  });

  it('no vertical ScrollView is nested inside the list', () => {
    assert.equal(COUNTING.includes('<ScrollView'), false);
    assert.equal(ROW.includes('<ScrollView'), false);
  });
});

describe('the keyboard', () => {
  it('a tap on Save is not spent closing the keyboard', () => {
    assert.match(COUNTING, /keyboardShouldPersistTaps="handled"/);
  });

  it('the pinned action is lifted on iOS and the list reserves the footer’s measured height', () => {
    assert.match(COUNTING, /behavior=\{Platform\.OS === 'ios' \? 'padding' : undefined\}/);
    assert.match(COUNTING, /onLayout=\{measureFooter\}/);
    assert.match(COUNTING, /paddingBottom: footerHeight \+ space\['3xl'\]/);
  });

  it('a row holding a focused field is never unmounted by clipping', () => {
    assert.match(COUNTING, /removeClippedSubviews=\{false\}/);
  });
});

describe('rendering', () => {
  it('rows are memoised on what they show, and the submit handler never changes identity', () => {
    assert.match(code, /const ChannelLine = memo\(function ChannelLine/);
    assert.match(code, /\}, sameRow\);/);
    assert.match(COUNTING, /const submit = useCallback\(/);
    assert.match(COUNTING, /\[recordCount\],/);
  });

  it('saving names one row, so the other rows are left alone', () => {
    assert.match(COUNTING, /saving=\{saving === rowKey\(item\)\}/);
    assert.ok(/a\.saving === b\.saving/.test(code), 'the memo compares the saving flag');
  });

  it('keys are stable and every row has one explicit Save', () => {
    assert.match(code, /const rowKey = \(c: Pick<ChannelRow, 'channel' \| 'accountId'>\) => `\$\{c\.channel\}:\$\{c\.accountId \?\? 'none'\}`/);
    assert.match(ROW, /title=\{t\('closing\.row\.save'\)\}/);
    assert.equal((ROW.match(/onChangeText=\{setValue\}/g) ?? []).length, 1, 'typing updates the row only');
    assert.equal(ROW.includes('onSubmit({ ...body, counted'), true);
  });

  it('nothing refetches on a keystroke', () => {
    assert.doesNotMatch(ROW, /refetch|invalidateQueries|useQuery\(/);
  });
});

describe('what the person sees', () => {
  /*
   * docs/51 D2: counting is OPTIONAL. The screen says so, adds nothing up on the
   * phone, and never carries the close — which lives on the Daily closing report.
   * The old "0 of 2 counted" chip and the "Review and close" button disabled until
   * every channel was counted are gone for good.
   */
  it('an optional check: says so, sums nothing, and hands back to the report instead of closing', () => {
    assert.match(COUNTING, /t\('closingCheck\.intro'\)/);
    assert.match(COUNTING, /title=\{t\('closingCheck\.back'\)\}/);
    assert.doesNotMatch(code, /closing\.summary\.(expected|counted|difference|progress)/, 'no phone-side totals');
    assert.doesNotMatch(code, /closing\.progress\.remaining/, 'no "N remaining" pressure');
    assert.doesNotMatch(code, /useSignOffDay|signOff\.|t\('closing\.review'\)|closing\.review\.blocked/, 'no sign-off here');
    assert.doesNotMatch(code, /day\.complete/, 'nothing waits for every channel to be counted');
  });

  it('a saved or stale count can be counted again; an account is asked for its movement, not its balance', () => {
    assert.match(ROW, /t\(account \? 'closingCheck\.recheck' : 'closingCheck\.recount'\)/);
    assert.match(ROW, /row\.stale/);
    assert.match(ROW, /t\('closingCheck\.accountPrompt'\)/);
    assert.doesNotMatch(ROW, /closing\.countedBalance/);
  });

  it('no per-account card, and no full-width ghost button to clip at the edge', () => {
    assert.equal(ROW.includes('<Card'), false, 'a row is not a card');
    assert.doesNotMatch(code, /variant="ghost"/);
    assert.equal((COUNTING.match(/<Card/g) ?? []).length, 1, 'the summary is the one card on the open day');
  });

  it('uses tokens and the catalogue — no raw colour, no hardcoded copy', () => {
    assert.doesNotMatch(code, /#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    // Every string a person reads comes through `t(`: no JSX text literal.
    assert.doesNotMatch(code, />\s*[A-Za-z][A-Za-z ,.'’!?]+\s*</, 'a JSX text literal');
    assert.doesNotMatch(code, /(title|label|placeholder|accessibilityLabel)="[A-Za-z]/, 'a hardcoded prop string');
  });
});
