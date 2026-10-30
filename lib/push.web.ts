import type { PushPermission } from './push-policy';

/**
 * Push on the web build (D225): there is none. The web export is a browser page, and alerts reach the iPhone app only,
 * so expo-notifications — and the libraries it brings for a browser — stays out of the web bundle. Every call answers
 * "unsupported" and does nothing. The native module is `lib/push.ts`; both export the same names.
 */

export const pushSupported = false;
export interface PushTap {
  identifier: string;
  data: unknown;
}
export const pushPermission = async (): Promise<PushPermission> => 'unsupported';
export const askPushPermission = async (): Promise<PushPermission> => 'unsupported';
export const pushDeclined = async (): Promise<boolean> => false;
export const rememberPushDeclined = async (): Promise<void> => undefined;
export const registerThisPhone = async (_userId: string, _language: string): Promise<void> => undefined;
export const unregisterThisPhone = async (): Promise<void> => undefined;
export const launchedByPush = (): PushTap | null => null;
export const forgetLaunchPush = (): void => undefined;
export const onPushTapped = (_listener: (tap: PushTap) => void): (() => void) => () => undefined;
export const onPushArrived = (_listener: () => void): (() => void) => () => undefined;
export const onPushTokenRotated = (_listener: () => void): (() => void) => () => undefined;
