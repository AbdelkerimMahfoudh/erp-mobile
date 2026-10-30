/**
 * Push on the phone (D225): the one-time offer after sign-in, registration, and a tapped push in the foreground or at
 * a cold start. iOS's answers and the tapped pushes come from `mocks/expo-notifications.ts`; this is Jest, not a
 * physical iPhone — APNs delivery and a real cold start are on the physical-device checklist (docs/111).
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import { t } from '../lib/i18n';
import { push as routerPush } from './mocks/expo-router';
import * as N from './mocks/expo-notifications';

jest.mock('../lib/api-client', () => ({
  __esModule: true,
  ApiError: class extends Error {},
  api: { get: jest.fn(), post: jest.fn(async () => ({})), put: jest.fn(), patch: jest.fn(), delete: jest.fn(async () => ({})) },
  clearSession: jest.fn(),
}));
const mockStore = new Map<string, string>();
jest.mock('../lib/storage', () => ({
  getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItem: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  deleteItem: jest.fn(async (k: string) => void mockStore.delete(k)),
}));
// The app's EAS project, as app.json names it (the Jest preset leaves `extra` empty).
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { eas: { projectId: 'test-project' } } } } }));
let mockUser: { id: string } | null = { id: 'u-1' };
jest.mock('../hooks/useAuth', () => ({ __esModule: true, useAuth: () => ({ user: mockUser }) }));

import { api } from '../lib/api-client';
import { usePushOffer } from '../lib/push-offer';
import { PushBridge } from '../components/notifications/PushBridge';

const ID = '0192f0c4-7b1a-7c3e-9a55-1f2e3d4c5b6a';

async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = await render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <PushBridge />
      </QueryClientProvider>
    </ThemeProvider>,
  );
  // The previous test's registration may still be settling: let this mount's effects (its listeners) run first.
  await act(async () => undefined);
  return view;
}

beforeEach(() => {
  N.__state.reset();
  mockStore.clear();
  mockUser = { id: 'u-1' };
  usePushOffer.getState().done();
  routerPush.mockClear();
  (api.post as jest.Mock).mockClear();
  (api.delete as jest.Mock).mockClear();
});

describe('the offer: after sign-in, once, never at launch', () => {
  it('a session restored at launch is never asked anything', async () => {
    await mount();
    await act(async () => undefined);
    expect(screen.queryByText(t('push.offer.title'))).toBeNull();
    expect(N.__state.asked).toBe(0);
  });

  it('right after sign-in the app explains first; "Enable notifications" opens iOS’s prompt, then registers this phone', async () => {
    usePushOffer.getState().signedIn();
    await mount();
    expect(await screen.findByText(t('push.offer.title'))).toBeTruthy();
    expect(N.__state.asked).toBe(0);
    await fireEvent.press(screen.getByText(t('push.offer.allow')));
    await waitFor(() => expect(N.__state.asked).toBe(1));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/notifications/devices', { token: 'ExponentPushToken[test]', platform: 'ios', locale: 'en' }));
  });

  it('"Not now" asks nothing, and is remembered: the next sign-in is not asked again', async () => {
    usePushOffer.getState().signedIn();
    await mount();
    await fireEvent.press(await screen.findByText(t('push.offer.notNow')));
    expect(N.__state.asked).toBe(0);
    await cleanup();
    usePushOffer.getState().signedIn();
    await mount();
    await act(async () => undefined);
    expect(screen.queryByText(t('push.offer.title'))).toBeNull();
  });

  it('once iOS has answered, the app never offers again', async () => {
    N.__state.permission = 'denied';
    usePushOffer.getState().signedIn();
    await mount();
    await act(async () => undefined);
    expect(screen.queryByText(t('push.offer.title'))).toBeNull();
  });
});

describe('registration', () => {
  it('with permission granted, the phone registers once for the person — and not again for nothing', async () => {
    N.__state.permission = 'granted';
    await mount();
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    await cleanup();
    await mount();
    await act(async () => undefined);
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('a rotated token registers again and names the one it replaces', async () => {
    N.__state.permission = 'granted';
    await mount();
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    N.__state.token = 'ExponentPushToken[rotated]';
    await act(async () => {
      for (const l of [...N.__state.tokens]) l({ type: 'ios', data: 'device-token' });
    });
    await waitFor(() =>
      expect(api.post).toHaveBeenLastCalledWith('/notifications/devices', { token: 'ExponentPushToken[rotated]', platform: 'ios', locale: 'en', replaces: 'ExponentPushToken[test]' }),
    );
  });

  it('without permission nothing is registered', async () => {
    await mount();
    await act(async () => undefined);
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('a tapped push opens the opening screen, once', () => {
  it('in the foreground or background: the same tap reported twice navigates once', async () => {
    await mount();
    await act(async () => {
      N.__tap('resp-1', { notificationId: ID, type: 'sale.recorded', link: 'https://example.invalid' });
      N.__tap('resp-1', { notificationId: ID, type: 'sale.recorded' });
    });
    expect(routerPush.mock.calls).toEqual([[{ pathname: '/notification-open', params: { id: ID } }]]);
  });

  it('a push whose data carries no notification id opens nothing', async () => {
    await mount();
    await act(async () => N.__tap('resp-2', { link: '/sales/x' }));
    expect(routerPush).not.toHaveBeenCalled();
  });

  it('at a cold start, before sign-in, the tap waits for the sign-in, then opens once', async () => {
    mockUser = null;
    N.__launchedBy('resp-3', { notificationId: ID });
    const view = await mount();
    await act(async () => undefined);
    expect(routerPush).not.toHaveBeenCalled();
    mockUser = { id: 'u-1' };
    await view.rerender(
      <ThemeProvider>
        <QueryClientProvider client={new QueryClient()}>
          <PushBridge />
        </QueryClientProvider>
      </ThemeProvider>,
    );
    await waitFor(() => expect(routerPush.mock.calls).toEqual([[{ pathname: '/notification-open', params: { id: ID } }]]));
  });
});
