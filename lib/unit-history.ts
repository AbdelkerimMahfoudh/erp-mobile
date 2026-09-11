/**
 * A phone's history, in business language.
 *
 * The server sends language-free facts for every audit entry (see the backend's
 * `unit-timeline.ts`): what the entry was, the status before and after when it
 * recorded them, a stable context code, who did it and where. This decides what
 * each entry MEANS and which words say so. The component only draws.
 *
 * Rules:
 *   - A transition is shown only when the entry recorded it. Nothing is
 *     inferred from the entries around it.
 *   - An entry this cannot describe says "Inventory updated", never its code.
 *   - Repeated identical entries are folded into one expandable row with a
 *     count. Every entry is still there — nothing is merged away or dropped.
 *   - Tone follows meaning: a sale is not a success, a cancellation is not a
 *     failure, and red is kept for a phone marked faulty.
 */

export interface UnitHistoryEvent {
  id?: string;
  at: string;
  entity: string;
  action: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  context?: string | null;
  actor?: { name: string; role: string | null } | null;
  branch?: { name: string } | null;
  fromBranch?: { name: string } | null;
  toBranch?: { name: string } | null;
  // Legacy fields, read only when the facts above are absent (an older server).
  before?: unknown;
  after?: unknown;
}

export type HistoryTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral';
export type HistoryIcon =
  | 'received'
  | 'sold'
  | 'reserved'
  | 'sent'
  | 'arrived'
  | 'undo'
  | 'returned'
  | 'faulty'
  | 'change'
  | 'updated';

export interface DescribedEvent {
  kind: string;
  titleKey: string;
  params: Record<string, string>;
  tone: HistoryTone;
  icon: HistoryIcon;
}

const KNOWN_STATUSES = new Set(['in_stock', 'reserved', 'sold', 'returned', 'faulty', 'in_transit', 'transferred_out']);

function statusFrom(value: unknown): string | null {
  return value && typeof value === 'object' && typeof (value as { status?: unknown }).status === 'string'
    ? (value as { status: string }).status
    : null;
}

/** The status translation key, or null for a value this app does not know. */
export function statusKey(status: string | null | undefined): string | null {
  return status && KNOWN_STATUSES.has(status) ? `status.unit.${status}` : null;
}

export function describeUnitEvent(event: UnitHistoryEvent): DescribedEvent {
  const from = event.fromStatus ?? statusFrom(event.before);
  const to = event.toStatus ?? statusFrom(event.after);
  const context = event.context ?? null;
  const toBranch = event.toBranch?.name ?? null;

  const d = (kind: string, titleKey: string, tone: HistoryTone, icon: HistoryIcon, params: Record<string, string> = {}): DescribedEvent => ({
    kind,
    titleKey,
    params,
    tone,
    icon,
  });

  if (event.entity === 'Unit' && event.action === 'create') {
    return d('received', 'history.event.received', 'success', 'received');
  }

  if (event.entity !== 'Unit' || event.action !== 'status_change' || !to) {
    return d('updated', 'history.event.updated', 'neutral', 'updated');
  }

  // Known flows first — their context says more than the transition does.
  if (context === 'return_intake') return d('returnIntake', 'history.event.returnIntake', 'warning', 'returned');
  if (context === 'return_approved') return d('returnApproved', 'history.event.returnApproved', 'warning', 'faulty');
  if (context === 'return_rejected') return d('returnRejected', 'history.event.returnRejected', 'neutral', 'undo');
  if (context === 'transfer_cancelled') return d('transferCancelled', 'history.event.transferCancelled', 'neutral', 'undo');
  if (context === 'transfer_rejected') return d('transferRejected', 'history.event.transferRejected', 'neutral', 'undo');

  if (to === 'sold') return d('sold', 'history.event.sold', 'info', 'sold');
  if (to === 'reserved') {
    return toBranch
      ? d('reserved', 'history.event.reservedTo', 'warning', 'reserved', { branch: toBranch })
      : d('reserved', 'history.event.reserved', 'warning', 'reserved');
  }
  if (to === 'in_transit') {
    return toBranch
      ? d('sent', 'history.event.sentTo', 'info', 'sent', { branch: toBranch })
      : d('sent', 'history.event.sent', 'info', 'sent');
  }
  if (to === 'in_stock' && from === 'in_transit') {
    return toBranch
      ? d('arrived', 'history.event.arrivedAt', 'success', 'arrived', { branch: toBranch })
      : d('arrived', 'history.event.arrived', 'success', 'arrived');
  }
  if (to === 'faulty') return d('faulty', 'history.event.faulty', 'danger', 'faulty');
  if (to === 'returned') return d('returned', 'history.event.returned', 'warning', 'returned');
  if (to === 'in_stock') return d('backInStock', 'history.event.backInStock', 'success', 'undo');

  // A transition between statuses this app knows, with no more specific meaning.
  const fromKey = statusKey(from);
  const toKey = statusKey(to);
  if (fromKey && toKey) {
    return d('changed', 'history.event.changed', 'neutral', 'change', { from: fromKey, to: toKey });
  }
  if (toKey) return d('changed', 'history.event.changedTo', 'neutral', 'change', { to: toKey });
  return d('updated', 'history.event.updated', 'neutral', 'updated');
}

/** The role translation key, or null. */
export function roleKey(role: string | null | undefined): string | null {
  if (role === 'owner' || role === 'store_manager' || role === 'store_employee') return `team.role.${role}`;
  if (role === 'administrator') return 'history.role.administrator';
  return null;
}

export interface HistoryRun {
  /** The first entry of the run — newest. */
  lead: UnitHistoryEvent;
  described: DescribedEvent;
  /** Every entry in the run, newest first. `entries.length` is the count. */
  entries: UnitHistoryEvent[];
}

export interface HistoryDay {
  /** `today` | `yesterday` | an ISO calendar date `YYYY-MM-DD` (local time). */
  day: string;
  runs: HistoryRun[];
}

function localDay(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** What makes two entries "the same" for folding: meaning, place and person. */
function signature(event: UnitHistoryEvent, described: DescribedEvent): string {
  return JSON.stringify([
    described.titleKey,
    described.params,
    event.fromStatus ?? statusFrom(event.before),
    event.toStatus ?? statusFrom(event.after),
    event.actor?.name ?? null,
    event.branch?.name ?? null,
  ]);
}

/**
 * Newest first, grouped by local calendar day, with consecutive identical
 * entries folded into one run. The sum of every run's entries is the input.
 */
export function groupHistory(events: UnitHistoryEvent[], now: Date = new Date()): HistoryDay[] {
  const sorted = [...events].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const today = localDay(now);
  const yesterday = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));

  const days: HistoryDay[] = [];
  for (const event of sorted) {
    const calendar = localDay(new Date(event.at));
    const day = calendar === today ? 'today' : calendar === yesterday ? 'yesterday' : calendar;
    let bucket = days[days.length - 1];
    if (!bucket || bucket.day !== day) {
      bucket = { day, runs: [] };
      days.push(bucket);
    }
    const described = describeUnitEvent(event);
    const last = bucket.runs[bucket.runs.length - 1];
    if (last && signature(last.lead, last.described) === signature(event, described)) {
      last.entries.push(event);
    } else {
      bucket.runs.push({ lead: event, described, entries: [event] });
    }
  }
  return days;
}

/** Every translation key this module can produce, for the parity test. */
export const HISTORY_KEYS = [
  'history.event.received',
  'history.event.sold',
  'history.event.reserved',
  'history.event.reservedTo',
  'history.event.sent',
  'history.event.sentTo',
  'history.event.arrived',
  'history.event.arrivedAt',
  'history.event.returnIntake',
  'history.event.returnApproved',
  'history.event.returnRejected',
  'history.event.transferCancelled',
  'history.event.transferRejected',
  'history.event.faulty',
  'history.event.returned',
  'history.event.backInStock',
  'history.event.changed',
  'history.event.changedTo',
  'history.event.updated',
  'history.role.administrator',
  'history.today',
  'history.yesterday',
  'history.repeat',
  'history.expand',
  'history.collapse',
  'history.byRole',
  'history.byName',
  'history.system',
  'history.more',
] as const;
