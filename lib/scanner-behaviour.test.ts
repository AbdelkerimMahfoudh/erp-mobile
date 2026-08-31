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

it('the camera is unmounted — not merely ignored, and not merely deactivated', () => {
  /*
   * This assertion has been wrong twice, and each time a phone said so.
   *
   * First it only detached the handler, which stops us REACTING while the
   * camera carries on previewing — a live image behind the result. Then it
   * added `active={false}`, which stops the camera and leaves its last frame
   * frozen on screen, so the scanner looks like it photographed a barcode that
   * is usually half out of shot.
   *
   * The camera is unmounted. There is no session, and no frame to freeze.
   */
  const code = withoutComments(source(SHEET));
  assert.match(code, /&& live \? \(\s*<CameraView/, 'CameraView must unmount');
  assert.ok(!/active=\{live\}/.test(code), 'deactivating leaves a frozen frame');
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
  /*
   * The detection already buzzed, so nothing on the accept path may buzz
   * again — and the lookup is long finished by then, because it runs when the
   * result APPEARS rather than after acceptance. That ordering is what the
   * second device test forced: doing it on accept meant the product arrived
   * too late to be shown, and was discarded.
   */
  assert.ok(!/haptics\./.test(accept), 'no second haptic on accept');
  assert.ok(!/scanQuietly\(/.test(accept), 'the lookup has already happened');

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


// ── The second device test: two regressions from the first fix ────────────

it('no camera view survives into the result — not even a frozen one', () => {
  /*
   * `active={false}` stopped the camera and left its last frame on screen, so
   * the scanner looked like it had taken a photograph. Worse, that frame is
   * whatever the sensor held when the barcode decoded, which very often does
   * not show the digits at all.
   *
   * The camera is UNMOUNTED. There is nothing to freeze.
   */
  const code = withoutComments(source(SHEET));
  assert.match(code, /\{canUseCamera && cameraSupported && !manual && live \? \(\s*<CameraView/);
  assert.ok(!/active=\{live\}/.test(code), 'deactivating is not enough — it must unmount');
  // The torch button goes with it; there is no camera to light.
  assert.match(code, /\{canUseCamera && cameraSupported && !manual && live \? \(\s*<IconButton/);
});

it('the displayed identifier is the decoder payload, as selectable text', () => {
  const code = withoutComments(source(SHEET));
  // Straight from `BarcodeScanningResult.data`, through the classifier.
  assert.match(code, /\(\{ data \}: BarcodeScanningResult\)/);
  assert.match(code, /setMachine\(\{ type: 'detected', raw: data \}\)/);
  assert.match(code, /const payload = classifyScan\(data\)/);
  // Rendered with the primitive that is selectable and forced LTR.
  assert.match(code, /<Identifier tone="inverse">\{primary\}<\/Identifier>/);
  assert.match(code, /<Identifier tone="inverse">\{secondary\}<\/Identifier>/);
});

it('invokes no photo, frame-capture or OCR API', () => {
  /*
   * OCR was retired in milestone O and must not creep back. Checked across the
   * whole scan path rather than one file, because the tempting place to add it
   * is always somewhere else.
   */
  const forbidden = [
    'takePictureAsync',
    'takePhoto',
    'captureRef',
    'recognizeText',
    'TextRecognition',
    'ImageManipulator',
    'onFrameProcessor',
  ];
  for (const f of [SHEET, TARGET, USE_SCAN, 'lib/scan/payload.ts', 'lib/scan/machine.ts']) {
    const code = withoutComments(source(f));
    for (const api of forbidden) {
      assert.ok(!code.includes(api), `${f} must not call ${api}`);
    }
  }
  // And the classifier never invents a digit, which is what OCR did.
  const payloadSrc = source('lib/scan/payload.ts');
  assert.match(payloadSrc, /never replaces a digit with a different digit/);
  // The OCR confusion table is not reachable from the scan path.
  assert.ok(!/from '\.\.\/imei'|from '\.\/imei'/.test(withoutComments(source('lib/scan/payload.ts'))));
});

it('the lookup runs while the result is shown, not after acceptance', () => {
  /*
   * THE regression. The accepted IMEI was sent down `/scan` with a `silent`
   * `useScan` that had **no `onResult`** — so the recognised product came back
   * and was discarded. "Silent" was meant to mean "no second buzz"; it also
   * meant "no product".
   */
  const code = withoutComments(source(SHEET));
  assert.match(code, /const \[lookup, setLookup\] = useState<ScanResult \| null>\(null\)/);
  /*
   * `onResult` is no longer `setLookup` directly: it is guarded by the session
   * token, so a lookup started before the sheet was closed cannot write into
   * the session that reopened it. The guard is asserted properly below; here it
   * is enough that the result still reaches `setLookup` at all, which is the
   * regression this test was written for.
   */
  assert.match(code, /silent: true/);
  assert.match(code, /setLookup\(r\)/);
  // Fired by the identifier, not by a render, so it cannot run twice.
  assert.match(code, /if \(!primary \|\| lookedUp\.current === primary\) return;/);
  assert.match(code, /void scanQuietly\(primary\)/);
  assert.ok(!/scanSilently/.test(code), 'the discarding path is gone');
});

it('accepting hands the product to the parent, both ways', () => {
  const code = withoutComments(source(SHEET));
  const accept = code.slice(code.indexOf('const acceptImei'), code.indexOf('const submitTyped'));
  // In the structured result…
  assert.match(accept, /scan: lookup,/);
  // …and through the channel every embedding screen already listens on.
  assert.match(accept, /if \(lookup\) onResult\(lookup\);/);
  assert.ok(
    accept.indexOf('onResult(lookup)') < accept.indexOf('onClose()'),
    'the product must reach the parent before the sheet closes',
  );
});

it('the result panel shows the existing product, and says how sure it is', () => {
  const code = withoutComments(source(SHEET));
  assert.match(code, /lookup\?\.suggestion/);
  assert.match(code, /lookup\.recognized \? t\('scan\.knownProduct'\) : t\('scan\.maybeProduct'\)/);
  // A guess must never be dressed as an answer.
  assert.match(code, /lookup\.suggestion\.brand/);
});

it('a re-render cannot clear what was accepted', () => {
  /*
   * The lookup is keyed on the identifier and guarded by a ref, so background
   * learning cannot fire again and overwrite state the parent is already
   * showing. And the accept guard means a double tap cannot re-run any of it.
   */
  const code = withoutComments(source(SHEET));
  assert.match(code, /const lookedUp = useRef<string \| null>\(null\)/);
  assert.match(code, /lookedUp\.current = primary;/);
  assert.match(code, /if \(accepting\.current \|\| !primary\) return;/);
  // Reopening starts clean rather than showing the last phone.
  assert.match(code, /lookedUp\.current = null;/);
  assert.match(code, /setLookup\(null\);/);
});

it('both identifiers of one phone reach the same lookup', () => {
  /*
   * `addSecond` keeps the confirmed primary, so the lookup — which is keyed on
   * `primary` — is not repeated and not replaced when the second SIM arrives.
   * One phone, one product.
   */
  const showing = run([
    { type: 'open' },
    { type: 'detected', raw: IMEI },
    { type: 'validated', payload },
  ]);
  const second = scannerReducer(showing, { type: 'addSecond' });
  assert.equal(second.name === 'scanning' && second.primary, IMEI);

  const both = scannerReducer(
    scannerReducer(second, { type: 'detected', raw: '010000045000047' }),
    { type: 'validated', payload: { kind: 'imei', primary: '010000045000047', secondary: null } as never },
  );
  assert.equal(both.name, 'result');
  assert.equal(both.name === 'result' && both.primary, IMEI, 'the primary survives the second pass');
});

it('nothing here creates a product or a unit', () => {
  const code = withoutComments(source(SHEET)) + withoutComments(source(TARGET));
  for (const write of ["api.post<Unit>", "'/units'", "'/products'"]) {
    assert.ok(!code.includes(write), `the scanner must not create anything: ${write}`);
  }
  // The only call it makes is the recognition lookup.
  assert.match(withoutComments(source(USE_SCAN)), /api\.post<ScanResult>\('\/scan'/);
});

// ── 8 · every opening is a new session ───────────────────────────────────
//
// The second device test: the FIRST scan worked. Reopen the sheet and the old
// result was on screen before the camera existed, frequently in under a second
// — which reads as a frozen photograph of the last barcode.
//
// The cause was not the camera. `ScannerSheet` is permanently mounted by its
// parents (`open` only gates `if (!open) return null`), so every piece of its
// state survives a close: the machine, the lookup, the guards, and the
// `CameraView` instance itself. The old reset ran in an effect, which is AFTER
// the reopened sheet had already painted the previous session's result.

it('reopening resets in the render pass, before anything can be painted', () => {
  const code = withoutComments(source(SHEET));

  // React's "adjust state during render" pattern: compare against the previous
  // prop and reset in the same pass. An effect is one paint too late, and that
  // one paint is the whole defect.
  assert.match(code, /if \(open !== wasOpen\) \{/);
  assert.match(code, /setWasOpen\(open\)/);
  assert.ok(
    code.indexOf('if (open !== wasOpen)') < code.indexOf('return ('),
    'the reset must happen during render, not in an effect after it',
  );
});

it('a new session clears every piece of the last one', () => {
  const code = withoutComments(source(SHEET));
  const reset = code.slice(code.indexOf('if (open !== wasOpen)'), code.indexOf('const reset'));

  // The result, the typed fields, the recognised product…
  assert.match(reset, /setTyped\(''\)/);
  assert.match(reset, /setTypedSecond\(''\)/);
  assert.match(reset, /setLookup\(null\)/);
  assert.match(reset, /setManual\(false\)/);
  assert.match(reset, /setTorch\(false\)/);
  // …the machine, both in React state and in the ref the callback reads…
  assert.match(reset, /machineRef\.current = scannerReducer\(initialScannerState, \{ type: 'open' \}\)/);
  assert.match(reset, /dispatch\(\{ type: 'open' \}\)/);
  // …the synchronous accept guard, and the "already looked this up" marker.
  assert.match(reset, /accepting\.current = false/);
  assert.match(reset, /lookedUp\.current = null/);
});

it('the camera itself is a new instance each session, not a reused one', () => {
  const code = withoutComments(source(SHEET));

  // A `key` that changes forces React to unmount the old `CameraView` and
  // construct a new one. Without it React reconciles onto the SAME native view
  // — which is the instance holding the last frame.
  assert.match(code, /setSessionId\(\(n\) => n \+ 1\)/);
  assert.match(code, /<CameraView[\s\S]*?key=\{sessionId\}/);
});

it('three consecutive sessions each start scanning from nothing', () => {
  /*
   * The state-machine half of the same guarantee, driven three times because
   * the device report was specifically that the FIRST one worked.
   */
  for (let session = 1; session <= 3; session++) {
    let state = run([{ type: 'open' }]);
    assert.equal(state.name, 'scanning', `session ${session} must open scanning`);
    assert.equal(cameraActive(state), true, `session ${session} must mount a camera`);
    assert.equal(acceptsDetection(state), true, `session ${session} must accept a scan`);

    state = scannerReducer(state, { type: 'detected', raw: IMEI });
    state = scannerReducer(state, { type: 'validated', payload });
    assert.equal(state.name, 'result');
    state = scannerReducer(state, { type: 'accept' });
    assert.equal(state.name, 'accepted');

    // Closing and reopening: `open` is how the sheet restarts, and it must
    // discard the accepted state rather than carrying it forward.
    const reopened = scannerReducer(state, { type: 'open' });
    assert.equal(reopened.name, 'scanning', `session ${session} must not reopen showing a result`);
    assert.equal(cameraActive(reopened), true);
  }
});

it('no result state can show a camera frame', () => {
  /*
   * Stated over the machine rather than the markup, so it holds for every state
   * the sheet can be in rather than for the branches somebody remembered.
   */
  const states: ScannerState[] = [
    run([{ type: 'open' }, { type: 'detected', raw: IMEI }]),
    run([{ type: 'open' }, { type: 'detected', raw: IMEI }, { type: 'validated', payload }]),
    run([{ type: 'open' }, { type: 'detected', raw: IMEI }, { type: 'validated', payload }, { type: 'accept' }]),
  ];
  for (const state of states) {
    assert.equal(cameraActive(state), false, `${state.name} must not hold a camera`);
  }
  // And the markup mounts one only when `live`, so "no camera" means no view.
  assert.match(withoutComments(source(SHEET)), /&& live \? \(\s*<CameraView/);
});

it('a lookup from a closed session cannot write into the next one', () => {
  /*
   * `/scan` is a network call. Close the sheet while one is in flight, reopen
   * it, and the response lands in a session that never asked for it — the
   * previous phone appearing under the new scan.
   *
   * A session token, compared at the moment the result arrives.
   */
  const code = withoutComments(source(SHEET));
  assert.match(code, /const lookupSession = useRef\(0\)/);
  assert.match(code, /lookupSession\.current = sessionId/);
  assert.match(code, /if \(lookupSession\.current !== sessionId\) return;/);
  // The guard must come before the write, or it guards nothing.
  const handler = code.slice(code.indexOf('onResult: (r) =>'), code.indexOf('setLookup(r)'));
  assert.match(handler, /lookupSession\.current !== sessionId/);
});

it('the accepted result is handed to the parent before the sheet forgets it', () => {
  /*
   * The sheet clears itself on every open, so the accepted IMEI cannot live
   * here. It goes to the parent on accept — and it is the parent's state that
   * survives reopening and `Next`.
   */
  const code = withoutComments(source(SHEET));
  const accept = code.slice(code.indexOf('const acceptImei'), code.indexOf('const submitTyped'));
  // Optional — an embedding screen that does not want the structured result
  // still gets one through `onResult`.
  assert.match(accept, /onImeiAccepted\?\.\(\{/);
  assert.ok(
    accept.indexOf('onImeiAccepted?.({') < accept.indexOf('onClose()'),
    'the parent must be told before the sheet closes and resets',
  );
});

it('detection is never delayed', () => {
  /*
   * The device report was explicit: fast detection is correct, and a frozen
   * frame is the fault. Slowing the decoder down would have hidden the symptom
   * and broken the feature.
   */
  const code = withoutComments(source(SHEET));
  for (const stall of ['setTimeout', 'setInterval', 'await new Promise', 'requestAnimationFrame']) {
    assert.ok(!code.includes(stall), `no artificial delay: ${stall}`);
  }
});

console.log(`scanner and keyboard behaviour: ${passed} passed`);
