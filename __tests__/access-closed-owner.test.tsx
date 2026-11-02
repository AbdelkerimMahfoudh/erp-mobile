import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import { t } from '../lib/i18n';
import { hasPermission } from '../lib/permissions';

let mockUser: Record<string, unknown> = {};
jest.mock('../lib/api-client', () => ({
  __esModule: true,
  ApiError: class ApiError extends Error {},
  api: { get: jest.fn(), post: jest.fn() },
  clearSession: jest.fn(),
}));
jest.mock('../hooks/useAuth', () => ({
  __esModule: true,
  useAuth: () => ({ user: mockUser, signOut: jest.fn() }),
}));

import { api } from '../lib/api-client';
import AccessClosed from '../app/access-closed';

async function show(user: Record<string, unknown>, state: string) {
  mockUser = user;
  (api.get as jest.Mock).mockImplementation(async () => ({ state, canRead: false, canWrite: false }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <AccessClosed />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const owner = { account: { isOwner: true, activeStores: 2 } };
const staff = { account: { isOwner: false, activeStores: 1 } };
const acting = { ...staff, actingOwner: { delegationId: 'd', until: null } };

/** The wording matrix before a store is chosen (D227): account-level data decides words, and grants nothing. */
describe('the closed screen before a store is chosen', () => {
  it('an Owner reads the neutral Owner message', async () => {
    await show(owner, 'pending');
    expect(await screen.findByText(t('access.inactive.owner'))).toBeTruthy();
  });

  it('an Acting Owner reads their own words, and holds no store permission from it', async () => {
    await show(acting, 'pending');
    expect(await screen.findByText(t('access.inactive.acting_owner'))).toBeTruthy();
    expect(screen.queryByText(t('access.inactive.owner'))).toBeNull();
    expect(hasPermission('settings.manage')).toBe(false);
  });

  it('a Manager or Employee reads the state’s own words', async () => {
    await show(staff, 'pending');
    expect(await screen.findByText(t('access.closed.pending.title'))).toBeTruthy();
    expect(screen.queryByText(t('access.inactive.owner'))).toBeNull();
  });

  it('nobody without an active store reads Owner wording, even an Owner', async () => {
    await show({ account: { isOwner: true, activeStores: 0 } }, 'pending');
    expect(await screen.findByText(t('access.inactive.no_store'))).toBeTruthy();
    expect(screen.queryByText(t('access.inactive.owner'))).toBeNull();
  });

  it.each([['suspended', 'suspended'], ['cancelled', 'ended']])('%s: staff read that state’s words', async (state, reason) => {
    await show(staff, state);
    expect(await screen.findByText(t(`access.closed.${reason}.title` as never))).toBeTruthy();
    expect(screen.queryByText(t('access.inactive.owner'))).toBeNull();
  });

  it.each(['suspended', 'cancelled'])('%s: an Owner reads the neutral message', async (state) => {
    await show(owner, state);
    expect(await screen.findByText(t('access.inactive.owner'))).toBeTruthy();
  });

  it('an older server keeps the state’s words', async () => {
    await show({}, 'pending');
    expect(await screen.findByText(t('access.closed.pending.title'))).toBeTruthy();
    expect(screen.queryByText(t('access.inactive.owner'))).toBeNull();
  });
});
