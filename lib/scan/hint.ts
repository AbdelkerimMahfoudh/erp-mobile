/**
 * The scanner's guidance, in the shop's language.
 *
 * `POST /scan` sends an English `hint` for older clients and a stable
 * `hintCode` for this one. The English sentence is never shown: it used to
 * appear verbatim in French and Arabic sheets.
 */

export type ScanHintCode =
  | 'unrecognized_code'
  | 'new_barcode'
  | 'recognized_device'
  | 'unknown_imei'
  | 'serial_manual'
  | 'contested_mapping';

const KEYS: Record<ScanHintCode, string> = {
  unrecognized_code: 'scan.hint.unrecognizedCode',
  new_barcode: 'scan.hint.newBarcode',
  recognized_device: 'scan.hint.recognizedDevice',
  unknown_imei: 'scan.hint.unknownImei',
  serial_manual: 'scan.hint.serialManual',
  contested_mapping: 'scan.hint.contested',
};

/** The translation key for a hint code, or null for none/unknown codes. */
export function scanHintKey(code: string | undefined | null): string | null {
  return code && code in KEYS ? KEYS[code as ScanHintCode] : null;
}
