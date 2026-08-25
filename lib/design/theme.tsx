/**
 * The theme: one on/off preference, and the machinery that makes every screen
 * follow it.
 *
 * ## Why a hook rather than a mutable palette
 *
 * The obvious approach — swap the values inside the exported `colors` object —
 * cannot work, and it fails silently, which is worse. A screen written as
 *
 *     const styles = StyleSheet.create({ card: { backgroundColor: colors.surface.card } });
 *
 * evaluates `colors.surface.card` **once**, when the module is first imported,
 * and keeps the string it got. Mutating the palette afterwards changes nothing
 * anybody has already read, and modules are not re-evaluated. The screen would
 * simply stay light for the rest of the session with no error to notice.
 *
 * So styles that depend on colour must be built *during render*. That is all
 * {@link makeStyles} does: it takes the same object literal a screen already
 * wrote and defers it until the palette is known, memoised per theme so the
 * work happens twice per app run rather than on every render.
 *
 * ## Why no "System" option
 *
 * The setting is a switch, because that is what was asked for and because a
 * third state makes the control ambiguous: with "System" selected, the switch
 * shows the *current* appearance, and a shopkeeper toggling it at dusk cannot
 * tell whether they changed the setting or the sun did. Existing users default
 * to Light, so nobody's app changes appearance on its own after an update.
 */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import type { ImageStyle, TextStyle, ViewStyle } from 'react-native';
import { getItem, setItem } from '../storage';
import { PALETTES, type Palette, type ThemeName } from './colors';

const STORAGE_KEY = 'erp.theme';

interface ThemeValue {
  theme: ThemeName;
  colors: Palette;
  isDark: boolean;
  /** True once the stored choice has been read. Screens wait on this. */
  ready: boolean;
  setTheme: (next: ThemeName) => Promise<void>;
}

const ThemeContext = createContext<ThemeValue | undefined>(undefined);

/**
 * Reads the stored preference before the first paint that matters.
 *
 * `ready` stays false until storage has answered. The root layout holds the
 * splash screen until then, which is what stops the app rendering a bright
 * white frame and then flipping to dark a moment later — the flash the brief
 * rules out. It is a real flash, not a theoretical one: storage here is async,
 * so *something* must wait.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>('light');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const stored = await getItem(STORAGE_KEY);
        if (stored === 'dark' || stored === 'light') setThemeState(stored);
      } catch {
        // An unreadable preference is not worth failing to start over. Light
        // is the documented default and the safe one: it is what every
        // existing user already sees.
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const value = useMemo<ThemeValue>(
    () => ({
      theme,
      colors: PALETTES[theme],
      isDark: theme === 'dark',
      ready,
      setTheme: async (next: ThemeName) => {
        // Applied immediately, then persisted. A shopkeeper tapping the switch
        // must see the app change now, not after a round trip to storage.
        setThemeState(next);
        try {
          await setItem(STORAGE_KEY, next);
        } catch {
          // The appearance still changed for this session; only the memory of
          // it was lost. Silently reverting what they just watched happen
          // would be more confusing than a preference that forgets.
        }
      },
    }),
    [theme, ready],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}

/** The palette for the current theme. */
export function useColors(): Palette {
  return useTheme().colors;
}

/**
 * Mirrors React Native's own style-sheet shape.
 *
 * This is not decoration: without it, `flexDirection: 'row'` inside the style
 * literal widens from the literal `'row'` to `string`, and every style in the
 * app stops type-checking. `StyleSheet.create` avoids that with exactly this
 * signature, so `makeStyles` copies it.
 */
type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };

/**
 * Turn a style literal into a hook that follows the theme.
 *
 * Written to be a near-mechanical swap for `StyleSheet.create`, so converting a
 * screen is a rename and an indent rather than a rewrite:
 *
 *     const useStyles = makeStyles((colors) => ({ card: { backgroundColor: colors.surface.card } }));
 *     // inside the component:
 *     const styles = useStyles();
 *
 * Both palettes are built once each and cached, so a screen re-rendering does
 * no style work at all, and toggling the theme does none after the first time.
 */
export function makeStyles<T extends NamedStyles<T> | NamedStyles<Record<string, unknown>>>(
  build: (colors: Palette) => T & NamedStyles<Record<string, unknown>>,
): () => T {
  const cache = new Map<ThemeName, T>();

  return function useStyles(): T {
    const { theme, colors } = useTheme();
    const hit = cache.get(theme);
    if (hit) return hit;
    const created = StyleSheet.create(build(colors)) as T;
    cache.set(theme, created);
    return created;
  };
}

/**
 * The same trick for a lookup table that is not a style sheet.
 *
 * Components like `Button` keep a map from variant name to colours. At module
 * scope that map has exactly the problem {@link makeStyles} exists to solve —
 * it reads the palette once and keeps it — so it gets the same treatment
 * rather than a second, subtly different mechanism.
 */
export function makeTokens<T>(build: (colors: Palette) => T): () => T {
  const cache = new Map<ThemeName, T>();

  return function useTokens(): T {
    const { theme, colors } = useTheme();
    const hit = cache.get(theme);
    if (hit) return hit;
    const created = build(colors);
    cache.set(theme, created);
    return created;
  };
}
