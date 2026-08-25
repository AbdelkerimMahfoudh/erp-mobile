import '../global.css';
import React, { useEffect } from 'react';
import { Platform, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider } from '../hooks/useAuth';
import { DialogHost, ToastHost } from '../components/overlay';
import { OfflineBanner } from '../components/ui';
import { useI18n } from '../lib/i18n';
import { ThemeProvider, useColors, useTheme } from '../lib/design/theme';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
});

/*
 * Keep the native splash up until we know what the app should look like.
 *
 * Both the language and the theme are read from async storage, so there is a
 * real gap between the first frame being possible and it being *correct*.
 * Without this the app paints a light screen, then flips to dark a moment
 * later — the flash the brief rules out. Holding the splash is the only way to
 * have no frame at all rather than a wrong one.
 *
 * Failures are swallowed: on web there is no native splash, and an app that
 * refused to start because it could not hide a splash screen would be a far
 * worse bug than the flash this prevents.
 */
void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
}

/**
 * Everything below the theme, so it may read the palette.
 *
 * Split out because `useColors` has to run inside `ThemeProvider`, and a
 * provider cannot consume its own context.
 */
function AppShell() {
  const colors = useColors();
  const { isDark, ready: themeReady } = useTheme();
  const ready = useI18n((s) => s.ready);
  const hydrate = useI18n((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const booted = ready && themeReady;

  useEffect(() => {
    if (booted) void SplashScreen.hideAsync().catch(() => {});
  }, [booted]);

  // Hold the tree until BOTH the language and the theme resolve. Rendering
  // first would flash English at an Arabic user and a light screen at somebody
  // who chose dark, and would mount components before the layout direction is
  // known. The splash is still up, so this frame is not seen on a device.
  if (!booted) {
    return <View style={{ flex: 1, backgroundColor: colors.surface.canvas }} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.surface.canvas }}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          {/*
            Light glyphs on a dark app, dark glyphs on a light one. Getting this
            wrong is the one theming mistake that makes the clock and battery
            genuinely unreadable rather than merely ugly.
          */}
          <StatusBar style={isDark ? 'light' : 'dark'} />
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
              // The navigator draws the gap between screens during a
              // transition; left unset it is white, which flashes on every
              // push in dark mode.
              contentStyle: { backgroundColor: colors.surface.canvas },
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
