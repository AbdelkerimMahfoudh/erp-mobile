import { api } from './api-client';
import { useAuth } from '../hooks/useAuth';
import { useBranch } from './branch';
import { useConnectivity } from './connectivity';
import { againForm, COUNTER_DRAFT_FORM, COUNTER_DRAFT_VERSION, type CounterForm } from './agent-counter';
import { AGENT_EXCHANGE_KIND, confirmationOf, exchangeBody, isExchangePayload, type ExchangeConfirmation, type ExchangePayload, type Scope } from './offline/agent-exchange';
import { isDurable } from './offline/durable-storage';
import { loadDraft, saveDraft } from './offline/drafts';
import { carrySealedNumber, forgetSealedNumber, keepSealedNumber, readSealedNumber, type KeyStore } from './offline/exchange-numbers';
import { useQueue } from './offline/queue';
import type { QueueItem } from './offline/queue-rules';
import { deleteItem, getItem, setItem } from './storage';
import { uuidv4 } from './utils';

/**
 * The counter's exchanges between the screen and the server (D155).
 *
 * On a phone, Confirm puts the exchange in the Milestone J queue under the
 * draft's key and asks the queue to send it at once: online it is recorded in
 * a moment, offline it waits as *Pending synchronization* and goes when the
 * connection allows — the same path either way, so nothing is sent twice. The
 * customer's number is kept in SecureStore under that key, sealed with the
 * company, branch and person, and joined only when sending.
 *
 * A browser keeps nothing on the device (CP1): there an exchange is sent
 * directly while online and refused offline, never "queued" into a tab that
 * can be closed.
 */

/** Who and where an exchange belongs to: the queue's own scope. Null before the session is known. */
export function useExchangeScope(): Scope | null {
  const { user } = useAuth();
  const branchId = useBranch((s) => s.branchId);
  return user ? { companyId: user.companyId, branchId, userId: user.id } : null;
}

/** SecureStore on a device, through the app's storage wrapper. */
const numbers: KeyStore = { getItem, setItem, deleteItem };

/** Keep the number typed so far under the exchange's scoped key — on a device only; a browser keeps nothing. */
export async function keepNumber(scope: Scope, clientUuid: string, customerNumber: string): Promise<void> {
  if (!isDurable()) return;
  await keepSealedNumber(numbers, scope, clientUuid, customerNumber);
}

/** The number kept for an exchange, if it was kept by this person, here (an older unscoped key is moved on the way). */
export async function readNumber(scope: Scope, clientUuid: string): Promise<string | null> {
  if (!isDurable()) return null;
  return readSealedNumber(numbers, scope, clientUuid);
}

export async function forgetNumber(scope: Scope, clientUuid: string): Promise<void> {
  await forgetSealedNumber(numbers, scope, clientUuid);
}

export type RecordOutcome =
  | { kind: 'queued'; itemId: string }
  | { kind: 'recorded'; confirmation: ExchangeConfirmation }
  | { kind: 'refused'; error: unknown }
  | { kind: 'offline_unavailable' };

/**
 * Confirm. The payload carries no number; the number is sealed apart and the
 * summary names the direction, the amount and the provider only.
 */
export async function recordExchange(input: {
  scope: Scope;
  clientUuid: string;
  payload: ExchangePayload;
  customerNumber: string;
  summary: string;
}): Promise<RecordOutcome> {
  const { scope, clientUuid, payload, customerNumber, summary } = input;
  if (!isDurable()) {
    // A browser: sent now under the same key, or not at all.
    if (!useConnectivity.getState().online) return { kind: 'offline_unavailable' };
    try {
      const answer = await api.post('/agent/transactions', { ...exchangeBody(payload, customerNumber), clientUuid });
      const confirmation = confirmationOf(answer);
      return confirmation ? { kind: 'recorded', confirmation } : { kind: 'refused', error: new Error('unreadable answer') };
    } catch (error) {
      return { kind: 'refused', error };
    }
  }
  // The number first, so the queue never holds an exchange whose number is not yet kept.
  await keepSealedNumber(numbers, scope, clientUuid, customerNumber);
  const queue = useQueue.getState();
  const result = queue.enqueue({ kind: AGENT_EXCHANGE_KIND, payload: { ...payload }, summary, clientUuid });
  if (!result.queued || !result.id) return { kind: 'refused', error: new Error(result.reason ?? 'not_queued') };
  // The same key confirmed again — a draft restored after the exchange was already sent — is the exchange already
  // recorded: the number just kept has nothing left to wait for.
  if (useQueue.getState().items.find((i) => i.id === result.id)?.state === 'synced') await forgetNumber(scope, clientUuid);
  void queue.process();
  return { kind: 'queued', itemId: result.id };
}

/** The number of a refused exchange, carried to the key it is prepared again under. */
export async function carryNumber(scope: Scope, from: string, to: string): Promise<string | null> {
  return carrySealedNumber(numbers, scope, from, to);
}

/**
 * Prepare a refused exchange again (a newer rate, a wrong number or reference,
 * a key used for something else): its words and figures become the counter's
 * draft again under a NEW key, the number moves with it, and the refused item
 * is cancelled — it could never be sent as it was. The person then reads the
 * review again, with the rate in force, and confirms it themselves.
 */
export async function prepareAgain(item: QueueItem, scope: Scope): Promise<'prepared' | 'busy' | 'unavailable'> {
  if (item.kind !== AGENT_EXCHANGE_KIND || !isExchangePayload(item.payload) || !isDurable()) return 'unavailable';
  // An exchange half-typed at the counter is somebody's work: it is never overwritten.
  const open = loadDraft<CounterForm>(COUNTER_DRAFT_FORM, scope, COUNTER_DRAFT_VERSION);
  if (open && (open.value.direction || open.value.amount)) return 'busy';
  const clientUuid = uuidv4();
  const form = againForm(item.payload, clientUuid);
  if (!form) return 'unavailable';
  await carryNumber(scope, item.clientUuid, clientUuid);
  const saved = saveDraft(COUNTER_DRAFT_FORM, scope, form, COUNTER_DRAFT_VERSION);
  if (!saved.saved) {
    await forgetNumber(scope, clientUuid);
    return 'unavailable';
  }
  useQueue.getState().cancel(item.id);
  return 'prepared';
}
