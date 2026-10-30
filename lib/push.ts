import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { api } from './api-client';
import { deleteItem, getItem, setItem } from './storage';
import { pushLocale, registrationNeeded, type PushPermission } from './push-policy';

/**
 * Push on this phone (D225): the one module that speaks to expo-notifications.
 *
 * The phone is registered with the server after sign-in and whenever its token, its person or its language changes;
 * it is unregistered when the person signs out, so a counter phone handed to somebody else stops receiving the first
 * person's events at once. The token is the installation's, not a secret: it can only receive. It is kept here so that
 * a rotated token can name the one it replaces, and signing out can name the one to stop.
 *
 * Whether push is SENT is the server's decision (`PUSH_CHANNEL`, disabled by default): a registered phone of a server
 * with push disabled simply receives nothing.
 */

const TOKEN_KEY = 'erp.push.registration';
const DECLINED_KEY = 'erp.push.declined';

/** iPhone and Android builds only: the web export and the tests have no push. */
export const pushSupported = Platform.OS === 'ios' || Platform.OS === 'android';

if (pushSupported) {
  // In the foreground: a banner and the list, no sound, no badge — the centre's count is the badge that matters.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

export async function pushPermission(): Promise<PushPermission> {
  if (!pushSupported) return 'unsupported';
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
  } catch {
    return 'unsupported';
  }
}

/** iOS's own prompt — only ever after the app's explanation, from a tap on "Enable notifications". */
export async function askPushPermission(): Promise<PushPermission> {
  if (!pushSupported) return 'unsupported';
  const { status } = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } });
  return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
}

export async function pushDeclined(): Promise<boolean> {
  return (await getItem(DECLINED_KEY)) === '1';
}

export async function rememberPushDeclined(): Promise<void> {
  await setItem(DECLINED_KEY, '1');
}

type Registration = { token: string; userId: string; locale: string };

async function stored(): Promise<Registration | null> {
  try {
    const raw = await getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as Registration) : null;
  } catch {
    return null;
  }
}

/** This installation's Expo push token, under the app's own EAS project; null where there is none (a simulator). */
async function expoToken(): Promise<string | null> {
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  if (!projectId) return null;
  try {
    return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch {
    return null;
  }
}

/**
 * Register this phone for the signed-in person, in the language the app is set to. Only with permission granted;
 * idempotent, and skipped when nothing changed since the last registration.
 */
export async function registerThisPhone(userId: string, language: string): Promise<void> {
  if ((await pushPermission()) !== 'granted') return;
  const token = await expoToken();
  if (!token) return;
  const before = await stored();
  const now = { token, userId, locale: pushLocale(language) };
  if (!registrationNeeded(before, now)) return;
  await api.post('/notifications/devices', {
    token,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    locale: now.locale,
    // A rotated token of the same person's: the server stops pushing to the old one in the same call.
    ...(before && before.token !== token && before.userId === userId ? { replaces: before.token } : {}),
  });
  await setItem(TOKEN_KEY, JSON.stringify(now));
}

/** What a tapped push reports: its own identifier (one per tap) and the data the server put in it. */
export interface PushTap {
  identifier: string;
  data: unknown;
}

const tapOf = (response: Notifications.NotificationResponse | null): PushTap | null =>
  response ? { identifier: response.notification.request.identifier, data: response.notification.request.content.data } : null;

/** The tap that launched the app from closed, if any. */
export function launchedByPush(): PushTap | null {
  return pushSupported ? tapOf(Notifications.getLastNotificationResponse()) : null;
}

/** Forget the launching tap once it has been opened. */
export function forgetLaunchPush(): void {
  if (pushSupported) void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
}

/** A push tapped while the app runs (foreground or background). Returns the unsubscribe. */
export function onPushTapped(listener: (tap: PushTap) => void): () => void {
  if (!pushSupported) return () => undefined;
  const sub = Notifications.addNotificationResponseReceivedListener((r) => listener(tapOf(r)!));
  return () => sub.remove();
}

/** A push arriving with the app open. */
export function onPushArrived(listener: () => void): () => void {
  if (!pushSupported) return () => undefined;
  const sub = Notifications.addNotificationReceivedListener(() => listener());
  return () => sub.remove();
}

/** The platform rotated this installation's token. */
export function onPushTokenRotated(listener: () => void): () => void {
  if (!pushSupported) return () => undefined;
  const sub = Notifications.addPushTokenListener(() => listener());
  return () => sub.remove();
}

/** Signing out: nothing more is pushed to this phone for this person. Called while the session is still valid. */
export async function unregisterThisPhone(): Promise<void> {
  const before = await stored();
  if (!before) return;
  try {
    await api.delete('/notifications/devices', { token: before.token });
  } finally {
    // Forgotten either way: the next person to sign in registers afresh, and the server moves the token to them.
    await deleteItem(TOKEN_KEY);
  }
}
