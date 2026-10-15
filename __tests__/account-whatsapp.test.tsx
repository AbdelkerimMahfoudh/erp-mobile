/// <reference types="jest" />
/**
 * Confirming a WhatsApp number on Your account, when the answer is lost (shared contract C14).
 *
 * The server holds the confirmation for a few seconds at most, but a phone on a weak connection can still give up
 * first. The number may then be verified already, and its code spent: the section must not say the code was wrong.
 * It says the confirmation could not be confirmed in time, reads the account again and shows the number as the server
 * now has it. A refusal the server did give — a wrong code — is still said as one.
 */
import React from 'react';
import { TextInput } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import { t } from '../lib/i18n';
import { RequestTimeout } from '../lib/offline/classify';
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

const before: AccountView = {
  id: 'u1', name: 'Aicha', login: 'aicha', personalId: 'P-1', phone: null, phoneVerifiedAt: null, email: 'aicha@example.invalid',
  emailVerifiedAt: '2026-10-13T09:00:00.000Z', whatsappVerified: false, deletionKind: 'company_closure', deletion: null,
};
const after: AccountView = { ...before, phone: '+22249998877', phoneVerifiedAt: '2026-10-15T09:00:00.000Z', whatsappVerified: true };

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

/** Opens the number form, asks for a code and types it — up to the press on Confirm number. */
async function upToConfirm() {
  fireEvent.press(await screen.findByText(t('account.whatsapp.verify')));
  const [phone, password] = screen.UNSAFE_getAllByType(TextInput);
  fireEvent.changeText(phone, '+22249998877');
  fireEvent.changeText(password, 'correct horse');
  await act(async () => {
    fireEvent.press(screen.getByText(t('account.whatsapp.send')));
  });
  fireEvent.changeText(screen.UNSAFE_getAllByType(TextInput)[0], '123456');
}

beforeEach(() => {
  (api.get as jest.Mock).mockReset();
  (api.post as jest.Mock).mockReset();
});

it('an answer lost in time is not a wrong code: the section says so, reads the account again and shows the number as it now is', async () => {
  let account = before;
  (api.get as jest.Mock).mockImplementation(async (path: string) => {
    if (path === '/account') return account;
    if (path === '/account/trial-setup') return { state: 'trial_available', eligible: false };
    throw new Error(`unexpected read ${path}`);
  });
  (api.post as jest.Mock).mockImplementation(async (path: string) => {
    if (path === '/account/whatsapp/verify/start') {
      return { challengeId: 'c1', destinationMasked: '+222••••8877', expiresAt: '2026-10-15T09:10:00.000Z', attemptsRemaining: 5, resendAvailableAt: null, delivered: true };
    }
    // The server verified the number; only its answer was lost on the way back.
    account = after;
    throw new RequestTimeout();
  });
  renderScreen();
  await upToConfirm();
  await act(async () => {
    fireEvent.press(screen.getByText(t('account.whatsapp.confirm')));
  });

  expect(await screen.findByText(t('account.whatsapp.timeout'))).toBeTruthy();
  await waitFor(() => expect(screen.getByText(t('account.whatsapp.verified'))).toBeTruthy());
  expect(screen.getByText('+22249998877')).toBeTruthy();
  expect((api.get as jest.Mock).mock.calls.filter(([path]) => path === '/account').length).toBeGreaterThanOrEqual(2);
  expect(screen.queryByText(/That code is not right/)).toBeNull();
  // Back on the number, not left on a code that has been spent.
  expect(screen.queryByText(t('account.whatsapp.confirm'))).toBeNull();
});

it('a code the server refused is still said to be wrong', async () => {
  (api.get as jest.Mock).mockImplementation(async () => before);
  (api.post as jest.Mock).mockImplementation(async (path: string) => {
    if (path === '/account/whatsapp/verify/start') {
      return { challengeId: 'c1', destinationMasked: '+222••••8877', expiresAt: '2026-10-15T09:10:00.000Z', attemptsRemaining: 5, resendAvailableAt: null, delivered: true };
    }
    throw new ApiError('That code is not right.', 400, 'invalid_code', { attemptsRemaining: 4 });
  });
  renderScreen();
  await upToConfirm();
  await act(async () => {
    fireEvent.press(screen.getByText(t('account.whatsapp.confirm')));
  });

  expect(await screen.findByText(t('account.code.wrong', { left: '4' }))).toBeTruthy();
  expect(screen.queryByText(t('account.whatsapp.timeout'))).toBeNull();
});
