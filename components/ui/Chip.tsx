import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, type Intent } from '../../lib/design/colors';
import { pressedOpacity, radius, space, touch } from '../../lib/design/tokens';
import { resolveStatus, type StatusDomain } from '../../lib/design/status';
import { useTranslation } from '../../lib/i18n';
import { haptics } from '../../lib/haptics';
import { Text } from './Text';
import type { IconComponent } from './Button';
import { usePressed } from './use-pressed';

/**
 * Chips — small, non-interactive labels (`Chip`, `StatusChip`) and the
 * interactive filter pill (`FilterChip`).
 */

export type ChipSize = 'sm' | 'md';

const SIZES: Record<ChipSize, { height: number; paddingX: number; icon: number }> = {
  sm: { height: 22, paddingX: space.sm, icon: 12 },
  md: { height: 28, paddingX: space.md, icon: 14 },
};

export interface ChipProps {
  label: string;
  tone?: Intent;
  size?: ChipSize;
  icon?: IconComponent;
  /** Leading dot. Adds a second visual channel where chips sit in a dense row. */
  dot?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Chip({ label, tone = 'neutral', size = 'md', icon: Icon, dot = false, style }: ChipProps) {
  const intent = colors.intent[tone];
  const s = SIZES[size];

  return (
    <View
      style={[
        styles.chip,
        {
          height: s.height,
          paddingHorizontal: s.paddingX,
          backgroundColor: intent.bg,
          borderColor: intent.border,
        },
        style,
      ]}
    >
      {dot ? <View style={[styles.dot, { backgroundColor: intent.fg }]} /> : null}
      {Icon ? <Icon color={intent.fg} size={s.icon} /> : null}
      <Text variant="caption" style={{ color: intent.fg, fontWeight: '600' }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export interface StatusChipProps {
  /** Which enum this value belongs to — `unit`, `transfer`, `sale`, … */
  domain: StatusDomain;
  /** The raw backend value, e.g. `in_stock`. */
  value: string;
  size?: ChipSize;
  dot?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * A backend status, rendered as colour *and* word.
 *
 * The pairing is not optional: this component cannot produce a coloured chip
 * without its label, which is how docs/05's "never colour alone" rule stays
 * true as the app grows. An unknown value degrades to a neutral chip showing
 * the raw string — visible and debuggable, never a crash mid-sale.
 */
export function StatusChip({ domain, value, size = 'md', dot = true, style }: StatusChipProps) {
  const { t } = useTranslation();
  const meta = resolveStatus(domain, value);

  if (!meta) {
    return <Chip label={value.replace(/_/g, ' ')} tone="neutral" size={size} dot={dot} style={style} />;
  }
  return <Chip label={t(meta.labelKey)} tone={meta.tone} size={size} dot={dot} style={style} />;
}

export interface FilterChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** Result count, shown inline — saves a tap to find an empty filter. */
  count?: number;
  style?: StyleProp<ViewStyle>;
}

/** The selectable pill used for list filters. */
export function FilterChip({ label, selected, onPress, count, style }: FilterChipProps) {
  const { pressed, pressHandlers } = usePressed();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      // Pills are 36pt tall to stay visually light; slop restores the target.
      hitSlop={{ top: 6, bottom: 6 }}
      {...pressHandlers}
      style={[
        styles.filter,
        {
          backgroundColor: selected ? colors.brand[600] : colors.surface.card,
          borderColor: selected ? colors.brand[600] : colors.border.default,
          opacity: pressed ? pressedOpacity : 1,
        },
        style,
      ]}
    >
      <Text
        variant="label"
        style={{ color: selected ? colors.text.inverse : colors.text.secondary, fontWeight: '600' }}
        numberOfLines={1}
      >
        {label}
      </Text>
      {count !== undefined ? (
        <Text
          variant="caption"
          style={{ color: selected ? 'rgba(255,255,255,0.78)' : colors.text.tertiary, fontWeight: '600' }}
        >
          {count}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.xs,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
  },
  filter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    height: 36,
    minWidth: touch.min,
    justifyContent: 'center',
    paddingHorizontal: space.base,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
