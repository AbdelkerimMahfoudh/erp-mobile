import { it } from 'node:test';
import assert from 'node:assert/strict';
import { dayRangeShape } from './day-range';

it('a span of days says only what it has to', () => {
  assert.equal(dayRangeShape('2026-09-18', '2026-09-18'), 'day');
  assert.equal(dayRangeShape('2026-09-14', '2026-09-18'), 'month');
  assert.equal(dayRangeShape('2026-08-28', '2026-09-03'), 'year');
  assert.equal(dayRangeShape('2025-12-29', '2026-01-04'), 'full');
});
