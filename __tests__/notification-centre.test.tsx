/// <reference types="jest" />
/**
 * The notification centre (D225): every event in the language the app is set to now, filters by kind, read state
 * marked for everything at once, and the push level one tap away.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import { t, translateIn, useI18n } from '../lib/i18n';

jest.mock('../lib/api-client', () => {
  class ApiError extends Error {
    status = 500;
  }
  return {
    __esModule: true,
    ApiError,
    api: { get: jest.fn(), post: jest.fn(async () => ({ updated: 1 })), patch: jest.fn(), put: jest.fn(), delete: jest.fn() },
    clearSession: jest.fn(),
  };
});

import { api } from '../lib/api-client';
import NotificationsScreen from '../app/notifications';

const ROW = {
  id: 'n1',
  type: 'return.requested',
  title: 'Return requested for 00042',
  body: 'Aminetou asked: screen cracked',
  isRead: false,
  createdAt: '2026-10-29T10:00:00.000Z',
  payload: null,
  actionLink: '/returns/r1',
  category: 'approvals',
};

function Harness({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return (
    <ThemeProvider>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}

beforeEach(() => {
  (api.get as jest.Mock).mockReset().mockImplementation(async (path: string) =>
    path.startsWith('/notifications/preferences')
      ? { level: 'important', isDefault: true, levels: ['all', 'important', 'approvals'] }
      : { rows: [ROW], nextCursor: null, unreadCount: 1 },
  );
  (api.post as jest.Mock).mockClear();
});

afterEach(async () => {
  await act(async () => {
    await useI18n.getState().setLanguage('en');
  });
});

it('an Arabic reader reads the event in Arabic, never the server’s English sentence', async () => {
  await act(async () => {
    await useI18n.getState().setLanguage('ar');
  });
  await render(
    <Harness>
      <NotificationsScreen />
    </Harness>,
  );
  expect(await screen.findByText(translateIn('ar', 'notifications.kind.return.requested'))).toBeTruthy();
  expect(screen.queryByText(ROW.title)).toBeNull();
  expect(screen.queryByText(ROW.body)).toBeNull();
});

it('filters by kind, asking the server for that kind only', async () => {
  await render(
    <Harness>
      <NotificationsScreen />
    </Harness>,
  );
  await screen.findByText(t('notifications.kind.return.requested'));
  await fireEvent.press(screen.getByText(t('notifications.filter.approvals')));
  await waitFor(() => expect((api.get as jest.Mock).mock.calls.some(([p]) => String(p).includes('filter=approvals'))).toBe(true));
});

it('shows the push level, and marks everything read at once', async () => {
  await render(
    <Harness>
      <NotificationsScreen />
    </Harness>,
  );
  expect(await screen.findByText(t('notifications.level.important'))).toBeTruthy();
  await fireEvent.press(screen.getByText(t('notifications.readAll')));
  expect(api.post).toHaveBeenCalledWith('/notifications/read-all');
});
