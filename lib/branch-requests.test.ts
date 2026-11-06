import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { cleanBranchInput, isWaiting, offersChecklist, type BranchRequest } from './branch-requests.ts';

const req = (over: Partial<BranchRequest>): BranchRequest => ({
  id: 'r1', name: 'Ksar', address: null, state: 'pending_activation', requestedAt: '2026-11-06T00:00:00Z', branchId: null, ...over,
});

test('the name is trimmed and required; the place is optional and trimmed', () => {
  assert.deepEqual(cleanBranchInput('  Ksar   Centre ', ''), { name: 'Ksar Centre' });
  assert.deepEqual(cleanBranchInput('Ksar', '  Nouakchott '), { name: 'Ksar', address: 'Nouakchott' });
  assert.deepEqual(cleanBranchInput('   ', 'x'), { error: 'name_required' });
  assert.deepEqual(cleanBranchInput('x'.repeat(161), ''), { error: 'name_too_long' });
  assert.deepEqual(cleanBranchInput('Ok', 'y'.repeat(161)), { error: 'address_too_long' });
});

test('waiting stores are listed, never chosen; active, cancelled and rejected are not waiting', () => {
  for (const s of ['pending_activation', 'proof_under_review', 'scheduled'] as const) assert.equal(isWaiting(req({ state: s })), true);
  for (const s of ['active', 'cancelled', 'rejected'] as const) assert.equal(isWaiting(req({ state: s })), false);
});

test('the setup checklist: once, for a store activated from a request', () => {
  const active = [req({ state: 'active', branchId: 'b1' })];
  assert.equal(offersChecklist('b1', active, false), true);
  assert.equal(offersChecklist('b1', active, true), false, 'closed once: never again');
  assert.equal(offersChecklist('b2', active, false), false, 'an older store: no checklist');
  assert.equal(offersChecklist('b1', undefined, false), false, 'not an Owner, or not loaded: none');
});

test('adding a store shows no price, plan, payment or link — anywhere in its screens', () => {
  for (const f of ['app/branch-new.tsx', 'app/branch-request/[id].tsx', 'app/branch-setup.tsx', 'lib/branch-requests.ts']) {
    const code = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    assert.doesNotMatch(code, /MRU|price|https?:|portal|subscri|Linking|openURL|\btrial\b/i, f);
  }
  const en = readFileSync(new URL('./i18n/en.ts', import.meta.url), 'utf8');
  for (const line of en.split('\n').filter((l) => /'branch(Request|Setup)\./.test(l))) {
    assert.doesNotMatch(line, /MRU|\d{3,}|price|pay|portal|subscri|\btrial\b|month/i, line);
  }
});
