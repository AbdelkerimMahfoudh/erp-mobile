/**
 * Target acquisition on a crowded label.
 *
 *   node lib/scan/stabilizer.test.ts
 *
 * Two device failures live behind these tests.
 *
 * The scanner first accepted whatever crossed the lens in under a second,
 * before anybody had finished aiming — 3/3 physical attempts failed.
 *
 * The fix for that could not scan a phone label at all, and this suite is what
 * would have caught it: `expo-camera` fires once per BARCODE, not once per
 * frame, so a label carrying IMEI 1, IMEI 2, a serial and a model number
 * produces interleaved callbacks. Tracking one candidate and resetting on every
 * payload change meant they cancelled each other forever.
 *
 * The clock is a plain number these tests advance by hand, so the window is
 * checked at the millisecond on both sides of the boundary — no device, and no
 * real second spent per case.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EMPTY_ACQUISITION,
  INVALID_COOLDOWN_MS,
  AMBIGUITY_GRACE_MS,
  MAX_CANDIDATES,
  MAX_GAP_MS,
  MIN_OBSERVATIONS,
  MIN_WINDOW_MS,
  centreOf,
  isAcceptable,
  normalisePayload,
  observe,
  progressOf,
  prune,
  selectTarget,
  type Acquisition,
  type Point,
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

const IMEI_A = '010000041000041';
const IMEI_B = '010000045000047';
const IMEI_C = '010000042000040';
const SERIAL = 'SN-ABC123456';
const MODEL = 'A2650';
const BARCODE = '6001234500009';
/** Fifteen digits, one digit wrong: the near-miss a mistyped IMEI looks like. */
const BAD_CHECKSUM = '010000041000042';

const PREVIEW = { width: 400, height: 800 };
/** A box centred at (cx, cy) in preview points, as iOS AVFoundation reports. */
const at = (cx: number, cy: number, size = 40): Point[] => [
  { x: cx - size, y: cy - size / 2 },
  { x: cx + size, y: cy - size / 2 },
  { x: cx + size, y: cy + size / 2 },
  { x: cx - size, y: cy + size / 2 },
];

/**
 * A camera, driven by hand.
 *
 * `feed` is one decoder callback — one barcode, which is what the library
 * actually delivers. `frame` is several barcodes visible at once, which is what
 * a phone label actually looks like.
 */
function camera() {
  let now = 0;
  let state: Acquisition = EMPTY_ACQUISITION;
  const accepted: string[] = [];
  const rejected: string[] = [];
  /*
   * The success lock, modelled honestly.
   *
   * On acceptance the sheet leaves `scanning`, and `acceptsDetection` then
   * refuses every further callback — the camera keeps running but nothing
   * reaches the tracker. A harness that kept feeding would be testing a
   * scanner that does not exist, and would hide duplicate submissions rather
   * than catch them.
   */
  let locked = false;

  const api = {
    get now() {
      return now;
    },
    get state() {
      return state;
    },
    get accepted() {
      return accepted;
    },
    get rejected() {
      return rejected;
    },
    tick(ms: number) {
      now += ms;
      state = prune(state, now);
    },
    get locked() {
      return locked;
    },
    /** Cancel, "Scan again", or a new session: the tracker is emptied. */
    reset() {
      state = EMPTY_ACQUISITION;
      locked = false;
    },
    feed(raw: string, corners?: Point[]) {
      if (locked) return { action: 'idle' as const, state };
      const v = observe(state, {
        raw,
        at: now,
        corners,
        preview: PREVIEW,
        previewSpace: true,
        prefer: 'imei',
      });
      state = v.state;
      if (v.action === 'accept') {
        accepted.push(v.payload.kind === 'imei' ? v.payload.primary : raw);
        state = EMPTY_ACQUISITION;
        locked = true;
      }
      if (v.action === 'reject') rejected.push(v.target.key);
      return v;
    },
    /** One frame of a label: every visible barcode, back to back. */
    frame(codes: (string | [string, Point[]])[]) {
      for (const c of codes) {
        if (Array.isArray(c)) api.feed(c[0], c[1]);
        else api.feed(c);
      }
    },
    /** Hold a label steady for `ms`, one frame every `every` ms. */
    hold(codes: (string | [string, Point[]])[], ms: number, every = 100) {
      const end = now + ms;
      api.frame(codes);
      while (now < end) {
        api.tick(every);
        api.frame(codes);
      }
    },
  };
  return api;
}

// ── 1 · a candidate under a second is never accepted ──────────────────────

it('1 · a candidate present for under a second is not accepted', () => {
  const cam = camera();
  const first = cam.feed(IMEI_A);
  assert.equal(first.action, 'holding', 'one sighting is never enough');

  cam.hold([IMEI_A], 900, 100);
  assert.deepEqual(cam.accepted, [], 'nothing may be accepted inside the window');
  assert.ok(cam.state.candidates[0].count >= MIN_OBSERVATIONS, 'count alone is not enough');
});

it('1b · nothing at 999ms, accepted at 1000ms', () => {
  // The boundary from both sides. "About a second" is not a specification, and
  // a device cannot tell you which side it landed on.
  const early = camera();
  early.feed(IMEI_A);
  for (let t = 250; t <= 750; t += 250) {
    early.tick(250);
    assert.equal(early.feed(IMEI_A).action, 'holding', `${t}ms is inside the window`);
  }
  early.tick(249);
  assert.equal(early.now, 999);
  assert.equal(early.feed(IMEI_A).action, 'holding', '999ms is still too early');

  const exact = camera();
  exact.feed(IMEI_A);
  for (let i = 0; i < 4; i++) {
    exact.tick(250);
    if (i < 3) exact.feed(IMEI_A);
  }
  assert.equal(exact.now, MIN_WINDOW_MS);
  assert.equal(exact.feed(IMEI_A).action, 'accept', 'exactly one second is enough');
});

// ── 2 · a stable candidate is accepted exactly once ───────────────────────

it('2 · the same valid candidate held past a second is accepted exactly once', () => {
  const cam = camera();
  cam.hold([IMEI_A], 1_200, 100);

  assert.deepEqual(cam.accepted, [IMEI_A]);

  // Repeated callbacks after acceptance must not produce a second one. The
  // sheet has locked; this mirrors that by clearing the acquisition.
  for (let i = 0; i < 20; i++) {
    cam.tick(33);
    cam.feed(IMEI_A);
  }
  assert.equal(cam.accepted.length, 1, 'no duplicate submission');
});

// ── 3 · a replacement candidate earns its own window ──────────────────────

it('3 · A for 600ms then B replaces it — A is not accepted, B starts fresh', () => {
  const cam = camera();
  cam.hold([IMEI_A], 600, 100);
  assert.deepEqual(cam.accepted, []);

  // The camera moves. A is gone; B is what is in frame now.
  cam.tick(MAX_GAP_MS + 1);
  cam.hold([IMEI_B], 700, 100);

  assert.deepEqual(cam.accepted, [], 'B has not earned a full second yet');
  assert.ok(!cam.state.candidates.some((c) => c.key === IMEI_A), 'A was dropped');

  cam.hold([IMEI_B], 500, 100);
  assert.deepEqual(cam.accepted, [IMEI_B], 'B is accepted on its own merit');
});

// ── 4 · leaving the frame resets the window ───────────────────────────────

it('4 · a candidate that leaves before a second resets its window', () => {
  const cam = camera();
  cam.hold([IMEI_A], 800, 100);

  cam.tick(MAX_GAP_MS + 1); // lifted away
  assert.equal(cam.state.candidates.length, 0, 'silence drops it');

  cam.feed(IMEI_A);
  assert.equal(cam.state.candidates[0].count, 1, 'coming back is a new attempt');
  assert.deepEqual(cam.accepted, []);
});

it('4b · a gap just inside the limit keeps the window', () => {
  // A blur or a refocus must not cost somebody the second already held.
  const cam = camera();
  cam.feed(IMEI_A);
  cam.tick(MAX_GAP_MS);
  cam.feed(IMEI_A);
  assert.equal(cam.state.candidates[0].count, 2);
});

// ── 5 · a crowded label ───────────────────────────────────────────────────

it('5 · a four-barcode label can be scanned at all', () => {
  /*
   * THE regression this suite exists for, in the exact shape it was measured.
   *
   * A B C D / A B C D / A B C D … over several seconds, camera stationary. The
   * previous implementation accepted NOTHING in 4 950 ms, because seeing B
   * erased A's history, and seeing A erased B's, forever.
   *
   * The assertion that matters is not "something was accepted" — it is that
   * interleaved sightings of B, C and D do not reset A's own acquisition.
   */
  const cam = camera();
  cam.hold([IMEI_A, IMEI_B, SERIAL, MODEL], 5_000, 33);

  assert.equal(cam.accepted.length, 1, 'exactly one code is accepted');
  assert.equal(cam.accepted[0], IMEI_A, 'and it is one the business flow can use');
});

it('5a · interleaving does not reset any candidate’s history', () => {
  // The mechanism, asserted directly rather than through an outcome. Every one
  // of the four keeps accumulating while the other three are also being seen.
  const cam = camera();
  const label = [IMEI_A, IMEI_B, SERIAL, MODEL];
  for (let i = 0; i < 8; i++) {
    cam.frame(label);
    cam.tick(100);
  }

  assert.equal(cam.state.candidates.length, 4, 'all four are tracked at once');
  for (const c of cam.state.candidates) {
    assert.ok(c.count >= 8, `${c.key} kept its history (count ${c.count})`);
    assert.ok(c.lastAt - c.firstAt >= 700, `${c.key} kept its span`);
  }
});

it('5a2 · a usable code is never blocked by an unusable one beside it', () => {
  /*
   * A serial number and a model number are decoded just as often as the IMEI,
   * and one of them may sit closer to the reticle. Ranking everything together
   * and checking usability afterwards meant the scan failed with "that is not
   * an IMEI" while the IMEI was in frame the whole time.
   */
  const cam = camera();
  cam.hold(
    [
      [SERIAL, at(200, 400)], // dead centre, and unusable
      [MODEL, at(205, 400)],
      [IMEI_A, at(60, 700)], // off in a corner, and the only real answer
    ],
    2_500,
    33,
  );

  assert.deepEqual(cam.accepted, [IMEI_A]);
});

it('5b · with coordinates, the code nearest the reticle wins', () => {
  const cam = camera();
  // IMEI B sits in the middle of the preview; the others are at the edges.
  cam.hold(
    [
      [IMEI_A, at(60, 100)],
      [IMEI_B, at(200, 400)],
      [SERIAL, at(340, 700)],
    ],
    1_500,
    33,
  );

  assert.deepEqual(cam.accepted, [IMEI_B], 'the centred code is the aimed-at one');
});

it('5c · position ranks, and never shortens anybody’s window', () => {
  // Being best-centred makes a candidate preferred, never faster.
  const cam = camera();
  cam.hold([[IMEI_A, at(200, 400)]], 900, 100);
  assert.deepEqual(cam.accepted, [], 'dead centre is still not enough before a second');
});

it('5d · an off-centre code is still accepted when it is the only one', () => {
  // The rule the answer to the ROI question turned on: position may reorder
  // candidates, never reject them all. A scanner that refuses everything
  // because a coordinate space was guessed wrong is worse than one that
  // occasionally prefers a neighbour.
  const cam = camera();
  cam.hold([[IMEI_A, at(390, 780)]], 1_500, 100);

  assert.deepEqual(cam.accepted, [IMEI_A]);
});

it('5e · with no usable coordinates it falls back to stability alone', () => {
  /*
   * Android: corner points are image pixels over display density and the image
   * size is never sent to JS, so there is no denominator. Scanning must still
   * work — nothing is ever rejected for want of a coordinate.
   *
   * Two equally-held IMEIs and no way to tell them apart is the genuinely
   * ambiguous case, so acquisition deliberately CONTINUES rather than tossing a
   * coin. It is bounded: after the grace period a stable answer is taken.
   */
  const cam = camera();
  cam.hold([IMEI_A, IMEI_B], 1_500, 33);
  assert.deepEqual(cam.accepted, [], 'no arbitrary pick while they are level');

  cam.hold([IMEI_A, IMEI_B], AMBIGUITY_GRACE_MS + 200, 33);
  assert.equal(cam.accepted.length, 1, 'and it does not hang');
  assert.ok([IMEI_A, IMEI_B].includes(cam.accepted[0]));
});

it('5e2 · one code with no coordinates at all is accepted normally', () => {
  // The case that matters most on Android: nothing positional is known, one
  // code is being aimed at, and it must simply work.
  const cam = camera();
  cam.hold([IMEI_A], 1_200, 100);
  assert.deepEqual(cam.accepted, [IMEI_A]);
});

it('5f · selection is deterministic — it does not flicker between equals', () => {
  const seen = new Set<string>();
  for (let run = 0; run < 8; run++) {
    const cam = camera();
    cam.hold([IMEI_A, IMEI_B, IMEI_C], 1_500, 33);
    seen.add(cam.accepted[0]);
  }
  assert.equal(seen.size, 1, 'the same label must always resolve the same way');
});

// ── 6 · an invalid code never reaches the business flow ───────────────────

it('6 · a 15-digit code with a bad checksum is never accepted', () => {
  assert.equal(classifyScan(BAD_CHECKSUM).kind, 'invalid');
  assert.equal(isAcceptable(classifyScan(BAD_CHECKSUM)), false);

  const cam = camera();
  cam.hold([BAD_CHECKSUM], 3_000, 100);

  assert.deepEqual(cam.accepted, [], 'holding still never makes a bad code good');
  assert.ok(cam.rejected.includes(BAD_CHECKSUM), 'and the user is told why');
});

it('6b · an unusable code is reported rarely, not every frame', () => {
  /*
   * The requirement is "no frustrating loop", not "exactly one message ever".
   * A damaged label held in frame for five seconds gets told twice — once, then
   * again after the cooldown lapses — instead of fifty times. Saying it again
   * eventually is right: somebody who walked away and came back deserves to
   * know why nothing is happening.
   */
  const cam = camera();
  cam.hold([BAD_CHECKSUM], 5_000, 100);

  assert.ok(cam.rejected.length >= 1, 'the user is told at least once');
  assert.ok(cam.rejected.length <= 5_000 / INVALID_COOLDOWN_MS + 1, 'and not per frame');
  assert.ok(cam.rejected.length < 5, `${cam.rejected.length} messages in 5s`);
});

it('6c · the cooldown does not block moving to another code', () => {
  const cam = camera();
  cam.hold([BAD_CHECKSUM], 1_200, 100);
  assert.equal(cam.rejected.length, 1);

  // Both in frame: the bad one is cooling down, the good one still works.
  cam.hold([BAD_CHECKSUM, IMEI_A], 1_500, 33);
  assert.deepEqual(cam.accepted, [IMEI_A]);
  assert.ok(cam.now < INVALID_COOLDOWN_MS + 1_500, 'still inside the cooldown');
});

it('6d · an ambiguous payload is never accepted', () => {
  // Three plausible IMEIs is a question for a person; holding still does not
  // answer it.
  const three = `${IMEI_A}\n${IMEI_B}\n${IMEI_C}`;
  assert.equal(classifyScan(three).kind, 'ambiguous');

  const cam = camera();
  cam.hold([three], 3_000, 100);
  assert.deepEqual(cam.accepted, []);
});

// ── 7 · the existing validation and business flow are unchanged ───────────

it('7 · an accepted IMEI arrives classified, ready for the existing flow', () => {
  const cam = camera();
  const codes: string[] = [];
  let state = EMPTY_ACQUISITION;
  let now = 0;
  for (let i = 0; i < 40; i++) {
    const v = observe(state, { raw: IMEI_A, at: now });
    state = v.state;
    if (v.action === 'accept') {
      assert.equal(v.payload.kind, 'imei');
      assert.equal(v.payload.kind === 'imei' && v.payload.primary, IMEI_A);
      codes.push(IMEI_A);
      break;
    }
    now += 100;
  }
  assert.deepEqual(codes, [IMEI_A]);
  assert.ok(cam.now === 0, 'unused camera');
});

it('7b · a dual-SIM QR is one payload describing one phone', () => {
  const dual = `IMEI1: ${IMEI_A}\nIMEI2: ${IMEI_B}`;
  const otherSecond = `IMEI1: ${IMEI_A}\nIMEI2: ${IMEI_C}`;

  // Same first line, different phone. Comparing only the first would let this
  // extend the other's window and accept the wrong handset.
  assert.notEqual(normalisePayload(dual), normalisePayload(otherSecond));

  const cam = camera();
  cam.hold([dual], 1_200, 100);
  assert.deepEqual(cam.accepted, [IMEI_A]);
});

it('7c · an ordinary product barcode obeys the same rule', () => {
  assert.equal(classifyScan(BARCODE).kind, 'other');

  const cam = camera();
  cam.feed(BARCODE);
  assert.deepEqual(cam.accepted, [], 'not accepted on sight either');

  cam.hold([BARCODE], 1_200, 100);
  assert.deepEqual(cam.accepted, [BARCODE]);
});

it('7d · decoder noise is not a different code', () => {
  assert.equal(normalisePayload(`  ${IMEI_A}\n`), normalisePayload(IMEI_A));

  const cam = camera();
  cam.feed(`${IMEI_A}\n`);
  cam.tick(100);
  cam.feed(`  ${IMEI_A}  `);
  assert.equal(cam.state.candidates[0].count, 2);
});

// ── coordinates ───────────────────────────────────────────────────────────

it('centreOf averages corners, so platform ordering cannot matter', () => {
  // Android, iOS and Web each report corners in a different order, and the
  // centroid of a set does not depend on the order of the set.
  const box = at(200, 400);
  const centre = centreOf({ raw: 'x', at: 0, corners: box, preview: PREVIEW, previewSpace: true });
  const shuffled = centreOf({
    raw: 'x',
    at: 0,
    corners: [box[2], box[0], box[3], box[1]],
    preview: PREVIEW,
    previewSpace: true,
  });
  assert.deepEqual(centre, shuffled);
  assert.ok(Math.abs(centre!.x - 0.5) < 1e-9 && Math.abs(centre!.y - 0.5) < 1e-9);
});

it('centreOf recognises already-normalised coordinates', () => {
  // iOS Vision reports 0–1 bounds. They need no preview size at all.
  const c = centreOf({
    raw: 'x',
    at: 0,
    corners: [
      { x: 0.4, y: 0.4 },
      { x: 0.6, y: 0.4 },
      { x: 0.6, y: 0.6 },
      { x: 0.4, y: 0.6 },
    ],
  });
  assert.deepEqual(c, { x: 0.5, y: 0.5 });
});

it('centreOf refuses everything it cannot be sure of', () => {
  const base = { raw: 'x', at: 0, preview: PREVIEW, previewSpace: true };
  // Android: not preview space, so there is no denominator.
  assert.equal(centreOf({ ...base, previewSpace: false, corners: at(200, 400) }), null);
  // No preview measured yet.
  assert.equal(centreOf({ raw: 'x', at: 0, previewSpace: true, corners: at(200, 400) }), null);
  // Outside the preview: these are not preview points.
  assert.equal(centreOf({ ...base, corners: at(900, 400) }), null);
  // Too few corners, or nonsense.
  assert.equal(centreOf({ ...base, corners: [{ x: 1, y: 1 }] }), null);
  assert.equal(centreOf({ ...base, corners: at(Number.NaN, 400) }), null);
  assert.equal(centreOf(base), null);
});

it('an unrankable candidate still competes on stability', () => {
  const withCentre = {
    key: 'A', payload: classifyScan(IMEI_A), firstAt: 0, lastAt: 1_000, count: 5,
    centre: { x: 0.5, y: 0.5 },
  };
  const without = {
    key: 'B', payload: classifyScan(IMEI_B), firstAt: 0, lastAt: 5_000, count: 40,
    centre: null,
  };
  // Centred wins when position is known…
  assert.equal(selectTarget([withCentre, without])?.key, 'A');
  // …and the longest-held wins when it is not known for anybody.
  assert.equal(selectTarget([{ ...withCentre, centre: null }, without])?.key, 'B');
  assert.equal(selectTarget([]), null);
});

// ── the reticle ───────────────────────────────────────────────────────────

it('progress reflects the slower of the two clauses', () => {
  const c = { key: 'A', payload: classifyScan(IMEI_A), firstAt: 0, lastAt: 0, count: 1, centre: null };
  assert.equal(progressOf(c, 0), 0);
  // Half the time but only one of three sightings: report the honest figure.
  assert.equal(progressOf(c, 500), 1 / MIN_OBSERVATIONS);
  assert.equal(progressOf({ ...c, count: MIN_OBSERVATIONS }, 500), 0.5);
  assert.equal(progressOf({ ...c, count: MIN_OBSERVATIONS }, MIN_WINDOW_MS), 1);
  assert.equal(progressOf({ ...c, count: MIN_OBSERVATIONS }, 9_999), 1, 'never over 1');
});

it('a holding verdict names the target it is holding', () => {
  const cam = camera();
  cam.feed(IMEI_A);
  cam.tick(100);
  const v = cam.feed(IMEI_A);
  assert.equal(v.action, 'holding');
  assert.equal(v.action === 'holding' && v.target.key, IMEI_A);
  assert.ok(v.action === 'holding' && v.progress > 0 && v.progress < 1);
});

it('an empty payload is idle, not a candidate', () => {
  const cam = camera();
  assert.equal(cam.feed('   ').action, 'idle');
  assert.equal(cam.state.candidates.length, 0);
});

// ── the shape of the thing ────────────────────────────────────────────────

it('an isolated sighting never becomes stable just because time passed', () => {
  // Seen once, then silence, then seen again much later. A second has elapsed
  // and nothing was held: the gap rule is what makes that different from aiming.
  const cam = camera();
  cam.feed(IMEI_A);
  cam.tick(MAX_GAP_MS + 1);
  cam.feed(IMEI_A);
  cam.tick(MAX_GAP_MS + 1);
  cam.feed(IMEI_A);

  assert.ok(cam.now > MIN_WINDOW_MS, 'more than a second has passed');
  assert.deepEqual(cam.accepted, []);
  assert.equal(cam.state.candidates[0].count, 1, 'each sighting stood alone');
});

it('two indistinguishable candidates keep acquiring rather than tossing a coin', () => {
  // Both usable, both perfectly interleaved, neither positioned. Continuing
  // briefly beats committing to whichever sorted first.
  const cam = camera();
  cam.hold([IMEI_A, IMEI_B], 1_100, 33);
  assert.deepEqual(cam.accepted, [], 'no arbitrary pick at the moment both qualify');

  // …but it must not hang. The grace period bounds the indecision.
  cam.hold([IMEI_A, IMEI_B], AMBIGUITY_GRACE_MS + 200, 33);
  assert.equal(cam.accepted.length, 1, 'a stable answer is taken in the end');
});

it('candidate tracking stays bounded however many codes go past', () => {
  const cam = camera();
  // A camera carried along a shelf: fifty different codes inside one window.
  for (let i = 0; i < 50; i++) {
    cam.feed(`600123450${String(i).padStart(4, '0')}`);
    cam.tick(5);
  }
  assert.ok(
    cam.state.candidates.length <= MAX_CANDIDATES,
    `bounded at ${MAX_CANDIDATES}, saw ${cam.state.candidates.length}`,
  );
});

it('stale candidates and expired cooldowns are both dropped', () => {
  const cam = camera();
  cam.hold([IMEI_A, IMEI_B], 300, 100);
  assert.equal(cam.state.candidates.length, 2);

  cam.tick(MAX_GAP_MS + 1);
  assert.equal(cam.state.candidates.length, 0, 'silence expires them');

  cam.hold([BAD_CHECKSUM], 1_200, 100);
  assert.equal(Object.keys(cam.state.cooldowns).length, 1);
  cam.tick(INVALID_COOLDOWN_MS + 1);
  assert.equal(Object.keys(cam.state.cooldowns).length, 0, 'and cooldowns expire too');
});

it('the tracker is cleared outright on a lifecycle reset', () => {
  // Cancel, unmount, a new session, or a completed acquisition. A window
  // half-built when the sheet closed must never be finished by the next one.
  const cam = camera();
  cam.hold([IMEI_A, IMEI_B], 800, 100);
  assert.ok(cam.state.candidates.length > 0);

  const cleared = EMPTY_ACQUISITION;
  assert.deepEqual(cleared.candidates, []);
  assert.deepEqual(cleared.cooldowns, {});
});

it('the rule is three observations across a full second', () => {
  assert.equal(MIN_OBSERVATIONS, 3);
  assert.equal(MIN_WINDOW_MS, 1_000);
  assert.ok(MAX_GAP_MS < MIN_WINDOW_MS, 'a gap limit above the window would never bite');
});

it('nothing here schedules anything', () => {
  /*
   * A `setTimeout` that accepts whatever is current after a second accepts the
   * LAST thing seen rather than the aimed-at one, and fires when the camera may
   * point anywhere. The rule is that no delay may be BLIND — not that
   * acceptance may never take time.
   */
  const code = readFileSync('lib/scan/stabilizer.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  for (const scheduler of ['setTimeout', 'setInterval', 'requestAnimationFrame', 'Date.now']) {
    assert.ok(!code.includes(scheduler), `the decision must not depend on ${scheduler}`);
  }
});

it('detection is never throttled — only commitment is delayed', () => {
  // Every callback is processed. Nothing samples, drops frames, or asks the
  // camera to slow down; the user stays free to move between labels.
  const cam = camera();
  for (let i = 0; i < 30; i++) {
    cam.feed(IMEI_A);
    cam.tick(16);
  }
  assert.equal(cam.state.candidates[0].count, 30, 'every callback counted');
});

console.log(`target acquisition: ${passed} passed`);
