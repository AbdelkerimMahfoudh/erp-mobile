import { AGENT_EXCHANGE_KIND, legacyNumberKey, numberKey, openNumber, sealNumber, type Scope } from './agent-exchange.ts';
import { TERMINAL_STATES, type QueueItem } from './queue-rules.ts';

/**
 * The customer's number of a queued exchange, outside the queue file (D155, D161).
 *
 * Kept in SecureStore under a key scoped by the company, the branch, the person
 * and the exchange's own UUID, its value sealed to the same scope. A number an
 * earlier build kept under the UUID alone is moved on its first read — only for
 * the scope it was sealed in — and never written that way again. It leaves the
 * phone once the exchange is confirmed, cancelled or removed, and every
 * finished exchange is swept again when its queue is opened.
 *
 * The store is passed in rather than imported, so every rule here runs under
 * plain `node` with a map standing in for SecureStore:
 *   node lib/offline/exchange-numbers.test.ts
 */

/** The three calls of `lib/storage.ts` this needs. */
export interface KeyStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

/** Who an item belongs to: the scope its number was sealed in. */
export function scopeOf(item: Pick<QueueItem, 'companyId' | 'branchId' | 'userId'>): Scope {
  return { companyId: item.companyId, branchId: item.branchId, userId: item.userId };
}

/** Keep the number typed so far; an empty field keeps nothing. */
export async function keepSealedNumber(store: KeyStore, scope: Scope, clientUuid: string, customerNumber: string): Promise<void> {
  if (customerNumber.trim() === '') {
    await forgetSealedNumber(store, scope, clientUuid);
    return;
  }
  await store.setItem(numberKey(scope, clientUuid), sealNumber(scope, customerNumber));
}

/**
 * The number kept for an exchange, if it was kept by this person, here. The
 * scoped key first; then, once, the older unscoped key — moved under the scoped
 * one and deleted, but only when its seal names this same scope (another
 * person's number stays where it is, unread).
 */
export async function readSealedNumber(store: KeyStore, scope: Scope, clientUuid: string): Promise<string | null> {
  const scoped = openNumber(await store.getItem(numberKey(scope, clientUuid)), scope);
  if (scoped !== null) return scoped;
  const legacyKey = legacyNumberKey(clientUuid);
  const legacy = await store.getItem(legacyKey);
  const number = openNumber(legacy, scope);
  if (number === null || legacy === null) return null;
  await store.setItem(numberKey(scope, clientUuid), legacy);
  await store.deleteItem(legacyKey);
  return number;
}

/** The number leaves the phone: under its scoped key, and under the older key if an earlier build left it there. */
export async function forgetSealedNumber(store: KeyStore, scope: Scope, clientUuid: string): Promise<void> {
  await store.deleteItem(numberKey(scope, clientUuid));
  await store.deleteItem(legacyNumberKey(clientUuid));
}

/** The number of a refused exchange, carried to the key it is prepared again under (same person, same place). */
export async function carrySealedNumber(store: KeyStore, scope: Scope, from: string, to: string): Promise<string | null> {
  const number = await readSealedNumber(store, scope, from);
  if (number) await store.setItem(numberKey(scope, to), sealNumber(scope, number));
  return number;
}

/** The exchanges whose number has nothing left to wait for: confirmed, cancelled or removed. */
export function finishedExchanges(items: readonly QueueItem[]): QueueItem[] {
  return items.filter((i) => i.kind === AGENT_EXCHANGE_KIND && TERMINAL_STATES.includes(i.state));
}

/**
 * Sweep the numbers of every finished exchange — run as a queue is opened, so a
 * delete that did not happen (the app killed between the server's answer and
 * the delete) happens now. Each under its own item's scope.
 */
export async function sweepNumbers(store: KeyStore, items: readonly QueueItem[]): Promise<number> {
  const finished = finishedExchanges(items);
  for (const item of finished) await forgetSealedNumber(store, scopeOf(item), item.clientUuid);
  return finished.length;
}
