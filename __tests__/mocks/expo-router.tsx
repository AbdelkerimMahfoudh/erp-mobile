/// <reference types="jest" />
/**
 * expo-router, as the rendered tests see it: a router that records what a
 * screen asked for, and a Stack whose `Screen` options are accepted and ignored.
 * A separate module (not a `jest.mock` factory) so it may import React.
 *
 * `Tabs` draws each declared tab the way the navigator would decide it: the
 * layout's `screenOptions` for that route merged with the tab's own options; a
 * tab whose `href` is null is not drawn, every other one is its title in its
 * label style (`tab-<route>`), so a test can read the bar as a person sees it.
 */
import React from 'react';
import { Text } from 'react-native';

export const push = jest.fn();
export const replace = jest.fn();
export const back = jest.fn();

export function Stack({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}
Stack.Screen = function Screen() {
  return null;
};

type TabOptions = { title?: string; href?: string | null; tabBarLabelStyle?: object; tabBarBadge?: number };
type ScreenOptions = TabOptions | ((props: { route: { name: string } }) => TabOptions);

export function Tabs({ children, screenOptions }: { children?: React.ReactNode; screenOptions?: ScreenOptions }) {
  return (
    <>
      {React.Children.map(children, (child) =>
        React.isValidElement(child) ? React.cloneElement(child as React.ReactElement<{ screenOptions?: ScreenOptions }>, { screenOptions }) : child,
      )}
    </>
  );
}
Tabs.Screen = function TabScreen({ name, options, screenOptions }: { name: string; options?: TabOptions; screenOptions?: ScreenOptions }) {
  const base = typeof screenOptions === 'function' ? screenOptions({ route: { name } }) : (screenOptions ?? {});
  const merged = { ...base, ...options };
  if (merged.href === null) return null;
  return (
    <Text testID={`tab-${name}`} style={merged.tabBarLabelStyle}>
      {merged.title}
    </Text>
  );
};

export const DefaultTheme = { dark: false, colors: {}, fonts: { regular: { fontFamily: 'System', fontWeight: '400' }, medium: { fontFamily: 'System', fontWeight: '500' } } };

export function Link({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

export const useRouter = () => ({ push, replace, back, navigate: push });
export const useLocalSearchParams = () => ({});
export const useGlobalSearchParams = () => ({});
export const useSegments = () => [];
export const usePathname = () => '/';
export const useFocusEffect = () => undefined;
export const useNavigation = () => ({ setOptions: jest.fn(), canGoBack: () => false, goBack: back });
export const router = { push, replace, back, navigate: push };
export const Redirect = () => null;
