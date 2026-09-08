/**
 * The strict scan region.
 *
 *   node lib/scan/roi.test.ts
 *
 * A phone label carries several barcodes millimetres apart, so a frame that
 * merely suggests where to aim does not stop the decoder reading a neighbour.
 * Every corner of a barcode must be inside the rectangle, and a callback that
 * fails is dropped before classification, stabilization, haptics, recognition
 * or any message — it never happened.
 *
 * The centre alone is never enough. A barcode straddling an edge has its centre
 * inside while half of it is out of shot, which is exactly the read that
 * produces a wrong digit.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ROI_ASPECT,
  ROI_TOLERANCE_PT,
  ROI_WIDTH_FRACTION,
  containment,
  enforceForCallback,
  roiEnforceable,
  roiFor,
  traceOf,
  type Point,
  type Rect,
} from './roi.ts';

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

/** A typical phone preview, and the frame derived from it. */
const PREVIEW = { width: 390, height: 780 };
const ROI = roiFor(PREVIEW);

/** A barcode as four corners, centred at (cx, cy). */
const code = (cx: number, cy: number, w = 120, h = 30): Point[] => [
  { x: cx - w / 2, y: cy - h / 2 },
  { x: cx + w / 2, y: cy - h / 2 },
  { x: cx + w / 2, y: cy + h / 2 },
  { x: cx - w / 2, y: cy + h / 2 },
];

const centreOfRoi = { x: ROI.x + ROI.width / 2, y: ROI.y + ROI.height / 2 };

// ── 1 · completely inside ─────────────────────────────────────────────────

it('1 · a barcode completely inside is eligible', () => {
  assert.equal(containment(code(centreOfRoi.x, centreOfRoi.y), ROI), 'inside');
});

it('1b · a barcode filling almost the whole frame is still inside', () => {
  const wide = code(centreOfRoi.x, centreOfRoi.y, ROI.width - 8, ROI.height - 8);
  assert.equal(containment(wide, ROI), 'inside');
});

// ── 2 · completely outside ────────────────────────────────────────────────

it('2 · a barcode completely outside is ignored', () => {
  // Above the frame, below it, and off each side.
  assert.equal(containment(code(centreOfRoi.x, ROI.y - 200), ROI), 'outside');
  assert.equal(containment(code(centreOfRoi.x, ROI.y + ROI.height + 200), ROI), 'outside');
  assert.equal(containment(code(-300, centreOfRoi.y), ROI), 'outside');
  assert.equal(containment(code(PREVIEW.width + 300, centreOfRoi.y), ROI), 'outside');
});

// ── 3 · the centre is not the test ────────────────────────────────────────

it('3 · centre inside but one corner outside is ignored', () => {
  /*
   * THE case the whole gate exists for. A barcode wider than the frame, centred
   * perfectly, has its middle in the right place and its ends out of shot — and
   * a decoder will happily read it.
   */
  const tooWide = code(centreOfRoi.x, centreOfRoi.y, ROI.width + 60, 30);
  const centre = {
    x: (tooWide[0].x + tooWide[1].x) / 2,
    y: (tooWide[0].y + tooWide[2].y) / 2,
  };
  // The centre really is inside…
  assert.ok(centre.x > ROI.x && centre.x < ROI.x + ROI.width);
  assert.ok(centre.y > ROI.y && centre.y < ROI.y + ROI.height);
  // …and the barcode is still refused.
  assert.equal(containment(tooWide, ROI), 'outside');
});

it('3b · a single corner outside is enough to refuse it', () => {
  const inside = code(centreOfRoi.x, centreOfRoi.y, 80, 20);
  assert.equal(containment(inside, ROI), 'inside');

  for (let i = 0; i < 4; i++) {
    const nudged = inside.map((p, j) => (j === i ? { x: p.x, y: ROI.y - 40 } : p));
    assert.equal(containment(nudged, ROI), 'outside', `corner ${i} outside`);
  }
});

// ── 4 · partial overlap at every edge ─────────────────────────────────────

it('4 · partial overlap at each edge is ignored', () => {
  const w = 100;
  const h = 24;
  const edges: [string, Point[]][] = [
    ['left', code(ROI.x, centreOfRoi.y, w, h)],
    ['right', code(ROI.x + ROI.width, centreOfRoi.y, w, h)],
    ['top', code(centreOfRoi.x, ROI.y, w, h)],
    ['bottom', code(centreOfRoi.x, ROI.y + ROI.height, w, h)],
  ];
  for (const [name, c] of edges) {
    assert.equal(containment(c, ROI), 'outside', `straddling the ${name} edge`);
  }
});

it('4b · the two-barcode screenshot: the frame crossing both is no detection', () => {
  /*
   * The reported case. The rectangle lands across parts of two stacked
   * barcodes, so neither is complete inside it — and the correct outcome is
   * nothing at all, not a guess at whichever is more covered.
   */
  const upper = code(centreOfRoi.x, ROI.y + 4, 200, 40);
  const lower = code(centreOfRoi.x, ROI.y + ROI.height - 4, 200, 40);
  assert.equal(containment(upper, ROI), 'outside');
  assert.equal(containment(lower, ROI), 'outside');
});

// ── tolerance ─────────────────────────────────────────────────────────────

it('a hair over the edge is forgiven; a real overhang is not', () => {
  /*
   * A held barcode's corners wobble a pixel or two between frames as the
   * decoder re-fits the quiet zone. Without slack, a barcode resting on the
   * edge flickers between accepted and rejected, which reads as the scanner
   * being broken rather than as the barcode being borderline.
   */
  const justOver = code(centreOfRoi.x, centreOfRoi.y, ROI.width + ROI_TOLERANCE_PT, 20);
  assert.equal(containment(justOver, ROI), 'inside', 'measurement noise is forgiven');

  const properlyOver = code(centreOfRoi.x, centreOfRoi.y, ROI.width + ROI_TOLERANCE_PT * 8, 20);
  assert.equal(containment(properlyOver, ROI), 'outside', 'an actual overhang is not');

  assert.ok(ROI_TOLERANCE_PT <= 4, 'tolerance is for jitter, not for letting a barcode hang out');
});

// ── 5 · several barcodes ──────────────────────────────────────────────────

it('5 · one inside and two outside yields exactly one eligible barcode', () => {
  const codes = [
    code(centreOfRoi.x, centreOfRoi.y), // inside
    code(centreOfRoi.x, ROI.y - 120), // above
    code(centreOfRoi.x, ROI.y + ROI.height + 120), // below
  ];
  const eligible = codes.filter((c) => containment(c, ROI) === 'inside');
  assert.equal(eligible.length, 1);
});

it('6 · two fully inside are both eligible, and the panel decides', () => {
  // The gate does not resolve ambiguity — it only decides what is admissible.
  // Two complete barcodes inside the frame both qualify, and the existing
  // selection workflow takes it from there.
  const a = code(centreOfRoi.x, ROI.y + ROI.height * 0.3, 100, 14);
  const b = code(centreOfRoi.x, ROI.y + ROI.height * 0.7, 100, 14);
  assert.equal(containment(a, ROI), 'inside');
  assert.equal(containment(b, ROI), 'inside');
});

// ── 9 · missing geometry is not "inside" ──────────────────────────────────

it('9 · missing geometry can never masquerade as a successful hard scan', () => {
  /*
   * The most dangerous possible bug in this file. Reporting `inside` when
   * nothing was measured turns a hard region into a decorative one while
   * everything downstream still describes it as hard.
   */
  assert.equal(containment(undefined, ROI), 'no-geometry');
  assert.equal(containment([], ROI), 'no-geometry');
  assert.equal(containment([{ x: 10, y: 10 }], ROI), 'no-geometry');
  assert.equal(containment([{ x: Number.NaN, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }], ROI), 'no-geometry');
  // An unmeasured frame is also not something to test against.
  assert.equal(containment(code(10, 10), { x: 0, y: 0, width: 0, height: 0 }), 'no-geometry');

  // And the sheet treats anything that is not `inside` as a refusal.
  assert.match(withoutComments(source('components/scanner/ScannerSheet.tsx')),
    /if \(verdictRoi !== 'inside'\) return;/);
});

// ── 10 · geometry at several viewport sizes ───────────────────────────────

it('10 · the frame is derived from the measured preview at any size', () => {
  const sizes = [
    { width: 320, height: 568 }, // small phone
    { width: 390, height: 844 }, // ordinary phone
    { width: 428, height: 926 }, // large phone
    { width: 834, height: 1112 }, // tablet
    { width: 600, height: 300 }, // landscape
  ];
  for (const preview of sizes) {
    const r = roiFor(preview);
    // Inside the preview, centred, and never inverted.
    assert.ok(r.x >= 0 && r.y >= 0, `${preview.width}: positive origin`);
    assert.ok(r.x + r.width <= preview.width, `${preview.width}: fits horizontally`);
    assert.ok(r.width > 0 && r.height > 0, `${preview.width}: has area`);
    assert.ok(Math.abs(r.x - (preview.width - r.width) / 2) <= 1, `${preview.width}: centred`);

    // Wide and shallow, whatever the screen. A frame that grew with a long
    // phone would end up holding two stacked barcodes on exactly the devices
    // where that is easiest to do by accident.
    assert.ok(r.width > r.height * 2, `${preview.width}: stays a barcode slot`);
  }
});

it('10b · the frame is sized for one barcode, not two', () => {
  assert.ok(ROI_WIDTH_FRACTION >= 0.82 && ROI_WIDTH_FRACTION <= 0.86, 'wide, as specified');
  // Height is a fraction of WIDTH, not of the preview: the constraint is "one
  // barcode", not "a proportion of the screen".
  assert.ok(ROI_ASPECT < 0.5, 'shallow enough that two stacked codes will not fit');
  assert.match(withoutComments(source('lib/scan/roi.ts')),
    /const height = Math\.round\(width \* ROI_ASPECT\)/);
});

// ── 11 · the frame is remeasured, not remembered ──────────────────────────

it('11 · reopening recalculates the frame from a fresh measurement', () => {
  const code_ = withoutComments(source('components/scanner/ScannerSheet.tsx'));
  // `onLayout` on the camera itself, so a new session — which mounts a new
  // CameraView via `key={sessionId}` — measures again from scratch.
  assert.match(code_, /roiRef\.current = next;/);
  assert.match(code_, /setRoi\(next\)/);
  assert.match(code_, /const next = roiFor\(\{ width, height \}\)/);
  // Held in a ref as well, because the callback needs it synchronously.
  assert.match(code_, /const roiRef = useRef<Rect>\(\{ x: 0, y: 0, width: 0, height: 0 \}\)/);
});

// ── the gate runs first, and only once ────────────────────────────────────

it('7, 8 · a refused callback never reaches stabilization, haptics or lookup', () => {
  const code_ = withoutComments(source('components/scanner/ScannerSheet.tsx'));
  const cb = code_.slice(
    code_.indexOf('const onBarcodeScanned'),
    code_.indexOf('useEffect', code_.indexOf('const onBarcodeScanned')),
  );

  const gate = cb.indexOf("if (verdictRoi !== 'inside') return;");
  assert.ok(gate > 0, 'the gate exists');

  // Everything that could have an effect happens after it.
  for (const effect of ['observe(', 'haptics.', 'setMachine(', 'setProgress(', 'setNotice(']) {
    const at = cb.indexOf(effect);
    assert.ok(at > gate, `${effect} must come after the region check`);
  }
});

it('the gate is honest about which platform it can enforce on', () => {
  const roi = source('lib/scan/roi.ts');
  // The audit, recorded from the native source rather than the docs — including
  // the correction, because the first reading of the Android path was wrong.
  assert.match(roi, /transformedMetadataObject/);
  assert.match(roi, /This corrects an earlier reading of mine/);
  assert.match(roi, /patches\/expo-camera\+17\.0\.10\.patch/);

  /*
   * `roiEnforceable` is now the IOS-ALWAYS half of the answer only. Android is
   * decided per callback by `enforceForCallback`, from the marker the patch
   * sends — a platform-wide constant could not express "this build has the
   * patch and the preview is laid out".
   */
  assert.equal(roiEnforceable('ios'), true);
  assert.equal(roiEnforceable('android'), false, 'not unconditionally');
  assert.equal(roiEnforceable('web'), false);
  assert.equal(enforceForCallback('android', 'view'), true, 'but yes when mapped');

  /*
   * The predicate is pure and takes the platform as an argument rather than
   * reading it. Every module under `lib/scan` is dependency-free so it can be
   * run by `node` directly — importing `react-native` here would make this file
   * untestable without a bundler, which is how these rules stop being checked.
   */
  assert.ok(!roi.includes("from 'react-native'"), 'lib/scan stays dependency-free');
  // The platform reaches the predicate as an argument, at the one call site
  // that knows it.
  assert.match(withoutComments(source('components/scanner/ScannerSheet.tsx')),
    /enforceForCallback\(Platform\.OS, space\)/);

  // `bounds` is documented as unsuitable for exactly this, and is not used.
  assert.match(roi, /`bounds` is not a substitute/);
  assert.ok(!withoutComments(roi).includes('.bounds'), 'bounds must not be consulted');
});

// ── 12, 13, 14 · what must not have changed ───────────────────────────────

it('12 · a dual-IMEI QR fully inside is still parsed as one phone', () => {
  // The region decides what is admissible, never what a payload means. A QR
  // carrying both identifiers is one barcode and one phone, exactly as before.
  const qr = code(centreOfRoi.x, centreOfRoi.y, 90, 90);
  assert.equal(containment(qr, ROI), 'inside');
  assert.match(withoutComments(source('lib/scan/payload.ts')), /kind: 'imei'/);
});

it('13 · no OCR, screenshot or image-capture path is introduced', () => {
  const code_ = source('lib/scan/roi.ts') + source('components/scanner/ScannerSheet.tsx');
  for (const api of [
    'takePictureAsync',
    'recognizeText',
    'TextRecognition',
    'captureRef',
    'ImageManipulator',
    'MediaLibrary',
    'toDataURL',
    'captureScreen',
  ]) {
    assert.ok(!code_.includes(api), `no image path: ${api}`);
  }
});

it('14 · exactly one targeting frame remains', () => {
  const code_ = withoutComments(source('components/scanner/ScannerSheet.tsx'));

  // The old build drew large white corner brackets AND a smaller rounded
  // rectangle, so the active area was whichever one you happened to read.
  assert.ok(!code_.includes('styles.viewfinder}'), 'the second frame is gone');
  assert.ok(!code_.includes('styles.guide,'), 'and so is the old guide box');

  // One frame, sized from the same rectangle the gate tests.
  assert.match(code_, /<View style=\{\[styles\.frame, \{ width: roi\.width, height: roi\.height \}\]\}>/);
  // The corner accents sit ON it, so they cannot drift from it.
  const frame = code_.slice(code_.indexOf('styles.frame,'), code_.indexOf('styles.mask, { flex: 1 }'));
  for (const c of ['styles.tl', 'styles.tr', 'styles.bl', 'styles.br']) {
    assert.ok(frame.includes(c), `${c} belongs to the frame`);
  }
});

it('the mask is drawn from the same rectangle, and uses tokens', () => {
  const code_ = withoutComments(source('components/scanner/ScannerSheet.tsx'));
  // Four panels around the frame — no raw colours, no added dependency.
  assert.match(code_, /\[styles\.mask, \{ height: roi\.y \}\]/);
  assert.match(code_, /\[styles\.mask, \{ width: roi\.x \}\]/);
  assert.match(code_, /backgroundColor: colors\.surface\.scrim/);
  assert.ok(!code_.includes('rgba('), 'no raw colours');
  assert.ok(!code_.includes('expo-blur'), 'no dependency added for blur');
});

// ── the development overlay ───────────────────────────────────────────────

it('the geometry overlay reports coordinates, never an identifier', () => {
  /*
   * An overlay that printed payloads would put complete IMEIs on screen and
   * into whatever captured it. Four digits distinguish two candidates while
   * debugging and are not an identifier on their own.
   */
  const t = traceOf('010000041000041', code(10, 20, 4, 4), 'outside');
  assert.equal(t.tail, '0041');
  assert.ok(!JSON.stringify(t).includes('010000041000041'), 'the payload never appears');
  assert.equal(t.verdict, 'outside');
  assert.equal(t.corners.length, 4);

  const code_ = withoutComments(source('components/scanner/ScannerSheet.tsx'));
  // Guarded by the established development flag, and never logged or persisted.
  assert.match(code_, /if \(SHOW_GEOMETRY\) setTrace\(traceOf\(/);
  assert.match(code_, /\{SHOW_GEOMETRY && trace \?/);
  assert.ok(!code_.includes('console.log'), 'nothing is logged');
});

it('the trace rounds coordinates rather than inventing precision', () => {
  const t = traceOf('x', [{ x: 1.4, y: 2.6 }, { x: 3.5, y: 4.5 }, { x: 5, y: 6 }], 'inside');
  assert.deepEqual(t.corners, [{ x: 1, y: 3 }, { x: 4, y: 5 }, { x: 5, y: 6 }]);
});

// ── the native capability marker ──────────────────────────────────────────
//
// Android can now enforce the region, but only in a binary carrying the
// committed `expo-camera` patch. The decision is made per callback from a
// marker the patch sends, never from a version number — a patch that failed to
// apply must not be mistaken for one that did.

it('iOS enforces unconditionally', () => {
  // `previewLayer.transformedMetadataObject` maps in native code before the
  // payload leaves, so there is nothing to negotiate.
  assert.equal(enforceForCallback('ios', 'view'), true);
  assert.equal(enforceForCallback('ios', 'analysis'), true);
  assert.equal(enforceForCallback('ios', undefined), true);
});

it('a patched Android binary enforces; an unpatched one does not', () => {
  assert.equal(enforceForCallback('android', 'view'), true, 'patch present');
  assert.equal(enforceForCallback('android', 'analysis'), false, 'transform unavailable');
  assert.equal(enforceForCallback('android', undefined), false, 'unpatched binary or Expo Go');
});

it('the fallback is the existing workflow, not a rejected scan', () => {
  /*
   * The honest degradation. A scanner that silently refused every barcode
   * because it could not verify geometry would be worse than the defect it was
   * fixing; one that treated untrusted coordinates as trustworthy would be
   * worse still. So an unpatched build simply does not enforce, and the
   * stability and chooser rules carry the scan.
   */
  const sheet = withoutComments(source('components/scanner/ScannerSheet.tsx'));
  assert.match(sheet, /if \(enforceForCallback\(Platform\.OS, space\)\) \{/);
  // The strict branch is entered only when enforcing; there is no `else` that
  // rejects.
  const gate = sheet.slice(sheet.indexOf('enforceForCallback(Platform.OS, space)'));
  const elseBranch = gate.slice(gate.indexOf('} else if'), gate.indexOf('const verdict = observe'));
  assert.ok(!elseBranch.includes('return;'), 'an unenforced callback must not be dropped');
});

it('the marker is read from the payload, not inferred', () => {
  const sheet = withoutComments(source('components/scanner/ScannerSheet.tsx'));
  assert.match(sheet, /const space = \(result as \{ coordinateSpace\?: string \}\)\.coordinateSpace;/);
});

// ── the native patch ──────────────────────────────────────────────────────

const PATCH = 'patches/expo-camera+57.0.4.patch';

it('the patch uses CameraX transforms, not a scaling formula', () => {
  /*
   * Requirement, and also the reason the old Android mapping was wrong: it
   * applied scale with no translation (so an aspect-fill crop was off by the
   * crop offset), ignored rotation, and was read back transposed.
   */
  const patch = source(PATCH);
  assert.match(patch, /CoordinateTransform/);
  assert.match(patch, /ImageProxyTransformFactory/);
  assert.match(patch, /previewViewProvider\(\)\?\.outputTransform/);

  // ML Kit is handed a ROTATED InputImage, so the factory must account for the
  // same rotation or the two spaces disagree by 90 degrees.
  assert.match(patch, /isUsingRotationDegrees = true/);

  // No hand-rolled arithmetic reintroduced.
  assert.ok(!patch.includes('previewWidth / imageWidth'), 'no guessed scale formula');
});

it('the patch forwards every barcode, non-coalescing', () => {
  const patch = source(PATCH);
  // `.first()` is gone…
  assert.match(patch, /-\s*val barcode = barcodes\.first\(\)/);
  // …replaced by one emission per barcode, with enough context to tell several
  // codes seen at once from one code seen repeatedly.
  assert.match(patch, /\+\s*barcodes\.forEachIndexed \{ index, barcode ->/);
  assert.match(patch, /frameId/);
  assert.match(patch, /indexInFrame/);
  assert.match(patch, /countInFrame/);
});

it('the corner points are not transposed', () => {
  /*
   * Corners are written `[x, y, …]`. Upstream used to read them back as
   * `y = points[i]`, which is unnoticeable while nothing compares them to
   * anything and fatal the moment a rectangle does.
   *
   * As of expo-camera 57 this is fixed UPSTREAM, so the patch no longer carries
   * the hunk — carrying it would mean re-applying a fix that is already there.
   * The property still matters, so it is asserted against the installed source
   * instead: if upstream ever regresses it, this fails.
   */
  const view = source(
    'node_modules/expo-camera/android/src/main/java/expo/modules/camera/ExpoCameraView.kt',
  );
  assert.match(view, /val x = cornerPoints\[i\]\.toFloat\(\) \/ density/);
  assert.match(view, /val y = cornerPoints\[i \+ 1\]\.toFloat\(\) \/ density/);
});

it('the added event fields are additive, so existing consumers keep working', () => {
  const patch = source(PATCH);
  // Defaults on every new field: a consumer that ignores them is unaffected.
  assert.match(patch, /val coordinateSpace: String = "analysis"/);
  assert.match(patch, /val frameId: Double = 0\.0/);
  assert.match(patch, /val countInFrame: Int = 1/);
});

it('the patch contains no logging of scanned values', () => {
  /*
   * A native log line carrying a payload would put complete IMEIs into logcat
   * and into any crash report that scooped it up.
   */
  const patch = source(PATCH);
  const added = patch.split('\n').filter((l) => l.startsWith('+'));
  for (const line of added) {
    if (!/Log\.[dview]/.test(line)) continue;
    for (const forbidden of ['displayValue', 'rawValue', 'barcode.value', '$raw', 'cornerPoints']) {
      assert.ok(!line.includes(forbidden), `native log must not carry ${forbidden}: ${line.trim()}`);
    }
  }
});

it('10 · the patch is verified after install, and cannot fail silently', () => {
  /*
   * `patch-package` refuses to apply a stale patch, but it is only as loud as
   * whoever reads the log. A patch that quietly did not apply is the worst
   * outcome available: the scanner keeps working, every test keeps passing, and
   * the frame silently stops being the boundary.
   */
  const pkg = JSON.parse(source('package.json'));
  assert.equal(pkg.scripts.postinstall, 'patch-package && node scripts/verify-native-patch.js');
  assert.ok(pkg.devDependencies['patch-package'], 'patch-package is a devDependency');
  assert.ok(!pkg.dependencies?.['expo-dev-client'], 'no dev-client was added');

  const verifier = source('scripts/verify-native-patch.js');
  // Checks the RESULT in node_modules, not merely that the step ran.
  assert.match(verifier, /const PATCHED_VERSION = '57\.0\.4'/);
  assert.match(verifier, /process\.exit\(1\)/);
  for (const anchor of [
    'CoordinateTransform(transformFactory.getOutputTransform(imageProxy), target)',
    'barcodes.forEachIndexed',
    'isUsingRotationDegrees = true',
    'val coordinateSpace: String = "analysis"',
  ]) {
    assert.ok(verifier.includes(anchor), `verifier checks: ${anchor}`);
  }
});

it('the geometry overlay works in a compiled internal build', () => {
  /*
   * `__DEV__` alone would be useless here: the thing being checked is whether
   * emitted corners land where the frame is drawn, which needs a compiled
   * native binary — and that is release mode, where `__DEV__` is false.
   */
  const sheet = withoutComments(source('components/scanner/ScannerSheet.tsx'));
  assert.match(sheet, /const SHOW_GEOMETRY =\s*__DEV__ \|\| process\.env\.EXPO_PUBLIC_SCAN_GEOMETRY_OVERLAY === '1';/);
  assert.match(sheet, /\{SHOW_GEOMETRY && trace \?/);
  // An unpatched build is visible on the device rather than looking like a
  // working one.
  assert.match(sheet, /\} else if \(SHOW_GEOMETRY\) \{/);
});

it('12 · no complete identifier reaches the overlay or a log', () => {
  const t = traceOf('010000041000041', code(10, 20, 4, 4), 'outside');
  assert.equal(t.tail, '0041');
  assert.ok(!JSON.stringify(t).includes('010000041000041'));

  const sheet = source('components/scanner/ScannerSheet.tsx');
  assert.ok(!sheet.includes('console.log'), 'nothing is logged from the sheet');
  // And the native side logs no payload either — asserted above.
});

it('android/ and ios/ stay generated and uncommitted', () => {
  // CNG: the native projects are produced by `expo prebuild` and are not part
  // of the repository. The patch is what makes the native change durable.
  const ignore = source('.gitignore');
  assert.match(ignore, /^\/?android\/?$/m);
  assert.match(ignore, /^\/?ios\/?$/m);
  // The patch itself must be committed, so it is NOT ignored.
  assert.ok(!/^\/?patches\/?$/m.test(ignore), 'patches/ must be committed');
});

console.log(`scan region: ${passed} passed`);
