/**
 * Dismissing the keyboard — the callbacks, exercised.
 *
 *   node lib/keyboard-dismiss.test.ts
 *
 * ## Why this file exists in this shape
 *
 * The previous attempt at this defect was tested by counting
 * `onPress={Keyboard.dismiss}` in `Screen`. Three were present, the count was
 * correct, the test passed — and on a real iPhone tapping outside the field did
 * nothing at all.
 *
 * The count was right and the conclusion was wrong. `Screen` renders its body
 * two ways, and every scan-entry page passes `scroll={false}`. Two of the three
 * dismissals were in the header and footer strips; the third was in the branch
 * those pages never render. The middle of the screen — the part somebody
 * actually taps — had no handler in it.
 *
 * So the assertions below CALL the handlers and observe what happened. A
 * structural check that a handler is wired to the right place still has to
 * happen, and it is at the end, but it is not what proves the behaviour.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dismissing, withDismiss, type KeyboardApi } from './keyboard-dismiss.ts';

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

const source = (p: string) => readFileSync(p, 'utf8');
const withoutComments = (t: string): string =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** A keyboard that records instead of closing. */
function fakeKeyboard() {
  const calls: number[] = [];
  const api: KeyboardApi = { dismiss: () => calls.push(Date.now()) };
  return { api, get dismissed() { return calls.length; } };
}

// ── 3 · tapping blank content dismisses ───────────────────────────────────

it('3 · the blank-space handler dismisses when pressed', () => {
  const kb = fakeKeyboard();
  const onPress = dismissing(kb.api);

  assert.equal(kb.dismissed, 0, 'nothing happens until it is pressed');
  onPress();
  assert.equal(kb.dismissed, 1);
});

it('3b · pressing repeatedly is harmless', () => {
  // A person tapping the background twice must not produce anything odd.
  const kb = fakeKeyboard();
  const onPress = dismissing(kb.api);
  onPress();
  onPress();
  onPress();
  assert.equal(kb.dismissed, 3);
});

it('3c · the handler does nothing except dismiss', () => {
  // It is used on the header, the body and the footer. If it did anything
  // else, every blank tap on a page would do that too.
  const kb = fakeKeyboard();
  assert.equal(dismissing(kb.api)(), undefined, 'no value, no side effect');
});

// ── 4 · a scanner action dismisses AND runs ───────────────────────────────

it('4 · the camera action dismisses the keyboard and still opens the camera', () => {
  const kb = fakeKeyboard();
  let opened = 0;
  const openCamera = withDismiss(kb.api, () => {
    opened += 1;
  });

  openCamera();

  assert.equal(kb.dismissed, 1, 'the keyboard was put away');
  assert.equal(opened, 1, 'and the camera still opened');
});

it('4b · dismissal happens BEFORE the action, not after', () => {
  /*
   * Load-bearing ordering. An action that navigates or opens a modal takes the
   * screen away, and a dismissal queued behind it can land after the thing it
   * was meant to tidy up has already gone.
   */
  const order: string[] = [];
  const api: KeyboardApi = { dismiss: () => order.push('dismiss') };
  withDismiss(api, () => order.push('action'))();

  assert.deepEqual(order, ['dismiss', 'action']);
});

it('4c · arguments and return values pass straight through', () => {
  // So it can wrap any handler without knowing anything about it.
  const kb = fakeKeyboard();
  const wrapped = withDismiss(kb.api, (a: number, b: string) => `${a}-${b}`);
  assert.equal(wrapped(7, 'x'), '7-x');
  assert.equal(kb.dismissed, 1);
});

it('4d · a throwing action still dismissed the keyboard first', () => {
  // The keyboard is out of the way even when the action fails, so a failure is
  // readable rather than half-covered.
  const kb = fakeKeyboard();
  const boom = withDismiss(kb.api, () => {
    throw new Error('nope');
  });
  assert.throws(boom, /nope/);
  assert.equal(kb.dismissed, 1);
});

// ── 6 · the value survives ────────────────────────────────────────────────

it('6 · dismissing touches no state, so nothing typed can be lost', () => {
  /*
   * Asserted as a property of the handler rather than by reading `ScanTarget`:
   * the dismissal path is given ONE capability, a keyboard, and there is
   * nothing else it could reach even if it tried.
   */
  const kb = fakeKeyboard();
  let value = '01000004100004';

  dismissing(kb.api)();
  withDismiss(kb.api, () => {})();

  assert.equal(value, '01000004100004', 'untouched');
  assert.equal(kb.dismissed, 2);

  // And the module imports nothing at all — it cannot reach state.
  assert.ok(!source('lib/keyboard-dismiss.ts').includes('import '), 'no imports, no reach');
  value = '';
});

// ── where the handlers are actually wired ─────────────────────────────────
//
// Structural, and deliberately AFTER the behavioural assertions. The bug was
// never that the handler was wrong — it was that the correct handler was
// attached to a branch the affected pages do not render.

it('every body branch has a dismissal, including the one scan pages use', () => {
  const code = withoutComments(source('components/ui/Screen.tsx'));

  // THE regression. `scroll={false}` was a plain View with no handler.
  const nonScroll = code.slice(code.indexOf('  ) : ('), code.indexOf('return ('));
  assert.match(nonScroll, /<Pressable/, 'the non-scrolling body is pressable');
  assert.match(nonScroll, /onPress=\{dismissBlank\}/);
  assert.match(nonScroll, /styles\.body/, 'and it still fills the page');

  // Four regions now: scrolling body, non-scrolling body, header, footer.
  assert.equal((code.match(/onPress=\{dismissBlank\}/g) ?? []).length, 4);
});

it('the scan pages really do use the branch that was broken', () => {
  // The reason the previous fix looked right and was not. If these ever start
  // scrolling, the assertion above stops covering them and this says so.
  for (const route of ['app/(tabs)/sell.tsx', 'app/receive.tsx']) {
    assert.match(source(route), /<Screen\s+scroll=\{false\}|<Screen scroll=\{false\}/, route);
  }
});

it('the dismissal surfaces reach the bottom of a short page', () => {
  /*
   * A `Pressable` sizes to its children. With an empty cart — which is exactly
   * when somebody is typing — it would cover a strip at the top and leave the
   * blank space below, the obvious place to tap, outside itself.
   */
  const code = withoutComments(source('components/ui/Screen.tsx'));
  assert.match(code, /grow: \{\s*flexGrow: 1,\s*\}/);
  assert.match(code, /style=\{\[styles\.grow, gap \? \{ gap: space\[gap\] \} : null\]\}/);
  assert.match(code, /contentContainerStyle=\{\[\s*styles\.grow,/);
});

it('nothing blocks controls, scrolling or the camera', () => {
  const code = withoutComments(source('components/ui/Screen.tsx'));
  assert.ok(!code.includes('TouchableWithoutFeedback'), 'no blocking wrapper');
  assert.ok(!code.includes('pointerEvents'), 'children stay tappable');
  // The first tap on a button under an open keyboard presses the button.
  assert.match(code, /keyboardShouldPersistTaps="handled"/);
  // Every surface stays out of the screen reader's order.
  assert.equal((code.match(/accessible=\{false\}/g) ?? []).length, 4);
});

it('dragging a list on a scan page dismisses the keyboard', () => {
  for (const route of ['app/(tabs)/sell.tsx', 'app/receive.tsx']) {
    assert.match(source(route), /keyboardDismissMode="on-drag"/, `${route} dismisses on drag`);
  }
});

it('the camera button is wired to the wrapped action, not a bare setter', () => {
  const code = withoutComments(source('components/scanner/ScanTarget.tsx'));
  assert.match(code, /const openCamera = withDismiss\(Keyboard, \(\) => setCameraOpen\(true\)\)/);
  assert.match(code, /onScanPress=\{openCamera\}/);
});

// ── 1, 2, 7 · focus is never taken automatically ──────────────────────────

it('1, 7 · nothing focuses an input on render, return or a scan result', () => {
  for (const file of [
    'components/scanner/ScanTarget.tsx',
    'components/scanner/ScannerSheet.tsx',
    'app/(tabs)/sell.tsx',
    'app/receive.tsx',
  ]) {
    const code = withoutComments(source(file));
    assert.ok(!code.includes('autoFocus'), `${file} must not autofocus`);
    assert.ok(!code.includes('.focus()'), `${file} must not focus imperatively`);
  }
});

it('2 · the field is a normal input, so tapping it focuses it', () => {
  /*
   * Nothing has to be added for this: a `TextInput` focuses on tap. What
   * matters is that nothing PREVENTS it — no `editable={false}`, and no
   * dismissal wrapper stealing the touch, which is why the surfaces are
   * `Pressable` around content rather than an overlay on top of it.
   */
  const search = withoutComments(source('components/ui/SearchInput.tsx'));
  assert.ok(!search.includes('editable={false}'), 'the field is always editable');
  assert.match(search, /<TextInput/);
});

// ── the corrections this must not disturb ─────────────────────────────────

it('the More header-gap fix is untouched', () => {
  const code = withoutComments(source('components/ui/Screen.tsx'));
  assert.match(code, /const headerShown = useContext\(HeaderShownContext\)/);
  assert.match(code, /const safeEdges = headerShown \? edges\.filter\(\(e\) => e !== 'top'\) : edges/);
  assert.match(code, /edges=\{safeEdges\}/);
});

it('the strict scanner ROI is untouched', () => {
  const sheet = withoutComments(source('components/scanner/ScannerSheet.tsx'));
  assert.match(sheet, /if \(enforceForCallback\(Platform\.OS, space\)\) \{/);
  assert.match(sheet, /if \(verdictRoi !== 'inside'\) return;/);
  assert.match(sheet, /const verdict = observe\(acquisition\.current, \{/);
});

console.log(`keyboard dismissal: ${passed} passed`);
