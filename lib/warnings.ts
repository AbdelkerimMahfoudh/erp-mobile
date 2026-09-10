/**
 * A server warning, turned into something a person can read (A1/A3).
 *
 * Pure. The server sends a **key and parameters**, never a sentence — it does
 * not know the reader's language, and a server-rendered English string is
 * exactly how an Arabic interface ends up with English in the middle of it.
 * This module decides which key to render and with what values; the component
 * calls `t()` with the result.
 *
 * ## A warning is not a refusal
 *
 * Nothing here blocks anything. A warned mutation simply has not happened yet:
 * the server changed nothing and handed back a token, and the same request
 * carrying that token goes through. The token is bound to the exact payload and
 * the exact warnings the person was shown, so a changed price cannot reuse an
 * old confirmation — which is why the app must send the token back **unchanged
 * and with an unchanged body**, never a rebuilt one.
 */

export type WarningSeverity = 'info' | 'caution';

export interface WarningReference {
  kind:
    | 'configured_price'
    | 'median_sale_price'
    | 'weighted_average_cost'
    | 'previous_price'
    | 'median_expense'
    | 'outstanding_balance'
    | 'unit_cost';
  /** Null when the reader is not permitted to see the figure. */
  amount: number | null;
  sample: number | null;
}

export interface ServerWarning {
  code: string;
  severity: WarningSeverity;
  /** Already direction-aware, e.g. `warning.magnitude.salePrice.high`. */
  messageKey: string;
  params: Record<string, string | number>;
  field: string | null;
  submitted: number | null;
  reference: WarningReference | null;
}

/** Why the server re-issued instead of accepting the confirmation we sent. */
export type ReissueReason = 'expired' | 'payload_changed' | 'warnings_changed';

export interface WarningsPending {
  status: 'warnings_pending';
  warnings: ServerWarning[];
  acknowledgementToken: string;
  expiresAt: string;
  reissuedBecause?: ReissueReason;
}

/**
 * Did this response change anything, or is it a question?
 *
 * One field to branch on, so no caller has to infer "did that work?" from the
 * shape of what came back.
 */
export function isWarningsPending(value: unknown): value is WarningsPending {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { status?: unknown }).status === 'warnings_pending'
  );
}

/**
 * The key naming what the value was compared against.
 *
 * Separate from the warning's own message so a language can phrase the
 * comparison naturally — Arabic does not build the sentence the way English
 * does, and gluing two half-sentences together is how a translation ends up
 * grammatically wrong in one language to stay convenient in another.
 */
export function referenceKey(reference: WarningReference | null): string | null {
  if (!reference) return null;
  if (reference.amount !== null) return `warning.reference.${camel(reference.kind)}`;
  /*
   * A withheld figure. Only the two cost-derived references are ever withheld —
   * the gate does that — and for those the KIND is still safe to name, which is
   * what makes "compared with what we paid" sayable without ever saying what we
   * paid. Any other kind arriving with no amount has nothing to say, so it says
   * nothing rather than inventing a sentence around a missing number.
   */
  return COST_DERIVED.has(reference.kind)
    ? `warning.reference.${camel(reference.kind)}.hidden`
    : null;
}

/** The references whose figure the cost gate can remove. */
const COST_DERIVED: ReadonlySet<WarningReference['kind']> = new Set<WarningReference['kind']>([
  'weighted_average_cost',
  'unit_cost',
]);

/** `median_sale_price` → `medianSalePrice`. */
function camel(value: string): string {
  return value.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Cautions first, then the order the server sent.
 *
 * A person answering a dialog reads the top line. If an advisory note sat above
 * the reason the dialog opened, the top line would be the least important thing
 * on screen.
 */
export function orderWarnings(warnings: readonly ServerWarning[]): ServerWarning[] {
  return [...warnings].sort((a, b) => rank(a.severity) - rank(b.severity));
}

const rank = (severity: WarningSeverity): number => (severity === 'caution' ? 0 : 1);

/** Does anything here need a deliberate answer, or is it all advisory? */
export function needsConfirmation(warnings: readonly ServerWarning[]): boolean {
  return warnings.some((w) => w.severity === 'caution');
}

/**
 * A stable signature of what the person was shown.
 *
 * The offline queue holds a confirmed request until it can be sent. If the
 * server would now raise a **different** warning it refuses the confirmation
 * with `warnings_changed`, and the queued item must stop and wait for a human
 * rather than proceeding or vanishing. Comparing signatures lets the app say
 * so before it even tries — the same fields the server binds, in the same
 * order, so the two agree about what "different" means.
 */
export function warningSignature(warnings: readonly ServerWarning[]): string {
  return warnings
    .map((w) => {
      const params = Object.keys(w.params)
        .sort()
        .map((k) => `${k}=${w.params[k]}`)
        .join(',');
      return `${w.code}@${w.field ?? '-'}#${w.severity}~${params}`;
    })
    .sort()
    .join('|');
}
