/**
 * The App Store boundary of the customer app (docs/21, 2026-10-05; docs/68).
 *
 *   node lib/access-boundary.test.ts
 *
 * Business access is acquired, paid, renewed and administered on a separate
 * website. The customer app only reads the server's business-access state and
 * shows it in neutral words. These keep it that way — in the source and in all
 * three catalogues: no platform console, no self-registration, no website or
 * payment link, no price for the app's own access, no purchase or renewal
 * wording, no payment instruction for us. A shop's OWN payment channels (cash,
 * Bankily, the accounts it configures to receive its customers' money) are the
 * shop's business, not ours, and are deliberately left alone.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, ROOT), 'utf8');
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.expo' || name === 'dist') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}
const SOURCES = ['app', 'lib', 'hooks', 'components', 'constants'].flatMap((d) => walk(new URL(d, ROOT).pathname.replace(/^\/([A-Za-z]:)/, '$1')));

/** Every `'key': 'value'` of a catalogue, values joined across lines. */
function entries(lang: string): [string, string][] {
  const src = read(`lib/i18n/${lang}.ts`);
  const out: [string, string][] = [];
  const re = /^\s*'([^']+)':\s*((?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\s)+),\s*$/gm;
  for (const m of src.matchAll(re)) out.push([m[1], m[2].replace(/^\s*['"]|['"]\s*$/g, '')]);
  return out;
}
const LANGS = ['en', 'fr', 'ar'];

describe('the website’s entry points are gone from the app', () => {
  it('the helper, the hook and the signup link no longer exist', () => {
    for (const f of ['lib/portal.ts', 'hooks/useAccountPortal.ts', 'lib/signup.ts']) {
      assert.equal(existsSync(new URL(f, ROOT)), false, `${f} must not exist`);
    }
  });

  it('no source builds, configures or opens a website address', () => {
    for (const f of SOURCES) {
      const code = strip(readFileSync(f, 'utf8'));
      for (const banned of ['EXPO_PUBLIC_PORTAL_URL', 'EXPO_PUBLIC_SIGNUP_URL', 'accountPortalUrl', 'signupUrl', 'portal-handoff', 'portal-session', 'openAccountPortal', 'useAccountPortal']) {
        assert.equal(code.includes(banned), false, `${f} must not mention ${banned}`);
      }
      assert.doesNotMatch(code, /from 'expo-linking'|require\('expo-linking'\)/, `${f} must not open links`);
      assert.doesNotMatch(code, /Linking\.openURL|WebView/, `${f} must not open a browser or a web view`);
    }
  });

  it('the app never asks the server for a price, a payment instruction or the platform’s own routes', () => {
    for (const f of SOURCES) {
      const code = strip(readFileSync(f, 'utf8'));
      assert.doesNotMatch(code, /my-subscription|payment-instructions|platform\/quote|\/platform\//, `${f} reaches a commercial or platform route`);
    }
  });

  it('self-registration and the platform console are not in the customer app (2026-10-05)', () => {
    for (const f of ['app/(auth)/register.tsx', 'app/(auth)/verify.tsx', 'lib/registration.ts', 'lib/registration-session.ts', 'app/platform', 'lib/platform-admin.ts', 'lib/platform-state.ts', 'app/subscription.tsx', 'app/subscription-blocked.tsx']) {
      assert.equal(existsSync(new URL(f, ROOT)), false, `${f} must not exist`);
    }
    const login = strip(read('app/(auth)/login.tsx'));
    assert.doesNotMatch(login, /\(auth\)\/register|createAccount|\/platform|auth\.action\.platform/i, 'sign-in offers no account creation and no console');
    assert.match(login, /auth\.accounts\.managed/, 'sign-in says accounts are set up by the organisation');
  });
});

describe('the access screens', () => {
  const closed = strip(read('app/access-closed.tsx'));
  const status = strip(read('app/access.tsx'));

  it('the closed screen names every closed state from the server, and offers check again, sign out and the way out', () => {
    assert.match(closed, /closedReason\(entitlement\?\.state\)/);
    assert.match(closed, /access\.recheck/);
    assert.match(closed, /action\.signOut/);
    assert.match(closed, /account\.delete\.link/);
    assert.match(closed, /access\.managed/);
    assert.doesNotMatch(closed, /http|www\.|MRU|\d{3,}|\bpay|portal|website|renew|subscri/i);
  });

  it('the status screen shows state and dates only — no price, no allowance arithmetic, no action, no clock', () => {
    assert.match(status, /access\.active\.until/);
    assert.match(status, /access\.grace\.body/);
    assert.match(status, /access\.readOnly\.body/);
    assert.match(status, /access\.managed/);
    assert.doesNotMatch(status, /http|www\.|MRU|\bpay|portal|website|renew|subscri|Bankily/i);
    assert.doesNotMatch(status, /subscribedBranchCount|seatLimit|includedSeats|additionalSeats|seatsUsed|daysRemaining|graceHoursRemaining/, 'no billing composition, no countdown computed on the phone');
    assert.doesNotMatch(status, /Date\.now|new Date\(|getTime\(/, 'no date arithmetic on the phone');
  });

  it('the five tabs share the one notice and read the one access decision', () => {
    for (const f of ['app/(tabs)/index.tsx', 'app/(tabs)/partners.tsx', 'app/(tabs)/money-hub.tsx', 'app/(tabs)/inventory.tsx', 'app/(tabs)/more.tsx']) {
      assert.match(strip(read(f)), /<AccessNotice/, `${f} shows the shared notice`);
    }
    for (const f of ['app/(tabs)/index.tsx', 'app/(tabs)/partners.tsx', 'app/(tabs)/money-hub.tsx', 'app/(tabs)/inventory.tsx', 'app/closing/index.tsx']) {
      assert.match(strip(read(f)), /access\.canWrite/, `${f} offers its business writes only while the server accepts them`);
    }
    // A refused write names the access, never a role.
    assert.match(strip(read('lib/errors.ts')), /ENTITLEMENT_WRITE_BLOCKED[\s\S]*access\.blocked\.title/);
  });
});

describe('the words', () => {
  it('no catalogue carries registration, console or subscription-management copy', () => {
    for (const lang of LANGS) {
      const dict = read(`lib/i18n/${lang}.ts`);
      assert.doesNotMatch(dict, /^\s*'(register|platform|sub|subscription|entitlement)\./m, `${lang} still carries removed copy`);
      for (const removed of ["'sub.manage'", "'auth.signup.unconfigured'", "'auth.signup.unavailable'", "'auth.action.createAccount'", "'auth.action.platform'"]) {
        assert.equal(dict.includes(removed), false, `${lang} still has ${removed}`);
      }
      for (const needed of ["'access.managed'", "'access.mistake'", "'access.closed.rejected.body'", "'auth.accounts.managed'"]) {
        assert.equal(dict.includes(needed), true, `${lang} lacks ${needed}`);
      }
    }
  });

  it('the access and sign-in copy never names a price, a payment, a way to buy or renew, or a website — in any language', () => {
    const forbidden = /\bMRU\b|أوقية|https?:|www\.|\bwebsite\b|\bsite\b|موقع|\brenew|renouvel|تجديد|\bsubscri|\babonne|اشتراك|اشترك|\bbuy\b|\bpurchase\b|\bachet|اشترِ|\bpay\b|\bpaid\b|\bpayer\b|\bpaiement\b|ادفع|الدفع|Bankily|بنكيلي|\btrial\b|essai|تجريب|\bcheckout\b|in-app|App Store|Apple/i;
    for (const lang of LANGS) {
      for (const [key, value] of entries(lang)) {
        if (!/^(access\.|nav\.access|auth\.|sync\.reason\.entitlement_blocked|hub\.business\.desc|more\.group\.account)/.test(key)) continue;
        assert.doesNotMatch(value, forbidden, `${lang} ${key}: ${value}`);
      }
    }
  });

  it('nowhere does the app price its own access, or ask to be paid, renewed or subscribed to', () => {
    // Shop-side money (a sale's amount in MRU, a customer paying by Bankily) is the shop's; what must be absent is OUR price and OUR call to action.
    const ours = /\b(500|100)\s?MRU|per month|\/\s?month|par mois|شهريًا|renew(al)?\b|renouvel|تجديد الاشتراك|subscribe|abonnez|اشترك الآن|pay now|payer maintenant|ادفع الآن|free trial|essai gratuit|فترة تجريبية|in-app purchase|achat intégré/i;
    for (const lang of LANGS) {
      const offending = entries(lang).filter(([, value]) => ours.test(value)).map(([key, value]) => `${key}: ${value}`);
      assert.deepEqual(offending, [], `${lang} prices or sells the app's own access:\n  ${offending.join('\n  ')}`);
    }
  });
});
