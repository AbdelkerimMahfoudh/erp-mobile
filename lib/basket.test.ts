import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeLines, useBasket } from './basket.ts';

const unit = (identifier: string) => ({ key: identifier, kind: 'unit', identifier, quantity: 1 });
const counted = (productId: string, quantity: number) => ({ key: productId, kind: 'quantity', productId, quantity });

test('a restored draft and a fresh choice are both kept, a device once', () => {
  assert.deepEqual(mergeLines([unit('A')], [unit('A'), unit('B')]).map((l) => l.identifier), ['A', 'B']);
});

test('a counted product adds up', () => {
  assert.equal(mergeLines([counted('P', 2)], [counted('P', 1)])[0]!.quantity, 3);
});

test('nothing restored keeps what was chosen', () => {
  assert.deepEqual(mergeLines([], [unit('A')]), [unit('A')]);
});

test('picks are handed over once', () => {
  useBasket.getState().reset();
  useBasket.getState().queue([{ kind: 'unit', identifier: 'A' }]);
  assert.equal(useBasket.getState().take().length, 1);
  assert.equal(useBasket.getState().take().length, 0);
});
