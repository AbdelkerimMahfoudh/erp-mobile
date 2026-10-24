import React from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

/**
 * The edge of a modal, for React's events (2026-10-24).
 *
 * On a phone a `Modal` is its own native root: a tap inside it reaches nothing behind it. On the web react-native-web
 * renders the modal through a React **portal**, and React delivers an event to every ancestor in the *component* tree —
 * so a tap inside a sheet also reached the screen the sheet was opened from. That screen's blank-space handler dismisses
 * the keyboard (`Screen`, `lib/keyboard-dismiss.ts`), which on the web blurs the focused input: tapping a field in a
 * sheet focused it and blurred it again in the same click, and nothing could be typed (Add an account, New team member,
 * every sheet with a field — reproduced in Chromium and WebKit, first seen on an iPhone's Safari).
 *
 * This view stops a click at the modal's edge — after every handler inside the modal has had it — which is exactly what
 * the native root does. Only the click: key events keep travelling, because react-native-web's own Escape-to-close
 * listens on the document, and pointer and touch events are routed by the DOM, which the portal already separates.
 * Elsewhere than the web it is a plain container and changes nothing.
 */
export function ModalBoundary({ children, style }: { children?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[StyleSheet.absoluteFill, style]} {...(Platform.OS === 'web' ? STOP_AT_EDGE : null)}>
      {children}
    </View>
  );
}

/** react-native-web passes `onClick` to the element; React Native's types do not list it. */
const STOP_AT_EDGE = { onClick: (event: { stopPropagation: () => void }) => event.stopPropagation() } as object;
