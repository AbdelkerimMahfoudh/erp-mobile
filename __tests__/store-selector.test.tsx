import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import { t } from '../lib/i18n';
import { useBranch } from '../lib/branch';

const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockDismissTo = jest.fn();
const mockBack = jest.fn();
const mockDismiss = jest.fn();
let mockCanGoBack = true;
jest.mock('expo-router', () => ({
  __esModule: true,
  useRouter: () => ({ replace: mockReplace, push: mockPush, dismissTo: mockDismissTo, back: mockBack, canGoBack: () => mockCanGoBack, dismiss: mockDismiss, canDismiss: () => true }),
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
    for (const m of [mockReplace, mockPush, mockDismissTo, mockBack, mockDismiss]) m.mockClear();
    mockCanGoBack = true;
    useBranch.getState().clear();
  });

  /** Nothing is pushed or replaced: the only navigation is closing the list onto the existing Home tab. */
  const onlyHome = () => {
    expect(mockDismissTo.mock.calls).toEqual([['/(tabs)']]);
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  };

  it('a first choice sets the store and opens Home', async () => {
    await show([centre, port]);
    await fireEvent.press(await screen.findByText('Port'));
    expect(useBranch.getState()).toMatchObject({ branchId: 'b2', role: 'manager' });
    onlyHome();
  });

  it('a switch keeps the current store until another is chosen, then returns to the app in the new one', async () => {
    useBranch.getState().setBranch(centre as never);
    await show([centre, port]);
    await screen.findByText('Port');
    expect(useBranch.getState().branchId).toBe('b1');
    expect(screen.getByText(t('action.cancel'))).toBeTruthy();
    expect(screen.getAllByText(new RegExp(t('branch.select.current'))).length).toBe(1);
    await fireEvent.press(screen.getByText('Port'));
    expect(useBranch.getState()).toMatchObject({ branchId: 'b2', role: 'manager' });
    onlyHome();
  });

  it('one store: the list stays open with it, until it is chosen — nothing redirects (Build 6)', async () => {
    useBranch.getState().setBranch(centre as never);
    await show([centre]);
    expect(await screen.findByText('Centre')).toBeTruthy();
    expect(mockDismissTo).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Centre'));
    onlyHome();
  });

  it('opened and chosen again and again: one dismiss per choice, never a push (the stack does not grow)', async () => {
    useBranch.getState().setBranch(centre as never);
    await show([centre, port]);
    for (const name of ['Port', 'Centre', 'Port']) await fireEvent.press(await screen.findByText(name));
    expect(mockDismissTo).toHaveBeenCalledTimes(3);
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('Cancel closes the list where it was opened, changing nothing', async () => {
    useBranch.getState().setBranch(centre as never);
    await show([centre, port]);
    await fireEvent.press(await screen.findByText(t('action.cancel')));
    expect(mockDismiss).toHaveBeenCalledTimes(1);
    expect(mockBack).not.toHaveBeenCalled();
    expect(useBranch.getState().branchId).toBe('b1');
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('no active store: says so honestly', async () => {
    await show([]);
    expect(await screen.findByText(t('branch.select.none.title'))).toBeTruthy();
  });
});
