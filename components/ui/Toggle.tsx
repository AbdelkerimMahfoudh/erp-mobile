import React from 'react';
import { Pressable, StyleSheet, Switch, View, type StyleProp, type ViewStyle } from 'react-native';
import { radius, space, touch } from '../../lib/design/tokens';
import { Text } from './Text';
import { usePressed } from './use-pressed';
import { makeStyles, useColors } from '../../lib/design/theme';

/**
 * A labelled on/off setting.
 *
 * The whole row is the target, not just the switch: a 51pt switch is a small
 * thing to hit accurately with a thumb while holding a phone in the other hand,
 * and someone reading the label has already told you what they mean to press.
 *
 * The state is always written out as well as shown — "On"/"Off" beneath the
 * label — because a switch's position is the one control users routinely read
 * backwards, and colour alone never carries meaning in this app.
 */
export interface ToggleProps {
  label: string;
  /** Quiet line explaining what turning this on actually does. */
  hint?: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  /** Words for the two states. Defaults to On / Off. */
  onLabel?: string;
  offLabel?: string;
  disabled?: boolean;
  /**
   * Drop the box: no border, no radius, for a toggle that is one row inside a
   * shared surface (a `RowGroup`, or a `Card` that owns the edge). The same
   * reason `ListRow` has a `flat` — the container draws the border once, so a
   * settings row does not read as a card floating inside a card.
   */
  flat?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Toggle({
  label,
  hint,
  value,
  onValueChange,
  onLabel = 'On',
  offLabel = 'Off',
  disabled = false,
  flat = false,
  style,
}: ToggleProps) {
  const styles = useStyles();
  const colors = useColors();
  const { pressed, pressHandlers } = usePressed();

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      {...pressHandlers}
      style={[
        styles.row,
        {
          backgroundColor: pressed && !disabled ? colors.surface.hover : colors.surface.card,
          borderColor: colors.border.subtle,
        },
        flat ? styles.flat : null,
        disabled ? styles.disabled : null,
        style,
      ]}
    >
      <View style={styles.text}>
        <Text variant="bodyStrong">{label}</Text>
        {hint ? (
          <Text variant="caption" tone="secondary" style={styles.hint}>
            {hint}
          </Text>
        ) : null}
      </View>

      <View style={styles.control}>
        <Text variant="label" tone={value ? 'accent' : 'tertiary'}>
          {value ? onLabel : offLabel}
        </Text>
        {/* `pointerEvents="none"`: the row owns the gesture, so a tap on the
            switch itself cannot fire the change twice. */}
        <View pointerEvents="none">
          <Switch
            value={value}
            onValueChange={onValueChange}
            disabled={disabled}
            /*
              Every colour named explicitly. React Native Web supplies its own
              Material teal for an unstyled switch, which belongs to no palette
              here and looks like a bug beside the brand.
            */
            trackColor={{ false: colors.border.strong, true: colors.intent.info.solid }}
            thumbColor={colors.surface.card}
            ios_backgroundColor={colors.border.strong}
          />
        </View>
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    minHeight: touch.min,
    paddingVertical: space.md,
    paddingHorizontal: space.base,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
  },
  // One row inside a shared surface: the container owns the edge (see `flat` above).
  flat: { borderWidth: 0, borderRadius: 0 },
  text: { flex: 1 },
  hint: { marginTop: space.xs },
  control: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  disabled: { opacity: 0.5 },
}));
