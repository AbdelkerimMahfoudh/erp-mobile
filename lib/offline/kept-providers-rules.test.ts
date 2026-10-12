/**
 * The provider list kept on the phone for the offline counter (D155; device run, 2026-10-10).
 *
 *   node lib/offline/kept-providers-rules.test.ts
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { keptProvidersFile, mayUseKeptProviders, parseKeptProviders } from './kept-providers-rules.ts';
import type { ErrorKind } from './queue-rules.ts';

/** As this build keeps it (D164): the reference rule, no price. */
const bankily = { id: 'p-1', kind: 'bankily', label: 'Bankily', isActive: true, sortOrder: 0, referenceRule: 'none', config: null };
/** As an earlier build kept it: rates at the top of the version, no rule of its own. */
const olderBankily = {
  id: 'p-1', kind: 'bankily', label: 'Bankily', isActive: true, sortOrder: 0, readyForTransactions: true, missing: [],
  config: { id: 'cfg-7', rateInBp: 300, rateOutBp: 300, sameRateBothDirections: true, commissionDestination: 'provider_float', principalFeeMode: 'separate', referenceRule: 'none', effectiveFrom: 'x', recordedByName: 'Owner', reason: 'r' },
};

it('the kept list answers only when the server cannot be reached — never a refusal', () => {
  const answers: Record<ErrorKind, boolean> = {
    no_network: true,
    api_unreachable: true,
    timeout_uncertain: true,
    server_error: true,
    session_expired: false,
    permission_denied: false,
    entitlement_blocked: false,
    validation: false,
    conflict: false,
  };
  for (const [kind, expected] of Object.entries(answers)) assert.equal(mayUseKeptProviders(kind as ErrorKind), expected, kind);
});

it('one file per branch, its name kept to safe characters', () => {
  assert.equal(keptProvidersFile('01a1096d-ab32-702f-8b36-7a5097708c19'), 'providers-01a1096d-ab32-702f-8b36-7a5097708c19.json');
  assert.equal(keptProvidersFile('../x/y'), 'providers-___x_y.json');
});

it('a kept list reads back whole; anything else is no list', () => {
  const text = JSON.stringify({ savedAt: '2026-10-11T04:00:00.000Z', providers: [bankily] });
  assert.deepEqual(parseKeptProviders(text), { savedAt: '2026-10-11T04:00:00.000Z', providers: [bankily] });
  assert.deepEqual(parseKeptProviders(JSON.stringify({ savedAt: 'x', providers: [] })), { savedAt: 'x', providers: [] });
  // An earlier build's list reads in this shape: its rule kept, its rates history only — never a price at the counter.
  const older = parseKeptProviders(JSON.stringify({ savedAt: 'y', providers: [olderBankily] }))!;
  assert.equal(older.providers[0].referenceRule, 'none');
  assert.equal(older.providers[0].config?.legacy?.rateInBp, 300);
  assert.equal('readyForTransactions' in older.providers[0], false);
  for (const bad of ['', 'not json', 'null', '[]', '{"providers":[]}', '{"savedAt":"x"}', '{"savedAt":"x","providers":[{"id":1}]}']) {
    assert.equal(parseKeptProviders(bad), null, bad);
  }
});
