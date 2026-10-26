/// <reference types="jest" />
/**
 * Joining a team from an invitation (D213, D214): the employee activates the account their business Owner created.
 *
 * Creating the account sent them nothing. They type the invitation reference — the app's link only fills it in, and
 * nothing is requested until they press Continue. The invitation shows whose it is and the number's last two digits;
 * they type the whole number, see the server's consent copy with an unticked box, and no code is asked for until they
 * tick it — their own agreement, its version and the language shown sent with the request. The code and a first
 * password finish it. Every unusable reference reads the same; nothing here calls an Owner's route.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import { t, useI18n } from '../lib/i18n';
import * as layoutDirection from '../lib/design/layout-direction';
import * as router from './mocks/expo-router';
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
import { textInputs } from './tree';

const REF = 'K7QM-9XRT-2CHD';
const OPENED = { business: 'Boutique Aicha', name: 'Fatima', numberEnding: '66', expiresAt: '2026-10-22T08:00:00.000Z' };

async function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <JoinScreen />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

const inputs = () => textInputs();
const press = async (label: string) => {
  await act(async () => {
    await fireEvent.press(screen.getByText(label));
  });
};

/** The server: the invitation opens, the code request is accepted, the confirmation answers as given. */
function server(confirm: unknown = { verified: true, business: 'Boutique Aicha', name: 'Fatima', activated: true, pending: [] }) {
  (api.post as jest.Mock).mockImplementation(async (path: string) => {
    if (path === '/staff/join/open') return OPENED;
    if (path === '/staff/join/confirm') return confirm;
    return { accepted: true };
  });
}

/** Reference typed, the invitation opened, the number typed. */
async function openAndType(number = '+222 33 44 55 66') {
  await renderScreen();
  await fireEvent.changeText(inputs()[0], REF);
  await press(t('join.continue'));
  await fireEvent.changeText(inputs()[0], number);
}

beforeEach(() => {
  (api.get as jest.Mock).mockReset();
  (api.post as jest.Mock).mockReset();
  router.replace.mockClear();
  (api.get as jest.Mock).mockImplementation(async (path: string) => consentCopyFor(path) ?? {});
});

afterEach(() => jest.restoreAllMocks());

describe('the reference', () => {
  it('the app’s link only fills it in: nothing is opened, accepted or sent until the person presses Continue', async () => {
    jest.spyOn(router, 'useLocalSearchParams').mockReturnValue({ ref: 'k7qm 9xrt 2chd' });
    await renderScreen();
    expect(inputs()[0].props.value).toBe(REF);
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.queryByTestId('whatsapp-consent-check')).toBeNull();
  });

  it('what cannot be a reference is said so, and nothing is requested', async () => {
    await renderScreen();
    await fireEvent.changeText(inputs()[0], 'K7QM-9XRT');
    await press(t('join.continue'));
    expect(screen.getByText(t('join.problem.reference'))).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('an unusable invitation — unknown, expired, replaced or used — reads the one way', async () => {
    (api.post as jest.Mock).mockRejectedValue(new ApiError('This invitation cannot be used.', 400, 'invitation_unavailable'));
    await renderScreen();
    await fireEvent.changeText(inputs()[0], REF);
    await press(t('join.continue'));
    expect(api.post).toHaveBeenCalledWith('/staff/join/open', { reference: REF });
    expect(screen.getByText(t('join.unavailable'))).toBeTruthy();
  });
});

describe('the consent and the code', () => {
  it('opened: whose invitation it is and the number’s last two digits, the server’s consent unticked — and no code until it is ticked', async () => {
    server();
    await openAndType();
    expect(screen.getByText(t('join.hello', { name: 'Fatima', business: 'Boutique Aicha' }))).toBeTruthy();
    expect(screen.getByText(t('join.field.number.hint', { ending: '66' }))).toBeTruthy();
    const box = await screen.findByTestId('whatsapp-consent-check');
    expect(box.props.accessibilityState).toMatchObject({ checked: false });
    expect(screen.getByText(CONSENT_COPY.en.agreement)).toBeTruthy();
    await press(t('join.send'));
    expect((api.post as jest.Mock).mock.calls.map(([path]) => path)).toEqual(['/staff/join/open']);
    expect(screen.getByText(t('consent.problem.required'))).toBeTruthy();
  });

  it('ticked: the request carries the reference, the typed number, the consent’s version and language; the code and a first password finish it', async () => {
    server();
    await openAndType();
    await fireEvent.press(await screen.findByTestId('whatsapp-consent-check'));
    await press(t('join.send'));
    expect(api.post).toHaveBeenLastCalledWith('/staff/join/request-code', {
      reference: REF,
      number: '+22233445566',
      language: 'en',
      whatsappConsentVersion: CONSENT_VERSION,
      whatsappConsentLocale: 'en',
    });
    expect(screen.getByText(t('join.sent'))).toBeTruthy();
    const [code, password] = inputs();
    await fireEvent.changeText(code, '123456');
    await fireEvent.changeText(password, 'Secret-pass-1');
    await press(t('join.confirm'));
    expect(api.post).toHaveBeenLastCalledWith('/staff/join/confirm', { reference: REF, code: '123456', password: 'Secret-pass-1' });
    expect(screen.getByText(t('join.done.ready', { business: 'Boutique Aicha' }))).toBeTruthy();
    await press(t('join.signIn'));
    expect(router.replace).toHaveBeenCalledWith('/(auth)/login');
    // Only the employee's own public routes: never an Owner's.
    for (const [path] of (api.post as jest.Mock).mock.calls) expect(path).toMatch(/^\/staff\/join\//);
  });

  it('another number than the Owner entered is said so; nothing moves on', async () => {
    server();
    (api.post as jest.Mock).mockImplementation(async (path: string) => {
      if (path === '/staff/join/open') return OPENED;
      throw new ApiError('That is not the WhatsApp number your business Owner entered.', 400, 'number_mismatch');
    });
    await openAndType('+22299999999');
    await fireEvent.press(await screen.findByTestId('whatsapp-consent-check'));
    await press(t('join.send'));
    expect(screen.getByText(t('join.problem.number'))).toBeTruthy();
    expect(screen.queryByText(t('join.sent'))).toBeNull();
  });

  it('an agreement that expired before the code was confirmed: back to the consent, unticked, said why', async () => {
    server();
    await openAndType();
    await fireEvent.press(await screen.findByTestId('whatsapp-consent-check'));
    await press(t('join.send'));
    (api.post as jest.Mock).mockRejectedValueOnce(new ApiError('Your agreement expired.', 400, 'consent_expired'));
    const [code, password] = inputs();
    await fireEvent.changeText(code, '123456');
    await fireEvent.changeText(password, 'Secret-pass-1');
    await press(t('join.confirm'));
    expect(screen.getByText(t('join.problem.consentExpired'))).toBeTruthy();
    expect(screen.getByTestId('whatsapp-consent-check').props.accessibilityState).toMatchObject({ checked: false });
  });

  it('no seat yet: the number is confirmed and the account waits for the business owner', async () => {
    server({ verified: true, business: 'Boutique Aicha', name: 'Fatima', activated: false, pending: ['seat_payment'] });
    await openAndType();
    await fireEvent.press(await screen.findByTestId('whatsapp-consent-check'));
    await press(t('join.send'));
    const [code, password] = inputs();
    await fireEvent.changeText(code, '123456');
    await fireEvent.changeText(password, 'Secret-pass-1');
    await press(t('join.confirm'));
    expect(screen.getByText(t('join.done.waiting', { business: 'Boutique Aicha' }))).toBeTruthy();
  });
});

describe('in Arabic', () => {
  it('the server’s Arabic copy and the app’s Arabic words, right to left', async () => {
    const rtl = jest.spyOn(layoutDirection, 'layoutIsRTL').mockReturnValue(true);
    await useI18n.getState().setLanguage('ar');
    try {
      server();
      await openAndType();
      expect(await screen.findByText(CONSENT_COPY.ar.agreement)).toBeTruthy();
      expect(screen.getByText(t('join.hello', { name: 'Fatima', business: 'Boutique Aicha' }))).toBeTruthy();
      expect(api.get).toHaveBeenCalledWith('/messaging/whatsapp/consent?language=ar');
    } finally {
      rtl.mockRestore();
      await useI18n.getState().setLanguage('en');
    }
  });
});
