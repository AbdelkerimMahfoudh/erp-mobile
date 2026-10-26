/// <reference types="jest" />
/**
 * A payment report between two stores is sent once (review MO1-10, 2026-10-16).
 *
 * The loan and consignment screens used to send every tap: a second tap while the first was on its way was a second
 * report, and a tap again after a lost answer carried a fresh key, so the server could not tell it was the same one —
 * the other store could confirm both. Now one request at a time leaves a screen, and the same report keeps its key
 * until the server says it is recorded; the next report after that is a new one.
 *
 * The real screens; the server is mocked.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import { useBranch } from '../lib/branch';
import { usePermissionStore, type Permission } from '../lib/permissions';
import { t } from '../lib/i18n';
import type { LoanDetail } from '../lib/loans';
import type { ConsignmentDetail } from '../lib/consignment';

jest.mock('expo-router', () => ({ ...jest.requireActual('./mocks/expo-router'), useLocalSearchParams: () => ({ id: 'x1' }) }));
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

import { api } from '../lib/api-client';
import LoanDetailScreen from '../app/loans/[id]';
import ConsignmentDetailScreen from '../app/consignments/[id]';
import { textInputs } from './tree';

const LOAN = (direction: LoanDetail['direction']): LoanDetail => ({
  id: 'x1', status: 'active', group: 'accepted', statusText: 'Active', direction, otherParty: 'Boutique 3',
  proposedAmount: 8000, counterAmount: null, principal: 8000, remaining: 8000, createdAt: '2026-10-10T09:00:00.000Z', version: 2,
  note: null, disputeReason: null,
  breakdown: { principal: 8000, confirmedPaid: 0, corrected: 0, forgiven: 0, awaitingConfirmation: 0, remaining: 8000 },
  ledger: [{ id: 'e1', kind: 'principal_accepted', amount: 8000, refersToId: null, method: null, accountLabel: null, reference: null, evidenceRef: null, reason: null, date: '2026-10-10T09:00:00.000Z', byMe: false }],
});

const CONSIGNMENT: ConsignmentDetail = {
  id: 'x1', status: 'sold', group: 'accepted', statusText: 'Sold', side: 'destination', otherParty: 'Boutique 2', phones: 1,
  proposedAmount: 30000, counterAmount: null, agreedAmount: 30000, amountIsMutable: false, createdAt: '2026-10-10T09:00:00.000Z', version: 4,
  note: null, disputeReason: null, lines: [],
  ledger: [{ id: 'r1', kind: 'receivable_raised', amount: 30000 } as ConsignmentDetail['ledger'][number]],
};

function Harness({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
  return (
    <ThemeProvider>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}

function signInAs(granted: Permission[]) {
  useBranch.setState({ branchId: 'b1', branchName: 'Boutique 2', role: 'owner' });
  usePermissionStore.setState({ granted: new Set(granted), branchId: 'b1', status: 'ready', error: null });
}

/** Each POST waits until the test answers it. */
let answers: { resolve: (v: unknown) => void; reject: (e: unknown) => void }[] = [];
const posted = () => (api.post as jest.Mock).mock.calls.map(([path, body]) => ({ path: path as string, body: body as Record<string, unknown> }));

beforeEach(() => {
  answers = [];
  (api.post as jest.Mock).mockReset().mockImplementation(() => new Promise((resolve, reject) => answers.push({ resolve, reject })));
});

/** The screen's fields, in order, once its button is there (the money fields carry no label of their own). */
async function fields(button: string) {
  await screen.findByText(button);
  return textInputs();
}

async function pressTwice(title: string) {
  const button = await screen.findByText(title);
  await act(async () => {
    await fireEvent.press(button);
    await fireEvent.press(button);
  });
}

/** Answer the i-th request, then wait until its button is no longer busy: the screen has heard the answer. */
async function answer(i: number, ok: boolean, button: string) {
  await act(async () => {
    if (ok) answers[i].resolve({});
    else answers[i].reject(Object.assign(new Error('The server did not answer in time'), { name: 'RequestTimeout' }));
  });
  await waitFor(() => expect(screen.getByLabelText(button).props.accessibilityState.busy).toBe(false));
}

it('a loan payment report: one request per tap burst, the same key after a lost answer, a new key once recorded', async () => {
  signInAs(['loan.payment.report']);
  (api.get as jest.Mock).mockReset().mockResolvedValue(LOAN('we_owe_them'));
  await render(<Harness><LoanDetailScreen /></Harness>);
  await fireEvent.changeText((await fields(t('loans.reportPayment')))[0], '2000');

  await pressTwice(t('loans.reportPayment'));
  expect(posted()).toHaveLength(1);
  await answer(0, false, t('loans.reportPayment'));

  await pressTwice(t('loans.reportPayment'));
  expect(posted()).toHaveLength(2);
  const [first, again] = posted();
  expect(first.body).toMatchObject({ action: 'report', amount: 2000 });
  expect(again.body.clientUuid).toBe(first.body.clientUuid);
  await answer(1, true, t('loans.reportPayment'));

  await pressTwice(t('loans.reportPayment'));
  expect(posted()).toHaveLength(3);
  expect(posted()[2].body.clientUuid).not.toBe(first.body.clientUuid);
});

it('a loan write-off tapped twice is sent once', async () => {
  signInAs(['loan.forgive']);
  (api.get as jest.Mock).mockReset().mockResolvedValue(LOAN('they_owe_us'));
  await render(<Harness><LoanDetailScreen /></Harness>);
  const [amount, reason] = await fields(t('loans.forgive'));
  await fireEvent.changeText(amount, '1000');
  await fireEvent.changeText(reason, 'They closed the shop');

  await pressTwice(t('loans.forgive'));
  expect(posted().filter((p) => p.path === '/loans/x1/forgive')).toHaveLength(1);
});

it('a consignment payment report carries a key, kept after a lost answer; a write-off tapped twice is sent once', async () => {
  signInAs(['consignment.payment.report']);
  (api.get as jest.Mock).mockReset().mockResolvedValue(CONSIGNMENT);
  const view = await render(<Harness><ConsignmentDetailScreen /></Harness>);
  await fireEvent.changeText((await fields(t('consignment.reportPayment')))[0], '5000');

  await pressTwice(t('consignment.reportPayment'));
  expect(posted()).toHaveLength(1);
  await answer(0, false, t('consignment.reportPayment'));
  await pressTwice(t('consignment.reportPayment'));
  const [first, again] = posted();
  expect(posted()).toHaveLength(2);
  expect(typeof first.body.clientUuid).toBe('string');
  expect(again.body.clientUuid).toBe(first.body.clientUuid);
  await answer(1, true, t('consignment.reportPayment'));
  await view.unmount();

  signInAs(['consignment.forgive']);
  (api.get as jest.Mock).mockResolvedValue({ ...CONSIGNMENT, side: 'source' });
  await render(<Harness><ConsignmentDetailScreen /></Harness>);
  const [amount, reason] = await fields(t('consignment.forgive'));
  await fireEvent.changeText(amount, '1000');
  await fireEvent.changeText(reason, 'Shop closed for good');
  await pressTwice(t('consignment.forgive'));
  expect(posted().filter((p) => p.path === '/consignments/x1/forgive')).toHaveLength(1);
});
