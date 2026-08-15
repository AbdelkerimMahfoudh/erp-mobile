import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Lock, TrendingDown, TrendingUp } from 'lucide-react-native';
import { colors } from '../../lib/design/colors';
import { pressedOpacity, radius, space } from '../../lib/design/tokens';
import { useTranslation } from '../../lib/i18n';
import { Skeleton } from './Skeleton';
import { Text } from './Text';
import { usePressed } from './use-pressed';

/**
 * A single figure with its meaning attached.
 *
 * docs/05 forbids a bare number, and this component is how that rule is kept:
 * `caption` and `trend` exist so the thing that makes a figure *mean* something
 * is part of the component rather than an afterthought a screen might skip.
 *
 * It also handles the withheld case honestly. When the server strips a money
 * field for a role without `cost.view`, the tile says the value is restricted
 * instead of rendering a dash that reads as "broken".
 */

export type StatTone = 'neutral' | 'accent' | 'success' | 'danger';

const VALUE_COLOR: Record<StatTone, string> = {
  neutral: colors.text.primary,
  accent: colors.brand[600],
  success: colors.intent.success.fg,
  danger: colors.intent.danger.fg,
};

export interface StatTrend {
  /** Percentage change vs. the comparison period. Sign drives the arrow. */
  direction: 'up' | 'down' | 'flat';
  label: string;
  /**
   * Whether "up" is good. Revenue up is good; returns up is not. Without this
   * the tile would paint every increase green, which quietly misleads.
   */
  positiveIsGood?: boolean;
}

export interface StatTileProps {
  label: string;
  /** Pre-formatted — the tile never formats money itself. */
  /**
   * A node is accepted so a money tile can use `MoneyValue` and keep its
   * tabular figures — otherwise every tile would re-format money itself, which
   * is exactly what `MoneyValue` exists to stop. Pass `valueLabel` alongside a
   * node so the tile can still announce itself.
   */
  value: string | React.ReactElement;
  /** Screen-reader text for `value` when it is a node rather than a string. */
  valueLabel?: string;
  /** The line that gives the number meaning. */
  caption?: string;
  trend?: StatTrend;
  tone?: StatTone;
  /** True when the field was withheld by permissions rather than missing. */
  restricted?: boolean;
  loading?: boolean;
  onPress?: () => void;
  /** `lg` for the one focal figure on a screen. */
  size?: 'md' | 'lg';
  style?: StyleProp<ViewStyle>;
}

export function StatTile({
  label,
  value,
  valueLabel,
  caption,
  trend,
  tone = 'neutral',
  restricted = false,
  loading = false,
  onPress,
  size = 'md',
  style,
}: StatTileProps) {
  const { t } = useTranslation();
  const { pressed, pressHandlers } = usePressed();

  const content = (pressed: boolean) => (
    <View style={[styles.tile, pressed ? styles.pressed : null, style]}>
      <Text variant="caption" tone="tertiary" numberOfLines={1} style={styles.label}>
        {label}
      </Text>

      {loading ? (
        <Skeleton height={size === 'lg' ? 30 : 22} width="70%" style={{ marginTop: space.xs }} />
      ) : restricted ? (
        <View style={styles.restricted}>
          <Lock color={colors.text.placeholder} size={size === 'lg' ? 20 : 16} />
          <Text variant={size === 'lg' ? 'title' : 'heading'} tone="placeholder">
            {t('money.hidden')}
          </Text>
        </View>
      ) : (
        typeof value === 'string' ? (
          <Text
            variant={size === 'lg' ? 'display' : 'title'}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            style={{ color: VALUE_COLOR[tone] }}
          >
            {value}
          </Text>
        ) : (
          // A node brings its own typography — a MoneyValue must keep its
          // tabular figures rather than inheriting the tile's title style.
          value
        )
      )}

      {trend && !loading && !restricted ? <Trend trend={trend} /> : null}

      {caption && !loading ? (
        <Text variant="caption" tone="secondary" numberOfLines={2}>
          {caption}
        </Text>
      ) : null}
    </View>
  );

  if (!onPress) return content(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${
        restricted ? t('money.hidden') : typeof value === 'string' ? value : (valueLabel ?? '')
      }`}
      onPress={onPress}
      {...pressHandlers}
      style={styles.pressable}
    >
      {content(pressed)}
    </Pressable>
  );
}

function Trend({ trend }: { trend: StatTrend }) {
  const { direction, label, positiveIsGood = true } = trend;
  if (direction === 'flat') {
    return (
      <Text variant="caption" tone="tertiary" numberOfLines={1}>
        {label}
      </Text>
    );
  }

  const rising = direction === 'up';
  const good = rising === positiveIsGood;
  const color = good ? colors.intent.success.fg : colors.intent.danger.fg;
  const Icon = rising ? TrendingUp : TrendingDown;

  return (
    <View style={styles.trend}>
      <Icon color={color} size={13} />
      <Text variant="caption" numberOfLines={1} style={{ color, fontWeight: '600' }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pressable: {
    flex: 1,
  },
  tile: {
    flex: 1,
    gap: 2,
    padding: space.base,
    borderRadius: radius.lg,
    backgroundColor: colors.surface.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.subtle,
  },
  pressed: {
    opacity: pressedOpacity,
  },
  label: {
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontWeight: '600',
  },
  restricted: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  trend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    marginTop: 2,
  },
});
