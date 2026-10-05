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
import { ACCESS_CLOSED, ACCESS_STATUS, APP_HOME, LOGIN, SELECT_BRANCH, entryRoute, type EntryState } from './entry.ts';

const state = (over: Partial<EntryState>): EntryState => ({
  bootstrapping: false,
  signedIn: true,
  branchChosen: true,
  closed: false,
  readOnly: false,
  segment: '(tabs)',
  pathname: undefined,
  ...over,
});
/** The first segment a target lands on. */
const segmentOf = (target: string): string | undefined => target.split('/').filter(Boolean)[0];

it('the splash waits while the session is restored, then always moves on', () => {
  assert.equal(entryRoute(state({ bootstrapping: true, segment: undefined })), null);
  assert.equal(entryRoute(state({ segment: undefined })), APP_HOME);
  assert.equal(entryRoute(state({ segment: undefined, branchChosen: false })), SELECT_BRANCH);
  assert.equal(entryRoute(state({ segment: undefined, signedIn: false, branchChosen: false })), LOGIN);
  assert.equal(entryRoute(state({ segment: undefined, closed: true })), ACCESS_CLOSED);
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

it('the business closed (pending, suspended, cancelled, refused): the access screen, from the redirect, the tabs or the splash', () => {
  for (const segment of ['stores', '(tabs)', undefined, 'select-branch']) {
    assert.equal(entryRoute(state({ segment, closed: true })), ACCESS_CLOSED);
  }
  assert.equal(entryRoute(state({ segment: 'access-closed', closed: true })), null, 'and it stays there, with Check again and Sign out');
  assert.equal(entryRoute(state({ segment: 'account', closed: true })), null, 'the person’s own account stays reachable');
});

it('a read-only business (the period and its grace are over) keeps every read and is sent off a screen that only writes', () => {
  for (const pathname of ['/quick-sell', '/sell', '/receive', '/receive/file', '/expenses/new', '/sales/pay/0190-ab', '/catalog/edit', '/pricing/unit']) {
    assert.equal(entryRoute(state({ readOnly: true, segment: pathname.split('/')[1], pathname })), ACCESS_STATUS, pathname);
  }
  for (const pathname of ['/', '/sales', '/sales/0190-ab', '/expenses', '/money', '/team', '/settings', '/account/delete', '/access', '/closing', '/devices']) {
    assert.equal(entryRoute(state({ readOnly: true, segment: pathname.split('/')[1] || '(tabs)', pathname })), null, pathname);
  }
  // Not read-only: the same screens open as ever.
  assert.equal(entryRoute(state({ readOnly: false, segment: 'quick-sell', pathname: '/quick-sell' })), null);
  // Closed outranks read-only, and a branch comes before any screen.
  assert.equal(entryRoute(state({ readOnly: true, closed: true, segment: 'quick-sell', pathname: '/quick-sell' })), ACCESS_CLOSED);
  assert.equal(entryRoute(state({ readOnly: true, branchChosen: false, segment: 'quick-sell', pathname: '/quick-sell' })), SELECT_BRANCH);
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
  const segments = [undefined, '(auth)', '(tabs)', 'select-branch', 'access-closed', 'stores', 'closing', 'sales', 'quick-sell'];
  const bools = [false, true];
  let checked = 0;
  for (const segment of segments)
    for (const signedIn of bools)
      for (const branchChosen of bools)
        for (const closed of bools)
          for (const readOnly of bools) {
          if (!signedIn && (branchChosen || closed || readOnly)) continue; // no branch or access without a session
          if (closed && readOnly) continue; // the server says one or the other
          let s = state({ segment, signedIn, branchChosen, closed, readOnly, pathname: segment && !segment.startsWith('(') ? `/${segment}` : undefined });
          const visited = [segment];
          for (let step = 0; step < 3; step += 1) {
            const target = entryRoute(s);
            if (target === null) break;
            const next = segmentOf(target);
            assert.notEqual(next, s.segment, `${JSON.stringify(s)} → ${target} is where it already is`);
            assert.ok(step < 2, `${JSON.stringify(visited)} did not settle`);
            visited.push(next);
            s = { ...s, segment: next, pathname: next && !next.startsWith('(') ? `/${next}` : undefined };
          }
          // Where it settles is a real screen with a way on: sign-in, the branch choice, the access screens, or the app.
          assert.ok(
            ['(auth)', 'select-branch', 'access-closed', 'access', '(tabs)', 'stores', 'closing', 'sales', 'quick-sell'].includes(String(s.segment)) || s.segment === undefined,
            `${JSON.stringify(visited)} ended on ${s.segment}`,
          );
          if (s.segment === undefined) assert.ok(false, 'nobody is left on the splash');
          checked += 1;
        }
  assert.ok(checked >= 30, `checked ${checked}`);
});

it('the guard uses exactly this decision', () => {
  const src = readFileSync(new URL('../../hooks/useAuth.tsx', import.meta.url), 'utf8');
  assert.match(src, /const target = entryRoute\(\{ bootstrapping, signedIn: Boolean\(user\), branchChosen: Boolean\(branchId\), closed, readOnly, segment: segments\[0\], pathname \}\);\s*if \(target\) router\.replace\(target as never\);/);
  assert.match(src, /const readOnly = Boolean\(user\) && entitlement\.data !== undefined && entitlement\.data\.canRead && !entitlement\.data\.canWrite;/);
});
