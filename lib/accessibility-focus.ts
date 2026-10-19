import { AccessibilityInfo, Platform, type View } from 'react-native';

/**
 * Take a screen reader to a view — the unticked consent box a person must fix first.
 *
 * React Native Web has no `sendAccessibilityEvent`: calling it there threw, so a press on Continue with the box
 * unticked ended in an uncaught error. In a browser the element itself takes the focus, and the screen reader follows.
 */
export function focusForScreenReader(view: View | null): void {
  if (!view) return;
  if (Platform.OS === 'web') {
    (view as unknown as { focus?: () => void }).focus?.();
    return;
  }
  AccessibilityInfo.sendAccessibilityEvent(view, 'focus');
}
