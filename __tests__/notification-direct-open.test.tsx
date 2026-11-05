/**
 * Opening a notification without an intermediate screen (D225; Build 6). The server decides at the moment of opening;
 * the person then goes straight to the record — in the record's own store — or, when it cannot be opened, to the
 * notifications with the reason. The opening screen with its skeleton is gone: a successful opening never renders the
 * notifications and never navigates through them.
 */
import React, { useEffect } from 'react';
import { Text } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import { t } from '../lib/i18n';
import { push as routerPush, replace as routerReplace } from './mocks/expo-router';

jest.mock('../lib/api-client', () => ({
  __esModule: true,
  ApiError: class extends Error {},
  api: { get: jest.fn(), post: jest.fn(async () => ({})), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  clearSession: jest.fn(),
}));
jest.mock('../hooks/useAuth', () => ({ __esModule: true, useAuth: () => ({ user: { id: 'me' } }) }));

import { api } from '../lib/api-client';
import { useBranch } from '../lib/branch';
import { useToastStore } from '../lib/toast';
import { useOpenNotification } from '../components/notifications/useOpenNotification';

const NID = '0192f0c4-7b1a-7c3e-9a55-000000000001';
const SALE = '0192f0c4-7b1a-7c3e-9a55-1f2e3d4c5b6a';

/** Somewhere in the app that is not the centre (a push tapped on Home, a cold start): opens `ids` on mount. */
function Opener({ ids }: { ids: string[] }) {
  const open = useOpenNotification();
  useEffect(() => {
    for (const id of ids) void open(id);
  }, [open, ids]);
  return <Text>Home</Text>;
}

function mount(ids: string[] = [NID]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <Opener ids={ids} />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

const toasts = () => useToastStore.getState().toasts.map((x) => x.message);
const navigations = () => [...routerPush.mock.calls, ...routerReplace.mock.calls].map((c) => JSON.stringify(c[0]));

beforeEach(() => {
  routerPush.mockClear();
  routerReplace.mockClear();
  useToastStore.getState().clear();
  (api.get as jest.Mock).mockReset();
  (api.post as jest.Mock).mockClear();
  useBranch.getState().setBranch({ id: 'b-1', name: 'Ksar', nameAr: 'لكصر', role: 'store_manager' } as never);
});

it('ok: switches to the record’s store, marks it read, and goes straight to the record — never through the notifications', async () => {
  (api.get as jest.Mock).mockImplementation(async (path: string) => {
    if (path === `/notifications/${NID}/open`) return { status: 'ok', target: { kind: 'sale', id: SALE, detail: null }, branchId: 'b-2' };
    if (path === '/auth/branches') return [{ id: 'b-2', name: 'Tevragh Zeina', nameAr: 'تفرغ زينة', role: 'store_manager' }];
    throw new Error(path);
  });
  await mount();
  await waitFor(() => expect(routerPush).toHaveBeenCalledWith(`/sales/${SALE}`));
  expect(useBranch.getState().branchId).toBe('b-2');
  expect(api.post).toHaveBeenCalledWith(`/notifications/${NID}/read`);
  // The regression this build fixes: exactly one navigation, to the record — no opening screen, no centre.
  expect(navigations()).toEqual([JSON.stringify(`/sales/${SALE}`)]);
  expect(navigations().some((n) => /notification-open|\/notifications"/.test(n))).toBe(false);
  expect(toasts()).toEqual([]);
});

it('a double tap opens the record once', async () => {
  let release: () => void = () => undefined;
  (api.get as jest.Mock).mockImplementation(
    (path: string) =>
      new Promise((resolve) => {
        release = () => resolve(path.endsWith('/open') ? { status: 'ok', target: { kind: 'sale', id: SALE, detail: null }, branchId: null } : []);
      }),
  );
  await mount([NID, NID]);
  release();
  await waitFor(() => expect(routerPush).toHaveBeenCalledTimes(1));
  expect(api.get).toHaveBeenCalledTimes(1);
});

it('unauthorized: the notifications, saying so — nothing of the record, nothing marked read', async () => {
  (api.get as jest.Mock).mockResolvedValue({ status: 'unauthorized' });
  await mount();
  await waitFor(() => expect(toasts()).toEqual([t('notifications.open.unauthorizedBody')]));
  expect(navigations()).toEqual([JSON.stringify('/notifications')]);
  expect(api.post).not.toHaveBeenCalled();
});

it('removed, or a kind this build does not know: the notifications, no longer available', async () => {
  (api.get as jest.Mock).mockResolvedValue({ status: 'unavailable' });
  await mount();
  await waitFor(() => expect(toasts()).toEqual([t('notifications.open.unavailableBody')]));
  routerPush.mockClear();
  useToastStore.getState().clear();
  (api.get as jest.Mock).mockResolvedValue({ status: 'ok', target: { kind: 'settings', id: null, detail: null }, branchId: null });
  await mount();
  await waitFor(() => expect(toasts()).toEqual([t('notifications.open.unavailableBody')]));
  expect(navigations()).toEqual([JSON.stringify('/notifications')]);
});

it('the server does not answer: the notifications, saying it could not be opened', async () => {
  (api.get as jest.Mock).mockRejectedValue(new Error('offline'));
  await mount();
  await waitFor(() => expect(toasts()).toEqual([t('notifications.open.failed')]));
  expect(navigations()).toEqual([JSON.stringify('/notifications')]);
});
