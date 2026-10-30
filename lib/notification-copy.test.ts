import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { en } from './i18n/en.ts';
import { fr } from './i18n/fr.ts';
import { ar } from './i18n/ar.ts';
import { NOTIFICATION_TYPES, isolate, notificationCopy, type CopyFormat, type Translate } from './notification-copy.ts';

/**
 * Every catalogued event, in every language, from its structured fields (D225): a title and a body, no placeholder
 * left, no English shown to a French or Arabic reader, the store and the person in the reader's script, and values
 * isolated so they keep their order in an Arabic sentence.
 */

const DICTS = { en, fr, ar } as Record<string, Record<string, string>>;
const translator = (language: string): Translate => (key, params = {}) => {
  const text = DICTS[language][key];
  assert.ok(text !== undefined, `${language}: missing ${key}`);
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
};
const fmt: CopyFormat = { money: (n) => `${n} MRU`, date: (d) => d, dateTime: (d) => d.slice(0, 16) };

const UUID = '0192f0c4-7b1a-7c3e-9a55-1f2e3d4c5b6a';
/** One realistic payload per type, as the server stores it. */
const SAMPLES: Record<(typeof NOTIFICATION_TYPES)[number], Record<string, unknown>> = {
  'sale.recorded': { event: 'recorded', invoiceNo: 'INV-1042', total: 12500, items: 2 },
  'stock.received': { event: 'received', items: 5 },
  'price.changed': { event: 'changed', product: 'Galaxy A15', previous: 4000, next: 3800, scope: 'unit', actor: 'Sidi', actorAr: 'سيدي' },
  'closing.completed': { event: 'completed', date: '2026-10-30', check: 'counted' },
  'closing.reopened': { event: 'reopened', businessDate: '2026-10-30', time: '21:04' },
  'closing.reclosed': { event: 'reclosed', businessDate: '2026-10-30', time: '22:10' },
  'closing.sale': { event: 'sale', businessDate: '2026-10-30', time: '22:31', total: 900 },
  'debt.charged': { event: 'charged', amount: 1500 },
  'loan.proposed': { event: 'proposed', amount: 20000, from: 'Kiffa Phones', fromAr: 'هواتف كيفة' },
  'consignment.requested': { event: 'requested', units: 3, amount: 9000, from: 'Kiffa Phones', fromAr: 'هواتف كيفة' },
  'discount_approval.requested': { event: 'requested', requestedPrice: 3500, configuredPrice: 4000 },
  'discount_approval.approved': { event: 'approved', approvedPrice: 3600 },
  'discount_approval.rejected': { event: 'rejected', note: null },
  'return.requested': { returnId: UUID, invoiceNo: 'INV-1042' },
  'return.custody_received': { returnId: UUID, invoiceNo: 'INV-1042' },
  'return.under_review': { returnId: UUID, invoiceNo: 'INV-1042' },
  'return.approved': { returnId: UUID, invoiceNo: 'INV-1042' },
  'return.rejected': { returnId: UUID, invoiceNo: 'INV-1042' },
  'return.refund_reported': { returnId: UUID, invoiceNo: 'INV-1042' },
  'return.refund_corrected': { returnId: UUID, invoiceNo: 'INV-1042' },
  'return.refund_confirmed': { returnId: UUID, invoiceNo: 'INV-1042' },
  ...(Object.fromEntries(
    (['requested', 'created_approved', 'approved', 'rejected', 'shipped', 'received', 'cancelled'] as const).map((e) => [
      `transfer.${e}`,
      { event: e, transferNo: 'TR-0007', fromBranch: 'Tevragh Zeina', fromBranchAr: 'تفرغ زينة', toBranch: 'Ksar', toBranchAr: 'لكصر', units: 2, actor: 'Mariem', actorAr: 'مريم', reason: null },
    ]),
  ) as Record<`transfer.${string}`, Record<string, unknown>>),
  'anomaly.overdue_debt': { event: 'anomaly.overdue_debt', count: 4, amount: 52000 },
  'anomaly.cash_shortfall': { event: 'anomaly.cash_shortfall', count: 3, amount: 2500, days: 7 },
  'anomaly.below_cost_cluster': { event: 'anomaly.below_cost_cluster', seller: 'Ahmed', count: 4, days: 7 },
  'staff.role_changed': { role: 'store_manager' },
  'acting_owner.appointed': { delegationId: UUID, startsAt: '2026-11-01T06:00:00.000Z', endsAt: '2026-11-08T06:00:00.000Z' },
  'acting_owner.revoked': { delegationId: UUID },
} as never;

const BRANCH = { name: 'Tevragh Zeina', nameAr: 'تفرغ زينة' };
const LATIN_WORD = /\b[A-Za-z]{3,}\b/;

describe('every catalogued event is worded in all three languages (D225)', () => {
  for (const type of NOTIFICATION_TYPES) {
    for (const language of ['en', 'fr', 'ar']) {
      it(`${type} · ${language}`, () => {
        const copy = notificationCopy({ type, payload: SAMPLES[type], branch: BRANCH }, translator(language), language, fmt);
        assert.ok(copy.title.length > 0 && copy.body.length > 0);
        assert.doesNotMatch(copy.title + copy.body, /\{\w+\}/, 'a placeholder left');
        // Never the generic fallback when the fields are there.
        assert.notEqual(copy.body, translator(language)('notifications.body.open'), 'composed from its fields');
        if (language === 'ar') {
          // No Latin word outside an isolated value (references, amounts and names keep their own direction).
          const outside = (copy.title + ' ' + copy.body).replace(/⁨[^⁩]*⁩/g, '');
          assert.doesNotMatch(outside, LATIN_WORD, `English in the Arabic copy: ${outside}`);
          assert.equal(copy.store, isolate('تفرغ زينة'));
        } else {
          assert.equal(copy.store, isolate('Tevragh Zeina'));
        }
      });
    }
  }
});

describe('names in the reader’s script', () => {
  it('a transfer names the stores and the person in Arabic for an Arabic reader, in Latin otherwise', () => {
    const p = SAMPLES['transfer.shipped'];
    const arabic = notificationCopy({ type: 'transfer.shipped', payload: p }, translator('ar'), 'ar', fmt);
    assert.match(arabic.body, /مريم/);
    assert.match(arabic.body, /تفرغ زينة/);
    assert.match(arabic.title, /لكصر/);
    const french = notificationCopy({ type: 'transfer.shipped', payload: p }, translator('fr'), 'fr', fmt);
    assert.match(french.body, /Mariem/);
    assert.match(french.title, /Ksar/);
  });

  it('a name without its Arabic form shows the one it has', () => {
    const copy = notificationCopy({ type: 'loan.proposed', payload: { amount: 100, from: 'Kiffa Phones', fromAr: null } }, translator('ar'), 'ar', fmt);
    assert.match(copy.body, /Kiffa Phones/);
  });
});

describe('older rows and unknown types', () => {
  it('a row stored before its fields existed says "open it" in the reader’s language — never the stored English', () => {
    for (const language of ['fr', 'ar']) {
      const copy = notificationCopy({ type: 'sale.recorded', payload: null }, translator(language), language, fmt);
      assert.equal(copy.body, translator(language)('notifications.body.open'));
      assert.equal(copy.title, translator(language)('notifications.kind.sale.recorded'));
    }
  });

  it('a type this build does not know reads as "New activity", never as a key', () => {
    const copy = notificationCopy({ type: 'something.new', payload: { x: 1 } }, translator('ar'), 'ar', fmt);
    assert.equal(copy.title, translator('ar')('notifications.kind.other'));
  });

  it('values are isolated so an Arabic sentence keeps their order', () => {
    const copy = notificationCopy({ type: 'sale.recorded', payload: SAMPLES['sale.recorded'] }, translator('ar'), 'ar', fmt);
    assert.ok(copy.body.includes(isolate('INV-1042')));
    assert.ok(copy.body.includes(isolate('12500 MRU')));
  });
});
