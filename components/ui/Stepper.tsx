import React from 'react';
import { I18nManager, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Minus, Plus } from 'lucide-react-native';
import { colors } from '../../lib/design/colors';
import { disabledOpacity, radius, space, touch } from '../../lib/design/tokens';
import { haptics } from '../../lib/haptics';
import { Text } from './Text';
import { usePressed } from './use-pressed';

/**
 * Quantity stepper.
 *
 * Laid out LTR in every language on purpose: minus-left / plus-right is a
 * spatial convention people carry across languages, and mirroring it makes
 * users decrement when they meant to increment. The count between the buttons
 * is a Latin numeral for the same reason.
 */

export interface StepperProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  size?: 'sm' | 'md';
  disabled?: boolean;
  /** Screen-reader name for what is being counted, e.g. "Quantity". */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function Stepper({
  value,
  onChange,
  min = 1,
  max = 9999,
  step = 1,
  size = 'md',
  disabled = false,
  accessibilityLabel,
  style,
}: StepperProps) {
  const button = size === 'sm' ? 36 : touch.min;
  const canDecrement = !disabled && value - step >= min;
  const canIncrement = !disabled && value + step <= max;

  const apply = (next: number) => {
    haptics.tap();
    onChange(Math.min(max, Math.max(min, next)));
  };

  return (
    <View
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min, max, now: value }}
      style={[
        styles.container,
        // RN flips `row` automatically under RTL; `row-reverse` cancels that so
        // minus stays on the left in every language. There is no `direction`
        // style property in React Native — this is the only way to pin order.
        { flexDirection: I18nManager.isRTL ? 'row-reverse' : 'row' },
        { opacity: disabled ? disabledOpacity : 1 },
        style,
      ]}
    >
      <StepButton
        icon={Minus}
        size={button}
        enabled={canDecrement}
        onPress={() => apply(value - step)}
        label={`−${step}`}
      />
      <View style={[styles.value, { minWidth: button }]}>
        <Text variant="bodyStrong" align="center" style={styles.count}>
          {value}
        </Text>
      </View>
      <StepButton
        icon={Plus}
        size={button}
        enabled={canIncrement}
        onPress={() => apply(value + step)}
        label={`+${step}`}
      />
    </View>
  );
}

function StepButton({
  icon: Icon,
  size,
  enabled,
  onPress,
  label,
}: {
  icon: React.ComponentType<{ color?: string; size?: number }>;
  size: number;
  enabled: boolean;
  onPress: () => void;
  label: string;
}) {
  const { pressed, pressHandlers } = usePressed();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      {...pressHandlers}
      style={[
        styles.button,
        {
          width: size,
          height: size,
          backgroundColor: pressed && enabled ? colors.neutral[200] : colors.surface.sunken,
          opacity: enabled ? 1 : 0.35,
        },
      ]}
    >
      <Icon color={colors.text.primary} size={16} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    // flexDirection is set inline — it depends on the runtime direction.
    alignItems: 'center',
    gap: space.xs,
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  value: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xs,
  },
  count: {
    fontVariant: ['tabular-nums'],
  },
});
