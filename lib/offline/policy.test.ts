/**
 * The offline safety argument, pinned (Milestone J).
 *
 *   node lib/offline/policy.test.ts
 *
 * These tests exist because the classification is the only thing standing
 * between "the app works on bad wifi" and "the app charged a customer for a
 * phone another branch had already sold". Prose in a document cannot fail a
 * build; this can.
 */
import assert from 'node:assert/strict';
import {
  classify,
  mayQueue,
  OPERATIONS,
  QUEUEABLE_KINDS,
  specFor,
  DRAFTABLE_FORMS,
  FORBIDDEN_DRAFT_WORDS,
} from './policy.ts';
import {
  backoffMs,
  belongsToSession,
  decideReplay,
  isTransient,
  MAX_ATTEMPTS,
  mayCancel,
  nextSendable,
  nextStateAfterError,
  orderForReplay,
  shouldRetry,
  toneFor,
  TERMINAL_STATES,
  type QueueItem,
  type QueueState,
} from './queue-rules.ts';

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

// ── The sale, which is the whole point ──────────────────────────────────────

it('a sale can never be finalized offline', () => {
  assert.equal(classify('sale.create'), 'online_only');
  assert.equal(mayQueue('sale.create'), false);
});

it('nor can anything else that moves stock', () => {
  for (const kind of [
    'unit.quickAdd', 'purchase.create', 'import.commit',
    'transfer.create', 'transfer.approve', 'transfer.ship', 'transfer.receive', 'transfer.cancel',
    'consignment.create', 'consignment.custody', 'consignment.sold', 'consignment.return',
    'return.create', 'return.custody',
  ]) {
    assert.equal(classify(kind), 'online_only', `${kind} must be online-only`);
  }
});

it('nor anything that settles money', () => {
  for (const kind of [
    'loan.payment.confirm', 'loan.payment.correct', 'loan.forgive',
    'consignment.payment.confirm', 'consignment.payment.correct', 'consignment.forgive',
    'return.refund.confirm', 'return.refund.correct',
    'supplier.payment.confirm', 'supplier.payment.correct',
    'expense.confirm', 'expense.reject',
    'correction.create', 'correction.approve', 'correction.reject',
    'closing.count', 'closing.signOff', 'discrepancy.resolve',
  ]) {
    assert.equal(classify(kind), 'online_only', `${kind} must be online-only`);
  }
});

it('nor anything that grants authority', () => {
  for (const kind of [
    'user.update', 'settings.update', 'price.set', 'price.remove', 'sale.belowCostOverride',
    'goal.create', 'goal.archive', 'product.create', 'auth.login', 'auth.logout',
    'device.adopt', 'device.revoke',
  ]) {
    assert.equal(classify(kind), 'online_only', `${kind} must be online-only`);
  }
});

// ── The four that may wait ──────────────────────────────────────────────────

it('exactly four operations may be queued, and they are the audited ones', () => {
  assert.deepEqual([...QUEUEABLE_KINDS].sort(), [
    'consignment.payment.report',
    'expense.submit',
    'loan.payment.report',
    'notification.read',
  ]);
});

it('every queueable operation states how the server survives a replay', () => {
  for (const kind of QUEUEABLE_KINDS) {
    const s = specFor(kind)!;
    assert.ok(
      s.idempotency === 'client_uuid_with_fingerprint' || s.idempotency === 'naturally_idempotent',
      `${kind} may not be queued without proven idempotency`,
    );
  }
});

it('nothing outside the queueable set claims idempotency it does not need', () => {
  for (const op of OPERATIONS) {
    if (op.classification !== 'queueable') {
      assert.equal(op.idempotency, undefined, `${op.kind} should not declare idempotency`);
    }
  }
});

// ── Failing closed ──────────────────────────────────────────────────────────

it('an operation nobody classified is treated as authority', () => {
  // The realistic failure: a future milestone adds a mutation and forgets this
  // file. Defaulting to queueable would ship it into the queue silently.
  assert.equal(classify('some.future.mutation'), 'online_only');
  assert.equal(mayQueue('some.future.mutation'), false);
});

it('every operation is classified exactly once', () => {
  const kinds = OPERATIONS.map((o) => o.kind);
  assert.equal(new Set(kinds).size, kinds.length, 'duplicate operation kind');
});

it('every operation explains itself', () => {
  for (const op of OPERATIONS) {
    assert.ok(op.why.length > 20, `${op.kind} needs a real reason, not a label`);
  }
});

// ── Drafts ──────────────────────────────────────────────────────────────────

it('every draftable form names the operation it is not yet', () => {
  for (const d of DRAFTABLE_FORMS) {
    assert.ok(specFor(d.becomes), `${d.form} becomes an unknown operation ${d.becomes}`);
  }
});

it('the sell cart drafts, but the sale it becomes is online-only', () => {
  const cart = DRAFTABLE_FORMS.find((d) => d.form === 'sell.cart')!;
  assert.equal(cart.becomes, 'sale.create');
  assert.equal(classify(cart.becomes), 'online_only');
});

it('the counted closing drafts, but closing cannot be submitted offline', () => {
  const counts = DRAFTABLE_FORMS.find((d) => d.form === 'closing.counts')!;
  assert.equal(classify(counts.becomes), 'online_only');
});

it('the words that would lie about a draft are named so a screen can be checked', () => {
  for (const w of ['sent', 'reserved', 'paid', 'approved', 'completed']) {
    assert.ok(FORBIDDEN_DRAFT_WORDS.includes(w), `${w} must be forbidden for drafts`);
  }
});

// ── Retry and backoff ───────────────────────────────────────────────────────

it('only failures that decided nothing are retried', () => {
  assert.equal(isTransient('no_network'), true);
  assert.equal(isTransient('api_unreachable'), true);
  assert.equal(isTransient('server_error'), true);
  assert.equal(isTransient('timeout_uncertain'), true);
  // The server read it and said no. Sending it again says the same thing.
  assert.equal(isTransient('validation'), false);
  assert.equal(isTransient('permission_denied'), false);
  assert.equal(isTransient('conflict'), false);
  assert.equal(isTransient('session_expired'), false);
});

it('a refusal on the merits waits for a person, not a timer', () => {
  for (const kind of ['validation', 'permission_denied', 'conflict', 'session_expired'] as const) {
    assert.equal(nextStateAfterError({ kind, message: 'x' }), 'needs_attention');
  }
});

it('a timeout goes back to waiting, because it may already have worked', () => {
  assert.equal(nextStateAfterError({ kind: 'timeout_uncertain', message: 'x' }), 'waiting_for_connection');
});

it('backoff grows but is capped, so a long outage does not end in an hour-long wait', () => {
  assert.equal(backoffMs(1), 2000);
  assert.equal(backoffMs(2), 4000);
  assert.equal(backoffMs(3), 8000);
  assert.equal(backoffMs(50), 5 * 60_000);
});

it('retrying is bounded', () => {
  const item = base({ state: 'waiting_for_connection', attempts: MAX_ATTEMPTS, lastAttemptAt: 0 });
  assert.equal(shouldRetry(item, 1e12), false);
});

it('a fresh item is sent immediately', () => {
  assert.equal(shouldRetry(base({ state: 'waiting_for_connection' }), 1000), true);
});

it('an item mid-backoff is left alone', () => {
  const item = base({ state: 'waiting_for_connection', attempts: 3, lastAttemptAt: 1000 });
  assert.equal(shouldRetry(item, 1000 + 7999), false);
  assert.equal(shouldRetry(item, 1000 + 8000), true);
});

// ── Session identity ────────────────────────────────────────────────────────

const session = { companyId: 'C1', branchId: 'B1', userId: 'U1' };

it('an item never replays under a different company', () => {
  assert.equal(belongsToSession(base({ companyId: 'C2' }), session), false);
});

it('nor a different branch', () => {
  assert.equal(belongsToSession(base({ branchId: 'B2' }), session), false);
});

it('nor a different user on the same shared phone', () => {
  assert.equal(belongsToSession(base({ userId: 'U2' }), session), false);
});

it('the wrong session is a refusal to send, not a silent drop', () => {
  const d = decideReplay(base({ state: 'waiting_for_connection', userId: 'U2' }), session, 1e6);
  assert.deepEqual(d, { send: false, reason: 'wrong_session' });
});

it('an operation reclassified since it was stored is refused at replay', () => {
  // A build that decides sales may no longer be queued must not send one that
  // an older build had already written to disk.
  const d = decideReplay(base({ kind: 'sale.create', state: 'waiting_for_connection' }), session, 1e6);
  assert.deepEqual(d, { send: false, reason: 'not_queueable' });
});

// ── Ordering ────────────────────────────────────────────────────────────────

it('items go out oldest first', () => {
  const a = base({ id: 'a', createdAt: 300 });
  const b = base({ id: 'b', createdAt: 100 });
  const c = base({ id: 'c', createdAt: 200 });
  assert.deepEqual(orderForReplay([a, b, c]).map((i) => i.id), ['b', 'c', 'a']);
});

it('two reports against the same loan keep their order', () => {
  const first = base({ id: 'f', createdAt: 100, state: 'waiting_for_connection', payload: { loanId: 'L1' } });
  const second = base({ id: 's', createdAt: 200, state: 'waiting_for_connection', payload: { loanId: 'L1' } });
  const out = nextSendable([second, first], session, 1e6);
  assert.deepEqual(out.map((i) => i.id), ['f'], 'only the older one may go now');
});

it('independent subjects do not block each other', () => {
  const l1 = base({ id: 'l1', createdAt: 100, state: 'waiting_for_connection', payload: { loanId: 'L1' } });
  const l2 = base({ id: 'l2', createdAt: 200, state: 'waiting_for_connection', payload: { loanId: 'L2' } });
  assert.deepEqual(nextSendable([l1, l2], session, 1e6).map((i) => i.id).sort(), ['l1', 'l2']);
});

it('one item needing a decision does not freeze unrelated work', () => {
  const stuck = base({ id: 'stuck', createdAt: 100, state: 'needs_attention', payload: { loanId: 'L1' } });
  const other = base({ id: 'other', createdAt: 200, state: 'waiting_for_connection', payload: { loanId: 'L2' } });
  assert.deepEqual(nextSendable([stuck, other], session, 1e6).map((i) => i.id), ['other']);
});

it('but it does hold back the rest of its own group', () => {
  const stuck = base({ id: 'stuck', createdAt: 100, state: 'needs_attention', payload: { loanId: 'L1' } });
  const after = base({ id: 'after', createdAt: 200, state: 'waiting_for_connection', payload: { loanId: 'L1' } });
  assert.deepEqual(nextSendable([stuck, after], session, 1e6), []);
});

// ── What the shop is told ───────────────────────────────────────────────────

it('nothing is green until the server has agreed', () => {
  assert.equal(toneFor('synced'), 'success');
  for (const s of ['draft', 'waiting_for_connection', 'sending', 'needs_attention'] as QueueState[]) {
    assert.notEqual(toneFor(s), 'success', `${s} must not look like success`);
  }
});

it('only synced and cancelled are finished', () => {
  assert.deepEqual([...TERMINAL_STATES].sort(), ['cancelled', 'synced']);
});

it('cancelling is offered only while nothing has been sent', () => {
  assert.equal(mayCancel(base({ state: 'draft' })), true);
  assert.equal(mayCancel(base({ state: 'waiting_for_connection' })), true);
  assert.equal(mayCancel(base({ state: 'needs_attention' })), true);
  // Mid-flight the outcome is unknown, and synced already happened.
  assert.equal(mayCancel(base({ state: 'sending' })), false);
  assert.equal(mayCancel(base({ state: 'synced' })), false);
});

function base(over: Partial<QueueItem> = {}): QueueItem {
  return {
    id: 'i1',
    kind: 'loan.payment.report',
    clientUuid: '00000000-0000-7000-8000-000000000000',
    companyId: 'C1',
    branchId: 'B1',
    userId: 'U1',
    payloadVersion: 1,
    payload: { loanId: 'L1', amount: 500 },
    state: 'draft',
    createdAt: 0,
    lastAttemptAt: null,
    attempts: 0,
    summary: 'Payment report',
    lastError: null,
    ...over,
  };
}

console.log(`offline policy and queue rules: ${passed} passed`);
