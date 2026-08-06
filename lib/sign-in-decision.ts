/**
 * Sign-in failure classification (F1 Stage 3.2).
 *
 * Pure and dependency-free ON PURPOSE: the mobile app has no test runner, so the
 * one security-critical branch — "a server `device_unrecognized` must never be
 * silently turned into a fresh enrollment" — is extracted here and verified by
 * `sign-in-decision.test.ts`, which Node runs directly via type-stripping. No
 * new dependency, and TypeScript/lint alone are not treated as proof.
 */

export type LoginFailureKind =
  /** The password was right but the device credential was rejected (fail-closed). */
  | 'device_verification_required'
  /** Store ID / login / password did not authenticate (non-enumerating). */
  | 'auth_failed'
  /** The request never reached the server — safe to retry. */
  | 'network'
  /** Anything else (5xx, unexpected). */
  | 'unknown';

export interface LoginErrorLike {
  /** Server machine code, e.g. `device_unrecognized`. */
  code?: string;
  /** HTTP status, when the request reached the server. */
  status?: number;
  /** True when the request failed before a response (fetch rejected). */
  isNetworkError?: boolean;
}

/**
 * Classify a FAILED `/auth/login` attempt.
 *
 * `device_unrecognized` takes precedence over the 401 status it rides on, so a
 * fail-closed device error is never misread as a wrong password — and the caller
 * renders a blocking verification state instead of retrying.
 */
export function classifyLoginFailure(err: LoginErrorLike): LoginFailureKind {
  if (err.code === 'device_unrecognized') return 'device_verification_required';
  if (err.isNetworkError) return 'network';
  if (err.status === 401) return 'auth_failed';
  return 'unknown';
}

/**
 * Whether the client may automatically DISCARD a stored device credential in
 * response to this failure. **Always false** — Stage 3.2 removes the automatic
 * clear-and-retry bypass entirely. A device the server failed closed is only
 * recovered by a deliberate user action or the future OTP flow, never silently.
 */
export function mayDiscardCredentialOnFailure(_kind: LoginFailureKind): boolean {
  return false;
}

/** Whether this failure is safe to retry unchanged (transient). */
export function isRetryable(kind: LoginFailureKind): boolean {
  return kind === 'network';
}
