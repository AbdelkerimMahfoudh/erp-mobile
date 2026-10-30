import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createOpenGate, notificationRoute, pushedNotificationId, type NotificationTargetKind } from './notification-route.ts';

const ID = '0192f0c4-7b1a-7c3e-9a55-1f2e3d4c5b6a';
const UNIT = '0192f0c4-7b1a-7c3e-9a55-aaaaaaaaaaaa';
const ME = '0192f0c4-7b1a-7c3e-9a55-bbbbbbbbbbbb';

describe('notificationRoute — each kind opens its own screen (D225)', () => {
  const cases: [NotificationTargetKind, string | null, string | null, string][] = [
    ['sale', ID, null, `/sales/${ID}`],
    ['return', ID, null, `/returns/${ID}`],
    ['approval', ID, null, `/approvals/${ID}`],
    ['transfer', ID, null, `/transfers/${ID}`],
    ['loan', ID, null, `/loans/${ID}`],
    ['consignment', ID, null, `/consignments/${ID}`],
    ['discrepancy', ID, null, `/discrepancies/${ID}`],
    ['expense', ID, null, `/expenses/${ID}`],
    ['closing_day', null, '2026-10-30', '/closing?date=2026-10-30'],
    ['closing_day', null, null, '/closing'],
    ['stock', null, null, '/inventory'],
    ['product', ID, null, `/catalog/${ID}`],
    ['product', ID, UNIT, `/catalog/${ID}?unit=${UNIT}`],
    ['analytics', null, null, '/analytics'],
    ['staff', ME, null, '/account'],
    ['staff', ID, null, '/team'],
    ['acting_owner', null, null, '/acting-owner'],
  ];
  for (const [kind, id, detail, route] of cases) {
    it(`${kind} ${detail ?? ''} → ${route}`, () => assert.equal(notificationRoute({ kind, id, detail }, ME), route));
  }

  it('every route is one of the app’s own paths', () => {
    for (const [kind, id, detail] of cases) assert.match(notificationRoute({ kind, id, detail }, ME)!, /^\/[a-z]/);
  });

  it('an unknown kind, or an id that is not one, opens nothing', () => {
    assert.equal(notificationRoute({ kind: 'settings', id: null, detail: null }, ME), null);
    assert.equal(notificationRoute({ kind: 'sale', id: '../../x', detail: null }, ME), null);
    assert.equal(notificationRoute({ kind: 'sale', id: null, detail: null }, ME), null);
    assert.equal(notificationRoute({ kind: 'sale', id: `${ID}?x=https://example.invalid`, detail: null }, ME), null);
    assert.equal(notificationRoute({ kind: 'closing_day', id: null, detail: '//example.invalid' }, ME), '/closing');
    assert.equal(notificationRoute({ kind: 'product', id: ID, detail: 'https://x' }, ME), `/catalog/${ID}`);
  });
});

describe('pushedNotificationId — only an id from a push', () => {
  it('reads the id and ignores everything else', () => {
    assert.equal(pushedNotificationId({ notificationId: ID, link: 'https://example.invalid' }), ID);
    assert.equal(pushedNotificationId({ notificationId: 'nope' }), null);
    assert.equal(pushedNotificationId(null), null);
    assert.equal(pushedNotificationId('x'), null);
  });
});

describe('createOpenGate — one navigation per tap', () => {
  it('the same response is let through once; another is let through', () => {
    const gate = createOpenGate(2);
    assert.equal(gate('a'), true);
    assert.equal(gate('a'), false);
    assert.equal(gate('b'), true);
    assert.equal(gate('c'), true);
    // The oldest is forgotten past the limit.
    assert.equal(gate('a'), true);
  });
});
