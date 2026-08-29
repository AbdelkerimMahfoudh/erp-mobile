/**
 * One way into the subscription portal, and only one.
 *
 *   node lib/account-portal.test.ts
 *
 * The pending screen used to open the account URL directly, with no handoff
 * ticket — so the one screen where somebody actually taps "manage my
 * subscription" was the one place that landed an authenticated Owner on a
 * website password form. The registration flow had done it correctly all along.
 *
 * These pin the shape of the fix rather than the fix itself: one helper, used
 * everywhere, with the security reasoning in a single place. A second
 * implementation is how one path stays secure and the other becomes nearly so.
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

const source = (p: string) => readFileSync(p, 'utf8');
const withoutComments = (t: string): string =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const HOOK = 'hooks/useAccountPortal.ts';
const BLOCKED = 'app/subscription-blocked.tsx';
const PORTAL = 'lib/portal.ts';
const VERIFY = 'app/(auth)/verify.tsx';

// ── The blocked screen goes through the handoff ───────────────────────────

it('the blocked screen obtains a handoff instead of opening a raw URL', () => {
  const code = withoutComments(source(BLOCKED));
  assert.match(code, /useAccountPortal/);
  assert.match(code, /portal\.open\(\)/);

  // The two ways it used to do it, both gone.
  assert.ok(!/accountPortalUrl/.test(code), 'must not build the account URL itself');
  assert.ok(!/Linking\.openURL/.test(code), 'must not open a URL of its own');
  assert.ok(!/expo-linking/.test(source(BLOCKED)), 'no direct linking import remains');
});

it('every portal entry point uses the same helper', () => {
  /*
    `lib/portal.ts` is the implementation and may of course open a URL. Nothing
    else in the app may — a second caller building its own URL is exactly the
    defect this replaces.
  */
  const callers = [BLOCKED, VERIFY];
  for (const f of callers) {
    const code = withoutComments(source(f));
    assert.ok(
      /useAccountPortal|openAccountPortal/.test(code),
      `${f} should reach the portal through the shared path`,
    );
    assert.ok(!/accountPortalUrl\(/.test(code), `${f} must not resolve the URL itself`);
  }
});

it('covers every inactive state, because one control serves them all', () => {
  /*
    pending, suspended, grace, expired and cancelled all land on this screen and
    share one "manage" action, so fixing the action fixes every state at once.
    The copy is chosen from the SERVER's state and never from a date.
  */
  const code = withoutComments(source(BLOCKED));
  assert.match(code, /entitlement\?\.state/);
  assert.match(code, /state === 'suspended' \|\| state === 'cancelled'/);
  assert.match(code, /state === 'pending'/);
  assert.ok(!/Date\.now\(\)|new Date\(/.test(code), 'state must not be inferred from dates');
  // Exactly one place opens the portal on this screen.
  assert.equal(code.match(/portal\.open\(\)/g)?.length, 1);
});

// ── What the helper guarantees ────────────────────────────────────────────

it('guards rapid taps synchronously, not through React state', () => {
  /*
    `if (busy) return; setBusy(true)` reads a value React has not updated yet:
    two taps in one frame both see false and both mint a ticket, one of which is
    abandoned unspent. A ref changes on assignment.
  */
  const code = withoutComments(source(HOOK));
  assert.match(code, /useRef\(false\)/);
  assert.match(code, /if \(inFlight\.current\) return/);
  const guard = code.indexOf('inFlight.current = true');
  const call = code.indexOf('openAccountPortal(');
  assert.ok(guard > -1 && guard < call, 'the guard must be set before the request');
});

it('asks for a fresh ticket every time, and caches nothing', () => {
  const hook = withoutComments(source(HOOK));
  assert.ok(!/useMemo|cache|lastTicket|stored/.test(hook), 'no ticket is remembered');
  const portal = withoutComments(source(PORTAL));
  assert.match(portal, /api\.post<HandoffTicket>\('\/platform\/portal-handoff', \{\}\)/);
});

it('refuses an untrusted origin before minting anything', () => {
  const portal = withoutComments(source(PORTAL));
  const trustCheck = portal.indexOf("return 'untrusted'");
  const mint = portal.indexOf('/platform/portal-handoff');
  assert.ok(trustCheck > -1 && trustCheck < mint, 'trust is decided before a ticket exists');
  assert.match(portal, /u\.protocol === 'http:' \|\| u\.protocol === 'https:'/);
  // The origin comes from build configuration, never from a response.
  assert.match(portal, /\$\{API_V1_URL\}\/platform\/portal-session\?t=/);
  assert.ok(!/response\.|body\.(url|origin|portal)/.test(portal), 'no server-supplied origin');
});

it('puts nothing but the ticket in the URL', () => {
  const portal = withoutComments(source(PORTAL));
  // The template literal itself, not the lines around it — `encodeURIComponent`
  // contains the substring "code", which is exactly the sort of near-miss that
  // makes a security test pass or fail for the wrong reason.
  const line = portal.split('\n').find((l) => l.includes('const target ='))!;
  const url = line.slice(line.indexOf('`'), line.lastIndexOf('`') + 1);
  for (const secret of ['accessToken', 'refreshToken', 'password', 'verificationCode', 'continuation']) {
    assert.ok(!url.includes(secret), `the URL must not carry ${secret}`);
  }
  // Exactly one query parameter, and it is the ticket.
  assert.match(url, /\?t=\$\{encodeURIComponent\(ticket\.token\)\}`$/);
  assert.equal(url.match(/[?&]/g)?.length, 1, 'one parameter, no more');
});

it('a failure keeps the session and says so in the reader language', () => {
  const hook = withoutComments(source(HOOK));
  // Nothing destructive on any path.
  for (const destructive of ['signOut', 'clearTokens', 'deleteItem', 'router', 'replace(']) {
    assert.ok(!hook.includes(destructive), `the helper must not call ${destructive}`);
  }
  // A localized message, from the catalogue.
  assert.match(hook, /t\('register\.portal\.failed'\)/);
  assert.ok(!/setMessage\('[A-Za-z ]{6,}'\)/.test(hook), 'no hardcoded English');

  const portal = withoutComments(source(PORTAL));
  for (const outcome of ['unconfigured', 'untrusted', 'unavailable', 'refused']) {
    assert.ok(portal.includes(`'${outcome}'`), `${outcome} must be reported, not thrown`);
  }
  assert.ok(!/throw /.test(portal), 'the opener never throws at its caller');
});

it('loads no protected operational data', () => {
  const hook = withoutComments(source(HOOK));
  const portal = withoutComments(source(PORTAL));
  for (const route of ['/sales', '/products', '/units', '/inventory', '/expenses']) {
    assert.ok(!hook.includes(route) && !portal.includes(route), `must not call ${route}`);
  }
});

it('needs an authenticated session, and adds no authority of its own', () => {
  /*
    The ticket is minted by an authenticated route and carries only the
    authority the caller already holds — which the server now checks: the
    handoff is gated on `settings.manage`, so a Manager or an Employee is
    refused and this helper reports it as an ordinary failure.
  */
  const portal = withoutComments(source(PORTAL));
  assert.match(portal, /api\.post/);
  assert.ok(!/Authorization:|Bearer /.test(portal), 'the client attaches the session itself');
  assert.ok(!/companyId|userId/.test(portal), 'the caller cannot name whose portal to open');
});

it('creates no payment, grant or activation', () => {
  const both = withoutComments(source(HOOK)) + withoutComments(source(PORTAL));
  for (const forbidden of ['payment', 'activate', 'grant', 'subscribe']) {
    assert.ok(!new RegExp(forbidden, 'i').test(both), `nothing here may ${forbidden}`);
  }
});

console.log(`account portal handoff: ${passed} passed`);
