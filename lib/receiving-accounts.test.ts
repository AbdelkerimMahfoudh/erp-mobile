/**
 * Deactivated accounts are never offered for a new sale payment.
 *
 *   node lib/receiving-accounts.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selectableAccounts } from './receiving-accounts.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  try { fn(); passed++; } catch (e) { console.error(`✗ ${name}`); throw e; }
};
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

it('drops an account marked inactive', () => {
  const rows = [{ id: 'a', isActive: true }, { id: 'b', isActive: false }, { id: 'c' }];
  assert.deepEqual(selectableAccounts(rows).map((r) => r.id), ['a', 'c']);
});

it('an account without the flag (staff settings view) stays selectable', () => {
  assert.deepEqual(selectableAccounts([{ id: 'x' }]).map((r) => r.id), ['x']);
});

it('no settings yet means nothing to offer, not a crash', () => {
  assert.deepEqual(selectableAccounts(undefined), []);
});

for (const screen of ['../app/(tabs)/sell.tsx', '../app/quick-sell.tsx']) {
  it(`${screen} offers only selectable accounts to the payment sheet`, () => {
    const src = read(screen);
    assert.match(src, /accounts=\{selectableAccounts\(receivingAccounts\)\}/);
    // The snapshot label of an existing payment still reads the full list.
    assert.match(src, /receivingAccounts\.find\(\(a\) => a\.id === p\.receivingAccountId\)/);
  });
}

console.log(`receiving accounts: ${passed} passed`);
