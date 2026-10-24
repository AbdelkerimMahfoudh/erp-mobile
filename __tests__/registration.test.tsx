/// <reference types="jest" />
/**
 * Creating a business account, on the phone (restored 2026-10-13), as the
 * screens render it: the form posts to the app's own `auth/register` and never
 * to a platform route; a server that cannot send the code is answered with the
 * honest words, in the person's language, and nothing moves on; the code check
 * finishes on `auth/register/verify/*`, adopts the ordinary session it returns
 * — starting clean, with nothing left by whoever used this phone before — and
 * lands on the closed screen. Nothing on either screen names a trial, a price,
 * a payment or a website. The continuation is kept for the code check only:
 * sign-in and sign-up forget one left by a registration that was not finished.
 *
 * The real AuthProvider; the server, storage and the device are mocked.
 */
import React from 'react';
import { TextInput } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import { ThemeToggle } from '../components/ui/ThemeToggle';
import { useBranch } from '../lib/branch';
import { useConnectivity } from '../lib/connectivity';
import { getLanguage, t, useI18n } from '../lib/i18n';
import { RequestTimeout } from '../lib/offline/classify';
import { useQueue } from '../lib/offline/queue';
import { push as routerPush, replace as routerReplace } from './mocks/expo-router';

// `jest.mock` is hoisted above these imports; the factories read the `mock…` store only when called.
const mockStore = new Map<string, string>();

// Signed out on a screen of the (auth) group, where the sign-in guard leaves a person alone. A screen that is shown
// runs its focus effect, as the navigator does.
jest.mock('expo-router', () => ({
  ...jest.requireActual('./mocks/expo-router'),
  useSegments: () => ['(auth)'],
  useLocalSearchParams: () => ({ destination: 'a•••@example.com' }),
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
import LoginScreen from '../app/(auth)/login';
import RegisterScreen from '../app/(auth)/register';
import VerifyScreen from '../app/(auth)/verify';
import { CONSENT_COPY, CONSENT_VERSION, consentCopyFor } from './mocks/whatsapp-consent';

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
  const [business, branch] = screen.UNSAFE_getAllByType(TextInput);
  fireEvent.changeText(business, 'Nour Electronics');
  fireEvent.changeText(branch, 'Main Store');
  fireEvent.press(screen.getByText(t('register.next')));
  fireEvent.changeText(screen.UNSAFE_getAllByType(TextInput)[0], 'Aicha');
  fireEvent.press(screen.getByText(t('register.next')));
}

/** The last step: the WhatsApp number (required) first among the contacts, no email address, the password twice. */
function fillLastStep() {
  const [phone, , password, again] = screen.UNSAFE_getAllByType(TextInput);
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

describe('the sign-in screen', () => {
  it('offers Create a business account, a screen of this app, and says who creates an employee’s account', async () => {
    renderWith(<LoginScreen />);
    fireEvent.press(await screen.findByText(t('auth.action.createAccount')));
    expect(routerPush).toHaveBeenCalledWith('/(auth)/register');
    expect(screen.getByText(t('auth.accounts.managed'))).toBeTruthy();
    expect(t('auth.accounts.managed')).toBe('Employee accounts are set up by your business owner.');
  });

  it('forgets a registration left unfinished: whoever is at sign-in is not in the middle of a code check', async () => {
    mockStore.set('erp.registration.continuation', CONTINUATION);
    renderWith(<LoginScreen />);
    await waitFor(() => expect(mockStore.has('erp.registration.continuation')).toBe(false));
  });
});

describe('the form', () => {
  it('starts clean: a continuation left by an unfinished registration is forgotten', async () => {
    mockStore.set('erp.registration.continuation', 'continuation-left-behind');
    renderWith(<RegisterScreen />);
    await waitFor(() => expect(mockStore.has('erp.registration.continuation')).toBe(false));
  });

  it('posts to auth/register only, with no identifier the server generates, then goes to the code check', async () => {
    (api.post as jest.Mock).mockResolvedValue({
      status: 'pending_activation', created: true, publicStoreId: 'S-NEW',
      verification: { destination: '+222••••0001', channel: 'phone' },
      continuation: { token: CONTINUATION, expiresAt: '2026-10-13T09:15:00.000Z', expiresInSeconds: 900 },
      next: 'verify_contact',
    });
    renderWith(<RegisterScreen />);
    await fillForm();
    await act(async () => {
      fireEvent.press(screen.getByText(t('register.submit')));
    });

    expect(api.post).toHaveBeenCalledTimes(1);
    const [path, body] = (api.post as jest.Mock).mock.calls[0];
    expect(path).toBe('/auth/register');
    expect(body).toEqual(expect.objectContaining({ ownerName: 'Aicha', businessName: 'Nour Electronics', branchName: 'Main Store', phone: '+22236000001', language: 'en' }));
    // The consent ticked: the server's version, and the language it was shown in.
    expect(body).toEqual(expect.objectContaining({ whatsappConsentVersion: CONSENT_VERSION, whatsappConsentLocale: 'en' }));
    // No email address given: none is sent, not even an empty one.
    expect(body).not.toHaveProperty('email');
    for (const id of ['storeId', 'companyId', 'branchId', 'userId', 'roleId']) expect(body).not.toHaveProperty(id);
    // The continuation is kept in secure storage; the code check is next, with where the code went.
    expect(mockStore.get('erp.registration.continuation')).toBe(CONTINUATION);
    expect(routerReplace).toHaveBeenCalledWith({ pathname: '/(auth)/verify', params: { destination: '+222••••0001' } });
    expect(screenText()).not.toMatch(UNSAID);
  });

  it('a retry after a lost answer keeps its key; corrected after the failure, it is a new attempt with a new key', async () => {
    (api.post as jest.Mock)
      .mockRejectedValueOnce(new RequestTimeout())
      .mockRejectedValueOnce(new RequestTimeout())
      .mockResolvedValueOnce({
        status: 'pending_activation', created: true, publicStoreId: 'S-NEW',
        verification: { destination: '+222••••0002', channel: 'phone' },
        continuation: { token: CONTINUATION, expiresAt: '2026-10-13T09:15:00.000Z', expiresInSeconds: 900 },
        next: 'verify_contact',
      });
    renderWith(<RegisterScreen />);
    await fillForm();
    // The answer is lost, and the person taps again with nothing changed: the same attempt.
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        fireEvent.press(screen.getByText(t('register.submit')));
      });
    }
    // Then they notice the number was wrong and correct it: a new attempt.
    fireEvent.changeText(screen.UNSAFE_getAllByType(TextInput)[0], '+22236000002');
    await act(async () => {
      fireEvent.press(screen.getByText(t('register.submit')));
    });

    const [first, retry, corrected] = (api.post as jest.Mock).mock.calls.map(([, body]) => body);
    expect(retry.idempotencyKey).toBe(first.idempotencyKey);
    expect(corrected.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(corrected.phone).toBe('+22236000002');
    // The code check follows the corrected registration, not the first one.
    expect(routerReplace).toHaveBeenLastCalledWith({ pathname: '/(auth)/verify', params: { destination: '+222••••0002' } });
  });

  it('a server that cannot send the code: account creation is not available right now, nothing was saved — and nothing moves on', async () => {
    (api.post as jest.Mock).mockRejectedValue(
      new ApiError('Registration cannot be completed right now: no verification code can be sent. Nothing was saved.', 503, 'registration_unavailable'),
    );
    renderWith(<RegisterScreen />);
    await fillForm();
    await act(async () => {
      fireEvent.press(screen.getByText(t('register.submit')));
    });

    expect(await screen.findByText(t('register.unavailable'))).toBeTruthy();
    expect(t('register.unavailable')).toBe('Account creation is not available right now. Nothing was saved. Please try again later.');
    expect(routerReplace).not.toHaveBeenCalled();
    expect(mockStore.has('erp.registration.continuation')).toBe(false);
  });

  it('without the WhatsApp number nothing is sent: the number is required, said beside it — an email address alone is not enough', async () => {
    renderWith(<RegisterScreen />);
    await fillForm();
    const inputs = screen.UNSAFE_getAllByType(TextInput);
    fireEvent.changeText(inputs[0], '');
    fireEvent.changeText(inputs[1], 'aicha@example.invalid');
    await act(async () => {
      fireEvent.press(screen.getByText(t('register.submit')));
    });

    expect(await screen.findByText(t('register.problem.phoneRequired'))).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
    expect(routerReplace).not.toHaveBeenCalled();
  });
});

describe('three steps, one submission (owner’s review, 2026-10-24)', () => {
  const value = (i: number) => screen.UNSAFE_getAllByType(TextInput)[i].props.value;

  it('says which step of three, and checks only that step’s fields before moving on — nothing is sent', async () => {
    renderWith(<RegisterScreen />);
    expect(screen.getByText(t('register.step', { current: 1, total: 3 }))).toBeTruthy();
    fireEvent.press(screen.getByText(t('register.next')));
    expect(screen.getByText(t('register.problem.businessName'))).toBeTruthy();
    expect(screen.getByText(t('register.problem.branchName'))).toBeTruthy();
    // Still the business step: no Owner field yet, and nothing about a password not yet asked for.
    expect(screen.queryByText(t('register.field.ownerName'))).toBeNull();
    expect(screen.queryByText(t('register.problem.password'))).toBeNull();
    // Typing into a refused field is never blocked: the correction is taken and its message cleared.
    fireEvent.changeText(screen.UNSAFE_getAllByType(TextInput)[0], 'Nour Electronics');
    expect(value(0)).toBe('Nour Electronics');
    expect(screen.queryByText(t('register.problem.businessName'))).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('keeps every value going back and forward, by its own button or by the way back', async () => {
    renderWith(<RegisterScreen />);
    const [business, branch, city] = screen.UNSAFE_getAllByType(TextInput);
    fireEvent.changeText(business, 'Nour Electronics');
    fireEvent.changeText(branch, 'Main Store');
    fireEvent.changeText(city, 'Rosso');
    fireEvent.press(screen.getByText(t('register.next')));
    expect(screen.getByText(t('register.step', { current: 2, total: 3 }))).toBeTruthy();
    fireEvent.changeText(screen.UNSAFE_getAllByType(TextInput)[0], 'Aicha');

    fireEvent.press(screen.getByText(t('register.previous')));
    expect([value(0), value(1), value(2)]).toEqual(['Nour Electronics', 'Main Store', 'Rosso']);
    fireEvent.press(screen.getByText(t('register.next')));
    expect(value(0)).toBe('Aicha');

    // The header arrow, the browser's Back or the gesture: one step back, never off the form.
    expect(mockPrevent.enabled).toBe(true);
    act(() => mockPrevent.leave?.({ data: { action: { type: 'GO_BACK' } } }));
    expect(screen.getByText(t('register.step', { current: 1, total: 3 }))).toBeTruthy();
    expect(value(0)).toBe('Nour Electronics');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('a clean first step may be left without a question; a typed one is guarded', async () => {
    renderWith(<RegisterScreen />);
    expect(mockPrevent.enabled).toBe(false);
    fireEvent.changeText(screen.UNSAFE_getAllByType(TextInput)[2], 'Rosso');
    expect(mockPrevent.enabled).toBe(true);
  });

  it('switching the theme keeps the step and everything typed', async () => {
    renderWith(
      <>
        <ThemeToggle />
        <RegisterScreen />
      </>,
    );
    toLastStep();
    fireEvent.changeText(screen.UNSAFE_getAllByType(TextInput)[0], '+22236000001');
    await act(async () => {
      fireEvent.press(screen.getByTestId('theme-toggle'));
    });
    expect(screen.getByText(t('register.step', { current: 3, total: 3 }))).toBeTruthy();
    expect(value(0)).toBe('+22236000001');
    fireEvent.press(screen.getByText(t('register.previous')));
    expect(value(0)).toBe('Aicha');
  });
});

describe('the WhatsApp consent beside the number (D213)', () => {
  it('shows the server’s copy beside the number with a box that starts unticked, and the privacy page', async () => {
    renderWith(<RegisterScreen />);
    toLastStep();
    const box = await screen.findByTestId('whatsapp-consent-check');
    expect(box.props.accessibilityRole).toBe('checkbox');
    expect(box.props.accessibilityState).toMatchObject({ checked: false });
    expect(box.props.accessibilityLabel).toBe(CONSENT_COPY.en.agreement);
    expect(screen.getByText(CONSENT_COPY.en.agreement)).toBeTruthy();
    expect(screen.getByText(CONSENT_COPY.en.body)).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith('/messaging/whatsapp/consent?language=en');
    // Typing the number ticks nothing.
    fillLastStep();
    expect(screen.getByTestId('whatsapp-consent-check').props.accessibilityState).toMatchObject({ checked: false });
  });

  it('unticked, nothing is sent: the problem is said under the box, read with it, and the screen reader is taken there', async () => {
    const { AccessibilityInfo } = jest.requireActual('react-native') as typeof import('react-native');
    const focus = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => undefined);
    renderWith(<RegisterScreen />);
    toLastStep();
    await screen.findByTestId('whatsapp-consent-check');
    fillLastStep();
    await act(async () => {
      fireEvent.press(screen.getByText(t('register.submit')));
    });
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.getByText(t('register.problem.whatsappConsent'))).toBeTruthy();
    expect(screen.getByTestId('whatsapp-consent-check').props.accessibilityHint).toBe(t('register.problem.whatsappConsent'));
    expect(focus).toHaveBeenCalledWith(expect.anything(), 'focus');
    // Ticking it clears the problem.
    fireEvent.press(screen.getByTestId('whatsapp-consent-check'));
    expect(screen.queryByText(t('register.problem.whatsappConsent'))).toBeNull();
    focus.mockRestore();
  });

  it('an updated copy refused by the server: the box is unticked again and the new copy is fetched — nothing moves on', async () => {
    (api.post as jest.Mock).mockRejectedValue(new ApiError('The WhatsApp consent shown is not the current one.', 400, 'whatsapp_consent_outdated'));
    renderWith(<RegisterScreen />);
    await fillForm();
    const reads = (api.get as jest.Mock).mock.calls.filter(([p]) => String(p).startsWith('/messaging/whatsapp/consent')).length;
    await act(async () => {
      fireEvent.press(screen.getByText(t('register.submit')));
    });
    expect(await screen.findByText(t('consent.problem.outdated'))).toBeTruthy();
    expect(screen.getByTestId('whatsapp-consent-check').props.accessibilityState).toMatchObject({ checked: false });
    await waitFor(() => expect((api.get as jest.Mock).mock.calls.filter(([p]) => String(p).startsWith('/messaging/whatsapp/consent')).length).toBeGreaterThan(reads));
    expect(routerReplace).not.toHaveBeenCalled();
  });

  it('a modified client that sends no consent is refused by the server, and the screen asks for it', async () => {
    (api.post as jest.Mock).mockRejectedValue(new ApiError('Agree to receive operational Dukan ERP messages on WhatsApp to continue.', 400, 'whatsapp_consent_required'));
    renderWith(<RegisterScreen />);
    await fillForm();
    await act(async () => {
      fireEvent.press(screen.getByText(t('register.submit')));
    });
    expect(await screen.findByText(t('register.problem.whatsappConsent'))).toBeTruthy();
    expect(routerReplace).not.toHaveBeenCalled();
  });

  it('the copy that cannot be loaded is said, with a way to try again — and there is no box to tick without it', async () => {
    (api.get as jest.Mock).mockImplementation(async (path: string) => {
      if (consentCopyFor(path)) throw new TypeError('Network request failed');
      return {};
    });
    renderWith(<RegisterScreen />);
    toLastStep();
    expect(await screen.findByText(t('consent.loadFailed'))).toBeTruthy();
    expect(screen.queryByTestId('whatsapp-consent-check')).toBeNull();
    expect(screen.getByText(t('action.retry'))).toBeTruthy();
  });

  it.each(['fr', 'ar'] as const)('in %s, the copy is the server’s in that language, and its language is what is recorded', async (lang) => {
    await useI18n.getState().setLanguage(lang);
    try {
      (api.post as jest.Mock).mockResolvedValue({ status: 'pending_activation', created: true, publicStoreId: 'S', verification: null, continuation: null, next: 'sign_in' });
      renderWith(<RegisterScreen />);
      toLastStep();
      expect(await screen.findByText(CONSENT_COPY[lang].agreement)).toBeTruthy();
      fillLastStep();
      fireEvent.press(screen.getByTestId('whatsapp-consent-check'));
      await act(async () => {
        fireEvent.press(screen.getByText(t('register.submit')));
      });
      expect((api.post as jest.Mock).mock.calls[0][1]).toEqual(expect.objectContaining({ whatsappConsentVersion: CONSENT_VERSION, whatsappConsentLocale: lang, language: lang }));
    } finally {
      await useI18n.getState().setLanguage('en');
    }
  });
});

describe('the code check', () => {
  it('asks for the code on auth/register/verify/start, confirms on auth/register/verify/confirm, adopts the session clean and lands on the closed screen', async () => {
    mockStore.set('erp.registration.continuation', CONTINUATION);
    // Left on this phone by somebody else: a branch, a device namespace, a cached read and an unsent queue.
    mockStore.set('erp.branch', JSON.stringify({ id: 'b-old', name: 'Old Boutique', role: 'owner' }));
    mockStore.set('auth.credentialNamespace', 'someone-else');
    useBranch.setState({ branchId: 'b-old', branchName: 'Old Boutique', role: 'owner' });
    useQueue.setState({ items: [], scope: { companyId: 'c-old', branchId: 'b-old', userId: 'u-old' }, running: false });
    (api.post as jest.Mock).mockImplementation(async (path: string) => {
      if (path === '/auth/register/verify/start') return { delivery: 'sent' };
      if (path === '/auth/register/verify/confirm') return { accessToken: 'access-new', refreshToken: 'refresh-new', expiresIn: 900 };
      return {};
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    client.setQueryData(['sales', 'b-old'], { rows: ['somebody else’s sale'] });

    renderWith(<VerifyScreen />, client);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/register/verify/start', { continuation: CONTINUATION, language: 'en' }));
    expect(screen.getByText(t('register.verify.sent', { destination: 'a•••@example.com' }))).toBeTruthy();

    fireEvent.changeText(screen.UNSAFE_getAllByType(TextInput)[0], '123456');
    await act(async () => {
      fireEvent.press(screen.getByText(t('register.verify.confirm')));
    });

    await waitFor(() => expect(routerReplace).toHaveBeenLastCalledWith('/access-closed'));
    expect(api.post).toHaveBeenCalledWith('/auth/register/verify/confirm', { continuation: CONTINUATION, code: '123456' });
    // The ordinary session is installed and the continuation is gone.
    expect(mockStore.get('erp.accessToken')).toBe('access-new');
    expect(mockStore.get('erp.refreshToken')).toBe('refresh-new');
    expect(mockStore.has('erp.registration.continuation')).toBe(false);
    // Nothing of the phone's previous user is adopted with it.
    expect(client.getQueryData(['sales', 'b-old'])).toBeUndefined();
    expect(useBranch.getState().branchId).toBeNull();
    expect(mockStore.has('erp.branch')).toBe(false);
    expect(mockStore.has('auth.credentialNamespace')).toBe(false);
    expect(useQueue.getState().scope).not.toEqual({ companyId: 'c-old', branchId: 'b-old', userId: 'u-old' });
    // Only the app's own registration routes were asked.
    const paths = (api.post as jest.Mock).mock.calls.map(([p]) => p);
    expect(paths.every((p: string) => p.startsWith('/auth/register/verify/'))).toBe(true);
    expect(screenText()).not.toMatch(UNSAID);
  });

  /** The code check, up to the press on Confirm, with the server answering the confirmation by `confirm`. */
  async function confirmWith(confirm: () => never) {
    mockStore.set('erp.registration.continuation', CONTINUATION);
    (api.post as jest.Mock).mockImplementation(async (path: string) => {
      if (path === '/auth/register/verify/start') return { delivery: 'sent' };
      return confirm();
    });
    renderWith(<VerifyScreen />);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/register/verify/start', { continuation: CONTINUATION, language: getLanguage() }));
    fireEvent.changeText(screen.UNSAFE_getAllByType(TextInput)[0], '123456');
    await act(async () => {
      fireEvent.press(screen.getByText(t('register.verify.confirm')));
    });
  }

  it('an answer that does not arrive in time is never "wrong code": the account may be ready — sign in with the password', async () => {
    await confirmWith(() => {
      throw new RequestTimeout();
    });
    expect(await screen.findByText(t('register.verify.timeout'))).toBeTruthy();
    expect(t('register.verify.timeout')).toBe('We could not confirm in time. If the code was right, your account is ready — sign in with your password.');
    expect(screen.queryByText(t('register.verify.wrong'))).toBeNull();
    fireEvent.press(screen.getByText(t('auth.action.signIn')));
    expect(routerReplace).toHaveBeenLastCalledWith('/(auth)/login');
  });

  it('no connection is not a wrong code either; a code the server refused still is', async () => {
    await confirmWith(() => {
      throw new TypeError('Network request failed');
    });
    expect(await screen.findByText(t('state.error.offline.body'))).toBeTruthy();
    expect(screen.queryByText(t('register.verify.wrong'))).toBeNull();
    expect(screen.queryByText(t('register.verify.timeout'))).toBeNull();
    screen.unmount();

    await confirmWith(() => {
      throw new ApiError('That code did not match.', 400);
    });
    expect(await screen.findByText(t('register.verify.wrong'))).toBeTruthy();
    expect(screen.queryByText('That code did not match.')).toBeNull();
    expect(screen.queryByText(t('register.verify.timeout'))).toBeNull();
  });

  it('after a lost answer, the same code refused is not "wrong code" — the account it made is refused the same way; another code refused is', async () => {
    // The server finished the registration with the first code; only its answer was lost. Confirming again is refused
    // as a wrong code would be (a spent registration and a wrong code are one 400).
    let finished = false;
    await confirmWith(() => {
      if (!finished) {
        finished = true;
        throw new RequestTimeout();
      }
      throw new ApiError('That code did not match.', 400);
    });
    expect(await screen.findByText(t('register.verify.timeout'))).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByText(t('register.verify.confirm')));
    });
    expect(screen.getByText(t('register.verify.timeout'))).toBeTruthy();
    expect(screen.queryByText(t('register.verify.wrong'))).toBeNull();
    expect(screen.queryByText('That code did not match.')).toBeNull();

    // Another code: the server's refusal is said, and sign-in stays offered for the code whose answer was lost.
    fireEvent.changeText(screen.UNSAFE_getAllByType(TextInput)[0], '654321');
    await act(async () => {
      fireEvent.press(screen.getByText(t('register.verify.confirm')));
    });
    expect(await screen.findByText(t('register.verify.wrong'))).toBeTruthy();
    expect(screen.getByText(t('register.verify.timeout'))).toBeTruthy();
    expect(screen.getByText(t('auth.action.signIn'))).toBeTruthy();
  });

  it('a refused code is said in the person’s language — Arabic or French — never in the server’s English', async () => {
    for (const language of ['ar', 'fr'] as const) {
      await useI18n.getState().setLanguage(language);
      await confirmWith(() => {
        throw new ApiError('That code did not match.', 400);
      });
      expect(await screen.findByText(t('register.verify.wrong'))).toBeTruthy();
      expect(t('register.verify.wrong')).not.toMatch(/did not match/);
      expect(screen.queryByText(/That code did not match/)).toBeNull();
      screen.unmount();
      (api.post as jest.Mock).mockReset();
    }
    await useI18n.getState().setLanguage('en');
  });

  it('a gateway that answered in the API’s place (504, 502) is no answer: the account may be ready, and the same code refused next is never "wrong"', async () => {
    for (const status of [504, 502]) {
      let first = true;
      await confirmWith(() => {
        if (first) {
          first = false;
          throw new ApiError(status === 504 ? 'Gateway Timeout' : 'Bad Gateway', status);
        }
        throw new ApiError('That code did not match.', 400);
      });
      expect(await screen.findByText(t('register.verify.timeout'))).toBeTruthy();
      expect(screen.queryByText(/Gateway/)).toBeNull();
      await act(async () => {
        fireEvent.press(screen.getByText(t('register.verify.confirm')));
      });
      expect(screen.queryByText(t('register.verify.wrong'))).toBeNull();
      expect(screen.getByText(t('register.verify.timeout'))).toBeTruthy();
      fireEvent.press(screen.getByText(t('auth.action.signIn')));
      expect(routerReplace).toHaveBeenLastCalledWith('/(auth)/login');
      screen.unmount();
      (api.post as jest.Mock).mockReset();
    }
  });

  it('a success whose answer cannot be read is an answer lost: no session is made up from it, and that code is never "wrong"', async () => {
    // What a proxy or a cut connection hands back for a 200: a page of its own, a half-written body, nothing at all.
    for (const answer of ['<html><body>Service notice</body></html>', '{"accessToken":"acc', undefined, {}]) {
      let first = true;
      mockStore.set('erp.registration.continuation', CONTINUATION);
      (api.post as jest.Mock).mockImplementation(async (path: string) => {
        if (path === '/auth/register/verify/start') return { delivery: 'sent' };
        if (first) {
          first = false;
          return answer;
        }
        throw new ApiError('That code did not match.', 400);
      });
      renderWith(<VerifyScreen />);
      await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/register/verify/start', { continuation: CONTINUATION, language: getLanguage() }));
      fireEvent.changeText(screen.UNSAFE_getAllByType(TextInput)[0], '123456');
      await act(async () => {
        fireEvent.press(screen.getByText(t('register.verify.confirm')));
      });
      expect(await screen.findByText(t('register.verify.timeout'))).toBeTruthy();
      expect(mockStore.has('erp.accessToken')).toBe(false);
      expect(routerReplace).not.toHaveBeenCalledWith('/access-closed');
      await act(async () => {
        fireEvent.press(screen.getByText(t('register.verify.confirm')));
      });
      expect(screen.queryByText(t('register.verify.wrong'))).toBeNull();
      screen.unmount();
      (api.post as jest.Mock).mockReset();
    }
  });

  it('once the server said yes, a failure after it is not "wrong code" nor "offline": the account is ready — sign in', async () => {
    (api.get as jest.Mock).mockImplementation(async () => {
      throw new TypeError('Network request failed');
    });
    let first = true;
    await confirmWith(() => {
      if (first) {
        first = false;
        return { accessToken: 'access-new', refreshToken: 'refresh-new', expiresIn: 900 } as never;
      }
      throw new ApiError('That code did not match.', 400);
    });
    expect(await screen.findByText(t('register.verify.timeout'))).toBeTruthy();
    expect(screen.queryByText(t('state.error.offline.body'))).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByText(t('register.verify.confirm')));
    });
    expect(screen.queryByText(t('register.verify.wrong'))).toBeNull();
    expect(screen.getByText(t('auth.action.signIn'))).toBeTruthy();
  });

  it('a 503 is an answer — the code was not taken — and a code request through a gateway that gave up is not a refusal', async () => {
    await confirmWith(() => {
      throw new ApiError('Service Unavailable', 503);
    });
    expect(await screen.findByText(t('auth.error.unknown'))).toBeTruthy();
    expect(screen.queryByText(t('register.verify.timeout'))).toBeNull();
    screen.unmount();
    (api.post as jest.Mock).mockReset();

    mockStore.set('erp.registration.continuation', CONTINUATION);
    (api.post as jest.Mock).mockRejectedValue(new ApiError('Gateway Timeout', 504));
    renderWith(<VerifyScreen />);
    expect(await screen.findByText(t('register.verify.sendUnknown'))).toBeTruthy();
    expect(screen.queryByText(t('register.verify.notSent'))).toBeNull();
  });

  it('a code request the server refuses on arrival is said in the person’s language — French or Arabic — never in its English', async () => {
    for (const language of ['fr', 'ar'] as const) {
      await useI18n.getState().setLanguage(language);
      mockStore.set('erp.registration.continuation', CONTINUATION);
      // The server's one sentence for every refused code request: an expired or spent sign-up, a code limit reached.
      (api.post as jest.Mock).mockRejectedValue(new ApiError('That registration cannot be continued.', 400));
      renderWith(<VerifyScreen />);
      expect(await screen.findByText(t('register.verify.notSent'))).toBeTruthy();
      expect(t('register.verify.notSent')).not.toMatch(/code was not sent|cannot be continued/);
      expect(screen.queryByText(/cannot be continued/)).toBeNull();
      expect(screen.queryByText(t('register.failed'))).toBeNull();
      screen.unmount();
      (api.post as jest.Mock).mockReset();
    }
    await useI18n.getState().setLanguage('en');
    expect(t('register.verify.notSent')).toBe('The code was not sent. Wait a little and try again. If it still does not work, start again.');
  });

  it('Send again refused — by the rate limit, by a code limit — says so in the app’s words, never "ThrottlerException" or the server’s sentence', async () => {
    jest.useFakeTimers();
    try {
      await useI18n.getState().setLanguage('fr');
      mockStore.set('erp.registration.continuation', CONTINUATION);
      const answers: (() => unknown)[] = [
        () => ({ delivery: 'sent' }),
        () => {
          throw new ApiError('ThrottlerException: Too Many Requests', 429);
        },
        () => {
          throw new ApiError('Too many codes requested. Try again in a little while.', 400);
        },
      ];
      (api.post as jest.Mock).mockImplementation(async () => answers.shift()!());
      renderWith(<VerifyScreen />);
      await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
      // Send again waits a minute after a code was sent.
      for (let second = 0; second <= 60; second++) {
        await act(async () => {
          jest.advanceTimersByTime(1000);
        });
      }
      await act(async () => {
        fireEvent.press(screen.getByText(t('register.verify.resend')));
      });
      expect(await screen.findByText(t('register.verify.tooMany'))).toBeTruthy();
      expect(screen.queryByText(/ThrottlerException|Too Many Requests/)).toBeNull();
      await act(async () => {
        fireEvent.press(screen.getByText(t('register.verify.resend')));
      });
      expect(await screen.findByText(t('register.verify.notSent'))).toBeTruthy();
      expect(screen.queryByText(t('register.verify.tooMany'))).toBeNull();
      expect(screen.queryByText(/Too many codes requested/)).toBeNull();
      expect(api.post).toHaveBeenCalledTimes(3);
      screen.unmount();
    } finally {
      jest.useRealTimers();
      await useI18n.getState().setLanguage('en');
    }
  });

  it('a code request with no answer is not a refusal: the code may be on its way, and nothing says it was not sent', async () => {
    mockStore.set('erp.registration.continuation', CONTINUATION);
    (api.post as jest.Mock).mockRejectedValue(new RequestTimeout());
    renderWith(<VerifyScreen />);
    expect(await screen.findByText(t('register.verify.sendUnknown'))).toBeTruthy();
    expect(t('register.verify.sendUnknown')).toBe('We could not tell whether the code was sent. If it does not arrive in a few minutes, try again.');
    expect(screen.queryByText(t('register.verify.notSent'))).toBeNull();
    expect(screen.queryByText(t('register.failed'))).toBeNull();
  });

  it('the code check’s own refusals are said in the person’s language too: the rate limit asks for a minute, anything else is the app’s', async () => {
    await useI18n.getState().setLanguage('ar');
    await confirmWith(() => {
      throw new ApiError('ThrottlerException: Too Many Requests', 429);
    });
    expect(await screen.findByText(t('register.verify.tooMany'))).toBeTruthy();
    expect(screen.queryByText(/ThrottlerException/)).toBeNull();
    expect(screen.queryByText(t('register.verify.wrong'))).toBeNull();
    screen.unmount();
    (api.post as jest.Mock).mockReset();

    await useI18n.getState().setLanguage('fr');
    await confirmWith(() => {
      throw new ApiError('Forbidden resource', 403);
    });
    expect(await screen.findByText(t('auth.error.unknown'))).toBeTruthy();
    expect(screen.queryByText(/Forbidden resource/)).toBeNull();
    screen.unmount();
    await useI18n.getState().setLanguage('en');
  });
});
