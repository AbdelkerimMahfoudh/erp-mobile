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
 * The owner's decision of 2026-10-15 adds the stores and staff seats an Owner
 * may request during a trial: the app prices, sells and activates neither.
 *
 * What a word or a route is, is `scripts/boundary-rules.cjs`'s — the list the
 * bundle audit (`scripts/audit-bundle.js`) holds the shipped bundles to, so the
 * source and what ships are judged alike: words after their spelling is
 * normalized, in each language's own verbs; routes decoded and in any case.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const rules = createRequire(import.meta.url)('../scripts/boundary-rules.cjs');
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
const code = (f: string) => strip(readFileSync(f, 'utf8'));
const relative = (f: string) => f.slice(new URL('.', ROOT).pathname.length);

/** Every `'key': 'value'` of a catalogue, values joined across lines. */
function entries(lang: string): [string, string][] {
  const src = read(`lib/i18n/${lang}.ts`);
  const out: [string, string][] = [];
  const re = /^\s*'([^']+)':\s*((?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\s)+),\s*$/gm;
  for (const m of src.matchAll(re)) out.push([m[1], m[2].replace(/^\s*['"]|['"]\s*$/g, '').replace(/\\(.)/g, '$1')]);
  return out;
}
const LANGS = ['en', 'fr', 'ar'];

/** The only keys that may name the free trial (2026-10-13): the Owner's card, the trial's three state words, its dates. */
const TRIAL_KEY = /^(trialSetup\.|access\.state\.trial_|access\.trial\.)/;

/**
 * The third-party packages the app's source may import — and does. A new one
 * is a decision, not a convenience: a QR encoder, a web view or a browser is
 * exactly what the app must not carry, and it would arrive as an import.
 */
const PACKAGES = [
  '@tanstack/react-query', 'date-fns', 'expo-camera', 'expo-clipboard', 'expo-constants', 'expo-document-picker', 'expo-file-system',
  'expo-haptics', 'expo-image', 'expo-image-picker', 'expo-localization', 'expo-print', 'expo-router', 'expo-secure-store', 'expo-sharing',
  'expo-splash-screen', 'expo-status-bar', 'lucide-react-native', 'react', 'react-native', 'react-native-gesture-handler',
  'react-native-reanimated', 'react-native-safe-area-context', 'react-native-svg', 'zustand',
];
/** The third-party packages a module imports — `@scope/name` or `name`, without the path inside it. */
function packagesOf(source: string): string[] {
  const specs = [...source.matchAll(/^\s*(?:import|export)\s[^;]*?\sfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]|\b(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)/gm)].map((m) => m[1] ?? m[2] ?? m[3]);
  return specs.filter((s) => !/^(\.|\/|@\/)/.test(s)).map((s) => (s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0]));
}

/**
 * The trial's words, exactly as the owner approved them (SPEC §10; "being sent", shared contract C1), in all three
 * languages. A new key in these families, a changed sentence or a missing one fails here first.
 */
const TRIAL_COPY: Record<string, Record<string, string>> = {
  en: {
    'access.state.trial_available': 'Not started',
    'access.state.trial_active': 'Free trial',
    'access.state.trial_expired': 'Free trial ended',
    'access.trial.ends': 'Ends {date}',
    'access.trial.active': 'Free trial: active, ends {date}',
    'access.trial.ended': 'The free trial ended on {date}. You can still read and export everything.',
    'trialSetup.title': 'Your business is eligible for a 7-day free trial',
    'trialSetup.notStarted': 'Your trial has not started yet.',
    'trialSetup.status': 'Trial status: Available',
    'trialSetup.status.label': 'Trial status: Available, not started',
    'trialSetup.duration': 'Duration after activation: {durationDays} days',
    'trialSetup.startsAfterClaim': 'Starts only after you claim it',
    'trialSetup.contact': 'Verified contact: {masked}',
    'trialSetup.delivery.sent': 'We sent the instructions for completing your business setup to your verified contact.',
    'trialSetup.delivery.sending': 'We are sending the instructions for completing your business setup to your verified contact.',
    'trialSetup.delivery.waiting.phone': 'The instructions will be sent automatically once your WhatsApp number is verified.',
    'trialSetup.delivery.waiting.email': 'The instructions will be sent automatically once your email address is verified.',
    'trialSetup.delivery.unavailable': 'Your business is eligible for a 7-day free trial, but setup instructions cannot be sent right now. Your trial has not started. Please contact Dukan ERP support.',
    'trialSetup.delivery.failed': 'The setup instructions could not be sent. Your trial has not started. Please contact Dukan ERP support.',
    'trialSetup.delivery.not_sent': 'The setup instructions have not been sent. Your trial has not started. Please contact Dukan ERP support.',
  },
  fr: {
    'access.state.trial_available': 'Pas encore commencé',
    'access.state.trial_active': 'Essai gratuit',
    'access.state.trial_expired': 'Essai gratuit terminé',
    'access.trial.ends': 'Se termine le {date}',
    'access.trial.active': 'Essai gratuit : actif, se termine le {date}',
    'access.trial.ended': 'L’essai gratuit s’est terminé le {date}. Vous pouvez encore tout consulter et tout exporter.',
    'trialSetup.title': 'Votre commerce peut bénéficier d’un essai gratuit de 7 jours',
    'trialSetup.notStarted': 'Votre essai n’a pas encore commencé.',
    'trialSetup.status': 'Statut de l’essai : disponible',
    'trialSetup.status.label': 'Statut de l’essai : disponible, pas encore commencé',
    'trialSetup.duration': 'Durée après activation : {durationDays} jours',
    'trialSetup.startsAfterClaim': 'Ne commence qu’après votre demande',
    'trialSetup.contact': 'Contact vérifié : {masked}',
    'trialSetup.delivery.sent': 'Nous avons envoyé les instructions pour finaliser la configuration de votre commerce à votre contact vérifié.',
    'trialSetup.delivery.sending': 'Nous envoyons les instructions pour finaliser la configuration de votre commerce à votre contact vérifié.',
    'trialSetup.delivery.waiting.phone': 'Les instructions seront envoyées automatiquement dès que votre numéro WhatsApp sera vérifié.',
    'trialSetup.delivery.waiting.email': 'Les instructions seront envoyées automatiquement dès que votre adresse e-mail sera vérifiée.',
    'trialSetup.delivery.unavailable': 'Votre commerce peut bénéficier d’un essai gratuit de 7 jours, mais les instructions de configuration ne peuvent pas être envoyées pour le moment. Votre essai n’a pas commencé. Veuillez contacter l’assistance Dukan ERP.',
    'trialSetup.delivery.failed': 'Les instructions de configuration n’ont pas pu être envoyées. Votre essai n’a pas commencé. Veuillez contacter l’assistance Dukan ERP.',
    'trialSetup.delivery.not_sent': 'Les instructions de configuration n’ont pas été envoyées. Votre essai n’a pas commencé. Veuillez contacter l’assistance Dukan ERP.',
  },
  ar: {
    'access.state.trial_available': 'لم تبدأ بعد',
    'access.state.trial_active': 'فترة تجريبية مجانية',
    'access.state.trial_expired': 'انتهت الفترة التجريبية المجانية',
    'access.trial.ends': 'تنتهي في {date}',
    'access.trial.active': 'الفترة التجريبية المجانية: نشطة، تنتهي في {date}',
    'access.trial.ended': 'انتهت الفترة التجريبية المجانية في {date}. لا يزال بإمكانك قراءة كل شيء وتصديره.',
    'trialSetup.title': 'نشاطك التجاري مؤهل لفترة تجريبية مجانية مدتها 7 أيام',
    'trialSetup.notStarted': 'لم تبدأ فترتك التجريبية بعد.',
    'trialSetup.status': 'حالة الفترة التجريبية: متاحة',
    'trialSetup.status.label': 'حالة الفترة التجريبية: متاحة، لم تبدأ بعد',
    'trialSetup.duration': 'المدة بعد التفعيل: {durationDays} أيام',
    'trialSetup.startsAfterClaim': 'لا تبدأ إلا بعد أن تطلبها',
    'trialSetup.contact': 'وسيلة الاتصال المُتحقق منها: {masked}',
    'trialSetup.delivery.sent': 'أرسلنا تعليمات إكمال إعداد نشاطك التجاري إلى وسيلة الاتصال التي تم التحقق منها.',
    'trialSetup.delivery.sending': 'نرسل الآن تعليمات إكمال إعداد نشاطك التجاري إلى وسيلة الاتصال التي تم التحقق منها.',
    'trialSetup.delivery.waiting.phone': 'سيتم إرسال التعليمات تلقائيًا بمجرد التحقق من رقم واتساب الخاص بك.',
    'trialSetup.delivery.waiting.email': 'سيتم إرسال التعليمات تلقائيًا بمجرد التحقق من بريدك الإلكتروني.',
    'trialSetup.delivery.unavailable': 'نشاطك التجاري مؤهل لفترة تجريبية مجانية مدتها 7 أيام، لكن لا يمكن إرسال تعليمات الإعداد الآن. لم تبدأ فترتك التجريبية. يرجى التواصل مع دعم Dukan ERP.',
    'trialSetup.delivery.failed': 'تعذّر إرسال تعليمات الإعداد. لم تبدأ فترتك التجريبية. يرجى التواصل مع دعم Dukan ERP.',
    'trialSetup.delivery.not_sent': 'لم تُرسل تعليمات الإعداد. لم تبدأ فترتك التجريبية. يرجى التواصل مع دعم Dukan ERP.',
  },
};

describe('the website’s entry points are gone from the app', () => {
  it('the helper, the hook and the signup link no longer exist', () => {
    for (const f of ['lib/portal.ts', 'hooks/useAccountPortal.ts', 'lib/signup.ts']) {
      assert.equal(existsSync(new URL(f, ROOT)), false, `${f} must not exist`);
    }
  });

  it('no source builds, configures or opens a website address', () => {
    for (const f of SOURCES) {
      const text = code(f);
      for (const banned of ['EXPO_PUBLIC_PORTAL_URL', 'EXPO_PUBLIC_SIGNUP_URL', 'accountPortalUrl', 'signupUrl', 'portal-handoff', 'portal-session', 'openAccountPortal', 'useAccountPortal']) {
        assert.equal(text.includes(banned), false, `${f} must not mention ${banned}`);
      }
      assert.doesNotMatch(text, rules.WEBSITE_ADDRESS, `${f} names a website address`);
      assert.doesNotMatch(text, /SITE_URL|WEBSITE_URL/i, `${f} configures a website`);
    }
  });

  it('the app imports only the third-party packages it is known to use — no QR encoder, web view or browser can arrive unseen', () => {
    const imported = new Map<string, string>();
    for (const f of SOURCES) for (const pkg of packagesOf(code(f))) if (!imported.has(pkg)) imported.set(pkg, relative(f));
    const unknown = [...imported].filter(([pkg]) => !PACKAGES.includes(pkg)).map(([pkg, f]) => `${pkg} (${f})`);
    assert.deepEqual(unknown, [], 'a package outside the allowlist is imported');
    assert.deepEqual([...imported.keys()].sort(), [...PACKAGES].sort(), 'the allowlist names a package the app no longer imports: take it out');
  });

  it('nothing opens a browser: no openURL in any form, no Linking at all, and window.open only for the report’s own page', () => {
    for (const f of SOURCES) {
      const text = code(f);
      // Called, destructured (`const { openURL } = Linking`), on a namespace or a member: every form names it.
      assert.doesNotMatch(text, /openURL/, `${f} opens a link`);
      // The app's deep links are expo-router's; nothing of the app's own needs Linking from React Native or expo-linking.
      assert.doesNotMatch(text, /\bLinking\b|expo-linking/, `${f} reaches for Linking`);
      assert.doesNotMatch(text, /WebView|WebBrowser\.|openBrowserAsync|openAuthSessionAsync|<QRCode\b|<iframe\b/, `${f} draws a QR code or opens a web view or browser`);
    }
    // The one window the app opens is the web build's preview of a report it has just made — a blob, never an address.
    const browser = /\b(?:window|self|globalThis|top|parent|frames)\s*\.\s*open\b|\{[^}]*\bopen\b[^}]*\}\s*=\s*(?:window|self|globalThis)\b/g;
    const opens = SOURCES.flatMap((f) => [...code(f).matchAll(browser)].map(() => relative(f)));
    assert.deepEqual(opens, ['lib/report-pdf.ts']);
    assert.match(code(new URL('lib/report-pdf.ts', ROOT).pathname), /const url = URL\.createObjectURL\(new Blob\(\[report\.html\][^)]*\)\);\s*const tab = window\.open\(url, '_blank'\);/);
  });

  it('the app never asks the server for a price, a payment instruction, a store or a seat, or the platform’s own routes — in any spelling', () => {
    for (const f of SOURCES) {
      const route = rules.normalizePath(code(f));
      for (const [name, pattern] of rules.ROUTES) assert.doesNotMatch(route, pattern, `${f} reaches a ${name}`);
    }
  });

  it('the free trial can only be read here (2026-10-13): no claim, no resend, no link token — in any letter case or spelling', () => {
    for (const f of SOURCES) {
      const text = code(f);
      assert.doesNotMatch(rules.normalizePath(text), rules.TOKEN_MARKER, `${f} carries a setup-link token marker`);
      assert.doesNotMatch(text, /claimTrial/i, `${f} reaches a trial action`);
      // The one trial request there is: a read. Nothing about the trial is ever posted, put, patched or deleted.
      assert.doesNotMatch(text, /api\.(post|put|patch|delete)(?:<[^>]*>)?\(\s*['`][^'`]*trial/i, `${f} writes something about the trial`);
    }
    const reads = SOURCES.flatMap((f) => [...code(f).matchAll(/api\.get(?:<[^>]*>)?\(\s*['`]([^'`]*trial[^'`]*)['`]/gi)].map((m) => m[1]));
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
      [...code(f).matchAll(/api\.(?:get|post|put|patch|delete)(?:<[^>]*>)?\(\s*['`]([^'`]*regist[^'`]*)['`]/gi)].map((m) => m[1]),
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

describe('stores and staff seats (the owner, 2026-10-15)', () => {
  it('the app requests no store or seat, and prices, sells and activates neither: a staff member’s seat is the platform’s word', () => {
    for (const f of SOURCES) assert.doesNotMatch(rules.normalizePath(code(f)), /seat-requests|store-requests|activity-requests|activity-options|my-subscription/i, `${f} reaches a store or seat request`);
    // The team's own writes: a member created pending, a code sent again, an invitation withdrawn, a member edited, a delegation.
    const team = ['app/team.tsx', 'components/team/CreateMemberSheet.tsx', 'components/team/PendingPanel.tsx'].map((f) => strip(read(f))).join('\n');
    const writes = [...team.matchAll(/api\.(post|put|patch|delete)(?:<[^>]*>)?\(\s*([`'][^`']*[`']|\w+)/g)].map((m) => `${m[1]} ${m[2]}`);
    assert.deepEqual([...new Set(writes)].sort(), [
      'delete path', "post '/users'", 'post `/users/${user.id}/cancel-invitation`', 'post `/users/${user.id}/resend-verification`', 'put path', 'patch `/users/${user!.id}`',
    ].sort());
    for (const lang of LANGS) {
      for (const [key, value] of entries(lang)) {
        if (!/^(team\.create\.|team\.pending\.|access\.staff\.)/.test(key)) continue;
        assert.doesNotMatch(rules.normalizeWords(value), rules.ACCESS_PRICE, `${lang} ${key} prices a seat: ${value}`);
        assert.doesNotMatch(value, /\bMRU\b|أوقية|\bpay\b|\bpaid\b|\bpayer\b|\bpaiement\b|ادفع|الدفع|\bbuy\b|\bpurchase\b|\bachet|اشترِ|\bwebsite\b|\bsite\b|موقع|https?:|www\./i, `${lang} ${key}: ${value}`);
      }
    }
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
    for (const lang of LANGS) {
      for (const [key, value] of entries(lang)) {
        if (!/^(access\.|nav\.access|auth\.|register\.|trialSetup\.|sync\.reason\.entitlement_blocked|hub\.business\.desc|more\.group\.account)/.test(key)) continue;
        assert.doesNotMatch(value, forbidden, `${lang} ${key}: ${value}`);
      }
    }
  });

  it('the trial is named only in its own keys — checked in every other key of every catalogue', () => {
    // "essai" alone, never inside "nécessaire" or "essais" (attempts); Arabic without its diacritics.
    const trialWords = rules.words(/\btrial\b|\bessai\b|تجريب|تجرب/i);
    for (const lang of LANGS) {
      const offending = entries(lang)
        .filter(([key, value]) => !TRIAL_KEY.test(key) && trialWords.test(rules.normalizeWords(value)))
        .map(([key, value]) => `${key}: ${value}`);
      assert.deepEqual(offending, [], `${lang} names the trial outside its own keys:\n  ${offending.join('\n  ')}`);
    }
  });

  it('nowhere does the app price its own access, or ask to be paid, renewed or subscribed to', () => {
    // Shop-side money (a sale's amount in MRU, a customer paying by Bankily) is the shop's; what must be absent is OUR price and OUR call to action.
    const ours = /renew(al)?\b|renouvel|تجديد الاشتراك|subscribe|abonnez|اشترك الآن|in-app purchase|achat intégré/i;
    for (const lang of LANGS) {
      const offending = entries(lang)
        .filter(([, value]) => ours.test(value) || rules.ACCESS_PRICE.test(rules.normalizeWords(value)) || rules.PAYMENT_INSTRUCTION.test(rules.normalizeWords(value)))
        .map(([key, value]) => `${key}: ${value}`);
      assert.deepEqual(offending, [], `${lang} prices or sells the app's own access:\n  ${offending.join('\n  ')}`);
    }
  });

  it('no catalogue carries the trial’s actions — a claim, a resend or a send — in any language or spelling', () => {
    for (const lang of LANGS) {
      const offending = entries(lang).flatMap(([key, value]) =>
        rules.TRIAL_ACTIONS.filter(([, pattern]: [string, RegExp]) => pattern.test(rules.normalizeWords(value))).map(([name]: [string]) => `${key} (${name}): ${value}`),
      );
      assert.deepEqual(offending, [], `${lang} carries a trial action:\n  ${offending.join('\n  ')}`);
    }
  });

  it('the trial’s keys say exactly what the owner approved, and exist in all three languages in the same order', () => {
    for (const lang of LANGS) {
      assert.deepEqual(Object.fromEntries(entries(lang).filter(([key]) => TRIAL_KEY.test(key))), TRIAL_COPY[lang], `${lang} trial copy`);
    }
    const en = Object.fromEntries(entries('en'));
    assert.equal(en['access.closed.not_started.title'], 'Access has not started yet');
    assert.equal(en['access.closed.not_started.body'], 'The business owner is finishing the setup. Check again later.');
    const scoped = (lang: string) => entries(lang).map(([key]) => key).filter((key) => TRIAL_KEY.test(key) || /^(access\.closed\.not_started|register\.|auth\.action\.createAccount)/.test(key));
    assert.ok(scoped('en').length > 50);
    for (const lang of ['fr', 'ar']) assert.deepEqual(scoped(lang), scoped('en'), `${lang} differs from English in its trial or sign-up keys`);
  });
});
