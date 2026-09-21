import { it } from 'node:test';
import assert from 'node:assert/strict';
import { previewCashAfterExpense } from './expense-rules';

it('the review previews the drawer after a cash expense, and never below what was typed', () => {
  assert.deepEqual(previewCashAfterExpense(26_200, 200), { before: 26_200, expense: 200, after: 26_000 });
  assert.deepEqual(previewCashAfterExpense(26_200, 0), { before: 26_200, expense: 0, after: 26_200 });
  assert.deepEqual(previewCashAfterExpense(26_200, Number.NaN), { before: 26_200, expense: 0, after: 26_200 });
  assert.deepEqual(previewCashAfterExpense(100, 250.005), { before: 100, expense: 250.01, after: -150.01 }, 'a shortfall is shown as one');
});
