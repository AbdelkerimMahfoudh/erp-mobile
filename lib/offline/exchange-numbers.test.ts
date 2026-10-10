/**
 * The customer's number outside the queue file (D155, D161), pinned: a key
 * scoped by company, branch, person and exchange; an older unscoped key moved
 * once, for the scope it was sealed in only; gone once the exchange is
 * finished, and swept again for every finished exchange when a queue opens.
 *
 *   node lib/offline/exchange-numbers.test.ts
 */
import assert from 'node:assert/strict';
import { AGENT_EXCHANGE_KIND, legacyNumberKey, numberKey, sealNumber, type ExchangePayload } from './agent-exchange.ts';
import {
  carrySealedNumber,
  finishedExchanges,
  forgetSealedNumber,
  keepSealedNumber,
  readSealedNumber,
  scopeOf,
  sweepNumbers,
  type KeyStore,
} from './exchange-numbers.ts';
import type { QueueItem, QueueState } from './queue-rules.ts';

let passed = 0;
const pending: Promise<void>[] = [];
const it = (name: string, fn: () => Promise<void>) => {
  pending.push(
    fn().then(
      () => {
        passed++;
      },
      (e) => {
        console.error(`FAIL  ${name}`);
        throw e;
      },
    ),
  );
};

/** SecureStore, as a map: what is written, read and deleted is all there is. */
function memoryStore(seed: Record<string, string> = {}): KeyStore & { map: Map<string, string> } {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => void map.set(k, v),
    deleteItem: async (k) => void map.delete(k),
  };
}

const A = { companyId: 'c1', branchId: 'b1', userId: 'u1' };
const B = { companyId: 'c1', branchId: 'b1', userId: 'u2' };
const UUID = '11111111-1111-4111-8111-111111111111';
const NUMBER = '36123456';

const payload: ExchangePayload = { providerId: 'bankily', direction: 'cash_in_credit_out', amount: 1000, configVersionId: 'cfg-1', deviceRecordedAt: '2026-10-10T09:00:00.000Z' };
const item = (over: Partial<QueueItem> = {}): QueueItem => ({
  id: 'i1', kind: AGENT_EXCHANGE_KIND, clientUuid: UUID, ...A, payloadVersion: 1, payload,
  state: 'waiting_for_connection', createdAt: 1, lastAttemptAt: null, attempts: 0, summary: 's', lastError: null, ...over,
});

it('kept under the scoped key, sealed to the same scope; an empty field keeps nothing', async () => {
  const store = memoryStore();
  await keepSealedNumber(store, A, UUID, NUMBER);
  assert.deepEqual([...store.map.keys()], [numberKey(A, UUID)]);
  assert.deepEqual(JSON.parse(store.map.get(numberKey(A, UUID))!), { ...A, customerNumber: NUMBER });
  assert.equal(await readSealedNumber(store, A, UUID), NUMBER);
  await keepSealedNumber(store, A, UUID, '   ');
  assert.equal(store.map.size, 0);
});

it('another person on the same phone reads nothing, and leaves the first person’s number where it is', async () => {
  const store = memoryStore();
  await keepSealedNumber(store, A, UUID, NUMBER);
  assert.equal(await readSealedNumber(store, B, UUID), null);
  await forgetSealedNumber(store, B, UUID);
  assert.equal(await readSealedNumber(store, A, UUID), NUMBER, 'B’s delete never reaches A’s key');
});

it('an older unscoped key is read once and moved under the scoped key — the seal still verified', async () => {
  const store = memoryStore({ [legacyNumberKey(UUID)]: sealNumber(A, NUMBER) });
  // Somebody else signed in: not theirs, not read, not moved.
  assert.equal(await readSealedNumber(store, B, UUID), null);
  assert.ok(store.map.has(legacyNumberKey(UUID)));
  // Its own person: read, moved, and the unscoped copy deleted.
  assert.equal(await readSealedNumber(store, A, UUID), NUMBER);
  assert.equal(store.map.has(legacyNumberKey(UUID)), false);
  assert.deepEqual(JSON.parse(store.map.get(numberKey(A, UUID))!), { ...A, customerNumber: NUMBER });
  // And from then on, from the scoped key.
  assert.equal(await readSealedNumber(store, A, UUID), NUMBER);
  // Unreadable or empty: no number, nothing moved.
  const broken = memoryStore({ [legacyNumberKey(UUID)]: 'not json' });
  assert.equal(await readSealedNumber(broken, A, UUID), null);
  assert.equal(broken.map.has(numberKey(A, UUID)), false);
});

it('forgetting removes the scoped key and any unscoped copy an earlier build left', async () => {
  const store = memoryStore({ [legacyNumberKey(UUID)]: sealNumber(A, NUMBER), [numberKey(A, UUID)]: sealNumber(A, NUMBER) });
  await forgetSealedNumber(store, A, UUID);
  assert.equal(store.map.size, 0);
});

it('carried to the key it is prepared again under, for the same person only', async () => {
  const store = memoryStore({ [legacyNumberKey(UUID)]: sealNumber(A, NUMBER) });
  assert.equal(await carrySealedNumber(store, B, UUID, 'next'), null);
  assert.equal(store.map.has(numberKey(B, 'next')), false);
  assert.equal(await carrySealedNumber(store, A, UUID, 'next'), NUMBER);
  assert.equal(await readSealedNumber(store, A, 'next'), NUMBER);
});

it('every finished exchange is swept at load, each under its own scope; nothing still to send is touched', async () => {
  const states: QueueState[] = ['synced', 'cancelled', 'waiting_for_connection', 'sending', 'needs_attention', 'draft', 'waiting_for_connection'];
  const items = states.map((state, n) => item({ id: `i${n}`, clientUuid: `k${n}`, state, ...(n === 1 ? B : A) }));
  const seed: Record<string, string> = {};
  for (const i of items) {
    seed[numberKey(scopeOf(i), i.clientUuid)] = sealNumber(scopeOf(i), NUMBER);
    seed[legacyNumberKey(i.clientUuid)] = sealNumber(scopeOf(i), NUMBER);
  }
  // Another kind's item is not an exchange: it has no number.
  items.push(item({ id: 'x', kind: 'expense.submit', clientUuid: 'kx', state: 'synced' }));
  const store = memoryStore(seed);
  assert.deepEqual(finishedExchanges(items).map((i) => i.id), ['i0', 'i1']);
  assert.equal(await sweepNumbers(store, items), 2);
  for (const i of items.slice(0, 2)) {
    assert.equal(store.map.has(numberKey(scopeOf(i), i.clientUuid)), false, i.state);
    assert.equal(store.map.has(legacyNumberKey(i.clientUuid)), false, i.state);
  }
  for (const i of items.slice(2, 7)) assert.ok(store.map.has(numberKey(scopeOf(i), i.clientUuid)), `${i.state} keeps its number`);
});

Promise.all(pending).then(
  () => console.log(`exchange numbers: ${passed} passed`),
  () => {
    process.exitCode = 1;
  },
);
