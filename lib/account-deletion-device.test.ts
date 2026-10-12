/**
 * A deleted login leaves no device credential on the phone (privacy correction, 2026-10-12).
 *
 * Sign-out keeps the per-login device credential on purpose — it proves "same phone" for the next sign-in. A
 * deletion is different: the login no longer exists, the server has revoked the device, and nothing on the phone
 * should still name the deleted login. Pinned in the source, as the session's own wiring is.
 *
 *   node lib/account-deletion-device.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0;
const it = (name: string, fn: () => void) => {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`FAIL  ${name}`);
    throw e;
  }
};

const auth = readFileSync(new URL('../hooks/useAuth.tsx', import.meta.url), 'utf8');
const screen = readFileSync(new URL('../app/account/delete.tsx', import.meta.url), 'utf8');

it('each session remembers the namespace its device credential is kept under', () => {
  assert.match(auth, /await setItem\(SESSION_NAMESPACE_KEY, namespace\);/);
});

it('a deleted login forgets that credential, the older shop-scoped one, and the remembered namespace', () => {
  const body = auth.slice(auth.indexOf('const forgetDeletedLogin = async'), auth.indexOf('const signOut = async'));
  assert.match(body, /clearCredential\(namespace, IDENTIFIER_SCOPE\)/);
  assert.match(body, /clearCredential\(user\.publicStoreId, user\.login\)/);
  assert.match(body, /deleteItem\(SESSION_NAMESPACE_KEY\)/);
});

it('the deletion screen forgets it as soon as the server reports the deletion complete', () => {
  assert.match(screen, /if \(step === 'done'\) void forgetDeletedLogin\(\);/);
});

it('an ordinary sign-out still keeps it: the next sign-in re-verifies the same phone', () => {
  const signOut = auth.slice(auth.indexOf('const signOut = async'), auth.indexOf('await clearSession();'));
  assert.doesNotMatch(signOut, /clearCredential\(/);
});

console.log(`deleted login, device credential: ${passed} passed`);
