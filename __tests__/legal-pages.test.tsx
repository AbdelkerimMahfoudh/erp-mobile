/// <reference types="jest" />
/**
 * The privacy policy, the terms, support and how account deletion works (the owner's brief of 2026-10-16, docs/85):
 * on Your account, on the deletion screen and on the screen of a login with no branch — which can now reach its own
 * account, and so its deletion. Each row opens its page in the phone's own browser at its exact in-app address, in the
 * person's language; none is a price, a payment, a subscription or a trial action. A build without the origin shows none.
 */
import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import { t } from '../lib/i18n';
import type { AccountView } from '../types/api';

const ORIGIN = 'https://www.company-domain.mr';
jest.mock('../constants/config', () => ({ ...jest.requireActual('../constants/config'), LEGAL_ORIGIN: 'https://www.company-domain.mr' }));
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
jest.mock('../hooks/useAuth', () => ({
  __esModule: true,
  useAuth: () => ({ user: { id: 'u1', name: 'Aicha', login: 'aicha', publicStoreId: 'S1' }, bootstrapping: false, signOut: jest.fn(), forgetDeletedLogin: jest.fn() }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import { api } from '../lib/api-client';
import { refuseBrowser } from '../lib/navigation/no-browser';
import AccountScreen from '../app/account';
import DeleteAccountScreen from '../app/account/delete';
import SelectBranch from '../app/select-branch';
import { push } from './mocks/expo-router';

const me: AccountView = {
  id: 'u1', name: 'Aicha', login: 'aicha', personalId: 'P-1', phone: '+22200000000', phoneVerifiedAt: '2026-10-15T09:00:00.000Z', email: null,
  emailVerifiedAt: null, whatsappVerified: true, deletionKind: 'personal_login', deletion: null,
};

const phone = jest.fn(async (_url: string) => {});
beforeAll(() => {
  Linking.openURL = phone;
  refuseBrowser();
});
beforeEach(() => {
  phone.mockClear();
  push.mockClear();
  (api.get as jest.Mock).mockImplementation(async (path: string) => {
    if (path === '/account') return me;
    if (path === '/account/deletion') return { request: null };
    if (path === '/auth/branches') return [];
    throw new Error(`unexpected read ${path}`);
  });
});

async function show(element: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>{element}</QueryClientProvider>
    </ThemeProvider>,
  );
}

/** What a button must never be about. */
const COMMERCE = /\bMRU\b|أوقية|\bprice\b|\bprix\b|\bpay\b|\bpayer\b|paiement|الدفع|subscri|abonne|اشتراك|\btrial\b|\bessai\b|تجريب|\bbuy\b|\bacheter\b|\bapply\b/i;

it('Your account: the four pages, each opened at its exact address, beside the way to delete the account', async () => {
  await show(<AccountScreen />);
  expect((await screen.findAllByText(t('account.delete.row'))).length).toBeGreaterThan(0);
  for (const key of ['legal.privacy', 'legal.terms', 'legal.support', 'legal.accountDeletion'] as const) expect(screen.getByText(t(key))).toBeTruthy();
  await fireEvent.press(screen.getByText(t('legal.privacy')));
  await fireEvent.press(screen.getByText(t('legal.accountDeletion')));
  await waitFor(() => expect(phone).toHaveBeenCalledTimes(2));
  expect(phone.mock.calls.map(([url]) => url)).toEqual([`${ORIGIN}/in-app/privacy`, `${ORIGIN}/in-app/account-deletion`]);
  expect(push).not.toHaveBeenCalled();
});

it('the deletion screen: how deletion works, privacy and support — and no price, payment, subscription or trial', async () => {
  await show(<DeleteAccountScreen />);
  await screen.findByText(t('account.delete.heading'));
  for (const key of ['legal.accountDeletion', 'legal.privacy', 'legal.support'] as const) expect(screen.getByText(t(key))).toBeTruthy();
  expect(screen.queryByText(t('legal.terms'))).toBeNull();
  // Nothing to press is a price, a payment, a subscription or the trial: every button and row, by its label.
  const pressable = screen.getAllByRole('button').map((b) => String(b.props.accessibilityLabel ?? ''));
  expect(pressable.length).toBeGreaterThan(3);
  expect(pressable.filter((label) => COMMERCE.test(label))).toEqual([]);
  await fireEvent.press(screen.getByText(t('legal.support')));
  await waitFor(() => expect(phone).toHaveBeenCalledWith(`${ORIGIN}/in-app/support`));
});

it('a login assigned to no branch reaches its own account — and so its deletion — and the pages', async () => {
  await show(<SelectBranch />);
  await screen.findByText(t('branch.select.none.title'));
  await fireEvent.press(screen.getByText(t('nav.account')));
  expect(push).toHaveBeenCalledWith('/account');
  await fireEvent.press(screen.getByText(t('legal.terms')));
  await waitFor(() => expect(phone).toHaveBeenCalledWith(`${ORIGIN}/in-app/terms`));
});
