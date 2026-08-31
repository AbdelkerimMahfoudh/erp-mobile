/**
 * The scanner, as a real phone found it.
 *
 *   node lib/scanner-behaviour.test.ts
 *
 * Seven defects came out of the first physical-device test, and every one of
 * them was invisible to a type checker, a linter and a web export. They are
 * pinned here so the next refactor cannot quietly restore them.
 *
 * What the device actually did:
 *
 *   1. a result appeared…
 *   2. …and the camera carried on scanning behind it;
 *   3. tapping "Use this IMEI" put the scanner back to scanning;
 *   4. the accepted result only appeared after closing the sheet by hand;
 *   5. "Saisir manuellement" sat inside the scanner, under a live viewfinder;
 *   6. with the keyboard open, the footer could not be reached;
 *   7. tapping blank space did not close the keyboard.
 *
 * Some of these are state-machine facts and are tested as such. The rest are
 * structural, and are read from source — the alternative is a device, and a
 * device is exactly what was missing when they shipped.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  acceptsDetection,
  cameraActive,
  initialScannerState,
  scannerReducer,
  type ScannerState,
} from './scan/machine.ts';

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

const SHEET = 'components/scanner/ScannerSheet.tsx';
const TARGET = 'components/scanner/ScanTarget.tsx';
const SCREEN = 'components/ui/Screen.tsx';
const USE_SCAN = 'components/scanner/useScan.ts';

/** Drive the machine the way the sheet does. */
const run = (events: Parameters<typeof scannerReducer>[1][]): ScannerState =>
  events.reduce(scannerReducer, initialScannerState);

const IMEI = '010000041000041';
const payload = { kind: 'imei', primary: IMEI, secondary: null } as never;

// ── 1 & 2 · one result, and the camera stops ──────────────────────────────

it('repeated callbacks produce exactly one result', () => {
  /*
   * The camera fires the same barcode many times a second, and several events
   * arrive before React commits a render. Only the first may be taken.
   */
  let state = run([{ type: 'open' }]);
  assert.equal(acceptsDetection(state), true);

  state = scannerReducer(state, { type: 'detected', raw: IMEI });
  assert.equal(state.name, 'validating');

  // Five more of the same physical scan, all while validating.
  for (let i = 0; i < 5; i++) {
    assert.equal(acceptsDetection(state), false, 'a detection must not be taken while validating');
    state = scannerReducer(state, { type: 'detected', raw: IMEI });
    assert.equal(state.name, 'validating', 'repeats must change nothing');
  }

  state = scannerReducer(state, { type: 'validated', payload });
  assert.equal(state.name, 'result');
});

it('the callback is refused while validating and while a result is showing', () => {
  const validating = run([{ type: 'open' }, { type: 'detected', raw: IMEI }]);
  const showing = scannerReducer(validating, { type: 'validated', payload });
  for (const state of [validating, showing]) {
    assert.equal(acceptsDetection(state), false);
    assert.equal(cameraActive(state), false);
  }
});

it('the camera hardware is deactivated, not merely ignored', () => {
  /*
   * THE defect. Detaching the handler stops us reacting; it does not stop the
   * camera. On the phone the preview stayed live behind the result, still
   * decoding, which is what a person reads as "it is still scanning".
   */
  const code = withoutComments(source(SHEET));
  assert.match(code, /active=\{live\}/, 'CameraView must be deactivated');
  assert.match(code, /onBarcodeScanned=\{live \? onBarcodeScanned : undefined\}/);
  assert.match(code, /const live = cameraActive\(machine\)/);
  // And `cameraActive` is true in exactly one state.
  assert.match(withoutComments(source('lib/scan/machine.ts')),
    /export function cameraActive\(state: ScannerState\): boolean \{\s*return state\.name === 'scanning';/);
});

it('the lock is a ref, read synchronously inside the callback', () => {
  const code = withoutComments(source(SHEET));
  // `useState` is not visible to a callback that fires again before the next
  // render — which is exactly when it matters.
  assert.match(code, /if \(!acceptsDetection\(machineRef\.current\)\) return;/);
  assert.ok(!/acceptsDetection\(machine\)/.test(code), 'the callback must not read React state');
});

// ── 3 & 4 · accept once, completely, and close ────────────────────────────

it('accepting never goes back to scanning', () => {
  let state = run([
    { type: 'open' },
    { type: 'detected', raw: IMEI },
    { type: 'validated', payload },
    { type: 'accept' },
  ]);
  assert.equal(state.name, 'accepted');
  assert.equal(cameraActive(state), false);
  assert.equal(acceptsDetection(state), false);

  // Nothing a camera or a render can do brings it back.
  for (const event of [
    { type: 'detected', raw: IMEI },
    { type: 'validated', payload },
    { type: 'accept' },
  ] as const) {
    state = scannerReducer(state, event);
    assert.equal(state.name, 'accepted', `${event.type} must not reopen the camera`);
  }
});

it('only an explicit human decision releases the lock', () => {
  /*
   * Two events resume the camera and both are somebody tapping a button:
   * "Scan again" discards the result and starts over, and "Add second IMEI"
   * keeps the confirmed primary and goes looking for the other SIM. Nothing
   * else does — and crucially, no render and no completed lookup does.
   */
  const showing = run([
    { type: 'open' },
    { type: 'detected', raw: IMEI },
    { type: 'validated', payload },
  ]);

  for (const event of [{ type: 'accept' }, { type: 'removeSecond' }] as const) {
    assert.equal(cameraActive(scannerReducer(showing, event)), false, event.type);
  }

  const again = scannerReducer(showing, { type: 'scanAgain' });
  assert.equal(cameraActive(again), true);

  const second = scannerReducer(showing, { type: 'addSecond' });
  assert.equal(cameraActive(second), true);
  // …and it keeps what was already confirmed rather than starting from nothing.
  assert.equal(second.name === 'scanning' && second.primary, IMEI);
  assert.equal(second.name === 'scanning' && second.pass, 2);
});

it('"Use this IMEI" closes the sheet itself, exactly once', () => {
  const code = withoutComments(source(SHEET));
  // A synchronous guard, like the camera lock: a double tap lands before React
  // re-renders, and two accepts would fire two `onClose` calls.
  assert.match(code, /if \(accepting\.current \|\| !primary\) return;/);
  assert.match(code, /accepting\.current = true;/);
  // It closes on its own rather than waiting for the network.
  const accept = code.slice(code.indexOf('const acceptImei'), code.indexOf('const submitTyped'));
  assert.match(accept, /onClose\(\);/);
  assert.equal((accept.match(/onClose\(\)/g) ?? []).length, 1, 'exactly one close');
  assert.equal((accept.match(/setMachine\(\{ type: 'accept' \}\)/g) ?? []).length, 1);
});

it('the parent gets the complete result before the sheet closes', () => {
  const code = withoutComments(source(SHEET));
  const accept = code.slice(code.indexOf('const acceptImei'), code.indexOf('const submitTyped'));
  // Everything the intake page needs to render immediately.
  for (const field of ['primary', 'secondary', 'payload', 'tac', 'tacConflict']) {
    assert.match(accept, new RegExp(`\\b${field}[,:]`), `accepted result must carry ${field}`);
  }
  // …and it is handed over BEFORE the close.
  assert.ok(
    accept.indexOf('onImeiAccepted?.(') < accept.indexOf('onClose()'),
    'the parent must have the result before the sheet goes',
  );
});

it('accepting does not repeat the haptic or the lookup work', () => {
  const sheet = withoutComments(source(SHEET));
  const accept = sheet.slice(sheet.indexOf('const acceptImei'), sheet.indexOf('const submitTyped'));
  // The detection already buzzed. The learning call must be silent.
  assert.match(accept, /scanSilently\(primary\)/);
  assert.ok(!/haptics\./.test(accept), 'no second haptic on accept');

  const scan = withoutComments(source(USE_SCAN));
  assert.match(scan, /silent = false/);
  assert.match(scan, /if \(!silent\) \{/);
  assert.match(scan, /if \(!silent\) haptics\.error\(\);/);
});

it('closing or cancelling never applies a result', () => {
  const cancelled = run([
    { type: 'open' },
    { type: 'detected', raw: IMEI },
    { type: 'validated', payload },
    { type: 'cancel' },
  ]);
  assert.equal(cancelled.name, 'cancelled');

  const code = withoutComments(source(SHEET));
  // The close button cancels the machine; it does not accept.
  const closeButton = code.slice(code.indexOf("icon={X}"), code.indexOf("icon={X}") + 300);
  assert.match(closeButton, /setMachine\(\{ type: 'cancel' \}\)/);
  assert.ok(!/onImeiAccepted/.test(closeButton), 'cancelling must not hand over a result');
});

// ── 5 · manual entry moved out of the scanner ─────────────────────────────

it('manual entry is gone from inside the scanner', () => {
  const code = withoutComments(source(SHEET));
  // The button that sat under a live viewfinder in every state.
  assert.ok(!/title=\{t\('scan\.enterManually'\)\}/.test(code));
  // The only remaining way in is the no-camera fallback, which must stay:
  // without it, somebody who denied the permission is stuck.
  const manualEntries = (code.match(/setManual\(true\)/g) ?? []).length;
  assert.equal(manualEntries, 1, 'only the no-camera fallback may open the keypad');
  assert.match(code, /secondaryAction=\{\{ label: t\('action\.typeInstead'\)/);
});

it('manual entry is present on the intake page, beside the scan action', () => {
  const target = withoutComments(source(TARGET));
  // The field IS the manual path, and the camera button sits inside it.
  assert.match(target, /<SearchInput/);
  assert.match(target, /onSubmit=\{submit\}/);
  assert.match(target, /onScanPress=\{\(\) => setCameraOpen\(true\)\}/);
  // And the feature's translations are untouched in all three languages.
  for (const file of ['en.ts', 'ar.ts', 'fr.ts']) {
    const cat = source(`lib/i18n/${file}`);
    for (const key of ['scan.enterManually', 'scanner.manual.title', 'scanner.manual.submit']) {
      assert.ok(cat.includes(`'${key}'`), `${file} must keep ${key}`);
    }
  }
});

it('the accepted result reaches the page through the scan target', () => {
  const target = withoutComments(source(TARGET));
  assert.match(target, /onImeiAccepted\?: \(accepted: AcceptedImei\) => void;/);
  assert.match(target, /onImeiAccepted=\{onImeiAccepted\}/);
});

// ── 6 & 7 · the keyboard ──────────────────────────────────────────────────

it('the frame lifts for the keyboard, so the footer stays reachable', () => {
  const code = withoutComments(source(SCREEN));
  assert.match(code, /<KeyboardAvoidingView/);
  // iOS lifts; Android resizes its own window and must not be given a
  // behaviour, or the two corrections fight and the footer jumps.
  assert.match(code, /behavior=\{Platform\.OS === 'ios' \? 'padding' : undefined\}/);
  // The footer is INSIDE the avoiding view, or lifting it achieves nothing.
  const kav = code.slice(code.indexOf('<KeyboardAvoidingView'), code.indexOf('</KeyboardAvoidingView>'));
  assert.match(kav, /\{footer \? \(/);
  assert.match(kav, /\{body\}/);
});

it('the scroll area reserves the footer’s measured height', () => {
  const code = withoutComments(source(SCREEN));
  // Measured, not guessed: a footer is one button on some screens and three on
  // others, and a constant leaves the last field underneath it.
  assert.match(code, /onLayout=\{measureFooter\}/);
  assert.match(code, /paddingBottom: gutter \+ footerHeight \+ space\['3xl'\]/);
  assert.match(code, /const \[footerHeight, setFooterHeight\] = useState\(0\)/);
});

it('a blank-area press dismisses the keyboard', () => {
  const code = withoutComments(source(SCREEN));
  assert.match(code, /onPress=\{Keyboard\.dismiss\}/);
  assert.match(code, /import \{[\s\S]*?Keyboard,[\s\S]*?\} from 'react-native'/);
});

it('the dismiss wrapper does not swallow button presses', () => {
  const code = withoutComments(source(SCREEN));
  /*
   * Two things make this safe. `keyboardShouldPersistTaps="handled"` lets a
   * button take the FIRST tap while the keyboard is open instead of the tap
   * being spent closing it — without it every submit under a keyboard needs
   * two taps. And `accessible={false}` keeps a page-sized gesture surface out
   * of the screen reader's order.
   */
  assert.match(code, /keyboardShouldPersistTaps="handled"/);
  assert.match(code, /accessible=\{false\}/);
  // A Pressable, not a TouchableWithoutFeedback wrapping the whole scroll view:
  // the deepest responder wins, so real controls inside still receive the touch.
  assert.match(code, /<Pressable/);
});

it('scrolling does not yank the keyboard away unexpectedly', () => {
  const code = withoutComments(source(SCREEN));
  // iOS drags it with the finger and can give it back; Android has no such
  // mode, so dismissing on drag is the closest equivalent there.
  assert.match(code, /keyboardDismissMode=\{Platform\.OS === 'ios' \? 'interactive' : 'on-drag'\}/);
});

it('uses only React Native primitives — no new dependency', () => {
  const code = source(SCREEN);
  const imports = [...code.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
  for (const source_ of imports) {
    assert.ok(
      source_.startsWith('.') || ['react', 'react-native', 'react-native-safe-area-context'].includes(source_),
      `unexpected dependency: ${source_}`,
    );
  }
});

it('keeps RTL intact — no hardcoded left or right', () => {
  const code = withoutComments(source(SCREEN));
  assert.ok(!/\b(marginLeft|marginRight|paddingLeft|paddingRight|left:|right:)\b/.test(code));
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(code), 'no raw colours');
});

console.log(`scanner and keyboard behaviour: ${passed} passed`);
