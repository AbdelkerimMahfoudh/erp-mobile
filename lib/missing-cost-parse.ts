/* Pure, for `node lib/*.test.ts`: the missing-cost question itself lives in missing-cost.ts. */
/** A typed buying cost, or `null` for an empty field. Anything else is not a cost (`invalid`). */
export function parseBuyingCost(text: string): number | null | 'invalid' {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed.replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : 'invalid';
}
