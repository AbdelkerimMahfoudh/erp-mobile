/**
 * The Daily closing report's own small rules (docs/51).
 *
 *   node lib/closing-report-view.test.ts
 */
import assert from 'node:assert/strict';
import {
  canConfirmClose,
  channelLabel,
  reasonGiven,
  refusalKey,
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

console.log(`closing-report-view: ${passed} passed`);
