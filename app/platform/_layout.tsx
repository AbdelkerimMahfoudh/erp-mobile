import React from 'react';
import { Stack } from 'expo-router';
import { headerBackFor } from '../../components/navigation/HeaderBack';
import { routeOfName } from '../../lib/navigation/back';

/**
 * Platform administration — its own stack, its own session, never a shop's.
 *
 * Reached only from a discreet link on the sign-in screen. Each screen inside
 * checks for a platform session and sends the reader to the platform sign-in
 * without one; the tenant auth redirects leave this group alone. The back arrow
 * is the app's own rule (`lib/navigation/back.ts`); route names here are
 * relative to the group.
 */
export default function PlatformLayout() {
  return (
    <Stack
      screenOptions={({ route, navigation }) => ({
        headerShown: true,
        headerLeft: headerBackFor(
          routeOfName(`platform/${route.name}`),
          route.params as Record<string, unknown> | undefined,
          navigation,
          // The navigator's first screen: no native back button of its own.
          navigation.getState().routes[0]?.key === route.key,
        ),
      })}
    />
  );
}
