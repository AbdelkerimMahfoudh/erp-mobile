/// <reference types="jest" />
/**
 * Confirming a WhatsApp number on Your account, when the answer is lost (shared contract C14).
 *
 * The server holds the confirmation for a few seconds at most, but a phone on a weak connection can still give up
 * first. The number may then be verified already, and its code spent: the section must not say the code was wrong.
 * It reads the account again, and the account decides: the number typed is now the verified one — done — or it is
 * not, and the confirmation did not go through, whatever number the account showed before; changing an already
 * verified number is where a chip would have said "Verified" for the old one. An account that cannot be read again
 * is said to be unread, and read again on request. A refusal the server did give — a wrong code — is still said as one.
 */
import React from 'react';
import { TextInput } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import { t } from '../lib/i18n';
import { RequestTimeout } from '../lib/offline/classify';
import { useToastStore } from '../lib/toast';
import type { AccountView } from '../types/api';

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

import { api, ApiError } from '../lib/api-client';
import AccountScreen from '../app/account';
import { CONSENT_VERSION, consentCopyFor } from './mocks/whatsapp-consent';

const none: AccountView = {
  id: 'u1', name: 'Aicha', login: 'aicha', personalId: 'P-1', phone: null, phoneVerifiedAt: null, email: 'aicha@example.invalid',
  emailVerifiedAt: '2026-10-13T09:00:00.000Z', whatsappVerified: false, deletionKind: 'company_closure', deletion: null,
};
const verified = (phone: string): AccountView => ({ ...none, phone, phoneVerifiedAt: '2026-10-15T09:00:00.000Z', whatsappVerified: true });
const started = { challengeId: 'c1', destinationMasked: '+222••••8877', expiresAt: '2026-10-15T09:10:00.000Z', attemptsRemaining: 5, resendAvailableAt: null, delivered: true };

/** The server: the account as it holds it now, and a confirmation whose answer never arrives — committed or not. */
function server(account: { now: AccountView }, onConfirm: () => void) {
  (api.get as jest.Mock).mockImplementation(async (path: string) => {
    if (path === '/account') return account.now;
    if (path === '/account/trial-setup') return { state: 'trial_available', eligible: false };
    if (consentCopyFor(path)) return consentCopyFor(path);
    if (path.startsWith('/account/whatsapp/consent')) return { state: 'granted', copy: consentCopyFor('/messaging/whatsapp/consent?language=en'), history: [] };
    throw new Error(`unexpected read ${path}`);
  });
  (api.post as jest.Mock).mockImplementation(async (path: string) => {
    if (path === '/account/whatsapp/verify/start') return started;
    onConfirm();
    throw new RequestTimeout();
  });
}

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <AccountScreen />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

/** Opens the number form, types the number as a person would, asks for a code and types it, then confirms. */
async function confirmNumber(open: string, typed: string) {
  fireEvent.press(await screen.findByText(open));
  const [phone, password] = screen.UNSAFE_getAllByType(TextInput);
  fireEvent.changeText(phone, typed);
  fireEvent.changeText(password, 'correct horse');
  // The new number's own consent, ticked by the person (D213).
  fireEvent.press(await screen.findByTestId('whatsapp-consent-check'));
  await act(async () => {
    fireEvent.press(screen.getByText(t('account.whatsapp.send')));
  });
  fireEvent.changeText(screen.UNSAFE_getAllByType(TextInput)[0], '123456');
  await act(async () => {
    fireEvent.press(screen.getByText(t('account.whatsapp.confirm')));
  });
}

const toasts = () => useToastStore.getState().toasts.map((x) => `${x.tone}: ${x.message}`);

beforeEach(() => {
  (api.get as jest.Mock).mockReset();
  (api.post as jest.Mock).mockReset();
  useToastStore.getState().clear();
});

it('a lost answer for a first number the server did verify is done: the account holds it, verified', async () => {
  const account = { now: none };
  server(account, () => (account.now = verified('+22249998877')));
  renderScreen();
  await confirmNumber(t('account.whatsapp.verify'), '4999 8877');

  await waitFor(() => expect(toasts()).toEqual([`success: ${t('account.whatsapp.done')}`]));
  expect(screen.getByText('+22249998877')).toBeTruthy();
  expect(screen.getByText(t('account.whatsapp.verified'))).toBeTruthy();
  expect(screen.queryByText(t('account.whatsapp.notConfirmed'))).toBeNull();
  expect(screen.queryByText(/That code is not right/)).toBeNull();
  // Back on the number, not left on a code that has been spent.
  expect(screen.queryByText(t('account.whatsapp.confirm'))).toBeNull();
});

it('changing a verified number: a lost answer the server never committed is not confirmed — beside the old, still verified number', async () => {
  const account = { now: verified('+22241111111') };
  server(account, () => undefined);
  renderScreen();
  await confirmNumber(t('account.whatsapp.change'), '4999 8877');

  expect(await screen.findByText(t('account.whatsapp.notConfirmed'))).toBeTruthy();
  expect(screen.getByText('+22241111111')).toBeTruthy();
  expect(toasts()).toEqual([]);
  // Try again is the way on: the form again, with the number already typed.
  expect(screen.queryByText(t('account.whatsapp.change'))).toBeNull();
  fireEvent.press(screen.getByText(t('action.retry')));
  expect(screen.UNSAFE_getAllByType(TextInput)[0].props.value).toBe('4999 8877');
  expect(screen.queryByText(t('account.whatsapp.notConfirmed'))).toBeNull();
});

it('changing a verified number: a lost answer the server did commit is done', async () => {
  const account = { now: verified('+22241111111') };
  server(account, () => (account.now = verified('+22249998877')));
  renderScreen();
  await confirmNumber(t('account.whatsapp.change'), '+222 4999 8877');

  await waitFor(() => expect(toasts()).toEqual([`success: ${t('account.whatsapp.done')}`]));
  expect(screen.getByText('+22249998877')).toBeTruthy();
  expect(screen.queryByText(t('account.whatsapp.notConfirmed'))).toBeNull();
});

it('an account that cannot be read again is said to be unread, and Try again reads it again', async () => {
  const account = { now: none };
  server(account, () => (account.now = verified('+22249998877')));
  renderScreen();
  fireEvent.press(await screen.findByText(t('account.whatsapp.verify')));
  // The connection drops with the confirmation: its answer is lost, then so is the account read just after it.
  const read = api.get as jest.Mock;
  const answer = read.getMockImplementation()!;
  read.mockImplementation(async (path: string) => {
    if (path === '/account' && read.mock.calls.filter(([p]) => p === '/account').length === 2) throw new TypeError('Network request failed');
    return answer(path);
  });
  const [phone, password] = screen.UNSAFE_getAllByType(TextInput);
  fireEvent.changeText(phone, '49998877');
  fireEvent.changeText(password, 'correct horse');
  fireEvent.press(await screen.findByTestId('whatsapp-consent-check'));
  await act(async () => {
    fireEvent.press(screen.getByText(t('account.whatsapp.send')));
  });
  fireEvent.changeText(screen.UNSAFE_getAllByType(TextInput)[0], '123456');
  await act(async () => {
    fireEvent.press(screen.getByText(t('account.whatsapp.confirm')));
  });

  expect(await screen.findByText(t('account.whatsapp.unread'))).toBeTruthy();
  expect(toasts()).toEqual([]);
  await act(async () => {
    fireEvent.press(screen.getByText(t('action.retry')));
  });
  await waitFor(() => expect(toasts()).toEqual([`success: ${t('account.whatsapp.done')}`]));
  expect(screen.queryByText(t('account.whatsapp.unread'))).toBeNull();
  expect(screen.getByText('+22249998877')).toBeTruthy();
});

it('a code the server refused is still said to be wrong', async () => {
  (api.get as jest.Mock).mockImplementation(async () => none);
  (api.post as jest.Mock).mockImplementation(async (path: string) => {
    if (path === '/account/whatsapp/verify/start') return started;
    throw new ApiError('That code is not right.', 400, 'invalid_code', { attemptsRemaining: 4 });
  });
  renderScreen();
  await confirmNumber(t('account.whatsapp.verify'), '+22249998877');

  expect(await screen.findByText(t('account.code.wrong', { left: '4' }))).toBeTruthy();
  expect(screen.queryByText(t('account.whatsapp.notConfirmed'))).toBeNull();
  expect(screen.queryByText(t('account.whatsapp.unread'))).toBeNull();
});

describe('a new number’s own consent (D213)', () => {
  it('starts unticked; without it no code is asked for; ticked, the server’s version and the language shown go with the number', async () => {
    const account = { now: verified('+22249998877') };
    server(account, () => undefined);
    renderScreen();
    fireEvent.press(await screen.findByText(t('account.whatsapp.change')));
    const [phone, password] = screen.UNSAFE_getAllByType(TextInput);
    fireEvent.changeText(phone, '36001122');
    fireEvent.changeText(password, 'correct horse');
    const box = await screen.findByTestId('whatsapp-consent-check');
    expect(box.props.accessibilityState).toMatchObject({ checked: false });
    await act(async () => {
      fireEvent.press(screen.getByText(t('account.whatsapp.send')));
    });
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.getByText(t('consent.problem.required'))).toBeTruthy();

    fireEvent.press(box);
    expect(screen.getByTestId('whatsapp-consent-check').props.accessibilityState).toMatchObject({ checked: true });
    await act(async () => {
      fireEvent.press(screen.getByText(t('account.whatsapp.send')));
    });
    expect(api.post).toHaveBeenCalledWith('/account/whatsapp/verify/start', expect.objectContaining({ whatsappConsentVersion: CONSENT_VERSION, whatsappConsentLocale: 'en' }));
  });
});
