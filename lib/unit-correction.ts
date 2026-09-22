/**
 * Correcting an in-stock unit, decided on the phone.
 *
 * Pure: no React, no network. These rules say what a correction changed, what is
 * wrong with it before the server is asked, and exactly what payload to send —
 * so the screen stays a thin skin over them and the same logic can be proved
 * without rendering anything.
 *
 * The server is still the authority: it re-validates format, checksum,
 * cross-unit uniqueness, isolation and the optimistic lock. These rules exist to
 * avoid lying to the person at the counter, not to protect data.
 */

export type TrackingType = 'imei' | 'serial' | 'quantity';

export interface UnitForCorrection {
  imeiPrimary: string | null;
  imeiSecondary: string | null;
  serialNo: string | null;
  /** Absent without cost.view; the cost field is then never offered. */
  cost?: number;
  updatedAt: string;
  trackingType: TrackingType;
}

export interface CorrectionForm {
  /** Set only once a DIFFERENT product has been chosen. */
  newProductId: string | null;
  imei1: string;
  imei2: string;
  serial: string;
  /** Raw text from the money field. */
  cost: string;
  reason: string;
  canViewCost: boolean;
}

export type ImeiProblem = 'empty' | 'not_digits' | 'length' | 'checksum';

/** Presentation characters removed: an IMEI is digits, however it was typed. */
export const normImei = (raw: string): string => raw.replace(/\D/g, '');

/** A serial is upper-cased and trimmed — the same normalisation the server does. */
export const normSerial = (raw: string): string => raw.trim().toUpperCase();

/** Luhn check, inlined so this module needs nothing else and tests run standalone. */
function luhnValid(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/**
 * Why a typed IMEI cannot be used yet, or null when it can — the same rules the
 * server applies, said before the request rather than after it.
 */
export function imeiFormatProblem(raw: string): ImeiProblem | null {
  const imei = normImei(raw);
  const typed = raw.trim();
  if (typed.length === 0) return 'empty';
  if (!/^\d+$/.test(typed)) return 'not_digits';
  if (imei.length !== 15) return 'length';
  if (!luhnValid(imei)) return 'checksum';
  return null;
}

export type Imei2Problem = 'invalid' | 'same';

export interface CorrectionShape {
  imei1Changed: boolean;
  imei2Changed: boolean;
  serialChanged: boolean;
  costChanged: boolean;
  productChanged: boolean;
  /** IMEI / serial / cost — the changes that need a reason. */
  sensitiveChange: boolean;
  anyChange: boolean;
  imei1Problem: ImeiProblem | null;
  imei2Problem: Imei2Problem | null;
  serialProblem: 'empty' | null;
  reasonMissing: boolean;
  /** True when Save must stay disabled. */
  blocked: boolean;
}

/** What a correction changed, and what is wrong with it — before the server answers. */
export function analyzeCorrection(
  unit: UnitForCorrection,
  form: CorrectionForm,
  inStock: boolean,
): CorrectionShape {
  const isImei = unit.trackingType === 'imei';
  const isSerial = unit.trackingType === 'serial';

  const imei1Changed = isImei && normImei(form.imei1) !== (unit.imeiPrimary ?? '');
  const imei2Changed = isImei && form.imei2.trim() !== (unit.imeiSecondary ?? '');
  const serialChanged = isSerial && normSerial(form.serial) !== (unit.serialNo ?? '');
  const costChanged = form.canViewCost && form.cost.trim() !== '' && Number(form.cost) !== unit.cost;
  const productChanged = form.newProductId !== null;

  const sensitiveChange = imei1Changed || imei2Changed || serialChanged || costChanged;
  const anyChange = sensitiveChange || productChanged;

  const imei1Problem = isImei && form.imei1.trim() ? imeiFormatProblem(form.imei1) : null;
  const imei2Trimmed = form.imei2.trim();
  const imei2Problem: Imei2Problem | null =
    isImei && imei2Trimmed
      ? imeiFormatProblem(imei2Trimmed)
        ? 'invalid'
        : normImei(imei2Trimmed) === normImei(form.imei1)
          ? 'same'
          : null
      : null;
  const serialProblem: 'empty' | null =
    isSerial && serialChanged && normSerial(form.serial).length === 0 ? 'empty' : null;
  const reasonMissing = sensitiveChange && form.reason.trim().length === 0;

  const blocked =
    !inStock ||
    !anyChange ||
    Boolean(imei1Problem) ||
    Boolean(imei2Problem) ||
    Boolean(serialProblem) ||
    reasonMissing;

  return {
    imei1Changed,
    imei2Changed,
    serialChanged,
    costChanged,
    productChanged,
    sensitiveChange,
    anyChange,
    imei1Problem,
    imei2Problem,
    serialProblem,
    reasonMissing,
    blocked,
  };
}

/**
 * The PATCH body — only the fields that actually changed, plus the optimistic
 * token and (for a sensitive change) the reason. Clearing a second IMEI sends an
 * explicit null; leaving it alone sends nothing.
 */
export function buildCorrectionBody(unit: UnitForCorrection, form: CorrectionForm): Record<string, unknown> {
  const shape = analyzeCorrection(unit, form, true);
  const body: Record<string, unknown> = { expectedUpdatedAt: unit.updatedAt };
  if (shape.productChanged && form.newProductId) body.productId = form.newProductId;
  if (shape.imei1Changed) body.imeiPrimary = normImei(form.imei1);
  if (shape.imei2Changed) body.imeiSecondary = form.imei2.trim() === '' ? null : form.imei2.trim();
  if (shape.serialChanged) body.serialNo = normSerial(form.serial);
  if (shape.costChanged) body.cost = Number(form.cost);
  if (shape.sensitiveChange) body.reason = form.reason.trim();
  return body;
}
