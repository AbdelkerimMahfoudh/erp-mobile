/// <reference types="jest" />
/**
 * Nothing in the app opens an address outside it (`lib/navigation/no-browser.ts`, installed by the root layout).
 *
 * On a phone every way out reaches React Native's `Linking.openURL`: expo-linking's `openURL` calls it, and
 * expo-router calls that for an external `href`. The preset's native `openURL` is what would reach the phone: before
 * the guard each of the three gets an address there, after it none does — the setup link's shape included — and each
 * is refused. On the web build a new tab opens for the report's own `blob:` page and for nothing else.
 */
import { Linking, Platform } from 'react-native';
import * as ExpoLinking from 'expo-linking';
import { refuseBrowser } from '../lib/navigation/no-browser';

// The real router, not the suite's mock: its external branch is the one a server's value would take.
const router = jest.requireActual('expo-router/build/global-state/router') as { push: (href: string) => void };

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

it('every way out reaches the phone without the guard, and none does with it', async () => {
  const phone = Linking.openURL as jest.Mock;
  await Linking.openURL('https://example.invalid/a');
  await ExpoLinking.openURL('https://example.invalid/b');
  router.push('https://example.invalid/c');
  await settle();
  expect(phone.mock.calls.map(([url]) => url)).toEqual(['https://example.invalid/a', 'https://example.invalid/b', 'https://example.invalid/c']);

  refuseBrowser();
  phone.mockClear();
  await expect(Linking.openURL('https://example.invalid/a')).rejects.toThrow('Dukan ERP opens no address outside the app.');
  await expect(ExpoLinking.openURL('https://example.invalid/account/trial#t=token')).rejects.toThrow('Dukan ERP opens no address outside the app.');
  await expect(ExpoLinking.openURL('tel:+22243210987')).rejects.toThrow('Dukan ERP opens no address outside the app.');

  // expo-router does not wait for the answer, so its refusals are watched here rather than left unhandled.
  const refuse = Linking.openURL;
  const refused = jest.fn((url: string) => refuse(url).catch(() => undefined));
  Linking.openURL = refused;
  router.push('https://example.invalid/c');
  router.push('//example.invalid/d');
  await settle();
  expect(refused.mock.calls).toEqual([['https://example.invalid/c'], ['https://example.invalid/d']]);
  expect(phone).not.toHaveBeenCalled();
});

it('on the web build a new tab opens only for the app’s own blob page', () => {
  const os = Platform.OS;
  const tab = {} as Window;
  const open = jest.fn(() => tab);
  Object.assign(window, { open });
  Platform.OS = 'web';
  try {
    refuseBrowser();
    expect(window.open('blob:https://example.invalid/0d4c-report', '_blank')).toBe(tab);
    expect(window.open('https://example.invalid/account/trial#t=token', '_blank')).toBeNull();
    expect(window.open('//example.invalid', '_blank')).toBeNull();
    const view = window as Window & typeof globalThis;
    expect(view.open('javascript:alert(1)')).toBeNull();
    expect(open.mock.calls).toEqual([['blob:https://example.invalid/0d4c-report', '_blank']]);
  } finally {
    Platform.OS = os;
  }
});
