/// <reference types="jest" />
/**
 * A later payment on a debt whose answer was lost (review MO3-03).
 *
 * The server may have recorded it. Its key is bound to what was sent, so the
 * only thing that stops the same money being recorded twice is sending the
 * SAME key again — including from a payment screen opened afresh, which is
 * exactly what somebody does after a timeout. And the sale is read again, so
 * the debt on screen is the one the server holds rather than the one before.
 */
import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../lib/api-client', () => {
  class ApiError extends Error {
    status: number;
    code?: string;
    constructor(message: string, status = 500, code?: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
    }
  }
  return {
    __esModule: true,
    ApiError,
    api: { get: jest.fn(async () => null), post: jest.fn(), patch: jest.fn(), put: jest.fn(), delete: jest.fn() },
    clearSession: jest.fn(),
  };
});

import { api, ApiError } from '../lib/api-client';
import { RequestTimeout } from '../lib/offline/classify';
import { qk } from '../lib/query-keys';
import { useRecordSalePayment, type RecordPaymentInput } from '../lib/money-overview';

const SALE = '7d0c2b1e-1111-4a4a-9b9b-000000000001';
const INPUT: RecordPaymentInput = {
  amount: 4000,
  method: 'cash',
  receivingAccountId: null,
  paidAt: null,
  reference: '',
  note: '',
  payerNumber: '',
};
const post = api.post as jest.Mock;
const keyOf = (call: number) => (post.mock.calls[call][1] as { clientUuid: string }).clientUuid;

let client: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

/** One payment screen: mount, send once, settle, leave. */
async function attempt(saleId = SALE) {
  const screen = await renderHook(() => useRecordSalePayment(saleId), { wrapper });
  await act(async () => {
    await screen.result.current.mutateAsync(INPUT).catch(() => undefined);
  });
  await screen.unmount();
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  post.mockReset();
});

it('a lost answer keeps its key for the next payment screen on that sale', async () => {
  post.mockRejectedValueOnce(new RequestTimeout()).mockResolvedValueOnce({ remaining: 6000 });
  await attempt();
  await attempt();
  expect(post).toHaveBeenCalledTimes(2);
  expect(keyOf(1)).toBe(keyOf(0));
});

it('a gateway timeout (504) is a lost answer too', async () => {
  post.mockRejectedValueOnce(new ApiError('Gateway timeout', 504)).mockResolvedValueOnce({ remaining: 6000 });
  await attempt();
  await attempt();
  expect(keyOf(1)).toBe(keyOf(0));
});

it('a lost answer reads the sale again', async () => {
  client.setQueryData(qk.sale(SALE), { id: SALE, balanceDue: 10000 });
  post.mockRejectedValueOnce(new RequestTimeout());
  await attempt();
  expect(client.getQueryState(qk.sale(SALE))?.isInvalidated).toBe(true);
});

it('once the payment is answered, the next one has a key of its own', async () => {
  post
    .mockRejectedValueOnce(new RequestTimeout())
    .mockResolvedValueOnce({ remaining: 6000 })
    .mockResolvedValueOnce({ remaining: 2000 });
  await attempt();
  await attempt();
  await attempt();
  expect(keyOf(1)).toBe(keyOf(0));
  expect(keyOf(2)).not.toBe(keyOf(1));
});

it('a key the server says was used for a different payment is not sent again', async () => {
  post
    .mockRejectedValueOnce(new RequestTimeout())
    .mockRejectedValueOnce(new ApiError('This payment key was already used for a different payment', 409, 'idempotency_key_reused'))
    .mockResolvedValueOnce({ remaining: 2000 });
  await attempt();
  await attempt();
  await attempt();
  expect(keyOf(1)).toBe(keyOf(0));
  expect(keyOf(2)).not.toBe(keyOf(1));
});

it('a refusal is not a lost answer: another sale, or a new screen, starts fresh', async () => {
  post.mockRejectedValueOnce(new ApiError('Too much', 400)).mockResolvedValueOnce({ remaining: 0 });
  await attempt();
  await attempt();
  expect(keyOf(1)).not.toBe(keyOf(0));
});
