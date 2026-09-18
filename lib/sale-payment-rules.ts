/**
 * The rules the Money and sale screens decide on the phone (0074).
 *
 * Pure — no React, no network — so each is testable on its own. None of them
 * decides a figure the shop relies on: the server computes received, remaining,
 * status and every total, and these only PREVIEW what the server will say, or
 * choose the words for what it said.
 */

import type { PaymentMethod, SalePayStatus } from '../types/api';

const EPSILON = 0.005;
const round2 = (n: number) => Math.round(n * 100) / 100;

// ── previewing a sale being rung up ────────────────────────────────────────

/**
 * What a sale being rung up would look like with `received` taken now.
 *
 * A preview for the payment sheet only. The server recomputes both numbers and
 * refuses an overpayment; this just lets the person see the consequence before
 * tapping.
 */
export function previewSalePayment(total: number, received: number): { remaining: number; status: SalePayStatus } {
  const remaining = round2(Math.max(0, total - received));
  const status: SalePayStatus = remaining <= EPSILON ? 'paid' : received <= EPSILON ? 'credit' : 'partial';
  return { remaining, status };
}

// ── recording a later payment ───────────────────────────────────────────────

export type CollectionProblem = 'amount_missing' | 'amount_not_positive' | 'amount_over' | 'account_missing' | 'paid_at_future';

/**
 * Why a later payment cannot be recorded yet, or null when it can.
 *
 * Mirrors the server's refusals so the person learns them before the request,
 * not from it. The server still checks every one.
 */
export function collectionProblem(input: {
  amountText: string;
  remaining: number;
  method: PaymentMethod;
  accountId: string | null;
  paidAt: Date | null;
  now?: Date;
}): CollectionProblem | null {
  const text = input.amountText.trim();
  if (text === '') return 'amount_missing';
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount <= 0) return 'amount_not_positive';
  if (amount > input.remaining + EPSILON) return 'amount_over';
  if (input.method !== 'cash' && !input.accountId) return 'account_missing';
  const now = input.now ?? new Date();
  if (input.paidAt && input.paidAt.getTime() > now.getTime() + 60_000) return 'paid_at_future';
  return null;
}

/** What will still be owed once this amount is recorded. Never below zero. */
export function remainingAfter(remaining: number, amountText: string): number {
  const amount = Number(amountText);
  if (!Number.isFinite(amount) || amount <= 0) return remaining;
  return round2(Math.max(0, remaining - amount));
}

/**
 * The instant the money arrived, from a date and a time the person chose.
 *
 * `null` for either means "now". The time is read as the phone's local time,
 * which is how the shop thinks about "I was paid at 3 o'clock".
 */
export function paidAtFrom(date: string | null, time: string | null, now: Date = new Date()): Date | null {
  if (!date && !time) return null;
  const d = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : localDay(now);
  const t = time && /^\d{2}:\d{2}$/.test(time) ? time : localTime(now);
  const [y, m, day] = d.split('-').map(Number);
  const [h, min] = t.split(':').map(Number);
  const at = new Date(y, m - 1, day, h, min, 0, 0);
  return Number.isNaN(at.getTime()) ? null : at;
}

export function localDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function localTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── who owes it ─────────────────────────────────────────────────────────────

export type DebtorDraft =
  | { kind: 'none' }
  | { kind: 'customer_existing'; customerId: string; name: string }
  | { kind: 'customer_new'; name: string; phone: string }
  | { kind: 'store'; counterpartyId: string; name: string };

/**
 * Whether the sale can be sent: a balance left owing must name who owes it,
 * and a typed customer needs a name. The phone number never blocks anything.
 */
export function debtorProblem(remaining: number, debtor: DebtorDraft): 'debtor_required' | 'customer_name_required' | null {
  if (remaining <= EPSILON) return null;
  if (debtor.kind === 'none') return 'debtor_required';
  if (debtor.kind === 'customer_new' && debtor.name.trim().length === 0) return 'customer_name_required';
  return null;
}

/**
 * The request fields for the chosen debtor. Exactly one of them, or none —
 * the server refuses a customer and a store together.
 */
export function debtorFields(debtor: DebtorDraft): {
  customerId?: string;
  customer?: { name: string; phone?: string };
  counterpartyId?: string;
} {
  switch (debtor.kind) {
    case 'customer_existing':
      return { customerId: debtor.customerId };
    case 'customer_new': {
      const phone = debtor.phone.trim();
      return { customer: { name: debtor.name.trim(), ...(phone ? { phone } : {}) } };
    }
    case 'store':
      return { counterpartyId: debtor.counterpartyId };
    default:
      return {};
  }
}

// ── where the money arrived ─────────────────────────────────────────────────

/**
 * The payment method a named account implies. A bank is a bank transfer;
 * Bankily, Sedad and the rest are mobile wallets. Chosen by the account so the
 * person answers one question — "where did the money arrive?" — not two.
 */
export function methodForAccount(provider: string): PaymentMethod {
  return provider === 'bim_bank' ? 'bank' : 'mobile';
}

/**
 * The debtor fields a sale request carries. A named debtor wins; otherwise a
 * customer the cashier attached to the sale is still sent, as it always was,
 * so a fully paid sale keeps saying who bought it.
 */
export function saleDebtorFields(debtor: DebtorDraft, attachedCustomerId: string | null): ReturnType<typeof debtorFields> {
  if (debtor.kind !== 'none') return debtorFields(debtor);
  return attachedCustomerId ? { customerId: attachedCustomerId } : {};
}
