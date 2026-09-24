/**
 * What the Daily closing report screen may decide for itself (docs/51).
 *
 *   node lib/closing-report-view.test.ts
 *
 * Every figure comes from the server, already reconciled; the phone adds
 * nothing up. What is left here is words and states: which catalogue key names
 * a verification or a warning, whether the figures on screen are fresh, and
 * whether a close may be confirmed. Imports nothing, so it runs under bare node.
 */

/** How one channel stands against its expected figure (backend `Verification`). */
export type Verification = 'counted' | 'skipped' | 'not_verified' | 'stale' | 'not_counted';

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/** The word for a verification — always shown beside its colour. */
export function verificationKey(v: Verification): string {
  return `dailyReport.verify.${v}`;
}

/**
 * Only a count is a verification. A counted channel with a difference is a
 * question, not a match; anything not counted is never green.
 */
export function verificationTone(v: Verification, difference: number | null): Tone {
  if (v === 'counted') return difference !== null && Math.abs(difference) >= 0.005 ? 'warning' : 'success';
  if (v === 'not_verified' || v === 'stale') return 'warning';
  return 'neutral';
}

export type WarningCode =
  | 'channels_not_verified'
  | 'channels_stale'
  | 'account_movement_not_balance'
  | 'unattributed_money'
  | 'pending_refund_reports'
  | 'pending_expense_reports'
  | 'cost_missing'
  | 'no_counted_opening'
  | 'opening_not_verified'
  | 'negative_expected'
  | 'open_discrepancies'
  | 'previous_day_needs_review'
  | 'overcollected'
  | 'changed_since_close'
  | 'figures_disagree';

const KNOWN_WARNINGS: readonly string[] = [
  'channels_not_verified',
  'channels_stale',
  'account_movement_not_balance',
  'unattributed_money',
  'pending_refund_reports',
  'pending_expense_reports',
  'cost_missing',
  'no_counted_opening',
  'opening_not_verified',
  'negative_expected',
  'open_discrepancies',
  'previous_day_needs_review',
  'overcollected',
  'changed_since_close',
  'figures_disagree',
];

/** The catalogue key of a warning; an unknown one falls back to a generic line rather than a raw code. */
export function warningKey(code: string): string {
  return KNOWN_WARNINGS.includes(code) ? `dailyReport.warning.${code}` : 'dailyReport.warning.other';
}

/**
 * Whether the figures on screen can be treated as the day's figures. `live`:
 * read from the server a moment ago. `stale`: read a while ago — shown, but not
 * final. `offline`: the phone cannot reach the server — shown as last read, and
 * nothing may be closed on them.
 */
export type Freshness = 'live' | 'stale' | 'offline';

export function reportFreshness(fetchedAt: number | null | undefined, online: boolean, now: number = Date.now(), freshMs = 120_000): Freshness {
  if (!online) return 'offline';
  if (!fetchedAt) return 'stale';
  return now - fetchedAt <= freshMs ? 'live' : 'stale';
}

/** A reason a person actually wrote — three characters or more, spaces aside. */
export function reasonGiven(reason: string): boolean {
  return reason.trim().length >= 3;
}

/**
 * Whether "Close the business day" may be pressed in the review sheet.
 *
 * Never because counts are missing — physical checks are optional (docs/51 D2).
 * Only when the figures are live, the person may close, and — if any balance was
 * not physically checked — they have said so and why.
 */
export function canConfirmClose(input: {
  canClose: boolean;
  freshness: Freshness;
  requiresAcknowledgement: boolean;
  acknowledged: boolean;
  reason: string;
  busy: boolean;
}): boolean {
  if (!input.canClose || input.busy || input.freshness !== 'live') return false;
  if (!input.requiresAcknowledgement) return true;
  return input.acknowledged && reasonGiven(input.reason);
}

/** The word for a source record's refusal, or null when it can be acted on. */
export function refusalKey(refusal: string | null): string | null {
  if (!refusal) return null;
  const known = ['already_corrected', 'request_pending', 'not_permitted', 'expense_not_correctable', 'purchase_payment_not_correctable'];
  return known.includes(refusal) ? `correctTx.refusal.${refusal}` : 'correctTx.refusal.other';
}

/** A channel's display label: the catalogue word for cash and unattributed money, the account's own label otherwise. */
export function channelLabel(
  c: { channel: 'cash' | 'account'; isUnattributed?: boolean; label?: string | null },
  words: { cash: string; unattributed: string },
): string {
  if (c.channel === 'cash') return words.cash;
  if (c.isUnattributed || !c.label || c.label === 'UNATTRIBUTED') return words.unattributed;
  return c.label;
}
