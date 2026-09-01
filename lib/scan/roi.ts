/**
 * The scan region: only a barcode **completely** inside the frame counts.
 *
 * ## What this is for
 *
 * A phone label carries several barcodes millimetres apart. A frame that merely
 * *suggests* where to aim does not stop the decoder reading a neighbour, so the
 * frame becomes a hard gate: every corner of the barcode must be inside it, and
 * a callback that fails is dropped **before** classification, stabilization,
 * haptics, recognition or any error is shown. It never happened.
 *
 * The centre alone is not enough. A barcode straddling an edge has its centre
 * inside while half of it is out of frame, and that is exactly the read that
 * produces a wrong digit.
 *
 * ## Whether this can be enforced at all — audited per platform
 *
 * Read from the native source shipped in `node_modules/expo-camera@17.0.10`,
 * not from the documentation.
 *
 * ### iOS — yes
 *
 * `MetaDataDelegate.swift` passes every metadata object through
 * `previewLayer.transformedMetadataObject(for:)` before reporting it. That is
 * AVFoundation's own conversion into **preview-layer points**, and it has
 * already accounted for aspect-fill cropping, rotation and mirroring. The
 * result shares a coordinate system with the values `onLayout` gives for the
 * camera container, so containment is a straight comparison.
 *
 * It also loops over **all** `metadataObjects`, so every barcode in frame is
 * reported and each can be judged on its own geometry.
 *
 * ### Android — no, and not by any amount of arithmetic here
 *
 * `BarcodeAnalyzer.kt` hands ML Kit's `barcode.cornerPoints` on, which are
 * pixels in the **rotated InputImage**. `BarcodeScannerResultSerializer.kt`
 * then divides them by display density and builds the bundle sent to JS:
 *
 *     data · raw · type · extra · cornerPoints · bounds
 *
 * The image dimensions are captured in Kotlin — `BarCodeScannerResult` carries
 * `width` and `height` — and are **never put into that bundle**. Without them
 * there is no denominator, so image pixels cannot be mapped to preview points:
 * the preview is an aspect-fill crop of an image whose size is unknown, at a
 * rotation JS is not told either.
 *
 * Inferring the extent by watching values arrive would be a guess whose failure
 * mode is a scanner that silently rejects every scan, on hardware that cannot
 * be tested from here. It is not attempted. See `ROI_ENFORCEABLE`.
 *
 * (Android also reports `barcodes.first()` only — one barcode per frame, chosen
 * by ML Kit — so it cannot see the neighbours it would need to reject anyway.)
 *
 * ## `bounds` is not a substitute
 *
 * Expo documents `bounds` as sometimes an empty rectangle, as not necessarily
 * bounding the whole barcode, and for some types as "the area used by the
 * scanner" rather than the code. A containment test is exactly the use it is
 * documented as unsuitable for, so only `cornerPoints` are consulted.
 */
/** A point in the preview's coordinate space. */
export interface Point {
  x: number;
  y: number;
}

/** The active rectangle, in the same space as the camera container's layout. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Coordinate jitter allowed at the boundary, in points.
 *
 * A held barcode's reported corners wobble by a pixel or two between frames as
 * the decoder re-fits the quiet zone. Without a little slack a barcode resting
 * exactly on the edge would flicker between accepted and rejected, which reads
 * as the scanner being broken rather than as the barcode being borderline.
 *
 * Deliberately small: this is for measurement noise, not for letting a barcode
 * hang out of the frame. Exported so it can be tuned from a device rather than
 * hunted for.
 */
export const ROI_TOLERANCE_PT = 2;

/**
 * Can full containment actually be enforced on this platform?
 *
 * iOS reports corners already converted into preview points. Android reports
 * image pixels over display density with the image size withheld — see the
 * audit above. This constant is the single place that difference is decided,
 * and every honest behaviour downstream reads it rather than re-deriving it.
 */
export function roiEnforceable(platformOS: string): boolean {
  return platformOS === 'ios';
}

export type RoiVerdict =
  /** Every corner is inside. The callback may proceed. */
  | 'inside'
  /** Some corner is outside, or the whole barcode is. Drop it silently. */
  | 'outside'
  /**
   * The platform reported nothing usable to test against.
   *
   * NOT the same as `inside`, and never treated as it. Collapsing the two is
   * how a hard region turns into a decorative one while still being described
   * as hard.
   */
  | 'no-geometry';

/**
 * Are all four corners of the barcode inside the active rectangle?
 *
 * Order-independent by construction: every point is tested against the same
 * rectangle, so it does not matter that Android, iOS and Web each report
 * corners in a different order. Nothing here depends on which corner is which.
 */
export function containment(corners: readonly Point[] | undefined, roi: Rect): RoiVerdict {
  if (!roi.width || !roi.height) return 'no-geometry';
  if (!corners || corners.length < 3) return 'no-geometry';
  if (corners.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return 'no-geometry';

  const left = roi.x - ROI_TOLERANCE_PT;
  const top = roi.y - ROI_TOLERANCE_PT;
  const right = roi.x + roi.width + ROI_TOLERANCE_PT;
  const bottom = roi.y + roi.height + ROI_TOLERANCE_PT;

  // EVERY corner, not the centre and not a majority. One corner outside means
  // part of the barcode was out of frame when it was read.
  const allInside = corners.every((p) => p.x >= left && p.x <= right && p.y >= top && p.y <= bottom);
  return allInside ? 'inside' : 'outside';
}

/**
 * The active rectangle, derived from the measured camera container.
 *
 * Wide and shallow on purpose: it is sized for **one horizontal barcode**. A
 * taller region comfortably fits two stacked codes, which is the situation the
 * frame exists to prevent — and a frame that admits the problem it was drawn to
 * solve is worse than none, because it looks like a guarantee.
 *
 * Both numbers are fractions of the measured preview, so the frame is the same
 * shape on a small phone and a tablet.
 */
export const ROI_WIDTH_FRACTION = 0.84;
/**
 * Height as a fraction of WIDTH, not of the preview.
 *
 * Tying it to the preview's height would make the frame taller on a long phone
 * — the opposite of what is wanted, since the constraint is "one barcode", not
 * "a proportion of the screen".
 */
export const ROI_ASPECT = 0.34;

export function roiFor(preview: { width: number; height: number }): Rect {
  const width = Math.round(preview.width * ROI_WIDTH_FRACTION);
  const height = Math.round(width * ROI_ASPECT);
  return {
    x: Math.round((preview.width - width) / 2),
    y: Math.round((preview.height - height) / 2),
    width,
    height,
  };
}

/**
 * What the development overlay is allowed to say about a callback.
 *
 * Coordinates and a verdict, never the payload: an overlay that printed
 * identifiers would put complete IMEIs on a screen and into whatever captured
 * it. The last four digits are enough to tell two candidates apart while
 * debugging, and are not an identifier on their own.
 */
export interface RoiTrace {
  verdict: RoiVerdict;
  corners: Point[];
  /** Last four digits only. Never the whole value. */
  tail: string;
}

export function traceOf(raw: string, corners: readonly Point[] | undefined, verdict: RoiVerdict): RoiTrace {
  return {
    verdict,
    corners: corners ? corners.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })) : [],
    tail: raw.slice(-4),
  };
}
