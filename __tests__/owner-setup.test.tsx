/// <reference types="jest" />
/**
 * An Owner's first password from the platform's one-time setup code (0075, D217), and the test business said on every
 * signed-in screen.
 *
 * The Owner pastes the code and chooses a password; nothing else is asked, nothing is sent to their number, and no
 * session is opened — they then sign in like anybody else. Every unusable code reads the same. A test business carries
 * a strip in words on every screen; any other business carries none.
 */
import React from 'react';
import { TextInput } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ThemeProvider } from '../lib/design/theme';
import { t } from '../lib/i18n';
import * as router from './mocks/expo-router';

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

const authState: { user: { isTestBusiness?: boolean } | null } = { user: null };
jest.mock('../hooks/useAuth', () => ({ __esModule: true, useAuth: () => authState }));

import { api, ApiError } from '../lib/api-client';
import OwnerSetupScreen from '../app/(auth)/setup';
import { TestBusinessBanner } from '../components/ui/TestBusinessBanner';

const CODE = 'Z3VhcmQtdGhpcy1zZXR1cC1jb2RlLW9uY2UtMDEyMzQ1';

const inputs = () => screen.UNSAFE_getAllByType(TextInput);
const press = async (label: string) => {
  await act(async () => {
    fireEvent.press(screen.getByText(label));
  });
};

function renderSetup() {
  return render(
    <ThemeProvider>
      <OwnerSetupScreen />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  (api.post as jest.Mock).mockReset();
  router.replace.mockClear();
});

describe('the Owner’s setup code', () => {
  it('sends the pasted code — spaces removed — and the chosen password, and nothing else; then offers sign-in', async () => {
    (api.post as jest.Mock).mockResolvedValue({ publicStoreId: 'AB12CD34EF', businessName: 'Labo Test', next: 'sign_in' });
    renderSetup();
    fireEvent.changeText(inputs()[0], ` ${CODE.slice(0, 20)} ${CODE.slice(20)} `);
    fireEvent.changeText(inputs()[1], 'my-own-password');
    await press(t('setup.confirm'));
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/auth/owner-setup', { token: CODE, password: 'my-own-password' });
    expect(screen.getByText(t('setup.done', { business: 'Labo Test' }))).toBeTruthy();
    await press(t('setup.signIn'));
    expect(router.replace).toHaveBeenCalledWith('/(auth)/login');
  });

  it('says a short password and a short code before anything is sent', async () => {
    renderSetup();
    fireEvent.changeText(inputs()[0], 'too-short');
    fireEvent.changeText(inputs()[1], 'my-own-password');
    await press(t('setup.confirm'));
    expect(screen.getByText(t('setup.problem.code'))).toBeTruthy();
    fireEvent.changeText(inputs()[0], CODE);
    fireEvent.changeText(inputs()[1], 'short');
    await press(t('setup.confirm'));
    expect(screen.getByText(t('setup.problem.password'))).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('an unusable code — unknown, expired, used, replaced or not yet allowed — reads the one way', async () => {
    (api.post as jest.Mock).mockRejectedValue(new ApiError('That invitation cannot be used.', 400));
    renderSetup();
    fireEvent.changeText(inputs()[0], CODE);
    fireEvent.changeText(inputs()[1], 'my-own-password');
    await press(t('setup.confirm'));
    expect(screen.getByText(t('setup.unavailable'))).toBeTruthy();
    expect(screen.queryByText('That invitation cannot be used.')).toBeNull();
  });
});

describe('the test business strip', () => {
  const renderBanner = () =>
    render(
      <ThemeProvider>
        <TestBusinessBanner />
      </ThemeProvider>,
    );

  it('is in words for a test business, and absent for any other', () => {
    authState.user = { isTestBusiness: true };
    renderBanner();
    expect(screen.getByText(t('testBusiness.banner'))).toBeTruthy();
    screen.unmount();
    authState.user = { isTestBusiness: false };
    renderBanner();
    expect(screen.queryByText(t('testBusiness.banner'))).toBeNull();
    screen.unmount();
    authState.user = {};
    renderBanner();
    expect(screen.queryByText(t('testBusiness.banner'))).toBeNull();
  });
});
