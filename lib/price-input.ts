/**
 * Turning what a user typed into a price the API will accept.
 *
 * Pure and dependency-free so it can be run directly under Node, the same as
 * `sign-in-decision.ts`. Nothing malformed may reach the API: the server would
 * reject it with a technical message, or MySQL would silently truncate it into
 * a price nobody chose.
 */

export type ParsedPrice =
  | { ok: true; value: number }
  | { ok: false; reason: 'empty' | 'not_a_number' | 'negative' | 'too_precise' };

/** Any amount typed: a price, a count of the drawer, a movement shown by an account's app. */
export type ParsedAmount = ParsedPrice;

/**
 * Arabic-Indic ٠-٩ and Extended Arabic-Indic ۰-۹ as ASCII digits, and the Arabic
 * decimal separator ٫ as a point. The Arabic keyboard types these; dropping them
 * would leave an Arabic-speaking person unable to type an amount at all.
 */
export function toAsciiDigits(input: string): string {
  return input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.');
}

/**
 * What a money field keeps of each keystroke: digits (Arabic-Indic ones as
 * ASCII), one decimal point (typed as `.`, `,` or `٫`), and — only where the
 * figure may be below zero — a leading minus. Anything else is dropped as typed.
 */
export function maskAmount(text: string, allowNegative = false): string {
  const ascii = toAsciiDigits(text).replace(/,/g, '.');
  const negative = allowNegative && ascii.trimStart().startsWith('-');
  const [head, ...tail] = ascii.replace(/[^0-9.]/g, '').split('.');
  return (negative ? '-' : '') + (tail.length ? `${head}.${tail.join('')}` : head);
}

/**
 * Turn a typed amount into a number the API will accept, or say why it will not.
 * Below zero only where the caller allows it (an account's net movement can be);
 * never NaN, never more than the two decimals `DECIMAL(14,2)` holds.
 */
export function parseAmount(input: string, { allowNegative = false }: { allowNegative?: boolean } = {}): ParsedAmount {
  const normalised = toAsciiDigits(input.trim()).replace(/\s|,/g, '');

  if (!normalised) return { ok: false, reason: 'empty' };
  if (!/^-?\d*\.?\d*$/.test(normalised) || normalised === '.' || normalised === '-' || normalised === '-.') {
    return { ok: false, reason: 'not_a_number' };
  }

  const value = Number(normalised);
  if (!Number.isFinite(value)) return { ok: false, reason: 'not_a_number' };
  if (value < 0 && !allowNegative) return { ok: false, reason: 'negative' };

  const decimals = normalised.split('.')[1]?.length ?? 0;
  if (decimals > 2) return { ok: false, reason: 'too_precise' };

  return { ok: true, value };
}

/**
 * Turn a typed price into a number the API will accept, or say why it will not.
 *
 * Deliberately strict: blank, `NaN`, negative and over-precise values must never
 * reach the API, where they would either be rejected with a technical message or
 * silently truncated by `DECIMAL(14,2)`. Arabic-Indic digits are accepted
 * because the Arabic keyboard produces them, and `Intl` is not used — Hermes
 * ships inconsistent ICU data, so formatting stays with `lib/format`.
 */
export function parsePrice(input: string): ParsedPrice {
  return parseAmount(input);
}

/** Save is offered only for a valid price that actually differs from the current one. */
export function canSave(input: string, current: number | null): boolean {
  const parsed = parsePrice(input);
  return parsed.ok && parsed.value !== current;
}

