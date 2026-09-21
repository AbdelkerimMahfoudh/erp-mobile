import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ChevronDown, ChevronRight, ChevronUp } from 'lucide-react-native';
import { MoneyValue, Text } from '../ui';
import { space, touch } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';
import { isRTL } from '../../lib/i18n';

/**
 * One day of sales, as a line: the day, how many phones, what they came to.
 *
 * On the Money overview the line leads to that day; on the sales screen it
 * opens the day in place (`open` is then given, and the chevron turns). The
 * value is the server's day total and is absent, not zero, for a line that
 * stands for several days at once — the phone never adds days up itself.
 */
export function DayRow({
  title,
  caption,
  value,
  onPress,
  open,
  divider = true,
}: {
  title: string;
  caption: string;
  value?: number;
  onPress: () => void;
  /** Given when the row expands in place rather than navigating. */
  open?: boolean;
  /** Off for a row that is a card's own heading. */
  divider?: boolean;
}) {
  const styles = useStyles();
  const colors = useColors();
  const Chevron = open === undefined ? ChevronRight : open ? ChevronUp : ChevronDown;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${caption}`}
      accessibilityState={open === undefined ? undefined : { expanded: open }}
      onPress={onPress}
      style={({ pressed }) => [styles.row, divider ? styles.divider : null, pressed && styles.pressed]}
    >
      <View style={styles.body}>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="caption" tone="secondary">
          {caption}
        </Text>
      </View>
      {value !== undefined ? <MoneyValue value={value} size="small" /> : null}
      <View style={isRTL() && open === undefined ? styles.flip : undefined}>
        <Chevron size={18} color={colors.text.tertiary} />
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: touch.comfortable,
    paddingVertical: space.sm,
  },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.subtle,
  },
  pressed: { opacity: 0.6 },
  body: { flex: 1, gap: 2 },
  flip: { transform: [{ scaleX: -1 }] },
}));
