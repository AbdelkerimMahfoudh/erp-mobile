/**
 * The counter's lock (2026-09-27, docs/59 D76): Sell and Receive wait while the
 * boutique's current business day is closed, and Open store now is offered to
 * those who may reopen it.
 *
 *   node lib/day-gate.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dayGate } from './day-gate.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
};
type Standing = 'open' | 'counting' | 'counted' | 'closed' | 'reopened' | 'needs_review' | 'inactive';
const day = (standing: Standing = 'closed') => ({ standing, businessDate: '2026-09-27' });

it('the current business day closed: locked, and the Owner or a named delegate may open the store', () => {
  assert.deepEqual(dayGate(day(), true), { locked: true, mayOpen: true, businessDate: '2026-09-27' });
});

it('somebody without the closing authority sees the lock and is told who can open it', () => {
  assert.deepEqual(dayGate(day(), false), { locked: true, mayOpen: false, businessDate: '2026-09-27' });
});

it('open, counting, counted and reopened days never lock the counter; nor does a day never opened', () => {
  for (const standing of ['open', 'counting', 'counted', 'reopened'] as const) assert.deepEqual(dayGate(day(standing), true), { locked: false });
});

it('no view — not loaded, failed, or not for this person — never locks anybody out: the server’s rule stands', () => {
  assert.deepEqual(dayGate(null, true), { locked: false });
  assert.deepEqual(dayGate(undefined, false), { locked: false });
});

it('the rule reads the server’s business day, never the phone’s clock', () => {
  const src = readFileSync(new URL('./day-gate.ts', import.meta.url), 'utf8');
  assert.ok(!/new Date\(|Date\.now\(/.test(src));
});

it('Home and the guard ask the light business-day view, only for those it is for, and never trust a cached answer for anyone else', () => {
  const home = readFileSync(new URL('../app/(tabs)/index.tsx', import.meta.url), 'utf8');
  const gate = readFileSync(new URL('../components/day/DayGate.tsx', import.meta.url), 'utf8');
  for (const src of [home, gate]) {
    assert.match(src, /useBusinessDay\(\{ enabled: [^}]*canCount[^}]*\}\)/);
    assert.match(src, /dayGate\(canCount \? [a-zA-Z]+\.data : undefined, canPerform\)/);
  }
  // The full day view (for the choice sheet) is read only once the counter is locked, inside Open store now.
  const open = readFileSync(new URL('../components/day/OpenStoreNow.tsx', import.meta.url), 'utf8');
  assert.match(open, /const view = useOpenClosing\(undefined, \{ enabled: mayOpen \}\);/);
});

console.log(`day-gate: ${passed} passed`);
