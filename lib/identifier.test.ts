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

it('and an email is case-insensitive for the same reason', () => {
  // Matches the server, where the column is ai_ci and the two are one row.
  assert.equal(credentialNamespace('Owner@Shop.MR'), credentialNamespace('owner@shop.mr'));
});

it('and a personal ID is case-insensitive for the same reason', () => {
  assert.equal(credentialNamespace('u-r6h5nwry'), credentialNamespace('U-R6H5NWRY'));
});

it('but an email, a phone and a personal ID are never the same device', () => {
  const ns = [
    credentialNamespace('owner@shop.mr'),
    credentialNamespace('43210987'),
    credentialNamespace('U-R6H5NWRY'),
  ];
  assert.equal(new Set(ns).size, 3, 'three different identifiers, three device namespaces');
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

it('and nothing else the ordinary sign-in must never ask for (CP1)', () => {
  /*
    The binding list. A Store ID, a branch, a company, a generated personal ID
    and a username are each things somebody would have to be TOLD rather than
    already know — which is the whole reason the field is a contact now.
  */
  const code = withoutComments(source(LOGIN))
    // `autoComplete="username"` / `textContentType="username"` are autofill
    // SEMANTICS — they tell a password manager which saved credential fits a
    // field that already exists. They are required, and are not a username
    // field, so they are removed before the check rather than exempted by a
    // looser pattern that would also miss a real one.
    .replace(/(autoComplete|textContentType)="[^"]*"/g, '');

  for (const banned of ['personalId', 'personal_id', 'branchId', 'companyId', 'username']) {
    assert.ok(!code.includes(banned), `the login screen must not ask for ${banned}`);
  }
});

it('but it does carry autofill semantics a password manager understands', () => {
  const code = withoutComments(source(LOGIN));
  assert.match(code, /autoComplete="username"/);
  assert.match(code, /autoComplete="current-password"/);
});

it('the field is labelled for an email or a WhatsApp number', () => {
  const code = withoutComments(source(LOGIN));
  assert.match(code, /auth\.field\.identifier/);
  // Both must be offered by one field — never two fields, never a chooser.
  const en = readFileSync('lib/i18n/en.ts', 'utf8');
  const label = en.match(/'auth\.field\.identifier':\s*'([^']+)'/)?.[1] ?? '';
  assert.match(label, /email/i, 'the label must say email');
  assert.match(label, /whatsapp/i, 'the label must say WhatsApp');
});

it('the helper copy exists in all three languages and mentions both', () => {
  for (const [file, words] of [
    ['lib/i18n/en.ts', [/email/i, /whatsapp/i]],
    ['lib/i18n/ar.ts', [/بريد/, /واتساب/]],
    ['lib/i18n/fr.ts', [/mail/i, /whatsapp/i]],
  ] as [string, RegExp[]][]) {
    const hint = readFileSync(file, 'utf8').match(
      /'auth\.field\.identifier\.hint':\s*'([^']+)'/,
    )?.[1];
    assert.ok(hint, `${file} must carry the identifier hint`);
    for (const w of words) assert.match(hint!, w, `${file} hint must mention ${w}`);
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



// ── Create account (Phase 2) ────────────────────────────────────────────────

it('the login screen offers a way to create an account', () => {
  /*
    Somebody whose shop has no account had nowhere to go from this screen at
    all, and the answer to "how do I get one" should not be a phone call.
  */
  const code = withoutComments(source(LOGIN));
  assert.match(code, /auth\.action\.createAccount/);
});

it('and that way is a SCREEN in this app, never a browser', () => {
  /*
    Account creation moved into the app. Setting a shop up means scanning
    stock, scanning happens here, and sending somebody to a browser to type the
    longest form in the product — on the surface with the worst keyboard —
    before doing the real work somewhere else was never the shorter path.
  */
  const code = withoutComments(source(LOGIN));
  assert.match(code, /router\.push\('\/\(auth\)\/register'/);
  assert.ok(!code.includes('openSignup'), 'the login screen must not open a browser to register');
  assert.ok(!/Linking\./.test(code), 'and must not reach for Linking either');
});

it('registration asks for nothing the server generates', () => {
  const code = withoutComments(source('app/(auth)/register.tsx'));
  for (const banned of ['storeId', 'StoreId', 'nationalId', 'personalId', 'companyId', 'branchId', 'roleId']) {
    assert.ok(!code.includes(banned), `registration must never ask for ${banned}`);
  }
});

it('one idempotency key per attempt, reused across retries', () => {
  /*
    A dropped response on a bad connection is the ordinary case in a Nouakchott
    shop. Without a stable key the anxious second tap creates a second business
    with the same name and no way to tell which one is yours.
  */
  const code = withoutComments(source('app/(auth)/register.tsx'));
  assert.match(code, /const idempotencyKey = useRef\(uuidv4\(\)\)/);
  assert.match(code, /idempotencyKey\.current/);
});

it('and against the impatient second tap, synchronously', () => {
  // A ref, not state: two taps can both land before React re-renders.
  const code = withoutComments(source('app/(auth)/register.tsx'));
  assert.match(code, /const inFlight = useRef\(false\)/);
  assert.match(code, /if \(inFlight\.current\) return;/);
});

it('the password is cleared and never replayed for a session', () => {
  const reg = withoutComments(source('app/(auth)/register.tsx'));
  assert.match(reg, /password: '', passwordConfirm: ''/);

  const verify = withoutComments(source('app/(auth)/verify.tsx'));
  assert.ok(!verify.includes('password'), 'verification must not touch the password at all');
});

it('the continuation lives only in secure storage', () => {
  const store = withoutComments(source('lib/registration-session.ts'));
  // `lib/storage.ts` is the SecureStore wrapper; AsyncStorage is not.
  assert.match(store, /from '\.\/storage'/);
  assert.ok(!store.includes('AsyncStorage'), 'a credential does not belong in AsyncStorage');
  // And it is removed rather than left lying about.
  assert.match(store, /export async function forgetContinuation/);
});

it('the portal URL carries the one-time ticket and nothing else', () => {
  const portal = withoutComments(source('lib/portal.ts'));
  assert.match(portal, /portal-session\?t=/);
  for (const banned of ['accessToken', 'refreshToken', 'password', 'code=']) {
    assert.ok(!portal.includes(banned), `the portal URL must not carry ${banned}`);
  }
});

it('a fresh ticket every time — a spent or uncertain one is never reused', () => {
  const portal = withoutComments(source('lib/portal.ts'));
  assert.match(portal, /api\.post<HandoffTicket>\('\/platform\/portal-handoff'/);
  assert.ok(!/cache|stored ticket|savedTicket/i.test(portal));
});

it('a browser that will not open never costs the account', () => {
  /*
    By the time the portal is opened the account exists and the session is
    installed. A refused browser must leave both alone — restarting a
    registration because a browser would not launch is the one unforgivable
    outcome here.
  */
  const verify = withoutComments(source('app/(auth)/verify.tsx'));
  // Call sites, not imports: the import of one naturally precedes the other.
  const opened = verify.indexOf('await adoptSession(');
  const portal = verify.indexOf('await openAccountPortal(');
  assert.ok(opened > -1 && portal > opened, 'the session must be installed BEFORE the browser is tried');
  assert.ok(!/clearSession|signOut/.test(verify), 'no failure path may delete a valid session');
});

it('the portal URL is configured, never hardcoded to a real domain', () => {
  const config = withoutComments(source('constants/config.ts'));
  assert.match(config, /EXPO_PUBLIC_PORTAL_URL/);
  // No production domain baked into the bundle.
  assert.ok(
    !/https?:\/\/[a-z0-9-]+\.(com|mr|net|org)/i.test(config),
    'no real domain may be hardcoded in the app config',
  );
});

it('only http(s) is ever opened', () => {
  const portal = withoutComments(source('lib/portal.ts'));
  assert.match(portal, /protocol === 'http:' \|\| u\.protocol === 'https:'/);
});

it('the blocked screen never decides the state itself', () => {
  /*
    Every word comes from the SERVER's state. A client that derives its own
    entitlement from a date can be made to derive it wrongly, and a shopkeeper
    told the wrong reason makes the wrong phone call.
  */
  const code = withoutComments(source('app/subscription-blocked.tsx'));
  assert.match(code, /entitlement\?\.state/);
  // No date arithmetic anywhere on this screen.
  assert.ok(!/Date\.now\(\)|getTime\(\)/.test(code), 'the screen must not compute a state from dates');
});

it('and always offers a way forward', () => {
  const code = withoutComments(source('app/subscription-blocked.tsx'));
  assert.match(code, /sub\.recheck/);
  assert.match(code, /sub\.manage/);
  // Re-checking must let a newly activated shop straight in.
  assert.match(code, /router\.replace\('\/'\)/);
});

it('no new screen mentions a Store ID or a personal ID', () => {
  for (const f of ['app/(auth)/login.tsx', 'app/subscription-blocked.tsx', 'lib/signup.ts']) {
    const code = withoutComments(source(f));
    for (const banned of ['storeId', 'storeAccountId', 'personalId', 'personal_id']) {
      assert.ok(!code.includes(banned), `${f} must not mention ${banned}`);
    }
  }
});

console.log(`sign-in identifier and login-screen drift: ${passed} passed`);

it('a staging build is labelled, and the label costs a production build nothing', () => {
  /*
    A staging build looks exactly like a production one. The only thing between
    a test IMEI and a real ledger is knowing which build is in your hand, so the
    label is mounted at the app ROOT rather than on screens somebody has to
    remember — and it renders nothing when the flag is unset, so the shopkeeper
    never sees a pixel of it.
  */
  const config = withoutComments(source('constants/config.ts'));
  assert.match(config, /EXPO_PUBLIC_APP_ENV/);
  assert.match(config, /isStagingBuild/);

  const banner = withoutComments(source('components/ui/StagingBanner.tsx'));
  assert.match(banner, /if \(!isStagingBuild\(\)\) return null;/);

  const layout = withoutComments(source('app/_layout.tsx'));
  assert.match(layout, /<StagingBanner \/>/);
});

it('no server secret can reach the bundle through the app config', () => {
  /*
    Everything `EXPO_PUBLIC_` is INLINED into the JavaScript and readable by
    anybody holding the app. That makes the config module the exact place a
    database URL or an administrator password would get published by accident,
    so the names are checked here rather than trusted to review.
  */
  const config = source('constants/config.ts');
  for (const banned of [
    'DATABASE_URL',
    'JWT_SECRET',
    'SESSION_SECRET',
    'ADMIN_PASSWORD',
    'MYSQL_',
    'PRIVATE_KEY',
  ]) {
    assert.ok(!config.includes(banned), `${banned} must never appear in a bundled module`);
  }
});
