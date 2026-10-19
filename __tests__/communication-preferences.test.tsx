/// <reference types="jest" />
/**
 * Communication preferences: the operational WhatsApp consent on the account (the owner's brief of 2026-10-19; D213).
 *
 * An account from before D213 is never opted in: it is asked, the box starts unticked, and only ticking it and
 * agreeing records anything — the server's version and the language shown, as a new event. A withdrawal is explained
 * first; when WhatsApp is the only verified contact the person confirms they understood that recovery goes through
 * support, and the server is told so; nothing moves to email. The history keeps every event. The number is masked and
 * kept left-to-right in Arabic. There is one consent here — operational — and no marketing control anywhere.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import * as layoutDirection from '../lib/design/layout-direction';
import { t, useI18n } from '../lib/i18n';
import { useToastStore } from '../lib/toast';
import type { AccountView, WhatsAppConsentView } from '../types/api';
import { CONSENT_COPY, CONSENT_VERSION } from './mocks/whatsapp-consent';

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
import CommunicationScreen from '../app/account/communication';
import AccountScreen from '../app/account';

const MASKED = '+222••••8877';
const view = (over: Partial<WhatsAppConsentView> = {}, lang: 'en' | 'fr' | 'ar' = 'en'): WhatsAppConsentView => ({
  copy: CONSENT_COPY[lang],
  number: MASKED,
  state: 'none',
  grantedVersion: null,
  grantedAt: null,
  withdrawnAt: null,
  onlyVerifiedContact: true,
  history: [],
  ...over,
});
const GRANTED = {
  state: 'granted' as const,
  grantedVersion: CONSENT_VERSION,
  grantedAt: '2026-10-19T08:00:00.000Z',
  history: [{ event: 'granted', version: CONSENT_VERSION, locale: 'en', source: 'mobile_registration', at: '2026-10-19T08:00:00.000Z' }],
};

function serve(current: { now: WhatsAppConsentView }) {
  (api.get as jest.Mock).mockImplementation(async (path: string) => {
    if (path.startsWith('/account/whatsapp/consent')) return current.now;
    throw new Error(`unexpected read ${path}`);
  });
}

function renderScreen(node: React.ReactElement = <CommunicationScreen />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>{node}</QueryClientProvider>
    </ThemeProvider>,
  );
}

const toasts = () => useToastStore.getState().toasts.map((x) => `${x.tone}: ${x.message}`);

beforeEach(() => {
  (api.get as jest.Mock).mockReset();
  (api.post as jest.Mock).mockReset();
  useToastStore.getState().clear();
});

describe('an account without a consent', () => {
  it('is asked, with an unticked box; agreeing without ticking records nothing', async () => {
    serve({ now: view() });
    renderScreen();
    expect(await screen.findByText(t('consent.request.body'))).toBeTruthy();
    expect(screen.getByText(t('consent.state.none'))).toBeTruthy();
    const box = screen.getByTestId('whatsapp-consent-check');
    expect(box.props.accessibilityState).toMatchObject({ checked: false });
    await act(async () => {
      fireEvent.press(screen.getByText(t('consent.agree')));
    });
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.getByText(t('consent.problem.required'))).toBeTruthy();
  });

  it('ticked and agreed: the server’s version and the language shown are sent, and the screen says agreed', async () => {
    const current = { now: view() };
    serve(current);
    (api.post as jest.Mock).mockImplementation(async () => (current.now = view(GRANTED)));
    renderScreen();
    fireEvent.press(await screen.findByTestId('whatsapp-consent-check'));
    await act(async () => {
      fireEvent.press(screen.getByText(t('consent.agree')));
    });
    expect(api.post).toHaveBeenCalledWith('/account/whatsapp/consent?language=en', { version: CONSENT_VERSION, locale: 'en' });
    await waitFor(() => expect(toasts()).toEqual([`success: ${t('consent.agreed')}`]));
    expect(await screen.findByText(t('consent.state.granted'))).toBeTruthy();
    expect(screen.queryByTestId('whatsapp-consent-check')).toBeNull();
  });

  it('an outdated consent asks again, in its own words', async () => {
    serve({ now: view({ state: 'outdated', grantedVersion: 'wa-consent-2026-10-17' }) });
    renderScreen();
    expect(await screen.findByText(t('consent.request.outdated'))).toBeTruthy();
    expect(screen.getByTestId('whatsapp-consent-check').props.accessibilityState).toMatchObject({ checked: false });
  });
});

describe('withdrawing', () => {
  it('is explained first; with WhatsApp the only verified contact, the support-recovery acknowledgement is required and sent', async () => {
    const current = { now: view(GRANTED) };
    serve(current);
    (api.post as jest.Mock).mockImplementation(async () => (current.now = view({ state: 'withdrawn', withdrawnAt: '2026-10-19T09:00:00.000Z', grantedVersion: CONSENT_VERSION })));
    renderScreen();
    fireEvent.press(await screen.findByText(t('consent.withdraw')));
    expect(screen.getByText(t('consent.withdraw.explain'))).toBeTruthy();
    expect(screen.getByText(t('consent.withdraw.onlyContact'))).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByText(t('consent.withdraw.confirm')));
    });
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.getByText(t('consent.withdraw.needsAck'))).toBeTruthy();

    fireEvent.press(screen.getByText(t('consent.withdraw.acknowledge')));
    await act(async () => {
      fireEvent.press(screen.getByText(t('consent.withdraw.confirm')));
    });
    expect(api.post).toHaveBeenCalledWith('/account/whatsapp/consent/withdraw?language=en', { acknowledgeSupportRecovery: true });
    expect(await screen.findByText(t('consent.withdrawn.body'))).toBeTruthy();
    expect(screen.getByText(t('consent.state.withdrawn'))).toBeTruthy();
    // Re-consent is offered, unticked: a new agreement, never the old one restored.
    expect(screen.getByTestId('whatsapp-consent-check').props.accessibilityState).toMatchObject({ checked: false });
  });

  it('with a verified email, needs no acknowledgement and sends nothing else', async () => {
    const current = { now: view({ ...GRANTED, onlyVerifiedContact: false }) };
    serve(current);
    (api.post as jest.Mock).mockImplementation(async () => (current.now = view({ state: 'withdrawn', onlyVerifiedContact: false })));
    renderScreen();
    fireEvent.press(await screen.findByText(t('consent.withdraw')));
    expect(screen.queryByText(t('consent.withdraw.onlyContact'))).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByText(t('consent.withdraw.confirm')));
    });
    expect(api.post).toHaveBeenCalledWith('/account/whatsapp/consent/withdraw?language=en', {});
  });

  it('a refusal the server gives is said in the app’s words', async () => {
    serve({ now: view(GRANTED) });
    (api.post as jest.Mock).mockRejectedValue(new ApiError('WhatsApp is your only verified contact.', 409, 'withdrawal_needs_acknowledgement'));
    renderScreen();
    fireEvent.press(await screen.findByText(t('consent.withdraw')));
    fireEvent.press(screen.getByText(t('consent.withdraw.acknowledge')));
    await act(async () => {
      fireEvent.press(screen.getByText(t('consent.withdraw.confirm')));
    });
    expect(await screen.findByText(t('consent.withdraw.needsAck'))).toBeTruthy();
  });
});

describe('what the screen shows', () => {
  it('the history, newest first, with where each event was made — and the number masked', async () => {
    serve({
      now: view({
        ...GRANTED,
        history: [
          { event: 'granted', version: CONSENT_VERSION, locale: 'ar', source: 'account_settings', at: '2026-10-19T10:00:00.000Z' },
          { event: 'withdrawn', version: null, locale: null, source: 'inbound_keyword', at: '2026-10-19T09:00:00.000Z' },
          { event: 'granted', version: CONSENT_VERSION, locale: 'en', source: 'mobile_registration', at: '2026-10-19T08:00:00.000Z' },
        ],
      }),
    });
    renderScreen();
    expect(await screen.findByText(t('consent.history'))).toBeTruthy();
    const lines = screen.getAllByText(/ · /).map((n) => String(n.props.children));
    expect(lines.some((l) => l.startsWith(t('consent.event.granted')) && l.endsWith(t('consent.source.account')))).toBe(true);
    expect(lines.some((l) => l.startsWith(t('consent.event.withdrawn')) && l.endsWith(t('consent.source.inbound_keyword')))).toBe(true);
    expect(lines.some((l) => l.endsWith(t('consent.source.registration')))).toBe(true);
    expect(screen.getByText(new RegExp(MASKED.replace(/[+]/g, '\\+')))).toBeTruthy();
  });

  it('one consent, operational — no marketing control, and it says so', async () => {
    serve({ now: view() });
    renderScreen();
    expect(await screen.findByText(t('consent.notMarketing'))).toBeTruthy();
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
  });

  it('in Arabic: the server’s Arabic copy, the app’s Arabic words, the masked number kept left-to-right', async () => {
    // The layout the app restarts into for Arabic (D-direction): right to left.
    const rtl = jest.spyOn(layoutDirection, 'layoutIsRTL').mockReturnValue(true);
    await useI18n.getState().setLanguage('ar');
    try {
      serve({ now: view(GRANTED, 'ar') });
      renderScreen();
      expect(await screen.findByText(CONSENT_COPY.ar.agreement)).toBeTruthy();
      expect(screen.getByText(t('consent.state.granted'))).toBeTruthy();
      expect(screen.getByText(`⁦${MASKED}⁩`)).toBeTruthy();
      expect(api.get).toHaveBeenCalledWith('/account/whatsapp/consent?language=ar');
    } finally {
      rtl.mockRestore();
      await useI18n.getState().setLanguage('en');
    }
  });

  it('in French: the French copy and words', async () => {
    await useI18n.getState().setLanguage('fr');
    try {
      serve({ now: view({}, 'fr') });
      renderScreen();
      expect(await screen.findByText(CONSENT_COPY.fr.agreement)).toBeTruthy();
      expect(screen.getByText(t('consent.request.body'))).toBeTruthy();
    } finally {
      await useI18n.getState().setLanguage('en');
    }
  });
});

describe('Your account', () => {
  const me: AccountView = {
    id: 'u1', name: 'Aicha', login: 'aicha', personalId: 'P-1', phone: '+22249998877', phoneVerifiedAt: '2026-10-01T09:00:00.000Z',
    email: null, emailVerifiedAt: null, whatsappVerified: true, deletionKind: 'company_closure', deletion: null,
  };

  function serveAccount(consent: WhatsAppConsentView) {
    (api.get as jest.Mock).mockImplementation(async (path: string) => {
      if (path === '/account') return me;
      if (path.startsWith('/account/whatsapp/consent')) return consent;
      throw new Error(`unexpected read ${path}`);
    });
  }

  it('asks an account without a consent for it — beside everything else, which stays usable', async () => {
    serveAccount(view());
    renderScreen(<AccountScreen />);
    expect(await screen.findByText(t('account.consent.request'))).toBeTruthy();
    expect(screen.getByText(t('consent.title'))).toBeTruthy();
    expect(screen.getAllByText(t('account.delete.row')).length).toBeGreaterThan(0);
    expect(screen.getByText(t('account.whatsapp.change'))).toBeTruthy();
  });

  it('says nothing more once the consent is given', async () => {
    serveAccount(view(GRANTED));
    renderScreen(<AccountScreen />);
    expect(await screen.findByText(t('consent.state.granted'))).toBeTruthy();
    expect(screen.queryByText(t('account.consent.request'))).toBeNull();
  });
});
