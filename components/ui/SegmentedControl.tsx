import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { disabledOpacity, elevation, radius, space, touch } from '../../lib/design/tokens';
import { haptics } from '../../lib/haptics';
import { Text } from './Text';
import { makeStyles, useColors } from '../../lib/design/theme';

/**
 * Segmented control — for a small, fixed set of mutually exclusive choices
 * (tracking type, restock vs. faulty, payment method).
 *
 * Use it up to about four options; past that the segments get too narrow to hit
 * and a `SelectSheet` is the right control instead.
 */

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** Disable one option without removing it, so the set stays recognisable. */
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  disabled = false,
  style,
}: SegmentedControlProps<T>) {
  const styles = useStyles();
  const colors = useColors();
  const height = size === 'sm' ? 40 : touch.min;

  return (
    <View
      accessibilityRole="tablist"
      style={[styles.track, { height, opacity: disabled ? disabledOpacity : 1 }, style]}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const off = disabled || option.disabled;
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
              {
                backgroundColor: selected ? colors.surface.card : 'transparent',
                // The selected segment is a raised card in a sunken track —
                // readable without relying on colour alone.
                borderColor: selected ? colors.border.subtle : 'transparent',
              },
              selected ? styles.selected : null,
            ]}
          >
            <Text
              variant={selected ? 'labelStrong' : 'label'}
              align="center"
              numberOfLines={1}
              style={{
                /**
                 * `option.disabled`, not `off`. When the whole control is
                 * disabled the track is already dimmed, and adding the disabled
                 * text colour on top compounded to roughly 1.3:1 — the label
                 * disappeared rather than reading as unavailable.
                 * One signal at a time; see `disabledOpacity`.
                 */
                color: option.disabled
                  ? colors.text.disabled
                  : selected
                    ? colors.text.primary
                    : colors.text.secondary,
              }}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
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
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  selected: elevation.xs,
}));
