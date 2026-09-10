/**
 * "This phone is already in inventory" — where the sentence comes from.
 *
 *   node lib/scan/duplicate-warning.test.ts
 *
 * The rule this file exists to protect: recognition and existence are
 * different facts. `recognized` says a TAC resolved to a catalogue product —
 * every iPhone 15 on earth shares that TAC. `inventory.alreadyInInventory`
 * says the server found this particular handset on a shelf. Inferring the
 * second from the first would warn about every phone the shop has ever sold.
 *
 * Half of this is structural and read from source, because the alternative is
 * a device — and a device is what was missing when the last seven scanner
 * defects shipped.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  acceptsDetection,
  cameraActive,
  initialScannerState,
  scannerReducer,
  type ScannerState,
} from './machine.ts';

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

const SHEET = 'components/scanner/ScannerSheet.tsx';
const source = (p: string) => readFileSync(p, 'utf8');
const withoutComments = (t: string): string =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const code = withoutComments(source(SHEET));

const IMEI = '010000041000041';
const payload = { kind: 'imei', primary: IMEI, secondary: null } as never;
const run = (events: Parameters<typeof scannerReducer>[1][]): ScannerState =>
  events.reduce(scannerReducer, initialScannerState);

it('the warning is driven by the server answer, not by recognition', () => {
  assert.match(code, /const inventory = lookup\?\.inventory \?\? null;/);
  assert.match(code, /const alreadyHeld = inventory\?\.alreadyInInventory === true;/);

  // The failure this guards against: `recognized` standing in for existence.
  assert.ok(
    !/alreadyHeld\s*=[^;]*recognized/.test(code),
    'existence must never be derived from product recognition',
  );
});

it('the localized sentence is shown, never a literal', () => {
  assert.match(code, /t\('scan\.alreadyInInventory'\)/);
  assert.ok(
    !code.includes('already in inventory'),
    'the English copy belongs in the locale files, not in the component',
  );
});

it('a held handset cannot be turned into a second unit', () => {
  // The primary action is what would build the intake. It is refused here so
  // the reason is on screen, rather than as a database failure two forms later.
  assert.match(code, /disabled=\{tacConflict \|\| alreadyHeld\}/);
});

it('nothing financial and nothing cross-tenant is rendered', () => {
  const block = code.slice(code.indexOf('styles.duplicateBox'));
  const warning = block.slice(0, block.indexOf('</View>'));
  for (const forbidden of ['cost', 'Cost', 'margin', 'Margin', 'price', 'Price', 'company']) {
    assert.ok(!warning.includes(forbidden), `the warning must not show ${forbidden}`);
  }
  // Product and branch appear only when the server sent a summary at all —
  // `elsewhere` sends none, so another company's unit shows the sentence alone.
  assert.match(warning, /inventory\?\.unit \? \(/);
});

it('the scan lock and the camera pause are untouched', () => {
  const detected = run([{ type: 'detected', payload }]);
  assert.equal(acceptsDetection(detected), false, 'the lock still holds after a detection');
  assert.equal(cameraActive(detected), false, 'the camera is still paused behind a result');

  // And nothing in the duplicate path releases either one.
  assert.ok(
    !/alreadyHeld[\s\S]{0,200}dispatch/.test(code),
    'the warning renders; it does not drive the machine',
  );
});

console.log(`duplicate warning: ${passed} passed`);
