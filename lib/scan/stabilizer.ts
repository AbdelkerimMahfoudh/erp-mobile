import { classifyScan, type ScanPayload } from './payload.ts';

/**
 * Deciding when a barcode has actually been AIMED AT, rather than merely seen.
 *
 * ## What the device did
 *
 * Three physical attempts, three failures, all the same: the scanner recognised
 * something in well under a second — before the person holding the phone had
 * finished bringing it to the label — accepted it, and unmounted the camera.
 * On a sheet of adjacent barcodes it frequently accepted a neighbour, or a code
 * only half in shot.
 *
 * The decoder was not wrong. A barcode partly in frame is still a barcode, and
 * `expo-camera` reports it the instant it resolves. The mistake was ours: we
 * treated **the first thing seen** as **the thing meant**, and those are only
 * the same when the camera is already still.
 *
 * ## The rule
 *
 * A payload is accepted when it has been decoded at least `MIN_OBSERVATIONS`
 * times, those observations span at least `MIN_WINDOW_MS`, and no gap between
 * consecutive sightings exceeds `MAX_GAP_MS`. That last clause is what makes
 * this "held steady on one code" rather than "seen occasionally over a second":
 * a barcode that drifts out of frame and comes back has not been aimed at, it
 * has been passed over twice.
 *
 * ## Why not a timer
 *
 * A `setTimeout` that accepts whatever is current after a second accepts the
 * LAST thing seen instead of the first — the same bug wearing a different hat,
 * and worse, because it fires when the camera may be pointing anywhere. The
 * decision is made from the observations themselves, on a monotonic clock, at
 * the moment an observation arrives. Nothing is scheduled and nothing fires on
 * its own.
 *
 * A previous test in this repository forbade every delay mechanism outright,
 * written when the fault was a frozen frame and speed was not the problem. That
 * assertion is now wrong and has been replaced: the rule is that no delay may
 * be *blind*, not that acceptance may never take time.
 *
 * ## Pure on purpose
 *
 * No React, no camera, no `Date.now()` of its own — the clock is passed in. That
 * is what lets the one-second window be tested exactly, at the millisecond,
 * without a device and without waiting a real second per case.
 */

/** Identical decodes required before anything is accepted. */
export const MIN_OBSERVATIONS = 3;
/** The window those decodes must span. A "fast" scan still takes this long. */
export const MIN_WINDOW_MS = 1_000;
/**
 * The longest silence allowed between two sightings of the same code.
 *
 * `expo-camera` reports a held barcode many times a second, so a gap this size
 * means it genuinely left the frame. Short enough that a pass across a sheet
 * cannot accumulate a window; long enough to survive a blur or a refocus.
 */
export const MAX_GAP_MS = 400;

/** Where a decoded barcode was, in the preview's coordinate space. */
export interface ScanBounds {
  /** Centre of the barcode, 0–1 of the preview's width and height. */
  x: number;
  y: number;
}

export interface Observation {
  raw: string;
  /** Monotonic milliseconds. Never a wall clock — that can jump backwards. */
  at: number;
  /** Omitted when the platform gave nothing trustworthy. */
  bounds?: ScanBounds;
}

export interface Candidate {
  /** The comparison key: the whole payload, normalised. */
  key: string;
  /** What it classified as, computed once when the candidate was opened. */
  payload: ScanPayload;
  firstAt: number;
  lastAt: number;
  count: number;
}

export type StabilizerVerdict =
  /** Nothing usable. The camera stays live and nothing is shown. */
  | { action: 'ignore'; candidate: Candidate | null }
  /** A candidate is building. This is what puts "Hold steady…" on screen. */
  | { action: 'holding'; candidate: Candidate }
  /** The rule is satisfied. Lock, buzz once, look up — in that order. */
  | { action: 'accept'; candidate: Candidate; payload: ScanPayload };

/**
 * The comparison key for a payload.
 *
 * Whitespace and case are decoder noise: the same label read twice can differ
 * by a trailing newline. Everything else is preserved, because a QR carrying
 * `IMEI1: …` and `IMEI2: …` is **one payload describing one phone**, and
 * comparing only the first line would let a different second IMEI slip through
 * as "the same code".
 */
export function normalisePayload(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toUpperCase();
}

/**
 * Whether a payload is even eligible to become a candidate.
 *
 * An invalid IMEI never starts a window. Holding the camera on a mistyped
 * fifteen-digit code for a second must not turn it into a good one — the
 * feedback for that is immediate and separate, and stability is not evidence.
 *
 * `ambiguous` is excluded for the same reason: more than two plausible IMEIs is
 * a question for a person, and no amount of holding still answers it.
 */
export function isEligible(payload: ScanPayload): boolean {
  return payload.kind === 'imei' || payload.kind === 'other';
}

/**
 * Is the barcode's centre inside the aiming guide?
 *
 * Only consulted when the platform actually gave bounds. When it did not, this
 * is not called at all and the repeated-payload rule carries the whole weight —
 * the frame is then honest guidance and nothing more, which is why the copy
 * never claims that only what is inside it will be read.
 */
export function withinGuide(bounds: ScanBounds, halfWidth = 0.35, halfHeight = 0.25): boolean {
  return (
    Math.abs(bounds.x - 0.5) <= halfWidth && Math.abs(bounds.y - 0.5) <= halfHeight
  );
}

/**
 * Feed one decoder callback in; get back what the UI should do.
 *
 * Synchronous and total: given the same candidate and observation it always
 * returns the same verdict. The caller holds the candidate in a ref — the
 * camera fires many times before React commits a render, so React state cannot
 * be the memory here, exactly as with the accept lock.
 */
export function observe(current: Candidate | null, obs: Observation): StabilizerVerdict {
  const payload = classifyScan(obs.raw);

  if (!isEligible(payload)) {
    /*
     * Deliberately NOT a reset. Sweeping past a damaged label while aiming at a
     * good one should not cost the window somebody has already held — the
     * unusable read is simply not evidence either way.
     */
    return { action: 'ignore', candidate: current };
  }

  // Off-centre reads are discarded before they can build or extend a window.
  if (obs.bounds && !withinGuide(obs.bounds)) {
    return { action: 'ignore', candidate: current };
  }

  const key = normalisePayload(obs.raw);

  // A different code, or one that left the frame: start again from this sighting.
  const continues =
    current !== null && current.key === key && obs.at - current.lastAt <= MAX_GAP_MS;

  if (!continues) {
    const started: Candidate = { key, payload, firstAt: obs.at, lastAt: obs.at, count: 1 };
    return { action: 'holding', candidate: started };
  }

  const next: Candidate = {
    ...current,
    lastAt: obs.at,
    count: current.count + 1,
  };

  const spanned = next.lastAt - next.firstAt;
  if (next.count >= MIN_OBSERVATIONS && spanned >= MIN_WINDOW_MS) {
    return { action: 'accept', candidate: next, payload: next.payload };
  }

  return { action: 'holding', candidate: next };
}

/**
 * Has the candidate gone quiet long enough to have left the frame?
 *
 * Callbacks only arrive while something is decodable, so a barcode lifted away
 * produces silence rather than an event. The sheet polls this so "Hold steady…"
 * disappears when the camera is moved off, instead of sitting there implying a
 * window is still building.
 */
export function hasLapsed(candidate: Candidate | null, now: number): boolean {
  return candidate !== null && now - candidate.lastAt > MAX_GAP_MS;
}
