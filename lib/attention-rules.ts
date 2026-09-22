/**
 * What the Analyses overview shows of the alerts, and what it leaves to the
 * full list. Pure, so the counts can be tested without a screen.
 */

/** The overview shows this many, newest first. The server orders; this only cuts. */
export const ATTENTION_PREVIEW = 3;

export interface AttentionPreview<T> {
  /** The rows the overview shows: at most {@link ATTENTION_PREVIEW}, in the server's order. */
  shown: T[];
  /** How many there are altogether, as the server counted them. */
  total: number;
  /** Whether "view all" is owed — only when more exist than are shown. */
  showAll: boolean;
}

export function attentionPreview<T>(rows: readonly T[], total: number): AttentionPreview<T> {
  const shown = rows.slice(0, ATTENTION_PREVIEW);
  const known = Math.max(total, rows.length);
  return { shown, total: known, showAll: known > ATTENTION_PREVIEW };
}

/** The rule behind an anomaly code — `anomaly.dead_stock` → `dead_stock`. */
export function anomalyKind(code: string): string {
  return code.startsWith('anomaly.') ? code.slice('anomaly.'.length) : code;
}

/** Whether the next page of the full list is worth asking for. */
export function hasMoreAlerts(page: { page: number; pageSize: number; total: number }): boolean {
  return page.page * page.pageSize < page.total;
}
