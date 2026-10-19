/**
 * The rules for creating a business account on the phone (restored 2026-10-13; the WhatsApp number required since
 * the owner's brief of 2026-10-18, an email address optional).
 *
 * Run directly with Node (type-stripping):
 *   node lib/registration.test.ts
 * Exits non-zero on any failure.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  emptyRegistration,
  registrationPayload,
  sameRegistration,
  validateRegistration,
  type RegistrationDraft,
} from './registration.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log('  ok  ' + name);
};

const code = (p: string) =>
  readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/.*$/gm, '');

const base: RegistrationDraft = {
  ...emptyRegistration,
  ownerName: 'Aicha',
  businessName: 'Nour Electronics',
  branchName: 'Main Store',
  password: 'correct horse',
  passwordConfirm: 'correct horse',
  // Ticked by the person — the rules about the consent itself are below.
  whatsappConsent: true,
};

const withEmail = { ...base, email: 'aicha@example.invalid' };
const withPhone = { ...base, phone: '+22212345678' };

// ── contacts: the WhatsApp number required, an email address optional ─────────

it('the WhatsApp number alone is accepted', () => {
  assert.deepEqual(validateRegistration(withPhone), {});
});

it('the WhatsApp number with an email address is accepted', () => {
  assert.deepEqual(validateRegistration({ ...withPhone, email: 'aicha@example.invalid' }), {});
});

it('an email address without the WhatsApp number is refused: the number is the contact the account is checked by', () => {
  assert.deepEqual(validateRegistration(withEmail), { phone: 'register.problem.phoneRequired' });
});

it('no contact at all is refused on the WhatsApp number, by its own words', () => {
  assert.equal(validateRegistration(base).phone, 'register.problem.phoneRequired');
});

it('a malformed email is refused', () => {
  assert.equal(validateRegistration({ ...base, email: 'aicha@' }).email, 'register.problem.email');
});

it('a malformed number is refused', () => {
  assert.equal(validateRegistration({ ...base, phone: 'call me' }).phone, 'register.problem.phone');
});

// ── the other required fields ────────────────────────────────────────────────

it('owner name, business name and branch name are all required', () => {
  const problems = validateRegistration({ ...emptyRegistration, email: 'a@b.co' });
  assert.equal(problems.ownerName, 'register.problem.ownerName');
  assert.equal(problems.businessName, 'register.problem.businessName');
  assert.equal(problems.branchName, 'register.problem.branchName');
});

it('city stays optional', () => {
  assert.deepEqual(validateRegistration({ ...withPhone, city: '' }), {});
});

it('a short password is refused', () => {
  assert.equal(
    validateRegistration({ ...withPhone, password: 'short', passwordConfirm: 'short' }).password,
    'register.problem.password',
  );
});

it('a mismatched confirmation is refused', () => {
  assert.equal(
    validateRegistration({ ...withPhone, passwordConfirm: 'something else' }).passwordConfirm,
    'register.problem.passwordConfirm',
  );
});

it('both password problems are reported at once, not one after the other', () => {
  const problems = validateRegistration({ ...withPhone, password: 'abc', passwordConfirm: 'xyz' });
  assert.equal(problems.password, 'register.problem.password');
  assert.equal(problems.passwordConfirm, 'register.problem.passwordConfirm');
});

// ── what is never asked for ──────────────────────────────────────────────────

it('the draft has no field for a Store ID, a personal ID or any internal id', () => {
  // Structural, not a lint rule: there is nowhere to put one.
  assert.deepEqual(Object.keys(emptyRegistration).sort(), [
    'branchName',
    'businessName',
    'city',
    'email',
    'ownerName',
    'password',
    'passwordConfirm',
    'phone',
    'whatsappConsent',
  ]);
});

it('the payload sends no identifier the server did not generate', () => {
  const body = registrationPayload({ ...withPhone, email: 'aicha@example.invalid' }, 'key-1', 'en');
  for (const forbidden of ['storeId', 'companyId', 'branchId', 'userId', 'roleId', 'nationalId']) {
    assert.ok(!(forbidden in body), 'payload must not contain ' + forbidden);
  }
});

// ── the payload ──────────────────────────────────────────────────────────────

it('the WhatsApp number is always sent; optional fields are omitted rather than sent empty', () => {
  const body = registrationPayload(withPhone, 'key-1', 'en');
  assert.equal(body.phone, '+22212345678');
  assert.ok(!('email' in body), 'an unfilled email address is absent, not an empty string');
  assert.ok(!('city' in body));
  assert.equal(body.language, 'en');
  assert.equal(body.idempotencyKey, 'key-1');
  assert.equal(registrationPayload({ ...withPhone, email: ' aicha@example.invalid ' }, 'key-1', 'en').email, 'aicha@example.invalid');
});

it('values are trimmed, so a stray space cannot create a second business', () => {
  const body = registrationPayload({ ...withPhone, businessName: '  Nour  ' }, 'k', 'fr');
  assert.equal(body.businessName, 'Nour');
});

it('the same key is reused on retry — that is what makes it idempotent', () => {
  const a = registrationPayload(withEmail, 'stable-key', 'ar');
  const b = registrationPayload(withEmail, 'stable-key', 'ar');
  assert.deepEqual(a, b);
});

// ── one key per attempt (review R5-7) ────────────────────────────────────────

it('a retry of the same registration is the same attempt — stray spaces and the confirmation field included', () => {
  assert.equal(sameRegistration(withEmail, { ...withEmail }), true);
  assert.equal(sameRegistration(withEmail, { ...withEmail, businessName: ' Nour Electronics ', email: 'aicha@example.invalid ' }), true);
  // The confirmation is never sent: retyping it changes nothing the server sees.
  assert.equal(sameRegistration(withEmail, { ...withEmail, passwordConfirm: 'something else' }), true);
});

it('any field the server receives, edited after a failure, makes a new attempt', () => {
  for (const edit of [
    { email: 'right@example.invalid' },
    { email: '', phone: '+22212345678' },
    { phone: '+22212345678' },
    { password: 'another horse' },
    { ownerName: 'Aïcha' },
    { businessName: 'Nour Phones' },
    { branchName: 'Second Store' },
    { city: 'Nouakchott' },
  ]) {
    assert.equal(sameRegistration(withEmail, { ...withEmail, ...edit }), false, JSON.stringify(edit));
  }
});

it('the screen renews its key when the form changed since it was sent, and keeps it otherwise', () => {
  const register = code('app/(auth)/register.tsx');
  assert.match(register, /if \(attempt\.current\.sent && !sameRegistration\(attempt\.current\.sent, draft\)\) attempt\.current = \{ key: uuidv4\(\), sent: null \};\s*attempt\.current\.sent = draft;/);
  assert.match(register, /registrationPayload\(draft, attempt\.current\.key, language, consentFields\(copy\.data, draft\.whatsappConsent\)\)/);
});

it('the language sent is the one the person is reading, so the code arrives in it', () => {
  assert.equal(registrationPayload(withPhone, 'k', 'ar').language, 'ar');
  const register = code('app/(auth)/register.tsx');
  assert.match(register, /const \{ t, language \} = useTranslation\(\);/);
  assert.match(register, /registrationPayload\(draft, attempt\.current\.key, language, consentFields\(copy\.data, draft\.whatsappConsent\)\)/);
  assert.match(code('app/(auth)/verify.tsx'), /\{ continuation, language \}/);
});

// ── the routes: the app's own authentication, never the platform's ───────────

it('the screens reach the server only on auth/register, auth/register/verify/start and auth/register/verify/confirm', () => {
  const register = code('app/(auth)/register.tsx');
  const verify = code('app/(auth)/verify.tsx');
  assert.match(register, /api\.post<RegistrationStarted>\(\s*'\/auth\/register',/);
  assert.match(verify, /api\.post\('\/auth\/register\/verify\/start', /);
  assert.match(verify, /api\.post<AuthTokens>\('\/auth\/register\/verify\/confirm', /);
  const calls = [...`${register}\n${verify}`.matchAll(/api\.(get|post|put|patch|delete)(?:<\w+>)?\(\s*'([^']+)'/g)].map((m) => m[2]).sort();
  assert.deepEqual(calls, ['/auth/register', '/auth/register/verify/confirm', '/auth/register/verify/start']);
  assert.ok(!/\/platform\//.test(register + verify), 'nothing here reaches a platform route');
});

it('account creation that is not available right now says so, and that nothing was saved — the number is the one contact that can refuse it', () => {
  const register = code('app/(auth)/register.tsx');
  assert.match(register, /e instanceof ApiError && e\.code === 'registration_unavailable'\s*\?\s*t\('register\.unavailable'\)/);
  assert.doesNotMatch(register, /register\.unavailable\.whatsapp|register\.problem\.contact/);
});

// ── the operational WhatsApp consent beside the number (D213) ─────────────────

const CONSENT = { whatsappConsentVersion: 'wa-operational-2026-10-19', whatsappConsentLocale: 'fr' };

it('the consent starts unticked, and a draft without it is refused beside the box', () => {
  assert.equal(emptyRegistration.whatsappConsent, false);
  assert.deepEqual(validateRegistration({ ...withPhone, whatsappConsent: false }), { whatsappConsent: 'register.problem.whatsappConsent' });
});

it('typing or correcting the number never ticks it', () => {
  const typed = { ...emptyRegistration, phone: '+22212345678' };
  assert.equal(typed.whatsappConsent, false);
});

it('the agreement goes in the body only when ticked: the server’s version and the language it was shown in', () => {
  assert.deepEqual(
    { v: registrationPayload(withPhone, 'k', 'fr', CONSENT).whatsappConsentVersion, l: registrationPayload(withPhone, 'k', 'fr', CONSENT).whatsappConsentLocale },
    { v: 'wa-operational-2026-10-19', l: 'fr' },
  );
  const unticked = registrationPayload({ ...withPhone, whatsappConsent: false }, 'k', 'fr', CONSENT);
  assert.equal('whatsappConsentVersion' in unticked, false);
  assert.equal('whatsappConsentLocale' in unticked, false);
});

it('unticking or ticking the box makes another attempt; the same tick is the same attempt', () => {
  assert.equal(sameRegistration(withPhone, { ...withPhone, whatsappConsent: false }), false);
  assert.equal(sameRegistration(withPhone, { ...withPhone }), true);
});

it('the screen keeps no consent copy or version of its own: both come from the server', () => {
  const register = code('app/(auth)/register.tsx');
  assert.match(register, /\/messaging\/whatsapp\/consent\?language=/);
  assert.doesNotMatch(register, /wa-operational|wa-consent-/);
  assert.doesNotMatch(code('components/consent/WhatsAppConsentCheck.tsx'), /wa-operational|wa-consent-|checked=\{true\}|useState\(true\)/);
});

console.log('\n' + passed + ' passed');
