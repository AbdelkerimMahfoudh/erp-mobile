import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { accessSummary } from './access-summary.ts';

const base = {
  state: 'active', periodEnd: '2026-12-01T00:00:00Z', graceEnd: null, daysRemaining: 28, graceHoursRemaining: 0,
  subscribedBranchCount: 2, activeBranchCount: 2, includedSeats: 2, additionalSeats: 1, seatLimit: 3, seatsUsed: 2,
  overLimit: false, canRead: true, canWrite: true, isComplimentary: false, status: 'activated', calculatedAt: '2026-11-03T00:00:00Z',
} as never;
const keys = (s: ReturnType<typeof accessSummary>) => s && [s.stateKey, ...s.parts.map((p) => p.key)];

test('active: state, the days the server counts, then stores and seats', () => {
  const s = accessSummary(base, false)!;
  assert.deepEqual(keys(s), ['access.state.active', 'access.summary.days', 'access.summary.coverage']);
  assert.deepEqual(s.parts[0]!.values, { days: 28 });
  assert.deepEqual(s.parts[1]!.values, { stores: 2, used: 2, seats: 3 });
});

test('a trial counts its days like any period, never naming the trial (iOS); grace says what is left, in hours on its last day', () => {
  assert.equal(accessSummary({ ...(base as object), state: 'trial_active' } as never, false)!.parts[0]!.key, 'access.summary.days');
  const grace = accessSummary({ ...(base as object), state: 'grace', graceHoursRemaining: 50 } as never, false)!;
  assert.deepEqual(grace.parts[0], { key: 'access.summary.graceDays', values: { days: 3 } });
  assert.equal(accessSummary({ ...(base as object), state: 'grace', graceHoursRemaining: 5 } as never, false)!.parts[0]!.key, 'access.summary.graceHours');
});

test('suspended or ended: the state alone, no countdown', () => {
  const s = accessSummary({ ...(base as object), state: 'suspended', canWrite: false } as never, false)!;
  assert.ok(!s.parts.some((p) => p.key.includes('days')));
});

test('the Test business: its own state, never a countdown, whatever the server counts', () => {
  assert.deepEqual(accessSummary(base, true), { stateKey: 'access.summary.test', parts: [] });
});

test('More puts Business access first, and Acting Owner lives in Business settings', () => {
  const more = readFileSync('app/(tabs)/more.tsx', 'utf8');
  assert.ok(more.indexOf('<BusinessAccessRow') > -1 && more.indexOf('<BusinessAccessRow') < more.indexOf('groups.map'));
  const registry = readFileSync('lib/navigation/registry.ts', 'utf8');
  assert.doesNotMatch(registry.slice(registry.indexOf('export const MORE_GROUPS')), /'acting-owner'|'access'/);
  const settings = readFileSync('app/settings.tsx', 'utf8');
  assert.match(settings, /\/acting-owner/);
  // In the limited view too (return-policy editors: Managers, Employees), so an appointed Manager still reaches it.
  assert.equal(settings.match(/\{actingOwnerSection\}/g)?.length, 2);
});

test('every word in all three languages', () => {
  for (const lang of ['en', 'fr', 'ar']) {
    const l = readFileSync(`lib/i18n/${lang}.ts`, 'utf8');
    for (const k of ['access.summary.test', 'access.summary.days', 'access.summary.graceDays', 'access.summary.graceHours', 'access.summary.coverage']) assert.ok(l.includes(`'${k}'`), `${lang} ${k}`);
  }
});
