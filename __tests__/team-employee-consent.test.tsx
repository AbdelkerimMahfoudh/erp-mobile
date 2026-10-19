/// <reference types="jest" />
/**
 * The Owner's side of an employee's WhatsApp consent (D213): the Owner adds the person, and the WhatsApp code waits
 * for that person's own agreement on their own phone. The Owner can send an email code again, never a WhatsApp one,
 * and is told where the person finishes.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import { t } from '../lib/i18n';
import type { TeamUser } from '../types/api';

jest.mock('../lib/api-client', () => ({
  __esModule: true,
  ApiError: class ApiError extends Error {},
  api: { get: jest.fn(), post: jest.fn(async () => ({ delivery: 'sent' })), patch: jest.fn(), put: jest.fn(), delete: jest.fn() },
  clearSession: jest.fn(),
}));

import { api } from '../lib/api-client';
import { PendingPanel } from '../components/team/PendingPanel';

const FATIMA = {
  id: 'u-fatima',
  name: 'Fatima',
  login: 'staff-x',
  phone: '+22233445566',
  email: 'fatima@shop.test',
  phoneVerifiedAt: null,
  emailVerifiedAt: null,
  isActive: false,
  status: 'pending',
  invitedAt: '2026-10-19T08:00:00.000Z',
  pending: { phone: 'awaiting', email: 'awaiting', seats: [] },
} as unknown as TeamUser;

function renderPanel() {
  render(
    <ThemeProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { gcTime: 0 }, mutations: { gcTime: 0 } } })}>
        <PendingPanel user={FATIMA} onCancelled={() => undefined} />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

it('the number waits for the person’s own agreement — no WhatsApp resend for the Owner; the email code can go again', async () => {
  renderPanel();
  expect(screen.getByText(t('team.pending.delivery.awaitingConsent', { name: 'Fatima' }))).toBeTruthy();
  const resend = screen.getAllByText(t('team.pending.resend'));
  expect(resend).toHaveLength(1);
  fireEvent.press(resend[0]);
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/users/u-fatima/resend-verification', { channel: 'email' }));
  expect((api.post as jest.Mock).mock.calls.some(([, body]) => body?.channel === 'phone')).toBe(false);
});
