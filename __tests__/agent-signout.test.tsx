/// <reference types="jest" />
/**
 * A shared counter phone at the end of a shift (D161): signing out empties the
 * offline queue in memory — its items and its scope — so the next person to
 * sign in never sees the previous person's exchanges, not even for the moment
 * before their own queue is opened. The file stays on the device, for the same
 * person in the same company and branch.
 *
 * The real AuthProvider, with the session restored from storage; the server,
 * storage and the queue file are mocked.
 */
import React from 'react';
import { Pressable, Text } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useConnectivity } from '../lib/connectivity';
import { api } from '../lib/api-client';
import { AuthProvider, useAuth } from '../hooks/useAuth';
import { useQueue } from '../lib/offline/queue';
import type { QueueItem } from '../lib/offline/queue-rules';

// `jest.mock` is hoisted above these imports; the factories read the `mock…` stores only when called.

const mockStore = new Map<string, string>();
const mockFile: QueueItem[] = [];

jest.mock('../lib/storage', () => ({
  getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItem: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  deleteItem: jest.fn(async (k: string) => void mockStore.delete(k)),
}));
jest.mock('../lib/offline/queue-store', () => ({
  readQueue: (scope: { companyId: string; branchId: string | null; userId: string }) => ({
    items: mockFile.filter((i) => i.companyId === scope.companyId && i.branchId === scope.branchId && i.userId === scope.userId),
    quarantined: false,
  }),
  writeQueue: jest.fn(),
}));
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

const USER = { id: 'u1', companyId: 'c1', name: 'Employee Boutique 2', login: 'emp', publicStoreId: 'S1' };

const exchange: QueueItem = {
  id: 'q1', kind: 'agent.exchange.record', clientUuid: 'k1', companyId: 'c1', branchId: 'b1', userId: 'u1', payloadVersion: 1,
  payload: { providerId: 'bankily', direction: 'cash_in_credit_out', amount: 5000, configVersionId: 'cfg-7', deviceRecordedAt: '2026-10-10T09:00:00.000Z' },
  state: 'waiting_for_connection', createdAt: 1, lastAttemptAt: null, attempts: 0, summary: 'Cash in, credit out · 5 000 MRU · Bankily', lastError: null,
};

function Probe() {
  const { user, signOut } = useAuth();
  return (
    <>
      <Text>{user ? `signed in: ${user.name}` : 'signed out'}</Text>
      <Pressable accessibilityRole="button" onPress={() => void signOut()}>
        <Text>Sign out</Text>
      </Pressable>
    </>
  );
}

beforeEach(() => {
  mockStore.clear();
  mockStore.set('erp.accessToken', 'access');
  mockStore.set('erp.refreshToken', 'refresh');
  mockStore.set('erp.branch', JSON.stringify({ id: 'b1', name: 'Boutique 2 Annexe', role: 'store_employee' }));
  mockFile.length = 0;
  mockFile.push(exchange);
  // Offline: nothing is sent while the session is restored; this test is about what stays in memory.
  useConnectivity.setState({ online: false });
  useQueue.setState({ items: [], scope: null, running: false });
  (api.get as jest.Mock).mockReset();
  (api.post as jest.Mock).mockReset();
  (api.get as jest.Mock).mockImplementation(async (path: string) => {
    if (path.startsWith('/auth/me')) return USER;
    if (path.startsWith('/entitlement')) return { state: 'active', canRead: true, canWrite: true, status: 'activated', isComplimentary: false, calculatedAt: '2026-10-10T09:00:00.000Z', seatsByStore: [{ branchId: 'b1', name: 'Boutique 2 Annexe', activity: 'money_agent', activityNext: null }] };
    if (path.startsWith('/auth/permissions')) return { branchId: 'b1', permissions: ['agent.transaction.record'] };
    return {};
  });
  (api.post as jest.Mock).mockResolvedValue({});
});

it('signing out empties the queue in memory — items and scope — so the next person never sees them', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  );
  expect(await screen.findByText('signed in: Employee Boutique 2')).toBeTruthy();
  // The session's own queue was opened: this person, this company, this branch.
  await waitFor(() => expect(useQueue.getState().items.map((i) => i.id)).toEqual(['q1']));
  expect(useQueue.getState().scope).toEqual({ companyId: 'c1', branchId: 'b1', userId: 'u1' });

  await act(async () => {
    fireEvent.press(screen.getByText('Sign out'));
  });
  expect(await screen.findByText('signed out')).toBeTruthy();
  expect(useQueue.getState().items).toEqual([]);
  expect(useQueue.getState().scope).toBeNull();
  // The file itself is untouched: the same person signing in again finds their exchange waiting.
  expect(mockFile.map((i) => i.id)).toEqual(['q1']);
});
