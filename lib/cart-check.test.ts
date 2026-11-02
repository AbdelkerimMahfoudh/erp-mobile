import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { needsReview, priceDiffers, reviewKey, saleLines, type CartCheck, type CheckedLine } from './cart-check.ts';

const line = (over: Partial<CheckedLine> = {}): CheckedLine => ({ index: 0, ok: true, problem: null, setPrice: 100, charged: 100, quantity: 1, quantityAvailable: null, lineTotal: 100, ...over });
const check = (lines: CheckedLine[]): CartCheck => ({ ok: lines.every((l) => l.ok), lines, subtotal: 0, discount: 0, total: 0, cartHash: 'h' });
const SELL = readFileSync('app/(tabs)/sell.tsx', 'utf8');

test('one item at its set price goes straight to payment', () => {
  assert.equal(needsReview(check([line()])), false);
});

test('several items, a moved price or a problem are always shown first', () => {
  assert.equal(needsReview(check([line(), line({ index: 1 })])), true);
  assert.equal(needsReview(check([line({ setPrice: 120 })])), true);
  assert.equal(needsReview(check([line({ ok: false, problem: 'unavailable' })])), true);
});

test('a price with nothing set to compare it with has not moved', () => {
  assert.equal(priceDiffers(line({ setPrice: null })), false);
  assert.equal(priceDiffers(line({ setPrice: 100, charged: 100.001 })), false);
});

test('the sale, the check and the approval send the same lines', () => {
  const lines = [{ kind: 'unit', identifier: 'A', quantity: 1, price: 5 }, { kind: 'quantity', productId: 'P', quantity: 2, price: 3 }];
  assert.deepEqual(saleLines(lines), [{ identifier: 'A', price: 5 }, { productId: 'P', quantity: 2, price: 3 }]);
  assert.match(SELL, /lines: saleLines\(lines\),/);
  assert.equal([...SELL.matchAll(/saleLines\(lines\)/g)].length >= 3, true);
});

test('a review belongs to one cart: any change asks again', () => {
  const lines = [{ kind: 'quantity', productId: 'P', quantity: 1, price: 3 }];
  const key = reviewKey(lines, 0);
  assert.notEqual(reviewKey([{ ...lines[0]!, quantity: 2 }], 0), key);
  assert.notEqual(reviewKey([{ ...lines[0]!, price: 4 }], 0), key);
  assert.notEqual(reviewKey(lines, 1), key);
});

test('Sell checks before payment and cannot continue past a line that cannot be sold', () => {
  assert.match(SELL, /api\.post<CartCheck>\('\/sales\/check'/);
  assert.match(SELL, /disabled=\{[^}]*shownReview && !shownReview\.ok/);
});

test('every word is in all three languages', () => {
  for (const lang of ['en', 'fr', 'ar']) {
    const locale = readFileSync(`lib/i18n/${lang}.ts`, 'utf8');
    for (const key of ['sell.review.title', 'sell.review.continue', 'sell.review.setPrice', 'sell.review.problem.unavailable', 'sell.review.problem.not_enough', 'sell.review.problem.price_required', 'sell.addFromStock', 'basket.estimate', 'basket.priceTitle', 'approval.cart.note', 'approvals.cart.together']) {
      assert.ok(locale.includes(`'${key}'`), `${lang} is missing ${key}`);
    }
  }
});
