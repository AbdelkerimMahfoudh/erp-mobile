/**
 * Platform administration inside the shop's app, kept apart from the shop.
 *
 *   node lib/platform-admin.test.ts
 *
 * What is pinned: the platform client carries no tenant credential and no
 * branch header; the platform screens import nothing of the shop's session,
 * branch or permissions; every platform route is classified and none is in
 * the shop's navigation; the tenant redirects leave the group alone; every
 * closed state has its words; and nothing in the subscription or platform
 * screens offers a website, a payment link or a price.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EXCLUDED_ROUTES } from './navigation/registry.ts';
import { actionsFor, monthsValid, needsReason, periodEndInstant, periodEndValid } from './platform-state.ts';

const ROOT = new URL('..', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, ROOT), 'utf8');
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const CLIENT = strip(read('lib/platform-admin.ts'));
const SCREENS = ['app/platform/_layout.tsx', 'app/platform/sign-in.tsx', 'app/platform/index.tsx', 'app/platform/[id].tsx', 'app/platform/new.tsx', 'app/platform/audit.tsx'];

describe('the platform client', () => {
  it('never sends the shop’s token or branch', () => {
    assert.doesNotMatch(CLIENT, /TOKEN_KEYS|getItem\(|X-Branch-Id|X-Company-Id|getActiveBranchId|api-client|useBranch/);
    // The only credential it sends is the platform session's own.
    assert.match(CLIENT, /const token = usePlatformSession\.getState\(\)\.session\?\.sessionToken;/);
  });

  it('keeps its session in memory only, and ends it on a 401', () => {
    assert.doesNotMatch(CLIENT, /setItem\(|AsyncStorage|SecureStore|localStorage/);
    assert.match(CLIENT, /if \(res\.status === 401\) usePlatformSession\.getState\(\)\.end\(\)/);
  });

  it('re-asks the password and carries the version on every mutation', () => {
    for (const fn of ['approve', 'reject', 'extend', 'setPeriod', 'suspend', 'reinstate', 'cancel']) {
      assert.match(CLIENT, new RegExp(`${fn}: \\(id: string, body: StepUp &`), `${fn} takes the step-up`);
    }
    assert.match(CLIENT, /confirmPassword: string;\s*expectedVersion\?: number;/);
  });

  it('reads no operational data', () => {
    for (const route of ['sales', 'units', 'products', 'inventory', 'expenses', 'customers', 'closings']) {
      assert.doesNotMatch(CLIENT, new RegExp(`'${route}`), `must not call ${route}`);
    }
  });
});

describe('the platform screens', () => {
  it('import nothing of the shop’s session, branch, permissions or client', () => {
    for (const f of SCREENS) {
      const code = strip(read(f));
      assert.doesNotMatch(code, /hooks\/useAuth|lib\/branch|lib\/permissions|lib\/api-client|lib\/entitlement/, `${f} reaches into the shop`);
    }
  });

  it('are every one classified as excluded from the shop’s navigation', () => {
    for (const route of ['/platform', '/platform/sign-in', '/platform/[id]', '/platform/new', '/platform/audit']) {
      assert.ok(route in EXCLUDED_ROUTES, `${route} must be classified`);
    }
    // And never a destination the shop's menus or tabs would list.
    const registry = strip(read('lib/navigation/registry.ts'));
    assert.doesNotMatch(registry, /route: '\/platform/);
  });

  it('are reached only from the sign-in screen, and the tenant redirects leave them alone', () => {
    const login = strip(read('app/(auth)/login.tsx'));
    assert.match(login, /router\.push\('\/platform\/sign-in' as never\)/);
    const auth = strip(read('hooks/useAuth.tsx'));
    assert.match(auth, /if \(segments\[0\] === 'platform'\) return;/);
    for (const f of ['app/(tabs)/more.tsx', 'app/(tabs)/_layout.tsx', 'app/(tabs)/index.tsx']) {
      assert.doesNotMatch(strip(read(f)), /'\/platform|push\('\/platform/, `${f} must not lead to the platform`);
    }
  });

  it('offer only the actions a state allows, and need a reason where access is taken away', () => {
    assert.deepEqual(actionsFor('pending'), ['approve', 'reject', 'invite']);
    assert.deepEqual(actionsFor('rejected'), ['approve', 'invite']);
    assert.deepEqual(actionsFor('suspended'), ['reinstate', 'cancel', 'invite']);
    assert.ok(actionsFor('active').includes('suspend') && actionsFor('active').includes('period'));
    for (const a of ['reject', 'suspend', 'cancel', 'period'] as const) assert.equal(needsReason(a), true);
    for (const a of ['approve', 'extend', 'reinstate', 'invite'] as const) assert.equal(needsReason(a), false);
  });

  it('validate what the server would refuse, before asking', () => {
    assert.equal(monthsValid('1'), true);
    assert.equal(monthsValid('60'), true);
    assert.equal(monthsValid('0'), false);
    assert.equal(monthsValid('61'), false);
    assert.equal(monthsValid('1.5'), false);
    const now = new Date('2026-09-22T12:00:00.000Z');
    assert.equal(periodEndValid('2026-10-01', now), true);
    assert.equal(periodEndValid('2026-09-22', now), true);
    assert.equal(periodEndValid('2026-09-21', now), false);
    assert.equal(periodEndValid('2026-02-30', now), false);
    assert.equal(periodEndValid('01/10/2026', now), false);
    assert.equal(periodEndInstant('2026-10-01'), '2026-10-01T23:59:59.000Z');
  });

  it('show the invitation once and send nothing', () => {
    const detail = strip(read('app/platform/[id].tsx'));
    assert.match(detail, /Clipboard\.setStringAsync\(invitation\.token\)/);
    assert.doesNotMatch(detail, /Linking|mailto:|sms:|whatsapp/i);
  });
});

describe('what a shop is told', () => {
  it('a shop the server has closed is sent to the state screen before any branch is chosen', () => {
    // Pending, suspended, cancelled, rejected: the branch list itself answers
    // 403, so the gate sits at the root and reads only the server's answer.
    const auth = strip(read('hooks/useAuth.tsx'));
    assert.match(auth, /useEntitlement\(Boolean\(user\) && !bootstrapping\)/);
    assert.match(auth, /!entitlement\.data\.canRead/);
    assert.match(auth, /router\.replace\('\/subscription-blocked' as never\)/);
    assert.doesNotMatch(auth, /Date\.now\(\)|getTime\(\)/);
  });

  it('every closed state has its words in three languages', () => {
    for (const lang of ['en', 'fr', 'ar']) {
      const dict = read(`lib/i18n/${lang}.ts`);
      for (const state of ['pending', 'rejected', 'suspended', 'expired']) {
        assert.ok(dict.includes(`'sub.${state}.title'`) && dict.includes(`'sub.${state}.body'`), `${lang}: sub.${state}`);
      }
      for (const state of ['pending', 'active', 'grace', 'expired', 'complimentary', 'suspended', 'cancelled', 'rejected']) {
        assert.ok(dict.includes(`'platform.state.${state}'`), `${lang}: platform.state.${state}`);
      }
    }
  });

  it('no subscription or platform screen offers a website, a payment link or a price', () => {
    for (const f of ['app/subscription-blocked.tsx', 'app/subscription.tsx', ...SCREENS]) {
      const code = strip(read(f));
      assert.doesNotMatch(code, /https?:\/\/|www\.|Linking|WebView|pay(ment)? ?link|\b\d{2,} ?MRU\b/i, `${f}`);
    }
    for (const lang of ['en', 'fr', 'ar']) {
      const dict = read(`lib/i18n/${lang}.ts`);
      const platformLines = dict.split('\n').filter((l) => /'platform\./.test(l));
      assert.ok(platformLines.length > 80, `${lang}: the platform catalogue is present`);
      for (const line of platformLines) assert.doesNotMatch(line, /\d{3,} ?MRU|http/i, `${lang}: ${line.trim()}`);
    }
  });
});
