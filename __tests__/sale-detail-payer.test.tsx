/// <reference types="jest" />
/**
 * The payer number on the saved sale (docs/21 D151): read back under the
 * payment it belongs to, apart from the transfer's reference, never on cash —
 * shown to whoever may read the sale's payments (the same as the reference),
 * and correctable only by whoever may request a money correction.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import { useBranch } from '../lib/branch';
import { usePermissionStore, type Permission } from '../lib/permissions';
import { t } from '../lib/i18n';
import type { SaleDetail } from '../types/api';

jest.mock('expo-router', () => ({ ...jest.requireActual('./mocks/expo-router'), useLocalSearchParams: () => ({ id: 's1' }) }));
jest.mock('../lib/api-client', () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status = 500) {
      super(message);
      this.status = status;
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
  useAuth: () => ({ user: { id: 'u1', name: 'Owner Boutique 1', login: 'owner', publicStoreId: 'S1' }, bootstrapping: false, signOut: jest.fn(), signIn: jest.fn(), chooseAccount: jest.fn(), adoptSession: jest.fn() }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import { api } from '../lib/api-client';
import SaleDetailScreen from '../app/sales/[id]';

const SALE: SaleDetail = {
  id: 's1',
  invoiceNo: '00077',
  soldAt: '2026-10-07T03:00:00.000Z',
  branch: { id: 'b1', name: 'Boutique 1' },
  soldBy: 'Owner Boutique 1',
  customer: null,
  debtor: null,
  subtotal: 1500,
  discount: 0,
  taxTotal: 0,
  total: 1500,
  amountPaid: 1500,
  balanceDue: 0,
  payStatus: 'paid',
  dueDate: null,
  isReversed: false,
  cancellation: null,
  lines: [{ id: 'l1', unitId: 'u1', imei: '490154203237518', imeiSecondary: null, serialNo: null, product: 'Apple iPhone 13', barcode: null, trackingType: 'imei', quantity: 1, price: 1500, discount: 0, taxAmount: 0, voided: false }],
  payments: [
    { id: 'p-cash', kind: 'at_sale', method: 'cash', amount: 500, paidAt: '2026-10-07T03:00:00.000Z', reference: null, note: null, accountLabel: null, accountProvider: null, payerNumber: null, recordedBy: 'Owner Boutique 1' },
    { id: 'p-bankily', kind: 'at_sale', method: 'mobile', amount: 1000, paidAt: '2026-10-07T03:00:00.000Z', reference: 'TX-778', note: null, accountLabel: 'Bankily Main', accountProvider: 'bankily', payerNumber: '+22236123456', recordedBy: 'Owner Boutique 1' },
  ],
  returnPolicy: { windowHours: 0, deadlineAt: null, eligible: false, reason: 'no_return_policy', remainingMs: null, requiresOwnerException: false },
};

function Harness({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <ThemeProvider>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}

function signInAs(granted: Permission[]) {
  useBranch.setState({ branchId: 'b1', branchName: 'Boutique 1', role: 'owner' });
  usePermissionStore.setState({ granted: new Set(granted), branchId: 'b1', status: 'ready', error: null });
}

const PAYER_LINE = /\+22236123456/;

beforeEach(() => {
  (api.get as jest.Mock).mockReset();
  (api.post as jest.Mock).mockReset();
  (api.get as jest.Mock).mockImplementation(async (path: string) => (path.startsWith('/sales/s1') ? SALE : {}));
  (api.post as jest.Mock).mockImplementation(async () => ({ id: 's1', invoiceNo: '00077', total: 1500, received: 1500, remaining: 0, payStatus: 'paid', payments: SALE.payments }));
});

it('shows the payer number under its own payment, apart from the reference, and never on cash', async () => {
  signInAs(['sale.view', 'sale.create'] as Permission[]);
  render(
    <Harness>
      <SaleDetailScreen />
    </Harness>,
  );
  const payer = await screen.findByText(PAYER_LINE);
  expect(payer.props.children).toEqual(expect.stringContaining(t('saleDetail.history.payer', { number: '' }).trim()));
  expect(screen.getByText(t('saleDetail.history.ref', { reference: 'TX-778' }))).toBeTruthy();
  // One payer line in all: the Bankily payment's. The cash payment has none.
  expect(screen.getAllByText(PAYER_LINE)).toHaveLength(1);
  // Read by whoever reads the sale; corrected only by whoever may request a money correction.
  expect(screen.queryByText(t('saleDetail.payer.correct'))).toBeNull();
});

it('the Owner and the Store Manager may correct it — on the non-cash payment only — and only the number is sent', async () => {
  signInAs(['sale.view', 'sale.create', 'financial.correction.request'] as Permission[]);
  render(
    <Harness>
      <SaleDetailScreen />
    </Harness>,
  );
  await screen.findByText(PAYER_LINE);
  const actions = screen.getAllByText(t('saleDetail.payer.correct'));
  expect(actions).toHaveLength(1);
  fireEvent.press(actions[0]);
  expect(await screen.findByText(t('saleDetail.payer.body'))).toBeTruthy();
  const field = screen.getByLabelText(t('sell.payment.payerNumber'));
  expect(field.props.value).toBe('+22236123456');
  fireEvent.changeText(field, '36 99-99-99');
  fireEvent.press(screen.getByText(t('saleDetail.payer.save')));
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  expect(api.post).toHaveBeenCalledWith('/sales/s1/payments/p-bankily/payer-number', { payerNumber: '36999999' });
});
