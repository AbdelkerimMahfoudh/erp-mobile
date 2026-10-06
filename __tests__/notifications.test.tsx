/// <reference types="jest" />
/**
 * Notifications owns its scrolling (docs/21 D143, the brief of 2026-10-06).
 *
 * The LogBox warning "VirtualizedLists should never be nested inside plain
 * ScrollViews" is raised by React Native's own VirtualizedList when it finds a
 * ScrollView of the same orientation above it in the rendered tree. Under
 * jest-expo that code runs unchanged, so the screen is mounted exactly as the
 * app mounts it — its `Screen` wrapper, its loading, error, empty and loaded
 * states — and the test asserts two things: no ancestor of the list is a
 * ScrollView, and React Native raised no such warning. A control test proves
 * the warning IS raised in this environment when the nesting exists, so a
 * silent pass cannot be a mock that swallowed it. Nothing is filtered through
 * LogBox.
 */
import React from 'react';
import { FlatList, ScrollView, Text, View } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import { t } from '../lib/i18n';
import { toFriendlyError } from '../lib/errors';

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

import { api } from '../lib/api-client';
import NotificationsScreen from '../app/notifications';

const NESTING = /VirtualizedLists should never be nested/;
const row = (id: string, isRead = false) => ({
  id,
  type: 'transfer.requested',
  title: `Transfer ${id}`,
  body: 'From the warehouse',
  isRead,
  createdAt: '2026-10-06T01:00:00.000Z',
  readAt: null,
  payload: null,
  actionLink: null,
});

function Harness({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return (
    <ThemeProvider>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}

/** Every ancestor type name of a rendered instance, innermost first. */
function ancestorNames(instance: { parent: unknown }): string[] {
  const names: string[] = [];
  let node = instance.parent as { type?: unknown; parent: unknown } | null;
  while (node) {
    const t = node.type as { displayName?: string; name?: string } | string | undefined;
    if (typeof t === 'string') names.push(t);
    else if (t) names.push(t.displayName ?? t.name ?? 'anonymous');
    node = node.parent as typeof node;
  }
  return names;
}

const isScrollView = (name: string) => /^(RCT)?ScrollView$/.test(name);

describe('Notifications: the list is the only vertical scrolling surface', () => {
  let errors: string[];
  beforeEach(() => {
    errors = [];
    jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '));
    });
    (api.get as jest.Mock).mockReset();
    (api.post as jest.Mock).mockReset();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('control: React Native raises the nesting warning here when a FlatList sits in a same-direction ScrollView', () => {
    render(
      <ScrollView>
        <FlatList data={['a']} keyExtractor={(x) => x} renderItem={({ item }) => <Text>{item}</Text>} />
      </ScrollView>,
    );
    expect(errors.filter((e) => NESTING.test(e))).toHaveLength(1);
  });

  it('loaded with rows: no ScrollView above the list, and no warning', async () => {
    (api.get as jest.Mock).mockResolvedValue({ rows: [row('n1'), row('n2', true)], nextCursor: null });
    render(
      <Harness>
        <NotificationsScreen />
      </Harness>,
    );
    const list = await waitFor(() => screen.UNSAFE_getByType(FlatList));
    expect(await screen.findByText('Transfer n1')).toBeTruthy();
    const above = ancestorNames(list);
    expect(above.filter(isScrollView)).toEqual([]);
    // The page wrapper is there — as a plain view, not a scroller.
    expect(above).toContain('Screen');
    expect(errors.filter((e) => NESTING.test(e))).toEqual([]);
  });

  it('empty: the list renders its empty state itself, still without a ScrollView above it', async () => {
    (api.get as jest.Mock).mockResolvedValue({ rows: [], nextCursor: null });
    render(
      <Harness>
        <NotificationsScreen />
      </Harness>,
    );
    const list = await waitFor(() => screen.UNSAFE_getByType(FlatList));
    expect(ancestorNames(list).filter(isScrollView)).toEqual([]);
    // Translated words, never a raw key.
    expect(await screen.findByText(t('notifications.empty'))).toBeTruthy();
    expect(errors.filter((e) => NESTING.test(e))).toEqual([]);
  });

  it('error: a translated error state with a retry, no list and no warning', async () => {
    const failure = new Error('offline');
    (api.get as jest.Mock).mockRejectedValue(failure);
    render(
      <Harness>
        <NotificationsScreen />
      </Harness>,
    );
    // The same words the screen derives from the failure — never a raw message or a key.
    expect(await screen.findByText(toFriendlyError(failure).title, {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.UNSAFE_queryAllByType(FlatList)).toHaveLength(0);
    expect(errors.filter((e) => NESTING.test(e))).toEqual([]);
  });

  it('tapping an unread row marks it read on the server', async () => {
    (api.get as jest.Mock).mockResolvedValue({ rows: [row('n1')], nextCursor: null });
    (api.post as jest.Mock).mockResolvedValue({});
    render(
      <Harness>
        <NotificationsScreen />
      </Harness>,
    );
    fireEvent.press(await screen.findByText('Transfer n1'));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/notifications/n1/read'));
  });
});

// The structural guard, independent of Notifications: the page wrapper with `scroll={false}` is a View.
describe('Screen with scroll={false}', () => {
  it('mounts its body in a plain View — the branch every self-scrolling list relies on', () => {
    const { Screen } = require('../components/ui/Screen') as typeof import('../components/ui/Screen');
    render(
      <ThemeProvider>
        <Screen scroll={false}>
          <View testID="body" />
        </Screen>
      </ThemeProvider>,
    );
    const body = screen.getByTestId('body');
    expect(ancestorNames(body).filter(isScrollView)).toEqual([]);
  });
});
