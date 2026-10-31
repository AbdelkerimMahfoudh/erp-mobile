/// <reference types="jest" />
/**
 * "Discard changes" on the screens where the owner's iPhone froze (2026-10-31): Business settings (the
 * WhatsApp summary language) and a new product. Each real screen runs inside Expo Router's stack with the
 * app's `DialogHost`, as in the app; the server is a stub. After "Discard changes" the dialog layer must be
 * gone, the screen underneath must answer a press, and nothing typed may have been saved.
 */
jest.unmock('expo-router');
import React from 'react';
import { Pressable, Text } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { Stack, router } from 'expo-router';
import { navigationRef } from 'expo-router/build/global-state/navigationRef';
import type { TestInstance } from 'test-renderer';

jest.mock('expo-camera', () => ({
  __esModule: true,
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()],
}));
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
jest.mock('../hooks/useAuth', () => ({ __esModule: true, useAuth: () => ({ user: { id: 'u1', companyId: 'c1', role: 'owner' } }) }));

import { api } from '../lib/api-client';
import { ThemeProvider } from '../lib/design/theme';
import { DialogHost, DISMISS_FALLBACK_MS } from '../components/overlay/DialogHost';
import { useDialogStore } from '../lib/dialog';
import { hasKey, translateIn, useI18n, type Language } from '../lib/i18n';
import { usePermissionStore } from '../lib/permissions';
import { useBranch } from '../lib/branch';
import SettingsScreen from '../app/settings';
import NewProductScreen from '../app/catalog/new';

jest.setTimeout(90_000);

const get = api.get as jest.Mock;
const put = api.put as jest.Mock;
const post = api.post as jest.Mock;
const patch = api.patch as jest.Mock;

const SETTINGS = {
  canManage: true,
  returnWindowHours: 72,
  whatsapp: { language: 'en', includeAmounts: true, dailyEnabled: true, monthlyEnabled: false },
  security: { autoLockMaxSeconds: 300 },
  receivingAccounts: [],
  version: 3,
};
const EARBUDS = {
  id: 'cat-earbuds', key: 'audio.earbuds', name: 'Earbuds', parentId: null, isActive: true,
  defaultTrackingType: 'quantity', allowedTrackingTypes: ['serial', 'quantity'], attributeSchema: [],
};

let underneathPresses = 0;
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

function Home() {
  return (
    <Pressable accessibilityRole="button" onPress={() => (underneathPresses += 1)}>
      <Text>Underneath</Text>
    </Pressable>
  );
}

async function open(path: '/settings' | '/catalog/new') {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await renderRouter(
    {
      _layout: { default: Layout },
      index: { default: Home },
      settings: { default: SettingsScreen },
      'catalog/new': { default: NewProductScreen },
    },
    { initialUrl: '/' },
  );
  jest.useRealTimers();
  await act(async () => router.push(path as never));
  await wait(50);
}

const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const currentRoute = () => (navigationRef.getCurrentRoute() as { name?: string } | undefined)?.name;
const visibleModals = () => screen.container.queryAll((n) => n.type === 'Modal' && n.props.visible !== false);

/** Back, as the header arrow, the swipe and the hardware button all send it. */
const back = () => act(async () => navigationRef.goBack());

function inputFor(label: string): TestInstance {
  let node: TestInstance | null = (screen.getAllByText(label)[0] as unknown as TestInstance).parent;
  while (node) {
    const inputs = node.queryAll((n) => n.type === 'TextInput');
    if (inputs.length > 0) return inputs[0];
    node = node.parent;
  }
  throw new Error(`no input for ${label}`);
}

/** In French or Arabic, none of the question's English words are on screen. */
function expectNoEnglish(lang: Language) {
  if (lang === 'en') return;
  for (const key of ['unsaved.title', 'unsaved.body', 'unsaved.discard', 'unsaved.keep'] as const) {
    expect({ key, english: screen.queryByText(translateIn('en', key)) }).toEqual({ key, english: null });
  }
}

/** After "Discard changes": no question, no modal, the screen underneath answers, and nothing was written. */
async function expectLeftCleanly() {
  await wait(DISMISS_FALLBACK_MS * 2);
  expect(currentRoute()).toBe('index');
  expect(useDialogStore.getState().queue).toHaveLength(0);
  expect(useDialogStore.getState().presented).toBe(false);
  expect(visibleModals()).toHaveLength(0);
  await fireEvent.press(screen.getByText('Underneath'));
  expect(underneathPresses).toBe(1);
  expect(put).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
  expect(patch).not.toHaveBeenCalled();
}

beforeEach(() => {
  jest.clearAllMocks();
  underneathPresses = 0;
  usePermissionStore.setState({ granted: new Set(['settings.manage', 'catalog.manage', 'cost.view']) as never, status: 'ready' } as never);
  useBranch.setState({ branchId: 'b1', branchName: 'Main' } as never);
  get.mockImplementation(async (url: string) => {
    if (url === '/settings') return SETTINGS;
    if (url.startsWith('/categories')) return [EARBUDS];
    if (url.startsWith('/products')) return { rows: [], nextCursor: null };
    return [];
  });
});

afterEach(async () => {
  await act(async () => useDialogStore.setState({ queue: [], presented: false, closeWaiters: [] }));
  await act(async () => useI18n.getState().setLanguage('en'));
});

describe.each<Language>(['en', 'fr', 'ar'])('in %s', (lang) => {
  const say = (key: Parameters<typeof translateIn>[1]) => translateIn(lang, key);

  beforeEach(async () => {
    await act(async () => useI18n.getState().setLanguage(lang));
  });

  it('Business settings: a changed summary language, Back, "Discard changes"', async () => {
    await open('/settings');
    await fireEvent.press(screen.getByText('العربية'));
    await back();
    expect(screen.getByText(say('unsaved.title'))).toBeTruthy();
    expectNoEnglish(lang);
    expect(screen.getByText(say('unsaved.keep'))).toBeTruthy();
    await fireEvent.press(screen.getByText(say('unsaved.discard')));
    await expectLeftCleanly();
  });

  it('A new product: a category and a brand typed, Back, "Discard changes"', async () => {
    await open('/catalog/new');
    const label = (c: { key: string; name: string }) =>
      hasKey(`category.builtin.${c.key}`) ? translateIn(lang, `category.builtin.${c.key}` as never) : c.name;
    await fireEvent.press(screen.getAllByText(say('catalog.form.category.required'))[0]);
    const rows = screen.getAllByText(label(EARBUDS), { exact: false });
    await fireEvent.press(rows[rows.length - 1]);
    // A sheet closed on iOS waits for UIKit's dismissal report; the renderer sends none, so its fallback passes.
    await wait(900);
    await fireEvent.changeText(inputFor(say('catalog.form.brand')), 'Fictiva');
    await back();
    expect(screen.getByText(say('unsaved.title'))).toBeTruthy();
    expectNoEnglish(lang);
    await fireEvent.press(screen.getByText(say('unsaved.discard')));
    await expectLeftCleanly();
  });
});

it('Business settings: "Keep editing" stays with the unsaved language, and Back asks again', async () => {
  await open('/settings');
  await fireEvent.press(screen.getByText('العربية'));
  await back();
  await fireEvent.press(screen.getByText(translateIn('en', 'unsaved.keep')));
  await wait(DISMISS_FALLBACK_MS * 2);
  expect(currentRoute()).toBe('settings');
  expect(visibleModals()).toHaveLength(0);
  // Leaving cleanly keeps this test's guarded screen out of the next one.
  await back();
  await fireEvent.press(screen.getByText(translateIn('en', 'unsaved.discard')));
  await expectLeftCleanly();
});
