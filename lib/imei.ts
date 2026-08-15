/**
 * Reading an IMEI off a phone's `*#06#` screen.
 *
 * The camera scanner reads barcodes. It cannot read the digits a phone prints
 * on its own display, which is where the IMEI actually is on a device with no
 * box and no label — the common case for a used phone at a counter.
 *
 * Everything here is pure, so the rules that decide whether a phone enters
 * inventory can be tested without a camera, a device or a build.
 *
 * **The one rule that outranks the rest: never silently accept a guessed
 * digit.** OCR misreads are systematic, not random — 0/O, 1/I/l, 5/S, 8/B — and
 * a plausible-looking wrong IMEI is far worse than a failed read. A failed read
 * costs seconds; a wrong IMEI is a phone that cannot be found, sold, returned
 * or matched to its warranty for the rest of its life.
 */

/** How a candidate was arrived at, so the UI can say. */
export type ImeiSource = 'exact' | 'ambiguity_resolved';

export interface ImeiCandidate {
  imei: string;
  /** Which label it sat under, when the screen said. */
  label: 'imei' | 'imei1' | 'imei2' | null;
  source: ImeiSource;
  /**
   * Characters that were reinterpreted to reach this, e.g. `O→0`. Empty for an
   * exact read. The confirmation card shows these: a human is agreeing to the
   * substitution, not being told one happened.
   */
  substitutions: string[];
}

/**
 * Luhn, the check digit built into every IMEI.
 *
 * This is what makes OCR safe enough to use at all. A single misread digit
 * fails Luhn roughly nine times in ten, so the vast majority of bad reads are
 * caught before anyone sees them — and the ones that pass are the ones a human
 * still confirms against the screen.
 */
export function isValidLuhn(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** An IMEI is 15 digits and must satisfy Luhn. Both, always. */
export function isValidImei(value: string): boolean {
  return /^\d{15}$/.test(value) && isValidLuhn(value);
}

/** The first eight digits: the Type Allocation Code, which identifies a model. */
export function tacOf(imei: string): string | null {
  return /^\d{15}$/.test(imei) ? imei.slice(0, 8) : null;
}

/**
 * Characters OCR confuses for digits, and what they are read as.
 *
 * Deliberately one-directional and small. Every entry here is a shape
 * confusion a text recogniser genuinely makes on a phone screen; adding
 * anything speculative would widen the space of wrong-but-plausible IMEIs,
 * which is the opposite of the point.
 */
const AMBIGUOUS: Record<string, string> = {
  O: '0', o: '0', Q: '0', D: '0',
  I: '1', l: '1', i: '1', '|': '1', '!': '1',
  Z: '2', z: '2',
  S: '5', s: '5',
  G: '6',
  T: '7',
  B: '8',
  g: '9', q: '9',
};

/**
 * Strip what a phone screen puts between digit groups.
 *
 * Screens print IMEIs grouped — `35 693803 564380 9` — and some locales use
 * different separators. Spaces, dashes, dots, non-breaking spaces and Arabic
 * comma are all separators, never data.
 */
function stripSeparators(s: string): string {
  return s.replace(/[\s  .\-–—_,،/\\]/g, '');
}

/** Arabic-Indic digits, which a device set to Arabic may well print. */
function normaliseDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) => {
    const c = d.charCodeAt(0);
    const base = c >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(c - base);
  });
}

/**
 * Try to read one 15-character run as an IMEI.
 *
 * Returns `null` unless the result is a valid IMEI — including Luhn. A run that
 * only becomes valid by substituting characters is returned as
 * `ambiguity_resolved`, with every substitution listed so a human confirms the
 * reading rather than being handed it.
 */
function readRun(run: string): ImeiCandidate | null {
  if (run.length !== 15) return null;

  if (/^\d{15}$/.test(run)) {
    return isValidLuhn(run)
      ? { imei: run, label: null, source: 'exact', substitutions: [] }
      : null;
  }

  const substitutions: string[] = [];
  let out = '';
  for (const ch of run) {
    if (ch >= '0' && ch <= '9') {
      out += ch;
      continue;
    }
    const mapped = AMBIGUOUS[ch];
    // An unmapped non-digit is not an ambiguity, it is a different string.
    if (!mapped) return null;
    out += mapped;
    substitutions.push(`${ch}→${mapped}`);
  }

  /**
   * The substitution still has to produce a valid IMEI. This is the whole
   * safety argument: a guess that fails Luhn is discarded rather than offered,
   * so the only guesses a human ever sees are the ones that could be right.
   */
  return isValidLuhn(out)
    ? { imei: out, label: null, source: 'ambiguity_resolved', substitutions }
    : null;
}

/**
 * `IMEI1`, `IMEI 2`, `IMEI:` — the labels a phone screen actually prints.
 *
 * Read from the whole LINE, not from a window before the digits. The obvious
 * implementation — scan backwards from the first digit-like character — finds
 * the `I` in "IMEI" itself, because `I` is one of the characters OCR confuses
 * for a digit. A screen prints one identifier per line, so the line is the
 * right unit anyway.
 */
function labelOfLine(line: string): ImeiCandidate['label'] {
  const upper = line.toUpperCase();
  if (/IMEI\s*[-_:]?\s*2\b/.test(upper)) return 'imei2';
  if (/IMEI\s*[-_:]?\s*1\b/.test(upper)) return 'imei1';
  if (/IMEI/.test(upper)) return 'imei';
  return null;
}

/**
 * Extract every IMEI a recognised block of text contains.
 *
 * A `*#06#` screen on a dual-SIM phone shows two, sometimes with a serial and a
 * MEID beside them. This finds the valid ones and ignores everything else,
 * rather than trying to parse the screen's layout — layouts differ by
 * manufacturer, Luhn does not.
 *
 * Deduplicated: the same IMEI seen twice on one screen, or across frames, is
 * one phone.
 */
export function extractImeis(rawText: string): ImeiCandidate[] {
  if (!rawText) return [];
  const text = normaliseDigits(rawText);

  const found = new Map<string, ImeiCandidate>();

  // Line by line, so a label on one line binds to the number beside it and not
  // to a number three lines away.
  for (const line of text.split(/[\r\n]+/)) {
    const compact = stripSeparators(line);
    for (let i = 0; i + 15 <= compact.length; i++) {
      const candidate = readRun(compact.slice(i, i + 15));
      if (!candidate) continue;
      if (found.has(candidate.imei)) continue;

      candidate.label = labelOfLine(line);
      found.set(candidate.imei, candidate);
      // Skip past what was just consumed: overlapping windows of one long digit
      // run would otherwise offer several readings of the same number.
      i += 14;
    }
  }

  return [...found.values()];
}

/**
 * What a dual-SIM read means: **one phone, two identifiers.**
 *
 * This is the rule most easily got wrong, and getting it wrong creates a
 * phantom device — a second phone in inventory that does not exist, with an
 * IMEI that will never be found because it is written on the back of the first
 * one.
 */
export interface DualSimReading {
  primary: string;
  secondary: string | null;
  /** More than two valid IMEIs on one screen: a human decides. */
  ambiguous: boolean;
  candidates: ImeiCandidate[];
}

export function readDualSim(candidates: ImeiCandidate[]): DualSimReading | null {
  if (candidates.length === 0) return null;

  const labelled = (l: ImeiCandidate['label']) => candidates.find((c) => c.label === l);
  const first = labelled('imei1') ?? labelled('imei') ?? candidates[0];
  const second = labelled('imei2') ?? candidates.find((c) => c.imei !== first.imei) ?? null;

  return {
    primary: first.imei,
    secondary: second?.imei ?? null,
    // Three or more is not a dual-SIM phone; it is a screen this code does not
    // understand, and guessing which two matter would be inventing data.
    ambiguous: candidates.length > 2,
    candidates,
  };
}

/**
 * Merge readings across camera frames.
 *
 * OCR fires many times a second and the same screen yields the same digits
 * repeatedly. Accumulating rather than replacing means a brief blur does not
 * lose an IMEI that was already read cleanly, and the confirmation card does
 * not flicker between readings.
 *
 * An EXACT reading always wins over an ambiguity-resolved one for the same
 * number, because a later clean frame is better evidence than an earlier guess.
 */
export function mergeFrames(
  seen: ImeiCandidate[],
  incoming: ImeiCandidate[],
): ImeiCandidate[] {
  const byImei = new Map(seen.map((c) => [c.imei, c]));
  for (const c of incoming) {
    const existing = byImei.get(c.imei);
    if (!existing) {
      byImei.set(c.imei, c);
      continue;
    }
    if (existing.source === 'ambiguity_resolved' && c.source === 'exact') {
      byImei.set(c.imei, c);
    } else if (existing.label === null && c.label !== null) {
      // A later frame that caught the label is more informative.
      byImei.set(c.imei, { ...existing, label: c.label });
    }
  }
  return [...byImei.values()];
}
