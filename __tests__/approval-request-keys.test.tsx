/// <reference types="jest" />
/**
 * Each asking has its own key (review MO4-02, 2026-10-16).
 *
 * The approval sheet stays mounted for the life of the Sell tab. It used to make one client key per mount, so the
 * second phone sold below its set price in the same session was asked about under the first phone's key, and the
 * server refused it as a replay with another payload: no request reached the Owner until the app restarted. A key
 * now belongs to the asking — this unit at this price — and a retried tap on the same asking still reuses it.
 *
 * The real sheet; the server is mocked.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import { t } from '../lib/i18n';
import { useConnectivity } from '../lib/connectivity';
import { ApprovalRequestSheet, type ApprovalRequest } from '../components/sell/ApprovalRequestSheet';

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

const phone = (unitId: string, proposedPrice: number): ApprovalRequest => ({
  unitId, label: 'iPhone 13', identifier: '356938035643809', configuredPrice: 30000, proposedPrice, belowCost: false,
});

function sheet(request: ApprovalRequest) {
  return (
    <ApprovalRequestSheet request={request} onClose={() => undefined} onApproved={() => undefined} />
  );
}

beforeEach(() => {
  useConnectivity.setState({ online: true });
  (api.get as jest.Mock).mockReset().mockResolvedValue({ rows: [] });
  (api.post as jest.Mock).mockReset().mockImplementation(async (_p: string, body: { unitId: string }) => ({ id: `r-${body.unitId}`, unitId: body.unitId }));
});

const asked = () => (api.post as jest.Mock).mock.calls.map(([, body]) => body as { unitId: string; requestedPrice: number; clientUuid: string });

it('a second phone asked about in the same session gets its own key; a retried tap keeps it', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
  const wrap = (node: React.ReactElement) => (
    <ThemeProvider>
      <QueryClientProvider client={client}>{node}</QueryClientProvider>
    </ThemeProvider>
  );
  const view = render(wrap(sheet(phone('unit-a', 25000))));
  await act(async () => fireEvent.press(await screen.findByText(t('approval.ask'))));
  await act(async () => fireEvent.press(await screen.findByText(t('approval.ask'))));

  view.rerender(wrap(sheet(phone('unit-b', 26000))));
  await act(async () => fireEvent.press(await screen.findByText(t('approval.ask'))));

  const [a1, a2, b] = asked();
  expect(a1.unitId).toBe('unit-a');
  expect(a2.clientUuid).toBe(a1.clientUuid);
  expect(b.unitId).toBe('unit-b');
  expect(b.clientUuid).not.toBe(a1.clientUuid);
});
