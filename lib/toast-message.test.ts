import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeToastMessage } from './toast-message.ts';

test('a real message passes through, trimmed', () => {
  assert.deepEqual(safeToastMessage('error', '  This IMEI has already been sold ', 'fallback'), { message: 'This IMEI has already been sold', wasBlank: false });
});

test('a blank error or warning is said in the app’s own words, never as an empty box', () => {
  for (const blank of ['', '   ', undefined, null, 42]) {
    assert.deepEqual(safeToastMessage('error', blank, 'Something went wrong.'), { message: 'Something went wrong.', wasBlank: true });
    assert.deepEqual(safeToastMessage('warning', blank, 'Something went wrong.'), { message: 'Something went wrong.', wasBlank: true });
  }
});

test('a blank success or info is not shown at all', () => {
  assert.deepEqual(safeToastMessage('success', '', 'x'), { message: null, wasBlank: true });
  assert.deepEqual(safeToastMessage('info', undefined, 'x'), { message: null, wasBlank: true });
});
