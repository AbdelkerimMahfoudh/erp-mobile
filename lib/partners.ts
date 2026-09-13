/**
 * Partners, as rules that can be proved without a screen.
 *
 *   node lib/partners.test.ts
 *
 * Imports nothing, so it runs under bare node.
 */

export type PartnerStatus = 'pending' | 'accepted' | 'rejected' | 'blocked' | 'cancelled' | 'removed';

export interface PartnerRowLike {
  id: string;
  status: PartnerStatus;
  direction: 'outgoing' | 'incoming';
  canDecide: boolean;
}

export interface PartnerSections<T extends PartnerRowLike> {
  /** Requests another store sent us, which this user can answer. First, because they wait on us. */
  received: T[];
  connected: T[];
  /** Requests we sent that are still waiting. */
  sent: T[];
  /** Declined, withdrawn, removed or blocked — kept, because their history is still readable. */
  past: T[];
}

/**
 * Split connections into the four things Partners shows.
 *
 * `received` holds only what the server says THIS user can decide. A pending
 * incoming request the user cannot answer (no `connection.manage`) is still
 * shown, under `past`-free "sent/received" logic below, but never as an action.
 */
export function partnerSections<T extends PartnerRowLike>(rows: T[]): PartnerSections<T> {
  const out: PartnerSections<T> = { received: [], connected: [], sent: [], past: [] };
  for (const r of rows) {
    if (r.status === 'accepted') out.connected.push(r);
    else if (r.status === 'pending' && r.direction === 'incoming') out.received.push(r);
    else if (r.status === 'pending') out.sent.push(r);
    else out.past.push(r);
  }
  return out;
}

/**
 * The tab badge: incoming requests THIS user must act on.
 *
 * Counted from `canDecide`, which the server derives from direction and status,
 * and only when the user may manage connections at all — a badge that asks
 * somebody to do what they are not permitted to do is a badge they learn to
 * ignore.
 */
export function incomingNeedingAction(rows: PartnerRowLike[] | undefined, canManage: boolean): number {
  if (!canManage || !rows) return 0;
  return rows.filter((r) => r.status === 'pending' && r.direction === 'incoming' && r.canDecide).length;
}

/** A store code as people type it: spaces and dashes dropped, upper-cased, 10 characters. */
export function normaliseStoreCode(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase().slice(0, 10);
}

export function isCompleteStoreCode(code: string): boolean {
  return /^[0-9A-Z]{10}$/.test(code);
}

/** Whose move a shared dealing waits for, in the words Partners uses. */
export type Move = 'you' | 'them' | 'both' | 'none';

export function loanMove(waitingOn: 'us' | 'them' | 'both' | 'none'): Move {
  return waitingOn === 'us' ? 'you' : waitingOn;
}
