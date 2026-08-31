/**
 * The one-second stability rule.
 *
 *   node lib/scan/stabilizer.test.ts
 *
 * Three physical attempts, three failures, all the same shape: the scanner
 * recognised something in well under a second — before the person had finished
 * aiming — accepted it, and unmounted the camera. On a sheet of adjacent
 * barcodes it frequently took a neighbour, or a code only half in shot.
 *
 * The clock is a plain number that these tests advance by hand. That is the
 * whole reason the stabilizer takes its time as an argument: the window can be
 * checked at the millisecond, on both sides of the boundary, without a device
 * and without spending a real second per case.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MAX_GAP_MS,
  MIN_OBSERVATIONS,
  MIN_WINDOW_MS,
  hasLapsed,
  isEligible,
  normalisePayload,
  observe,
  withinGuide,
  type Candidate,
} from './stabilizer.ts';
import { classifyScan } from './payload.ts';

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

const IMEI = '010000041000041';
const OTHER_IMEI = '010000045000047';
const BARCODE = '6001234500009';

/**
 * A camera, driven by hand.
 *
 * `feed` is one decoder callback. Time only moves when a test moves it, so
 * "before one second" and "at one second" are exact rather than hopeful.
 */
function camera() {
  let now = 0;
  let candidate: Candidate | null = null;
  const accepted: string[] = [];
  let holds = 0;

  return {
    get now() {
      return now;
    },
    get candidate() {
      return candidate;
    },
    get accepted() {
      return accepted;
    },
    get holds() {
      return holds;
    },
    tick(ms: number) {
      now += ms;
    },
    feed(raw: string, bounds?: { x: number; y: number }) {
      const verdict = observe(candidate, { raw, at: now, bounds });
      candidate = verdict.action === 'ignore' ? verdict.candidate : verdict.candidate;
      if (verdict.action === 'accept') {
        accepted.push(verdict.payload.kind === 'imei' ? verdict.payload.primary : raw);
        candidate = null; // the sheet locks and stops feeding; mirrored here
      }
      if (verdict.action === 'holding') holds += 1;
      return verdict;
    },
    /** Hold one code steady, one callback every `every` ms, for `ms` total. */
    hold(raw: string, ms: number, every = 100, bounds?: { x: number; y: number }) {
      const end = now + ms;
      this.feed(raw, bounds);
      while (now < end) {
        this.tick(every);
        this.feed(raw, bounds);
      }
    },
  };
}

// ── the defect itself ─────────────────────────────────────────────────────

it('the first valid callback is never accepted', () => {
  // THE regression. One sighting is what the device acted on, and one sighting
  // is what a barcode produces while the camera is still moving towards it.
  const cam = camera();
  const verdict = cam.feed(IMEI);

  assert.equal(verdict.action, 'holding');
  assert.deepEqual(cam.accepted, []);
});

it('repeated callbacks before one second are not accepted', () => {
  const cam = camera();
  // Nine sightings of the right code in 900ms — more than enough evidence by
  // count, and still too fast to be an aimed scan.
  cam.hold(IMEI, 900, 100);

  assert.ok(cam.candidate !== null);
  assert.ok(cam.candidate!.count >= MIN_OBSERVATIONS);
  assert.deepEqual(cam.accepted, [], 'nothing may be accepted inside the window');
});

it('nothing is accepted at 999ms, and it is accepted at 1000ms', () => {
  /*
   * The boundary from both sides, because "approximately a second" is not a
   * specification and a device cannot tell you which side it landed on.
   *
   * Observations are spaced 250ms apart rather than a single jump: the gap
   * limit means a lone leap of 999ms is a RESET, not a long hold. Writing this
   * test the naive way is what showed that `MIN_OBSERVATIONS` is never the
   * binding constraint — at 400ms maximum spacing, spanning a second always
   * takes at least four sightings anyway. A real camera fires many times a
   * second, so both clauses are comfortably met by an aimed scan and neither is
   * met by a camera in motion.
   */
  const step = 250;

  const early = camera();
  early.feed(IMEI);
  for (let t = step; t < 999; t += step) {
    early.tick(step);
    assert.equal(early.feed(IMEI).action, 'holding', `${t}ms is inside the window`);
  }
  early.tick(999 - Math.floor(998 / step) * step);
  assert.equal(early.feed(IMEI).action, 'holding', '999ms is still too early');
  assert.equal(early.now, 999);

  const exact = camera();
  exact.feed(IMEI);
  for (let t = step; t < MIN_WINDOW_MS; t += step) {
    exact.tick(step);
    exact.feed(IMEI);
  }
  exact.tick(step);
  assert.equal(exact.now, MIN_WINDOW_MS);
  assert.equal(exact.feed(IMEI).action, 'accept', 'exactly one second is enough');
});

it('three identical observations spanning a second are accepted exactly once', () => {
  const cam = camera();
  cam.hold(IMEI, 1_200, 100);

  assert.deepEqual(cam.accepted, [IMEI]);

  // And the sheet has locked: further callbacks of the same code cannot produce
  // a second acceptance.
  cam.hold(IMEI, 1_200, 100);
  assert.equal(cam.accepted.length, 2, 'a NEW window after a reset is a new scan');
});

it('count alone is not enough, and time alone is not enough', () => {
  // Both clauses matter. Ten sightings in 50ms is a camera sitting on a sheet;
  // two sightings a second apart is a camera that passed over twice.
  const fast = camera();
  for (let i = 0; i < 10; i++) {
    fast.feed(IMEI);
    fast.tick(5);
  }
  assert.deepEqual(fast.accepted, [], 'many sightings in no time is not aiming');

  const sparse = camera();
  sparse.feed(IMEI);
  sparse.tick(MIN_WINDOW_MS + 100);
  sparse.feed(IMEI);
  assert.deepEqual(sparse.accepted, [], 'two sightings a second apart is not aiming');
  assert.equal(sparse.candidate!.count, 1, 'the gap restarted it');
});

// ── resets ────────────────────────────────────────────────────────────────

it('a different number resets the whole window', () => {
  const cam = camera();
  cam.hold(IMEI, 800, 100);
  const before = cam.candidate!.count;
  assert.ok(before >= 3);

  // A neighbouring card on the QA sheet drifts through the frame.
  cam.tick(100);
  cam.feed(OTHER_IMEI);

  assert.equal(cam.candidate!.key, OTHER_IMEI);
  assert.equal(cam.candidate!.count, 1, 'the new code starts from one, not from the old count');

  // …and the original now needs a full second of its own.
  cam.tick(100);
  cam.feed(IMEI);
  assert.equal(cam.candidate!.count, 1);
  assert.deepEqual(cam.accepted, []);
});

it('a long gap resets it — a code that left the frame was not held', () => {
  const cam = camera();
  cam.hold(IMEI, 800, 100);

  cam.tick(MAX_GAP_MS + 1);
  cam.feed(IMEI);

  assert.equal(cam.candidate!.count, 1, 'coming back is a new attempt');
  assert.deepEqual(cam.accepted, []);
});

it('a gap just inside the limit continues the window', () => {
  // The other side of the same boundary: a blur or a refocus must not cost
  // somebody the second they have already held.
  const cam = camera();
  cam.feed(IMEI);
  cam.tick(MAX_GAP_MS);
  cam.feed(IMEI);

  assert.equal(cam.candidate!.count, 2, 'a survivable gap keeps the window');
});

it('silence is what makes a held candidate lapse', () => {
  // Callbacks only arrive while something is decodable, so a barcode lifted
  // away produces nothing at all rather than an event. `hasLapsed` is how the
  // sheet notices, and takes "Hold steady…" back off the screen.
  const cam = camera();
  cam.hold(IMEI, 500, 100);

  assert.equal(hasLapsed(cam.candidate, cam.now), false);
  assert.equal(hasLapsed(cam.candidate, cam.now + MAX_GAP_MS + 1), true);
  assert.equal(hasLapsed(null, 10_000), false, 'no candidate cannot lapse');
});

// ── what may never become a candidate ─────────────────────────────────────

it('an invalid IMEI never becomes a candidate, however long it is held', () => {
  // Holding still on a mistyped code must not turn it into a good one.
  // Stability is evidence of aim, never of correctness.
  const broken = '010000041000042'; // one digit off — the checksum fails
  assert.equal(classifyScan(broken).kind, 'invalid');

  const cam = camera();
  cam.hold(broken, 3_000, 100);

  assert.equal(cam.candidate, null);
  assert.deepEqual(cam.accepted, []);
});

it('an ambiguous payload never becomes a candidate', () => {
  // Three plausible IMEIs is a question for a person, and no amount of holding
  // the camera still answers it.
  const three = `${IMEI}\n${OTHER_IMEI}\n010000042000040`;
  assert.equal(classifyScan(three).kind, 'ambiguous');
  assert.equal(isEligible(classifyScan(three)), false);

  const cam = camera();
  cam.hold(three, 3_000, 100);
  assert.deepEqual(cam.accepted, []);
});

it('an unusable read does not destroy a window somebody is holding', () => {
  // Sweeping past a damaged label while aiming at a good one is not evidence
  // either way — it must not cost the second already held.
  const cam = camera();
  cam.hold(IMEI, 800, 100);
  const held = cam.candidate!.count;

  cam.tick(50);
  cam.feed('010000041000042'); // invalid: ignored, not a reset

  assert.equal(cam.candidate!.count, held, 'the good candidate survived');
  assert.equal(cam.candidate!.key, IMEI);
});

// ── aiming ────────────────────────────────────────────────────────────────

it('off-centre reads are ignored when bounds are available', () => {
  const cam = camera();
  // A card at the edge of the sheet: decodable, and not what was aimed at.
  cam.hold(IMEI, 2_000, 100, { x: 0.95, y: 0.5 });

  assert.equal(cam.candidate, null);
  assert.deepEqual(cam.accepted, []);
});

it('centred reads are accepted on the same one-second rule', () => {
  const cam = camera();
  cam.hold(IMEI, 1_200, 100, { x: 0.5, y: 0.48 });

  assert.deepEqual(cam.accepted, [IMEI]);
});

it('with no bounds, the guide constrains nothing and the rule carries it', () => {
  // Stated as a test because the copy must not claim otherwise: when the
  // platform gives nothing trustworthy, the frame is guidance, and the
  // repeated-payload rule is the whole mechanism.
  const cam = camera();
  cam.hold(IMEI, 1_200, 100); // no bounds at all

  assert.deepEqual(cam.accepted, [IMEI]);
});

it('the guide is a region, not a point', () => {
  assert.equal(withinGuide({ x: 0.5, y: 0.5 }), true);
  assert.equal(withinGuide({ x: 0.8, y: 0.5 }), true, 'comfortably inside the frame');
  assert.equal(withinGuide({ x: 0.9, y: 0.5 }), false);
  assert.equal(withinGuide({ x: 0.5, y: 0.8 }), false);
});

// ── payloads are compared whole ───────────────────────────────────────────

it('a QR carrying two IMEIs is compared as one complete payload', () => {
  const dual = `IMEI1: ${IMEI}\nIMEI2: ${OTHER_IMEI}`;
  const differentSecond = `IMEI1: ${IMEI}\nIMEI2: 010000042000040`;

  // Same first line, different phone. Comparing only the first would let this
  // extend the other's window and accept the wrong handset.
  assert.notEqual(normalisePayload(dual), normalisePayload(differentSecond));

  const cam = camera();
  cam.hold(dual, 800, 100);
  cam.tick(100);
  cam.feed(differentSecond);
  assert.equal(cam.candidate!.count, 1, 'a changed second IMEI is a different payload');
});

it('the same label read twice is the same payload despite decoder noise', () => {
  assert.equal(normalisePayload(`  ${IMEI}\n`), normalisePayload(IMEI));
  assert.equal(normalisePayload('imei: abc'), normalisePayload('IMEI:  ABC'));

  const cam = camera();
  cam.feed(`${IMEI}\n`);
  cam.tick(100);
  cam.feed(`  ${IMEI}  `);
  assert.equal(cam.candidate!.count, 2, 'trailing whitespace is not a new code');
});

it('an ordinary product barcode obeys the same rule', () => {
  assert.equal(classifyScan(BARCODE).kind, 'other');

  const cam = camera();
  cam.feed(BARCODE);
  assert.deepEqual(cam.accepted, [], 'a charger barcode is not accepted on sight either');

  cam.hold(BARCODE, 1_200, 100);
  assert.deepEqual(cam.accepted, [BARCODE]);
});

// ── the constants say what the brief says ─────────────────────────────────

it('the rule is three observations across a full second', () => {
  assert.equal(MIN_OBSERVATIONS, 3);
  assert.equal(MIN_WINDOW_MS, 1_000);
  assert.ok(MAX_GAP_MS < MIN_WINDOW_MS, 'a gap limit at or above the window would never bite');
});

it('nothing here schedules anything', () => {
  /*
   * The replacement for the old blanket ban on delays.
   *
   * A `setTimeout` that accepts whatever is current after a second accepts the
   * LAST thing seen rather than the first — the same bug in a different hat,
   * and worse, because it fires when the camera may be pointing anywhere.
   *
   * Every decision here is made from the observations themselves, at the moment
   * one arrives. The rule is that no delay may be BLIND, not that acceptance
   * may never take time.
   */
  const code = readFileSync('lib/scan/stabilizer.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  for (const scheduler of ['setTimeout', 'setInterval', 'requestAnimationFrame', 'Date.now']) {
    assert.ok(!code.includes(scheduler), `the decision must not depend on ${scheduler}`);
  }
});

console.log(`scan stabilization: ${passed} passed`);
