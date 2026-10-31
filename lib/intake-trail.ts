import { getItem, setItem } from './storage';

/**
 * The single-item intake's last steps on this phone, kept across a restart (2026-10-31).
 *
 * A freeze leaves no crash report, and the owner's mouse intake (no buying cost at first, a freeze on saving, the
 * draft still there after a restart) could not be replayed from what the app kept. This keeps the last steps — which
 * step, and when — so the next report can say where it stopped and what was the last safe point.
 *
 * Only a step name from the fixed list below and a time. Never a product, a brand, an IMEI, a serial, a barcode, an
 * amount, a phone number, a name or anything typed: a step is checked against the list before it is kept.
 */
export const INTAKE_STEPS = [
  /** The single-item intake opened from a scan. */
  'opened',
  /** A category was chosen: the stock details and the buying cost now show. */
  'category',
  /** "Create product and add to stock" was pressed and the request sent. */
  'submitted',
  /** The server confirmed the purchase: the last safe point. */
  'committed',
  /** The server refused it: nothing was written. */
  'refused',
  /** No answer: it may or may not exist, and the same request id is kept for the retry. */
  'uncertain',
  /** The screen was left on purpose (after a save, or with a confirmed discard). */
  'left',
] as const;

export type IntakeStep = (typeof INTAKE_STEPS)[number];

export interface TrailEntry {
  step: IntakeStep;
  /** ISO time, to the second. */
  at: string;
}

const KEY = 'erp.intake.trail';
const KEEP = 12;
let trail: TrailEntry[] = [];

function isStep(value: unknown): value is IntakeStep {
  return typeof value === 'string' && (INTAKE_STEPS as readonly string[]).includes(value);
}

/** Only well-formed entries of known steps, the newest last, at most {@link KEEP}. */
export function sanitizeTrail(raw: unknown): TrailEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is TrailEntry => typeof e === 'object' && e !== null && isStep((e as TrailEntry).step) && typeof (e as TrailEntry).at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test((e as TrailEntry).at))
    .map((e) => ({ step: e.step, at: e.at }))
    .slice(-KEEP);
}

/** Note one step. Never throws: a diagnostic must not break the intake it describes. */
export function recordIntakeStep(step: IntakeStep, now: Date = new Date()): void {
  if (!isStep(step)) return;
  trail = sanitizeTrail([...trail, { step, at: now.toISOString().slice(0, 19) + 'Z' }]);
  void setItem(KEY, JSON.stringify(trail)).catch(() => undefined);
}

/** The kept steps, from this run or the last one. */
export async function readIntakeTrail(): Promise<TrailEntry[]> {
  if (trail.length > 0) return trail;
  try {
    const stored = await getItem(KEY);
    trail = sanitizeTrail(stored ? JSON.parse(stored) : []);
  } catch {
    trail = [];
  }
  return trail;
}

/** The last point at which everything asked for was safely on the server, if any. */
export function lastSafeStep(entries: readonly TrailEntry[]): TrailEntry | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) if (entries[i].step === 'committed') return entries[i];
  return null;
}

/** For tests: forget this run's steps. */
export function resetIntakeTrailForTests(): void {
  trail = [];
}
