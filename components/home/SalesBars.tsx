import React from 'react';
import { View, useWindowDimensions } from 'react-native';
import { Text } from '../ui';
import { radius, space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { formatMoney } from '../../lib/format';
import { axisTicks, labelledEvery, shortAmount, type BarLike } from '../../lib/home-day';
import { useTranslation } from '../../lib/i18n';

/**
 * The bars under Home's sales value — plain views, no chart library.
 *
 * The server has already cut the sales value into these bars, so nothing is
 * computed here but pixels: the tallest bar sets the scale, round ticks label
 * the axis, and every bar announces its own value and span to a screen reader.
 * Twenty-four hours print every third label; seven days and the weeks of a
 * month print them all. In Arabic the row mirrors on its own.
 */
export interface SalesBarsProps {
  bars: BarLike[];
  unit: 'hour' | 'day' | 'week';
  /** The printed label for a bar — the screen decides the words. */
  labelOf: (bar: BarLike, index: number) => string;
  /** Height of the plot area in points. */
  height?: number;
}

const AXIS_WIDTH = 34;

export function SalesBars({ bars, unit, labelOf, height = 132 }: SalesBarsProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const max = Math.max(0, ...bars.map((b) => b.value));
  const ticks = axisTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const every = labelledEvery(unit, width);

  return (
    <View style={styles.wrap} accessibilityRole="summary">
      <View style={styles.plotRow}>
        <View style={[styles.axis, { height }]}>
          {ticks
            .slice()
            .reverse()
            .map((tick) => (
              <Text key={tick} variant="caption" tone="tertiary" style={styles.tick}>
                {shortAmount(tick)}
              </Text>
            ))}
        </View>
        <View style={[styles.plot, { height }]}>
          {ticks.map((tick) => (
            <View key={tick} pointerEvents="none" style={[styles.gridLine, { bottom: (tick / top) * height }]} />
          ))}
          <View style={styles.bars}>
            {bars.map((bar, i) => {
              const h = max > 0 ? Math.max(bar.value > 0 ? 3 : 0, (bar.value / top) * height) : 0;
              return (
                <View
                  key={bar.key}
                  style={styles.slot}
                  accessible
                  accessibilityLabel={t('home.chart.bar', { label: labelOf(bar, i), value: formatMoney(bar.value) })}
                >
                  <View style={[styles.bar, { height: h }, bar.value === 0 && styles.barEmpty]} />
                </View>
              );
            })}
          </View>
        </View>
      </View>
      <View style={styles.labels}>
        <View style={{ width: AXIS_WIDTH }} />
        <View style={styles.labelRow}>
          {/* One label per group of bars, so a printed hour has the width of the bars it names. */}
          {bars
            .filter((_, i) => i % every === 0)
            .map((bar, g) => {
              const span = Math.min(every, bars.length - g * every);
              return (
                <View key={bar.key} style={[styles.labelCell, { flex: span }]}>
                  <Text variant="caption" tone="secondary" numberOfLines={1} align={every > 1 ? 'start' : 'center'}>
                    {labelOf(bar, g * every)}
                  </Text>
                </View>
              );
            })}
        </View>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: { gap: space.xs },
  plotRow: { flexDirection: 'row', alignItems: 'flex-end' },
  axis: { width: AXIS_WIDTH, justifyContent: 'space-between', paddingEnd: space.xs },
  tick: { textAlign: 'right' },
  plot: { flex: 1, justifyContent: 'flex-end' },
  gridLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: colors.border.subtle },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: '100%', gap: 3 },
  slot: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', minWidth: 0 },
  bar: { width: '70%', maxWidth: 28, borderTopLeftRadius: radius.sm, borderTopRightRadius: radius.sm, backgroundColor: colors.semantic.primary },
  barEmpty: { backgroundColor: colors.border.subtle },
  labels: { flexDirection: 'row' },
  labelRow: { flex: 1, flexDirection: 'row', gap: 3 },
  labelCell: { minWidth: 0 },
}));
