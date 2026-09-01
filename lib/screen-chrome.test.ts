/**
 * Two UI defects a phone found, and the shared causes behind them.
 *
 *   node lib/screen-chrome.test.ts
 *
 * 1. Every page opened from More had a large empty band between the navigation
 *    header and the first line of content.
 * 2. Every scan-entry page raised the keyboard the moment it opened, covering
 *    most of the screen before anybody had asked to type.
 *
 * Both were single shared causes rather than per-page mistakes, which is why
 * these assertions are about `Screen` and `ScanTarget` and not about the two
 * pages the screenshots happened to show.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

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

const SCREEN = 'components/ui/Screen.tsx';
const SCAN_TARGET = 'components/scanner/ScanTarget.tsx';
const SHEET = 'components/scanner/ScannerSheet.tsx';

/** Every `.tsx` route under `app/`, recursively. */
function routes(dir = 'app'): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routes(full));
    else if (entry.endsWith('.tsx')) out.push(full.replace(/\\/g, '/'));
  }
  return out;
}

// ── 1 · the gap under the navigation header ───────────────────────────────

it('the top safe area is dropped when a native header is shown', () => {
  /*
   * THE cause. The native header already sits under the status bar and consumes
   * that inset; `Screen` then applied `edges: ['top']` and reserved it a second
   * time. On a notched phone that is roughly fifty points of nothing between
   * the title and the first line of content.
   */
  const code = withoutComments(source(SCREEN));
  assert.match(code, /const headerShown = useContext\(HeaderShownContext\)/);
  assert.match(code, /const safeEdges = headerShown \? edges\.filter\(\(e\) => e !== 'top'\) : edges/);
  assert.match(code, /edges=\{safeEdges\}/);
  assert.ok(!/edges=\{edges\}/.test(code), 'the raw edges must not reach SafeAreaView');
});

it('the signal is read as context, because the hook throws without a header', () => {
  // `useHeaderHeight()` throws when there is no header, and a hook that throws
  // cannot be called unconditionally. `HeaderShownContext` defaults to false.
  // Stripped of comments: the doc above the fix explains WHY `useHeaderHeight`
  // is unusable, and a naive search would match that explanation.
  const code = withoutComments(source(SCREEN));
  assert.match(code, /HeaderShownContext/);
  assert.ok(!code.includes('useHeaderHeight'), 'a throwing hook must not be called here');
  // The reasoning is recorded, though.
  assert.match(source(SCREEN), /which throws when there\s+\* is no header/);
});

it('tab pages keep the inset they genuinely need', () => {
  /*
   * The fix must not reach the tabs. Both the root stack and the tab navigator
   * set `headerShown: false`, so the context is false there and `edges` is
   * untouched — which is why this is one change rather than forty-six.
   */
  for (const layout of ['app/_layout.tsx', 'app/(tabs)/_layout.tsx']) {
    assert.match(source(layout), /headerShown: false/, `${layout} hides its header`);
  }
  // And no tab screen declares one.
  for (const route of routes('app/(tabs)')) {
    assert.ok(
      !source(route).includes('headerShown: true'),
      `${route} must not show a native header`,
    );
  }
});

it('every More route inherits the fix rather than patching itself', () => {
  /*
   * The screenshot was "Ventes et retours" — a hub, `app/hub/[id].tsx`. Every
   * route reachable from More renders through the same `Screen`, so none of
   * them should be compensating with its own top padding.
   */
  const withHeaders = routes().filter((r) => source(r).includes('headerShown: true'));
  assert.ok(withHeaders.length > 20, `expected many header routes, found ${withHeaders.length}`);
  assert.ok(withHeaders.includes('app/hub/[id].tsx'), 'the More hub is one of them');

  for (const route of withHeaders) {
    const code = withoutComments(source(route));
    // No route may re-add the top inset itself, which would restore the gap
    // one page at a time.
    assert.ok(
      !/paddingTop:\s*insets\.top/.test(code),
      `${route} must not re-add the top inset`,
    );
    assert.ok(
      !/edges=\{\['top'\]\}/.test(code),
      `${route} must not force the top edge back on`,
    );
  }
});

it('spacing inside a page is left alone', () => {
  // Only the doubled chrome inset was removed. The hub still separates its
  // description from the list, and that is deliberate.
  const hub = source('app/hub/[id].tsx');
  assert.match(hub, /intro: \{ marginBottom: space\.md \}/);
  // Tokens, never raw numbers.
  assert.ok(!/marginTop:\s*\d+/.test(withoutComments(hub)), 'no raw spacing numbers');
});

// ── 2 · the keyboard on scan-entry pages ──────────────────────────────────

it('no scan-entry input can autofocus, and the prop is gone entirely', () => {
  /*
   * Removed rather than defaulted to false: a prop that still exists is a prop
   * a future page can pass, and this defect arrived as one word on two pages.
   */
  const target = withoutComments(source(SCAN_TARGET));
  assert.ok(!target.includes('autoFocus'), 'ScanTarget takes no autoFocus at all');

  for (const route of ['app/(tabs)/sell.tsx', 'app/receive.tsx']) {
    assert.ok(
      !withoutComments(source(route)).includes('autoFocus'),
      `${route} must not autofocus anything`,
    );
  }

  // The scanner's own manual fallback too — it is also reached by a DENIED
  // permission, where the keyboard would cover the explanation.
  assert.ok(!withoutComments(source(SHEET)).includes('autoFocus'));
});

it('a scan result does not raise the keyboard', () => {
  // The price field appears because something was scanned. The confirmation is
  // the thing to read, and a keyboard is exactly what would cover it.
  const sell = withoutComments(source('app/(tabs)/sell.tsx'));
  const card = sell.slice(sell.indexOf('pending.needsPrice ?'), sell.indexOf('</ProductConfirmationCard>'));
  assert.ok(!card.includes('autoFocus'), 'the post-scan price field must not autofocus');
  assert.match(card, /<MoneyField/, 'and the field is still there');
});

it('opening the camera dismisses the keyboard first', () => {
  /*
   * The ordering used to be asserted by reading which call came first in an
   * inline arrow. It now lives in `withDismiss`, and is PROVEN by calling it —
   * see `lib/keyboard-dismiss.test.ts`, which records the order the two
   * functions actually ran in. This is left as the wiring check.
   */
  const target = withoutComments(source(SCAN_TARGET));
  assert.match(target, /const openCamera = withDismiss\(Keyboard, \(\) => setCameraOpen\(true\)\)/);
  assert.match(target, /onScanPress=\{openCamera\}/);
});

it('blank space dismisses in the header and footer as well as the body', () => {
  /*
   * The header and footer sit OUTSIDE the scroll view, so
   * `keyboardShouldPersistTaps` never reached them — and on a scan-first page
   * the input lives in the header, which made the area right around it the one
   * place tapping did nothing.
   */
  const code = withoutComments(source(SCREEN));
  /*
   * FOUR now, not three.
   *
   * The fourth is the NON-SCROLLING body — the branch every scan-entry page
   * renders, and the one this assertion originally missed while counting three
   * and passing. Counting was never the problem; counting the wrong three was.
   */
  const dismissals = code.match(/onPress=\{dismissBlank\}/g) ?? [];
  assert.equal(dismissals.length, 4, 'scrolling body, non-scrolling body, header, footer');
  assert.match(code, /<Pressable accessible=\{false\} onPress=\{dismissBlank\} style=\{styles\.header\}>/);
});

it('nothing blocks scrolling, buttons or the camera control', () => {
  const code = withoutComments(source(SCREEN));

  // `Pressable`, not a full-screen overlay: a real control inside wins the
  // touch because the deepest responder handles it.
  assert.ok(!code.includes('TouchableWithoutFeedback'), 'no blocking wrapper');
  assert.ok(!code.includes('pointerEvents="box-only"'), 'children must stay tappable');

  // And the first tap on a button under an open keyboard presses the button,
  // rather than being spent closing the keyboard.
  assert.match(code, /keyboardShouldPersistTaps="handled"/);
});

it('the dismissal surfaces stay out of the screen reader order', () => {
  // A gesture surface is not a control. Announcing "button" over a whole
  // header would be worse than the problem it solves.
  const code = withoutComments(source(SCREEN));
  const surfaces = code.match(/<Pressable\s+accessible=\{false\}/g) ?? [];
  // Four surfaces, matching the four dismissal regions.
  assert.equal(surfaces.length, 4, 'every dismissal surface is silent');
});

it('the field keeps its value when the keyboard is dismissed', () => {
  /*
   * Dismissing is a keyboard operation and touches no state: `ScanTarget` holds
   * the text in `code`, and nothing in the dismissal path clears it. The only
   * clear is on submit, so a wedge scanner's next code lands in an empty field.
   */
  const target = withoutComments(source(SCAN_TARGET));
  const clears = target.match(/setCode\(''\)/g) ?? [];
  assert.equal(clears.length, 1, 'exactly one clear');
  const submit = target.slice(target.indexOf('const submit'), target.indexOf('return ('));
  assert.match(submit, /setCode\(''\)/, 'and it is on submit');
});

it('nothing refocuses on route focus or draft restoration', () => {
  // A returning user gets their screen back, not a keyboard.
  for (const route of ['app/(tabs)/sell.tsx', 'app/receive.tsx']) {
    const code = withoutComments(source(route));
    assert.ok(!code.includes('.focus()'), `${route} must not focus imperatively`);
  }
  assert.ok(!withoutComments(source(SCAN_TARGET)).includes('.focus()'));
});

// ── the scanner itself is untouched ───────────────────────────────────────

it('detection, ROI and the machine are not disturbed', () => {
  /*
   * These two corrections are chrome. The device-verified scanning behaviour
   * underneath them must be exactly as it was.
   */
  const sheet = withoutComments(source(SHEET));
  assert.match(sheet, /if \(enforceForCallback\(Platform\.OS, space\)\) \{/);
  assert.match(sheet, /if \(verdictRoi !== 'inside'\) return;/);
  assert.match(sheet, /const verdict = observe\(acquisition\.current, \{/);
  assert.match(sheet, /if \(!acceptsDetection\(machineRef\.current\)\) return;/);
  // And the scan pipeline still takes its identifier from the decoder payload.
  assert.match(sheet, /raw: result\.data,/);
});

console.log(`screen chrome and keyboard: ${passed} passed`);
