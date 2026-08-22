import '../global.css';
import React, { useEffect } from 'react';
import { Platform, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from '../hooks/useAuth';
import { DialogHost, ToastHost } from '../components/overlay';
import { OfflineBanner } from '../components/ui';
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
          {/*
            Mounted once, above every screen. It renders nothing while the
            server is reachable, so it costs no layout in the normal case — and
            when it does appear it pushes content down rather than covering it,
            because a banner that hides what it warns about is worse than none.
          */}
          <OfflineBanner />
          {/*
            The back-swipe is the native stack's own gesture, and on iOS it
            belongs to UINavigationController's push transition. Naming an
            `animation` replaces that transition with a custom one and takes the
            interactive pop gesture with it — the screens still slide, so the app
            looks right while the swipe every iPhone user reaches for does
            nothing. Letting iOS use its own transition is what brings it back.

            Android keeps the explicit slide: it has no edge-swipe to lose, and
            the system back button is unaffected either way.
          */}
          <Stack
            screenOptions={{
              headerShown: false,
              animation: Platform.OS === 'ios' ? 'default' : 'slide_from_right',
              gestureEnabled: true,
            }}
          >
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
