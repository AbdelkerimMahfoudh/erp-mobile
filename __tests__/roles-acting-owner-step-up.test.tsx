/// <reference types="jest" />
/**
 * The Acting Owner, rendered (D225):
 *  - "Acting as Owner until …" in English, French and Arabic, with an end and without;
 *  - naming and removing ask for the Owner's password, then the WhatsApp code sent for that very change, and send the
 *    server exactly what it binds the code to.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import { t, useI18n } from '../lib/i18n';
import { useBranch } from '../lib/branch';
import { formatDateTime } from '../lib/format';

jest.mock('../lib/api-client', () => {
  class ApiError extends Error {
    status: number;
    code?: string;
    body?: unknown;
    constructor(message: string, status = 500, code?: string, body?: unknown) {
      super(message);
      this.status = status;
      this.code = code;
      this.body = body;
    }
  }
  return {
    __esModule: true,
    ApiError,
    api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), put: jest.fn(), delete: jest.fn() },
    clearSession: jest.fn(),
  };
});
let mockUser: Record<string, unknown> | null = null;
const mockRefreshUser = jest.fn(async () => undefined);
jest.mock('../hooks/useAuth', () => ({ __esModule: true, useAuth: () => ({ user: mockUser, refreshUser: mockRefreshUser }) }));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import { api, ApiError } from '../lib/api-client';
import { ActingOwnerBanner } from '../components/ui/ActingOwnerBanner';
import ActingOwnerScreen from '../app/acting-owner';

const UNTIL = '2026-11-05T23:59:59.000Z';

describe('"Acting as Owner until …" in the three languages', () => {
  async function banner(until: string | null) {
    mockUser = { id: 'u', name: 'Mohamed', actingOwner: { delegationId: 'd', until } };
    return render(
      <ThemeProvider>
        <ActingOwnerBanner />
      </ThemeProvider>,
    );
  }

  afterAll(async () => {
    await useI18n.getState().setLanguage('en');
  });

  it('English', async () => {
    await useI18n.getState().setLanguage('en');
    await banner(UNTIL);
    expect(screen.getByText(`Acting as Owner until ${formatDateTime(UNTIL)}`)).toBeTruthy();
    await banner(null);
    expect(screen.getByText('Acting as Owner until the Owner ends it')).toBeTruthy();
  });

  it('French', async () => {
    await useI18n.getState().setLanguage('fr');
    await banner(UNTIL);
    const text = t('actingOwner.banner.until', { date: formatDateTime(UNTIL) });
    expect(screen.getByText(text)).toBeTruthy();
    expect(text).not.toBe(`Acting as Owner until ${formatDateTime(UNTIL)}`);
    expect(text).toContain(formatDateTime(UNTIL));
    await banner(null);
    expect(screen.getByText(t('actingOwner.banner.open'))).toBeTruthy();
    expect(t('actingOwner.banner.open')).not.toBe('Acting as Owner until the Owner ends it');
  });

  it('Arabic', async () => {
    await useI18n.getState().setLanguage('ar');
    await banner(UNTIL);
    const text = t('actingOwner.banner.until', { date: formatDateTime(UNTIL) });
    expect(screen.getByText(text)).toBeTruthy();
    expect(text).toMatch(/[؀-ۿ]/);
    expect(text).toContain(formatDateTime(UNTIL));
    await banner(null);
    expect(screen.getByText(t('actingOwner.banner.open'))).toBeTruthy();
    expect(t('actingOwner.banner.open')).toMatch(/[؀-ۿ]/);
  });

  it('shows nothing when no appointment is in force', async () => {
    await useI18n.getState().setLanguage('en');
    mockUser = { id: 'u', name: 'Mohamed', actingOwner: null };
    await render(
      <ThemeProvider>
        <ActingOwnerBanner />
      </ThemeProvider>,
    );
    expect(screen.queryByText(/Acting as Owner/)).toBeNull();
  });
});

const MOHAMED = { id: 'u-mo', name: 'Mohamed', nameAr: null, login: 'mo', phone: null, email: null, phoneVerifiedAt: null, emailVerifiedAt: null, isActive: true, status: 'active', lastLoginAt: null, branches: [{ branchId: 'b1', branchName: 'Boutique', role: 'store_manager' }], delegatablePermissions: [] };
const SENT = { challengeId: 'c-1', destinationMasked: '+222 ••• 67', expiresAt: '2026-10-30T10:05:00.000Z', resendAvailableAt: null };

const password = () => screen.container.queryAll((n) => n.type === 'TextInput' && n.props.secureTextEntry === true)[0];
const codeField = () => screen.container.queryAll((n) => n.type === 'TextInput' && n.props.autoComplete === 'one-time-code')[0];

async function mountScreen(delegations: unknown[]) {
  (api.get as jest.Mock).mockImplementation(async (path: string) => {
    if (path === '/acting-owner') return { delegations, delegatedPermissions: [] };
    if (path === '/users') return [MOHAMED];
    throw new Error(`unexpected read ${path}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
  await render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <ActingOwnerScreen />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('the Owner’s step-up: password, then the WhatsApp code', () => {
  beforeEach(async () => {
    await useI18n.getState().setLanguage('en');
    useBranch.setState({ branchId: 'b1', branchName: 'Boutique', role: 'owner' });
    mockUser = { id: 'owner', name: 'Owner', actingOwner: null };
    (api.post as jest.Mock).mockReset();
  });

  it('naming someone until revoked: the code is asked for that appointment, then confirmed with it', async () => {
    await mountScreen([]);
    await fireEvent.press(await screen.findByText(t('actingOwner.appoint')));
    await fireEvent.press(await screen.findByText(t('actingOwner.choosePerson')));
    await fireEvent.press((await screen.findAllByText('Mohamed')).slice(-1)[0]);
    await fireEvent.changeText(password(), 'owner-pw');

    (api.post as jest.Mock).mockResolvedValueOnce(SENT);
    await fireEvent.press(screen.getByText(t('actingOwner.stepUp.send')));
    expect(api.post).toHaveBeenLastCalledWith('/acting-owner/code', { action: 'appoint', delegateId: 'u-mo', currentPassword: 'owner-pw', language: 'en' });
    expect(await screen.findByText(t('actingOwner.stepUp.sent', { destination: SENT.destinationMasked }))).toBeTruthy();
    // The summary still says "until you remove it" while the code is typed.
    expect(screen.getByText(new RegExp(t('actingOwner.summary.untilRevoked')))).toBeTruthy();

    // A wrong code: the server's attempts left, in words; nothing appointed.
    (api.post as jest.Mock).mockRejectedValueOnce(new ApiError('bad', 400, 'invalid_code', { code: 'invalid_code', attemptsRemaining: 4 }));
    await fireEvent.changeText(codeField(), '000000');
    await fireEvent.press(screen.getByText(t('actingOwner.confirm')));
    expect(await screen.findByText(t('account.code.wrong', { left: '4' }))).toBeTruthy();

    (api.post as jest.Mock).mockResolvedValueOnce({ id: 'd1' });
    await fireEvent.changeText(codeField(), '123456');
    await fireEvent.press(screen.getByText(t('actingOwner.confirm')));
    await waitFor(() =>
      expect(api.post).toHaveBeenLastCalledWith('/acting-owner', { delegateId: 'u-mo', currentPassword: 'owner-pw', challengeId: 'c-1', code: '123456' }),
    );
  });

  it('no verified WhatsApp number: told where to verify it, and no code field appears', async () => {
    await mountScreen([]);
    await fireEvent.press(await screen.findByText(t('actingOwner.appoint')));
    await fireEvent.press(await screen.findByText(t('actingOwner.choosePerson')));
    await fireEvent.press((await screen.findAllByText('Mohamed')).slice(-1)[0]);
    await fireEvent.changeText(password(), 'owner-pw');
    (api.post as jest.Mock).mockRejectedValueOnce(new ApiError('no number', 409, 'whatsapp_number_required'));
    await fireEvent.press(screen.getByText(t('actingOwner.stepUp.send')));
    expect(await screen.findByText(t('actingOwner.error.needNumber'))).toBeTruthy();
    expect(codeField()).toBeUndefined();
  });

  it('removing: the code is asked for that removal, then confirmed with it', async () => {
    await mountScreen([
      { id: 'd1', delegateId: 'u-mo', delegate: { name: 'Mohamed', nameAr: null }, grantedById: 'owner', startsAt: '2026-10-30T08:00:00.000Z', endsAt: null, revokedAt: null, state: 'active' },
    ]);
    await fireEvent.press(await screen.findByText(t('actingOwner.remove')));
    await fireEvent.changeText(password(), 'owner-pw');
    (api.post as jest.Mock).mockResolvedValueOnce(SENT);
    await fireEvent.press(screen.getByText(t('actingOwner.stepUp.send')));
    expect(api.post).toHaveBeenLastCalledWith('/acting-owner/code', { action: 'revoke', delegationId: 'd1', currentPassword: 'owner-pw', language: 'en' });

    (api.post as jest.Mock).mockResolvedValueOnce({ id: 'd1' });
    await fireEvent.changeText(await waitFor(() => codeField() ?? Promise.reject(new Error('no code field'))), '654321');
    await fireEvent.press(screen.getByText(t('actingOwner.removeConfirm')));
    await waitFor(() => expect(api.post).toHaveBeenLastCalledWith('/acting-owner/d1/revoke', { currentPassword: 'owner-pw', challengeId: 'c-1', code: '654321' }));
    await waitFor(() => expect(mockRefreshUser).toHaveBeenCalled());
  });
});
