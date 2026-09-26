import React from 'react';
import { Pressable } from 'react-native';
import { pressedOpacity, radius, space, touch } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { Text } from '../ui/Text';
import { usePressed } from '../ui/use-pressed';

/**
 * A named action on a review row — Accept, Edit, Exclude — as light as a control can be.
 *
 * A row of the hundred-phone delivery carried three design-system Buttons, each an
 * animated pressable with a shared value, an animated style and an SVG icon: opening a
 * group of ten mounted thirty of them, and the profile put the time in laying them out,
 * not in JavaScript (docs/55). This is a plain Pressable around one Text: the word,
 * 48 points tall, the press shown by opacity, and no icon — the name was always what
 * the design asked for. The design-system Button stays for the actions that stand
 * alone (Continue to payment, Match product).
 */
export function RowAction({
  title,
  onPress,
  tone = 'accent',
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  /** `danger` for Exclude, so the destructive word reads as one. */
  tone?: 'accent' | 'danger';
  disabled?: boolean;
}) {
  const styles = useStyles();
  const { pressed, pressHandlers } = usePressed();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      {...pressHandlers}
      style={[styles.action, pressed ? styles.pressed : null]}
    >
      <Text variant="bodyStrong" tone={disabled ? 'disabled' : tone} numberOfLines={1}>
        {title}
      </Text>
    </Pressable>
  );
}

const useStyles = makeStyles(() => ({
  action: {
    minHeight: touch.min,
    paddingHorizontal: space.md,
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  pressed: { opacity: pressedOpacity },
}));
