import React from 'react';
import { View } from 'react-native';
import type { Intent } from '../../lib/design/colors';
import { space } from '../../lib/design/tokens';
import { Chip } from './Chip';
import { TextField, type TextFieldProps } from './Field';
import { Text } from './Text';

/**
 * TEMPORARY compatibility layer.
 *
 * Bridges the pre-design-system component names used by the twelve screens
 * built before Phase 1. Every export here is deprecated on arrival: it exists
 * only so the app keeps running while screens are rebuilt one at a time, and
 * the file is deleted once the last screen has moved over.
 *
 * Do not add anything to this file.
 */

/** @deprecated Use `<Text variant="title" />`. */
export function H1({ children }: { children: React.ReactNode }) {
  return <Text variant="title">{children}</Text>;
}

/** @deprecated Use `<Text variant="heading" />`. */
export function H2({ children }: { children: React.ReactNode }) {
  return <Text variant="heading">{children}</Text>;
}

/** @deprecated Use `<Text tone="secondary" />`. */
export function Muted({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <Text variant="body" tone="secondary" className={className}>
      {children}
    </Text>
  );
}

/** @deprecated Compose with a `View` or the `Section`/`ListRow` primitives. */
export function Row({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <View className={className} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      {children}
    </View>
  );
}

/** @deprecated Use `<TextField />` (or `<MoneyField />` for prices). */
export function Field(props: TextFieldProps) {
  return <TextField {...props} />;
}

/** The old colour-named tones, mapped onto semantic intents. */
const LEGACY_TONES: Record<string, Intent> = {
  slate: 'neutral',
  brand: 'info',
  green: 'success',
  red: 'danger',
  amber: 'warning',
};

/** @deprecated Use `<StatusChip />` for backend statuses, `<Chip />` otherwise. */
export function Badge({ label, tone = 'slate' }: { label: string; tone?: string }) {
  return <Chip label={label} tone={LEGACY_TONES[tone] ?? 'neutral'} size="sm" dot={false} />;
}
