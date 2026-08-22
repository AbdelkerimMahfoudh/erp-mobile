/**
 * The scanner state machine (milestone O).
 *
 * Run directly with Node (type-stripping):
 *   node lib/scan/machine.test.ts
 * Exits non-zero on any failure.
 *
 * These tests exist because of a specific reported defect: a valid IMEI was
 * detected, the camera kept scanning, and nothing appeared until the user
 * closed the sheet by hand. Every assertion below is about the lock — when a
 * detection is taken, when it is dropped, and what it takes to start again.
 */
import assert from 'node:assert/strict';
import {
  acceptsDetection,
  cameraActive,
  detectedSoFar,
  initialScannerState,
  scannerReducer,
  type ScannerEvent,
  type ScannerState,
} from './machine.ts';
import { classifyScan } from './payload.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log('  ok  ' + name);
};

const IMEI_A = '490154203237518';
const IMEI_B = '356938035643809';

const run = (state: ScannerState, ...events: ScannerEvent[]): ScannerState =>
  events.reduce(scannerReducer, state);

/** Open, detect one payload, and classify it — the ordinary happy path. */
function scanOnce(raw: string, from: ScannerState = initialScannerState): ScannerState {
  const detected = run(from, from.name === 'idle' ? { type: 'open' } : { type: 'scanAgain' }, {
    type: 'detected',
    raw,
  });
  return scannerReducer(detected, { type: 'validated', payload: classifyScan(raw) });
}

// ── the lock ─────────────────────────────────────────────────────────────────

it('only the first of many camera callbacks is taken', () => {
  // The camera fires far faster than React renders. Every event after the first
  // must be dropped synchronously, before any lookup starts.
  let state = run(initialScannerState, { type: 'open' });
  assert.ok(acceptsDetection(state));

  state = scannerReducer(state, { type: 'detected', raw: IMEI_A });
  assert.equal(state.name, 'validating');

  for (let i = 0; i < 20; i++) {
    state = scannerReducer(state, { type: 'detected', raw: IMEI_B });
  }
  assert.equal(state.name, 'validating');
  assert.equal(state.name === 'validating' && state.raw, IMEI_A, 'the FIRST payload must win');
});

it('callbacks are ignored while validating', () => {
  const state = run(initialScannerState, { type: 'open' }, { type: 'detected', raw: IMEI_A });
  assert.equal(acceptsDetection(state), false);
  assert.equal(cameraActive(state), false, 'the camera is already paused during the lookup');
});

it('the camera stays paused while the result is on screen', () => {
  const state = scanOnce(IMEI_A);
  assert.equal(state.name, 'result');
  assert.equal(cameraActive(state), false);
  assert.equal(acceptsDetection(state), false, 'nothing may scan behind the result');
});

it('a result never returns to scanning on its own', () => {
  let state = scanOnce(IMEI_A);
  // Anything short of an explicit decision leaves it exactly where it is.
  state = run(state, { type: 'validated', payload: classifyScan(IMEI_B) }, { type: 'detected', raw: IMEI_B });
  assert.equal(state.name, 'result');
  assert.equal(state.name === 'result' && state.primary, IMEI_A);
});

it('scan again is what releases the lock, and it clears the rejected result', () => {
  const rejected = scanOnce('IMEI: 12345');
  assert.equal(rejected.name === 'result' && rejected.problem, 'length');

  const again = scannerReducer(rejected, { type: 'scanAgain' });
  assert.equal(again.name, 'scanning');
  assert.ok(acceptsDetection(again));
  assert.ok(cameraActive(again));
  assert.equal(again.name === 'scanning' && again.primary, null, 'the rejected reading is gone');
});

// ── one IMEI is enough ───────────────────────────────────────────────────────

it('a single IMEI is accepted with no second scan', () => {
  const state = scannerReducer(scanOnce(IMEI_A), { type: 'accept' });
  assert.deepEqual(state, { name: 'accepted', primary: IMEI_A, secondary: null });
});

it('a QR carrying both is accepted as one phone in one step', () => {
  const state = scannerReducer(scanOnce('IMEI1:' + IMEI_A + '\nIMEI2:' + IMEI_B), { type: 'accept' });
  assert.deepEqual(state, { name: 'accepted', primary: IMEI_A, secondary: IMEI_B });
});

// ── the optional second identifier ───────────────────────────────────────────

it('adding a second IMEI keeps the first locked while the camera resumes', () => {
  const first = scanOnce(IMEI_A);
  const resumed = scannerReducer(first, { type: 'addSecond' });
  assert.equal(resumed.name, 'scanning');
  assert.equal(resumed.name === 'scanning' && resumed.pass, 2);
  assert.equal(resumed.name === 'scanning' && resumed.primary, IMEI_A, 'IMEI 1 must survive');
  assert.ok(acceptsDetection(resumed));
});

it('a second scan of the SAME number is refused, and IMEI 1 survives', () => {
  let state = scannerReducer(scanOnce(IMEI_A), { type: 'addSecond' });
  state = run(state, { type: 'detected', raw: IMEI_A }, { type: 'validated', payload: classifyScan(IMEI_A) });
  assert.equal(state.name === 'result' && state.problem, 'same_as_primary');
  assert.equal(state.name === 'result' && state.primary, IMEI_A);
  assert.equal(state.name === 'result' && state.secondary, null);
});

it('a rejected second scan can be retried without losing IMEI 1', () => {
  let state = scannerReducer(scanOnce(IMEI_A), { type: 'addSecond' });
  state = run(state, { type: 'detected', raw: IMEI_A }, { type: 'validated', payload: classifyScan(IMEI_A) });
  state = scannerReducer(state, { type: 'scanAgain' });
  assert.equal(state.name === 'scanning' && state.primary, IMEI_A, 'the second pass keeps IMEI 1');

  state = run(state, { type: 'detected', raw: IMEI_B }, { type: 'validated', payload: classifyScan(IMEI_B) });
  assert.equal(state.name === 'result' && state.secondary, IMEI_B);

  const accepted = scannerReducer(state, { type: 'accept' });
  assert.deepEqual(accepted, { name: 'accepted', primary: IMEI_A, secondary: IMEI_B });
});

it('IMEI 2 can be removed without losing IMEI 1', () => {
  const both = scanOnce('IMEI1:' + IMEI_A + '\nIMEI2:' + IMEI_B);
  const removed = scannerReducer(both, { type: 'removeSecond' });
  assert.equal(removed.name === 'result' && removed.primary, IMEI_A);
  assert.equal(removed.name === 'result' && removed.secondary, null);
  assert.deepEqual(scannerReducer(removed, { type: 'accept' }), {
    name: 'accepted',
    primary: IMEI_A,
    secondary: null,
  });
});

// ── bad data is never accepted silently ──────────────────────────────────────

it('a failed check digit cannot be accepted', () => {
  const bad = scanOnce('490154203237519');
  assert.equal(bad.name === 'result' && bad.problem, 'checksum');
  assert.equal(scannerReducer(bad, { type: 'accept' }).name, 'result', 'accept must do nothing');
});

it('three candidates cannot be accepted — a person chooses', () => {
  const many = scanOnce([IMEI_A, IMEI_B, '351756051523993'].join('\n'));
  assert.equal(many.name === 'result' && many.problem, 'ambiguous');
  assert.equal(scannerReducer(many, { type: 'accept' }).name, 'result');
});

it('an ordinary product barcode does not become a phone', () => {
  const barcode = scanOnce('5901234123457');
  assert.equal(barcode.name === 'result' && barcode.problem, 'not_an_imei');
  assert.equal(barcode.name === 'result' && barcode.primary, null);
  assert.equal(scannerReducer(barcode, { type: 'accept' }).name, 'result');
});

// ── typing, which is never taken away ────────────────────────────────────────

it('manual entry of one IMEI reaches the same accepted state', () => {
  const state = scannerReducer(initialScannerState, {
    type: 'manual',
    primary: IMEI_A,
    secondary: null,
  });
  assert.deepEqual(state, { name: 'accepted', primary: IMEI_A, secondary: null });
});

it('manual entry supports the optional second IMEI', () => {
  const state = scannerReducer(initialScannerState, {
    type: 'manual',
    primary: IMEI_A,
    secondary: IMEI_B,
  });
  assert.deepEqual(state, { name: 'accepted', primary: IMEI_A, secondary: IMEI_B });
});

it('manual entry refuses the same number twice', () => {
  const state = scannerReducer(initialScannerState, {
    type: 'manual',
    primary: IMEI_A,
    secondary: IMEI_A,
  });
  assert.notEqual(state.name, 'accepted');
});

// ── cancelling ───────────────────────────────────────────────────────────────

it('cancel is always available and always final', () => {
  for (const from of [
    initialScannerState,
    run(initialScannerState, { type: 'open' }),
    scanOnce(IMEI_A),
  ]) {
    assert.deepEqual(scannerReducer(from, { type: 'cancel' }), { name: 'cancelled' });
  }
});

it('what has been detected is readable at every stage', () => {
  assert.equal(detectedSoFar(initialScannerState), null);
  assert.deepEqual(detectedSoFar(scanOnce(IMEI_A)), { primary: IMEI_A, secondary: null });
  assert.deepEqual(detectedSoFar(scannerReducer(scanOnce(IMEI_A), { type: 'accept' })), {
    primary: IMEI_A,
    secondary: null,
  });
});

console.log('\n' + passed + ' passed');
