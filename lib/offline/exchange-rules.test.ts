/**
 * A refused offline exchange has a clear outcome (D161), pinned: every row of
 * the refusal table, the lost answers, the bounded attempts, an older build's
 * file brought forward, and the status lookup's three answers — never a blind
 * resend.
 *
 *   node lib/offline/exchange-rules.test.ts
 */
import assert from 'node:assert/strict';
import { AGENT_EXCHANGE_KIND, type ExchangePayload } from './agent-exchange.ts';
import { classifyError, RequestTimeout } from './classify.ts';
import {
  CONFLICT_ERROR,
  exchangeStateAfterError,
  exchangeStateWhenExhausted,
  exchangeStatusPath,
  lastFour,
  lookupAnswerOf,
  lookupDue,
  lookupsDue,
  mayCheckAgain,
  mayResend,
  normaliseExchange,
  normaliseQueue,
  refusalCodeOf,
  resolveLookup,
  resubmitAction,
  sameExchange,
  type LookupAnswer,
  type ServerExchange,
} from './exchange-rules.ts';
import { backoffMs, MAX_ATTEMPTS, type ClassifiedError, type QueueItem, type QueueState } from './queue-rules.ts';

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

/** An HTTP refusal as the API client throws it, classified as the queue sees it. */
const refused = (status: number, code?: string): ClassifiedError => classifyError({ status, code, message: `HTTP ${status}` });

const session = { companyId: 'c1', branchId: 'b1', userId: 'u1' };
const payload: ExchangePayload = { providerId: 'bankily', direction: 'cash_in_credit_out', amount: 10_000, configVersionId: 'cfg-7', deviceRecordedAt: '2026-10-10T09:00:00.000Z' };
const item = (over: Partial<QueueItem> = {}): QueueItem => ({
  id: 'i1', kind: AGENT_EXCHANGE_KIND, clientUuid: '11111111-1111-4111-8111-111111111111', ...session, payloadVersion: 1, payload,
  state: 'waiting_for_connection', createdAt: 1, lastAttemptAt: null, attempts: 0, summary: 'Cash in, credit out · 10 000 MRU · Bankily', lastError: null, ...over,
});
const tx = (over: Partial<ServerExchange> = {}): ServerExchange => ({
  id: 't-1', branchId: 'b1', status: 'completed', direction: 'cash_in_credit_out', providerId: 'bankily', providerLabel: 'Bankily', amount: 10_000, commission: 200,
  customerNumberMasked: '•••• 3456', businessDate: '2026-10-10', recordedAt: '2026-10-10T09:00:02.000Z', recordedByName: 'Employee Boutique 2', configVersionId: 'cfg-7',
  deviceRecordedAt: '2026-10-10T09:00:00.000Z', ...over,
});

// ── The refusal table ───────────────────────────────────────────────────────

it('every refusal of the table lands in its state — and nothing rejected is ever "waiting"', () => {
  const table: [ClassifiedError, QueueState, ReturnType<typeof resubmitAction>][] = [
    [refused(403, 'ENTITLEMENT_WRITE_BLOCKED'), 'rejected_resubmit', 'send_again'],
    [refused(403, 'activity_not_subscribed'), 'rejected_reenter', null],
    [refused(403, 'permission_denied'), 'rejected_reenter', null],
    [refused(403), 'rejected_reenter', null],
    [refused(403, 'branch_access_denied'), 'rejected_reenter', null],
    [refused(403, 'branch_inactive'), 'rejected_reenter', null],
    [refused(400, 'provider_inactive'), 'rejected_resubmit', 'send_again'],
    [refused(409, 'provider_not_configured'), 'rejected_resubmit', 'review_and_send'],
    [refused(409, 'stale_configuration'), 'rejected_resubmit', 'review_and_send'],
    [refused(409, 'store_closed'), 'rejected_resubmit', 'send_again'],
    [refused(400, 'customer_number_invalid'), 'rejected_resubmit', 'edit_and_send'],
    [refused(400, 'reference_required'), 'rejected_resubmit', 'edit_and_send'],
    [refused(400), 'rejected_resubmit', 'edit_and_send'],
    [refused(422), 'rejected_resubmit', 'edit_and_send'],
    [{ kind: 'validation', code: 'customer_number_missing', message: 'gone' }, 'rejected_resubmit', 'edit_and_send'],
    [refused(409, 'idempotency_conflict'), 'rejected_reenter', null],
    [refused(409, 'something_new'), 'rejected_resubmit', 'review_and_send'],
    [refused(404, 'provider_not_found'), 'rejected_resubmit', 'review_and_send'],
  ];
  for (const [e, state, action] of table) {
    const label = `${e.status} ${e.code ?? '(no code)'}`;
    const next = exchangeStateAfterError(e, false);
    assert.equal(next, state, label);
    assert.equal(resubmitAction({ state: next, lastError: e }), action, label);
  }
});

it('a front-door refusal on an exchange that may already be recorded is asked about first — the lookup decides', () => {
  for (const code of ['ENTITLEMENT_WRITE_BLOCKED', 'activity_not_subscribed', 'permission_denied', 'branch_access_denied', 'branch_inactive']) {
    assert.equal(exchangeStateAfterError(refused(403, code), true), 'uncertain', code);
  }
  assert.equal(exchangeStateAfterError(refused(403), true), 'uncertain', 'a 403 without a code');
  // The ledger's own refusals are read after the key: they prove nothing is recorded under it.
  for (const [status, code] of [[409, 'stale_configuration'], [409, 'store_closed'], [400, 'provider_inactive'], [400, 'customer_number_invalid']] as const) {
    assert.equal(exchangeStateAfterError(refused(status, code), true), 'rejected_resubmit', code);
  }
  assert.equal(exchangeStateAfterError(refused(409, 'idempotency_conflict'), true), 'rejected_reenter');
});

it('a lost answer is uncertain; a request that never left, a session to renew or a server asking to wait stays where it was', () => {
  assert.equal(exchangeStateAfterError(classifyError(new RequestTimeout()), false), 'uncertain');
  assert.equal(exchangeStateAfterError(refused(500), false), 'uncertain');
  assert.equal(exchangeStateAfterError(refused(503), false), 'uncertain');
  assert.equal(exchangeStateAfterError(classifyError(new Error('unreadable')), false), 'uncertain', 'an answer nobody could read');
  for (const e of [classifyError(new TypeError('Network request failed'), false), classifyError(new TypeError('Network request failed'), true), refused(401), refused(429)]) {
    assert.equal(exchangeStateAfterError(e, false), 'waiting_for_connection', `${e.kind} ${e.status ?? ''}`);
    assert.equal(exchangeStateAfterError(e, true), 'uncertain', `${e.kind} ${e.status ?? ''}, may be recorded`);
  }
});

it('past the bounded attempts an exchange that would wait again is asked about, never left waiting forever', () => {
  assert.equal(exchangeStateWhenExhausted('waiting_for_connection'), 'uncertain');
  for (const s of ['uncertain', 'rejected_resubmit', 'rejected_reenter'] as QueueState[]) assert.equal(exchangeStateWhenExhausted(s), s);
});

it('the refusal code is the server’s when known, otherwise what the status says', () => {
  assert.equal(refusalCodeOf(refused(409, 'store_closed')), 'store_closed');
  assert.equal(refusalCodeOf(refused(403)), 'permission_denied');
  assert.equal(refusalCodeOf(refused(403, 'ENTITLEMENT_WRITE_BLOCKED')), 'ENTITLEMENT_WRITE_BLOCKED');
  assert.equal(refusalCodeOf(refused(409, 'unheard_of')), 'conflict');
  assert.equal(refusalCodeOf(refused(410)), 'conflict');
  assert.equal(refusalCodeOf(refused(400)), 'validation');
});

it('only an exchange whose moment was wrong is sent again unchanged; nothing rejected goes on its own', () => {
  const rejected = (code: string, status: number) => item({ state: 'rejected_resubmit', lastError: refused(status, code) });
  assert.equal(mayResend(rejected('store_closed', 409)), true);
  assert.equal(mayResend(rejected('ENTITLEMENT_WRITE_BLOCKED', 403)), true);
  assert.equal(mayResend(rejected('provider_inactive', 400)), true);
  assert.equal(mayResend(rejected('stale_configuration', 409)), false, 'review first');
  assert.equal(mayResend(rejected('customer_number_invalid', 400)), false, 'edit first');
  assert.equal(mayResend(item({ state: 'rejected_reenter', lastError: refused(409, 'idempotency_conflict') })), false);
  assert.equal(mayResend(item({ state: 'uncertain', lastError: refused(500) })), false, 'asked, never resent');
  assert.equal(mayResend(item({ state: 'waiting_for_connection' })), false);
  // Another kind keeps Milestone J's "Try again" on what needs a person.
  assert.equal(mayResend(item({ kind: 'expense.submit', state: 'needs_attention' })), true);
});

// ── An older build's file ───────────────────────────────────────────────────

it('an older build’s exchanges are brought into the six states at load — the file’s version untouched', () => {
  // May have been recorded: uncertain, whatever state it was left in; the flag is not carried forward.
  for (const state of ['waiting_for_connection', 'needs_attention', 'sending'] as QueueState[]) {
    const n = normaliseExchange(item({ state, mayBeRecorded: true, lastError: refused(409, 'idempotency_conflict') }));
    assert.equal(n.state, 'uncertain', state);
    assert.equal('mayBeRecorded' in n, false);
  }
  // Mid-send when the app stopped: its answer was lost.
  assert.equal(normaliseExchange(item({ state: 'sending' })).state, 'uncertain');
  // Needed a person: rejected, by its refusal.
  assert.equal(normaliseExchange(item({ state: 'needs_attention', lastError: refused(409, 'stale_configuration') })).state, 'rejected_resubmit');
  assert.equal(normaliseExchange(item({ state: 'needs_attention', lastError: refused(409, 'store_closed') })).state, 'rejected_resubmit');
  assert.equal(normaliseExchange(item({ state: 'needs_attention', lastError: refused(403, 'activity_not_subscribed') })).state, 'rejected_reenter');
  assert.equal(normaliseExchange(item({ state: 'needs_attention', lastError: { kind: 'validation', code: 'customer_number_missing', message: 'gone' } })).state, 'rejected_resubmit');
  // An older build gave up on the network after its attempts: waiting again, with a fresh count.
  const net = normaliseExchange(item({ state: 'needs_attention', attempts: MAX_ATTEMPTS, lastAttemptAt: 5, lastError: classifyError(new TypeError('x'), false) }));
  assert.deepEqual([net.state, net.attempts, net.lastAttemptAt], ['waiting_for_connection', 0, null]);
  // Needing a person with no reason kept: only the lookup may decide.
  assert.equal(normaliseExchange(item({ state: 'needs_attention' })).state, 'uncertain');
  // Finished, waiting, or another kind: untouched (the same object, so nothing is written back).
  const done = item({ state: 'synced' });
  assert.equal(normaliseExchange(done), done);
  const waiting = item();
  assert.equal(normaliseExchange(waiting), waiting);
  const other = item({ kind: 'expense.submit', state: 'needs_attention', mayBeRecorded: true });
  assert.equal(normaliseExchange(other), other);
  // A whole file: changed only when something moved.
  assert.equal(normaliseQueue([done, waiting, other]).changed, false);
  const moved = normaliseQueue([done, item({ id: 'x', state: 'sending' })]);
  assert.equal(moved.changed, true);
  assert.deepEqual(moved.items.map((i) => i.state), ['synced', 'uncertain']);
});

// ── The status lookup ───────────────────────────────────────────────────────

it('the lookup asks by the exchange’s own key, company-scoped', () => {
  assert.equal(exchangeStatusPath('11111111-1111-4111-8111-111111111111'), '/agent/transactions/client/11111111-1111-4111-8111-111111111111');
  assert.equal(exchangeStatusPath('a/b?c'), '/agent/transactions/client/a%2Fb%3Fc');
});

it('the lookup’s answer is read strictly — and never keeps a full number, even if one were sent', () => {
  assert.deepEqual(lookupAnswerOf({ recorded: false }), { recorded: false });
  const answer = lookupAnswerOf({ recorded: true, transaction: { ...tx(), customerNumber: '36123456' } }) as Extract<LookupAnswer, { recorded: true }>;
  assert.equal(answer.recorded, true);
  assert.equal(answer.transaction.commission, 200);
  assert.ok(!JSON.stringify(answer).includes('36123456'));
  // A commission as the POST answer shapes it, and a recorder as an object, are read too.
  const shaped = lookupAnswerOf({ recorded: true, transaction: { ...tx(), commission: { amount: 150, configVersionId: 'cfg-7' }, configVersionId: undefined, recordedByName: undefined, recordedBy: { name: 'Manager' } } });
  assert.ok(shaped?.recorded);
  if (shaped?.recorded) {
    assert.equal(shaped.transaction.commission, 150);
    assert.equal(shaped.transaction.configVersionId, 'cfg-7');
    assert.equal(shaped.transaction.recordedByName, 'Manager');
  }
  // Anything else decides nothing: an older server's 404 page, a proxy, half a record.
  for (const junk of [null, undefined, 'html', {}, { recorded: 'yes' }, { recorded: true }, { recorded: true, transaction: { id: 't' } }]) assert.equal(lookupAnswerOf(junk), null);
});

it('recorded and matching → confirmed with the server’s record (time, business day, recorder, commission)', () => {
  const r = resolveLookup(item({ state: 'uncertain', lastError: refused(500) }), { recorded: true, transaction: tx() }, '36123456', { manual: false });
  assert.equal(r.kind, 'confirmed');
  assert.equal(r.changes.state, 'synced');
  assert.equal(r.changes.lastError, null);
  assert.deepEqual(r.changes.result, { id: 't-1', recordedAt: '2026-10-10T09:00:02.000Z', businessDate: '2026-10-10', recordedByName: 'Employee Boutique 2', commission: 200 });
  // The number may be gone from the phone: the other fields decide.
  assert.equal(resolveLookup(item({ state: 'uncertain' }), { recorded: true, transaction: tx() }, null, { manual: true }).kind, 'confirmed');
});

it('recorded and different → not recorded here (idempotency_conflict), with the server’s masked record to show', () => {
  const differences: [string, Partial<ServerExchange>][] = [
    ['amount', { amount: 9_000 }],
    ['direction', { direction: 'cash_out_credit_in' }],
    ['provider', { providerId: 'masrvi' }],
    ['last four digits', { customerNumberMasked: '•••• 9999' }],
    ['configuration version', { configVersionId: 'cfg-6' }],
    ['branch', { branchId: 'b2' }],
  ];
  for (const [what, over] of differences) {
    const r = resolveLookup(item({ state: 'uncertain' }), { recorded: true, transaction: tx(over) }, '36123456', { manual: true });
    assert.equal(r.kind, 'different', what);
    assert.equal(r.changes.state, 'rejected_reenter', what);
    assert.deepEqual(r.changes.lastError, CONFLICT_ERROR, what);
    assert.equal(r.changes.serverRecord?.numberMasked, over.customerNumberMasked ?? '•••• 3456', what);
    assert.ok(!JSON.stringify(r.changes).includes('36123456'), `${what}: never the full number`);
  }
  // A cent of float noise is the same amount; the masked form is compared on its last four digits only.
  assert.equal(sameExchange(item(), tx({ amount: 10_000.001 }), '+222 36 12 34 56'), true);
  assert.equal(lastFour('•••• 3456'), '3456');
  assert.equal(lastFour('12'), null);
});

it('not recorded → pending again under the same key, sent at once; a person’s check starts a fresh count', () => {
  const uncertain = item({ state: 'uncertain', attempts: 3, lastAttemptAt: 100, serverRecord: null });
  const auto = resolveLookup(uncertain, { recorded: false }, null, { manual: false });
  assert.equal(auto.kind, 'not_recorded');
  assert.deepEqual(auto.changes, { state: 'waiting_for_connection', lastAttemptAt: null, serverRecord: null });
  const manual = resolveLookup(uncertain, { recorded: false }, null, { manual: true });
  assert.deepEqual(manual.changes, { state: 'waiting_for_connection', lastAttemptAt: null, serverRecord: null, attempts: 0 });
  // The key is never part of what changes: the resend is the same request.
  assert.equal('clientUuid' in auto.changes || 'clientUuid' in manual.changes, false);
});

it('the automatic lookup is bounded and backs off like a resend; only an uncertain exchange of this session is asked', () => {
  const now = 1_000_000;
  assert.equal(lookupDue(item({ state: 'uncertain', attempts: 1, lastAttemptAt: null }), session, now), true);
  assert.equal(lookupDue(item({ state: 'uncertain', attempts: 2, lastAttemptAt: now - backoffMs(2) + 1 }), session, now), false, 'backing off');
  assert.equal(lookupDue(item({ state: 'uncertain', attempts: 2, lastAttemptAt: now - backoffMs(2) }), session, now), true);
  assert.equal(lookupDue(item({ state: 'uncertain', attempts: MAX_ATTEMPTS }), session, now), false, 'past the bound: a person asks');
  assert.equal(lookupDue(item({ state: 'uncertain' }), { ...session, userId: 'u2' }, now), false, 'another person on the phone');
  for (const s of ['waiting_for_connection', 'sending', 'rejected_resubmit', 'rejected_reenter', 'synced'] as QueueState[]) assert.equal(lookupDue(item({ state: s }), session, now), false, s);
  assert.equal(lookupDue(item({ kind: 'expense.submit', state: 'uncertain' }), session, now), false);
  assert.deepEqual(
    lookupsDue([item({ id: 'b', state: 'uncertain', createdAt: 2 }), item({ id: 'a', state: 'uncertain', createdAt: 1 }), item({ id: 'c' })], session, now).map((i) => i.id),
    ['a', 'b'],
  );
  // "Check again": an uncertain one (or an older build's attention item) of this session, whatever the backoff.
  assert.equal(mayCheckAgain(item({ state: 'uncertain', attempts: MAX_ATTEMPTS, lastAttemptAt: now }), session), true);
  assert.equal(mayCheckAgain(item({ state: 'needs_attention' }), session), true);
  assert.equal(mayCheckAgain(item({ state: 'uncertain' }), null), false);
  assert.equal(mayCheckAgain(item({ state: 'rejected_reenter' }), session), false);
});

console.log(`exchange outcomes (D161): ${passed} passed`);
