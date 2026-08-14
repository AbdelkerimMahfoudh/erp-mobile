import type { TranslationKey, TranslationValues } from './i18n';

/**
 * Saying the return policy in words a customer and a first-week employee both
 * understand.
 *
 * The server decides everything that matters — the window, the deadline, and
 * whether a return is still open. This file only chooses how to say it. Nothing
 * here recomputes eligibility from the phone's clock: a device that disagreed
 * with the server would show a customer a promise the shop will not honour.
 *
 * `t` and `formatDateTime` are injected rather than imported so these stay pure
 * functions with no module side effects, testable with plain Node.
 */

export type Translate = (key: TranslationKey, values?: TranslationValues) => string;
export type FormatDateTime = (date: Date) => string;

export interface ReturnPolicySnapshot {
  windowHours: number;
  /** ISO instant, or null when the sale carries no return window. */
  deadlineAt: string | null;
}

/** Why the server says a return is or is not open. */
export type ReturnEligibilityReason =
  | 'no_return_policy'
  | 'within_window'
  | 'window_expired'
  | 'already_returned'
  | 'quantity_not_supported'
  | 'sale_reversed';

export interface ReturnPolicyView extends ReturnPolicySnapshot {
  eligible: boolean;
  reason: ReturnEligibilityReason;
  remainingMs: number | null;
  requiresOwnerException: boolean;
  overriddenBy?: string | null;
  overrideReason?: string | null;
}

/**
 * A window as a person would say it: days when it divides into days, hours
 * otherwise. "48 hours" is correct, but "2 days" is what someone repeats back
 * to a customer.
 */
export function describeWindow(windowHours: number, t: Translate): string {
  if (windowHours <= 0) return t('returns.window.none');
  if (windowHours % 24 === 0) {
    const days = windowHours / 24;
    return days === 1 ? t('returns.window.oneDay') : t('returns.window.days', { count: days });
  }
  return windowHours === 1 ? t('returns.window.oneHour') : t('returns.window.hours', { count: windowHours });
}

/**
 * The sentence a receipt prints.
 *
 * States the deadline as well as the window: "48 hours" leaves the customer
 * doing arithmetic from a time they may not remember, and a date and time is
 * what settles the argument at the counter.
 */
export function receiptPolicyLine(
  policy: ReturnPolicySnapshot,
  t: Translate,
  formatDateTime: FormatDateTime,
): string {
  if (policy.windowHours <= 0 || !policy.deadlineAt) return t('returns.receipt.none');
  return t('returns.receipt.until', {
    window: describeWindow(policy.windowHours, t),
    deadline: formatDateTime(new Date(policy.deadlineAt)),
  });
}

export interface PolicyStatus {
  tone: 'success' | 'neutral' | 'warning';
  label: string;
  detail: string | null;
}

/**
 * The status a sale-history screen shows — in colour AND words, never colour
 * alone, and never a bare reason code from the API.
 */
export function policyStatus(
  policy: ReturnPolicyView,
  t: Translate,
  formatDateTime: FormatDateTime,
): PolicyStatus {
  switch (policy.reason) {
    case 'within_window':
      return {
        tone: 'success',
        label: t('returns.status.open'),
        detail: policy.deadlineAt
          ? t('returns.status.until', { deadline: formatDateTime(new Date(policy.deadlineAt)) })
          : null,
      };
    case 'window_expired':
      return {
        tone: 'warning',
        label: t('returns.status.expired'),
        detail: policy.deadlineAt
          ? t('returns.status.closedOn', { deadline: formatDateTime(new Date(policy.deadlineAt)) })
          : null,
      };
    /**
     * "No returns" is not "expired". Nothing was ever promised, and a customer
     * told the wrong one of those will argue about the wrong thing.
     */
    case 'no_return_policy':
      return { tone: 'neutral', label: t('returns.status.none'), detail: null };
    case 'already_returned':
      return { tone: 'neutral', label: t('returns.status.returned'), detail: null };
    case 'sale_reversed':
      return { tone: 'neutral', label: t('returns.status.reversed'), detail: null };
    case 'quantity_not_supported':
      return { tone: 'neutral', label: t('returns.status.accessoriesOnly'), detail: null };
  }
}

/**
 * What the Sell screen may offer, given what the employee is allowed to do.
 *
 * An employee sees the policy and cannot change it — the control is read-only
 * rather than hidden, because knowing what the customer is being promised is
 * part of doing the job. A manager or owner may remove the window or extend it,
 * but not shorten a positive one to another positive value: trimming 48 hours
 * to 2 sells a worse promise under the same banner. The server enforces all of
 * this; the screen only avoids offering what would be refused.
 */
export function allowedWindowChoices(companyDefaultHours: number, canOverride: boolean): number[] {
  if (!canOverride) return [companyDefaultHours];
  const CHOICES = [0, 24, 48, 72, 168];
  return [...new Set([companyDefaultHours, ...CHOICES])]
    .filter((hours) => hours === 0 || hours === companyDefaultHours || hours > companyDefaultHours)
    .sort((a, b) => a - b);
}
