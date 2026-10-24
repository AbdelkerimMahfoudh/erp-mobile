import React from 'react';
import { Moon, Sun } from 'lucide-react-native';
import { touch } from '../../lib/design/tokens';
import { useTheme } from '../../lib/design/theme';
import type { ThemeName } from '../../lib/design/colors';
import { useTranslation } from '../../lib/i18n';
import { IconButton } from './IconButton';

/** From each appearance: where the button goes, the picture of it, and its name in words. */
const TOGGLE = {
  light: { next: 'dark', icon: Moon, label: 'theme.toggle.toDark' },
  dark: { next: 'light', icon: Sun, label: 'theme.toggle.toLight' },
} as const satisfies Record<ThemeName, { next: ThemeName; icon: typeof Moon; label: string }>;

/**
 * Light or dark, before signing in (owner's review, 2026-10-24).
 *
 * The same preference as the switch in Appearance — `ThemeProvider` is the one
 * implementation, this is only a second door to it — on the pages somebody sees
 * before they can reach Appearance. The icon shows where it goes (the moon in
 * light, the sun in dark) and the name says so in words, so the control never
 * relies on its picture alone.
 *
 * Switching re-renders in place: nothing is remounted, so a half-filled form
 * keeps every value, every message and its step.
 */
export function ThemeToggle() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const go = TOGGLE[theme];
  return (
    <IconButton
      icon={go.icon}
      accessibilityLabel={t(go.label)}
      onPress={() => void setTheme(go.next)}
      size={touch.min}
      testID="theme-toggle"
    />
  );
}
