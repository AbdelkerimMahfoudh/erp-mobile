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

// ── choosing between several valid IMEIs ──────────────────────────────────
//
// A device found the scanner alternating between three visible IMEIs, waiting
// indefinitely, and sometimes choosing one nobody meant. Stability says a
// barcode is being held still; it never says it is the wanted one. So when more
// than one valid IMEI is on the table, the machine asks.

const IMEI_C = '013554006297015';

it('several valid IMEIs put the machine into choosing, with the camera off', () => {
  const state = run(initialScannerState, { type: 'open' }, {
    type: 'candidates',
    candidates: [IMEI_A, IMEI_B, IMEI_C],
  });

  assert.equal(state.name, 'choosing');
  // Nothing is decided, and nothing keeps scanning underneath the question.
  assert.equal(cameraActive(state), false);
  assert.equal(acceptsDetection(state), false);
  assert.deepEqual(state.name === 'choosing' && state.candidates, [IMEI_A, IMEI_B, IMEI_C]);
});

it('a single candidate is never turned into a question', () => {
  const state = run(initialScannerState, { type: 'open' }, {
    type: 'candidates',
    candidates: [IMEI_A],
  });
  assert.equal(state.name, 'scanning', 'one answer is not ambiguous');
});

it('candidates are ignored unless the camera was running', () => {
  const showing = scanOnce(IMEI_A);
  assert.equal(showing.name, 'result');
  const after = scannerReducer(showing, { type: 'candidates', candidates: [IMEI_A, IMEI_B] });
  assert.equal(after.name, 'result', 'a shown result is not replaced by a question');
});

it('choosing one IMEI produces an ordinary result', () => {
  // One path from here, not two: the panel, the lookup and acceptance behave
  // exactly as they do after a single unambiguous scan.
  const choosing = run(initialScannerState, { type: 'open' }, {
    type: 'candidates',
    candidates: [IMEI_A, IMEI_B],
  });
  const chosen = scannerReducer(choosing, { type: 'chose', primary: IMEI_B, secondary: null });

  assert.equal(chosen.name, 'result');
  assert.equal(chosen.name === 'result' && chosen.primary, IMEI_B);
  assert.equal(chosen.name === 'result' && chosen.secondary, null);
  assert.equal(chosen.name === 'result' && chosen.problem, null);
});

it('choosing both produces one phone with two identifiers', () => {
  const choosing = run(initialScannerState, { type: 'open' }, {
    type: 'candidates',
    candidates: [IMEI_A, IMEI_B],
  });
  const both = scannerReducer(choosing, { type: 'chose', primary: IMEI_A, secondary: IMEI_B });

  assert.equal(both.name === 'result' && both.primary, IMEI_A);
  assert.equal(both.name === 'result' && both.secondary, IMEI_B);

  // …and it accepts as ONE unit, never two.
  const accepted = scannerReducer(both, { type: 'accept' });
  assert.equal(accepted.name, 'accepted');
  assert.equal(accepted.name === 'accepted' && accepted.primary, IMEI_A);
  assert.equal(accepted.name === 'accepted' && accepted.secondary, IMEI_B);
});

it('"Scan again" leaves the question without losing IMEI 1', () => {
  // "None of these" is a real answer, and on pass 2 it must not cost the
  // identifier already confirmed.
  const pass2 = run(
    initialScannerState,
    { type: 'open' },
    { type: 'detected', raw: IMEI_A },
    { type: 'validated', payload: classifyScan(IMEI_A) },
    { type: 'addSecond' },
  );
  assert.equal(pass2.name === 'scanning' && pass2.pass, 2);

  const choosing = scannerReducer(pass2, { type: 'candidates', candidates: [IMEI_B, IMEI_C] });
  assert.equal(choosing.name, 'choosing');
  assert.equal(choosing.name === 'choosing' && choosing.primary, IMEI_A, 'IMEI 1 is carried');

  const again = scannerReducer(choosing, { type: 'scanAgain' });
  assert.equal(again.name, 'scanning');
  assert.equal(again.name === 'scanning' && again.primary, IMEI_A, 'and survives the retry');
  assert.equal(cameraActive(again), true);
});

it('cancelling from the question is final, as everywhere else', () => {
  const choosing = run(initialScannerState, { type: 'open' }, {
    type: 'candidates',
    candidates: [IMEI_A, IMEI_B],
  });
  assert.equal(scannerReducer(choosing, { type: 'cancel' }).name, 'cancelled');
});

it('a choice is ignored unless a question was asked', () => {
  const scanning = run(initialScannerState, { type: 'open' });
  const after = scannerReducer(scanning, { type: 'chose', primary: IMEI_A, secondary: null });
  assert.equal(after.name, 'scanning', 'nothing was on the table to choose from');
});

it('reopening clears the question entirely', () => {
  const choosing = run(initialScannerState, { type: 'open' }, {
    type: 'candidates',
    candidates: [IMEI_A, IMEI_B],
  });
  const reopened = scannerReducer(choosing, { type: 'open' });
  assert.equal(reopened.name, 'scanning');
  assert.equal(reopened.name === 'scanning' && reopened.primary, null);
  assert.equal(reopened.name === 'scanning' && reopened.pass, 1);
});

console.log('\n' + passed + ' passed');
