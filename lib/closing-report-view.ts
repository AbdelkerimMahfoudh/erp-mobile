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

/** Every refusal the server names (docs/51 §15), each with its own sentence. */
export const KNOWN_REFUSALS: readonly string[] = [
  'already_corrected',
  'request_pending',
  'not_permitted',
  'sale_cancelled',
  'sale_cancellation_pending',
  'already_cancelled',
  'sale_has_return',
  'unit_not_sold',
  'payment_correction_pending',
  'no_debtor',
  'not_confirmed',
  'expense_not_yet_due',
  'purchase_cancelled',
  'purchase_cancellation_pending',
  'goods_moved',
  'stock_short',
  'cost_conflict',
];

/** The word for a record's refusal, or null when it can be acted on; an unknown one gets a generic line, never a code. */
export function refusalKey(refusal: string | null): string | null {
  if (!refusal) return null;
  return KNOWN_REFUSALS.includes(refusal) ? `correctTx.refusal.${refusal}` : 'correctTx.refusal.other';
}

export type CorrectionAction =
  | 'cancel_sale'
  | 'reverse_payment'
  | 'reclassify_payment'
  | 'reverse_expense'
  | 'reclassify_purchase_payment'
  | 'cancel_purchase';

/** What the action is called on its button and on its sheet. */
export function actionKey(action: CorrectionAction): string {
  return `correctTx.action.${action}`;
}

/** Whether an action takes an amount (a part of a payment or an expense), a destination, or neither. */
export function actionNeeds(action: CorrectionAction): { amount: boolean; destination: boolean } {
  return {
    amount: action === 'reverse_payment' || action === 'reverse_expense' || action === 'reclassify_payment' || action === 'reclassify_purchase_payment',
    destination: action === 'reclassify_payment' || action === 'reclassify_purchase_payment',
  };
}

/**
 * Which record an action corrects. A stock purchase row IS its payment (the id a move
 * needs), while cancelling acts on the purchase itself; a payment row's sale is the
 * record a sale cancellation needs. Found by the render checks: the purchase row's
 * payment id was sent as the purchase, and the server rightly said it did not exist.
 */
export function targetIdFor(row: { kind: string; id: string; detail: Record<string, unknown> }, action: CorrectionAction): string {
  if (action === 'cancel_purchase') return String(row.detail.purchaseId ?? row.id);
  if (action === 'cancel_sale' && row.kind === 'payment') return String(row.detail.saleId ?? row.id);
  return row.id;
}

/** A request waiting for the Owner, said as what it would do. */
export function pendingKey(p: { targetKind: string; action: string }): string {
  const known = ['sale:cancel', 'sale_payment:reverse', 'sale_payment:reclassify', 'expense:reverse', 'supplier_payment:reclassify', 'purchase:cancel', 'refund_payout:reverse', 'supplier_settlement:reverse'];
  const k = `${p.targetKind}:${p.action}`;
  return known.includes(k) ? `correctTx.pending.${k.replace(':', '.')}` : 'correctTx.pending.other';
}

/**
 * Whether the correction may be sent: something to send it on (a preview without a
 * refusal), a valid amount where one is asked, a destination where one is needed,
 * and a reason a person actually wrote.
 */
export function canSendCorrection(input: {
  action: CorrectionAction;
  amount: number | null;
  maxAmount: number;
  destinationChosen: boolean;
  reason: string;
  previewOk: boolean;
  refused: boolean;
  busy: boolean;
}): boolean {
  if (input.busy || !input.previewOk || input.refused || !reasonGiven(input.reason)) return false;
  const needs = actionNeeds(input.action);
  if (needs.destination && !input.destinationChosen) return false;
  if (needs.amount && !(input.amount !== null && input.amount > 0 && Math.round(input.amount * 100) <= Math.round(input.maxAmount * 100))) return false;
  return true;
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
