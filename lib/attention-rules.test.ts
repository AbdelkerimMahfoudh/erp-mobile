/**
 * The alerts preview: three newest on the overview, the rest behind "view all".
 *
 *   node lib/attention-rules.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ATTENTION_PREVIEW, anomalyKind, attentionPreview, hasMoreAlerts } from './attention-rules.ts';

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `k${i + 1}` }));

describe('the overview shows the three newest, and says when there are more', () => {
  it('shows nothing and asks for nothing when there is nothing', () => {
    assert.deepEqual(attentionPreview([], 0), { shown: [], total: 0, showAll: false });
  });

  it('one alert is one row, with no "view all"', () => {
    const p = attentionPreview(rows(1), 1);
    assert.equal(p.shown.length, 1);
    assert.equal(p.showAll, false);
  });

  it('exactly three fill the preview and still owe no "view all"', () => {
    const p = attentionPreview(rows(3), 3);
    assert.equal(p.shown.length, 3);
    assert.equal(p.showAll, false);
  });

  it('four show three and offer the fourth behind "view all 4"', () => {
    const p = attentionPreview(rows(3), 4);
    assert.deepEqual(p.shown.map((r) => r.key), ['k1', 'k2', 'k3']);
    assert.equal(p.total, 4);
    assert.equal(p.showAll, true);
  });

  it('many show three, in the server’s order, and count them all', () => {
    const p = attentionPreview(rows(3), 40);
    assert.equal(p.shown.length, ATTENTION_PREVIEW);
    assert.deepEqual(p.shown.map((r) => r.key), ['k1', 'k2', 'k3']);
    assert.equal(p.total, 40);
    assert.equal(p.showAll, true);
  });

  it('never trusts a total smaller than what it was handed', () => {
    // A stale total must not hide rows that are already on the screen.
    const p = attentionPreview(rows(5), 2);
    assert.equal(p.shown.length, 3);
    assert.equal(p.total, 5);
    assert.equal(p.showAll, true);
  });
});

describe('the full list', () => {
  it('asks for another page only while one exists', () => {
    assert.equal(hasMoreAlerts({ page: 1, pageSize: 20, total: 21 }), true);
    assert.equal(hasMoreAlerts({ page: 2, pageSize: 20, total: 21 }), false);
    assert.equal(hasMoreAlerts({ page: 1, pageSize: 20, total: 20 }), false);
    assert.equal(hasMoreAlerts({ page: 1, pageSize: 20, total: 0 }), false);
  });

  it('names the rule behind a code', () => {
    assert.equal(anomalyKind('anomaly.dead_stock'), 'dead_stock');
    assert.equal(anomalyKind('anomaly.below_cost_cluster'), 'below_cost_cluster');
    assert.equal(anomalyKind('something.else'), 'something.else');
  });
});
