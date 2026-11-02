import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import { t } from '../lib/i18n';

jest.mock('../lib/api-client', () => ({
  __esModule: true,
  ApiError: class ApiError extends Error {},
  api: { get: jest.fn(), post: jest.fn() },
  clearSession: jest.fn(),
}));
jest.mock('../hooks/useAuth', () => ({
  __esModule: true,
  useAuth: () => ({ user: { id: 'u1' }, signOut: jest.fn() }),
}));

import { api } from '../lib/api-client';
import AccessClosed from '../app/access-closed';

const closed = { state: 'pending', status: 'pending_activation', canRead: false, canWrite: false };

async function showWith(permissions: string[]) {
  (api.get as jest.Mock).mockImplementation(async (path: string) => (path === '/auth/permissions' ? { permissions } : closed));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <AccessClosed />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

/** Before a first sign-in chooses a store no store's permissions are read: the person's role must still decide (D227). */
describe('the closed screen before a store is chosen', () => {
  it('an Owner reads the neutral message', async () => {
    await showWith(['settings.manage']);
    expect(await screen.findByText(t('access.inactive.owner'))).toBeTruthy();
  });

  it('anybody else reads the state’s own words, not a message about their number', async () => {
    await showWith([]);
    expect(await screen.findByText(t('access.closed.pending.title'))).toBeTruthy();
    expect(screen.queryByText(t('access.inactive.owner'))).toBeNull();
  });
});
