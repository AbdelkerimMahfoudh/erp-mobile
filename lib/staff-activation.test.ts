/**
 * An employee finishing their account (D213): a number's code needs their own consent, an email's does not.
 *
 * Run directly with Node (type-stripping):
 *   node lib/staff-activation.test.ts
 * Exits non-zero on any failure.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { codeRequestBody, confirmBody, contactOf, needsConsent } from './staff-activation.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log('  ok  ' + name);
};
const CONSENT = { whatsappConsentVersion: 'wa-operational-2026-10-19', whatsappConsentLocale: 'ar' };

it('reads a number or an email address, and nothing else', () => {
  assert.deepEqual(contactOf(' +222 33 44 55 66 '), { channel: 'phone', value: '+222 33 44 55 66' });
  assert.deepEqual(contactOf('fatima@shop.test'), { channel: 'email', value: 'fatima@shop.test' });
  assert.equal(contactOf(''), null);
  assert.equal(contactOf('fatima@'), null);
  assert.equal(contactOf('abc'), null);
});

it('a number needs the consent before its code; an email address does not', () => {
  assert.equal(needsConsent(contactOf('+22233445566')), true);
  assert.equal(needsConsent(contactOf('fatima@shop.test')), false);
  assert.equal(needsConsent(null), false);
});

it('the consent travels with a number’s code request only', () => {
  assert.deepEqual(codeRequestBody(contactOf('+22233445566')!, 'ar', CONSENT), { destination: '+22233445566', language: 'ar', ...CONSENT });
  assert.deepEqual(codeRequestBody(contactOf('f@shop.test')!, 'fr', CONSENT), { destination: 'f@shop.test', language: 'fr' });
  // Unticked: nothing to send, and the server refuses the number's code.
  assert.deepEqual(codeRequestBody(contactOf('+22233445566')!, 'en', {}), { destination: '+22233445566', language: 'en' });
});

it('the password goes only when given', () => {
  assert.deepEqual(confirmBody(contactOf('+22233445566')!, ' 123456 ', ''), { destination: '+22233445566', code: '123456' });
  assert.deepEqual(confirmBody(contactOf('+22233445566')!, '123456', 'Secret-pass-1'), { destination: '+22233445566', code: '123456', password: 'Secret-pass-1' });
});

it('the screen asks for the server’s copy, keeps no version of its own, and never calls the Owner’s routes', () => {
  const screen = readFileSync(new URL('../app/(auth)/join.tsx', import.meta.url), 'utf8');
  assert.match(screen, /\/messaging\/whatsapp\/consent\?language=/);
  assert.match(screen, /\/staff\/verify\/resend/);
  assert.match(screen, /\/staff\/verify\/confirm/);
  assert.doesNotMatch(screen, /wa-operational|wa-consent-|resend-verification|\/users/);
});

console.log('\n' + passed + ' passed');
