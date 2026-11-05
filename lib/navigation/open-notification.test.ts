import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNotificationOpener, type OpenDeps } from './open-notification.ts';
import { notificationRoute } from './notification-route.ts';

const SALE = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const STORE_A = '0190a1b2-c3d4-7e5f-8a9b-000000000001';
const STORE_B = '0190a1b2-c3d4-7e5f-8a9b-000000000002';

function world(answer: Awaited<ReturnType<OpenDeps['ask']>> | Error, opts: { active?: string; delay?: number } = {}) {
  const log: string[] = [];
  let active = opts.active ?? STORE_A;
  const deps: OpenDeps = {
    ask: async (id) => {
      log.push(`ask ${id}`);
      if (opts.delay) await new Promise((r) => setTimeout(r, opts.delay));
      if (answer instanceof Error) throw answer;
      return answer;
    },
    markRead: async (id) => log.push(`read ${id}`),
    activeBranch: () => active,
    switchBranch: async (b) => {
      log.push(`switch ${b}`);
      active = b;
      return true;
    },
    me: () => 'me',
    push: (target) => log.push(`push ${notificationRoute(target, 'me')}`),
    fallback: (reason) => log.push(`fallback ${reason}`),
  };
  return { log, open: createNotificationOpener(deps) };
}

test('a successful opening goes straight to the record: no intermediate screen, no notifications screen, read once', async () => {
  const w = world({ status: 'ok', target: { kind: 'sale', id: SALE, detail: null }, branchId: STORE_A });
  assert.deepEqual(await w.open('n1'), { kind: 'opened', route: `/sales/${SALE}` });
  assert.deepEqual(w.log, ['ask n1', 'read n1', `push /sales/${SALE}`]);
  // The regression: nothing navigates to the opening screen or the centre on the way.
  assert.equal(w.log.some((l) => /notification-open|\/notifications/.test(l)), false);
});

test('the record of another of the person’s stores: that store first, then the record', async () => {
  const w = world({ status: 'ok', target: { kind: 'sale', id: SALE, detail: null }, branchId: STORE_B });
  await w.open('n1');
  assert.deepEqual(w.log, ['ask n1', 'read n1', `switch ${STORE_B}`, `push /sales/${SALE}`]);
});

test('a double tap opens it once', async () => {
  const w = world({ status: 'ok', target: { kind: 'sale', id: SALE, detail: null }, branchId: null }, { delay: 20 });
  const [a, b] = await Promise.all([w.open('n1'), w.open('n1')]);
  assert.deepEqual([a.kind, b.kind], ['opened', 'busy']);
  assert.equal(w.log.filter((l) => l.startsWith('push')).length, 1);
  // And a later tap, once the first finished, opens again.
  assert.equal((await w.open('n1')).kind, 'opened');
});

test('removed, unknown kind or no destination: the notifications, saying it is no longer available — nothing marked read', async () => {
  for (const answer of [
    { status: 'unavailable' as const },
    { status: 'no_destination' as const },
    { status: 'ok' as const, target: { kind: 'something_new', id: SALE, detail: null }, branchId: null },
    { status: 'ok' as const, target: { kind: 'sale', id: 'not-an-id', detail: null }, branchId: null },
  ]) {
    const w = world(answer);
    assert.deepEqual(await w.open('n1'), { kind: 'fallback', reason: 'unavailable' });
    assert.deepEqual(w.log, ['ask n1', 'fallback unavailable']);
  }
});

test('no longer the person’s to open: the notifications, saying so', async () => {
  const w = world({ status: 'unauthorized' });
  assert.deepEqual(await w.open('n1'), { kind: 'fallback', reason: 'unauthorized' });
  assert.deepEqual(w.log, ['ask n1', 'fallback unauthorized']);
});

test('the server does not answer: the notifications, saying it could not be opened — and the lock is released', async () => {
  const w = world(new Error('offline'));
  assert.deepEqual(await w.open('n1'), { kind: 'fallback', reason: 'failed' });
  assert.deepEqual(w.log, ['ask n1', 'fallback failed']);
  assert.equal((await w.open('n1')).kind, 'fallback');
});
