import { isWriteOnlyRoute } from './registry.ts';

/**
 * Where the sign-in guard sends the person (`useProtectedRoute` in
 * `hooks/useAuth.tsx`): sign-in → branch → the app, or the access refusal.
 *
 * Pure, so every way the splash or a redirect could strand somebody is tested
 * (docs/61 §10): a session that expired, a restore that failed, access refused,
 * a route that needs a branch — each lands on a screen with its own way on,
 * never on a blank page. `null` means stay where you are.
 */
export interface EntryState {
  /** The saved session is still being restored (the splash is showing). */
  bootstrapping: boolean;
  signedIn: boolean;
  branchChosen: boolean;
  /** The server says this business may not use the app (`canRead` false): pending, suspended, cancelled, refused. */
  closed: boolean;
  /** The server says the period and its grace are over (`canWrite` false): every read stays, every business write is refused. */
  readOnly: boolean;
  /** The first segment of the current route: `(auth)`, `(tabs)`, `select-branch`, `stores`, … or undefined at the root. */
  segment: string | undefined;
  /** The whole path (`/sales/pay/0190-ab`), for the write-only screens a read-only business is not offered. */
  pathname: string | undefined;
}

export const LOGIN = '/(auth)/login';
export const SELECT_BRANCH = '/select-branch';
export const ACCESS_CLOSED = '/access-closed';
export const ACCESS_STATUS = '/access';
export const APP_HOME = '/(tabs)';

export function entryRoute(s: EntryState): string | null {
  if (s.bootstrapping) return null;
  const inAuth = s.segment === '(auth)';
  const onSelectBranch = s.segment === 'select-branch';
  const onStateScreen = s.segment === 'access-closed';
  // The person's own account (docs/64): verifying a number and deleting the
  // account are rights the business's access cannot withhold, so the closed
  // screen may lead there and the guard leaves them there.
  const onAccount = s.segment === 'account';

  if (s.closed) return onStateScreen || onAccount ? null : ACCESS_CLOSED;
  // The design-system gallery renders without a session (development only).
  if (s.segment === 'dev') return null;

  if (!s.signedIn && !inAuth) return LOGIN;
  if (s.signedIn && !s.branchChosen && !onSelectBranch && !onStateScreen) return SELECT_BRANCH;
  // The splash at the root, sign-in and the branch choice all move on once there is a session and a branch.
  if (s.signedIn && s.branchChosen && (inAuth || onSelectBranch || s.segment === undefined)) return APP_HOME;
  // A screen whose only purpose is a business write is not opened for a read-only
  // business: the access screen explains, instead of a form that fails at the end.
  if (s.signedIn && s.branchChosen && s.readOnly && s.pathname !== undefined && isWriteOnlyRoute(s.pathname)) return ACCESS_STATUS;
  return null;
}
