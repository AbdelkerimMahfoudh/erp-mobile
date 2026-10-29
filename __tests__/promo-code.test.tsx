/// <reference types="jest" />
/**
 * Where a new business came from (0103, D221), as the registration screen renders it: an optional promo code in six
 * boxes, left to right whatever the language, checked on the app's own `auth/acquisition/code` at six digits and
 * removable; the registration address a person arrives with, read once and taken out of the route — a promoter's card
 * prefills its code and name, an invitation says so; at most one source sent with the one registration, none when the
 * person sends none; and a source refused at the end sends them back to it, with nothing saved.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import { useConnectivity } from '../lib/connectivity';
import { t } from '../lib/i18n';
import { push as routerPush, replace as routerReplace, setParams as routerSetParams } from './mocks/expo-router';

// `jest.mock` is hoisted above these imports; the factories read the `mock…` store only when called.
const mockStore = new Map<string, string>();
// The route's parameters: a registration address arrives as `r` (0103).
let mockParams: Record<string, string | undefined> = {};

// Signed out on a screen of the (auth) group, where the sign-in guard leaves a person alone. A screen that is shown
// runs its focus effect, as the navigator does.
jest.mock('expo-router', () => ({
  ...jest.requireActual('./mocks/expo-router'),
  useSegments: () => ['(auth)'],
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (effect: () => void) => jest.requireActual('react').useEffect(effect, [effect]),
}));
// No navigator here: the guard on leaving is recorded, so a test can take the step back the header arrow would.
const mockPrevent: { enabled: boolean; leave: ((e: { data: { action: unknown } }) => void) | null } = { enabled: false, leave: null };
jest.mock('../lib/navigation/router-internals', () => ({
  HeaderShownContext: jest.requireActual('react').createContext(false),
  usePreventRemove: (enabled: boolean, leave: (e: { data: { action: unknown } }) => void) => {
    mockPrevent.enabled = enabled;
    mockPrevent.leave = leave;
  },
}));
jest.mock('../lib/storage', () => ({
  getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItem: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  deleteItem: jest.fn(async (k: string) => void mockStore.delete(k)),
}));
jest.mock('../lib/offline/queue-store', () => ({ readQueue: () => ({ items: [], quarantined: false }), writeQueue: jest.fn() }));
jest.mock('../lib/report-export', () => ({ clearExports: jest.fn() }));
jest.mock('../lib/device', () => ({
  clearCredential: jest.fn(async () => undefined),
  clearLegacyCredential: jest.fn(async () => undefined),
  deviceMeta: () => ({ label: 'test', platform: 'ios', appVersion: '0' }),
  loadCredential: jest.fn(async () => null),
  migrateLegacyCredential: jest.fn(async () => false),
  rememberStoreId: jest.fn(async () => undefined),
  saveCredential: jest.fn(async () => undefined),
}));
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
    clearSession: jest.fn(async () => undefined),
  };
});

import { api, ApiError } from '../lib/api-client';
import { AuthProvider } from '../hooks/useAuth';
import RegisterScreen from '../app/(auth)/register';
import { CONSENT_COPY, CONSENT_VERSION, consentCopyFor } from './mocks/whatsapp-consent';
import { textInputs } from './tree';

const CONTINUATION = 'continuation-0123456789abcdef';
const OWNER = { id: 'u-new', companyId: 'c-new', name: 'Aicha', login: 'aicha', publicStoreId: 'S-NEW' };

/** Nothing on these screens names a trial, a price, a payment or a website — in words a person reads. */
const UNSAID = /trial|essai|تجريب|price|\bpay|paiement|MRU|website|\bsite\b|موقع|https?:|www\./i;

function renderWith(node: React.ReactElement, client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })) {
  render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <AuthProvider>{node}</AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
  return client;
}

/**
 * Every string on screen, joined: what a person could read — but the server's consent copy, which names what the
 * operational messages are about (the account's status among them) and is the approved text of the agreement itself.
 */
function screenText(): string {
  const texts: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === 'string') texts.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') walk((node as { children?: unknown }).children ?? []);
  };
  walk(screen.toJSON());
  const copies = Object.values(CONSENT_COPY).flatMap((c) => [c.agreement, c.body]);
  return texts.filter((text) => !copies.includes(text)).join(' ');
}

/** The first two steps as a person fills them — the business, then the Owner — to the last one. Nothing is sent. */
function toLastStep() {
  const [business, branch] = textInputs();
  fireEvent.changeText(business, 'Nour Electronics');
  fireEvent.changeText(branch, 'Main Store');
  fireEvent.press(screen.getByText(t('register.next')));
  fireEvent.changeText(textInputs()[0], 'Aicha');
  fireEvent.press(screen.getByText(t('register.next')));
}

/** The last step: the WhatsApp number (required) first among the contacts, no email address, the password twice. */
function fillLastStep() {
  const [phone, , password, again] = textInputs();
  fireEvent.changeText(phone, '+22236000001');
  fireEvent.changeText(password, 'correct horse');
  fireEvent.changeText(again, 'correct horse');
}

/** The whole form, step by step. */
function fillFields() {
  toLastStep();
  fillLastStep();
}

/** …and ticks the WhatsApp consent beside the number, once the server's copy is shown. */
async function fillForm() {
  fillFields();
  fireEvent.press(await screen.findByTestId('whatsapp-consent-check'));
}

beforeEach(() => {
  mockStore.clear();
  routerPush.mockClear();
  routerReplace.mockClear();
  // Offline: nothing queued is sent; these tests are about the registration requests alone.
  useConnectivity.setState({ online: false });
  (api.get as jest.Mock).mockReset();
  (api.post as jest.Mock).mockReset();
  (api.get as jest.Mock).mockImplementation(async (path: string) => {
    if (path.startsWith('/auth/me')) return OWNER;
    if (path.startsWith('/entitlement')) return { state: 'trial_available', canRead: false, canWrite: false, status: 'pending_activation', isComplimentary: false, calculatedAt: '2026-10-13T09:00:00.000Z' };
    if (consentCopyFor(path)) return consentCopyFor(path);
    return {};
  });
});


const REGISTERED = {
  status: 'pending_activation', created: true, publicStoreId: 'S-NEW',
  verification: { destination: '+222••••0001', channel: 'phone' },
  continuation: { token: CONTINUATION, expiresAt: '2026-10-13T09:15:00.000Z', expiresInSeconds: 900 },
  next: 'verify_contact',
};

const box = (n: number) => screen.getByTestId(`promo-digit-${n}`);
const registerCalls = () => (api.post as jest.Mock).mock.calls.filter(([path]) => path === '/auth/register');

function answer(routes: Record<string, unknown>) {
  (api.post as jest.Mock).mockImplementation(async (path: string) => {
    if (path in routes) {
      const r = routes[path];
      if (r instanceof Error) throw r;
      return r;
    }
    return REGISTERED;
  });
}

beforeEach(() => {
  mockParams = {};
  (routerSetParams as jest.Mock).mockClear?.();
});

describe('the promo code', () => {
  it('six boxes on the first step, read left to right even in Arabic, each named for a screen reader', async () => {
    renderWith(<RegisterScreen />);
    expect(await screen.findByText(t('register.promo.label'))).toBeTruthy();
    for (let i = 1; i <= 6; i++) expect(box(i).props.accessibilityLabel).toBe(t('register.promo.digit', { n: i }));
    expect(box(1).props.keyboardType).toBe('number-pad');
  });

  it('a pasted code in Arabic digits fills the boxes, keeps its leading zeroes and is checked once, at six digits', async () => {
    answer({ '/auth/acquisition/code': { usable: true, source: 'promoter', promoterName: 'Sidi Mohamed', code: '004217' } });
    renderWith(<RegisterScreen />);
    await act(async () => {
      fireEvent.changeText(box(1), '٠٠٤٢١٧');
    });
    expect(await screen.findByText(t('register.promo.from', { name: 'Sidi Mohamed' }))).toBeTruthy();
    expect(box(1).props.value).toBe('0');
    expect(box(6).props.value).toBe('7');
    const asks = (api.post as jest.Mock).mock.calls.filter(([path]) => path === '/auth/acquisition/code');
    expect(asks).toEqual([['/auth/acquisition/code', { code: '004217' }]]);
  });

  it('typing moves on; five digits are never checked; Backspace takes the last one back', async () => {
    answer({});
    renderWith(<RegisterScreen />);
    for (const [i, d] of ['1', '2', '3', '4', '5'].entries()) fireEvent.changeText(box(i + 1), d);
    expect(box(5).props.value).toBe('5');
    expect((api.post as jest.Mock).mock.calls).toEqual([]);
    fireEvent(box(6), 'keyPress', { nativeEvent: { key: 'Backspace' } });
    expect(box(5).props.value).toBe('');
  });

  it('an unavailable code says so in one sentence, and can be removed', async () => {
    answer({ '/auth/acquisition/code': { usable: false } });
    renderWith(<RegisterScreen />);
    await act(async () => {
      fireEvent.changeText(box(1), '999999');
    });
    expect(await screen.findByText(t('register.promo.unavailable'))).toBeTruthy();
    fireEvent.press(screen.getByText(t('register.promo.remove')));
    expect(box(1).props.value).toBe('');
    expect(screen.queryByText(t('register.promo.unavailable'))).toBeNull();
  });

  it('a usable code goes with the registration; without one the registration is the one it always was', async () => {
    answer({ '/auth/acquisition/code': { usable: true, source: 'promoter', promoterName: 'Sidi Mohamed', code: '004217' } });
    renderWith(<RegisterScreen />);
    await act(async () => {
      fireEvent.changeText(box(1), '004217');
    });
    await screen.findByText(t('register.promo.from', { name: 'Sidi Mohamed' }));
    await fillForm();
    await act(async () => {
      fireEvent.press(screen.getByText(t('register.submit')));
    });
    expect(registerCalls()).toHaveLength(1);
    expect(registerCalls()[0][1]).toEqual(expect.objectContaining({ promoCode: '004217' }));
    expect(registerCalls()[0][1]).not.toHaveProperty('referralToken');
  });

  it('with no code, nothing about a source is sent', async () => {
    answer({});
    renderWith(<RegisterScreen />);
    await fillForm();
    await act(async () => {
      fireEvent.press(screen.getByText(t('register.submit')));
    });
    expect(registerCalls()[0][1]).not.toHaveProperty('promoCode');
    expect(registerCalls()[0][1]).not.toHaveProperty('referralToken');
  });

  it('a source refused at the end sends the person back to it: nothing was saved, and the words say so', async () => {
    answer({
      '/auth/acquisition/code': { usable: true, source: 'promoter', promoterName: 'Sidi Mohamed', code: '004217' },
      '/auth/register': new ApiError('This promo code is unavailable.', 409, 'acquisition_unavailable'),
    });
    renderWith(<RegisterScreen />);
    await act(async () => {
      fireEvent.changeText(box(1), '004217');
    });
    await screen.findByText(t('register.promo.from', { name: 'Sidi Mohamed' }));
    await fillForm();
    await act(async () => {
      fireEvent.press(screen.getByText(t('register.submit')));
    });
    expect(await screen.findByText(t('register.promo.unavailableNow'))).toBeTruthy();
    expect(screen.getByText(t('register.promo.unavailable'))).toBeTruthy();
    expect(routerReplace).not.toHaveBeenCalled();
  });
});

describe('arriving with a registration address', () => {
  it('a promoter’s card prefills its code and name, is taken out of the route, and goes as the card’s own source', async () => {
    mockParams = { r: 'QR-TOKEN' };
    answer({ '/auth/acquisition/link': { usable: true, source: 'promoter', promoterName: 'Sidi Mohamed', code: '004217' } });
    renderWith(<RegisterScreen />);
    expect(await screen.findByText(t('register.promo.from', { name: 'Sidi Mohamed' }))).toBeTruthy();
    expect(box(1).props.value).toBe('0');
    expect(routerSetParams).toHaveBeenCalledWith({ r: undefined });
    expect((api.post as jest.Mock).mock.calls.filter(([p]) => p === '/auth/acquisition/code')).toEqual([]);
    await fillForm();
    await act(async () => {
      fireEvent.press(screen.getByText(t('register.submit')));
    });
    expect(registerCalls()[0][1]).toEqual(expect.objectContaining({ referralToken: 'QR-TOKEN' }));
    expect(registerCalls()[0][1]).not.toHaveProperty('promoCode');
  });

  it('an invitation says so, can be left out, and is never sent with a code: the person chooses', async () => {
    mockParams = { r: 'INVITE-TOKEN' };
    answer({
      '/auth/acquisition/link': { usable: true, source: 'user_invite' },
      '/auth/acquisition/code': { usable: true, source: 'promoter', promoterName: 'Sidi Mohamed', code: '004217' },
    });
    renderWith(<RegisterScreen />);
    expect(await screen.findByText(t('register.promo.invited'))).toBeTruthy();
    await act(async () => {
      fireEvent.changeText(box(1), '004217');
    });
    expect(await screen.findByText(t('register.promo.choose.title'))).toBeTruthy();
    fireEvent.press(screen.getByText(t('register.promo.choose.code')));
    expect(screen.queryByText(t('register.promo.invited'))).toBeNull();
    await fillForm();
    await act(async () => {
      fireEvent.press(screen.getByText(t('register.submit')));
    });
    expect(registerCalls()[0][1]).toEqual(expect.objectContaining({ promoCode: '004217' }));
    expect(registerCalls()[0][1]).not.toHaveProperty('referralToken');
  });

  it('an address no longer valid gives a short notice and the ordinary registration', async () => {
    mockParams = { r: 'OLD-TOKEN' };
    answer({ '/auth/acquisition/link': { usable: false } });
    renderWith(<RegisterScreen />);
    expect(await screen.findByText(t('register.promo.addressInvalid'))).toBeTruthy();
    await fillForm();
    await act(async () => {
      fireEvent.press(screen.getByText(t('register.submit')));
    });
    expect(registerCalls()[0][1]).not.toHaveProperty('referralToken');
  });
});
