import React from 'react';
import { Stack } from 'expo-router';
import { AuthFrame, useAuthStackHeader } from '../../components/auth/AuthChrome';
import { useColors } from '../../lib/design/theme';

export default function AuthLayout() {
  const colors = useColors();
  const header = useAuthStackHeader();
  return (
    <Stack
      /*
        Every authentication route in one centred column (`AuthFrame`): a phone form stays a phone form on a desktop
        browser, and a screen needs no width rule of its own.
      */
      screenLayout={({ children }) => <AuthFrame>{children}</AuthFrame>}
      screenOptions={{
        /*
          One compact header for every route here (`AuthHeader`): the Dukan ERP mark, the way back, and light/dark —
          visible without scrolling on each, sign-in included. A screen sets only its `title`.
        */
        headerShown: true,
        header,
        /*
          Without this the navigator paints its own default background — a
          light grey that sits behind the whole screen and ignores the theme
          entirely. It is the single largest surface in the app, so getting it
          wrong makes dark mode look broken even when every element on top of
          it is correct.
        */
        contentStyle: { backgroundColor: colors.surface.canvas },
      }}
    />
  );
}
