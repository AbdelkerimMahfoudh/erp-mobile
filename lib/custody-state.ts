/**
 * Where things stand, in facts a shopkeeper can act on — proved without a screen.
 *
 *   node lib/custody-state.test.ts
 *
 * Transfers and consignments both answer "what state is this in?" with a status
 * the server owns. A status alone does not tell somebody at the counter the
 * three things they actually need: **who has the items right now**, **who has
 * to do something next**, and — for a consignment only — **whether the money is
 * confirmed**. This file derives those from the server's status and nothing
 * else, so it never invents a transition and never disagrees with the server.
 *
 * Stock movement and money are kept as separate answers on purpose. "They have
 * the phone" and "we have been paid" are different facts; a single combined
 * label is how a shop ends up believing it was paid because the phone arrived.
 */

// ── Transfers ────────────────────────────────────────────────────────────────

export type TransferStatusLike =
  | 'pending_approval'
  | 'approved'
  | 'in_transit'
  | 'received'
  | 'rejected'
  | 'cancelled';

/** Where the items physically are. */
export type TransferHolder = 'origin' | 'on_the_way' | 'destination';

/** Who must act for the transfer to move on; `none` once it is finished. */
export type TransferNext = 'approve' | 'ship' | 'receive' | 'none';

export interface TransferStanding {
  holder: TransferHolder;
  next: TransferNext;
  /** Finished, one way or the other: nothing more will happen to it. */
  closed: boolean;
}

export function transferStanding(status: TransferStatusLike): TransferStanding {
  switch (status) {
    case 'pending_approval':
      return { holder: 'origin', next: 'approve', closed: false };
    case 'approved':
      return { holder: 'origin', next: 'ship', closed: false };
    case 'in_transit':
      return { holder: 'on_the_way', next: 'receive', closed: false };
    case 'received':
      return { holder: 'destination', next: 'none', closed: true };
    // Refused or cancelled before it left: the stock never moved.
    case 'rejected':
    case 'cancelled':
      return { holder: 'origin', next: 'none', closed: true };
  }
}

// ── Consignments ─────────────────────────────────────────────────────────────

export type ConsignmentStatusLike =
  | 'draft'
  | 'requested'
  | 'counter_proposed'
  | 'disputed'
  | 'accepted_awaiting_custody'
  | 'custody_awaiting_confirmation'
  | 'in_custody'
  | 'sold_awaiting_settlement'
  | 'partially_paid'
  | 'return_initiated'
  | 'return_in_transit'
  | 'settled'
  | 'returned_accepted'
  | 'forgiven_settled'
  | 'cancelled';

export const CONSIGNMENT_STATUSES: readonly ConsignmentStatusLike[] = [
  'draft',
  'requested',
  'counter_proposed',
  'disputed',
  'accepted_awaiting_custody',
  'custody_awaiting_confirmation',
  'in_custody',
  'sold_awaiting_settlement',
  'partially_paid',
  'return_initiated',
  'return_in_transit',
  'settled',
  'returned_accepted',
  'forgiven_settled',
  'cancelled',
];

/**
 * Where the phones are. `sender` is the store that owns them, `holder` the
 * store they were consigned to; the screen turns those into "you" or the other
 * store's name depending on which side is looking.
 */
export type PhonesAt = 'sender' | 'to_holder' | 'holder' | 'sold' | 'to_sender';

/** Which side must act next. `either` only where the lifecycle genuinely allows both. */
export type NextSide = 'sender' | 'holder' | 'either' | 'none';

/**
 * The money, as its own answer.
 *
 * `not_due` — nothing is owed yet, because nothing has sold.
 * `awaiting` — sold, and no payment confirmed.
 * `partly_paid` — some payment confirmed, some still owed.
 * `paid` — settled and confirmed.
 * `written_off` — the sender chose not to collect.
 * `none` — the deal ended without a sale (returned or cancelled).
 */
export type MoneyState = 'not_due' | 'awaiting' | 'partly_paid' | 'paid' | 'written_off' | 'none';

export interface ConsignmentStanding {
  phonesAt: PhonesAt;
  next: NextSide;
  money: MoneyState;
  closed: boolean;
}

export function consignmentStanding(status: ConsignmentStatusLike): ConsignmentStanding {
  switch (status) {
    // Still being agreed. Nobody answers their own offer, and the server works
    // out whose offer is on the table from the status alone — so can we:
    // a request is the sender's offer, a counter-offer the holder's.
    case 'draft':
      return { phonesAt: 'sender', next: 'sender', money: 'not_due', closed: false };
    case 'requested':
      return { phonesAt: 'sender', next: 'holder', money: 'not_due', closed: false };
    case 'counter_proposed':
      return { phonesAt: 'sender', next: 'sender', money: 'not_due', closed: false };
    // A dispute can be answered from either side.
    case 'disputed':
      return { phonesAt: 'sender', next: 'either', money: 'not_due', closed: false };
    case 'accepted_awaiting_custody':
      return { phonesAt: 'sender', next: 'sender', money: 'not_due', closed: false };
    // Only the receiver can say the phones arrived.
    case 'custody_awaiting_confirmation':
      return { phonesAt: 'to_holder', next: 'holder', money: 'not_due', closed: false };
    // Only the holder knows whether it sold, and only the holder starts a return.
    case 'in_custody':
      return { phonesAt: 'holder', next: 'holder', money: 'not_due', closed: false };
    // The holder pays; the sender confirms. Both have something to do.
    case 'sold_awaiting_settlement':
      return { phonesAt: 'sold', next: 'either', money: 'awaiting', closed: false };
    case 'partially_paid':
      return { phonesAt: 'sold', next: 'either', money: 'partly_paid', closed: false };
    case 'return_initiated':
      return { phonesAt: 'holder', next: 'holder', money: 'none', closed: false };
    // Only the owner can accept the phone back.
    case 'return_in_transit':
      return { phonesAt: 'to_sender', next: 'sender', money: 'none', closed: false };
    case 'settled':
      return { phonesAt: 'sold', next: 'none', money: 'paid', closed: true };
    case 'forgiven_settled':
      return { phonesAt: 'sold', next: 'none', money: 'written_off', closed: true };
    case 'returned_accepted':
      return { phonesAt: 'sender', next: 'none', money: 'none', closed: true };
    case 'cancelled':
      return { phonesAt: 'sender', next: 'none', money: 'none', closed: true };
  }
}

/**
 * Whether this side may answer the offer on the table (accept or counter).
 *
 * Mirrors the server's `lastProposalBy`, which is derived from status alone: a
 * request is the sender's offer and a counter-offer is the holder's. Offering
 * those buttons to the side that made the offer only produced a refusal.
 */
export function canAnswerOffer(status: ConsignmentStatusLike, viewer: 'source' | 'destination'): boolean {
  if (status === 'requested') return viewer === 'destination';
  if (status === 'counter_proposed') return viewer === 'source';
  return status === 'disputed';
}

/** A status this build does not know yet reads as unknown, never as a guess. */
export function isKnownConsignmentStatus(status: string): status is ConsignmentStatusLike {
  return (CONSIGNMENT_STATUSES as readonly string[]).includes(status);
}

/** Whether "the next move" is this viewer's, the other store's, or both. */
export function whoseMove(next: NextSide, viewer: 'source' | 'destination'): 'you' | 'them' | 'both' | 'none' {
  if (next === 'none') return 'none';
  if (next === 'either') return 'both';
  const mine = viewer === 'source' ? 'sender' : 'holder';
  return next === mine ? 'you' : 'them';
}
