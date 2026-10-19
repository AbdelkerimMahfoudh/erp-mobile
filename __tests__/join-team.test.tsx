/// <reference types="jest" />
/**
 * Joining a team (D213): the employee finishes, on their own phone, the account their business Owner created.
 *
 * For a WhatsApp number the server's consent copy is shown with an unticked box, and no code is asked for until the
 * employee ticks it — their own agreement, its version and the language shown sent with the request. An email address
 * needs no WhatsApp consent. The code and a first password finish it; the server's refusals are said in the app's
 * words. Nothing here calls an Owner's route, and nothing names a price, a payment or a website.
 */
import React from 'react';
import { TextInput } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import { t, useI18n } from '../lib/i18n';
import * as layoutDirection from '../lib/design/layout-direction';
import { replace as routerReplace } from './mocks/expo-router';
import { CONSENT_COPY, CONSENT_VERSION, consentCopyFor } from './mocks/whatsapp-consent';

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

import { api, ApiError } from '../lib/api-client';
import JoinScreen from '../app/(auth)/join';

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <JoinScreen />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

const typeContact = (value: string) => fireEvent.changeText(screen.UNSAFE_getAllByType(TextInput)[0], value);
const press = async (label: string) => {
  await act(async () => {
    fireEvent.press(screen.getByText(label));
  });
};

beforeEach(() => {
  (api.get as jest.Mock).mockReset();
  (api.post as jest.Mock).mockReset();
  routerReplace.mockClear();
  (api.get as jest.Mock).mockImplementation(async (path: string) => consentCopyFor(path) ?? {});
});

describe('a WhatsApp number', () => {
  it('shows the server’s consent with an unticked box; unticked, no code is asked for', async () => {
    renderScreen();
    typeContact('+222 33 44 55 66');
    const box = await screen.findByTestId('whatsapp-consent-check');
    expect(box.props.accessibilityState).toMatchObject({ checked: false });
    expect(screen.getByText(CONSENT_COPY.en.agreement)).toBeTruthy();
    await press(t('join.send'));
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.getByText(t('consent.problem.required'))).toBeTruthy();
  });

  it('ticked: the code request carries the consent’s version and language; then the code and a first password finish it', async () => {
    (api.post as jest.Mock).mockImplementation(async (path: string) =>
      path === '/staff/verify/confirm' ? { verified: true, accounts: [{ business: 'Boutique Aicha', name: 'Fatima', activated: true, pending: [] }] } : { accepted: true },
    );
    renderScreen();
    typeContact('+222 33 44 55 66');
    fireEvent.press(await screen.findByTestId('whatsapp-consent-check'));
    await press(t('join.send'));
    expect(api.post).toHaveBeenCalledWith('/staff/verify/resend', {
      destination: '+222 33 44 55 66',
      language: 'en',
      whatsappConsentVersion: CONSENT_VERSION,
      whatsappConsentLocale: 'en',
    });
    expect(screen.getByText(t('join.sent.phone'))).toBeTruthy();
    const [code, password] = screen.UNSAFE_getAllByType(TextInput);
    fireEvent.changeText(code, '123456');
    fireEvent.changeText(password, 'Secret-pass-1');
    await press(t('join.confirm'));
    expect(api.post).toHaveBeenLastCalledWith('/staff/verify/confirm', { destination: '+222 33 44 55 66', code: '123456', password: 'Secret-pass-1' });
    expect(screen.getByText(t('join.done.ready', { business: 'Boutique Aicha' }))).toBeTruthy();
    await press(t('join.signIn'));
    expect(routerReplace).toHaveBeenCalledWith('/(auth)/login');
    // Only the employee's own public routes: never an Owner's.
    for (const [path] of (api.post as jest.Mock).mock.calls) expect(path).toMatch(/^\/staff\/verify\//);
  });

  it('the server’s consent refusals are said in the app’s words; an updated copy unticks the box', async () => {
    (api.post as jest.Mock).mockRejectedValue(new ApiError('The WhatsApp consent shown is not the current one.', 400, 'whatsapp_consent_outdated'));
    renderScreen();
    typeContact('+22233445566');
    fireEvent.press(await screen.findByTestId('whatsapp-consent-check'));
    await press(t('join.send'));
    expect(await screen.findByText(t('consent.problem.outdated'))).toBeTruthy();
    expect(screen.getByTestId('whatsapp-consent-check').props.accessibilityState).toMatchObject({ checked: false });
  });

  it('a first-time confirmation without a password is asked for one; a wrong code is said as such', async () => {
    (api.post as jest.Mock)
      .mockResolvedValueOnce({ accepted: true })
      .mockRejectedValueOnce(new ApiError('Choose a password.', 400, 'password_required'))
      .mockRejectedValueOnce(new ApiError('That code did not match.', 400));
    renderScreen();
    typeContact('+22233445566');
    fireEvent.press(await screen.findByTestId('whatsapp-consent-check'));
    await press(t('join.send'));
    fireEvent.changeText(screen.UNSAFE_getAllByType(TextInput)[0], '123456');
    await press(t('join.confirm'));
    expect(screen.getByText(t('join.problem.password'))).toBeTruthy();
    await press(t('join.confirm'));
    expect(screen.getByText(t('join.problem.code'))).toBeTruthy();
  });
});

describe('an email address', () => {
  it('needs no WhatsApp consent: no box, and the code request carries none', async () => {
    (api.post as jest.Mock).mockResolvedValue({ accepted: true });
    renderScreen();
    typeContact('fatima@shop.test');
    expect(screen.queryByTestId('whatsapp-consent-check')).toBeNull();
    await press(t('join.send'));
    expect(api.post).toHaveBeenCalledWith('/staff/verify/resend', { destination: 'fatima@shop.test', language: 'en' });
    expect(screen.getByText(t('join.sent.email'))).toBeTruthy();
  });
});

describe('in Arabic', () => {
  it('the server’s Arabic copy and the app’s Arabic words, right to left', async () => {
    const rtl = jest.spyOn(layoutDirection, 'layoutIsRTL').mockReturnValue(true);
    await useI18n.getState().setLanguage('ar');
    try {
      renderScreen();
      typeContact('+22233445566');
      expect(await screen.findByText(CONSENT_COPY.ar.agreement)).toBeTruthy();
      expect(screen.getByText(t('join.subtitle'))).toBeTruthy();
      expect(api.get).toHaveBeenCalledWith('/messaging/whatsapp/consent?language=ar');
    } finally {
      rtl.mockRestore();
      await useI18n.getState().setLanguage('en');
    }
  });
});
