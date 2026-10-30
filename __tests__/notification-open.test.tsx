/**
 * Opening a notification (D225): the server decides at the moment of opening; this screen gives way to the record —
 * in the record's own store — or says why it cannot, showing nothing of the record.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import { t } from '../lib/i18n';
import { replace as routerReplace } from './mocks/expo-router';

let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({ ...jest.requireActual('./mocks/expo-router'), useLocalSearchParams: () => mockParams }));
jest.mock('../lib/api-client', () => ({
  __esModule: true,
  ApiError: class extends Error {},
  api: { get: jest.fn(), post: jest.fn(async () => ({})), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  clearSession: jest.fn(),
}));
jest.mock('../hooks/useAuth', () => ({ __esModule: true, useAuth: () => ({ user: { id: 'me' } }) }));

import { api } from '../lib/api-client';
import { useBranch } from '../lib/branch';
import NotificationOpenScreen from '../app/notification-open';

const NID = '0192f0c4-7b1a-7c3e-9a55-000000000001';
const SALE = '0192f0c4-7b1a-7c3e-9a55-1f2e3d4c5b6a';

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <NotificationOpenScreen />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  mockParams = { id: NID };
  routerReplace.mockClear();
  (api.get as jest.Mock).mockReset();
  (api.post as jest.Mock).mockClear();
  useBranch.getState().setBranch({ id: 'b-1', name: 'Ksar', nameAr: 'لكصر', role: 'store_manager' } as never);
});

it('ok: switches to the record’s store, marks it read, and gives way to the record', async () => {
  (api.get as jest.Mock).mockImplementation(async (path: string) => {
    if (path === `/notifications/${NID}/open`) return { status: 'ok', target: { kind: 'sale', id: SALE, detail: null }, branchId: 'b-2' };
    if (path === '/auth/branches') return [{ id: 'b-2', name: 'Tevragh Zeina', nameAr: 'تفرغ زينة', role: 'store_manager' }];
    throw new Error(path);
  });
  await mount();
  await waitFor(() => expect(routerReplace).toHaveBeenCalledWith(`/sales/${SALE}`));
  expect(useBranch.getState().branchId).toBe('b-2');
  expect(api.post).toHaveBeenCalledWith(`/notifications/${NID}/read`);
  expect(routerReplace).toHaveBeenCalledTimes(1);
});

it('unauthorized: says so, shows nothing of the record, and goes nowhere', async () => {
  (api.get as jest.Mock).mockResolvedValue({ status: 'unauthorized' });
  await mount();
  expect(await screen.findByText(t('notifications.open.unauthorized'))).toBeTruthy();
  expect(screen.getByText(t('notifications.open.back'))).toBeTruthy();
  expect(routerReplace).not.toHaveBeenCalled();
});

it('unavailable, or a kind this build does not know: no longer available', async () => {
  (api.get as jest.Mock).mockResolvedValue({ status: 'unavailable' });
  const first = await mount();
  expect(await screen.findByText(t('notifications.open.unavailable'))).toBeTruthy();
  first.unmount();
  (api.get as jest.Mock).mockResolvedValue({ status: 'ok', target: { kind: 'settings', id: null, detail: null }, branchId: null });
  await mount();
  expect(await screen.findByText(t('notifications.open.unavailable'))).toBeTruthy();
  expect(routerReplace).not.toHaveBeenCalled();
});
