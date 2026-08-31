/**
 * Scanning. Every code in the app enters through here.
 *
 * `ScanTarget` is what screens embed; `ScannerSheet` is the full-screen camera
 * it opens; `useScan` is the pipeline both use. Nothing should call `/scan`
 * directly, and nothing should resolve a code by any other route — see the note
 * in `useScan.ts` for why.
 */

export { ScanTarget, type ScanTargetProps } from './ScanTarget';
export { ScannerSheet, type ScannerSheetProps, type AcceptedImei } from './ScannerSheet';
export { useScan, CONFIDENCE_HIGH, type UseScanApi } from './useScan';
