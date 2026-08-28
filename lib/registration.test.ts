/**
 * The rules for creating a shop's account on the phone (milestone P).
 *
 * Run directly with Node (type-stripping):
 *   node lib/registration.test.ts
 * Exits non-zero on any failure.
 */
import assert from 'node:assert/strict';
import {
  emptyRegistration,
  draftWithoutSecret,
  isRegistrationValid,
  registrationPayload,
  validateRegistration,
  verificationTarget,
  type RegistrationDraft,
} from './registration.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log('  ok  ' + name);
};

const base: RegistrationDraft = {
  ...emptyRegistration,
  ownerName: 'Aicha',
  businessName: 'Nour Electronics',
  branchName: 'Main Store',
  password: 'correct horse',
  passwordConfirm: 'correct horse',
};

const withEmail = { ...base, email: 'aicha@example.invalid' };
const withPhone = { ...base, phone: '+22212345678' };

// ── contacts: either is enough, neither is not ───────────────────────────────

it('email only is accepted', () => {
  assert.deepEqual(validateRegistration(withEmail), {});
  assert.ok(isRegistrationValid(withEmail));
});

it('WhatsApp only is accepted', () => {
  assert.deepEqual(validateRegistration(withPhone), {});
});

it('both contacts together are accepted', () => {
  assert.deepEqual(validateRegistration({ ...withEmail, phone: '+22212345678' }), {});
});

it('neither contact is refused, because the contact IS the credential', () => {
  const problems = validateRegistration(base);
  assert.equal(problems.contact, 'register.problem.contact');
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
  assert.deepEqual(validateRegistration({ ...withEmail, city: '' }), {});
});

it('a short password is refused', () => {
  assert.equal(
    validateRegistration({ ...withEmail, password: 'short', passwordConfirm: 'short' }).password,
    'register.problem.password',
  );
});

it('a mismatched confirmation is refused', () => {
  assert.equal(
    validateRegistration({ ...withEmail, passwordConfirm: 'something else' }).passwordConfirm,
    'register.problem.passwordConfirm',
  );
});

it('both password problems are reported at once, not one after the other', () => {
  const problems = validateRegistration({ ...withEmail, password: 'abc', passwordConfirm: 'xyz' });
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
  ]);
});

it('the payload sends no identifier the server did not generate', () => {
  const body = registrationPayload(withEmail, 'key-1', 'en');
  for (const forbidden of ['storeId', 'companyId', 'branchId', 'userId', 'roleId', 'nationalId']) {
    assert.ok(!(forbidden in body), 'payload must not contain ' + forbidden);
  }
});

// ── the payload ──────────────────────────────────────────────────────────────

it('optional fields are omitted rather than sent empty', () => {
  const body = registrationPayload(withEmail, 'key-1', 'en');
  assert.ok(!('phone' in body), 'an unfilled contact is absent, not an empty string');
  assert.ok(!('city' in body));
  assert.equal(body.email, 'aicha@example.invalid');
  assert.equal(body.language, 'en');
  assert.equal(body.idempotencyKey, 'key-1');
});

it('values are trimmed, so a stray space cannot create a second business', () => {
  const body = registrationPayload({ ...withEmail, businessName: '  Nour  ' }, 'k', 'fr');
  assert.equal(body.businessName, 'Nour');
});

it('the same key is reused on retry — that is what makes it idempotent', () => {
  const a = registrationPayload(withEmail, 'stable-key', 'ar');
  const b = registrationPayload(withEmail, 'stable-key', 'ar');
  assert.deepEqual(a, b);
});

// ── verification target ──────────────────────────────────────────────────────

it('the code goes to the email when there is one', () => {
  assert.equal(verificationTarget({ ...withEmail, phone: '+22212345678' }), 'aicha@example.invalid');
});

it('and to the number when that is all there is', () => {
  assert.equal(verificationTarget(withPhone), '+22212345678');
});

it('with no contact there is nowhere to send it', () => {
  assert.equal(verificationTarget(base), null);
});

// ── the password is not kept ─────────────────────────────────────────────────

it('nothing carried past registration contains the password', () => {
  const kept = draftWithoutSecret(withEmail);
  assert.ok(!('password' in kept));
  assert.ok(!('passwordConfirm' in kept));
  assert.equal(JSON.stringify(kept).includes('correct horse'), false);
});

console.log('\n' + passed + ' passed');
