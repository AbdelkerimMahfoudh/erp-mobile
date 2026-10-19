/**
 * An employee activating their account from an invitation (D213, D214): the reference read as the server reads it, the
 * number in international form, and the consent travelling with the code request.
 *
 * Run directly with Node (type-stripping):
 *   node lib/staff-activation.test.ts
 * Exits non-zero on any failure.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { codeRequestBody, confirmBody, numberOf, openBody, referenceOf } from './staff-activation.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log('  ok  ' + name);
};
const CONSENT = { whatsappConsentVersion: 'wa-operational-2026-10-19', whatsappConsentLocale: 'ar' };
const REF = 'K7QM-9XRT-2CHD';

it('reads a reference as the server does: separators, spaces and case do not matter; O is 0, I and L are 1', () => {
  assert.equal(referenceOf('k7qm 9xrt 2chd'), REF);
  assert.equal(referenceOf(' K7QM-9XRT-2CHD '), REF);
  assert.equal(referenceOf('K7QM9XRT2CHD'), REF);
  assert.equal(referenceOf('oiL0-0000-0000'), '0110-0000-0000');
});

it('refuses what cannot be a reference', () => {
  for (const typed of ['', 'K7QM-9XRT', 'K7QM-9XRT-2CHDX', 'K7QM-9XRT-2CHU', 'K7QM-9XRT-2CH!', 'x'.repeat(50), null, undefined]) {
    assert.equal(referenceOf(typed), null, String(typed));
  }
});

it('reads a WhatsApp number in international form, and nothing else', () => {
  assert.equal(numberOf(' +222 33 44 55 66 '), '+22233445566');
  assert.equal(numberOf('0022233445566'), '+22233445566');
  assert.equal(numberOf('(+222) 33-44-55-66'), '+22233445566');
  for (const typed of ['', '33445566', 'abc', '+0123456789', null]) assert.equal(numberOf(typed), null, String(typed));
});

it('the bodies: the reference, the typed number, the consent only when ticked, the password only when given', () => {
  assert.deepEqual(openBody(REF), { reference: REF });
  assert.deepEqual(codeRequestBody(REF, '+22233445566', 'ar', CONSENT), { reference: REF, number: '+22233445566', language: 'ar', ...CONSENT });
  // Unticked: nothing to send, and the server refuses the code.
  assert.deepEqual(codeRequestBody(REF, '+22233445566', 'en', {}), { reference: REF, number: '+22233445566', language: 'en' });
  assert.deepEqual(confirmBody(REF, ' 123456 ', ''), { reference: REF, code: '123456' });
  assert.deepEqual(confirmBody(REF, '123456', 'Secret-pass-1'), { reference: REF, code: '123456', password: 'Secret-pass-1' });
});

it('the screen reaches only the employee’s public routes and the server’s consent copy, and keeps no version of its own', () => {
  const screen = readFileSync(new URL('../app/(auth)/join.tsx', import.meta.url), 'utf8');
  assert.match(screen, /\/messaging\/whatsapp\/consent\?language=/);
  const routes = [...screen.matchAll(/api\.post(?:<[^>]+>)?\('([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(routes, ['/staff/join/confirm', '/staff/join/open', '/staff/join/request-code']);
  assert.doesNotMatch(screen, /wa-operational|wa-consent-|\/users|staff\/verify/);
});

it('the link only fills the form: the screen opens nothing until the person presses Continue', () => {
  const screen = readFileSync(new URL('../app/(auth)/join.tsx', import.meta.url), 'utf8');
  assert.match(screen, /useLocalSearchParams<\{ ref\?: string \}>/);
  // No effect runs on arrival: no request is made from the link alone.
  assert.doesNotMatch(screen, /useEffect/);
  assert.doesNotMatch(screen, /Linking/);
});

it('the Owner’s screens never send a code, and show a reference only from the server’s answer', () => {
  const sheet = readFileSync(new URL('../components/team/CreateMemberSheet.tsx', import.meta.url), 'utf8');
  const panel = readFileSync(new URL('../components/team/PendingPanel.tsx', import.meta.url), 'utf8');
  for (const source of [sheet, panel]) assert.doesNotMatch(source, /resend-verification|verify\/resend|request-code/);
  assert.match(panel, /\/users\/\$\{user\.id\}\/invitation/);
  // The panel holds a new reference in memory only, for as long as it is on screen.
  assert.doesNotMatch(panel, /AsyncStorage|SecureStore|setItem/);
});

console.log('\n' + passed + ' passed');
