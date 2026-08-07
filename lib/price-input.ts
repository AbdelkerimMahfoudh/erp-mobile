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
  const normalised = input
    .trim()
    // Arabic-Indic ٠-٩ and Extended Arabic-Indic ۰-۹ → ASCII.
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    // Arabic decimal separator.
    .replace(/٫/g, '.')
    .replace(/\s|,/g, '');

  if (!normalised) return { ok: false, reason: 'empty' };
  if (!/^-?\d*\.?\d*$/.test(normalised) || normalised === '.' || normalised === '-') {
    return { ok: false, reason: 'not_a_number' };
  }

  const value = Number(normalised);
  if (!Number.isFinite(value)) return { ok: false, reason: 'not_a_number' };
  if (value < 0) return { ok: false, reason: 'negative' };

  const decimals = normalised.split('.')[1]?.length ?? 0;
  if (decimals > 2) return { ok: false, reason: 'too_precise' };

  return { ok: true, value };
}

/** Save is offered only for a valid price that actually differs from the current one. */
export function canSave(input: string, current: number | null): boolean {
  const parsed = parsePrice(input);
  return parsed.ok && parsed.value !== current;
}

