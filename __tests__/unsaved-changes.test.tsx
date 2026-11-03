/// <reference types="jest" />
/**
 * Leaving a form with unsaved changes (the 2026-10-31 freeze).
 *
 * On the owner's iPhone, "Discard changes" on Business settings and on a new product returned to the
 * previous screen and then nothing could be touched. Two faults made it: the guard replayed the
 * blocked exit with the screen still marked dirty, which this router blocks again (a second question,
 * presented while the first modal was still going away — invisible, and over every touch); and the
 * exit ran in the same tick as the dialog's modal was taken down, popping the screen it was presented
 * from.
 *
 * These run the real pieces together — Expo Router's stack, the app's `DialogHost` and the shared
 * `useUnsavedChangesGuard` — and prove the outcome a person feels: after "Discard changes" no dialog
 * layer is left, and a button on the screen underneath answers a press.
 */
jest.unmock('expo-router');
import React, { useRef, useState } from 'react';
import { Pressable, Text } from 'react-native';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { Stack, router } from 'expo-router';
import { navigationRef } from 'expo-router/build/global-state/navigationRef';
import { ThemeProvider } from '../lib/design/theme';
import { DialogHost, DISMISS_FALLBACK_MS } from '../components/overlay/DialogHost';
import { useDialogStore } from '../lib/dialog';
import { translateIn, useI18n, type Language } from '../lib/i18n';

const setLanguage = (lang: Language) => useI18n.getState().setLanguage(lang);
import { useUnsavedChangesGuard } from '../lib/navigation/unsaved-changes';

declare const __dirname: string;
const { readFileSync } = require('fs') as { readFileSync(p: string, e: 'utf8'): string };

jest.setTimeout(60_000);

const saved: string[] = [];
let underneathPresses = 0;

function Layout() {
  return (
    <ThemeProvider>
      <Stack />
      <DialogHost />
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

/** A form shaped like Business settings: a draft against saved values, reset on discard. */
function Form() {
  const [value, setValue] = useState('en');
  const bypass = useRef(false);
  useUnsavedChangesGuard({ dirty: value !== 'en', onDiscard: () => setValue('en'), bypass });
  return (
    <>
      <Text>{`value:${value}`}</Text>
      <Pressable accessibilityRole="button" onPress={() => setValue('ar')}>
        <Text>Change</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          saved.push(value);
          bypass.current = true;
          navigationRef.goBack();
        }}
      >
        <Text>Save</Text>
      </Pressable>
    </>
  );
}

async function openForm() {
  await renderRouter({ _layout: { default: Layout }, index: { default: Home }, form: { default: Form } }, { initialUrl: '/' });
  // `renderRouter` moves to fake timers; the dialog host's dismissal is timed on real ones here.
  jest.useRealTimers();
  // A real stack under the form, as when it is opened from More.
  await act(async () => router.push('/form' as never));
}

/** Modals in the tree that are showing. */
const visibleModals = () => screen.container.queryAll((n) => n.type === 'Modal' && n.props.visible !== false);

/** The header arrow, the swipe and the hardware button all dispatch this one action. */
async function back() {
  await act(async () => navigationRef.goBack());
}

/** Lets the host finish taking its modal down, as iOS reports `onDismiss` (or the fallback fires). */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, DISMISS_FALLBACK_MS * 2));
  });
}

const currentRoute = () => (navigationRef.getCurrentRoute() as { name?: string } | undefined)?.name;

beforeEach(() => {
  saved.length = 0;
  underneathPresses = 0;
});

afterEach(async () => {
  await act(async () => useDialogStore.setState({ queue: [], presented: false, closeWaiters: [] }));
  await act(async () => setLanguage('en'));
});

describe.each<Language>(['en', 'fr', 'ar'])('the unsaved-changes guard in %s', (lang) => {
  const say = (key: Parameters<typeof translateIn>[1]) => translateIn(lang, key);

  beforeEach(async () => {
    await act(async () => setLanguage(lang));
  });

  it('asks in the app language, and "Keep editing" leaves the form and its draft untouched', async () => {
    await openForm();
    await fireEvent.press(screen.getByText('Change'));
    await back();

    expect(screen.getByText(say('unsaved.title'))).toBeTruthy();
    expect(screen.getByText(say('unsaved.body'))).toBeTruthy();
    expect(screen.getByText(say('unsaved.discard'))).toBeTruthy();
    await fireEvent.press(screen.getByText(say('unsaved.keep')));
    await settle();

    expect(currentRoute()).toBe('form');
    expect(screen.getByText('value:ar')).toBeTruthy();
    expect(visibleModals()).toHaveLength(0);

    // Asked again, it still asks — and leaving cleanly keeps one test's guarded screen out of the next.
    await back();
    await fireEvent.press(screen.getByText(say('unsaved.discard')));
    await settle();
    expect(currentRoute()).toBe('index');
  });

  it('"Discard changes" leaves once, leaves no dialog layer, and the screen underneath answers', async () => {
    await openForm();
    await fireEvent.press(screen.getByText('Change'));
    await back();
    await fireEvent.press(screen.getByText(say('unsaved.discard')));
    await settle();

    expect(currentRoute()).toBe('index');
    expect(useDialogStore.getState().queue).toHaveLength(0);
    expect(useDialogStore.getState().presented).toBe(false);
    expect(visibleModals()).toHaveLength(0);
    expect(screen.queryByText(say('unsaved.title'))).toBeNull();
    await fireEvent.press(screen.getByText('Underneath'));
    expect(underneathPresses).toBe(1);
    expect(saved).toEqual([]);
  });

  it('open, change, Discard, three times over: each time the question, each time out, never a layer left behind', async () => {
    for (let round = 0; round < 3; round++) {
      await openForm();
      // The discarded value never comes back: each visit starts from what is saved.
      expect(screen.getByText('value:en')).toBeTruthy();
      await fireEvent.press(screen.getByText('Change'));
      await back();
      expect(screen.getByText(say('unsaved.title'))).toBeTruthy();
      await fireEvent.press(screen.getByText(say('unsaved.discard')));
      await settle();
      expect(currentRoute()).toBe('index');
      expect(visibleModals()).toHaveLength(0);
      expect(useDialogStore.getState().presented).toBe(false);
    }
    await fireEvent.press(screen.getByText('Underneath'));
    expect(underneathPresses).toBe(1);
    expect(saved).toEqual([]);
  });
});

describe('the dialog in Arabic', () => {
  it('lays out by the language’s direction: no physical left or right in the host that draws it', () => {
    const host = readFileSync('components/overlay/DialogHost.tsx', 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(host).not.toMatch(/marginLeft|marginRight|paddingLeft|paddingRight|textAlign: 'left'|textAlign: 'right'|\bleft:|\bright:/);
  });
});

describe('the unsaved-changes guard under pressure', () => {
  it('asks once however many times Back is pressed', async () => {
    await openForm();
    await fireEvent.press(screen.getByText('Change'));
    await back();
    await back();
    await back();
    expect(useDialogStore.getState().queue).toHaveLength(1);
    await fireEvent.press(screen.getByText(translateIn('en', 'unsaved.discard')));
    await settle();
    expect(currentRoute()).toBe('index');
    expect(useDialogStore.getState().queue).toHaveLength(0);
  });

  it('a deliberate exit after saving passes without asking', async () => {
    await openForm();
    await fireEvent.press(screen.getByText('Change'));
    await fireEvent.press(screen.getByText('Save'));
    await settle();
    expect(saved).toEqual(['ar']);
    expect(currentRoute()).toBe('index');
    expect(useDialogStore.getState().queue).toHaveLength(0);
  });

  it('a clean form leaves without a question', async () => {
    await openForm();
    await back();
    expect(currentRoute()).toBe('index');
    expect(useDialogStore.getState().queue).toHaveLength(0);
  });
});

describe('every guarded form uses the shared guard', () => {
  const source = (path: string) => readFileSync(`${__dirname}/../${path}`, 'utf8');

  it.each(['app/settings.tsx', 'components/catalog/ProductForm.tsx'])('%s', (path) => {
    expect(source(path)).toContain('useUnsavedChangesGuard(');
    expect(source(path)).not.toContain('usePreventRemove');
  });

  it('no guard replays a blocked exit with prevention still on', () => {
    for (const path of ['app/settings.tsx', 'components/catalog/ProductForm.tsx', 'app/(auth)/register.tsx']) {
      expect({ path, replay: source(path).includes('dispatch(data.action)') }).toEqual({ path, replay: false });
    }
    expect(source('app/(auth)/register.tsx')).toContain('dialog.afterClose().then(() => steps.release(repeat))');
  });

  it('the product screens hand their deliberate exits to the guard', () => {
    expect(source('app/catalog/new.tsx')).toContain('allowLeaveRef={leaving}');
    expect(source('app/catalog/edit.tsx')).toContain('allowLeaveRef={leaving}');
  });
});

describe('the question is translated, never English in French or Arabic', () => {
  const keys = ['unsaved.title', 'unsaved.body', 'unsaved.discard', 'unsaved.keep'] as const;

  it.each(keys)('%s', (key) => {
    expect(translateIn('fr', key)).not.toBe(translateIn('en', key));
    expect(translateIn('ar', key)).not.toBe(translateIn('en', key));
    expect(translateIn('ar', key)).toMatch(/[؀-ۿ]/);
    expect(translateIn('ar', key)).not.toMatch(/[A-Za-z]/);
  });

  it('the per-screen copies it replaced are gone, so no screen can drift back to its own wording', () => {
    for (const lang of ['en', 'fr', 'ar'] as const) {
      expect(translateIn(lang, 'unsaved.discard')).toBeTruthy();
    }
    const en = readFileSync(`${__dirname}/../lib/i18n/en.ts`, 'utf8');
    expect(en).not.toMatch(/'(settings|catalog\.form)\.unsaved\./);
  });
});
