import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import { t } from '../lib/i18n';
import { useBranch } from '../lib/branch';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  __esModule: true,
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
}));
jest.mock('../lib/api-client', () => ({
  __esModule: true,
  ApiError: class ApiError extends Error {},
  api: { get: jest.fn() },
  clearSession: jest.fn(),
}));
jest.mock('../hooks/useAuth', () => ({
  __esModule: true,
  useAuth: () => ({ user: { name: 'Aicha' }, signOut: jest.fn() }),
}));

import { api } from '../lib/api-client';
import SelectBranch from '../app/select-branch';

const centre = { id: 'b1', name: 'Centre', nameAr: null, type: 'store', role: 'owner' };
const port = { id: 'b2', name: 'Port', nameAr: null, type: 'store', role: 'manager' };

async function show(stores: unknown[]) {
  (api.get as jest.Mock).mockResolvedValue(stores);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <SelectBranch />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

/** Choosing a store, signed in (D227): the role and permissions come from the store chosen; nothing is lost on the way. */
describe('the store selector', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    useBranch.getState().clear();
  });

  it('a first choice sets the store and leaves routing to the app', async () => {
    await show([centre, port]);
    await fireEvent.press(await screen.findByText('Port'));
    expect(useBranch.getState()).toMatchObject({ branchId: 'b2', role: 'manager' });
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('a switch keeps the current store until another is chosen, then returns to the app in the new one', async () => {
    useBranch.getState().setBranch(centre as never);
    await show([centre, port]);
    await screen.findByText('Port');
    expect(useBranch.getState().branchId).toBe('b1');
    expect(screen.getAllByText(new RegExp(t('branch.select.current'))).length).toBe(1);
    await fireEvent.press(screen.getByText('Port'));
    expect(useBranch.getState()).toMatchObject({ branchId: 'b2', role: 'manager' });
    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  it('no active store: says so honestly', async () => {
    await show([]);
    expect(await screen.findByText(t('branch.select.none.title'))).toBeTruthy();
  });
});
