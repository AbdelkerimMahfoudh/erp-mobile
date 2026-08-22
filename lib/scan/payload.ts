import { isValidImei } from '../imei.ts';

/**
 * What a scanned barcode or QR payload actually contains (milestone O).
 *
 * This replaces the OCR reading path. The two jobs look similar and are not:
 *
 * **OCR read a screen** — many lines, labels beside numbers, characters the
 * recogniser was unsure about. `lib/imei.ts` slides a 15-digit window across
 * each line and will reinterpret `O` as `0`, because from a photograph that is
 * a reasonable guess a human then confirms.
 *
 * **A barcode carries one exact value.** Both of those behaviours become
 * dangerous here:
 *
 *  - Window sliding turns a 19-digit ICCID into an IMEI roughly one time in
 *    ten, because some 15-digit substring of it passes Luhn by chance. A SIM
 *    card would silently become a phone.
 *  - Character substitution invents digits. A barcode scanner does not "think"
 *    a character might be a zero; if the payload says `O`, it is an `O`.
 *
 * So this module matches whole tokens exactly, and normalises **presentation
 * only**: Arabic-Indic digits to Latin, and the spaces and dashes people print
 * between groups. It never replaces a digit with a different digit.
 *
 * It is deliberately authoritative about ONE thing — whether the payload is an
 * IMEI — and defers everything else to the server's existing `/scan`
 * classifier, which already knows about serials, product barcodes and the TAC
 * catalogue. Guessing locally that an alphanumeric code is a product barcode is
 * how a device serial ends up prefilling the Product barcode field.
 */

export type ScanPayload =
  /** One phone. `secondary` is present only when the payload carried both. */
  | { kind: 'imei'; primary: string; secondary: string | null }
  /** More than two plausible IMEIs: a person chooses, this code does not. */
  | { kind: 'ambiguous'; candidates: string[] }
  /** Looked like an IMEI and was not. Explain it; never submit it. */
  | { kind: 'invalid'; reason: 'checksum' | 'length'; value: string }
  /** Not an IMEI. Hand the raw code to the server to classify. */
  | { kind: 'other'; code: string }
  | { kind: 'empty' };

/** Arabic-Indic and Extended Arabic-Indic digits to Latin. Presentation only. */
function toLatinDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) => {
    const c = d.charCodeAt(0);
    const base = c >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(c - base);
  });
}

/** Split a payload into the values it carries. */
function tokenise(raw: string): string[] {
  return toLatinDigits(raw)
    .split(/[\r\n;,|]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

interface Labelled {
  /** Digits only, separators removed. */
  readonly value: string;
  /** 1 or 2 when the payload said so. */
  readonly slot: 1 | 2 | null;
  /** True when the token announced itself as an IMEI. */
  readonly declared: boolean;
}

/**
 * Strip an `IMEI:` / `IMEI1 -` / `IMEI 2 =` prefix and the separators printed
 * inside the number, keeping what the token actually claims to be.
 */
function readToken(token: string): Labelled {
  const labelled = token.match(/^\s*IMEI\s*([12])?\s*[:=\-.]?\s*(.*)$/i);
  const slotDigit = labelled?.[1];
  const body = labelled ? labelled[2] : token;
  return {
    value: body.replace(/[\s\-.]/g, ''),
    slot: slotDigit === '1' ? 1 : slotDigit === '2' ? 2 : null,
    declared: Boolean(labelled),
  };
}

const FIFTEEN_DIGITS = /^\d{15}$/;

/**
 * Classify one scanned payload.
 *
 * Order matters. A token that is exactly fifteen digits is treated as a claim
 * to be an IMEI whether or not it passes Luhn — a failed checksum is reported
 * as a bad read, not quietly demoted to "some other barcode", because the two
 * lead to completely different next steps for the person holding the phone.
 */
export function classifyScan(raw: string): ScanPayload {
  if (!raw || !raw.trim()) return { kind: 'empty' };

  const tokens = tokenise(raw).map(readToken);

  const valid: Labelled[] = [];
  const fifteenButInvalid: Labelled[] = [];

  for (const token of tokens) {
    if (!FIFTEEN_DIGITS.test(token.value)) continue;
    if (isValidImei(token.value)) valid.push(token);
    else fifteenButInvalid.push(token);
  }

  // Two labelled slots carrying the same number is a printing quirk, not two
  // phones — and definitely not one phone whose IMEIs collide.
  const distinct = [...new Map(valid.map((v) => [v.value, v])).values()];

  if (distinct.length > 2) {
    return { kind: 'ambiguous', candidates: distinct.map((d) => d.value) };
  }

  if (distinct.length === 2) {
    const first = distinct.find((d) => d.slot === 1) ?? distinct[0];
    const second = distinct.find((d) => d.value !== first.value)!;
    return { kind: 'imei', primary: first.value, secondary: second.value };
  }

  if (distinct.length === 1) {
    return { kind: 'imei', primary: distinct[0].value, secondary: null };
  }

  if (fifteenButInvalid.length > 0) {
    return { kind: 'invalid', reason: 'checksum', value: fifteenButInvalid[0].value };
  }

  // A token that announced itself as an IMEI and is not fifteen digits is a bad
  // read of an IMEI, not a product barcode.
  const declaredWrongLength = tokens.find((t) => t.declared && /^\d+$/.test(t.value));
  if (declaredWrongLength) {
    return { kind: 'invalid', reason: 'length', value: declaredWrongLength.value };
  }

  // Everything else — EAN, UPC, Code128, a serial, an ICCID — goes to the
  // server, which owns classification and the TAC catalogue.
  return { kind: 'other', code: raw.trim() };
}

/** Whether a payload can be accepted as a phone without further questions. */
export function isAcceptableImei(payload: ScanPayload): payload is Extract<ScanPayload, { kind: 'imei' }> {
  return payload.kind === 'imei';
}
