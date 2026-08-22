/**
 * What More is allowed to say about sync and subscription (milestone N).
 *
 * Run directly with Node (type-stripping):
 *   node lib/navigation/notices.test.ts
 * Exits non-zero on any failure.
 *
 * Both of these decide when to interrupt somebody. Getting that wrong is not
 * cosmetic: a queued financial report described as settled is a lie about
 * money, and a subscription banner that never goes away is a banner nobody
 * reads on the day it finally matters.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SUBSCRIPTION_NOTICE_DAYS,
  subscriptionNotice,
  syncNotice,
  type QueueEntry,
} from './notices.ts';
import type { Entitlement } from '../entitlement.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log('  ok  ' + name);
};

const q = (...states: string[]): QueueEntry[] => states.map((state) => ({ state }));

const entitlement = (over: Partial<Entitlement>): Entitlement =>
  ({
    state: 'active',
    periodEnd: null,
    graceEnd: null,
    daysRemaining: 90,
    graceHoursRemaining: 0,
    subscribedBranchCount: 1,
    activeBranchCount: 1,
    includedSeats: 5,
    additionalSeats: 0,
    seatLimit: 5,
    seatsUsed: 3,
    overLimit: false,
    canRead: true,
    canWrite: true,
    isComplimentary: false,
    calculatedAt: '2026-08-22T00:00:00.000Z',
    ...over,
  }) as Entitlement;

// ── sync: empty and non-empty ────────────────────────────────────────────────

it('an empty queue says nothing at all', () => {
  assert.deepEqual(syncNotice([]), { kind: 'none', count: 0 });
});

it('a queue of already-sent work says nothing', () => {
  assert.deepEqual(syncNotice(q('synced', 'synced', 'cancelled')), { kind: 'none', count: 0 });
});

it('work waiting for a connection is raised quietly, and counted', () => {
  assert.deepEqual(syncNotice(q('waiting_for_connection', 'sending', 'synced')), {
    kind: 'waiting',
    count: 2,
  });
});

it('work needing a person is raised as attention', () => {
  assert.deepEqual(syncNotice(q('needs_attention', 'synced')), { kind: 'attention', count: 1 });
});

it('attention outranks waiting — a draining queue never hides a conflict', () => {
  const notice = syncNotice(q('waiting_for_connection', 'waiting_for_connection', 'needs_attention'));
  assert.equal(notice.kind, 'attention');
  assert.equal(notice.count, 1, 'the count must be the conflicts, not the whole queue');
});

it('a draft saved on the phone is not, on its own, something to interrupt for', () => {
  // Drafts are work in progress, not work stuck. They belong in the Sync
  // center, not on the landing screen.
  assert.deepEqual(syncNotice(q('draft', 'draft')), { kind: 'none', count: 0 });
});

// ── subscription: placement ──────────────────────────────────────────────────

it('a healthy subscription stays in its hub and is never surfaced', () => {
  assert.equal(subscriptionNotice(entitlement({})), 'none');
});

it('a complimentary shop is told nothing', () => {
  assert.equal(subscriptionNotice(entitlement({ state: 'complimentary', daysRemaining: null })), 'none');
});

it('an unknown entitlement says nothing rather than guessing', () => {
  assert.equal(subscriptionNotice(undefined), 'none');
});

it('approaching expiry is surfaced, using the server-calculated days', () => {
  assert.equal(subscriptionNotice(entitlement({ daysRemaining: SUBSCRIPTION_NOTICE_DAYS })), 'approaching');
  assert.equal(subscriptionNotice(entitlement({ daysRemaining: 1 })), 'approaching');
  assert.equal(subscriptionNotice(entitlement({ daysRemaining: 0 })), 'approaching');
});

it('a comfortable margin is left alone', () => {
  assert.equal(subscriptionNotice(entitlement({ daysRemaining: SUBSCRIPTION_NOTICE_DAYS + 1 })), 'none');
});

it('grace is surfaced', () => {
  assert.equal(
    subscriptionNotice(entitlement({ state: 'grace', graceHoursRemaining: 20, canWrite: true })),
    'grace',
  );
});

it('expired is surfaced, and outranks an over-limit seat count', () => {
  assert.equal(
    subscriptionNotice(entitlement({ state: 'expired', canWrite: false, overLimit: true })),
    'expired',
  );
});

it('over the seat limit is surfaced while otherwise healthy', () => {
  assert.equal(subscriptionNotice(entitlement({ overLimit: true, seatsUsed: 7 })), 'over_limit');
});

// ── the rules themselves ─────────────────────────────────────────────────────

it('nothing here recomputes entitlement — only server fields are read', () => {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(HERE, 'notices.ts'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  for (const forbidden of ['Date.now', 'new Date', 'canWrite', 'periodEnd', 'graceEnd']) {
    assert.ok(
      !code.includes(forbidden),
      'the notice rule must not read or derive "' + forbidden + '" — the server decides entitlement',
    );
  }
  // The one number it may hold, and it is a display threshold.
  assert.ok(code.includes('SUBSCRIPTION_NOTICE_DAYS'));
});

it('the sync wording keys never claim a queued item was sent or confirmed', () => {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const en = fs.readFileSync(path.join(HERE, '..', 'i18n', 'en.ts'), 'utf8');
  const line = en.match(/'more\.sync\.notConfirmed':\s*'([^']*)'/);
  assert.ok(line, 'the disclaimer key must exist');
  assert.match(line[1], /not the same as/i);

  for (const key of ['more.sync.waiting', 'more.sync.attention']) {
    const m = en.match(new RegExp("'" + key.replace(/\./g, '\\.') + "':\\s*'([^']*)'"));
    assert.ok(m, 'missing key: ' + key);
    assert.doesNotMatch(m[1], /\bsent\b|\bconfirmed\b|\bsettled\b|\bpaid\b/i, key + ' overclaims');
  }
});

console.log('\n' + passed + ' passed');
