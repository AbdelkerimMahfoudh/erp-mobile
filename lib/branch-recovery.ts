/**
 * What to do when resolving permissions for the active branch fails.
 *
 * A restored session keeps the branch it was last used in. If the user has
 * since been removed from that branch, the server answers 403 — correctly, and
 * every time. Treating that as a generic error leaves the app on a screen whose
 * only control is Retry, which can only 403 again: a dead end with no way back
 * to the branch picker.
 *
 * Kept as a pure function so the decision can be tested without a store, a
 * network layer or a running app — the same reason `sign-in-decision.ts` is
 * separate.
 */

export type BranchLoadOutcome =
  /** The branch is unusable for this user. Drop it and let them pick another. */
  | 'reselect_branch'
  /** Genuinely broken (offline, server fault). Show an error the user can retry. */
  | 'error';

/**
 * 403 means "not your branch" — a stale restored branch, or access revoked
 * while the app was closed. Anything else may succeed on a retry, so it stays
 * an error rather than throwing the user out of a branch that is probably fine.
 *
 * 401 is deliberately NOT handled here: an expired session is the auth layer's
 * problem, and clearing the branch would send the user to a branch picker they
 * are about to be logged out of anyway.
 */
export function classifyPermissionFailure(status: number | undefined): BranchLoadOutcome {
  return status === 403 ? 'reselect_branch' : 'error';
}
