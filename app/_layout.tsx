import '../global.css';
import React, { useEffect } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from '../hooks/useAuth';
import { DialogHost, ToastHost } from '../components/overlay';
import { useI18n } from '../lib/i18n';
import { colors } from '../lib/design/colors';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
});

export default function RootLayout() {
  const ready = useI18n((s) => s.ready);
  const hydrate = useI18n((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Hold the tree until the language resolves. Rendering first would flash
  // English at an Arabic user, and would mount components before the layout
  // direction is known.
  if (!ready) {
    return <View style={{ flex: 1, backgroundColor: colors.surface.canvas }} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="select-branch" />
            <Stack.Screen name="(tabs)" />
          </Stack>
          {/* Above the navigator so overlays survive screen transitions. */}
          <ToastHost />
          <DialogHost />
        </AuthProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
