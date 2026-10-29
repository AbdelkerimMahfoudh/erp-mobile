/**
 * Where a new business came from (0103, D221): the promo code's boxes and the one source a registration carries.
 *
 * Run directly with Node (type-stripping):
 *   node lib/acquisition.test.ts
 * Exits non-zero on any failure.
 */
import assert from 'node:assert/strict';
import {
  acquisitionPending,
  backspaceAt,
  claimOf,
  digitsOf,
  mustChoose,
  noAcquisition,
  typedInto,
  withCode,
  withLink,
  withoutCode,
  withoutInvitation,
  type AcquisitionState,
} from './acquisition.ts';

const arabicIndic = (s: string) => s.replace(/[0-9]/g, (d) => String.fromCharCode(0x0660 + Number(d)));
const eastern = (s: string) => s.replace(/[0-9]/g, (d) => String.fromCharCode(0x06f0 + Number(d)));
const usable = (s: AcquisitionState, name = 'Sidi'): AcquisitionState => ({ ...s, lookup: { kind: 'usable', name } });

// ── The boxes ───────────────────────────────────────────────────────────────
assert.equal(digitsOf(arabicIndic('012345')), '012345');
assert.equal(digitsOf(eastern('6789')), '6789');
assert.equal(digitsOf('12 3-4a'), '1234');

// Typing moves on one digit at a time; a paste anywhere fills from that box; leading zeroes stay; never more than six.
assert.equal(typedInto('', 0, '0'), '0');
assert.equal(typedInto('00', 2, '4'), '004');
assert.equal(typedInto('', 0, '004217'), '004217');
assert.equal(typedInto('12', 2, arabicIndic('345678')), '123456');
assert.equal(typedInto('123', 1, '9'), '19');
assert.equal(typedInto('123', 3, 'x'), '123', 'a letter changes nothing');

// Backspace clears the box, or the one before an empty box, and says where the cursor goes.
assert.deepEqual(backspaceAt('12345', 5), ['1234', 4]);
assert.deepEqual(backspaceAt('12345', 2), ['12', 2]);
assert.deepEqual(backspaceAt('', 0), ['', 0]);

// ── No source: the registration it always was ───────────────────────────────
assert.equal(claimOf(noAcquisition), null);
assert.equal(acquisitionPending(noAcquisition), false);

// ── A typed code ────────────────────────────────────────────────────────────
let s = withCode(noAcquisition, '00421');
s = withCode(s, '004217');
assert.deepEqual(s.lookup, { kind: 'checking' }, 'six digits are checked at once');
assert.equal(claimOf(s), null, 'an unchecked code carries nothing');
assert.equal(claimOf({ ...s, lookup: { kind: 'unavailable' } }), null, 'an unavailable code carries nothing');
assert.equal(acquisitionPending({ ...s, lookup: { kind: 'checking' } }), true, 'the form waits for a check');
assert.deepEqual(claimOf(usable(s)), { promoCode: '004217' });
assert.deepEqual(withoutCode(usable(s)), noAcquisition, 'removing it leaves no source');

// ── A promoter's QR card ────────────────────────────────────────────────────
const qr = withLink({ ...noAcquisition, token: 'TOKEN' }, { usable: true, source: 'promoter', promoterName: 'Sidi', code: '004217' });
assert.equal(qr.code, '004217', 'the code is prefilled');
assert.deepEqual(qr.lookup, { kind: 'usable', name: 'Sidi' }, 'with the display name');
assert.deepEqual(claimOf(qr), { referralToken: 'TOKEN' }, 'the QR is its own source');
const edited = withCode(qr, '00421');
assert.equal(edited.token, null, 'changing the code lets the QR go');
assert.equal(claimOf(edited), null);
assert.deepEqual(claimOf(usable(withCode(edited, '771903'))), { promoCode: '771903' }, 'a different code becomes a typed one');
assert.equal(withoutCode(qr).token, null);
assert.equal(claimOf(withoutCode(qr)), null);

// ── An address that is no longer usable: a notice, and the ordinary registration ──
const stale = withLink({ ...noAcquisition, token: 'OLD' }, { usable: false });
assert.equal(stale.token, null);
assert.equal(claimOf(stale), null);
assert.equal(acquisitionPending({ ...noAcquisition, token: 'T' }), true, 'the form waits until the address is asked about');

// ── An invitation, and the choice when a code arrives too ───────────────────
const invited = withLink({ ...noAcquisition, token: 'INVITE' }, { usable: true, source: 'user_invite' });
assert.deepEqual(claimOf(invited), { referralToken: 'INVITE' });
assert.equal(claimOf(withoutInvitation(invited)), null, 'continue without the invitation');
const both = usable(withCode(invited, '004217'));
assert.equal(mustChoose(both), true, 'an invitation and a usable code: the registrant chooses');
assert.equal(claimOf(both), null, 'and nothing is sent until they do');
assert.equal(acquisitionPending(both), true);
assert.deepEqual(claimOf(withoutInvitation(both)), { promoCode: '004217' }, 'keep the code');
assert.deepEqual(claimOf(withoutCode(both)), { referralToken: 'INVITE' }, 'keep the invitation');
assert.deepEqual(claimOf({ ...withCode(invited, '004217'), lookup: { kind: 'unavailable' } }), { referralToken: 'INVITE' }, 'an unavailable code leaves the invitation');

console.log('acquisition: all assertions passed');
