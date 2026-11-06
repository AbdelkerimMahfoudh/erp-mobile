import type { TranslationKey } from './i18n/keys';

/**
 * A store the Owner adds from the app (0130; the owner's brief of 2026-11-05) — as the server reports it.
 *
 * Only a request: the store is created waiting for activation, and nothing in it can be used or chosen until it is
 * activated outside the app. The app never shows, computes or links to anything about paying for it — the server
 * decides every state, and this module only names them.
 */
export type BranchRequestState = 'pending_activation' | 'proof_under_review' | 'scheduled' | 'active' | 'cancelled' | 'rejected';

export interface BranchRequest {
  id: string;
  name: string;
  address: string | null;
  state: BranchRequestState;
  requestedAt: string;
  /** Once active: the store it became. */
  branchId: string | null;
}

export const BRANCH_NAME_MAX = 160;
export const BRANCH_LOCATION_MAX = 160;

/** The query key of the Owner's waiting stores. */
export const BRANCH_REQUESTS_KEY = ['branch-requests'] as const;

/** The word under a waiting store, in the reader's language. */
export function stateLabelKey(state: BranchRequestState): TranslationKey {
  return `branchRequest.state.${state}` as TranslationKey;
}

/** The longer explanation on the store's own status page. */
export function stateBodyKey(state: BranchRequestState): TranslationKey {
  return `branchRequest.stateBody.${state}` as TranslationKey;
}

/** Still waiting: shown in the list, never selectable. */
export function isWaiting(r: BranchRequest): boolean {
  return r.state === 'pending_activation' || r.state === 'proof_under_review' || r.state === 'scheduled';
}

/** What the form sends: the name trimmed and required, the location trimmed and optional. */
export function cleanBranchInput(name: string, place: string): { name: string; address?: string } | { error: 'name_required' | 'name_too_long' | 'address_too_long' } {
  const n = name.trim().replace(/\s+/g, ' ');
  const l = place.trim().replace(/\s+/g, ' ');
  if (!n) return { error: 'name_required' };
  if (n.length > BRANCH_NAME_MAX) return { error: 'name_too_long' };
  if (l.length > BRANCH_LOCATION_MAX) return { error: 'address_too_long' };
  return l ? { name: n, address: l } : { name: n };
}

/** The setup checklist is offered once per newly active store: this key remembers that it was closed. */
export function checklistDoneKey(branchId: string): string {
  return `branch-setup-done.${branchId}`;
}

/** A store activated from a request, opened explicitly for the first time: its checklist is offered. */
export function offersChecklist(branchId: string, requests: readonly BranchRequest[] | undefined, done: boolean): boolean {
  if (done || !requests) return false;
  return requests.some((r) => r.state === 'active' && r.branchId === branchId);
}
