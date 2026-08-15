import type { ReturnDetail } from '../types/api';
import type { StepState } from '../components/ui';

/**
 * The stages of a return, as a workflow rather than an event log.
 *
 * The screen used to render `detail.timeline` — the server's append-only list
 * of things that happened — as a flat column of identical rows. That is a
 * faithful record and a poor answer to the question people actually have,
 * which is "where has this got to, and what has not happened yet". An event log
 * cannot show a step that has not occurred, so the stages still to come were
 * simply invisible.
 *
 * The distinction this exists to protect: **due, reported and confirmed are
 * three different amounts of certainty about the same money.**
 *
 *   refund due   the shop owes it — approved, nothing paid
 *   reported     somebody says they paid it — a claim, not the record
 *   confirmed    the money actually left — the only settled state
 *
 * Only `confirmed` is ever allowed to read as success. A reported payout is
 * `current`, which the timeline renders warning-toned as somebody's unfinished
 * work — never green, because nothing has been agreed yet.
 */

export interface ReturnStageInput {
  status: ReturnDetail['status'];
  custody: ReturnDetail['custody'];
  responsibility: ReturnDetail['responsibility'];
  payout: ReturnDetail['payout'];
}

/** A stage, before translation and formatting. */
export interface ReturnStage {
  key: 'requested' | 'custody' | 'investigation' | 'decision' | 'due' | 'reported' | 'confirmed';
  state: StepState;
  /** The `at` timestamp of the server event that proves this stage, if any. */
  at?: string | null;
  /** Who did it, when the server recorded a name. */
  by?: string | null;
}

/**
 * `rejected` ends the workflow. Nothing is owed, so the money stages are not
 * "pending" — they will never happen, and showing them greyed out would imply
 * the return is still in progress.
 */
export function returnStages(input: ReturnStageInput): ReturnStage[] {
  const { status, custody, payout } = input;

  const decided = status === 'approved_refund_due' || status === 'rejected';
  const rejected = status === 'rejected';
  const approved = status === 'approved_refund_due';
  const reported = payout?.status === 'reported_pending_confirmation';
  const confirmed = payout?.status === 'confirmed';

  const stages: ReturnStage[] = [
    { key: 'requested', state: 'done' },
    {
      key: 'custody',
      /**
       * `customer_holds` is the one stage that blocks approval — the shop
       * cannot refund a phone it has not got back. `retained_hold` and
       * `handed_back` both mean custody was resolved, one way or the other.
       */
      state: custody === 'customer_holds' ? 'current' : 'done',
    },
    {
      key: 'investigation',
      state: decided ? 'done' : custody === 'customer_holds' ? 'pending' : 'current',
    },
    {
      key: 'decision',
      state: rejected ? 'rejected' : approved ? 'done' : 'pending',
    },
  ];

  // A rejected return owes nothing. The money stages do not exist for it.
  if (rejected) return stages;

  stages.push(
    {
      key: 'due',
      // Reached at approval, and it STAYS reached: the liability existed even
      // after it is settled, and the history should still say so.
      state: approved ? 'done' : 'pending',
    },
    {
      key: 'reported',
      /**
       * `current`, not `done`, while it is only a claim — and `current` renders
       * warning-toned. Marking it done would tick it green, which is precisely
       * the "someone paid this" reading that must not appear before an owner or
       * manager has agreed the money left.
       */
      state: confirmed ? 'done' : reported ? 'current' : 'pending',
      at: payout?.reportedAt ?? null,
      by: payout?.reportedBy ?? null,
    },
    {
      key: 'confirmed',
      // The ONLY stage permitted to read as settled, and only once it is.
      state: confirmed ? 'done' : 'pending',
      at: payout?.confirmedAt ?? null,
      by: payout?.confirmedBy ?? null,
    },
  );

  return stages;
}
