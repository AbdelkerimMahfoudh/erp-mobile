/**
 * The App Store boundary of the customer app (docs/21, 2026-10-05; docs/68).
 *
 *   node lib/access-boundary.test.ts
 *
 * Business access is acquired, paid, renewed and administered on a separate
 * website. The customer app only reads the server's business-access state and
 * shows it in neutral words. These keep it that way — in the source and in all
 * three catalogues: no platform console, no website or payment link, no price
 * for the app's own access, no purchase or renewal wording, no payment
 * instruction for us. A shop's OWN payment channels (cash, Bankily, the accounts
 * it configures to receive its customers' money) are the shop's business, not
 * ours, and are deliberately left alone.
 *
 * Two owner decisions of 2026-10-13 amend it, narrowly. A business account is
 * created in the app again — on the app's own `auth/register` routes, never the
 * platform's, and in words that name no price, no payment and no website. And
 * the app may SAY what the server knows about the one 7-day free trial —
 * eligible and not started, running until its end, ended — in its own keys
 * only (`trialSetup.*`, `access.state.trial_*`, `access.trial.*`), while it can
 * DO nothing about it: no claim, no resend or send, no link or token, no
 * website, no QR code, no web view, no browser, no price and no payment
 * instruction. The trial is started on the website alone; resending its
 * instructions happens there, after the Owner signs in, or through support.
 * `scripts/audit-bundle.js` proves the same of what is actually shipped.
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

/** The only keys that may name the free trial (2026-10-13): the Owner's card, the trial's three state words, its dates. */
const TRIAL_KEY = /^(trialSetup\.|access\.state\.trial_|access\.trial\.)/;
/** What the trial's actions would say: a claim or a resend, in any language. None of them may exist anywhere. */
const TRIAL_ACTION =
  /start (my|your|the) (7-day )?(free )?trial|claim (my|your|the) (7-day )?(free )?trial|\b(re)?send (the )?(setup )?instructions|d[ée]marrer (mon|votre|l[’'])\s?essai|\br?envoyer (les |des )?instructions|ابدأ (فترتي|فترتك|الفترة) التجريبية|(إعادة إرسال|أعد إرسال|أرسل) (ال)?تعليمات|إرسال تعليمات الإعداد مرة أخرى/i;

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

  it('the free trial can only be read here (2026-10-13): no claim, no resend, no link token, no website, QR code or browser', () => {
    for (const f of SOURCES) {
      const code = strip(readFileSync(f, 'utf8'));
      assert.doesNotMatch(code, /trial\/claim|trial\/link|claimTrial|trial\/setup\/resend|trial-setup\/resend|setup\/resend/, `${f} reaches a trial action`);
      assert.doesNotMatch(code, /account\/trial(?!-setup)|['"`][#?]t=/, `${f} carries a setup-link token marker`);
      assert.doesNotMatch(code, /tsx-mr\.(com|mr|net|org)|dukan[\w-]*\.(com|mr|net|org|app)|PUBLIC_SITE_ORIGIN|SITE_URL|WEBSITE_URL/i, `${f} names a website address`);
      assert.doesNotMatch(code, /from ['"](react-native-qrcode-svg|react-qr-code|qrcode[\w.-]*|expo-barcode-generator|react-native-webview|expo-web-browser)['"]|<QRCode\b/, `${f} draws a QR code or opens a web view or browser`);
      assert.doesNotMatch(code, /WebBrowser\.|openBrowserAsync|openAuthSessionAsync/, `${f} opens a browser`);
      // The one trial request there is: a read. Nothing about the trial is ever posted, put, patched or deleted.
      assert.doesNotMatch(code, /api\.(post|put|patch|delete)(?:<[^>]*>)?\(\s*['`][^'`]*trial/, `${f} writes something about the trial`);
    }
    const reads = SOURCES.flatMap((f) => [...strip(readFileSync(f, 'utf8')).matchAll(/api\.get(?:<[^>]*>)?\(\s*['`]([^'`]*trial[^'`]*)['`]/g)].map((m) => m[1]));
    assert.deepEqual(reads, ['/account/trial-setup']);
  });

  it('the Owner’s trial card is display only: nothing pressable, linked, sent or counted down', () => {
    const card = strip(read('components/access/TrialSetupCard.tsx'));
    assert.doesNotMatch(card, /\b(Button|IconButton|Pressable|Touchable\w*|Link|FilterChip|Toggle)\b|onPress|onLongPress|href=/);
    assert.doesNotMatch(card, /\bapi\b|api\.post|useMutation|useRouter|router\.|Linking|WebView|useCountdown|Date\.now/);
  });

  it('the platform console is not in the customer app (2026-10-05)', () => {
    for (const f of ['app/platform', 'lib/platform-admin.ts', 'lib/platform-state.ts', 'app/subscription.tsx', 'app/subscription-blocked.tsx']) {
      assert.equal(existsSync(new URL(f, ROOT)), false, `${f} must not exist`);
    }
    assert.doesNotMatch(strip(read('app/(auth)/login.tsx')), /\/platform|auth\.action\.platform/i, 'sign-in offers no console');
  });

  it('a business account is created in the app again (2026-10-13), through the app’s own auth/register routes only', () => {
    for (const f of ['app/(auth)/register.tsx', 'app/(auth)/verify.tsx', 'lib/registration.ts', 'lib/registration-session.ts']) {
      assert.equal(existsSync(new URL(f, ROOT)), true, `${f} must exist`);
    }
    const login = strip(read('app/(auth)/login.tsx'));
    assert.match(login, /title=\{t\('auth\.action\.createAccount'\)\}[\s\S]*?onPress=\{\(\) => router\.push\('\/\(auth\)\/register' as never\)\}/, 'sign-in offers Create a business account, a screen of this app');
    assert.match(login, /auth\.accounts\.managed/, 'and says who creates an employee’s account');
    // The only registration requests anywhere in the app are the three auth/register routes.
    const registration = SOURCES.flatMap((f) =>
      [...strip(readFileSync(f, 'utf8')).matchAll(/api\.(?:get|post|put|patch|delete)(?:<[^>]*>)?\(\s*['`]([^'`]*regist[^'`]*)['`]/g)].map((m) => m[1]),
    );
    assert.deepEqual([...new Set(registration)].sort(), ['/auth/register', '/auth/register/verify/confirm', '/auth/register/verify/start']);
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
  it('no catalogue carries console or subscription-management copy', () => {
    for (const lang of LANGS) {
      const dict = read(`lib/i18n/${lang}.ts`);
      assert.doesNotMatch(dict, /^\s*'(platform|sub|subscription|entitlement)\./m, `${lang} still carries removed copy`);
      for (const removed of ["'sub.manage'", "'auth.signup.unconfigured'", "'auth.signup.unavailable'", "'auth.action.platform'"]) {
        assert.equal(dict.includes(removed), false, `${lang} still has ${removed}`);
      }
      for (const needed of ["'access.managed'", "'access.mistake'", "'access.closed.rejected.body'", "'auth.accounts.managed'", "'auth.action.createAccount'", "'register.unavailable'"]) {
        assert.equal(dict.includes(needed), true, `${lang} lacks ${needed}`);
      }
    }
  });

  it('the access, sign-in, sign-up and trial copy never names a price, a payment, a way to buy or renew, or a website — in any language', () => {
    const forbidden = /\bMRU\b|أوقية|https?:|www\.|\bwebsite\b|\bsite\b|موقع|\brenew|renouvel|تجديد|\bsubscri|\babonne|اشتراك|اشترك|\bbuy\b|\bpurchase\b|\bachet|اشترِ|\bpay\b|\bpaid\b|\bpayer\b|\bpaiement\b|ادفع|الدفع|Bankily|بنكيلي|\bcheckout\b|in-app|App Store|Apple|\blink\b|\blien\b|رابط|\bQR\b|\bclick\b|\bcliquez\b/i;
    // Trial words, outside the trial's own keys.
    const trialWords = /\btrial\b|essai|تجريب/i;
    for (const lang of LANGS) {
      for (const [key, value] of entries(lang)) {
        if (!/^(access\.|nav\.access|auth\.|register\.|trialSetup\.|sync\.reason\.entitlement_blocked|hub\.business\.desc|more\.group\.account)/.test(key)) continue;
        assert.doesNotMatch(value, forbidden, `${lang} ${key}: ${value}`);
        if (!TRIAL_KEY.test(key)) assert.doesNotMatch(value, trialWords, `${lang} ${key} names the trial outside its own keys: ${value}`);
      }
    }
  });

  it('nowhere does the app price its own access, or ask to be paid, renewed or subscribed to', () => {
    // Shop-side money (a sale's amount in MRU, a customer paying by Bankily) is the shop's; what must be absent is OUR price and OUR call to action.
    const ours = /\b(500|100)\s?MRU|per month|\/\s?month|par mois|شهريًا|renew(al)?\b|renouvel|تجديد الاشتراك|subscribe|abonnez|اشترك الآن|pay now|payer maintenant|ادفع الآن|in-app purchase|achat intégré|no payment is required|aucun paiement n.est demandé|لا يلزم أي دفع/i;
    // The free trial is named only in its own keys (2026-10-13).
    const freeTrial = /free trial|essai gratuit|فترة تجريبية|الفترة التجريبية|فترتك التجريبية/i;
    for (const lang of LANGS) {
      const offending = entries(lang)
        .filter(([key, value]) => ours.test(value) || (!TRIAL_KEY.test(key) && freeTrial.test(value)))
        .map(([key, value]) => `${key}: ${value}`);
      assert.deepEqual(offending, [], `${lang} prices or sells the app's own access:\n  ${offending.join('\n  ')}`);
    }
  });

  it('no catalogue carries the trial’s actions — a claim, a resend or a send — in any language', () => {
    for (const lang of LANGS) {
      const offending = entries(lang).filter(([, value]) => TRIAL_ACTION.test(value)).map(([key, value]) => `${key}: ${value}`);
      assert.deepEqual(offending, [], `${lang} carries a trial action:\n  ${offending.join('\n  ')}`);
    }
  });

  it('the trial’s keys say exactly what the owner approved, and exist in all three languages in the same order', () => {
    const en = Object.fromEntries(entries('en'));
    assert.equal(en['trialSetup.title'], 'Your business is eligible for a 7-day free trial');
    assert.equal(en['trialSetup.notStarted'], 'Your trial has not started yet.');
    assert.equal(en['trialSetup.status'], 'Trial status: Available');
    assert.equal(en['trialSetup.status.label'], 'Trial status: Available, not started');
    assert.equal(en['trialSetup.duration'], 'Duration after activation: {durationDays} days');
    assert.equal(en['trialSetup.startsAfterClaim'], 'Starts only after you claim it');
    assert.equal(en['trialSetup.contact'], 'Verified contact: {masked}');
    assert.equal(en['trialSetup.delivery.sent'], 'We sent the instructions for completing your business setup to your verified contact.');
    assert.equal(en['trialSetup.delivery.unavailable'], 'Your business is eligible for a 7-day free trial, but setup instructions cannot be sent right now. Your trial has not started. Please contact Dukan ERP support.');
    assert.equal(en['access.state.trial_available'], 'Not started');
    assert.equal(en['access.state.trial_active'], 'Free trial');
    assert.equal(en['access.state.trial_expired'], 'Free trial ended');
    assert.equal(en['access.closed.not_started.title'], 'Access has not started yet');
    assert.equal(en['access.closed.not_started.body'], 'The business owner is finishing the setup. Check again later.');
    const scoped = (lang: string) => entries(lang).map(([key]) => key).filter((key) => TRIAL_KEY.test(key) || /^(access\.closed\.not_started|register\.|auth\.action\.createAccount)/.test(key));
    assert.ok(scoped('en').length > 50);
    for (const lang of ['fr', 'ar']) assert.deepEqual(scoped(lang), scoped('en'), `${lang} differs from English in its trial or sign-up keys`);
  });
});
