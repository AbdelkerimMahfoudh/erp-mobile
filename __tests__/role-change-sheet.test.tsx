/// <reference types="jest" />
/**
 * Employee ↔ Manager, rendered (D225): the sheet offers the one change the person's current role allows, with their
 * stores chosen, and confirming sends exactly `PUT /users/:id/role { role, branchIds }`.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import { t, useI18n } from '../lib/i18n';
import { useToastStore } from '../lib/toast';
import type { TeamUser, UserBranch } from '../types/api';

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
    clearSession: jest.fn(),
  };
});
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../lib/dialog', () => {
  const actual = jest.requireActual('../lib/dialog');
  return { ...actual, dialog: { ...actual.dialog, confirm: jest.fn(async () => true) } };
});

import { api, ApiError } from '../lib/api-client';
import { dialog } from '../lib/dialog';
import { RoleChangeSheet } from '../components/team/RoleChangeSheet';

const STORES: UserBranch[] = [
  { id: 'b1', name: 'Boutique 1', type: 'store', role: 'owner' },
  { id: 'b2', name: 'Boutique 2', type: 'store', role: 'owner' },
  { id: 'b3', name: 'Boutique 3', type: 'store', role: 'owner' },
];

const assignment = (branchId: string, role: string) => ({ branchId, branchName: branchId, role, canDelegate: role === 'store_manager', canDelegateClosing: false, grantedPermissions: [] });

const person = (branches: ReturnType<typeof assignment>[]): TeamUser => ({
  id: 'u-sara',
  name: 'Sara',
  login: 'staff-sara',
  phone: null,
  email: null,
  phoneVerifiedAt: null,
  emailVerifiedAt: null,
  isActive: true,
  status: 'active',
  lastLoginAt: null,
  branches,
  delegatablePermissions: [],
});

async function mount(user: TeamUser, onClose = jest.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
  await render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <RoleChangeSheet user={user} onClose={onClose} />
      </QueryClientProvider>
    </ThemeProvider>,
  );
  await screen.findByRole('switch', { name: 'Boutique 1' });
  return onClose;
}

const checked = (name: string) => screen.getByRole('switch', { name }).props.accessibilityState?.checked;

beforeEach(async () => {
  await useI18n.getState().setLanguage('en');
  (api.get as jest.Mock).mockReset().mockImplementation(async (path: string) => {
    if (path === '/auth/branches') return STORES;
    throw new Error(`unexpected read ${path}`);
  });
  (api.put as jest.Mock).mockReset().mockResolvedValue({ userId: 'u-sara', role: 'store_manager', assignments: [], grantsRemoved: 0 });
  (dialog.confirm as jest.Mock).mockClear();
  useToastStore.setState({ toasts: [] });
});

describe('the role sheet', () => {
  it('an Employee is offered Manager, with the stores they work in chosen; confirming sends the role and the stores', async () => {
    const onClose = await mount(person([assignment('b1', 'store_employee'), assignment('b2', 'store_employee')]));
    expect(screen.getByText(t('team.role.promote'))).toBeTruthy();
    expect(screen.queryByText(t('team.role.demote'))).toBeNull();
    expect(screen.getByText(t('team.role.storesPromote'))).toBeTruthy();
    expect([checked('Boutique 1'), checked('Boutique 2'), checked('Boutique 3')]).toEqual([true, true, false]);

    // The Owner adds a store the person will also manage.
    await fireEvent.press(screen.getByRole('switch', { name: 'Boutique 3' }));
    await act(async () => {
      await fireEvent.press(screen.getByText(t('action.next')));
    });

    expect(dialog.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: t('team.role.promoteTitle', { name: 'Sara' }), message: t('team.role.promoteBody'), confirmLabel: t('team.role.promote') }),
    );
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.put).toHaveBeenCalledWith('/users/u-sara/role', { role: 'store_manager', branchIds: ['b1', 'b2', 'b3'] });
    expect(useToastStore.getState().toasts.map((x) => x.message)).toContain(t('team.role.promoted', { name: 'Sara' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('a Manager is offered Employee, keeping only the stores they manage; confirming sends store_employee', async () => {
    await mount(person([assignment('b1', 'store_manager'), assignment('b2', 'store_employee')]));
    expect(screen.getByText(t('team.role.demote'))).toBeTruthy();
    expect(screen.queryByText(t('team.role.promote'))).toBeNull();
    expect([checked('Boutique 1'), checked('Boutique 2'), checked('Boutique 3')]).toEqual([true, false, false]);

    await act(async () => {
      await fireEvent.press(screen.getByText(t('action.next')));
    });
    expect(dialog.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: t('team.role.demoteTitle', { name: 'Sara' }), message: t('team.role.demoteBody') }));
    expect(api.put).toHaveBeenCalledWith('/users/u-sara/role', { role: 'store_employee', branchIds: ['b1'] });
  });

  it('nothing is sent when the Owner cancels the confirmation, or when no store is chosen', async () => {
    (dialog.confirm as jest.Mock).mockResolvedValueOnce(false);
    await mount(person([assignment('b1', 'store_employee')]));
    await act(async () => {
      await fireEvent.press(screen.getByText(t('action.next')));
    });
    expect(api.put).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('switch', { name: 'Boutique 1' }));
    await act(async () => {
      await fireEvent.press(screen.getByText(t('action.next')));
    });
    expect(api.put).not.toHaveBeenCalled();
    expect(screen.getByText(t('team.create.error.stores'))).toBeTruthy();
  });

  it('a store with no free staff place is said in the app’s words, and the sheet stays open', async () => {
    (api.put as jest.Mock).mockRejectedValueOnce(new ApiError('All staff places are in use.', 409, 'SEAT_LIMIT_REACHED'));
    const onClose = await mount(person([assignment('b1', 'store_employee')]));
    await fireEvent.press(screen.getByRole('switch', { name: 'Boutique 3' }));
    await act(async () => {
      await fireEvent.press(screen.getByText(t('action.next')));
    });
    expect(await screen.findByText(t('team.error.noSeat'))).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
