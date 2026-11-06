import { test } from 'node:test';
import assert from 'node:assert/strict';
import { en } from './i18n/en.ts';
import { fr } from './i18n/fr.ts';
import { ar } from './i18n/ar.ts';

/**
 * 0132 (docs/122): a store that is locked or whose access ended says so in words, in every language — and never a
 * price, a payment or a way to buy (Apple 3.1.1: activation stays outside the app).
 */
const KEYS = [
  'access.branch.locked.title',
  'access.branch.locked.body',
  'access.branch.ended.title',
  'access.branch.ended.body',
  'access.branch.state.locked',
  'access.branch.state.suspended',
  'access.branch.state.expired',
  'access.branch.state.trial_expired',
] as const;

test('every store-access sentence exists in English, French and Arabic', () => {
  for (const cat of [en, fr, ar] as Record<string, string>[]) {
    for (const k of KEYS) assert.ok(cat[k]?.trim(), k);
  }
});

test('no price, payment, plan or purchase in any of them', () => {
  const selling = /\b(pay|paid|payment|price|plan|buy|purchase|subscribe|mru)\b|pai(e|ement)|prix|achet|abonn|دفع|سعر|اشتر|أوقية/i;
  for (const cat of [en, fr, ar] as Record<string, string>[]) {
    for (const k of KEYS) assert.equal(selling.test(cat[k]), false, `${k}: ${cat[k]}`);
  }
});
