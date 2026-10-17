/**
 * The rules the Money and sale screens decide on the phone (0074).
 *
 * Pure — no React, no network — so each is testable on its own. None of them
 * decides a figure the shop relies on: the server computes received, remaining,
 * status and every total, and these only PREVIEW what the server will say, or
 * choose the words for what it said.
 */

import { parseAmount } from './price-input.ts';
import { parsePayerNumber } from './payer-number.ts';
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

/**
 * Who owes what was not paid. An existing customer carries the number saved for
 * them (`phone`), and — only when they have none — the number typed at the
 * counter (`typedPhone`), which the server then saves on the customer.
 */
export type DebtorDraft =
  | { kind: 'none' }
  | { kind: 'customer_existing'; customerId: string; name: string; phone?: string | null; typedPhone?: string }
  | { kind: 'customer_new'; name: string; phone: string }
  | { kind: 'store'; counterpartyId: string; name: string };

export type DebtProblem =
  | 'debtor_required'
  | 'customer_name_required'
  | 'customer_phone_required'
  | 'customer_phone_invalid'
  | 'due_days_required'
  | 'due_days_invalid';

/** A debt is due within a year: the server's `DEBT_DUE_MAX_DAYS`. */
export const DEBT_DUE_MAX_DAYS = 365;
const PHONE_MIN_DIGITS = 8;
const PHONE_MAX_DIGITS = 15;

/**
 * A customer's phone number as the server will accept it (the owner's brief of
 * 2026-10-17): the payer-number normalisation, held to a phone's length.
 */
export function customerPhoneProblem(text: string | null | undefined): 'customer_phone_required' | 'customer_phone_invalid' | null {
  const parsed = parsePayerNumber(text ?? '');
  if (!parsed.ok) return 'customer_phone_invalid';
  if (parsed.value === null) return 'customer_phone_required';
  const digits = parsed.value.replace('+', '').length;
  return digits < PHONE_MIN_DIGITS || digits > PHONE_MAX_DIGITS ? 'customer_phone_invalid' : null;
}

/** The days typed until the balance is due: whole days, 1 to a year. */
export function dueDaysProblem(text: string): 'due_days_required' | 'due_days_invalid' | null {
  const trimmed = text.trim();
  if (trimmed === '') return 'due_days_required';
  if (!/^\d+$/.test(trimmed)) return 'due_days_invalid';
  const days = Number(trimmed);
  return days < 1 || days > DEBT_DUE_MAX_DAYS ? 'due_days_invalid' : null;
}

/**
 * Whether the sale can be sent: a balance left owing names who owes it, a
 * customer who owes has a name and a valid phone number, and the debt has a due
 * date in days. A fully paid sale needs none of it.
 */
export function debtorProblem(remaining: number, debtor: DebtorDraft, dueDaysText?: string): DebtProblem | null {
  if (remaining <= EPSILON) return null;
  if (debtor.kind === 'none') return 'debtor_required';
  if (debtor.kind === 'customer_new') {
    if (debtor.name.trim().length === 0) return 'customer_name_required';
    const phone = customerPhoneProblem(debtor.phone);
    if (phone) return phone;
  }
  if (debtor.kind === 'customer_existing' && !debtor.phone?.trim()) {
    const phone = customerPhoneProblem(debtor.typedPhone);
    if (phone) return phone;
  }
  return dueDaysText === undefined ? null : dueDaysProblem(dueDaysText);
}

/**
 * The due date the server will set, for the screen only: today plus the days.
 * The server counts from the sale's own business day when it is confirmed.
 */
export function dueDatePreview(days: number, today: Date = new Date()): Date {
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
}

/**
 * The request fields for the chosen debtor. Exactly one of them, or none —
 * the server refuses a customer and a store together.
 */
export function debtorFields(debtor: DebtorDraft): {
  customerId?: string;
  customerPhone?: string;
  customer?: { name: string; phone?: string };
  counterpartyId?: string;
} {
  switch (debtor.kind) {
    case 'customer_existing': {
      // A number typed for a customer who has none is saved on them; a saved one is never sent back.
      const typed = !debtor.phone?.trim() ? debtor.typedPhone?.trim() : '';
      return { customerId: debtor.customerId, ...(typed ? { customerPhone: typed } : {}) };
    }
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

/**
 * A split sale's money arrives in at most four places (2026-09-27): the drawer,
 * if cash is used, counts as one of them, each account as one more. The server
 * refuses a fifth and a place used twice, whatever a screen sends.
 */
export const MAX_PAYMENT_METHODS = 4;

/**
 * Where a payment part lands: the drawer, or one named account (an account not
 * chosen yet is no place). The id is compared without its letter case, as the
 * server compares it: one account written two ways is still one place.
 */
export function destinationOf(part: { method: string; receivingAccountId?: string | null }): string | null {
  if (part.method === 'cash') return 'cash';
  return part.receivingAccountId ? `account:${part.receivingAccountId.toLowerCase()}` : null;
}

/**
 * Whether a payment amount can be sent as typed, read the way every money field
 * is (`parseAmount`): `empty` while the field is blank, unfinished ("." on its
 * way to ".5") or not above zero; `bad_amount` past two decimals, which is also
 * every figure under 0.01. The server keeps two decimals, so a finer figure
 * would be refused or rounded into one nobody typed.
 */
export function amountProblem(text: string): 'empty' | 'bad_amount' | null {
  const parsed = parseAmount(text);
  if (!parsed.ok) return parsed.reason === 'too_precise' ? 'bad_amount' : 'empty';
  return parsed.value > 0 ? null : 'empty';
}

export type SplitProblem = 'too_many' | 'duplicate' | 'empty_part' | 'bad_amount';

/**
 * What stops a split from completing: more than four places, one place used
 * twice, a part with no amount (the server refuses a part of nothing, so it is
 * typed or removed), or one past two decimals. Each part is judged as typed.
 * What the parts add up to is judged as for one method: all or part of the
 * sale, the rest owed by a named debtor, never more than the total.
 */
export function splitProblem(parts: { method: string; amountText: string; receivingAccountId?: string | null }[]): SplitProblem | null {
  if (parts.length > MAX_PAYMENT_METHODS) return 'too_many';
  const seen = new Set<string>();
  for (const part of parts) {
    const place = destinationOf(part);
    if (place === null) continue;
    if (seen.has(place)) return 'duplicate';
    seen.add(place);
  }
  const amounts = parts.map((part) => amountProblem(part.amountText));
  if (amounts.includes('empty')) return 'empty_part';
  if (amounts.includes('bad_amount')) return 'bad_amount';
  return null;
}

/** The first place a new part can use: the drawer if no part uses it, else the first account no part uses. */
export function nextFreeSource(parts: { method: string; receivingAccountId?: string | null }[], accountIds: string[]): { kind: 'cash' } | { kind: 'account'; accountId: string } | null {
  const used = new Set(parts.map(destinationOf).filter((d): d is string => d !== null));
  if (!used.has('cash')) return { kind: 'cash' };
  const free = accountIds.find((id) => !used.has(`account:${id.toLowerCase()}`));
  return free ? { kind: 'account', accountId: free } : null;
}
