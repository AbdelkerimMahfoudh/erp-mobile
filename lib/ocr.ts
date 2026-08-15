import { Platform } from 'react-native';
import { extractImeis, mergeFrames, readDualSim, type DualSimReading, type ImeiCandidate } from './imei';

/**
 * Reading text off a photograph, on the device.
 *
 * Everything here exists to keep one promise: **manual entry always works.**
 * OCR is an accelerator, never a dependency. It is unavailable in Expo Go, on
 * web, on a build without the native module, and whenever the camera is denied
 * — and in every one of those cases the app must degrade to typing rather than
 * to a dead screen.
 *
 * That is why the module is loaded lazily, inside a `try`, and why nothing else
 * in the app imports it directly. A top-level import would take the web export
 * down with it, and the web export is one of this project's verification gates.
 *
 * ## Privacy
 *
 * Google ML Kit text recognition runs **entirely on the device**. No image, no
 * recognised text and no IMEI is sent anywhere — there is no network call in
 * this file, and the temporary photograph is deleted as soon as it has been
 * read. See `docs/30` §5.
 */

/** The native module's shape, declared rather than imported at module scope. */
interface RecognisedText {
  text: string;
  blocks: { text: string; lines: { text: string }[] }[];
}
type RecogniseFn = (imagePath: string) => Promise<RecognisedText>;

let cached: RecogniseFn | null | undefined;

/**
 * Resolve the native recogniser, once.
 *
 * `undefined` means not yet tried; `null` means tried and unavailable. The
 * distinction matters because a failed load must not be retried on every frame
 * — the camera fires many times a second.
 */
function loadRecogniser(): RecogniseFn | null {
  if (cached !== undefined) return cached;

  // No native modules on web, and the export must not try.
  if (Platform.OS === 'web') {
    cached = null;
    return cached;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@infinitered/react-native-mlkit-text-recognition') as {
      recognizeText?: RecogniseFn;
    };
    cached = typeof mod.recognizeText === 'function' ? mod.recognizeText : null;
  } catch {
    /**
     * Expo Go, or a build without the module compiled in. Not an error worth
     * surfacing: the screen offers manual entry, which is a complete answer.
     */
    cached = null;
  }
  return cached;
}

/** Whether reading an IMEI off a phone screen is possible in this build. */
export function isOcrAvailable(): boolean {
  return loadRecogniser() !== null;
}

export interface OcrReadResult {
  /** Every valid IMEI found, deduplicated and merged across frames so far. */
  candidates: ImeiCandidate[];
  /** One phone, one or two identifiers — or null when nothing was read. */
  reading: DualSimReading | null;
  /** True when OCR itself could not run. The caller offers typing instead. */
  unavailable: boolean;
}

/**
 * Read a captured photograph and pull out whatever IMEIs it contains.
 *
 * `previous` carries readings from earlier frames: OCR fires repeatedly at the
 * same screen, and accumulating means a momentary blur does not lose an IMEI
 * that was already read cleanly.
 *
 * **The image is not retained.** It is passed to the recogniser, read, and the
 * caller deletes it — this function keeps no reference to it and no copy of it.
 */
export async function readImeisFromImage(
  imageUri: string,
  previous: ImeiCandidate[] = [],
): Promise<OcrReadResult> {
  const recognise = loadRecogniser();
  if (!recognise) {
    return { candidates: previous, reading: readDualSim(previous), unavailable: true };
  }

  let text = '';
  try {
    const result = await recognise(imageUri);
    /**
     * Prefer the line structure over the flat `text` blob. Lines are what bind
     * an `IMEI2` label to the number printed beside it; the blob can run two
     * identifiers together and lose which is which.
     */
    const lines = result.blocks?.flatMap((b) => b.lines?.map((l) => l.text) ?? []) ?? [];
    text = lines.length > 0 ? lines.join('\n') : (result.text ?? '');
  } catch {
    // A failed recognition is an unreadable frame, not a broken app. The next
    // frame usually succeeds, and typing is always available.
    return { candidates: previous, reading: readDualSim(previous), unavailable: false };
  }

  const candidates = mergeFrames(previous, extractImeis(text));
  return { candidates, reading: readDualSim(candidates), unavailable: false };
}

/** Reset the cached module resolution. Test seam only. */
export function __resetOcrCache(): void {
  cached = undefined;
}
