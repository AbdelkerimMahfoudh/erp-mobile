/**
 * The one rule the expense review decides on the phone.
 *
 * Pure — no React, no network. It only PREVIEWS what the drawer will read once
 * an Owner confirms a cash expense; the closing computes the real figure from
 * the recorded movements, and the server refuses anything it disagrees with.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

/** What the drawer will hold after a cash expense of `amount` is confirmed. */
export function previewCashAfterExpense(cashNow: number, amount: number): { before: number; expense: number; after: number } {
  const expense = Number.isFinite(amount) && amount > 0 ? round2(amount) : 0;
  return { before: cashNow, expense, after: round2(cashNow - expense) };
}
