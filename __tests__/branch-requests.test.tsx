/// <reference types="jest" />
/**
 * Adding a store from the app (0130; the owner's brief of 2026-11-05), as a person sees it:
 * - the Owner's store list shows a waiting store with its "Pending activation" badge — it opens its read-only status
 *   page and is never chosen — and offers "Add a store";
 * - a Manager or an Employee sees neither, and the app does not even ask;
 * - the form says what happens before it is sent, refuses an empty name, and two taps send one request with one key;
 * - the status page shows the state in words and nothing about paying.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import { t } from '../lib/i18n';

jest.mock('expo-router', () => ({ ...jest.requireActual('./mocks/expo-router'), useLocalSearchParams: () => ({ id: 'r1' }) }));
jest.mock('../hooks/useAuth', () => ({
  __esModule: true,
  useAuth: () => ({ user: { id: 'u1', name: 'Aicha' }, signOut: jest.fn() }),
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
  return { __esModule: true, ApiError, api: { get: jest.fn(), post: jest.fn() } };
});

import { api } from '../lib/api-client';
import { push } from './mocks/expo-router';
import { textInputs } from './tree';
import SelectBranch from '../app/select-branch';
import BranchNew from '../app/branch-new';
import BranchRequestStatus from '../app/branch-request/[id]';

const WAITING = { id: 'r1', name: 'Ksar', address: 'Nouakchott', state: 'pending_activation', requestedAt: '2026-11-06T00:00:00Z', branchId: null };

async function mount(node: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>{node}</QueryClientProvider>
    </ThemeProvider>,
  );
}

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  push.mockReset();
});

it('the Owner sees the waiting store with its badge, opens its status page, and can add a store', async () => {
  get.mockImplementation(async (path: string) =>
    path === '/auth/branches' ? [{ id: 'b1', name: 'Main', type: 'store', role: 'owner' }] : [WAITING],
  );
  await mount(<SelectBranch />);
  expect(await screen.findByText('Ksar')).toBeTruthy();
  expect(screen.getByText(t('branchRequest.badge'))).toBeTruthy();
  await fireEvent.press(screen.getByText('Ksar'));
  expect(push).toHaveBeenCalledWith({ pathname: '/branch-request/[id]', params: { id: 'r1' } });
  await fireEvent.press(screen.getByText(t('branchRequest.add')));
  expect(push).toHaveBeenCalledWith('/branch-new');
});

it('a Manager sees no waiting store and no Add — and the app does not ask', async () => {
  get.mockImplementation(async (path: string) => (path === '/auth/branches' ? [{ id: 'b1', name: 'Main', type: 'store', role: 'store_manager' }] : [WAITING]));
  await mount(<SelectBranch />);
  expect(await screen.findByText('Main')).toBeTruthy();
  expect(screen.queryByText('Ksar')).toBeNull();
  expect(screen.queryByText(t('branchRequest.add'))).toBeNull();
  expect(get.mock.calls.map((c) => c[0])).not.toContain('/branches/requests');
});

it('the form explains first, refuses an empty name, and two taps send one request', async () => {
  let resolve: (v: unknown) => void = () => undefined;
  post.mockImplementation(() => new Promise((r) => (resolve = r)));
  await mount(<BranchNew />);
  expect(JSON.stringify(screen.toJSON())).toContain(t('branchRequest.before.body'));
  await fireEvent.press(screen.getByText(t('branchRequest.submit')));
  expect(await screen.findByText(t('branchRequest.error.nameRequired'))).toBeTruthy();
  expect(post).not.toHaveBeenCalled();

  await fireEvent.changeText(textInputs()[0], '  Ksar ');
  await fireEvent.press(screen.getByText(t('branchRequest.submit')));
  await fireEvent.press(screen.getByText(t('branchRequest.submit')));
  expect(post).toHaveBeenCalledTimes(1);
  expect(post.mock.calls[0][0]).toBe('/branches/requests');
  expect(post.mock.calls[0][1]).toMatchObject({ name: 'Ksar', requestKey: expect.any(String) });
  await act(async () => resolve({ request: WAITING, created: true }));
});

it('the status page states where it stands — and nothing about paying', async () => {
  get.mockResolvedValue(WAITING);
  await mount(<BranchRequestStatus />);
  expect(await screen.findByText('Ksar')).toBeTruthy();
  expect(JSON.stringify(screen.toJSON())).toContain(t('branchRequest.stateBody.pending_activation'));
  expect(screen.getByText('Nouakchott')).toBeTruthy();
  const words = (JSON.stringify(screen.toJSON()).match(/"children":\["[^"]*"/g) ?? []).join(" ");
  expect(words).toContain('Nouakchott');
  expect(words).not.toMatch(/MRU|price|pay|subscri|http/i);
});
