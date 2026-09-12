/**
 * What a scan suggests about how a product is tracked.
 *
 *   node lib/scan/suggested-tracking.test.ts
 *
 * The scanner already classifies a code: an IMEI, a serial number, a product
 * barcode, or nothing it recognises. That classification is the only honest
 * basis for a suggestion, and it was previously ignored — Create product always
 * proposed IMEI, so scanning a television's serial asked the user for a number
 * the television does not have.
 *
 * Three rules, and the third is the one that keeps the catalogue clean:
 *
 * 1. An IMEI suggests `imei`. Only phones carry one.
 * 2. A serial suggests `serial` — never `imei` merely because the serial
 *    happens to be all digits.
 * 3. A **product barcode suggests nothing at all**. An EAN or UPC names a
 *    reusable model, not a physical thing, so it fills the Product barcode box
 *    and says nothing about whether units are counted or identified. Guessing
 *    from it is how a carton of cables becomes individually tracked.
 *
 * A suggestion is never a decision: the form still asks, and a chosen category
 * overrides it server-side (`resolveTrackingType` refuses a contradiction).
 */

/** What the scanner reports. Mirrors `ScanResult['kind']`. */
export type ScanKind = 'imei' | 'serial' | 'barcode' | 'quantity' | 'unknown';

/** The tracking modes a product can be created with. */
export type SuggestedTracking = 'imei' | 'serial' | 'quantity';

/**
 * The mode this scan points at, or `null` when it points at nothing.
 *
 * `null` is a real answer and must stay distinct from a guess: it means "this
 * code cannot tell you", and the form should then ask rather than preselect.
 */
export function suggestedTracking(kind: ScanKind): SuggestedTracking | null {
  switch (kind) {
    case 'imei':
      return 'imei';
    case 'serial':
      return 'serial';
    // A barcode identifies a model, not a unit; `quantity` here would be a
    // guess dressed up as knowledge, and `unknown` is not knowledge either.
    case 'barcode':
    case 'quantity':
    case 'unknown':
      return null;
  }
}

/**
 * Which field a scanned code belongs in.
 *
 * Written as one table so the four identifier fields can never cross-populate:
 * an IMEI must never reach the Product barcode box (it would poison recognition
 * for every unit of that model), and a product barcode must never reach a
 * unit's serial field (it names the model, not the item in your hand).
 */
export type IdentifierField = 'imei' | 'serial' | 'productBarcode' | null;

export function fieldForScan(kind: ScanKind): IdentifierField {
  switch (kind) {
    case 'imei':
      return 'imei';
    case 'serial':
      return 'serial';
    case 'barcode':
      return 'productBarcode';
    case 'quantity':
    case 'unknown':
      return null;
  }
}
