/**
 * Telling apart the four ways a request can go wrong (Milestone J).
 *
 *   node lib/offline/classify.test.ts
 *
 * The one that matters most is the timeout. Treating it as a failure is how a
 * shop gets told to report a payment it has already reported; treating it as a
 * success is how a payment silently never reaches the server.
 */
import assert from 'node:assert/strict';
import { classifyError, needsHuman, RequestTimeout } from './classify.ts';
import { containsCredential, fileNameFor, isQueueItem, QUEUE_SCHEMA_VERSION } from './queue-schema.ts';
import { isTransient, nextStateAfterError } from './queue-rules.ts';

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

const status = (n: number) => ({ status: n, message: 'from the server' });

it('a timeout is uncertain, not failed', () => {
  assert.equal(classifyError(new RequestTimeout()).kind, 'timeout_uncertain');
  assert.equal(classifyError({ name: 'AbortError', message: 'aborted' }).kind, 'timeout_uncertain');
});

it('and so it is retried rather than handed to a person', () => {
  // The request may already have been processed. Retrying with the same client
  // UUID either finds that record or creates it; either way there is one.
  assert.equal(isTransient('timeout_uncertain'), true);
  assert.equal(nextStateAfterError({ kind: 'timeout_uncertain', message: '' }), 'waiting_for_connection');
});

it('an expired session is its own case', () => {
  assert.equal(classifyError(status(401)).kind, 'session_expired');
});

it('a refused permission is not a network problem', () => {
  assert.equal(classifyError(status(403)).kind, 'permission_denied');
  assert.equal(isTransient('permission_denied'), false);
});

it('a lapsed subscription is its own kind, and never loops', () => {
  /*
    Milestone K. Both this and a role refusal stop, so neither can retry
    forever — but telling somebody they lack permission when the shop simply
    has not renewed sends them to the wrong person entirely.
  */
  const e = classifyError({ status: 403, code: 'ENTITLEMENT_WRITE_BLOCKED', message: 'Subscription ended' });
  assert.equal(e.kind, 'entitlement_blocked');
  assert.equal(isTransient('entitlement_blocked'), false);
  assert.equal(needsHuman('entitlement_blocked'), true);
  assert.equal(nextStateAfterError(e), 'needs_attention');
});

it('an ordinary role refusal is still permission_denied', () => {
  assert.equal(classifyError({ status: 403, message: 'Not allowed' }).kind, 'permission_denied');
});

it('a conflict is a question for a person', () => {
  assert.equal(classifyError(status(409)).kind, 'conflict');
  assert.equal(needsHuman('conflict'), true);
});

it('a vanished record is a conflict, because retrying cannot bring it back', () => {
  assert.equal(classifyError(status(404)).kind, 'conflict');
  assert.equal(classifyError(status(410)).kind, 'conflict');
});

it('a bad request is validation, and stops', () => {
  assert.equal(classifyError(status(422)).kind, 'validation');
  assert.equal(needsHuman('validation'), true);
});

it('a server fault is worth another try', () => {
  assert.equal(classifyError(status(500)).kind, 'server_error');
  assert.equal(classifyError(status(503)).kind, 'server_error');
  assert.equal(isTransient('server_error'), true);
});

it('an unreachable server is distinguished from a dead radio by connectivity state', () => {
  // Both are a TypeError from fetch. Which of the two it is cannot be known
  // from the error alone, so the state derived from real requests decides.
  assert.equal(classifyError(new TypeError('Network request failed'), true).kind, 'api_unreachable');
  assert.equal(classifyError(new TypeError('Network request failed'), false).kind, 'no_network');
});

it('the server wording is kept, because it was written for a person', () => {
  assert.equal(classifyError({ status: 409, message: 'That IMEI has already been sold' }).message,
    'That IMEI has already been sold');
});

it('something unrecognisable never claims to be a permission problem', () => {
  assert.equal(classifyError('a string').kind, 'server_error');
  assert.equal(classifyError(null).kind, 'server_error');
});

// ── What may be written to disk ─────────────────────────────────────────────

const item = {
  id: 'i', kind: 'expense.submit', clientUuid: 'u', companyId: 'c', userId: 'x',
  branchId: 'b', payloadVersion: 1, payload: { amount: 5 }, state: 'draft',
  createdAt: 1, lastAttemptAt: null, attempts: 0, summary: 'Expense', lastError: null,
};

it('a well-formed item is accepted', () => {
  assert.equal(isQueueItem(item), true);
});

it('a branchless item is still valid, because company-level work exists', () => {
  assert.equal(isQueueItem({ ...item, branchId: null }), true);
});

it('a malformed item is refused rather than half-read', () => {
  assert.equal(isQueueItem({ ...item, createdAt: 'yesterday' }), false);
  assert.equal(isQueueItem({ ...item, id: 42 }), false);
  assert.equal(isQueueItem(null), false);
  assert.equal(isQueueItem('nonsense'), false);
});

it('nothing carrying a credential may be queued', () => {
  // Tokens must never be persisted in a payload. Checking here means that
  // survives somebody adding a convenient field in a later milestone.
  assert.equal(isQueueItem({ ...item, payload: { accessToken: 'abc' } }), false);
  assert.equal(isQueueItem({ ...item, payload: { password: 'abc' } }), false);
});

it('including one buried inside the payload', () => {
  assert.equal(containsCredential({ a: { b: { refreshToken: 'x' } } }), true);
  assert.equal(containsCredential({ a: { b: { amount: 5 } } }), false);
});

it('and a differently-spelled one', () => {
  assert.equal(containsCredential({ access_token: 'x' }), true);
  assert.equal(containsCredential({ 'Authorization': 'Bearer x' }), true);
  assert.equal(containsCredential({ OTP: '123456' }), true);
});

it('the schema is versioned, so a foreign file is recognised rather than misread', () => {
  assert.equal(typeof QUEUE_SCHEMA_VERSION, 'number');
});

it('one scope cannot open the file of another', () => {
  const a = fileNameFor({ companyId: 'C1', branchId: 'B1', userId: 'U1' });
  assert.notEqual(a, fileNameFor({ companyId: 'C1', branchId: 'B1', userId: 'U2' }));
  assert.notEqual(a, fileNameFor({ companyId: 'C1', branchId: 'B2', userId: 'U1' }));
  assert.notEqual(a, fileNameFor({ companyId: 'C2', branchId: 'B1', userId: 'U1' }));
});

it('a hostile id cannot escape the queue directory', () => {
  const name = fileNameFor({ companyId: '../../etc', branchId: null, userId: 'U1' });
  assert.ok(!name.includes('/'), name);
  assert.ok(!name.includes('..'), name);
});

console.log(`error classification and queue storage: ${passed} passed`);
