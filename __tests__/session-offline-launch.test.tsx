/// <reference types="jest" />
/**
 * Opening the app without a connection keeps the session (review MO1-03, 2026-10-16).
 *
 * At launch the stored session is checked with `/auth/me`. Any failure used to delete it, so a phone opened offline,
 * or during a server error, was signed out and the person had to type their password again online. Only the server
 * refusing the session (401/403) ends it now; otherwise the identity stored at sign-in is used, as it is when the
 * network drops during the day.
 *
 * The real AuthProvider; the server and storage are mocked.
 */
import React from 'react';
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useConnectivity } from '../lib/connectivity';
import { api, ApiError, clearSession } from '../lib/api-client';
import { AuthProvider, useAuth } from '../hooks/useAuth';

const mockStore = new Map<string, string>();

jest.mock('../lib/storage', () => ({
  getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItem: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  deleteItem: jest.fn(async (k: string) => void mockStore.delete(k)),
}));
jest.mock('../lib/offline/queue-store', () => ({ readQueue: () => ({ items: [], quarantined: false }), writeQueue: jest.fn() }));
jest.mock('../lib/report-export', () => ({ clearExports: jest.fn() }));
jest.mock('../lib/device', () => ({
  clearLegacyCredential: jest.fn(async () => undefined),
  deviceMeta: () => ({ label: 'test', platform: 'ios', appVersion: '0' }),
  loadCredential: jest.fn(async () => ({ deviceId: 'd', deviceSecret: 's' })),
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

const USER = { id: 'u1', companyId: 'c1', name: 'Owner Boutique 1', login: 'owner', publicStoreId: 'S1' };

function Probe() {
  const { user, bootstrapping } = useAuth();
  if (bootstrapping) return <Text>starting</Text>;
  return <Text>{user ? `signed in: ${user.name}` : 'signed out'}</Text>;
}

async function launch(meFails: unknown) {
  (api.get as jest.Mock).mockImplementation(async (path: string) => {
    if (path.startsWith('/auth/me')) throw meFails;
    throw new TypeError('Network request failed');
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockStore.clear();
  mockStore.set('erp.accessToken', 'access');
  mockStore.set('erp.refreshToken', 'refresh');
  mockStore.set('erp.user', JSON.stringify(USER));
  mockStore.set('erp.branch', JSON.stringify({ id: 'b1', name: 'Boutique 1', role: 'owner' }));
  useConnectivity.setState({ online: false });
  (api.get as jest.Mock).mockReset();
  (api.post as jest.Mock).mockReset().mockResolvedValue({});
  (clearSession as jest.Mock).mockClear();
});

it.each([
  ['no connection', new TypeError('Network request failed')],
  ['a server error', new ApiError('Internal server error', 500)],
  ['a gateway that did not answer', new ApiError('Bad gateway', 502)],
])('launched with %s, the person stays signed in and the session is kept', async (_case, failure) => {
  await launch(failure);
  expect(await screen.findByText('signed in: Owner Boutique 1')).toBeTruthy();
  expect(clearSession).not.toHaveBeenCalled();
});

it.each([401, 403])('the server refusing the session (%i) still signs the person out', async (status) => {
  await launch(new ApiError('Session no longer valid', status));
  expect(await screen.findByText('signed out')).toBeTruthy();
  expect(clearSession).toHaveBeenCalled();
});
