/**
 * What a scanned payload means (milestone O).
 *
 * Run directly with Node (type-stripping):
 *   node lib/scan/payload.test.ts
 * Exits non-zero on any failure.
 *
 * The dangerous mistakes here are not "failed to read a code". They are reading
 * something that is not a phone AS a phone: a SIM card's ICCID, a device
 * serial, a product barcode. Each of those creates an inventory record for an
 * object that does not exist, with an identifier nobody will ever scan again.
 */
import assert from 'node:assert/strict';
import { classifyScan } from './payload.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log('  ok  ' + name);
};

// Real-shaped IMEIs, each Luhn-valid.
const IMEI_A = '490154203237518';
const IMEI_B = '356938035643809';
const IMEI_C = '351756051523993';

// ── the ordinary cases ───────────────────────────────────────────────────────

it('a raw 15-digit IMEI', () => {
  assert.deepEqual(classifyScan(IMEI_A), { kind: 'imei', primary: IMEI_A, secondary: null });
});

it('a labelled IMEI', () => {
  assert.deepEqual(classifyScan('IMEI: ' + IMEI_A), { kind: 'imei', primary: IMEI_A, secondary: null });
  assert.deepEqual(classifyScan('imei1-' + IMEI_A), { kind: 'imei', primary: IMEI_A, secondary: null });
});

it('whitespace and dashes printed inside the number', () => {
  assert.deepEqual(classifyScan('49 015420 323751 8'), { kind: 'imei', primary: IMEI_A, secondary: null });
  assert.deepEqual(classifyScan('490154-203237-518'), { kind: 'imei', primary: IMEI_A, secondary: null });
});

it('Arabic-Indic digits, because that is presentation and not a guess', () => {
  const arabic = IMEI_A.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));
  assert.deepEqual(classifyScan(arabic), { kind: 'imei', primary: IMEI_A, secondary: null });
});

// ── refusals ─────────────────────────────────────────────────────────────────

it('the wrong length, when it announced itself as an IMEI', () => {
  const r = classifyScan('IMEI: 12345');
  assert.equal(r.kind, 'invalid');
  assert.equal(r.kind === 'invalid' && r.reason, 'length');
});

it('fifteen digits that fail the check digit', () => {
  const broken = IMEI_A.slice(0, 14) + (IMEI_A[14] === '0' ? '1' : '0');
  const r = classifyScan(broken);
  assert.equal(r.kind, 'invalid');
  assert.equal(r.kind === 'invalid' && r.reason, 'checksum');
});

it('a failed checksum is never quietly demoted to "some other barcode"', () => {
  // The two lead to completely different next steps for the person holding the
  // phone, so they must not collapse into one.
  const broken = '490154203237519';
  assert.equal(classifyScan(broken).kind, 'invalid');
});

it('an ICCID is not an IMEI, even though it contains 15-digit runs', () => {
  // 19-20 digits. Sliding a window across this is how a SIM card becomes a
  // phone: some substring passes Luhn roughly one time in ten.
  // The second one is Luhn-valid as a whole 20-digit number, which is exactly
  // why length has to be checked and not just the checksum.
  for (const iccid of ['8923301000005204512', '89014103211118510720']) {
    const r = classifyScan(iccid);
    assert.notEqual(r.kind, 'imei', iccid + ' must never classify as an IMEI');
  }
});

it('an EID is not an IMEI', () => {
  const eid = '89049032005008882600033489411875';
  assert.notEqual(classifyScan(eid).kind, 'imei');
});

it('an ordinary product barcode is handed to the server, not read as an IMEI', () => {
  for (const code of ['5901234123457', '036000291452', '4006381333931']) {
    assert.deepEqual(classifyScan(code), { kind: 'other', code });
  }
});

it('an alphanumeric code is not guessed at locally', () => {
  // A device serial and a Code128 product label look alike from here. The
  // server owns that distinction, and guessing is how a serial ends up
  // prefilling the Product barcode field.
  assert.deepEqual(classifyScan('SN-8837XQ2'), { kind: 'other', code: 'SN-8837XQ2' });
});

it('an empty payload', () => {
  assert.deepEqual(classifyScan(''), { kind: 'empty' });
  assert.deepEqual(classifyScan('   \n '), { kind: 'empty' });
});

// ── dual SIM ─────────────────────────────────────────────────────────────────

it('one QR carrying both labelled IMEIs is ONE phone', () => {
  const qr = 'IMEI1: ' + IMEI_A + '\nIMEI2: ' + IMEI_B;
  assert.deepEqual(classifyScan(qr), { kind: 'imei', primary: IMEI_A, secondary: IMEI_B });
});

it('the labels decide which is primary, not the order they were printed', () => {
  const qr = 'IMEI2: ' + IMEI_B + '\nIMEI1: ' + IMEI_A;
  assert.deepEqual(classifyScan(qr), { kind: 'imei', primary: IMEI_A, secondary: IMEI_B });
});

it('other delimiters carry two IMEIs just as well', () => {
  for (const sep of [';', ',', '|']) {
    assert.deepEqual(classifyScan(IMEI_A + sep + IMEI_B), {
      kind: 'imei',
      primary: IMEI_A,
      secondary: IMEI_B,
    });
  }
});

it('the same number under both labels is one identifier, not two', () => {
  const r = classifyScan('IMEI1: ' + IMEI_A + '\nIMEI2: ' + IMEI_A);
  assert.deepEqual(r, { kind: 'imei', primary: IMEI_A, secondary: null });
});

it('more than two plausible IMEIs is refused, and the choice handed back', () => {
  const r = classifyScan([IMEI_A, IMEI_B, IMEI_C].join('\n'));
  assert.equal(r.kind, 'ambiguous');
  assert.deepEqual(r.kind === 'ambiguous' && r.candidates, [IMEI_A, IMEI_B, IMEI_C]);
});

// ── the thing OCR was allowed to do and a barcode is not ─────────────────────

it('never substitutes a character for a digit', () => {
  // `lib/imei.ts` would read O→0 from a photograph and ask a human to confirm.
  // From a barcode there is nothing to confirm: the payload is exact, so an
  // `O` makes this simply not an IMEI.
  const withLetter = 'O' + IMEI_A.slice(1);
  assert.notEqual(classifyScan(withLetter).kind, 'imei');
});

console.log('\n' + passed + ' passed');
