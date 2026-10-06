/// <reference types="jest" />
/**
 * expo-router, as the rendered tests see it: a router that records what a
 * screen asked for, and a Stack whose `Screen` options are accepted and ignored.
 * A separate module (not a `jest.mock` factory) so it may import React.
 */
import React from 'react';

export const push = jest.fn();
export const replace = jest.fn();
export const back = jest.fn();

export function Stack({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}
Stack.Screen = function Screen() {
  return null;
};

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
