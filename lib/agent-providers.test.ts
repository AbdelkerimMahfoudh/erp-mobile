/**
 * A provider's configuration as the Owner fills it in (docs/73 §1.2, §4.2):
 * blanks stay blanks — sent as null, never a zero or a sample — the
 * same-rate question is asked, never assumed, a deducted fee lands on the
 * float or is refused before it is sent, and a rate typed as people say it is
 * kept as the server keeps it.
 *
 *   node lib/agent-providers.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { configCheck, formOf, missingFields, parsePercent, percentText, providersInOrder, providerStatus, suggestedLabel, type ConfigForm } from './agent-providers.ts';
import type { ProviderConfig } from './agent-rules.ts';

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

it('a rate is typed as a percentage and kept in basis points; empty is a blank, never zero', () => {
  assert.deepEqual(parsePercent('1.5'), { ok: true, bp: 150 });
  assert.deepEqual(parsePercent('1,5 %'), { ok: true, bp: 150 });
  assert.deepEqual(parsePercent('٠٫٥'), { ok: true, bp: 50 }, 'Arabic digits and decimal sign');
  assert.deepEqual(parsePercent('0'), { ok: true, bp: 0 }, 'zero typed is zero — the Owner’s word, not a default');
  assert.deepEqual(parsePercent(''), { ok: true, bp: null });
  assert.deepEqual(parsePercent('  '), { ok: true, bp: null });
  assert.deepEqual(parsePercent('0.005'), { ok: false, reason: 'too_precise' }, 'a basis point is the finest rate');
  assert.deepEqual(parsePercent('101'), { ok: false, reason: 'too_high' });
  assert.deepEqual(parsePercent('abc'), { ok: false, reason: 'not_a_number' });
  assert.deepEqual(parsePercent('-1'), { ok: false, reason: 'not_a_number' });
  assert.equal(percentText(150), '1.5');
  assert.equal(percentText(5), '0.05');
  assert.equal(percentText(200), '2');
  assert.equal(percentText(null), '');
  for (const bp of [0, 1, 5, 50, 99, 100, 150, 199, 1234, 10000]) assert.deepEqual(parsePercent(percentText(bp)), { ok: true, bp }, `round trip ${bp}`);
});

const blank: ConfigForm = formOf(null);

it('a provider never configured starts with every field blank — the same-rate question unanswered', () => {
  assert.deepEqual(blank, { rateIn: '', rateOut: '', sameRate: null, destination: null, feeMode: null, referenceRule: null, reason: '' });
});

it('a new version starts from the version in force, its blanks blank, and a reason of its own', () => {
  const config: ProviderConfig = { id: 'v1', rateInBp: 150, rateOutBp: 50, sameRateBothDirections: false, commissionDestination: 'cash', principalFeeMode: null, referenceRule: 'required', effectiveFrom: '2026-10-09T11:00:00.000Z', recordedByName: 'Owner', reason: 'schedule' };
  assert.deepEqual(formOf(config), { rateIn: '1.5', rateOut: '0.5', sameRate: false, destination: 'cash', feeMode: null, referenceRule: 'required', reason: '' });
  const same = formOf({ ...config, rateOutBp: 150, sameRateBothDirections: true });
  assert.equal(same.rateOut, '', 'one rate both ways: one field');
  assert.equal(same.sameRate, true);
});

it('blanks are sent as blanks, and named as the server names what keeps the provider from posting', () => {
  const check = configCheck({ ...blank, reason: 'Waiting for the schedule' });
  assert.ok(check.ok);
  assert.deepEqual(check.body, { rateInBp: null, rateOutBp: null, sameRateBothDirections: false, commissionDestination: null, principalFeeMode: null, referenceRule: null, reason: 'Waiting for the schedule' });
  assert.deepEqual(check.missing, ['rateInBp', 'rateOutBp', 'commissionDestination', 'principalFeeMode', 'referenceRule']);
});

it('once a rate is typed the Owner says whether it is the same both ways — the phone never decides it', () => {
  const unanswered = configCheck({ ...blank, rateIn: '1', reason: 'r' });
  assert.ok(!unanswered.ok);
  assert.deepEqual(unanswered.problems, ['same_rate_unanswered']);
  const same = configCheck({ ...blank, rateIn: '1', rateOut: '9', sameRate: true, reason: 'r' });
  assert.ok(same.ok);
  assert.equal(same.body.rateInBp, 100);
  assert.equal(same.body.rateOutBp, 100, 'one rate both ways: copied, as the server copies it — the hidden field is ignored');
  assert.equal(same.body.sameRateBothDirections, true);
  const two = configCheck({ ...blank, rateIn: '1.5', rateOut: '0.5', sameRate: false, reason: 'r' });
  assert.ok(two.ok);
  assert.deepEqual([two.body.rateInBp, two.body.rateOutBp], [150, 50]);
  const half = configCheck({ ...blank, rateIn: '1.5', sameRate: false, reason: 'r' });
  assert.ok(half.ok);
  assert.deepEqual(half.missing, ['rateOutBp', 'commissionDestination', 'principalFeeMode', 'referenceRule'], 'the other way still blank');
});

it('a complete version is ready; a fee deducted from the principal lands on the float or is refused before sending', () => {
  const full = configCheck({ rateIn: '1', rateOut: '', sameRate: true, destination: 'provider_float', feeMode: 'deducted', referenceRule: 'none', reason: 'Masrvi schedule 2026' });
  assert.ok(full.ok);
  assert.deepEqual(full.missing, []);
  for (const destination of ['cash', 'held_separately', null] as const) {
    const refused = configCheck({ rateIn: '1', rateOut: '', sameRate: true, destination, feeMode: 'deducted', referenceRule: 'none', reason: 'r' });
    assert.ok(!refused.ok);
    assert.deepEqual(refused.problems, ['deducted_needs_float'], String(destination));
  }
});

it('every version carries its reason, and a mistyped rate is refused by field', () => {
  const check = configCheck({ ...blank, rateIn: '1.234', rateOut: 'x', sameRate: false, reason: '   ' });
  assert.ok(!check.ok);
  assert.deepEqual(check.problems, ['rate_in_invalid', 'rate_out_invalid', 'reason_missing']);
  const long = configCheck({ ...blank, reason: 'x'.repeat(256) });
  assert.ok(!long.ok);
  assert.deepEqual(long.problems, ['reason_too_long']);
});

it('the status is the server’s verdict; the list keeps the Owner’s order, switched-off providers last', () => {
  assert.equal(providerStatus({ isActive: true, readyForTransactions: true }), 'ready');
  assert.equal(providerStatus({ isActive: true, readyForTransactions: false }), 'not_set_up');
  assert.equal(providerStatus({ isActive: false, readyForTransactions: true }), 'switched_off');
  const ordered = providersInOrder([
    { label: 'Moov', isActive: false, sortOrder: 0 },
    { label: 'Sedad', isActive: true, sortOrder: 1 },
    { label: 'Bankily', isActive: true, sortOrder: 1 },
    { label: 'Masrvi', isActive: true, sortOrder: 0 },
  ]);
  assert.deepEqual(ordered.map((p) => p.label), ['Masrvi', 'Bankily', 'Sedad', 'Moov']);
  assert.equal(suggestedLabel('bankily'), 'Bankily');
  assert.equal(suggestedLabel('other'), '', 'an other provider is named by the Owner');
  assert.deepEqual(missingFields({ rateInBp: 1, rateOutBp: 1, commissionDestination: 'cash', principalFeeMode: 'separate', referenceRule: null }), ['referenceRule']);
});

it('the screen never offers a default for a blank: no field is pre-chosen beyond the version in force', () => {
  // Source pin: the form state is created from `formOf` alone, so a fresh provider's choices start unselected.
  const screen = readFileSync(new URL('../app/agent/providers/[id].tsx', import.meta.url), 'utf8');
  assert.match(screen, /useState<ConfigForm>\(\(\) => formOf\(/);
  assert.ok(!/rateInBp:\s*\d|destination:\s*'(cash|provider_float|held_separately)'/.test(screen), 'no rate or destination written into the screen');
});

console.log(`agent-providers: ${passed} passed`);
