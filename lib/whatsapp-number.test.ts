/**
 * A WhatsApp number as the server stores it (`whatsapp-number.ts`).
 *
 *   node lib/whatsapp-number.test.ts
 *
 * The cases are the server's own: what `normalisePhone` and `toE164` make of what a person types, in the order the
 * server tries them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whatsAppNumber } from './whatsapp-number.ts';

test('a number typed the way it is printed is the one the server stores', () => {
  assert.equal(whatsAppNumber('43 21 09 87'), '+22243210987');
  assert.equal(whatsAppNumber('43210987'), '+22243210987');
  assert.equal(whatsAppNumber('+222 43210987'), '+22243210987');
  assert.equal(whatsAppNumber('(+222) 4321-0987'), '+22243210987');
  assert.equal(whatsAppNumber('22243210987'), '+22243210987');
  assert.equal(whatsAppNumber(' 4999.8877 '), '+22249998877');
});

test('a number from abroad is kept as written, with its plus', () => {
  assert.equal(whatsAppNumber('+33 6 12 34 56 78'), '+33612345678');
  assert.equal(whatsAppNumber('33612345678'), '+33612345678');
  // Nine to fifteen digits are kept as written — a leading 00 included, as the server does.
  assert.equal(whatsAppNumber('0022243210987'), '+0022243210987');
  // Past fifteen digits, the server reads a leading 00 as the plus.
  assert.equal(whatsAppNumber('0022243210987654'), '+22243210987654');
});

test('what is not a number is none', () => {
  for (const raw of ['', '   ', '1234567', 'abc', '+222 4321 098x', '++22243210987']) assert.equal(whatsAppNumber(raw), null, JSON.stringify(raw));
});
