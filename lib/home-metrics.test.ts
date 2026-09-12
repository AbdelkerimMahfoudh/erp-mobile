/**
 * What Home may work out for itself — and what it must never invent.
 *
 *   node lib/home-metrics.test.ts
 *
 * The arithmetic here is small on purpose. Most of this file exists to pin the
 * ABSENT cases: a hidden cost must not become a zero profit, a missing arrival
 * date must not become "arrived today", and a phone moved between branches must
 * not look newly delivered. Each of those is a number a seller would act on.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  daysInStock,
  expectedGrossProfit,
  isStale,
  monthToDate,
  STALE_AFTER_MS,
} from './home-metrics.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`✗ ${name}`);
    throw e;
  }
};

// ── The month window ────────────────────────────────────────────────────────

it('this month so far runs from the first of the month to today', () => {
  assert.deepEqual(monthToDate(new Date('2026-09-12T04:24:00.000Z')), {
    from: '2026-09-01',
    to: '2026-09-12',
  });
});

it('on the first of the month the window is that one day, not an empty range', () => {
  assert.deepEqual(monthToDate(new Date('2026-09-01T00:05:00.000Z')), {
    from: '2026-09-01',
    to: '2026-09-01',
  });
});

it('crosses a year boundary without losing the year', () => {
  assert.deepEqual(monthToDate(new Date('2027-01-03T09:00:00.000Z')), {
    from: '2027-01-01',
    to: '2027-01-03',
  });
});

// ── Days in stock ───────────────────────────────────────────────────────────

it('counts whole days on the shelf', () => {
  const now = new Date('2026-09-12T04:00:00.000Z');
  assert.equal(daysInStock('2026-09-02T04:00:00.000Z', now), 10);
});

it('a phone received today is nought days old, not one', () => {
  const now = new Date('2026-09-12T23:00:00.000Z');
  assert.equal(daysInStock('2026-09-12T01:00:00.000Z', now), 0);
});

it('an unknown arrival date is null — never zero', () => {
  // Zero would read as "arrived today" on a card a seller prices from.
  assert.equal(daysInStock(null), null);
  assert.equal(daysInStock(undefined), null);
  assert.equal(daysInStock(''), null);
  assert.equal(daysInStock('not-a-date'), null);
});

it('a phone clock running behind the server never reports a negative age', () => {
  const now = new Date('2026-09-12T04:00:00.000Z');
  assert.equal(daysInStock('2026-09-13T04:00:00.000Z', now), 0);
});

// ── Expected gross profit ───────────────────────────────────────────────────

it('is the proposed price less the cost', () => {
  assert.equal(expectedGrossProfit(38_000, 30_000), 8_000);
});

it('reports a loss honestly rather than flooring at zero', () => {
  assert.equal(expectedGrossProfit(25_000, 30_000), -5_000);
});

it('is null when cost is hidden — a withheld cost is not a free phone', () => {
  // Without `cost.view` the server strips `cost` entirely. Treating that as 0
  // would show the whole selling price as profit.
  assert.equal(expectedGrossProfit(38_000, undefined), null);
  assert.equal(expectedGrossProfit(38_000, null), null);
});

it('is null when no price has been proposed yet', () => {
  assert.equal(expectedGrossProfit(null, 30_000), null);
  assert.equal(expectedGrossProfit(undefined, 30_000), null);
});

it('rounds to whole cents rather than carrying float noise', () => {
  assert.equal(expectedGrossProfit(0.3, 0.1), 0.2);
});

// ── Staleness ───────────────────────────────────────────────────────────────

it('a figure fetched just now is not stale', () => {
  const now = Date.now();
  assert.equal(isStale(now - 1000, now), false);
});

it('a figure older than the window is stale and can say so', () => {
  const now = Date.now();
  assert.equal(isStale(now - STALE_AFTER_MS - 1, now), true);
});

it('never-fetched is not "stale" — there is nothing old to warn about', () => {
  assert.equal(isStale(null), false);
  assert.equal(isStale(undefined), false);
});

// ── Structural: Home must not grow its own profit arithmetic ────────────────

it('does not compute profit, revenue or a comparison of its own', () => {
  /*
   * The shop has ONE definition of profit and it lives on the server. If a
   * subtraction of revenue, COGS or expenses ever appears here, Home has
   * started answering a question `/home` and `/analytics/summary` already
   * answer — and the two will drift.
   *
   * `expectedGrossProfit` is deliberately exempt: it is a quote for a sale that
   * has not happened, from two server-supplied numbers, and is never a recorded
   * figure.
   */
  const source = readFileSync(new URL('./home-metrics.ts', import.meta.url), 'utf8');
  for (const forbidden of ['cogs', 'netOperatingProfit', 'changePercent', 'previousPeriod']) {
    assert.equal(
      source.includes(forbidden),
      false,
      `home-metrics must not derive ${forbidden} — the server owns it`,
    );
  }
});

it('says out loud that its period boundaries are UTC', () => {
  // The gap is real and recorded; what must not happen is it being silent.
  const source = readFileSync(new URL('./home-metrics.ts', import.meta.url), 'utf8');
  assert.ok(source.includes('UTC'), 'the timezone limitation must be stated in the source');
});

console.log(`home-metrics: ${passed} passed`);
