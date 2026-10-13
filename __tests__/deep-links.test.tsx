/// <reference types="jest" />
/**
 * Links that open the app: `dukanerp://…` (docs/21 D168 as amended, 2026-10-13).
 *
 * The phone hands the app only the schemes its native project registers — `dukanerp` alone
 * (`lib/app-identity.test.ts`). From there Expo Router turns the link into a screen. This runs that code
 * the way a cold start runs it on iOS — `Linking.getLinkingURL()`, `extractExpoPathFromURL`,
 * `getStateFromPath` — over the app's real route files, with stub screens so nothing is fetched. The
 * sign-in guard (`entryRoute`) then decides where the person lands: a link never skips sign-in, the
 * branch choice or a closed business's refusal, and the person's own account (contact verification,
 * deletion) stays reachable, as docs/64 requires.
 *
 * Verification, password reset, invitations and deletion use codes typed in the app; no message the
 * server sends carries an app link, and push notifications are not built. The last checks keep links
 * free of secrets: no screen reads a code, token or password from its address.
 */
import React from 'react';
import { render } from '@testing-library/react-native';

// Node's own modules, typed here: the app's TypeScript project carries no Node types.
declare const __dirname: string;
const { readdirSync, readFileSync, statSync } = require('fs') as {
  readdirSync(path: string): string[];
  readFileSync(path: string, encoding: 'utf8'): string;
  statSync(path: string): { isDirectory(): boolean };
};
const { join, relative, sep } = require('path') as { join(...parts: string[]): string; relative(from: string, to: string): string; sep: string };

const mockLink: { url: string | null } = { url: null };
jest.mock('expo-linking', () => {
  const { scheme } = require('../app.json').expo as { scheme: string };
  return {
    ...jest.requireActual('expo-linking'),
    getLinkingURL: () => mockLink.url,
    createURL: (path: string) => `${scheme}://${path.startsWith('/') ? path.slice(1) : path}`,
    resolveScheme: () => scheme,
    addEventListener: () => ({ remove() {} }),
  };
});

import { ExpoRoot } from 'expo-router/build/ExpoRoot';
import { Slot } from 'expo-router/build/views/Navigator';
import { store } from 'expo-router/build/global-state/router-store';
import { getMockContext } from 'expo-router/build/testing-library/mock-config';
import { ACCESS_CLOSED, APP_HOME, LOGIN, SELECT_BRANCH, entryRoute, type EntryState } from '../lib/navigation/entry';

const ROOT = join(__dirname, '..');
const APP = join(ROOT, 'app');
const SCHEME = (JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')) as { expo: { scheme: string } }).expo.scheme;

function routeFiles(dir = APP): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [relative(APP, path).split(sep).join('/')] : [];
  });
}

/** The app's route tree exactly as its files declare it; each screen a stub, each layout a plain slot. */
function routes() {
  const Layout = () => <Slot />;
  const Screen = () => null;
  return getMockContext(
    Object.fromEntries(
      routeFiles().map((file) => {
        const key = file.replace(/\.tsx?$/, '');
        return [key, { default: key.endsWith('_layout') ? Layout : Screen }];
      }),
    ),
  );
}

/** Opens the app from `url` as a cold start does and returns where Expo Router put it. */
function open(url: string) {
  mockLink.url = url;
  const view = render(<ExpoRoot context={routes()} />);
  const info = store.getRouteInfo();
  view.unmount();
  return { pathname: info.pathname, segments: [...info.segments], params: { ...info.params } as Record<string, unknown> };
}

const link = (path: string) => `${SCHEME}://${path}`;

beforeEach(() => {
  mockLink.url = null;
});

it('the configured scheme is dukanerp', () => {
  expect(SCHEME).toBe('dukanerp');
});

describe('a dukanerp:// link opens the screen it names', () => {
  it.each([
    // sign-in, the branch choice, the business's access, the person's own account
    ['login', '/login', ['(auth)', 'login'], {}],
    ['select-branch', '/select-branch', ['select-branch'], {}],
    ['stores', '/stores', ['stores'], {}],
    ['access', '/access', ['access'], {}],
    ['access-closed', '/access-closed', ['access-closed'], {}],
    ['account', '/account', ['account'], {}],
    ['account/delete', '/account/delete', ['account', 'delete'], {}],
    ['notifications', '/notifications', ['notifications'], {}],
    // records
    ['sales/0190ab12-0000-7000-8000-000000000001', '/sales/0190ab12-0000-7000-8000-000000000001', ['sales', '[id]'], { id: '0190ab12-0000-7000-8000-000000000001' }],
    ['sales/period?day=2026-10-12', '/sales/period', ['sales', 'period'], { day: '2026-10-12' }],
    ['unit/356938035643809', '/unit/356938035643809', ['unit', '[identifier]'], { identifier: '356938035643809' }],
    ['agent/0190ab12-0000-7000-8000-000000000002', '/agent/0190ab12-0000-7000-8000-000000000002', ['agent', '[id]'], { id: '0190ab12-0000-7000-8000-000000000002' }],
    ['hub/money', '/hub/money', ['hub', '[id]'], { id: 'money' }],
  ])('%s', (path, pathname, segments, params) => {
    const where = open(link(path));
    expect(where.pathname).toBe(pathname);
    expect(where.segments).toEqual(segments);
    expect(where.params).toEqual(params);
  });

  it('the bare scheme opens the start screen', () => {
    expect(open(link('')).pathname).toBe('/');
  });

  it('an address the app does not have lands on the not-found screen', () => {
    const where = open(link('no-such-screen'));
    expect(where.segments).toEqual(['+not-found']);
  });
});

describe('every destination a server notification carries opens as a link', () => {
  // The `actionLink`s erp-backend writes (anomalies, closing notice, discount approvals, pricing, returns, transfers).
  const ID = '0190ab12-0000-7000-8000-000000000003';
  it.each([
    ['/analytics', ['analytics']],
    ['/closing', ['closing']],
    [`/approvals/${ID}`, ['approvals', '[id]']],
    [`/catalog/${ID}`, ['catalog', '[id]']],
    [`/catalog/${ID}?unit=${ID}`, ['catalog', '[id]']],
    [`/returns/${ID}`, ['returns', '[id]']],
    [`/transfers/${ID}`, ['transfers', '[id]']],
  ])('%s', (destination, segments) => {
    const where = open(link(destination.slice(1)));
    expect(where.segments).toEqual(segments);
    expect(where.segments).not.toContain('+not-found');
  });
});

describe('the sign-in guard decides where a link lands', () => {
  const state = (over: Partial<EntryState>, where: { segments: string[]; pathname: string }): EntryState => ({
    bootstrapping: false,
    signedIn: true,
    branchChosen: true,
    closed: false,
    readOnly: false,
    activity: null,
    segment: where.segments[0],
    pathname: where.pathname,
    ...over,
  });
  const RECORD = 'sales/0190ab12-0000-7000-8000-000000000001';

  it('signed out: every link goes to sign-in first', () => {
    for (const path of [RECORD, 'account/delete', 'select-branch', 'notifications', 'hub/money']) {
      expect(entryRoute(state({ signedIn: false, branchChosen: false }, open(link(path))))).toBe(LOGIN);
    }
  });

  it('signed out: the sign-in link itself stays on sign-in', () => {
    expect(entryRoute(state({ signedIn: false, branchChosen: false }, open(link('login'))))).toBeNull();
  });

  it('signed in without a branch: a record link asks for the branch first', () => {
    expect(entryRoute(state({ branchChosen: false }, open(link(RECORD))))).toBe(SELECT_BRANCH);
  });

  it('signed in with a branch: a record link opens the record', () => {
    expect(entryRoute(state({}, open(link(RECORD))))).toBeNull();
  });

  it('signed in: the sign-in and branch links move on to the app', () => {
    expect(entryRoute(state({}, open(link('login'))))).toBe(APP_HOME);
    expect(entryRoute(state({}, open(link('select-branch'))))).toBe(APP_HOME);
  });

  it('a closed business: a record link shows the refusal, the person’s own account stays open', () => {
    expect(entryRoute(state({ closed: true }, open(link(RECORD))))).toBe(ACCESS_CLOSED);
    expect(entryRoute(state({ closed: true }, open(link('account'))))).toBeNull();
    expect(entryRoute(state({ closed: true }, open(link('account/delete'))))).toBeNull();
  });

  it('while the saved session is being restored, nothing moves', () => {
    expect(entryRoute(state({ bootstrapping: true, signedIn: false }, open(link(RECORD))))).toBeNull();
  });
});

describe('no credential or reusable secret travels in a link', () => {
  const SECRET = /^(token|code|otp|password|passcode|secret|session|sessionId|pin|key|apiKey|accessToken|refreshToken|verificationCode|resetToken|inviteToken|invitationToken|deletionCode|enrolmentToken)$/i;

  it('no route segment is named after a secret', () => {
    const dynamic = routeFiles().flatMap((file) => [...file.matchAll(/\[(?:\.\.\.)?([^\]]+)\]/g)].map((m) => m[1]));
    expect(dynamic.length).toBeGreaterThan(0);
    expect(dynamic.filter((name) => SECRET.test(name))).toEqual([]);
  });

  it('no screen reads a secret from its address', () => {
    const read: string[] = [];
    for (const file of routeFiles()) {
      const source = readFileSync(join(APP, file), 'utf8');
      for (const m of source.matchAll(/use(?:Local|Global)SearchParams<\{([^}]*)\}>/g)) {
        for (const key of m[1].matchAll(/(\w+)\??\s*:/g)) read.push(key[1]);
      }
    }
    expect(read.length).toBeGreaterThan(0);
    expect(read.filter((name) => SECRET.test(name))).toEqual([]);
  });
});
