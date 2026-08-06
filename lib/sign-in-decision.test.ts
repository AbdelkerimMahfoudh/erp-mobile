/**
 * Regression guard for the sign-in decision (F1 Stage 3.2).
 *
 * Run directly with Node (type-stripping), no test runner or new dependency:
 *   node lib/sign-in-decision.test.ts
 * Exits non-zero on any failure.
 */
import assert from 'node:assert/strict';
import {
  classifyLoginFailure,
  mayDiscardCredentialOnFailure,
  isRetryable,
  type LoginFailureKind,
} from './sign-in-decision.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
};

// The security-critical case: device_unrecognized rides on a 401 but must NOT be
// read as a wrong password, and must map to the blocking verification state.
it('device_unrecognized (even with 401) -> device_verification_required', () => {
  assert.equal(classifyLoginFailure({ code: 'device_unrecognized', status: 401 }), 'device_verification_required');
  assert.equal(classifyLoginFailure({ code: 'device_unrecognized' }), 'device_verification_required');
});

it('a plain 401 with no code -> auth_failed (bad Store ID / login / password)', () => {
  assert.equal(classifyLoginFailure({ status: 401 }), 'auth_failed');
});

it('a network failure -> network (retryable)', () => {
  assert.equal(classifyLoginFailure({ isNetworkError: true }), 'network');
  // device code still wins even if the network flag is somehow set.
  assert.equal(classifyLoginFailure({ code: 'device_unrecognized', isNetworkError: true }), 'device_verification_required');
});

it('a 5xx / unexpected -> unknown', () => {
  assert.equal(classifyLoginFailure({ status: 500 }), 'unknown');
  assert.equal(classifyLoginFailure({}), 'unknown');
});

it('NO failure kind ever permits discarding the credential automatically', () => {
  const kinds: LoginFailureKind[] = ['device_verification_required', 'auth_failed', 'network', 'unknown'];
  for (const k of kinds) assert.equal(mayDiscardCredentialOnFailure(k), false, `${k} must not discard`);
});

it('only a network failure is retryable unchanged', () => {
  assert.equal(isRetryable('network'), true);
  assert.equal(isRetryable('device_verification_required'), false);
  assert.equal(isRetryable('auth_failed'), false);
});

console.log(`\nsign-in-decision: ${passed} checks passed`);
