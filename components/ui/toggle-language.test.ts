/**
 * A switch's state is said in the reader's language (owner's review, 2026-10-24).
 *
 *   node components/ui/toggle-language.test.ts
 *
 * The New team member sheet showed "On" beside each store in French and Arabic: `Toggle` fell back to English words
 * whenever a screen did not pass its own, and thirteen screens did not.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { en } from '../../lib/i18n/en.ts';
import { fr } from '../../lib/i18n/fr.ts';
import { ar } from '../../lib/i18n/ar.ts';

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

const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const src = (p: string) => strip(readFileSync(p, 'utf8'));

it('Toggle has no English default: its state words come from the catalogue', () => {
  const toggle = src('components/ui/Toggle.tsx');
  assert.doesNotMatch(toggle, /'On'|'Off'|"On"|"Off"/);
  assert.match(toggle, /onLabel \?\? t\('settings\.toggle\.on'\)/);
  assert.match(toggle, /offLabel \?\? t\('settings\.toggle\.off'\)/);
});

it('the state words are translated, not copied: French and Arabic never say On or Off', () => {
  for (const key of ['settings.toggle.on', 'settings.toggle.off', 'team.create.store.on', 'team.create.store.off'] as const) {
    for (const [lang, catalogue] of [['fr', fr], ['ar', ar]] as const) {
      assert.ok(catalogue[key], `${lang} has ${key}`);
      assert.doesNotMatch(catalogue[key], /^(On|Off)$/, `${lang}.${key} is English`);
      assert.notEqual(catalogue[key], en[key], `${lang}.${key} is the English text`);
    }
  }
});

it('a store in the New team member sheet says whether the person works there', () => {
  const sheet = src('components/team/CreateMemberSheet.tsx');
  assert.match(sheet, /onLabel=\{t\('team\.create\.store\.on'\)\}/);
  assert.match(sheet, /offLabel=\{t\('team\.create\.store\.off'\)\}/);
});

console.log(`toggle language: ${passed} passed`);
