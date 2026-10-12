/**
 * A provider and its configuration as the Owner keeps them (docs/73 §1.2,
 * D164): no rate, destination or fee mode is ever asked, sent or shown as
 * anything but history; a version carries the reference rule and its reason;
 * a provider switched on is usable at once.
 *
 *   node lib/agent-providers.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { configCheck, formOf, percentText, providersInOrder, providerStatus, REFERENCE_RULES, suggestedLabel } from './agent-providers.ts';

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

it('a new version starts from the rule in force — optional when none was ever set — and a reason of its own', () => {
  assert.deepEqual(formOf({ referenceRule: 'optional', config: null }), { referenceRule: 'optional', reason: '' });
  assert.deepEqual(formOf({ referenceRule: 'optional', config: { referenceRule: 'required' } }), { referenceRule: 'required', reason: '' });
  assert.deepEqual([...REFERENCE_RULES], ['required', 'optional', 'none']);
});

it('the version sent is the reference rule and its reason — never a rate, a destination or a fee mode', () => {
  const check = configCheck({ referenceRule: 'none', reason: '  Sedad gives no reference  ' });
  assert.ok(check.ok);
  assert.deepEqual(check.body, { referenceRule: 'none', reason: 'Sedad gives no reference' });
  for (const field of ['rateInBp', 'rateOutBp', 'sameRateBothDirections', 'commissionDestination', 'principalFeeMode']) assert.equal(field in check.body, false, field);
});

it('every version carries its reason, within the server’s length', () => {
  const blank = configCheck({ referenceRule: 'optional', reason: '   ' });
  assert.ok(!blank.ok);
  assert.deepEqual(blank.problems, ['reason_missing']);
  const long = configCheck({ referenceRule: 'optional', reason: 'x'.repeat(256) });
  assert.ok(!long.ok);
  assert.deepEqual(long.problems, ['reason_too_long']);
});

it('a provider is active or switched off — nothing else keeps it from the counter; the list keeps the Owner’s order', () => {
  assert.equal(providerStatus({ isActive: true }), 'active');
  assert.equal(providerStatus({ isActive: false }), 'switched_off');
  const ordered = providersInOrder([
    { label: 'Moov', isActive: false, sortOrder: 0 },
    { label: 'Sedad', isActive: true, sortOrder: 1 },
    { label: 'Bankily', isActive: true, sortOrder: 1 },
    { label: 'Masrvi', isActive: true, sortOrder: 0 },
  ]);
  assert.deepEqual(ordered.map((p) => p.label), ['Masrvi', 'Bankily', 'Sedad', 'Moov']);
  assert.equal(suggestedLabel('bankily'), 'Bankily');
  assert.equal(suggestedLabel('other'), '', 'an other provider is named by the Owner');
});

it('a rate is said only as a version’s history', () => {
  assert.equal(percentText(150), '1.5');
  assert.equal(percentText(5), '0.05');
  assert.equal(percentText(null), '');
});

it('the screens ask for no rate: no rate field, no destination or fee choice, no “ask the schedule” copy (D164)', () => {
  const detail = readFileSync(new URL('../app/agent/providers/[id].tsx', import.meta.url), 'utf8');
  const list = readFileSync(new URL('../app/agent/providers.tsx', import.meta.url), 'utf8');
  assert.match(detail, /useState<ConfigForm>\(\(\) => formOf\(/);
  for (const src of [detail, list]) {
    assert.ok(!/agent\.config\.(rateIn|rateOut|rateBoth|sameRate|destination|feeMode|blank)\b/.test(src), 'no rate or settlement field');
    assert.ok(!/decimal-pad/.test(src), 'no rate is typed');
  }
  for (const lang of ['en', 'fr', 'ar']) {
    const src = readFileSync(new URL(`./i18n/${lang}.ts`, import.meta.url), 'utf8');
    for (const gone of ['agent.config.blank', 'agent.config.sameRate', 'agent.config.destination', 'agent.config.feeMode', 'agent.providers.status.not_set_up', 'agent.provider.notSetUp']) {
      assert.ok(!src.includes(`'${gone}'`), `${lang}: ${gone}`);
    }
  }
});

console.log(`agent-providers: ${passed} passed`);
