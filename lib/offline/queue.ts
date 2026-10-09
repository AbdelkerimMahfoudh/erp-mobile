import { create } from 'zustand';
import { api } from '../api-client';
import { useConnectivity } from '../connectivity';
import { usePermissionStore } from '../permissions';
import { deleteItem, getItem } from '../storage';
import { uuidv4 } from '../utils';
import { AGENT_EXCHANGE_KIND, confirmationOf, containsPersonalNumber, exchangeBody, isExchangePayload, numberKey, openNumber } from './agent-exchange.ts';
import { classifyError } from './classify.ts';
import { mayQueue } from './policy.ts';
import { isDurable } from './durable-storage.ts';
import { readQueue, writeQueue, type Scope } from './queue-store.ts';
import {
  MAX_ATTEMPTS,
  mayCancel,
  mayHaveRecorded,
  mayRemove,
  nextSendable,
  nextStateAfterError,
  type ClassifiedError,
  type QueueItem,
  type QueueState,
} from './queue-rules.ts';

/**
 * The engine that sends what is waiting (Milestone J).
 *
 * Deliberately thin. Every decision — whether an operation may be queued at
 * all, whether a failure is worth retrying, what order things go in, whether an
 * item still belongs to the person signed in — is made by the pure modules
 * beside it, which are tested without a device. This file only performs what
 * they decide, and writes the result down.
 *
 * The property it must never break: **an operation is sent with the client UUID
 * it was created with.** A fresh key on a retry is how one payment becomes two.
 */

/** Where each queueable operation goes. Nothing else can be sent from here. */
const ENDPOINT: Record<string, (payload: Record<string, unknown>) => { path: string; body: unknown }> = {
  'expense.submit': (p) => ({ path: '/expenses', body: p }),
  'loan.payment.report': (p) => ({
    path: `/loans/${p.loanId}/payment`,
    body: { ...p, loanId: undefined, action: 'report' },
  }),
  'consignment.payment.report': (p) => ({
    path: `/consignments/${p.consignmentId}/payment`,
    body: { ...p, consignmentId: undefined, action: 'report' },
  }),
  'notification.read': (p) => ({ path: `/notifications/${p.id}/read`, body: undefined }),
  [AGENT_EXCHANGE_KIND]: (p) => ({ path: '/agent/transactions', body: p }),
};

/**
 * What must be joined to a payload at the moment of sending, and from where.
 *
 * Only the agent exchange has anything (D155): the customer's number, kept in
 * SecureStore under the exchange's own key and sealed with the company, branch
 * and person it was typed by. When it is gone or belongs to somebody else the
 * exchange is not sent — it waits for a person, with the reason named.
 */
type Prepared = { payload: Record<string, unknown> } | { refusal: ClassifiedError };

const PREPARE: Record<string, (item: QueueItem, scope: Scope) => Promise<Prepared>> = {
  [AGENT_EXCHANGE_KIND]: async (item, scope): Promise<Prepared> => {
    const number = openNumber(await getItem(numberKey(item.clientUuid)), scope);
    if (!isExchangePayload(item.payload) || number === null) {
      return { refusal: { kind: 'validation', code: 'customer_number_missing', message: 'The customer’s number is no longer on this phone.' } };
    }
    return { payload: { ...exchangeBody(item.payload, number) } };
  },
};

/** Forget what was kept outside the queue file for an item that will never be sent again. */
async function forgetOutside(item: QueueItem): Promise<void> {
  if (item.kind === AGENT_EXCHANGE_KIND) await deleteItem(numberKey(item.clientUuid));
}

interface QueueStoreState {
  scope: Scope | null;
  items: QueueItem[];
  /** True while a pass is running, so two triggers do not send the same item. */
  running: boolean;
  lastSyncAt: number | null;
  /** Set when a stored file could not be trusted, so the shop can be told. */
  corruptionDetected: boolean;
  /** False on web, where there is no device storage to queue into. */
  durable: boolean;

  load: (scope: Scope) => void;
  enqueue: (input: {
    kind: string;
    payload: Record<string, unknown>;
    summary: string;
    /** The key the record was prepared under (an agent exchange's draft UUID); a fresh one otherwise. */
    clientUuid?: string;
  }) => { queued: boolean; reason?: string; id?: string };
  process: () => Promise<void>;
  cancel: (id: string) => void;
  /** An exchange that may be recorded, taken off this phone by a person who checked the exchanges list. */
  remove: (id: string) => void;
  retry: (id: string) => void;
  countsFor: () => { waiting: number; needsAttention: number; drafts: number };
}

export const useQueue = create<QueueStoreState>((set, get) => ({
  scope: null,
  items: [],
  running: false,
  lastSyncAt: null,
  corruptionDetected: false,
  durable: isDurable(),

  /**
   * Open the queue belonging to this user, company and branch.
   *
   * Switching scope replaces what is in memory rather than merging: two scopes'
   * items must never appear in one list, or somebody would retry another
   * person's report.
   */
  load: (scope) => {
    const { items, quarantined } = readQueue(scope);
    set({ scope, items, corruptionDetected: quarantined });
  },

  enqueue: ({ kind, payload, summary, clientUuid }) => {
    const { scope, items } = get();
    if (!scope) return { queued: false, reason: 'no_session' };

    /*
      The same key twice — a second tap on Confirm, a screen confirmed again
      after a restart — is the same record, not a second one: the item already
      waiting is the answer.
    */
    const existing = clientUuid ? items.find((i) => i.clientUuid === clientUuid && i.state !== 'cancelled') : undefined;
    if (existing) return { queued: true, id: existing.id };

    /*
      The gate. An operation that is not on the queueable list is refused here
      rather than stored and refused later — storing it would mean a build that
      reclassified something could still find it waiting on disk.
    */
    /*
      Web keeps nothing on the device (CP1), so nothing may be accepted into
      the queue there. Refusing is the honest answer: telling a shop its
      payment report is "waiting to send" when a closed tab would erase it is
      exactly the lie this whole subsystem exists to avoid.
    */
    if (!isDurable()) return { queued: false, reason: 'not_durable' };
    if (!mayQueue(kind)) return { queued: false, reason: 'not_queueable' };
    if (!ENDPOINT[kind]) return { queued: false, reason: 'no_endpoint' };
    // Personal data never reaches the file (D155), whatever a caller passes.
    if (containsPersonalNumber(payload)) return { queued: false, reason: 'personal_data' };

    const item: QueueItem = {
      id: uuidv4(),
      kind,
      // Created once — here, or with the draft it was prepared in. Every later attempt reuses it.
      clientUuid: clientUuid ?? uuidv4(),
      companyId: scope.companyId,
      branchId: scope.branchId,
      userId: scope.userId,
      payloadVersion: 1,
      payload,
      state: 'waiting_for_connection',
      createdAt: Date.now(),
      lastAttemptAt: null,
      attempts: 0,
      summary,
      lastError: null,
    };

    const next = [...items, item];
    set({ items: next });
    writeQueue(scope, next);
    return { queued: true, id: item.id };
  },

  /**
   * One pass over everything that is ready to go.
   *
   * Permissions are refreshed first: a role can be revoked while an item waits,
   * and replaying under a permission somebody no longer holds would be the
   * queue quietly granting authority the server would have refused.
   */
  process: async () => {
    const { scope, running } = get();
    if (!scope || running) return;
    if (!useConnectivity.getState().online) return;

    set({ running: true });
    try {
      if (scope.branchId) {
        await usePermissionStore.getState().refresh(scope.branchId);
      }

      const ready = nextSendable(get().items, scope, Date.now());
      for (const item of ready) {
        await send(item, scope, set, get);
      }
      if (ready.length > 0) set({ lastSyncAt: Date.now() });
    } finally {
      set({ running: false });
    }
    /*
      Something queued while this pass was running — an exchange confirmed at
      the counter a moment ago — goes now rather than waiting for the next
      reconnect. Items just attempted are backing off and not sendable, so this
      ends.
    */
    const after = get();
    if (after.scope && nextSendable(after.items, after.scope, Date.now()).length > 0) void after.process();
  },

  cancel: (id) => {
    const { scope, items } = get();
    if (!scope) return;
    // Only ever a state change: the row stays, so "I cancelled it" is visible
    // rather than the item simply vanishing from a list somebody was watching.
    const target = items.find((i) => i.id === id);
    // Never "cancelled, nothing sent" for an exchange that may already be recorded.
    if (!target || !mayCancel(target)) return;
    const next = items.map((i) => (i.id === id ? { ...i, state: 'cancelled' as QueueState } : i));
    set({ items: next });
    writeQueue(scope, next);
    // A cancelled exchange will never be sent: its number has no reason to stay on the phone.
    if (target) void forgetOutside(target);
  },

  remove: (id) => {
    const { scope, items } = get();
    if (!scope) return;
    const target = items.find((i) => i.id === id);
    if (!target || !mayRemove(target)) return;
    // Said as what it is: taken off this phone, the server's list being the record of what happened.
    const next = items.map((i) => (i.id === id ? { ...i, state: 'cancelled' as QueueState, result: { ...(i.result ?? {}), removed: 1 } } : i));
    set({ items: next });
    writeQueue(scope, next);
    void forgetOutside(target);
  },

  /** A person deciding to try again clears the backoff, not the history. */
  retry: (id) => {
    const { scope, items } = get();
    if (!scope) return;
    const next = items.map((i) =>
      i.id === id
        ? { ...i, state: 'waiting_for_connection' as QueueState, attempts: 0, lastAttemptAt: null }
        : i,
    );
    set({ items: next });
    writeQueue(scope, next);
    void get().process();
  },

  countsFor: () => {
    const { items } = get();
    return {
      waiting: items.filter((i) => i.state === 'waiting_for_connection' || i.state === 'sending').length,
      needsAttention: items.filter((i) => i.state === 'needs_attention').length,
      drafts: items.filter((i) => i.state === 'draft').length,
    };
  },
}));

/**
 * Send one item.
 *
 * Every outcome is written to disk before the next item is attempted, so a
 * process killed mid-pass resumes from the truth rather than from what was in
 * memory when it died.
 */
async function send(
  item: QueueItem,
  scope: Scope,
  set: (partial: Partial<QueueStoreState>) => void,
  get: () => QueueStoreState,
): Promise<void> {
  const patch = (changes: Partial<QueueItem>) => {
    const next = get().items.map((i) => (i.id === item.id ? { ...i, ...changes } : i));
    set({ items: next });
    writeQueue(scope, next);
  };

  patch({ state: 'sending', lastAttemptAt: Date.now(), attempts: item.attempts + 1 });

  // What lives outside the file is joined now, or the item waits for a person with the reason named.
  let payload = item.payload as Record<string, unknown>;
  const prepare = PREPARE[item.kind];
  if (prepare) {
    const prepared = await prepare(item, scope);
    if ('refusal' in prepared) {
      patch({ state: 'needs_attention', lastError: prepared.refusal });
      return;
    }
    payload = prepared.payload;
  }

  // The payload shape was validated on the way in; this only narrows it back.
  const { path, body } = ENDPOINT[item.kind](payload);
  try {
    // The original key, always. This is what makes a replay a replay.
    const answer = await api.post(path, body === undefined ? undefined : { ...(body as object), clientUuid: item.clientUuid });
    /*
      A server that recognises the key and returns the original record is a
      SUCCESS, not a duplicate — that is the whole point of idempotency, and
      treating it as a failure would leave a synced item waiting forever. An
      exchange keeps the server's record of it — the instant and the business
      day are the server's — and its number leaves the phone.
    */
    const result = item.kind === AGENT_EXCHANGE_KIND ? confirmationOf(answer) : null;
    patch({ state: 'synced', lastError: null, ...(result ? { result: { ...result } } : {}) });
    await forgetOutside(item);
  } catch (error) {
    const classified: ClassifiedError = classifyError(error, useConnectivity.getState().online);
    const nextState = nextStateAfterError(classified);
    /*
      Attempts are bounded. Past the limit an item stops asking the network and
      starts asking a person — never silently, and never with an edited payload
      to make it pass.
    */
    const exhausted = item.attempts + 1 >= MAX_ATTEMPTS && nextState === 'waiting_for_connection';
    patch({
      state: exhausted ? 'needs_attention' : nextState,
      lastError: classified,
      // A money record remembers whether any attempt may have been recorded (D155): it decides what a person is offered.
      ...(item.kind === AGENT_EXCHANGE_KIND ? { mayBeRecorded: mayHaveRecorded(Boolean(item.mayBeRecorded), classified) } : {}),
    });
  }
}
