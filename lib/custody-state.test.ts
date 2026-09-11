/**
 * Where a transfer or consignment stands — proved without a screen.
 *
 *   node lib/custody-state.test.ts
 */
import assert from 'node:assert/strict';
import {
  CONSIGNMENT_STATUSES,
  canAnswerOffer,
  consignmentStanding,
  isKnownConsignmentStatus,
  transferStanding,
  whoseMove,
} from './custody-state.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log('  ok ', name);
};

// ── Transfers ────────────────────────────────────────────────────────────────

it('a transfer waiting for approval has not moved, and needs an approver', () => {
  assert.deepEqual(transferStanding('pending_approval'), { holder: 'origin', next: 'approve', closed: false });
});

it('an approved transfer is still at the origin, waiting to be shipped', () => {
  assert.deepEqual(transferStanding('approved'), { holder: 'origin', next: 'ship', closed: false });
});

it('in transit means neither shop has it, and the destination acts next', () => {
  assert.deepEqual(transferStanding('in_transit'), { holder: 'on_the_way', next: 'receive', closed: false });
});

it('received is finished, with the items at the destination', () => {
  assert.deepEqual(transferStanding('received'), { holder: 'destination', next: 'none', closed: true });
});

it('a refused or cancelled transfer never moved the stock', () => {
  for (const s of ['rejected', 'cancelled'] as const) {
    assert.deepEqual(transferStanding(s), { holder: 'origin', next: 'none', closed: true }, s);
  }
});

// ── Consignments: stock and money are separate answers ───────────────────────

it('every server status has an answer', () => {
  assert.equal(CONSIGNMENT_STATUSES.length, 15);
  for (const s of CONSIGNMENT_STATUSES) assert.ok(consignmentStanding(s), s);
});

it('agreeing is not handing over: the phones stay with the sender until sent', () => {
  for (const s of ['requested', 'counter_proposed', 'disputed', 'accepted_awaiting_custody'] as const) {
    assert.equal(consignmentStanding(s).phonesAt, 'sender', s);
    assert.equal(consignmentStanding(s).money, 'not_due', `${s}: nothing owed before a sale`);
  }
});

it('on the way to the holder, only the holder can confirm it arrived', () => {
  assert.deepEqual(consignmentStanding('custody_awaiting_confirmation'), {
    phonesAt: 'to_holder',
    next: 'holder',
    money: 'not_due',
    closed: false,
  });
});

it('the phone arriving is not the shop being paid', () => {
  const held = consignmentStanding('in_custody');
  assert.equal(held.phonesAt, 'holder');
  assert.equal(held.money, 'not_due');
});

it('sold is not paid: money is awaited, and both sides have something to do', () => {
  assert.deepEqual(consignmentStanding('sold_awaiting_settlement'), {
    phonesAt: 'sold',
    next: 'either',
    money: 'awaiting',
    closed: false,
  });
});

it('partly paid stays open, and says so', () => {
  const s = consignmentStanding('partially_paid');
  assert.equal(s.money, 'partly_paid');
  assert.equal(s.closed, false);
});

it('only settled reads as paid', () => {
  const paid = CONSIGNMENT_STATUSES.filter((s) => consignmentStanding(s).money === 'paid');
  assert.deepEqual(paid, ['settled']);
});

it('a write-off is closed but never reads as paid', () => {
  assert.equal(consignmentStanding('forgiven_settled').money, 'written_off');
  assert.equal(consignmentStanding('forgiven_settled').closed, true);
});

it('returns bring the phone back to the sender, with no money involved', () => {
  assert.equal(consignmentStanding('return_initiated').phonesAt, 'holder');
  assert.equal(consignmentStanding('return_in_transit').phonesAt, 'to_sender');
  assert.equal(consignmentStanding('return_in_transit').next, 'sender', 'only the owner accepts it back');
  assert.equal(consignmentStanding('returned_accepted').phonesAt, 'sender');
  for (const s of ['return_initiated', 'return_in_transit', 'returned_accepted', 'cancelled'] as const) {
    assert.equal(consignmentStanding(s).money, 'none', s);
  }
});

it('closed means nobody acts next, and open means somebody does', () => {
  for (const s of CONSIGNMENT_STATUSES) {
    const x = consignmentStanding(s);
    assert.equal(x.closed, x.next === 'none', s);
  }
});

it('nobody answers their own offer: a request waits on the holder, a counter-offer on the sender', () => {
  assert.equal(consignmentStanding('requested').next, 'holder');
  assert.equal(consignmentStanding('counter_proposed').next, 'sender');
  assert.equal(consignmentStanding('disputed').next, 'either');
  assert.equal(whoseMove(consignmentStanding('requested').next, 'source'), 'them');
  assert.equal(whoseMove(consignmentStanding('requested').next, 'destination'), 'you');
});

it('accept and counter are offered only to the side that did not make the offer', () => {
  assert.equal(canAnswerOffer('requested', 'source'), false);
  assert.equal(canAnswerOffer('requested', 'destination'), true);
  assert.equal(canAnswerOffer('counter_proposed', 'source'), true);
  assert.equal(canAnswerOffer('counter_proposed', 'destination'), false);
  assert.equal(canAnswerOffer('disputed', 'source'), true);
  assert.equal(canAnswerOffer('disputed', 'destination'), true);
  assert.equal(canAnswerOffer('in_custody', 'destination'), false, 'nothing to answer once agreed');
});

it('an unknown status is not guessed at', () => {
  assert.equal(isKnownConsignmentStatus('in_custody'), true);
  assert.equal(isKnownConsignmentStatus('teleported'), false);
});

it('whose move it is depends on which side is looking', () => {
  assert.equal(whoseMove('holder', 'destination'), 'you');
  assert.equal(whoseMove('holder', 'source'), 'them');
  assert.equal(whoseMove('sender', 'source'), 'you');
  assert.equal(whoseMove('sender', 'destination'), 'them');
  assert.equal(whoseMove('either', 'source'), 'both');
  assert.equal(whoseMove('none', 'destination'), 'none');
});

console.log('\n' + passed + ' passed');
