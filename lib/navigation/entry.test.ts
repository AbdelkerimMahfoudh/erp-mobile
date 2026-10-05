/**
 * The splash and the one redirect never strand anybody (docs/61 §10): whatever
 * the session, the branch, the server's word on access or the route, the sign-in
 * guard settles on a screen with its own way on — within two steps, never in a
 * loop, never on a blank page.
 *
 *   node lib/navigation/entry.test.ts
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACCESS_REFUSED, APP_HOME, LOGIN, SELECT_BRANCH, entryRoute, type EntryState } from './entry.ts';

const state = (over: Partial<EntryState>): EntryState => ({
  bootstrapping: false,
  signedIn: true,
  branchChosen: true,
  closed: false,
  segment: '(tabs)',
  ...over,
});
/** The first segment a target lands on. */
const segmentOf = (target: string): string | undefined => target.split('/').filter(Boolean)[0];

it('the splash waits while the session is restored, then always moves on', () => {
  assert.equal(entryRoute(state({ bootstrapping: true, segment: undefined })), null);
  assert.equal(entryRoute(state({ segment: undefined })), APP_HOME);
  assert.equal(entryRoute(state({ segment: undefined, branchChosen: false })), SELECT_BRANCH);
  assert.equal(entryRoute(state({ segment: undefined, signedIn: false, branchChosen: false })), LOGIN);
  assert.equal(entryRoute(state({ segment: undefined, closed: true })), ACCESS_REFUSED);
});

it('the /stores redirect: its session expired — to sign-in, from the redirect or from where it landed', () => {
  for (const segment of ['stores', '(tabs)']) {
    assert.equal(entryRoute(state({ segment, signedIn: false, branchChosen: false })), LOGIN);
  }
});

it('restoring the session failed (it is cleared): to sign-in; the access check failed (unknown): nobody is shut out', () => {
  assert.equal(entryRoute(state({ segment: undefined, signedIn: false, branchChosen: false })), LOGIN);
  assert.equal(entryRoute(state({ segment: 'stores', closed: false })), null, 'the redirect proceeds to Partners');
});

it('the destination refused: access closed — the refusal screen, from the redirect, the tabs or the splash', () => {
  for (const segment of ['stores', '(tabs)', undefined, 'select-branch']) {
    assert.equal(entryRoute(state({ segment, closed: true })), ACCESS_REFUSED);
  }
  assert.equal(entryRoute(state({ segment: 'subscription-blocked', closed: true })), null, 'and it stays there, with Check again and Sign out');
});

it('no branch yet: the branch choice, from the redirect or anywhere in the app', () => {
  for (const segment of ['stores', '(tabs)', 'closing', undefined]) {
    assert.equal(entryRoute(state({ segment, branchChosen: false })), SELECT_BRANCH);
  }
});

it('the design gallery (development only) is left alone; the platform console is no longer a route of this app', () => {
  assert.equal(entryRoute(state({ segment: 'dev', signedIn: false, branchChosen: false })), null);
  assert.equal(entryRoute(state({ segment: 'platform', signedIn: false, branchChosen: false })), LOGIN, 'an old link to the console lands on sign-in');
});

it('every combination settles within two steps, never back where it started, never in a loop', () => {
  const segments = [undefined, '(auth)', '(tabs)', 'select-branch', 'subscription-blocked', 'stores', 'closing', 'sales'];
  const bools = [false, true];
  let checked = 0;
  for (const segment of segments)
    for (const signedIn of bools)
      for (const branchChosen of bools)
        for (const closed of bools) {
          if (!signedIn && (branchChosen || closed)) continue; // no branch or access without a session
          let s = state({ segment, signedIn, branchChosen, closed });
          const visited = [segment];
          for (let step = 0; step < 3; step += 1) {
            const target = entryRoute(s);
            if (target === null) break;
            const next = segmentOf(target);
            assert.notEqual(next, s.segment, `${JSON.stringify(s)} → ${target} is where it already is`);
            assert.ok(step < 2, `${JSON.stringify(visited)} did not settle`);
            visited.push(next);
            s = { ...s, segment: next };
          }
          // Where it settles is a real screen with a way on: sign-in, the branch choice, the refusal, or the app.
          assert.ok(
            ['(auth)', 'select-branch', 'subscription-blocked', '(tabs)', 'stores', 'closing', 'sales'].includes(String(s.segment)) || s.segment === undefined,
            `${JSON.stringify(visited)} ended on ${s.segment}`,
          );
          if (s.segment === undefined) assert.ok(false, 'nobody is left on the splash');
          checked += 1;
        }
  assert.ok(checked >= 30, `checked ${checked}`);
});

it('the guard uses exactly this decision', () => {
  const src = readFileSync(new URL('../../hooks/useAuth.tsx', import.meta.url), 'utf8');
  assert.match(src, /const target = entryRoute\(\{ bootstrapping, signedIn: Boolean\(user\), branchChosen: Boolean\(branchId\), closed, segment: segments\[0\] \}\);\s*if \(target\) router\.replace\(target as never\);/);
});
