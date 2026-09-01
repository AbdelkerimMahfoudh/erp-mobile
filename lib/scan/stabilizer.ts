import { classifyScan, type ScanPayload } from './payload.ts';

/**
 * Target acquisition: deciding which barcode was AIMED AT, and when.
 *
 * ## Two device failures, and the second one was mine
 *
 * The scanner first accepted whatever crossed the lens, in under a second,
 * before anybody had finished aiming. The fix was a stability window — the same
 * payload, repeatedly, across a second.
 *
 * That fix could not scan a phone label at all. `expo-camera` fires
 * `onBarcodeScanned` **once per barcode, not once per frame**, so a label
 * carrying IMEI 1, IMEI 2, a serial and a model number produces four
 * interleaved callbacks. Tracking ONE candidate and resetting whenever the
 * payload changed meant they cancelled each other forever: held perfectly still
 * for 4 950 ms over four barcodes, nothing was ever accepted.
 *
 * So candidates are tracked **concurrently**, each earning its own window, and
 * one is selected. Interleaving is the normal case, not an anomaly.
 *
 * ## The rule
 *
 * A candidate is eligible when the same normalised payload has been decoded at
 * least `MIN_OBSERVATIONS` times, spanning at least `MIN_WINDOW_MS`, with no gap
 * over `MAX_GAP_MS` between consecutive sightings. The gap clause is what makes
 * it "held" rather than "seen occasionally": a code that leaves the frame and
 * returns was passed over twice, and starts again.
 *
 * ## Why not a timer
 *
 * A `setTimeout` that accepts whatever is current after a second accepts the
 * LAST thing seen rather than the aimed-at one, and fires when the camera may
 * point anywhere. Every decision here is made from an observation that actually
 * arrived, on a monotonic clock. Nothing is scheduled.
 *
 * ## The reticle ranks; it never excludes
 *
 * Barcode coordinates reach JS in three different spaces — see `centreOf` — and
 * on Android the value needed to normalise them is never forwarded at all. So
 * position is used to **prefer** the candidate nearest the reticle when it can
 * be trusted, and ignored when it cannot. It can reorder candidates; it can
 * never be the reason nothing is accepted. A scanner that refuses everything
 * because a coordinate space was guessed wrong is worse than one that
 * occasionally prefers the wrong neighbour, and the stability window is what
 * actually protects the scan on both platforms.
 *
 * ## Pure on purpose
 *
 * No React, no camera, no clock of its own — time is passed in. That is what
 * lets the window be tested to the millisecond without a device.
 */

/** Identical decodes required before a candidate is eligible. */
export const MIN_OBSERVATIONS = 3;
/** The window those decodes must span. A "fast" scan still takes this long. */
export const MIN_WINDOW_MS = 1_000;
/**
 * The longest silence allowed between two sightings of the same code.
 *
 * `expo-camera` reports a held barcode many times a second, so a gap this size
 * means it genuinely left the frame. Short enough that sweeping across a label
 * cannot accumulate a window; long enough to survive a blur or a refocus.
 */
export const MAX_GAP_MS = 600;
/**
 * How long a stabilised-but-unusable code is left alone after it is reported.
 *
 * Without this, a damaged label held in frame re-reports every few frames and
 * the message never stops. Long enough to stop the loop, short enough that
 * moving to another code and back still works.
 */
export const INVALID_COOLDOWN_MS = 3_000;
/**
 * How much longer one candidate must have been held to be called the winner.
 *
 * Two codes on the same label accumulate at almost the same rate, and picking
 * between them on a millisecond is picking at random. Below this margin the
 * scanner keeps acquiring instead — continuing briefly beats committing to a
 * coin toss.
 */
export const DOMINANCE_MARGIN_MS = 150;
/**
 * How long that indecision may last before a deterministic answer is taken.
 *
 * Without a cap, two perfectly interleaved codes are never separated and the
 * scanner waits forever. After this the ordering rules decide — which is
 * arbitrary between equals, but it is *stable*, and a scanner that eventually
 * picks one beats a scanner that hangs.
 */
export const AMBIGUITY_GRACE_MS = 600;
/**
 * The most candidates tracked at once.
 *
 * A label carries a handful; a shelf swept past a camera can produce dozens.
 * Oldest-seen are dropped first, so the codes actually being aimed at survive.
 */
export const MAX_CANDIDATES = 12;
/**
 * The most IMEIs one selection can produce.
 *
 * A phone has one IMEI per SIM slot, and the intake model carries a primary and
 * a secondary — so two is not a UI limit, it is what a `Unit` can hold. A third
 * selected identifier would have nowhere to go.
 */
export const MAX_SELECTION = 2;

/*
 * ## On tuning these
 *
 * Every constant above is a guess that has not met a phone. They are named and
 * exported precisely so they can be changed after a device test rather than
 * hunted for inside the logic.
 *
 * `MAX_GAP_MS` is the one most likely to need it, and the one that must not be
 * tied to callback frequency. It answers "is this code still in frame?", and
 * the answer has to hold on a slow device showing a busy label: with six codes
 * interleaving at 10 fps, each is seen roughly every 600 ms, so a tighter gap
 * would quietly stop that phone from ever completing an acquisition. It is
 * deliberately generous for that reason. Nothing else here counts frames or
 * assumes a rate.
 */

/** A point in whatever space the platform reported. */
export interface Point {
  x: number;
  y: number;
}

/** The preview's own size, in the same units a platform's points might use. */
export interface PreviewSize {
  width: number;
  height: number;
}

export interface Observation {
  raw: string;
  /** Monotonic milliseconds. Never a wall clock — that can jump backwards. */
  at: number;
  /** `cornerPoints` as reported. Often empty; frequently unusable. */
  corners?: Point[];
  /** The camera preview's measured size, when the caller knows it. */
  preview?: PreviewSize;
  /**
   * Whether this platform's corner points are in the preview's coordinate
   * space. False on Android, where they are image pixels over display density
   * with the image size never forwarded — see `centreOf`.
   */
  previewSpace?: boolean;
  /**
   * What the caller came here to scan.
   *
   * `'imei'` when the sheet is booking a phone in. A phone label carries a
   * serial and a model number as well as its IMEIs, and all three decode
   * perfectly well — so without this, a serial sitting nearer the reticle wins
   * and the scan produces the wrong kind of answer. It ranks; it never
   * excludes, because the same sheet is also used to read ordinary product
   * barcodes and must keep working for them.
   */
  prefer?: 'imei';
  /**
   * An identifier already confirmed on an earlier pass.
   *
   * While scanning for IMEI 2, IMEI 1 is usually still on the label and still
   * decoding. It must not appear as something to choose — it is already chosen
   * — and it must not make a single remaining candidate look like two.
   * Excluded from collection entirely, which is also what makes "the same
   * number twice" impossible rather than merely discouraged.
   */
  exclude?: string | null;
}

export interface Candidate {
  /** The comparison key: the whole payload, normalised. */
  key: string;
  /** What it classified as, computed once when the candidate was opened. */
  payload: ScanPayload;
  firstAt: number;
  lastAt: number;
  count: number;
  /** Centre in 0–1 of the preview, when it could be trusted. */
  centre: Point | null;
}

/** Everything being watched right now. Held in a ref by the caller. */
export interface Acquisition {
  candidates: Candidate[];
  /** Keys reported as unusable, and when they may be reported again. */
  cooldowns: Record<string, number>;
}

export const EMPTY_ACQUISITION: Acquisition = { candidates: [], cooldowns: {} };

export type AcquisitionVerdict =
  /** Nothing usable in frame. "Place one barcode inside the frame". */
  | { action: 'idle'; state: Acquisition }
  /** A candidate is building. `progress` (0–1) drives the reticle. */
  | { action: 'holding'; state: Acquisition; target: Candidate; progress: number }
  /** Held long enough, and unusable. Say so once, then leave it alone. */
  | { action: 'reject'; state: Acquisition; target: Candidate }
  /**
   * Collection ended with more than one plausible IMEI on the table.
   *
   * The scanner does not guess. On a device, three visible IMEIs made it
   * alternate between them, sometimes wait indefinitely, and sometimes pick one
   * nobody meant — and no timing constant can fix that, because **stability
   * says a barcode is being held still, never that it is the wanted one.**
   * A person is asked instead.
   */
  | { action: 'choose'; state: Acquisition; candidates: Candidate[] }
  /** Exactly one, clearly dominant. Lock, buzz once, look up — in that order. */
  | { action: 'accept'; state: Acquisition; target: Candidate; payload: ScanPayload };

/**
 * The comparison key for a payload.
 *
 * Whitespace and case are decoder noise: the same label read twice can differ
 * by a trailing newline. Everything else is preserved, because a QR carrying
 * `IMEI1: …` and `IMEI2: …` is **one payload describing one phone**, and
 * comparing only the first line would let a different second IMEI pass as "the
 * same code".
 */
export function normalisePayload(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toUpperCase();
}

/**
 * Can this payload be accepted at all?
 *
 * `imei` and `other` go on to the existing validation and business flow
 * untouched. `invalid` and `ambiguous` are still TRACKED — a person holding the
 * camera on a damaged label deserves to be told why nothing is happening — but
 * they can only ever produce a message, never an acceptance. Holding still is
 * evidence of aim, never of correctness.
 */
export function isAcceptable(payload: ScanPayload): boolean {
  return payload.kind === 'imei' || payload.kind === 'other';
}

/**
 * The barcode's centre in 0–1 of the preview, or null when that cannot be known.
 *
 * **Read from the native source, not from the documentation.** Corner points
 * arrive in three different spaces:
 *
 *   - **Android** (`BarcodeScannerResultSerializer.kt`): ML Kit image pixels
 *     divided by display density. The image dimensions are **not** put into the
 *     bundle sent to JS, so there is no denominator available and no way to
 *     normalise. Returns null.
 *   - **iOS / AVFoundation** (`MetaDataDelegate.swift`): passed through
 *     `previewLayer.transformedMetadataObject`, so already in **preview
 *     points** — divide by the measured preview size.
 *   - **iOS / Vision** (`BarcodeScannerUtils.swift`): `VNBarcodeObservation`
 *     bounds, **already normalised 0–1**, untransformed.
 *
 * The two iOS shapes are told apart by their own values rather than by a flag,
 * because nothing in the API says which path is running: coordinates that all
 * fall inside the unit square are already normalised, and nothing else is.
 *
 * Every uncertain case returns null, and null means "rank by stability alone".
 * That is safe precisely because position is advisory.
 */
export function centreOf(obs: Observation): Point | null {
  const corners = obs.corners;
  if (!corners || corners.length < 3) return null;
  if (corners.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;

  const mean = corners.reduce(
    (acc, p) => ({ x: acc.x + p.x / corners.length, y: acc.y + p.y / corners.length }),
    { x: 0, y: 0 },
  );

  /*
   * Averaging all corners is what makes the platform ordering difference
   * harmless: Android, iOS and Web each report the four corners in a different
   * order, and the centroid of a set does not depend on the order of the set.
   */
  const unit = corners.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1);
  if (unit) return mean;

  if (!obs.previewSpace || !obs.preview) return null;
  const { width, height } = obs.preview;
  if (!(width > 0) || !(height > 0)) return null;
  // Points outside the preview are not preview points; do not pretend to know.
  if (corners.some((p) => p.x < 0 || p.y < 0 || p.x > width || p.y > height)) return null;

  return { x: mean.x / width, y: mean.y / height };
}

/** Distance from the reticle centre. Smaller is better aimed. */
function offCentre(c: Point | null): number {
  if (!c) return Number.POSITIVE_INFINITY;
  return Math.hypot(c.x - 0.5, c.y - 0.5);
}

/** How far through its window a candidate is, 0–1, for the reticle. */
export function progressOf(candidate: Candidate, now: number): number {
  const spanned = Math.min(1, (now - candidate.firstAt) / MIN_WINDOW_MS);
  const counted = Math.min(1, candidate.count / MIN_OBSERVATIONS);
  // Both clauses must be met, so the honest indication is the slower of them.
  return Math.max(0, Math.min(spanned, counted));
}

function isReady(candidate: Candidate): boolean {
  return (
    candidate.count >= MIN_OBSERVATIONS &&
    candidate.lastAt - candidate.firstAt >= MIN_WINDOW_MS
  );
}

/**
 * Which candidate is the user aiming at?
 *
 * Deterministic, and stable under repetition — that matters more than being
 * clever. Position first when it can be trusted, then the longest continuously
 * held, then the key, so the answer never flickers between two equal
 * candidates from one frame to the next.
 */
/**
 * Order candidates for the selection panel: best-aimed first.
 *
 * Position when it can be trusted, then longest held, then the value itself so
 * the list never reshuffles between two equals while somebody is reading it.
 * **This is presentation only.** Nothing is selected by being first, and on
 * Android — where no coordinate can be normalised — the order carries no
 * positional information at all and the person simply chooses.
 */
export function rankCandidates(candidates: Candidate[]): Candidate[] {
  return [...candidates].sort((a, b) => {
    const da = offCentre(a.centre);
    const db = offCentre(b.centre);
    if (Number.isFinite(da) || Number.isFinite(db)) {
      if (Math.abs(da - db) > 0.05) return da - db;
    }
    const held = b.lastAt - b.firstAt - (a.lastAt - a.firstAt);
    if (held !== 0) return held;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

export function selectTarget(candidates: Candidate[], prefer?: 'imei'): Candidate | null {
  if (candidates.length === 0) return null;

  /*
   * When the caller is booking a phone in, an IMEI outranks anything else
   * before position is even consulted. A phone label's serial and model number
   * decode just as readily and one of them is often nearer the reticle, so
   * without this the scan quietly returns the wrong kind of answer.
   */
  const wanted = prefer === 'imei' ? candidates.filter((c) => c.payload.kind === 'imei') : [];
  const pool = wanted.length > 0 ? wanted : candidates;

  return [...pool].sort((a, b) => {
    const da = offCentre(a.centre);
    const db = offCentre(b.centre);
    // A tolerance, not an exact comparison: two codes within a few percent of
    // each other are, for a human aiming a phone, the same distance away.
    if (Number.isFinite(da) || Number.isFinite(db)) {
      if (Math.abs(da - db) > 0.05) return da - db;
    }
    const held = b.lastAt - b.firstAt - (a.lastAt - a.firstAt);
    if (held !== 0) return held;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  })[0];
}

/**
 * Is this candidate clearly the one being aimed at, rather than merely first
 * in a sort order?
 *
 * Clear means one of: its position is trustworthy and meaningfully nearer the
 * reticle than the next candidate's, or it has been held meaningfully longer.
 * Otherwise the two are indistinguishable and acquisition should continue —
 * until `AMBIGUITY_GRACE_MS` runs out, at which point any stable answer is
 * better than none.
 */
export function isDominant(
  target: Candidate,
  live: Candidate[],
  now: number,
  prefer?: 'imei',
): boolean {
  /*
   * Judged against every LIVE candidate, not only the ones already eligible.
   *
   * Callbacks arrive one barcode at a time, so on a label the codes cross the
   * one-second line microseconds apart in whatever order the decoder happens to
   * emit them — and whichever crossed first would otherwise win uncontested,
   * with no rival yet "ready" to compare against. That is exactly "accept
   * whichever callback arrived first", rebuilt one level up.
   */
  let rivals = live.filter((c) => c.key !== target.key && isAcceptable(c.payload));
  if (rivals.length === 0) return true;

  if (prefer === 'imei') {
    const targetWanted = target.payload.kind === 'imei';
    // A stray serial must never beat the IMEI the caller came for…
    if (!targetWanted && rivals.some((r) => r.payload.kind === 'imei')) return false;
    // …and once the target IS the wanted kind, codes of other kinds are not
    // rivals for it at all, whatever their position.
    if (targetWanted) rivals = rivals.filter((r) => r.payload.kind === 'imei');
    if (rivals.length === 0) return true;
  }

  // Waited long enough past the window: take the deterministic answer rather
  // than hang. Arbitrary between true equals, but stable.
  if (now - target.firstAt >= MIN_WINDOW_MS + AMBIGUITY_GRACE_MS) return true;

  const held = (c: Candidate) => c.lastAt - c.firstAt;
  return rivals.every((r) => {
    const dt = offCentre(target.centre);
    const dr = offCentre(r.centre);
    if (Number.isFinite(dt) && Number.isFinite(dr) && Math.abs(dt - dr) > 0.05) return dt < dr;
    return held(target) - held(r) >= DOMINANCE_MARGIN_MS;
  });
}

/**
 * Feed one decoder callback in; get back what the UI should do.
 *
 * Synchronous and total. The caller holds the state in a ref, because the
 * camera fires many times before React commits a render — the same reason the
 * accept lock is a ref.
 */
export function observe(state: Acquisition, obs: Observation): AcquisitionVerdict {
  const key = normalisePayload(obs.raw);
  if (!key) return { action: 'idle', state: prune(state, obs.at) };

  const payload = classifyScan(obs.raw);

  /*
   * The IMEI already confirmed on pass 1 is not a candidate for pass 2.
   *
   * It is still printed on the label and still decoding, so without this it
   * would compete with the one being looked for — and would make a single real
   * candidate look like an ambiguous pair. Dropped here rather than filtered
   * later, so it can never be selected, counted, or offered.
   */
  if (obs.exclude && payload.kind === 'imei' && payload.primary === obs.exclude) {
    return { action: 'idle', state: prune(state, obs.at) };
  }

  const centre = centreOf(obs);
  const pruned = prune(state, obs.at);
  const existing = pruned.candidates.find((c) => c.key === key);

  const candidate: Candidate = existing
    ? { ...existing, lastAt: obs.at, count: existing.count + 1, centre: centre ?? existing.centre }
    : { key, payload, firstAt: obs.at, lastAt: obs.at, count: 1, centre };

  const candidates = [...pruned.candidates.filter((c) => c.key !== key), candidate];
  const next: Acquisition = { ...pruned, candidates };

  /*
   * Only candidates that have EARNED their window compete. Selection never
   * shortens the window for anybody: being best-centred makes a candidate
   * preferred, never faster.
   */
  const ready = candidates.filter(isReady);

  /*
   * Usable candidates are considered FIRST, and separately.
   *
   * Ranking everything together and checking usability afterwards meant a
   * serial number could out-rank the IMEI beside it — by sitting closer to the
   * reticle, or simply by being decoded more often — and the scan would then
   * fail with "that is not an IMEI" while the IMEI was in frame the whole time.
   * A code that cannot be accepted must never block one that can.
   */
  const usable = ready.filter((c) => isAcceptable(c.payload));
  const pool = usable.length > 0 ? usable : ready;
  const target = selectTarget(pool, obs.prefer);

  if (!target) {
    const holding = selectTarget(candidates, obs.prefer);
    return holding
      ? { action: 'holding', state: next, target: holding, progress: progressOf(holding, obs.at) }
      : { action: 'idle', state: next };
  }

  /*
   * Collection has ended. What is on the table?
   *
   * `plausible` is every live candidate that is a VALID IMEI and has been seen
   * repeatedly — a genuine sighting, not one stray decode. That set is the
   * question the person is being asked, and the count decides everything:
   *
   *   one   → it was unambiguous; continue automatically as before;
   *   two+  → ask, and never guess.
   *
   * Judged against LIVE candidates rather than only eligible ones, because
   * callbacks arrive one barcode at a time: two IMEIs on one label cross the
   * window microseconds apart, and looking only at whoever crossed first would
   * hide the ambiguity behind decoder emission order.
   *
   * This is what replaced the old "keep acquiring until one dominates" rule.
   * On a device that rule was the hang: two IMEIs held side by side never
   * separated, so the scanner waited, and when the grace ran out it picked one
   * arbitrarily. Waiting longer was never going to identify intent.
   */
  const plausible = candidates.filter(
    (c) => c.payload.kind === 'imei' && c.count >= MIN_OBSERVATIONS,
  );

  if (plausible.length > 1) {
    return {
      action: 'choose',
      state: next,
      // Best-aimed first when position is trustworthy, so the panel opens with
      // the likely one at the top. It is an ordering, never a decision.
      candidates: rankCandidates(plausible),
    };
  }

  /*
   * Not an IMEI question. Ordinary barcodes keep the older rule: two that
   * cannot be told apart go on acquiring rather than being picked at random,
   * bounded by `AMBIGUITY_GRACE_MS` so it cannot hang.
   *
   * They are not escalated to a selection panel because the panel says
   * "Multiple IMEIs detected", and a shelf edge showing two product barcodes is
   * a different situation with a different answer — move the camera.
   */
  if (candidates.length > 1 && !isDominant(target, candidates, obs.at, obs.prefer)) {
    return { action: 'holding', state: next, target, progress: 1 };
  }

  if (!isAcceptable(target.payload)) {
    // Reported once, then left alone, so a damaged label does not fire every
    // frame. The candidate is dropped so it can be re-earned after the cooldown.
    if ((next.cooldowns[target.key] ?? 0) > obs.at) {
      const other = selectTarget(candidates.filter((c) => c.key !== target.key), obs.prefer);
      return other
        ? { action: 'holding', state: next, target: other, progress: progressOf(other, obs.at) }
        : { action: 'idle', state: next };
    }
    return {
      action: 'reject',
      state: {
        candidates: candidates.filter((c) => c.key !== target.key),
        cooldowns: { ...next.cooldowns, [target.key]: obs.at + INVALID_COOLDOWN_MS },
      },
      target,
    };
  }

  return { action: 'accept', state: next, target, payload: target.payload };
}

/**
 * Drop candidates that have gone quiet, and expired cooldowns.
 *
 * Callbacks only arrive while something is decodable, so a barcode lifted away
 * produces silence rather than an event. This is what turns that silence into
 * "it left the frame" — called on every observation and by the caller's own
 * tick, so the reticle stops claiming to hold something it cannot see.
 */
export function prune(state: Acquisition, now: number): Acquisition {
  let candidates = state.candidates.filter((c) => now - c.lastAt <= MAX_GAP_MS);

  /*
   * A hard ceiling as well as the age rule. A camera carried past a shelf can
   * see dozens of codes inside one gap window, and this is a ref that lives for
   * the whole session — the most recently seen are the ones being aimed at.
   */
  if (candidates.length > MAX_CANDIDATES) {
    candidates = [...candidates].sort((a, b) => b.lastAt - a.lastAt).slice(0, MAX_CANDIDATES);
  }

  const cooldowns: Record<string, number> = {};
  for (const [k, until] of Object.entries(state.cooldowns)) {
    if (until > now) cooldowns[k] = until;
  }

  return candidates.length === state.candidates.length &&
    Object.keys(cooldowns).length === Object.keys(state.cooldowns).length
    ? state
    : { candidates, cooldowns };
}
