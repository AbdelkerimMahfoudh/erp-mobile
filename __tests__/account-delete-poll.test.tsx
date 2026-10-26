/// <reference types="jest" />
/**
 * A deletion carried out by another confirmation is followed by reading its state (`poll` on the deletion screen).
 * The session ends the moment the deletion completes, so a 401 there means it did. Anything else — no connection, a
 * timeout, a server error — says nothing about the deletion: the screen must not say "Your login has been deleted" on
 * it (and so forget the login on this phone). It asks again; only the 401 brings the result.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import { t } from '../lib/i18n';
import { RequestTimeout } from '../lib/offline/classify';
import type { AccountView, DeletionRequestView } from '../types/api';

jest.mock('../lib/api-client', () => {
  class ApiError extends Error {
    status: number;
    code?: string;
    constructor(message: string, status = 500, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  return {
    __esModule: true,
    ApiError,
    api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), put: jest.fn(), delete: jest.fn() },
    clearSession: jest.fn(),
  };
});
const mockForgetDeletedLogin = jest.fn();
jest.mock('../hooks/useAuth', () => ({
  __esModule: true,
  useAuth: () => ({ user: { id: 'u1', name: 'Aicha', login: 'aicha', publicStoreId: 'S1' }, bootstrapping: false, signOut: jest.fn(), forgetDeletedLogin: mockForgetDeletedLogin }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import { api, ApiError } from '../lib/api-client';
import DeleteAccountScreen from '../app/account/delete';
import { textInputs } from './tree';

const request = (status: DeletionRequestView['status']): DeletionRequestView => ({
  id: 'd1', kind: 'personal_login', status, destinationMasked: '+222••••0000', language: 'en', createdAt: '2026-10-16T09:00:00.000Z',
  codeSentAt: '2026-10-16T09:00:00.000Z', codeExpiresAt: '2026-10-16T09:10:00.000Z', attemptsRemaining: 5, resendAvailableAt: null,
  delivered: true, deliveryProblem: null, confirmedAt: null, completedAt: null, cancelledAt: null, failure: null, retained: null,
});
const me: AccountView = {
  id: 'u1', name: 'Aicha', login: 'aicha', personalId: 'P-1', phone: '+22200000000', phoneVerifiedAt: '2026-10-15T09:00:00.000Z', email: null,
  emailVerifiedAt: null, whatsappVerified: true, deletionKind: 'personal_login', deletion: request('awaiting_code'),
};

it('a lost answer while the deletion is carried out is asked again, never reported as done; the 401 is', async () => {
  const answers: (() => unknown)[] = [
    () => {
      throw new RequestTimeout();
    },
    () => {
      throw new ApiError('Request failed (503)', 503);
    },
    () => {
      throw new ApiError('Unauthorized', 401);
    },
  ];
  (api.get as jest.Mock).mockImplementation(async (path: string) => {
    if (path === '/account') return me;
    if (path === '/account/deletion') return answers.shift()!();
    throw new Error(`unexpected read ${path}`);
  });
  (api.post as jest.Mock).mockImplementation(async (path: string) => {
    if (path === '/account/deletion/confirm') return request('processing');
    throw new Error(`unexpected write ${path}`);
  });

  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <DeleteAccountScreen />
      </QueryClientProvider>
    </ThemeProvider>,
  );
  await screen.findByText(t('account.delete.confirm'));
  await fireEvent.changeText(textInputs()[0], '123456');
  await fireEvent.press(screen.getByText(t('account.delete.confirm')));

  // The timeout (after 1.5 s) and the 503 (3 s later) are each followed by another read, and say nothing.
  await waitFor(() => expect(answers).toHaveLength(1), { timeout: 8000 });
  expect(screen.queryByText(t('account.delete.doneLogin'))).toBeNull();
  expect(mockForgetDeletedLogin).not.toHaveBeenCalled();
  // The 401: the session ended because the deletion completed.
  expect(await screen.findByText(t('account.delete.doneLogin'), {}, { timeout: 8000 })).toBeTruthy();
  expect(mockForgetDeletedLogin).toHaveBeenCalledTimes(1);
}, 20000);
