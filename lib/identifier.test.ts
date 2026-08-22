/**
 * The sign-in contract, pinned (CP3).
 *
 *   node lib/identifier.test.ts
 *
 * Two jobs. The small amount of logic the client genuinely owns, and — more
 * importantly — a **drift test** proving the login screen cannot quietly go
 * back to demanding a Store ID. Prose in a decision document cannot fail a
 * build; this can.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { credentialNamespace, looksSubmittable } from './identifier.ts';

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

const source = (p: string) => readFileSync(p, 'utf8');
const withoutComments = (t: string): string =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const LOGIN = 'app/(auth)/login.tsx';
const AUTH = 'hooks/useAuth.tsx';

// ── The client's own small logic ────────────────────────────────────────────

it('the same phone typed two ways is one device', () => {
  // Otherwise a shopkeeper who once typed spaces and once did not would be
  // treated as two devices and re-enrolled for nothing.
  assert.equal(credentialNamespace('4321 0987'), credentialNamespace('43210987'));
  assert.equal(credentialNamespace('+222 4321-0987'), credentialNamespace('22243210987'));
});

it('and a personal ID is case-insensitive for the same reason', () => {
  assert.equal(credentialNamespace('u-r6h5nwry'), credentialNamespace('U-R6H5NWRY'));
});

it('but a phone and a personal ID are never the same device', () => {
  assert.notEqual(credentialNamespace('43210987'), credentialNamespace('U-R6H5NWRY'));
});

it('anything typed is worth asking the server about', () => {
  /*
    Deliberately generous. A client that pre-judged the format would eventually
    refuse a real identifier somebody actually holds, and they would have no
    way to argue with it.
  */
  assert.equal(looksSubmittable('43210987'), true);
  assert.equal(looksSubmittable('U-R6H5NWRY'), true);
  assert.equal(looksSubmittable('something odd'), true);
  assert.equal(looksSubmittable('   '), false);
  assert.equal(looksSubmittable(''), false);
});

// ── The drift test: no going back to a Store ID ─────────────────────────────

it('the login screen has exactly one identifier field', () => {
  const code = withoutComments(source(LOGIN));
  const fields = [...code.matchAll(/<Field\b/g)].length;
  assert.equal(fields, 2, 'exactly two fields: the identifier and the password');
  assert.match(code, /auth\.field\.identifier/);
  assert.match(code, /auth\.field\.password/);
});

it('and no Store ID field, label or hint anywhere on it', () => {
  const code = withoutComments(source(LOGIN));
  for (const banned of ['storeId', 'storeAccountId', 'auth.field.login']) {
    assert.ok(!code.includes(banned), `the login screen must not mention ${banned}`);
  }
});

it('the sign-in call sends an identifier and never a Store ID', () => {
  const code = withoutComments(source(AUTH));
  assert.match(code, /identifier: identifier\.trim\(\)/);
  assert.ok(
    !/storeAccountId/.test(code),
    'the client must not send a Store ID: the server resolves the shop from the credential',
  );
});

it('signIn takes one identifier and a password, nothing else', () => {
  const code = withoutComments(source(AUTH));
  assert.match(code, /signIn: \(identifier: string, password: string\) => Promise<AccountChoice \| null>/);
});

// ── One phone, two shops ────────────────────────────────────────────────────

it('the shop chooser is only ever shown from a server response', () => {
  /*
    Never from a local guess. The server returns the choice only after the
    password has matched, which is the whole reason it is allowed to name
    shops at all — so the screen must have no other way to enter this state.
  */
  const code = withoutComments(source(LOGIN));
  assert.match(code, /const ambiguous = await signIn\(/);
  assert.match(code, /if \(ambiguous\) setChoice\(ambiguous\)/);
  const setters = [...code.matchAll(/setChoice\(([^)]*)\)/g)].map((m) => m[1].trim());
  // Exactly one setter may supply a value; the rest must clear it.
  assert.deepEqual(
    setters.filter((s) => s !== 'null'),
    ['ambiguous'],
    'the chooser must not be raised from anything but the server response',
  );
});

it('choosing a shop re-sends no password and no Store ID', () => {
  const code = withoutComments(source(AUTH));
  const call = code.slice(code.indexOf("'/auth/choose-account'"));
  const body = call.slice(0, call.indexOf('});'));
  assert.match(body, /continuationToken: choice\.continuationToken/);
  assert.ok(!/password/.test(body), 'the continuation token is the authority, not a second password');
  assert.ok(!/storeAccountId|publicStoreId/.test(body), 'no Store ID is sent when picking a shop');
});

it('and the chooser itself asks for no Store ID', () => {
  const code = withoutComments(source(LOGIN));
  const start = code.indexOf('choice ? (');
  const end = code.indexOf(') : (', start);
  assert.ok(start > 0 && end > start, 'the chooser branch should be findable');
  const branch = code.slice(start, end);
  assert.ok(!/<Field\b/.test(branch), 'the chooser offers shops to tap, it does not ask for typing');
  assert.ok(!/storeId|storeAccountId/i.test(branch));
});

// ── No credentials in the bundle ────────────────────────────────────────────

it('no demo store code is shipped as a placeholder', () => {
  /*
    The screen used to ship `F62B8-D1EEB` and `owner` as placeholders — a real
    store code and a real login, visible in the bundle and read straight off the
    running page in a browser. Both are a credential hint and a promise that the
    app is a demo.
  */
  const code = withoutComments(source(LOGIN));
  assert.ok(!/F62B8/.test(code), 'a real store code must not appear in the login screen');
  assert.ok(!/[0-9A-F]{5}-[0-9A-F]{5}/.test(code), 'no store-code-shaped placeholder');
});

it('no login name is prefilled', () => {
  const code = withoutComments(source(LOGIN));
  assert.ok(!/useState\('owner'\)/.test(code), 'the login field must not be prefilled');
  assert.ok(!/placeholder="owner"/.test(code), 'no hardcoded login placeholder');
});

it('and no password is prefilled or defaulted', () => {
  const code = withoutComments(source(LOGIN));
  assert.match(code, /useState\(''\)/, 'fields start empty');
  assert.ok(!/password.*=.*useState\('[^']+'\)/.test(code), 'the password must start empty');
});

it('the field takes a general keyboard, not a phone pad', () => {
  // The same field has to accept an alphanumeric personal ID. A numeric pad
  // would make that impossible to type.
  const code = withoutComments(source(LOGIN));
  assert.match(code, /keyboardType="default"/);
  assert.ok(!/keyboardType="(phone-pad|number-pad|numeric)"/.test(code));
});

it('and carries autofill semantics a password manager understands', () => {
  const code = withoutComments(source(LOGIN));
  assert.match(code, /autoComplete="username"/);
  assert.match(code, /autoComplete="current-password"/);
});

it('every visible string is translated', () => {
  const code = withoutComments(source(LOGIN));
  // No bare text between JSX tags other than expressions.
  const bare = [...code.matchAll(/>\s*([A-Za-z][A-Za-z ,.'!?-]{3,})\s*</g)].map((m) => m[1]);
  assert.deepEqual(bare, [], 'hardcoded copy on the login screen: ' + bare.join(' | '));
});

console.log(`sign-in identifier and login-screen drift: ${passed} passed`);
