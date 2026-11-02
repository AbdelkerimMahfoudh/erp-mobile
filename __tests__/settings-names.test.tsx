/// <reference types="jest" />
/**
 * Business settings is the one place for the business's and stores' names and for the return policy (2026-10-31).
 *
 * More no longer lists "Business and store names" (it answered "Invalid query parameters", in English, under an
 * Arabic screen) nor "Return policy". These run the real screens inside Expo Router's stack: each name reaches the
 * right API, a refused request reads in the app's language, the old address opens Business settings, and someone who
 * edits returns but is not the Owner still reaches the policy from Business settings.
 */
jest.unmock('expo-router');
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { Stack, router } from 'expo-router';
import { navigationRef } from 'expo-router/build/global-state/navigationRef';
import type { TestInstance } from 'test-renderer';

jest.mock('../lib/api-client', () => {
  class ApiError extends Error {
    status: number;
    code: string | null;
    constructor(message: string, status = 500, code: string | null = null) {
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
  useAuth: () => ({ user: { id: 'u1', companyId: 'c1' }, refreshUser: jest.fn(async () => undefined) }),
}));

import { ApiError, api } from '../lib/api-client';
import { ThemeProvider } from '../lib/design/theme';
import { DialogHost } from '../components/overlay/DialogHost';
import { translateIn, useI18n, type Language } from '../lib/i18n';
import { usePermissionStore } from '../lib/permissions';
import { useBranch } from '../lib/branch';
import SettingsScreen from '../app/settings';
import NamesRedirect from '../app/names';
import ReturnPolicyScreen from '../app/return-policy';

jest.setTimeout(90_000);

const get = api.get as jest.Mock;
const patch = api.patch as jest.Mock;

const SETTINGS = {
  canManage: true,
  returnWindowHours: 72,
  whatsapp: { language: 'en', includeAmounts: true, dailyEnabled: true, monthlyEnabled: false },
  security: { autoLockMaxSeconds: 300 },
  receivingAccounts: [],
  version: 3,
};
const NAMES = {
  business: { name: 'Boutique Kiffa', nameAr: null, nameIncomplete: true },
  stores: [{ id: '00000000-0000-7000-8000-000000000002', name: 'Centre', nameAr: 'الوسط', nameIncomplete: false }],
};

let client: QueryClient;

function Layout() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <Stack />
        <DialogHost />
      </QueryClientProvider>
    </ThemeProvider>
  );
}

async function open(url: string) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await renderRouter(
    {
      _layout: { default: Layout },
      index: { default: () => null },
      settings: { default: SettingsScreen },
      names: { default: NamesRedirect },
      'return-policy': { default: ReturnPolicyScreen },
    },
    { initialUrl: '/' },
  );
  jest.useRealTimers();
  await act(async () => router.push(url as never));
  await wait(100);
}

const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const currentRoute = () => (navigationRef.getCurrentRoute() as { name?: string } | undefined)?.name;

function inputFor(label: string): TestInstance {
  let node: TestInstance | null = (screen.getAllByText(label)[0] as unknown as TestInstance).parent;
  while (node) {
    const inputs = node.queryAll((n) => n.type === 'TextInput');
    if (inputs.length > 0) return inputs[0];
    node = node.parent;
  }
  throw new Error(`no input for ${label}`);
}

function grant(perms: string[]) {
  usePermissionStore.setState({ granted: new Set(perms) as never, status: 'ready' } as never);
}

beforeEach(() => {
  jest.clearAllMocks();
  grant(['settings.manage', 'branch.manage', 'return.policy.edit']);
  useBranch.setState({ branchId: 'b1', branchName: 'Centre' } as never);
  get.mockImplementation(async (url: string) => {
    if (url === '/settings') return SETTINGS;
    if (url === '/business/names') return NAMES;
    if (url === '/return-policy') return { windowHours: 72, texts: {}, version: 1 };
    return [];
  });
  patch.mockImplementation(async (_url: string, body: Record<string, string>) => ({ name: body.name ?? 'x', nameAr: body.nameAr ?? null, nameIncomplete: false }));
});

afterEach(async () => {
  await act(async () => useI18n.getState().setLanguage('en'));
});

describe('the names, in Business settings', () => {
  it('the business name and each store, and nothing asks for an Arabic name', async () => {
    await open('/settings');
    expect(await screen.findByText('Boutique Kiffa')).toBeTruthy();
    expect(screen.getByText(translateIn('en', 'names.screen.title'))).toBeTruthy();
    expect(screen.getByText('Centre')).toBeTruthy();
    expect(screen.queryByText('Arabic name missing')).toBeNull();
  });

  it('the business\'s Arabic name goes to the business, and only what changed is sent', async () => {
    await open('/settings');
    await fireEvent.press(await screen.findByText('Boutique Kiffa'));
    await fireEvent.changeText(inputFor(translateIn('en', 'names.field.arabic')), 'بوتيك كيفة');
    await fireEvent.press(screen.getByText(translateIn('en', 'action.save')));
    await wait(50);
    expect(patch).toHaveBeenCalledWith('/business/names', { nameAr: 'بوتيك كيفة' });
  });

  it('a store\'s Latin name goes to that store', async () => {
    await open('/settings');
    await fireEvent.press(await screen.findByText('Centre'));
    await fireEvent.changeText(inputFor(translateIn('en', 'names.field.latin')), 'Centre Ville');
    await fireEvent.press(screen.getByText(translateIn('en', 'action.save')));
    await wait(50);
    expect(patch).toHaveBeenCalledWith(`/branches/${NAMES.stores[0].id}/names`, { name: 'Centre Ville' });
  });

  it.each<Language>(['ar', 'fr'])('a refused read says so in %s, never in the server\'s English, and the rest of settings works', async (lang) => {
    await act(async () => useI18n.getState().setLanguage(lang));
    get.mockImplementation(async (url: string) => {
      if (url === '/settings') return SETTINGS;
      if (url === '/business/names') throw new ApiError('Invalid query parameters', 400);
      return [];
    });
    await open('/settings');
    expect(screen.queryByText(/Invalid query parameters/)).toBeNull();
    expect((await screen.findAllByText(translateIn(lang, 'state.error.body'))).length).toBeGreaterThan(0);
    expect(screen.getByText(translateIn(lang, 'settings.whatsapp.language'))).toBeTruthy();
  });
});

describe('the old address and More', () => {
  it('/names, from a bookmark or a link, opens Business settings', async () => {
    await open('/names');
    await wait(100);
    expect(currentRoute()).toBe('settings');
    expect(screen.getByText(translateIn('en', 'names.screen.title'))).toBeTruthy();
  });

  it('someone who edits returns but is not the Owner sees only Returns in Business settings, and reaches the policy', async () => {
    grant(['return.policy.edit']);
    get.mockImplementation(async (url: string) => {
      if (url === '/settings') return { canManage: false };
      if (url === '/return-policy') return { windowHours: 72, texts: {}, version: 1 };
      return [];
    });
    await open('/settings');
    expect(screen.queryByText(translateIn('en', 'names.screen.title'))).toBeNull();
    expect(screen.queryByText(translateIn('en', 'settings.whatsapp.language'))).toBeNull();
    await fireEvent.press(screen.getByText(translateIn('en', 'nav.returnPolicy')));
    await wait(100);
    expect(currentRoute()).toBe('return-policy');
  });
});
