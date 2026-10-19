/**
 * The operational WhatsApp consent, as the app shows it (D213): what goes back with an agreement, when the account
 * asks for one, and the words for each state — never a colour alone, never inferred.
 *
 * Run directly with Node (type-stripping):
 *   node lib/whatsapp-consent.test.ts
 * Exits non-zero on any failure.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  consentEventKey,
  consentFields,
  consentProblemKey,
  consentRequested,
  consentSourceKey,
  consentStateKey,
  consentStateTone,
  withdrawalNeedsAcknowledgement,
} from './whatsapp-consent.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log('  ok  ' + name);
};

const COPY = { version: 'wa-operational-2026-10-19', language: 'ar' as const, title: 't', body: 'b', agreement: 'a', purposes: ['operational_whatsapp'] };

it('an agreement carries the server’s version and the language shown — only when ticked, and only with a copy', () => {
  assert.deepEqual(consentFields(COPY, true), { whatsappConsentVersion: 'wa-operational-2026-10-19', whatsappConsentLocale: 'ar' });
  assert.deepEqual(consentFields(COPY, false), {});
  assert.deepEqual(consentFields(null, true), {});
});

it('the account asks when the number has no consent to the copy in force — never otherwise', () => {
  assert.equal(consentRequested({ state: 'none' }), true);
  assert.equal(consentRequested({ state: 'outdated' }), true);
  for (const state of ['granted', 'withdrawn', 'no_number'] as const) assert.equal(consentRequested({ state }), false);
  assert.equal(consentRequested(null), false);
});

it('a withdrawal needs the acknowledgement exactly when WhatsApp is the only verified contact', () => {
  assert.equal(withdrawalNeedsAcknowledgement({ onlyVerifiedContact: true }), true);
  assert.equal(withdrawalNeedsAcknowledgement({ onlyVerifiedContact: false }), false);
});

it('every state has its words and a tone beside them', () => {
  for (const state of ['no_number', 'none', 'granted', 'outdated', 'withdrawn'] as const) assert.equal(consentStateKey(state), `consent.state.${state}`);
  assert.equal(consentStateTone('granted'), 'success');
  assert.equal(consentStateTone('none'), 'warning');
  assert.equal(consentStateTone('withdrawn'), 'neutral');
});

it('events and sources read in words; legacy sources read as the account', () => {
  assert.equal(consentEventKey('withdrawn'), 'consent.event.withdrawn');
  assert.equal(consentSourceKey('mobile_registration'), 'consent.source.registration');
  assert.equal(consentSourceKey('inbound_keyword'), 'consent.source.inbound_keyword');
  assert.equal(consentSourceKey('phone_verification'), 'consent.source.account');
});

it('the server’s consent refusals have the app’s words; anything else is left to the caller', () => {
  assert.equal(consentProblemKey('whatsapp_consent_required'), 'consent.problem.required');
  assert.equal(consentProblemKey('whatsapp_consent_outdated'), 'consent.problem.outdated');
  assert.equal(consentProblemKey('withdrawal_needs_acknowledgement'), 'consent.withdraw.needsAck');
  assert.equal(consentProblemKey('rate_limited'), null);
});

it('EN, FR and AR say the consent the same way: the same keys, and no marketing consent among them', () => {
  const keysOf = (file: string) =>
    [...readFileSync(new URL(`./i18n/${file}.ts`, import.meta.url), 'utf8').matchAll(/^\s*'((?:consent|register\.problem\.whatsappConsent|account\.(?:consent|messages))[^']*)':/gm)].map((m) => m[1]).sort();
  const en = keysOf('en');
  assert.ok(en.length > 40);
  assert.deepEqual(keysOf('fr'), en);
  assert.deepEqual(keysOf('ar'), en);
  assert.deepEqual(en.filter((k) => /market|promo/i.test(k)), ['consent.notMarketing']);
});

console.log('\n' + passed + ' passed');
