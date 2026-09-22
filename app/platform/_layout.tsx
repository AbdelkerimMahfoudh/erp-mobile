import React from 'react';
import { Stack } from 'expo-router';

/**
 * Platform administration — its own stack, its own session, never a shop's.
 *
 * Reached only from a discreet link on the sign-in screen. Each screen inside
 * checks for a platform session and sends the reader to the platform sign-in
 * without one; the tenant auth redirects leave this group alone.
 */
export default function PlatformLayout() {
  return <Stack screenOptions={{ headerShown: true }} />;
}
