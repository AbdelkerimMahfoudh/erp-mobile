/**
 * Business access, as the app reads it off the server (docs/21, 2026-10-05).
 *
 *   node lib/access.test.ts
 *
 * Every mode comes from the server's own `canRead` / `canWrite` / `state`; the
 * table below is the whole contract between the entitlement and the screens.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { accessEnd, accessNotice, businessAccess, closedReason } from './access.ts';
import type { Entitlement } from './entitlement.ts';

const entitlement = (over: Partial<Entitlement>): Entitlement =>
  ({
    state: 'active',
    periodEnd: '2026-11-01T00:00:00.000Z',
    graceEnd: '2026-11-04T00:00:00.000Z',
    daysRemaining: 27,
    graceHoursRemaining: 0,
    subscribedBranchCount: 1,
    activeBranchCount: 1,
    includedSeats: 2,
    additionalSeats: 0,
    seatLimit: 2,
    seatsUsed: 1,
    overLimit: false,
    canRead: true,
    canWrite: true,
    isComplimentary: false,
    status: 'activated',
    calculatedAt: '2026-10-05T00:00:00.000Z',
    ...over,
  }) as Entitlement;

describe('the four modes, from the server’s flags alone', () => {
  it('nothing known yet reads as open and stale — the server refuses anyway, and a slow network must not hide the counter', () => {
    const a = businessAccess(undefined);
    assert.equal(a.mode, 'unknown');
    assert.equal(a.canWrite, true);
    assert.equal(a.stale, true);
  });

  it('active and complimentary are open', () => {
    assert.equal(businessAccess(entitlement({})).mode, 'open');
    assert.equal(businessAccess(entitlement({ state: 'complimentary', isComplimentary: true })).mode, 'open');
  });

  it('grace is open with a warning, carrying the server’s deadline verbatim', () => {
    const a = businessAccess(entitlement({ state: 'grace', graceHoursRemaining: 20 }));
    assert.equal(a.mode, 'grace');
    assert.equal(a.canWrite, true);
    assert.equal(a.graceEnd, '2026-11-04T00:00:00.000Z');
  });

  it('the deadline is read on the business’s clock, the zone the server names — none from an older server, none before it answers', () => {
    assert.equal(businessAccess(entitlement({ state: 'grace', timeZone: 'Asia/Tokyo' })).timeZone, 'Asia/Tokyo');
    assert.equal(businessAccess(entitlement({ state: 'grace' })).timeZone, null);
    assert.equal(businessAccess(undefined).timeZone, null);
  });

  it('expired is read-only: everything readable, nothing new', () => {
    const a = businessAccess(entitlement({ state: 'expired', canWrite: false }));
    assert.equal(a.mode, 'read_only');
    assert.equal(a.canRead, true);
    assert.equal(a.canWrite, false);
  });

  it('pending, suspended, cancelled and refused are closed', () => {
    for (const state of ['pending', 'suspended', 'cancelled', 'rejected'] as const) {
      const a = businessAccess(entitlement({ state, canRead: false, canWrite: false }));
      assert.equal(a.mode, 'closed', state);
      assert.equal(a.canWrite, false, state);
    }
  });

  it('the server’s flags win over the state’s name', () => {
    // A server that opens writes to a state this build does not know still opens them.
    assert.equal(businessAccess(entitlement({ state: 'something_new' as never })).mode, 'open');
    assert.equal(businessAccess(entitlement({ state: 'active', canWrite: false })).mode, 'read_only');
  });

  it('staleness is carried, never decided here', () => {
    assert.equal(businessAccess(entitlement({}), true).stale, true);
    assert.equal(businessAccess(entitlement({}), false).stale, false);
  });
});

describe('the free trial’s three states (0095), from the server’s flags like every other', () => {
  const trial = (status: 'available' | 'active' | 'expired', endsAt: string | null) => ({
    status, durationHours: 168, durationDays: 7, claimedAt: endsAt && '2026-10-13T10:30:00.000Z', startedAt: endsAt && '2026-10-13T10:30:00.000Z', endsAt, timeZone: 'Asia/Tokyo',
  });
  const ENDS = '2026-10-20T10:30:00.000Z';

  it('eligible and not started is closed — never read as "ended"', () => {
    const a = businessAccess(entitlement({ state: 'trial_available', status: 'pending_activation', canRead: false, canWrite: false, trial: trial('available', null) }));
    assert.equal(a.mode, 'closed');
    assert.equal(a.canWrite, false);
    assert.equal(a.trialEnd, null, 'nothing has started, so there is no end to say');
    assert.equal(closedReason('trial_available'), 'not_started');
  });

  it('a running trial is open, and carries the server’s exact end with the business’s zone', () => {
    const a = businessAccess(entitlement({ state: 'trial_active', status: 'pending_activation', periodEnd: null, trial: trial('active', ENDS) }));
    assert.equal(a.mode, 'open');
    assert.equal(a.canWrite, true);
    assert.deepEqual(a.trialEnd, { at: ENDS, timeZone: 'Asia/Tokyo' });
    assert.equal(accessNotice(a, true), 'none', 'an open shop is told nothing on the tabs');
  });

  it('paid or granted access approved during the trial starts when it ends: the trial is still open, dated by its end, and nothing is said on the tabs', () => {
    for (const kind of ['paid', 'granted'] as const) {
      const a = businessAccess(entitlement({ state: 'trial_active', status: 'activated', trial: { ...trial('active', ENDS), accessAfterTrial: { kind, startsAt: ENDS } } }));
      assert.equal(a.mode, 'open');
      assert.deepEqual(a.trialEnd, { at: ENDS, timeZone: 'Asia/Tokyo' });
      assert.equal(accessNotice(a, true), 'none');
    }
  });

  it('an ended trial is read-only with no grace, and the tabs say when it ended', () => {
    const a = businessAccess(entitlement({ state: 'trial_expired', status: 'pending_activation', periodEnd: null, graceEnd: null, canWrite: false, trial: trial('expired', ENDS) }));
    assert.equal(a.mode, 'read_only');
    assert.equal(a.canRead, true);
    assert.deepEqual(a.trialEnd, { at: ENDS, timeZone: 'Asia/Tokyo' });
    assert.equal(accessNotice(a, false), 'trial_ended');
  });

  it('a business paying after its trial is dated by its paid period, not by the trial', () => {
    const a = businessAccess(entitlement({ state: 'active', trial: trial('expired', ENDS) }));
    assert.equal(a.mode, 'open');
    assert.equal(a.trialEnd, null);
    assert.equal(businessAccess(entitlement({ state: 'expired', canWrite: false, trial: trial('expired', ENDS) })).trialEnd, null);
    assert.equal(accessNotice(businessAccess(entitlement({ state: 'expired', canWrite: false, trial: trial('expired', ENDS) })), true), 'read_only');
  });

  it('an older server without the trial field, or a trial state without its instant, says no trial date', () => {
    assert.equal(businessAccess(entitlement({ state: 'trial_active' })).trialEnd, null);
    assert.equal(businessAccess(entitlement({ state: 'trial_expired', canWrite: false, trial: null })).trialEnd, null);
    assert.equal(accessNotice(businessAccess(entitlement({ state: 'trial_expired', canWrite: false })), true), 'read_only');
    assert.equal(businessAccess(undefined).trialEnd, null);
  });
});

describe('what the tabs say', () => {
  it('an open shop is told nothing', () => {
    assert.equal(accessNotice(businessAccess(entitlement({})), true), 'none');
    assert.equal(accessNotice(businessAccess(undefined), true), 'none');
  });

  it('grace and read-only are said once, read-only first', () => {
    assert.equal(accessNotice(businessAccess(entitlement({ state: 'grace' })), false), 'grace');
    assert.equal(accessNotice(businessAccess(entitlement({ state: 'expired', canWrite: false, overLimit: true })), true), 'read_only');
  });

  it('the staff allowance is the Owner’s business only, and only while open', () => {
    const over = entitlement({ overLimit: true, seatsUsed: 3 });
    assert.equal(accessNotice(businessAccess(over), true), 'over_limit');
    assert.equal(accessNotice(businessAccess(over), false), 'none');
    assert.equal(accessNotice(businessAccess(entitlement({ state: 'grace', overLimit: true })), true), 'grace');
  });
});

describe('the closed screen’s reason', () => {
  it('names pending, not started, suspended and refused each by its own word, and every other closed state as ended', () => {
    assert.equal(closedReason('pending'), 'pending');
    assert.equal(closedReason('trial_available'), 'not_started');
    assert.equal(closedReason('suspended'), 'suspended');
    assert.equal(closedReason('rejected'), 'rejected');
    assert.equal(closedReason('cancelled'), 'ended');
    assert.equal(closedReason('expired'), 'ended');
    assert.equal(closedReason('trial_expired'), 'ended');
    // No state, or one this build does not know, is never "pending" (2026-10-24).
    assert.equal(closedReason(undefined), 'unknown');
    assert.equal(closedReason(null), 'unknown');
    assert.equal(closedReason('some_future_state'), 'unknown');
  });
});

describe('the date access runs to', () => {
  const paid = '2026-11-01T00:00:00.000Z';
  const grant = (status: 'none' | 'indefinite' | 'active' | 'superseded' | 'ended', until: string | null, paidUntil: string | null = null) =>
    ({ status, until, paidUntil });

  it('without a grant, is the paid period’s end — and an older server without the field reads the same', () => {
    assert.equal(accessEnd(entitlement({})), paid);
    assert.equal(accessEnd(entitlement({ complimentary: grant('none', null) })), paid);
    assert.equal(accessEnd(entitlement({ periodEnd: null })), null);
    assert.equal(accessEnd(undefined), null);
  });

  it('while a grant runs past the paid end, is the grant’s end', () => {
    const e = entitlement({ isComplimentary: true, complimentary: grant('active', '2027-03-31T00:00:00.000Z') });
    assert.equal(accessEnd(e), '2027-03-31T00:00:00.000Z');
  });

  it('while a grant runs but the paid period ends later, is the paid end', () => {
    const e = entitlement({ periodEnd: '2027-06-01T00:00:00.000Z', isComplimentary: true, complimentary: grant('active', '2027-03-31T00:00:00.000Z') });
    assert.equal(accessEnd(e), '2027-06-01T00:00:00.000Z');
  });

  it('a grant with no paid period at all is dated by the grant', () => {
    const e = entitlement({ periodEnd: null, isComplimentary: true, complimentary: grant('active', '2027-03-31T00:00:00.000Z') });
    assert.equal(accessEnd(e), '2027-03-31T00:00:00.000Z');
  });

  it('a grant without an end has no date', () => {
    assert.equal(accessEnd(entitlement({ isComplimentary: true, complimentary: grant('indefinite', null) })), null);
  });

  it('a grant overtaken by a later paid period runs to that period', () => {
    const e = entitlement({ periodEnd: '2027-06-01T00:00:00.000Z', isComplimentary: true, complimentary: grant('superseded', '2027-03-31T00:00:00.000Z', '2027-06-01T00:00:00.000Z') });
    assert.equal(accessEnd(e), '2027-06-01T00:00:00.000Z');
  });

  it('a grant that is over leaves the paid end', () => {
    assert.equal(accessEnd(entitlement({ complimentary: grant('ended', '2026-09-01T00:00:00.000Z') })), paid);
  });
});

describe('nothing here derives entitlement', () => {
  it('reads no clock and does no date arithmetic', () => {
    const src = readFileSync(new URL('./access.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const forbidden of ['Date.now', 'new Date', 'Date.parse', 'getTime', 'daysRemaining', 'graceHoursRemaining']) {
      assert.ok(!src.includes(forbidden), `access.ts must not use ${forbidden}`);
    }
  });
});
