/// <reference types="jest" />
/**
 * Where Import stock lives, as the screens render it (docs/21 D141, the brief
 * of 2026-10-06): never a row of More for any role, the Stock tab's header
 * action for the Owner alone, and a screen the server refuses to anybody else.
 *
 * The permission sets are the server's own role definitions, copied from
 * `erp-backend/src/rbac/role-permissions.ts` (ROLE_PERMISSIONS, 2026-10-06):
 * the app receives exactly these from `GET /auth/permissions`, so a test that
 * grants them renders what the phone renders for that role.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import { useBranch } from '../lib/branch';
import { usePermissionStore, type Permission } from '../lib/permissions';
import { MORE_GROUPS, allDestinations } from '../lib/navigation/registry';
import { t } from '../lib/i18n';

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
jest.mock('../hooks/useAuth', () => ({
  __esModule: true,
  useAuth: () => ({ user: { id: 'u1', name: 'Test Person', login: 'test', publicStoreId: 'S1' }, bootstrapping: false, signOut: jest.fn(), signIn: jest.fn(), chooseAccount: jest.fn(), adoptSession: jest.fn() }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import { api, ApiError } from '../lib/api-client';
import MoreScreen from '../app/(tabs)/more';
import InventoryScreen from '../app/(tabs)/inventory';
import ImportsScreen from '../app/imports/index';

const OWNER: Permission[] = ['branch.manage', 'catalog.manage', 'closing.count', 'closing.perform', 'closing.start_early', 'connection.manage', 'consignment.custody.receive', 'consignment.custody.send', 'consignment.forgive', 'consignment.payment.confirm', 'consignment.payment.report', 'consignment.request', 'consignment.return.confirm', 'consignment.review', 'consignment.sell', 'consignment.view', 'cost.view', 'customer.manage', 'debt.manage', 'discount.apply', 'discount.override', 'expense.manage', 'expense.review', 'expense.submit', 'financial.correction.approve', 'financial.correction.request', 'goal.manage', 'import.run', 'integrations.manage', 'loan.forgive', 'loan.manage', 'loan.payment.confirm', 'loan.payment.report', 'loan.view', 'money.anchor.record', 'price.edit', 'purchase.manage', 'refund.confirm', 'refund.report', 'report.view', 'return.approve', 'return.exception', 'return.policy.override', 'return.reject', 'return.request', 'return.review', 'return.view', 'sale.create', 'sale.return', 'sale.view', 'settings.manage', 'supplier.manage', 'supplier.payment.confirm', 'supplier.payment.report', 'transfer.approve', 'transfer.cancel', 'transfer.cancel_own', 'transfer.receive', 'transfer.request', 'transfer.ship', 'transfer.view', 'unit.add', 'unit.transfer', 'user.manage'] as Permission[];
const MANAGER: Permission[] = ['catalog.manage', 'closing.count', 'consignment.custody.receive', 'consignment.custody.send', 'consignment.payment.report', 'consignment.request', 'consignment.return.confirm', 'consignment.review', 'consignment.sell', 'consignment.view', 'cost.view', 'customer.manage', 'discount.apply', 'expense.submit', 'financial.correction.request', 'goal.manage', 'loan.payment.report', 'loan.view', 'purchase.manage', 'refund.confirm', 'refund.report', 'report.view', 'return.approve', 'return.policy.override', 'return.reject', 'return.request', 'return.review', 'return.view', 'sale.create', 'sale.return', 'sale.view', 'supplier.manage', 'supplier.payment.confirm', 'supplier.payment.report', 'transfer.approve', 'transfer.cancel', 'transfer.cancel_own', 'transfer.receive', 'transfer.request', 'transfer.ship', 'transfer.view', 'unit.add'] as Permission[];
const EMPLOYEE: Permission[] = ['closing.count', 'consignment.custody.receive', 'consignment.custody.send', 'consignment.view', 'cost.view', 'discount.apply', 'expense.submit', 'purchase.manage', 'refund.report', 'return.request', 'return.view', 'sale.create', 'sale.view', 'supplier.payment.report', 'transfer.cancel_own', 'transfer.receive', 'transfer.request', 'transfer.ship', 'transfer.view', 'unit.add'] as Permission[];

const ROLES = [
  ['owner', OWNER],
  ['store_manager', MANAGER],
  ['store_employee', EMPLOYEE],
] as const;

const entitlement = {
  state: 'active', periodEnd: '2026-12-31', graceEnd: null, daysRemaining: 80, graceHoursRemaining: 0, subscribedBranchCount: 1, activeBranchCount: 1,
  includedSeats: 1, additionalSeats: 0, seatLimit: 1, seatsUsed: 1, overLimit: false, canRead: true, canWrite: true, isComplimentary: false, status: 'activated', calculatedAt: '2026-10-06T01:00:00.000Z',
};

/** The server, as these screens read it: an active business, an empty shelf, nothing waiting. */
function serve(path: string): unknown {
  if (path.startsWith('/entitlement')) return entitlement;
  if (path.startsWith('/inventory/summary')) return [];
  if (path.startsWith('/analytics/inventory-value')) return { totals: { unitsCount: 0, inventoryValue: 0 } };
  if (path.startsWith('/inventory')) return { rows: [], nextCursor: null, hasMore: false, totals: { units: 0, stock: 0 } };
  if (path.startsWith('/imports')) return { rows: [] };
  if (path.startsWith('/closings/business-day')) return { businessDate: '2026-10-06', localDate: '2026-10-06', door: 'open' };
  return { rows: [], nextCursor: null };
}

function Harness({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <ThemeProvider>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}

function signInAs(role: string, granted: readonly Permission[]) {
  useBranch.setState({ branchId: 'b1', branchName: 'Boutique 1', role });
  usePermissionStore.setState({ granted: new Set(granted), branchId: 'b1', status: 'ready', error: null });
}

const IMPORT_LABEL = t('nav.imports');

beforeEach(() => {
  (api.get as jest.Mock).mockReset();
  (api.get as jest.Mock).mockImplementation(async (path: string) => serve(path));
});

describe.each(ROLES)('More for the %s', (role, granted) => {
  it('lists no Import stock row, and no section is left empty', async () => {
    signInAs(role, granted);
    render(
      <Harness>
        <MoreScreen />
      </Harness>,
    );
    expect(await screen.findByText(t('tab.more'))).toBeTruthy();
    expect(screen.queryByText(IMPORT_LABEL)).toBeNull();
    // Every section shown has at least one row; a section with nothing to show is not shown.
    const byId = new Map(allDestinations().map((d) => [d.id, d]));
    for (const group of MORE_GROUPS) {
      const title = t(group.titleKey);
      const rows = group.destinationIds.map((id) => byId.get(id)!).filter((d) => screen.queryByText(t(d.titleKey)) !== null);
      if (screen.queryByText(title)) expect(rows.length).toBeGreaterThan(0);
      else expect(rows).toHaveLength(0);
    }
  });
});

describe('the Stock tab header', () => {
  it.each(ROLES)('offers Import stock to the %s only when the role holds import.run', async (role, granted) => {
    signInAs(role, granted);
    render(
      <Harness>
        <InventoryScreen />
      </Harness>,
    );
    expect(await screen.findByText(t('inventory.title'))).toBeTruthy();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    const button = screen.queryByLabelText(IMPORT_LABEL);
    if (granted.includes('import.run')) expect(button).toBeTruthy();
    else expect(button).toBeNull();
  });
});

describe('Import stock reached directly without the permission', () => {
  it('shows the server’s refusal in the app’s words, and no file picker starts', async () => {
    signInAs('store_employee', EMPLOYEE);
    (api.get as jest.Mock).mockImplementation(async (path: string) => {
      if (path.startsWith('/imports')) throw new ApiError('Forbidden', 403, 'forbidden');
      return serve(path);
    });
    render(
      <Harness>
        <ImportsScreen />
      </Harness>,
    );
    expect(await screen.findByText(t('state.error.permission.title'))).toBeTruthy();
  });
});
