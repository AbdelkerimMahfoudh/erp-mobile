/**
 * What a draft may be, pinned (Milestone J.1).
 *
 *   node lib/offline/draft-schema.test.ts
 *
 * Drafts are the one place the app deliberately keeps a shop's work on a device
 * that may be shared, lost or sold. The rules about what may be written, and
 * whose work may be read back, are the whole reason that is acceptable.
 */
import assert from 'node:assert/strict';
import {
  containsForbidden,
  draftKey,
  DRAFT_SCHEMA_VERSION,
  isDraftEnvelope,
  isReadable,
  isWritable,
  MAX_DRAFT_BYTES,
} from './draft-schema.ts';

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

const scope = { companyId: 'C1', branchId: 'B1', userId: 'U1' };

// ── Scope isolation is structural ───────────────────────────────────────────

it('a different user opens a different file', () => {
  assert.notEqual(
    draftKey('sell.cart', scope),
    draftKey('sell.cart', { ...scope, userId: 'U2' }),
  );
});

it('a different branch opens a different file', () => {
  assert.notEqual(
    draftKey('sell.cart', scope),
    draftKey('sell.cart', { ...scope, branchId: 'B2' }),
  );
});

it('a different company opens a different file', () => {
  assert.notEqual(
    draftKey('sell.cart', scope),
    draftKey('sell.cart', { ...scope, companyId: 'C2' }),
  );
});

it('a different form opens a different file', () => {
  assert.notEqual(draftKey('sell.cart', scope), draftKey('expense.form', scope));
});

it('the same form about a different record opens a different file', () => {
  // An investigation note about return A must never surface on return B.
  assert.notEqual(
    draftKey('return.investigation', scope, 'ret-a'),
    draftKey('return.investigation', scope, 'ret-b'),
  );
});

it('a record-scoped draft is distinct from the record-less one', () => {
  assert.notEqual(draftKey('f', scope, 'r1'), draftKey('f', scope, null));
});

it('the same scope is stable across calls, or nothing would ever be found', () => {
  assert.equal(draftKey('f', scope, 'r1'), draftKey('f', { ...scope }, 'r1'));
});

it('a branchless scope is valid, because company-level work exists', () => {
  const k = draftKey('f', { ...scope, branchId: null });
  assert.ok(k.includes('none'), k);
});

it('a hostile id cannot escape the drafts directory', () => {
  const k = draftKey('../../etc/passwd', { ...scope, companyId: '../..' }, '/../..');
  assert.ok(!k.includes('/'), k);
  assert.ok(!k.includes('..'), k);
});

// ── Versioning ──────────────────────────────────────────────────────────────

it('an envelope from a foreign schema version is not readable', () => {
  const e = { version: DRAFT_SCHEMA_VERSION + 1, payloadVersion: 1, savedAt: 1, value: {} };
  assert.equal(isReadable(e, 1), false);
});

it('an envelope from a foreign PAYLOAD version is not readable either', () => {
  // The form's own shape changed. Reading it field by field under today's
  // assumptions fails quietly, which is worse than failing loudly.
  const e = { version: DRAFT_SCHEMA_VERSION, payloadVersion: 1, savedAt: 1, value: {} };
  assert.equal(isReadable(e, 2), false);
  assert.equal(isReadable(e, 1), true);
});

it('a malformed envelope is rejected rather than half-read', () => {
  assert.equal(isDraftEnvelope(null), false);
  assert.equal(isDraftEnvelope('nonsense'), false);
  assert.equal(isDraftEnvelope({ version: 1 }), false);
  assert.equal(isDraftEnvelope({ version: 1, payloadVersion: 1, savedAt: 'now' }), false);
  assert.equal(isDraftEnvelope({ version: 1, payloadVersion: 1, savedAt: 1 }), true);
});

// ── What may never reach the disk ───────────────────────────────────────────

it('a credential is refused before any write happens', () => {
  assert.equal(isWritable({ password: 'x' }).ok, false);
  assert.equal(isWritable({ accessToken: 'x' }).ok, false);
  assert.equal(isWritable({ refresh_token: 'x' }).ok, false);
  assert.equal(isWritable({ OTP: '123456' }).ok, false);
});

it('so is a photograph, an OCR frame or a spreadsheet', () => {
  // Large, often sensitive, and there is no lifecycle that would clean them up.
  assert.equal(isWritable({ photo: 'file://x.jpg' }).ok, false);
  assert.equal(isWritable({ base64: 'AAAA' }).ok, false);
  assert.equal(isWritable({ imageData: [1, 2, 3] }).ok, false);
  assert.equal(isWritable({ fileContent: 'PK...' }).ok, false);
});

it('including one buried deep, or inside an array', () => {
  assert.equal(containsForbidden({ a: { b: { c: { token: 'x' } } } }), true);
  assert.equal(containsForbidden([{ ok: 1 }, { photo: 'x' }]), true);
  assert.equal(containsForbidden({ a: { b: { amount: 5 } } }), false);
});

it('an ordinary form is allowed through', () => {
  assert.equal(isWritable({ category: 'Transport', amount: '750', note: 'taxi' }).ok, true);
});

it('a draft that is really a server response is refused as too large', () => {
  const huge = { rows: Array.from({ length: 5000 }, (_, i) => ({ i, name: 'a'.repeat(40) })) };
  const result = isWritable(huge);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, 'too_large');
  assert.ok(JSON.stringify(huge).length > MAX_DRAFT_BYTES);
});

it('something unserialisable is refused rather than written wrong', () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.equal(isWritable(circular).ok, false);
});

it('a reference to a photo is fine; the photo itself is not', () => {
  // The distinction the rule turns on: a short string naming a file is a note,
  // and the bytes of that file are an attachment nobody would ever clean up.
  assert.equal(isWritable({ evidenceRef: 'receipt-2026-08.jpg' }).ok, true);
  assert.equal(isWritable({ photo: 'data:image/jpeg;base64,AAA' }).ok, false);
});

console.log(`draft schema: ${passed} passed`);
