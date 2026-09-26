/**
 * The Daily closing report's own small rules (docs/51).
 *
 *   node lib/closing-report-view.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  actionKey,
  actionNeeds,
  canConfirmClose,
  canSendCorrection,
  channelLabel,
  KNOWN_REFUSALS,
  pendingKey,
  reasonGiven,
  refusalKey,
  targetIdFor,
  reportFreshness,
  verificationKey,
  verificationTone,
  warningKey,
} from './closing-report-view.ts';

let passed = 0;
function it(name: string, fn: () => void) {
  fn();
  passed += 1;
}

it('only a count is a verification; nothing unchecked is ever shown green', () => {
  assert.equal(verificationTone('counted', 0), 'success');
  // A counted channel with a difference is a question, not a match.
  assert.equal(verificationTone('counted', -300), 'warning');
  assert.equal(verificationTone('not_verified', null), 'warning');
  assert.equal(verificationTone('stale', null), 'warning');
  assert.equal(verificationTone('skipped', null), 'neutral');
  assert.equal(verificationTone('not_counted', null), 'neutral');
  assert.equal(verificationKey('not_verified'), 'dailyReport.verify.not_verified');
  // An account is checked against its app, never counted: its own words for the two states that would say "counted".
  assert.equal(verificationKey('counted', 'account'), 'dailyReport.verify.account.counted');
  assert.equal(verificationKey('stale', 'account'), 'dailyReport.verify.account.stale');
  assert.equal(verificationKey('not_counted', 'account'), 'dailyReport.verify.not_counted');
  assert.equal(verificationKey('counted', 'cash'), 'dailyReport.verify.counted');
});

it('closing never waits for a count — only for live figures and, when needed, an acknowledgement with a reason', () => {
  const base = { canClose: true, freshness: 'live' as const, requiresAcknowledgement: false, acknowledged: false, reason: '', busy: false };
  // Every channel counted, or nothing to acknowledge: closable at once.
  assert.equal(canConfirmClose(base), true);
  // Some balance unchecked: the acknowledgement AND a written reason are both required.
  assert.equal(canConfirmClose({ ...base, requiresAcknowledgement: true }), false);
  assert.equal(canConfirmClose({ ...base, requiresAcknowledgement: true, acknowledged: true }), false);
  assert.equal(canConfirmClose({ ...base, requiresAcknowledgement: true, acknowledged: true, reason: '  ' }), false);
  assert.equal(canConfirmClose({ ...base, requiresAcknowledgement: true, acknowledged: true, reason: 'Bankily app down' }), true);
  assert.equal(canConfirmClose({ ...base, requiresAcknowledgement: true, acknowledged: false, reason: 'Bankily app down' }), false);
  // Never on stale or offline figures, never twice at once, never without the authority.
  assert.equal(canConfirmClose({ ...base, freshness: 'stale' }), false);
  assert.equal(canConfirmClose({ ...base, freshness: 'offline' }), false);
  assert.equal(canConfirmClose({ ...base, busy: true }), false);
  assert.equal(canConfirmClose({ ...base, canClose: false }), false);
});

it('a reason is something written, three characters or more', () => {
  assert.equal(reasonGiven(''), false);
  assert.equal(reasonGiven(' ab '), false);
  assert.equal(reasonGiven('App'), true);
});

it('figures are live only when just read and the phone is online', () => {
  const now = 1_000_000;
  assert.equal(reportFreshness(now - 30_000, true, now), 'live');
  assert.equal(reportFreshness(now - 300_000, true, now), 'stale');
  assert.equal(reportFreshness(now - 1_000, false, now), 'offline');
  assert.equal(reportFreshness(0, true, now), 'stale');
});

it('every warning has a catalogue key, and an unknown one falls back rather than showing a code', () => {
  assert.equal(warningKey('cost_missing'), 'dailyReport.warning.cost_missing');
  assert.equal(warningKey('channels_not_verified'), 'dailyReport.warning.channels_not_verified');
  assert.equal(warningKey('something_new'), 'dailyReport.warning.other');
});

it('refusals are words, never codes', () => {
  assert.equal(refusalKey(null), null);
  assert.equal(refusalKey('already_corrected'), 'correctTx.refusal.already_corrected');
  assert.equal(refusalKey('mystery'), 'correctTx.refusal.other');
});

it('cash and unattributed money are named by the catalogue; an account by its own label', () => {
  const words = { cash: 'Cash', unattributed: 'No account' };
  assert.equal(channelLabel({ channel: 'cash', label: 'CASH' }, words), 'Cash');
  assert.equal(channelLabel({ channel: 'account', isUnattributed: true, label: 'UNATTRIBUTED' }, words), 'No account');
  assert.equal(channelLabel({ channel: 'account', label: 'Bankily' }, words), 'Bankily');
});

// ── The correction path (docs/51 §15) ──

const here = dirname(fileURLToPath(import.meta.url));
const en = readFileSync(join(here, 'i18n', 'en.ts'), 'utf8');
const hasKey = (k: string) => en.includes(`  '${k}':`);
const ACTIONS = ['cancel_sale', 'reverse_payment', 'reclassify_payment', 'reverse_expense', 'reclassify_purchase_payment', 'cancel_purchase'] as const;

it('every refusal the server names has its own sentence in the catalogue', () => {
  for (const code of KNOWN_REFUSALS) {
    assert.equal(refusalKey(code), `correctTx.refusal.${code}`);
    assert.ok(hasKey(`correctTx.refusal.${code}`), code);
  }
  assert.ok(hasKey('correctTx.refusal.other'));
});

it('every action has a name, a hint, an explanation and a reason example', () => {
  for (const a of ACTIONS) {
    assert.equal(actionKey(a), `correctTx.action.${a}`);
    for (const k of [`correctTx.action.${a}`, `correctTx.hint.${a}`, `correctTx.explain.${a}`, `correctTx.reason.placeholder.${a}`]) assert.ok(hasKey(k), k);
    if (actionNeeds(a).amount) assert.ok(hasKey(`correctTx.amount.${a}`), a);
  }
});

it('only a part-correction asks for an amount, and only a move asks where the money went', () => {
  assert.deepEqual(actionNeeds('cancel_sale'), { amount: false, destination: false });
  assert.deepEqual(actionNeeds('cancel_purchase'), { amount: false, destination: false });
  assert.deepEqual(actionNeeds('reverse_payment'), { amount: true, destination: false });
  assert.deepEqual(actionNeeds('reverse_expense'), { amount: true, destination: false });
  assert.deepEqual(actionNeeds('reclassify_payment'), { amount: true, destination: true });
  assert.deepEqual(actionNeeds('reclassify_purchase_payment'), { amount: true, destination: true });
});

it('a correction is sent only on a clean preview, a real amount, a chosen channel and a written reason', () => {
  const ok = { action: 'reverse_expense' as const, amount: 400, maxAmount: 1000, destinationChosen: false, reason: 'Typed 5 000 for 500', previewOk: true, refused: false, busy: false };
  assert.equal(canSendCorrection(ok), true);
  assert.equal(canSendCorrection({ ...ok, reason: '  ' }), false);
  assert.equal(canSendCorrection({ ...ok, previewOk: false }), false);
  assert.equal(canSendCorrection({ ...ok, refused: true }), false);
  assert.equal(canSendCorrection({ ...ok, busy: true }), false);
  assert.equal(canSendCorrection({ ...ok, amount: 0 }), false);
  assert.equal(canSendCorrection({ ...ok, amount: 1000.01 }), false);
  assert.equal(canSendCorrection({ ...ok, action: 'reclassify_payment' }), false); // no channel chosen
  assert.equal(canSendCorrection({ ...ok, action: 'reclassify_payment', destinationChosen: true }), true);
  assert.equal(canSendCorrection({ ...ok, action: 'cancel_sale', amount: null }), true); // a cancellation takes no amount
});

it('a request waiting for the Owner is said as what it would do', () => {
  assert.equal(pendingKey({ targetKind: 'sale', action: 'cancel' }), 'correctTx.pending.sale.cancel');
  assert.equal(pendingKey({ targetKind: 'sale_payment', action: 'reverse' }), 'correctTx.pending.sale_payment.reverse');
  assert.equal(pendingKey({ targetKind: 'purchase', action: 'cancel' }), 'correctTx.pending.purchase.cancel');
  assert.equal(pendingKey({ targetKind: 'mystery', action: 'x' }), 'correctTx.pending.other');
  for (const k of ['sale.cancel', 'sale_payment.reverse', 'sale_payment.reclassify', 'expense.reverse', 'supplier_payment.reclassify', 'purchase.cancel', 'refund_payout.reverse', 'supplier_settlement.reverse', 'other']) {
    assert.ok(hasKey(`correctTx.pending.${k}`), k);
  }
});


it('each action corrects the right record: a purchase row is its payment, cancelling acts on the purchase', () => {
  const purchaseRow = { kind: 'purchase', id: 'sp-1', detail: { purchaseId: 'pu-1' } };
  assert.equal(targetIdFor(purchaseRow, 'cancel_purchase'), 'pu-1');
  assert.equal(targetIdFor(purchaseRow, 'reclassify_purchase_payment'), 'sp-1');
  const paymentRow = { kind: 'payment', id: 'pa-1', detail: { saleId: 'sa-1' } };
  assert.equal(targetIdFor(paymentRow, 'reverse_payment'), 'pa-1');
  assert.equal(targetIdFor(paymentRow, 'reclassify_payment'), 'pa-1');
  assert.equal(targetIdFor(paymentRow, 'cancel_sale'), 'sa-1');
  assert.equal(targetIdFor({ kind: 'sale', id: 'sa-2', detail: {} }, 'cancel_sale'), 'sa-2');
  assert.equal(targetIdFor({ kind: 'expense', id: 'ex-1', detail: {} }, 'reverse_expense'), 'ex-1');
});
console.log(`closing-report-view: ${passed} passed`);
