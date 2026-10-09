/**
 * A branch's activity, as the phone reads it (docs/21 D156).
 *
 *   node lib/activity.test.ts
 */
import assert from 'node:assert/strict';
import { ACTIVITIES, activityAllows, branchActivity, companySells, isActivity, scheduledActivity } from './activity.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`FAIL  ${name}`);
    throw e;
  }
};

const entitlement = {
  seatsByStore: [
    { branchId: 'shop', name: 'Shop', activity: 'electronics', activityNext: null },
    { branchId: 'counter', name: 'Counter', activity: 'money_agent', activityNext: null },
    { branchId: 'mixed', name: 'Mixed', activity: 'both', activityNext: 'money_agent' },
  ],
};

it('the three activities, and nothing else, are activities', () => {
  assert.deepEqual([...ACTIVITIES], ['electronics', 'money_agent', 'both']);
  for (const a of ACTIVITIES) assert.equal(isActivity(a), true);
  for (const bad of ['', 'agent', 'ELECTRONICS', null, undefined, 1]) assert.equal(isActivity(bad), false, String(bad));
});

it('both satisfies either need; a branch of one activity satisfies only its own; no need is always met', () => {
  assert.equal(activityAllows('both', 'electronics'), true);
  assert.equal(activityAllows('both', 'money_agent'), true);
  assert.equal(activityAllows('electronics', 'electronics'), true);
  assert.equal(activityAllows('electronics', 'money_agent'), false);
  assert.equal(activityAllows('money_agent', 'money_agent'), true);
  assert.equal(activityAllows('money_agent', 'electronics'), false);
  for (const a of ACTIVITIES) assert.equal(activityAllows(a, undefined), true);
});

it('a branch’s activity is read off its own line of the entitlement', () => {
  assert.equal(branchActivity(entitlement, 'shop'), 'electronics');
  assert.equal(branchActivity(entitlement, 'counter'), 'money_agent');
  assert.equal(branchActivity(entitlement, 'mixed'), 'both');
});

it('electronics when the server did not say: no entitlement, an older server, an unknown branch, no branch', () => {
  assert.equal(branchActivity(undefined, 'shop'), 'electronics');
  assert.equal(branchActivity(null, 'shop'), 'electronics');
  assert.equal(branchActivity({}, 'shop'), 'electronics', 'a server older than the activity sends no seatsByStore');
  assert.equal(branchActivity({ seatsByStore: [{ branchId: 'shop' }] }, 'shop'), 'electronics', 'a line without an activity');
  assert.equal(branchActivity({ seatsByStore: [{ branchId: 'shop', activity: '' }] }, 'shop'), 'electronics', 'a coerced empty enum is not an activity');
  assert.equal(branchActivity(entitlement, 'elsewhere'), 'electronics');
  assert.equal(branchActivity(entitlement, null), 'electronics');
});

it('a scheduled downgrade is read, never acted on', () => {
  assert.equal(scheduledActivity(entitlement, 'mixed'), 'money_agent');
  assert.equal(scheduledActivity(entitlement, 'shop'), null);
  assert.equal(scheduledActivity(undefined, 'shop'), null);
  // The branch keeps its activity until the renewal applies the change (docs/73 §3.2).
  assert.equal(branchActivity(entitlement, 'mixed'), 'both');
});

it('the company sells while one of its branches does — and on an older server, which has only shops', () => {
  assert.equal(companySells(entitlement), true, 'a shop and a combined branch');
  assert.equal(companySells({ seatsByStore: [{ branchId: 'counter', activity: 'money_agent' }] }), false, 'agent counters only');
  assert.equal(companySells({ seatsByStore: [{ branchId: 'counter', activity: 'money_agent' }, { branchId: 'mixed', activity: 'both' }] }), true);
  assert.equal(companySells({ seatsByStore: [{ branchId: 'old' }] }), true, 'a line without an activity is a shop');
  assert.equal(companySells({}), true);
  assert.equal(companySells(undefined), true);
});

console.log(`activity: ${passed} passed`);
