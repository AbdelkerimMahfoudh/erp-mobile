/// <reference types="jest" />
/**
 * Employee ↔ Manager and the Acting Owner, in the app (D225).
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { ThemeProvider } from '../lib/design/theme';
import { t } from '../lib/i18n';

let mockUser: Record<string, unknown> | null = null;
jest.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

import { ActingOwnerBanner } from '../components/ui/ActingOwnerBanner';
import { nextRoleOf, preselectedStores } from '../components/team/RoleChangeSheet';
import { formatDateTime } from '../lib/format';

describe('the role control', () => {
  const employee = { branches: [{ branchId: 'a', branchName: 'A', role: 'store_employee' }, { branchId: 'b', branchName: 'B', role: 'store_employee' }] };
  const manager = { branches: [{ branchId: 'a', branchName: 'A', role: 'store_manager' }, { branchId: 'b', branchName: 'B', role: 'store_employee' }] };

  it('offers Manager to an Employee, with the stores they work in chosen', () => {
    expect(nextRoleOf(employee as never)).toBe('store_manager');
    expect(preselectedStores(employee as never, 'store_manager')).toEqual(['a', 'b']);
  });

  it('offers Employee to a Manager, keeping the stores they manage', () => {
    expect(nextRoleOf(manager as never)).toBe('store_employee');
    expect(preselectedStores(manager as never, 'store_employee')).toEqual(['a']);
  });
});

describe('"Acting as Owner until …"', () => {
  async function mount() {
    return await render(
      <ThemeProvider>
        <ActingOwnerBanner />
      </ThemeProvider>,
    );
  }

  it('shows nothing to anyone not appointed', async () => {
    mockUser = { id: 'u', name: 'A', actingOwner: null };
    await mount();
    expect(screen.queryByText(/./)).toBeNull();
  });

  it('says until when, in words, while the server says the appointment is in force', async () => {
    mockUser = { id: 'u', name: 'A', actingOwner: { delegationId: 'd', until: '2026-11-05T23:59:59.000Z' } };
    await mount();
    expect(screen.getByText(t('actingOwner.banner.until', { date: formatDateTime('2026-11-05T23:59:59.000Z') }))).toBeTruthy();
  });

  it('with no end, says it lasts until the Owner ends it', async () => {
    mockUser = { id: 'u', name: 'A', actingOwner: { delegationId: 'd', until: null } };
    await mount();
    expect(screen.getByText(t('actingOwner.banner.open'))).toBeTruthy();
  });
});
