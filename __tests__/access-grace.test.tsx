/// <reference types="jest" />
/**
 * The grace after a paid period as the app shows it (0099; the owner's brief of 2026-10-18), rendered.
 *
 * - While it runs: its deadline on the business's clock with the clock's name — on the access screen and in the tabs'
 *   notice alike — and the allowance of three in any 12 months as the server counts it.
 * - After a paid period that ended with the allowance used: the read-only words, and that no grace followed.
 * - While a paid period runs whose end would open no grace: that none would follow.
 * - Every number is the server's: a count it did not make is not shown, and none of it can be pressed or names a
 *   price, a payment or a website. An ended free trial is never told about grace at all.
 */
import React from 'react';
import { format } from 'date-fns';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import { t, useI18n } from '../lib/i18n';
import type { GraceView } from '../lib/entitlement';

jest.mock('../lib/api-client', () => ({
  __esModule: true,
  ApiError: class ApiError extends Error {},
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), put: jest.fn(), delete: jest.fn() },
  clearSession: jest.fn(),
}));
jest.mock('../hooks/useAuth', () => ({
  __esModule: true,
  useAuth: () => ({ user: { id: 'u1', name: 'Aicha', login: 'aicha', publicStoreId: 'S1' }, bootstrapping: false, signOut: jest.fn(), signIn: jest.fn(), chooseAccount: jest.fn(), adoptSession: jest.fn() }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import { api } from '../lib/api-client';
import AccessScreen from '../app/access';
import { AccessNotice } from '../components/access';

const PERIOD_END = '2026-10-18T10:00:00.000Z';
const GRACE_ENDS = '2026-10-21T10:00:00.000Z';

const base = {
  periodEnd: PERIOD_END, graceEnd: null, daysRemaining: null, graceHoursRemaining: 0, subscribedBranchCount: 1, activeBranchCount: 1,
  includedSeats: 1, additionalSeats: 0, seatLimit: 1, seatsUsed: 0, overLimit: false, isComplimentary: false, status: 'activated', calculatedAt: '2026-10-19T09:00:00.000Z', trial: null,
};
const graceView = (over: Partial<GraceView>): GraceView => ({
  status: 'active',
  startedAt: PERIOD_END,
  endsAt: GRACE_ENDS,
  hoursRemaining: 49,
  availableAtPeriodEnd: null,
  allowance: 3,
  windowMonths: 12,
  durationHours: 72,
  usesInWindow: 1,
  usesRemaining: 2,
  nextUseRestoredAt: '2027-10-18T10:00:00.000Z',
  ...over,
});
const inGrace = (over: Partial<GraceView> = {}, timeZone = 'Asia/Tokyo') => ({
  ...base, state: 'grace', canRead: true, canWrite: true, graceEnd: GRACE_ENDS, graceHoursRemaining: 49, timeZone, grace: graceView(over),
});
const expired = (over: Partial<GraceView>) => ({
  ...base, state: 'expired', canRead: true, canWrite: false, timeZone: 'Asia/Tokyo',
  grace: graceView({ endsAt: null, hoursRemaining: 0, ...over }),
});
const active = (over: Partial<GraceView>) => ({
  ...base, state: 'active', canRead: true, canWrite: true, periodEnd: '2026-11-18T10:00:00.000Z', daysRemaining: 31, timeZone: 'Asia/Tokyo',
  grace: graceView({ status: 'none', startedAt: null, endsAt: null, hoursRemaining: 0, ...over }),
});

function serve(entitlement: object) {
  (api.get as jest.Mock).mockImplementation(async (path: string) => {
    if (path === '/entitlement') return entitlement;
    throw new Error(`unexpected read ${path}`);
  });
}

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <AccessNotice />
        <AccessScreen />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

/** Every string inside an element: what a person can read in it. */
function textOf(node: ReactTestInstance | string): string {
  if (typeof node === 'string') return node;
  return node.children.map(textOf).join(' ');
}

const COMMERCE = /\bpay|payment|price|MRU|renew|QR|https?:|www\.|website/i;
const DEADLINE = '21 Oct 2026 · 19:00 (Japan Standard Time)';

beforeEach(() => {
  (api.get as jest.Mock).mockReset();
});

describe('a grace that runs', () => {
  afterEach(async () => {
    await act(async () => {
      await useI18n.getState().setLanguage('en');
    });
  });

  it('says its deadline on the business’s clock — the access screen and the tabs’ notice alike — and the allowance as the server counts it', async () => {
    serve(inGrace());
    renderScreen();

    expect(await screen.findByText(`Your business is in its grace period. Changes are accepted until ${DEADLINE}.`)).toBeTruthy();
    expect(screen.getByText(`Grace period — changes are accepted until ${DEADLINE}.`)).toBeTruthy();
    expect(screen.getByText('Grace periods left: 2 of 3 in any 12 months.')).toBeTruthy();
    // The business's clock, not this machine's (unless this machine reads Tokyo's).
    const machine = format(new Date(GRACE_ENDS), 'HH:mm');
    if (machine !== '19:00') expect(textOf(screen.root)).not.toContain(machine);
    expect(textOf(screen.root)).not.toMatch(COMMERCE);
  });

  it('the zone the server names decides the hour, and is named: the same instant in New York', async () => {
    serve(inGrace({}, 'America/New_York'));
    renderScreen();
    const deadline = '21 Oct 2026 · 06:00 (Eastern Daylight Time)';
    expect(await screen.findByText(`Your business is in its grace period. Changes are accepted until ${deadline}.`)).toBeTruthy();
    expect(screen.getByText(`Grace period — changes are accepted until ${deadline}.`)).toBeTruthy();
  });

  it('the count is the server’s: the last one in use says none left, and a count it did not make is not shown', async () => {
    serve(inGrace({ usesInWindow: 3, usesRemaining: 0 }));
    const view = renderScreen();
    expect(await screen.findByText('Grace periods left: 0 of 3 in any 12 months.')).toBeTruthy();
    view.unmount();

    serve(inGrace({ usesInWindow: null, usesRemaining: null }));
    renderScreen();
    expect(await screen.findByText(`Your business is in its grace period. Changes are accepted until ${DEADLINE}.`)).toBeTruthy();
    expect(screen.queryByText(/Grace periods left/)).toBeNull();
  });

  it('a server too old to send the grace or the zone: the deadline on the phone’s clock, as before, and no allowance', async () => {
    const { grace: _grace, timeZone: _zone, ...older } = inGrace();
    serve(older);
    renderScreen();
    const phone = format(new Date(GRACE_ENDS), 'd MMM yyyy · HH:mm');
    expect(await screen.findByText(`Your business is in its grace period. Changes are accepted until ${phone}.`)).toBeTruthy();
    expect(screen.queryByText(/Grace periods left/)).toBeNull();
  });

  it('in French and in Arabic, the allowance in each language, its numbers the server’s', async () => {
    serve(inGrace());
    await useI18n.getState().setLanguage('fr');
    const fr = renderScreen();
    expect(await screen.findByText('Périodes de grâce restantes : 2 sur 3 par période de 12 mois.')).toBeTruthy();
    fr.unmount();

    await act(async () => {
      await useI18n.getState().setLanguage('ar');
    });
    renderScreen();
    expect(await screen.findByText('فترات السماح المتبقية: 2 من 3 خلال أي 12 شهرًا.')).toBeTruthy();
  });
});

describe('a paid period that ended', () => {
  it('with the allowance used: read-only, and no grace followed — said beside the read-only words, nothing to press', async () => {
    serve(expired({ status: 'unavailable', usesInWindow: 3, usesRemaining: 0 }));
    renderScreen();
    expect(await screen.findByText('No grace period followed: the 3 grace periods of the last 12 months are used.')).toBeTruthy();
    expect(screen.getByText(t('access.readOnly.body'))).toBeTruthy();
    expect(screen.getByText(t('access.readOnly.kept'))).toBeTruthy();
    expect(textOf(screen.root)).not.toMatch(COMMERCE);
  });

  it('after a grace that ran out: read-only, and nothing about the allowance', async () => {
    serve(expired({ status: 'ended', endsAt: GRACE_ENDS, usesInWindow: 1, usesRemaining: 2 }));
    renderScreen();
    expect(await screen.findByText(t('access.readOnly.body'))).toBeTruthy();
    expect(screen.queryByText(/grace period/i)).toBeNull();
  });

  it('an ended free trial is never told about grace, whatever the server sends beside it', async () => {
    const trial = { status: 'expired', durationHours: 168, durationDays: 7, claimedAt: '2026-10-10T10:00:00.000Z', startedAt: '2026-10-10T10:00:00.000Z', endsAt: '2026-10-17T10:00:00.000Z', timeZone: 'Asia/Tokyo' };
    serve({ ...expired({ status: 'unavailable', usesInWindow: 3, usesRemaining: 0 }), state: 'trial_expired', status: 'pending_activation', periodEnd: null, trial });
    renderScreen();
    await waitFor(() => expect(screen.getAllByText(/The free trial ended on/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/grace period/i)).toBeNull();
  });
});

describe('a paid period that runs', () => {
  it('whose end would open no grace: says so, plainly — no action', async () => {
    serve(active({ availableAtPeriodEnd: false, usesInWindow: 3, usesRemaining: 0 }));
    renderScreen();
    expect(await screen.findByText('If access ends before it is extended, no grace period follows: the 3 of the last 12 months are used.')).toBeTruthy();
    expect(textOf(screen.root)).not.toMatch(COMMERCE);
  });

  it('whose end would open one — or whose server does not say — says nothing about grace', async () => {
    for (const availableAtPeriodEnd of [true, null]) {
      serve(active({ availableAtPeriodEnd }));
      const view = renderScreen();
      expect(await screen.findByText(t('access.active.until', { date: '18 Nov 2026' }))).toBeTruthy();
      expect(screen.queryByText(/grace period/i)).toBeNull();
      view.unmount();
    }
  });
});
