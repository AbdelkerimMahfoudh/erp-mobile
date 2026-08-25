import React from 'react';
import { Stack } from 'expo-router';
import { useColors } from '../../lib/design/theme';

export default function AuthLayout() {
  const colors = useColors();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
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
