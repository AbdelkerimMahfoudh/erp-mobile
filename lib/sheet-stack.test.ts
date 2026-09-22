/**
 * Dialogs over sheets — proved without a screen.
 *
 *   node lib/sheet-stack.test.ts
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isTopSheet, useSheetStack } from './sheet-stack.ts';

const read = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

it('the most recently opened sheet is the top one, and closing it hands over', () => {
  const { push, remove } = useSheetStack.getState();
  push('a'); push('b');
  assert.equal(isTopSheet(useSheetStack.getState().ids, 'b'), true);
  assert.equal(isTopSheet(useSheetStack.getState().ids, 'a'), false);
  remove('b');
  assert.equal(isTopSheet(useSheetStack.getState().ids, 'a'), true);
  remove('a');
  assert.equal(isTopSheet(useSheetStack.getState().ids, 'a'), false);
});

it('re-opening a sheet moves it to the top rather than listing it twice', () => {
  const { push, remove } = useSheetStack.getState();
  push('a'); push('b'); push('a');
  assert.deepEqual(useSheetStack.getState().ids, ['b', 'a']);
  remove('a'); remove('b');
});

it('the root dialog host yields while a sheet is open, and the top sheet draws the dialog', () => {
  const host = code(read('components/overlay/DialogHost.tsx'));
  assert.match(host, /useSheetStack\(\(s\) => s\.ids\.length > 0\)/, 'the root host checks for open sheets');
  assert.match(host, /export function SheetDialogLayer/, 'a sheet can host the dialog');
  const sheet = code(read('components/overlay/BottomSheet.tsx'));
  assert.match(sheet, /<SheetDialogLayer sheetId=\{sheetId\} \/>/, 'the sheet renders the dialog layer inside its own modal');
  assert.match(sheet, /useSheetStack/, 'the sheet registers itself while mounted');
});

it('the sale flow never stacks the approval sheet on the payment sheet', () => {
  for (const file of ['app/quick-sell.tsx', 'app/(tabs)/sell.tsx']) {
    const src = code(read(file));
    const at = src.indexOf("case 'approval_required'");
    assert.ok(at > 0, `${file} handles approval_required`);
    const branch = src.slice(at, src.indexOf('setApprovalRequest(', at));
    assert.match(branch, /setPaymentOpen\(false\)/, `${file}: the payment sheet closes before the approval sheet opens`);
  }
});

console.log('sheet-stack: all assertions passed');
