import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { pressedOpacity, radius, space, touch } from '../../lib/design/tokens';
import { mirror } from '../../lib/design/direction';
import { Identifier, Text } from './Text';
import type { IconComponent } from './Button';
import { usePressed } from './use-pressed';
import { makeStyles, useColors } from '../../lib/design/theme';

/**
 * The list row.
 *
 * Every list in the app is built from this — inventory, catalog, suppliers,
 * transfers, notifications. One row component is what makes lists feel like the
 * same application rather than seven different tables, and it means alignment,
 * touch target and press feedback are solved once.
 *
 * Layout: [leading] title / subtitle / identifier … [trailing value] [chevron]
 */

export interface ListRowProps {
  title: string;
  /** Quiet supporting line: category, branch, supplier, timestamp. */
  subtitle?: string;
  /** IMEI / serial / barcode. Rendered LTR and monospaced. */
  identifier?: string;
  /** Icon shown in a tinted square, or any custom leading node (a thumbnail). */
  leading?: IconComponent | React.ReactElement;
  /**
   * Right-aligned headline value — usually money or a count.
   *
   * A node is accepted so money can come from `MoneyValue` and keep its tabular
   * figures; `valueTone` then has no effect, since the node carries its own.
   */
  value?: string | React.ReactElement;
  /** Small caption under the value. */
  valueCaption?: string;
  /**
   * `warning` is for a count of outstanding work — approvals waiting, refunds
   * unconfirmed. Deliberately not `danger`: nothing has gone wrong, somebody
   * simply has not done it yet.
   */
  valueTone?: 'primary' | 'success' | 'warning' | 'danger' | 'secondary';
  /** Status chip or badge, rendered before the value. */
  accessory?: React.ReactNode;
  onPress?: () => void;
  /** Show the navigation chevron. Defaults on when `onPress` is given. */
  chevron?: boolean;
  disabled?: boolean;
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function ListRow({
  title,
  subtitle,
  identifier,
  leading,
  value,
  valueCaption,
  valueTone = 'primary',
  accessory,
  onPress,
  chevron,
  disabled = false,
  selected = false,
  style,
}: ListRowProps) {
  const styles = useStyles();
  const colors = useColors();
  const showChevron = chevron ?? Boolean(onPress);
  const interactive = Boolean(onPress) && !disabled;
  const { pressed, pressHandlers } = usePressed();

  const body = (pressed: boolean) => (
    <View
      style={[
        styles.row,
        {
          backgroundColor: selected
            ? colors.intent.info.bg
            : pressed
              ? colors.surface.hover
              : colors.surface.card,
          borderColor: selected ? colors.intent.info.border : colors.border.subtle,
        },
        disabled ? styles.disabled : null,
        style,
      ]}
    >
      <Leading leading={leading} />

      <View style={styles.body}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="tertiary" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
        {identifier ? (
          <Identifier tone="tertiary" numberOfLines={1}>
            {identifier}
          </Identifier>
        ) : null}
      </View>

      {accessory}

      {value ? (
        <View style={styles.valueBlock}>
          {typeof value === 'string' ? (
            <Text variant="bodyStrong" tone={valueTone} align="end" numberOfLines={1}>
              {value}
            </Text>
          ) : (
            // A node brings its own type — a MoneyValue keeps its tabular
            // figures so a column of balances lines up down the list.
            value
          )}
          {valueCaption ? (
            <Text variant="caption" tone="tertiary" align="end" numberOfLines={1}>
              {valueCaption}
            </Text>
          ) : null}
        </View>
      ) : null}

      {showChevron ? (
        <View style={mirror()}>
          <ChevronRight color={colors.text.placeholder} size={18} />
        </View>
      ) : null}
    </View>
  );

  if (!interactive) return body(false);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled, selected }}
      onPress={onPress}
      {...pressHandlers}
      style={pressed ? { opacity: pressedOpacity } : undefined}
    >
      {body(pressed)}
    </Pressable>
  );
}

function Leading({ leading }: { leading?: IconComponent | React.ReactElement }) {
  const styles = useStyles();
  const colors = useColors();
  if (!leading) return null;
  // A ready-made element (thumbnail, avatar) is used as-is; a component is
  // wrapped in the standard tinted square so icon rows align across screens.
  if (React.isValidElement(leading)) return leading;
  const Icon = leading as IconComponent;
  return (
    <View style={styles.iconBadge}>
      <Icon color={colors.brand[600]} size={19} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: touch.comfortable + space.sm,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  body: {
    flex: 1,
    gap: 1,
  },
  valueBlock: {
    alignItems: 'flex-end',
    gap: 1,
  },
  iconBadge: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.intent.info.bg,
  },
  disabled: {
    opacity: 0.5,
  },
}));
