/**
 * Regression guard for stale-branch recovery (G2A-CP4).
 *
 * Run directly with Node (type-stripping), no test runner or new dependency:
 *   node lib/branch-recovery.test.ts
 * Exits non-zero on any failure.
 */
import assert from 'node:assert/strict';
import { classifyPermissionFailure } from './branch-recovery.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
};

// The case that locked users out: a restored session holding a branch the user
// was removed from. Retrying the same branch can only 403 again forever.
it('403 -> send the user back to the branch picker', () => {
  assert.equal(classifyPermissionFailure(403), 'reselect_branch');
});

it('a server fault stays an error, so a good branch is not thrown away', () => {
  assert.equal(classifyPermissionFailure(500), 'error');
  assert.equal(classifyPermissionFailure(502), 'error');
});

it('offline (no status) stays an error and keeps the branch', () => {
  assert.equal(classifyPermissionFailure(undefined), 'error');
});

it('401 is the auth layer’s problem, not the branch’s', () => {
  // Clearing the branch here would push the user at a picker they are about to
  // be logged out of.
  assert.equal(classifyPermissionFailure(401), 'error');
});

it('404 does not discard the branch either', () => {
  assert.equal(classifyPermissionFailure(404), 'error');
});

console.log(`\n${passed} passed`);
