import { it } from 'node:test';
import assert from 'node:assert/strict';
import { endChoicesFor, endOf, startOf } from './acting-owner.ts';

/** The Acting Owner's start and end choices (D225), in Africa/Nouakchott (UTC+0). */

const NOW = new Date('2026-10-29T21:30:00Z');

it('now sends no start; tomorrow morning is 08:00 shop time the next day', () => {
  assert.equal(startOf('now', NOW), null);
  assert.equal(startOf('tomorrow_morning', NOW)?.toISOString(), '2026-10-30T08:00:00.000Z');
});

it('ends are the last second of the shop’s day, counted from the start', () => {
  assert.equal(endOf('until_revoked', NOW, null), null);
  assert.equal(endOf('end_of_today', NOW, null)?.toISOString(), '2026-10-29T23:59:59.000Z');
  assert.equal(endOf('in_3_days', NOW, null)?.toISOString(), '2026-11-01T23:59:59.000Z');
  assert.equal(endOf('in_7_days', NOW, startOf('tomorrow_morning', NOW))?.toISOString(), '2026-11-06T23:59:59.000Z');
});

it('a month and a year turn over cleanly', () => {
  assert.equal(endOf('in_3_days', new Date('2026-12-30T10:00:00Z'), null)?.toISOString(), '2027-01-02T23:59:59.000Z');
});

it('never offers an end before the start', () => {
  assert.deepEqual([...endChoicesFor('tomorrow_morning')], ['until_revoked', 'in_3_days', 'in_7_days']);
  assert.ok(endChoicesFor('now').includes('end_of_today'));
});
