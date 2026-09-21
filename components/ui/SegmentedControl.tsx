import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { disabledOpacity, elevation, radius, space, touch } from '../../lib/design/tokens';
import { haptics } from '../../lib/haptics';
import { Text } from './Text';
import type { IconComponent } from './Button';
import type { Palette } from '../../lib/design/colors';
import { makeStyles, useColors } from '../../lib/design/theme';

/**
 * Segmented control — for a small, fixed set of mutually exclusive choices
 * (tracking type, restock vs. faulty, payment method).
 *
 * Use it up to about four options; past that the segments get too narrow to hit
 * and a `SelectSheet` is the right control instead.
 *
 * Three looks, one behaviour:
 *  - `raised` (the default) — the selected segment is a raised card in a
 *    sunken track, the control most forms use.
 *  - `filled` — the selected segment is a solid brand pill in the track: the
 *    period switch on Money and the sales screens, where the choice is the
 *    screen's one control and has to read from across a counter.
 *  - `buttons` — separate outlined buttons, an icon each, the chosen one
 *    filled: a two-way choice that is really a pair of buttons (Cash or an
 *    account, a customer or a store).
 */

export type SegmentedVariant = 'raised' | 'filled' | 'buttons';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** Shown before the label. Meant for the `buttons` look. */
  icon?: IconComponent;
  /** Disable one option without removing it, so the set stays recognisable. */
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  variant?: SegmentedVariant;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  variant = 'raised',
  disabled = false,
  style,
}: SegmentedControlProps<T>) {
  const styles = useStyles();
  const colors = useColors();
  const height = size === 'sm' ? 40 : touch.min;
  const buttons = variant === 'buttons';

  return (
    <View
      accessibilityRole="tablist"
      style={[
        buttons ? styles.buttons : styles.track,
        variant === 'filled' ? styles.filledTrack : null,
        { height, opacity: disabled ? disabledOpacity : 1 },
        style,
      ]}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const off = disabled || option.disabled;
        const look = segmentLook(variant, selected, colors);
        /**
         * `option.disabled`, not `off`. When the whole control is disabled the
         * track is already dimmed, and adding the disabled text colour on top
         * compounded to roughly 1.3:1 — the label disappeared rather than
         * reading as unavailable. One signal at a time; see `disabledOpacity`.
         */
        const foreground = option.disabled ? colors.text.disabled : look.foreground;
        const Icon = option.icon;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected, disabled: off }}
            disabled={off}
            onPress={() => {
              if (selected) return;
              haptics.tap();
              onChange(option.value);
            }}
            style={[
              styles.segment,
              buttons ? styles.button : variant === 'filled' ? styles.pill : null,
              { backgroundColor: look.background, borderColor: look.border },
              // The raised segment is a card in a sunken track — readable
              // without relying on colour alone.
              variant === 'raised' && selected ? styles.selected : null,
            ]}
          >
            {Icon ? <Icon color={foreground} size={18} /> : null}
            <Text
              variant={selected ? 'labelStrong' : 'label'}
              align="center"
              numberOfLines={buttons ? 2 : 1}
              style={[{ color: foreground }, buttons ? styles.buttonLabel : null]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function segmentLook(variant: SegmentedVariant, selected: boolean, colors: Palette) {
  if (variant === 'raised') {
    return selected
      ? { background: colors.surface.card, border: colors.border.subtle, foreground: colors.text.primary }
      : { background: 'transparent', border: 'transparent', foreground: colors.text.secondary };
  }
  if (selected) {
    return { background: colors.intent.info.solid, border: colors.intent.info.solid, foreground: colors.text.inverse };
  }
  return variant === 'filled'
    ? { background: 'transparent', border: 'transparent', foreground: colors.text.secondary }
    : { background: colors.surface.card, border: colors.border.default, foreground: colors.text.secondary };
}

const useStyles = makeStyles((colors) => ({
  track: {
    flexDirection: 'row',
    alignItems: 'stretch',
    padding: 3,
    gap: 3,
    borderRadius: radius.md,
    backgroundColor: colors.surface.sunken,
  },
  filledTrack: {
    borderRadius: radius.lg,
  },
  buttons: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: space.sm,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pill: {
    borderRadius: radius.md,
  },
  button: {
    borderRadius: radius.md,
    borderWidth: 1,
  },
  buttonLabel: {
    flexShrink: 1,
  },
  selected: elevation.xs,
}));
