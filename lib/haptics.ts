import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/**
 * Haptic vocabulary.
 *
 * A shop is loud and the employee is often looking at the customer, not the
 * screen. Touch is the fastest confirmation channel we have — a scan that
 * "buzzes right" is understood before it is read.
 *
 * Kept to four meanings on purpose. Haptics that fire for everything stop
 * meaning anything.
 */

const supported = Platform.OS === 'ios' || Platform.OS === 'android';

function safely(run: () => Promise<void>): void {
  if (!supported) return;
  // Never let a missing motor break a flow — feedback is an enhancement.
  void run().catch(() => {});
}

export const haptics = {
  /** A scan landed, an item joined the cart, a sale went through. */
  success: () => safely(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),

  /** Allowed, but worth a second look — below cost, unusual discount. */
  warning: () => safely(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),

  /** Blocked — duplicate IMEI, already sold, out of stock. */
  error: () => safely(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),

  /** Ordinary contact: a selection changed, a sheet opened. */
  tap: () => safely(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
};
