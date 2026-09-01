#!/usr/bin/env node
/**
 * Fails the install if the native patch is not actually in place.
 *
 * `patch-package` already refuses to apply a patch whose context has moved, but
 * it is only as loud as whoever reads the log — and a patch that quietly did
 * not apply is the worst outcome available here. The scanner would keep
 * working, every JavaScript test would keep passing, and the frame drawn on
 * screen would stop being the boundary that is enforced. Silent, and only
 * visible to somebody holding a phone against a label.
 *
 * So this checks the result rather than trusting the step: the installed
 * version is the one the patch was cut for, and every anchor the patch depends
 * on is present in `node_modules` afterwards.
 *
 * Run automatically by `postinstall`, after `patch-package`.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PKG = 'expo-camera';
/** The version this patch was cut against. Bump only after re-cutting it. */
const PATCHED_VERSION = '17.0.10';

const red = (s) => `[31m${s}[0m`;
const problems = [];

function fail(what, detail) {
  problems.push(`${what}\n    ${detail}`);
}

// ── the patch file itself ────────────────────────────────────────────────
const patchFile = path.join(ROOT, 'patches', `${PKG}+${PATCHED_VERSION}.patch`);
if (!fs.existsSync(patchFile)) {
  fail('The native patch is missing.', `Expected ${path.relative(ROOT, patchFile)}`);
}

// ── the version it was cut for ───────────────────────────────────────────
let installed = null;
try {
  installed = require(path.join(ROOT, 'node_modules', PKG, 'package.json')).version;
} catch {
  fail(`${PKG} is not installed.`, 'Run npm install.');
}

if (installed && installed !== PATCHED_VERSION) {
  fail(
    `${PKG} is ${installed}, but the patch was cut against ${PATCHED_VERSION}.`,
    'The Android scan region depends on this patch. Re-cut it against the new\n' +
      '    version and re-verify on a device before shipping:\n' +
      `        npx patch-package ${PKG}\n` +
      '    Then update PATCHED_VERSION in scripts/verify-native-patch.js.',
  );
}

/*
 * ── the anchors ──────────────────────────────────────────────────────────
 *
 * One per thing the patch actually changes, so a partially applied patch is
 * caught as precisely as a missing one. Each is a short, distinctive string
 * from the patched source — short enough to survive reformatting, distinctive
 * enough not to appear by chance.
 */
const ANCHORS = [
  [
    'android/src/main/java/expo/modules/camera/analyzers/BarcodeAnalyzer.kt',
    'CoordinateTransform(transformFactory.getOutputTransform(imageProxy), target)',
    'CameraX coordinate mapping',
  ],
  [
    'android/src/main/java/expo/modules/camera/analyzers/BarcodeAnalyzer.kt',
    'barcodes.forEachIndexed',
    'every barcode forwarded (the .first() limitation is removed)',
  ],
  [
    'android/src/main/java/expo/modules/camera/analyzers/BarcodeAnalyzer.kt',
    'isUsingRotationDegrees = true',
    'rotation accounted for',
  ],
  [
    'android/src/main/java/expo/modules/camera/common/CommonEvents.kt',
    'val coordinateSpace: String = "analysis"',
    'the capability marker JavaScript gates on',
  ],
  [
    'android/src/main/java/expo/modules/camera/ExpoCameraView.kt',
    'BarcodeAnalyzer(lensFacing, barcodeFormats, { previewView })',
    'the PreviewView reaches the analyzer',
  ],
  [
    'android/src/main/java/expo/modules/camera/ExpoCameraView.kt',
    'val x = cornerPoints[i].toFloat() / density',
    'the x/y transposition is fixed',
  ],
];

for (const [file, anchor, what] of ANCHORS) {
  const full = path.join(ROOT, 'node_modules', PKG, file);
  let source = '';
  try {
    source = fs.readFileSync(full, 'utf8');
  } catch {
    fail(`Cannot read ${file}.`, 'The package layout changed; the patch needs re-cutting.');
    continue;
  }
  if (!source.includes(anchor)) {
    fail(`The patch did not apply: ${what}.`, `Missing from ${file}:\n        ${anchor}`);
  }
}

if (problems.length > 0) {
  console.error(red('\n  The expo-camera native patch is not in place.\n'));
  for (const p of problems) console.error(`  • ${p}\n`);
  console.error(
    '  Android would still scan, but the visible frame would NOT be the\n' +
      '  detection boundary — and nothing else would say so. Fix this before\n' +
      '  building.\n',
  );
  process.exit(1);
}

console.log(`  expo-camera@${PATCHED_VERSION} native patch verified (${ANCHORS.length} anchors).`);
