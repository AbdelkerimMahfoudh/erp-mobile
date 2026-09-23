import React from 'react';
import { View } from 'react-native';
import { CalendarDays } from 'lucide-react-native';
import { SegmentedControl, Text } from '../ui';
import { space } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';
import { formatDayRange } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { PERIOD_KEYS, usePeriod, type PeriodKey } from '../../lib/period';
import { usePeriodRange } from '../../lib/home';

/**
 * Today / 7 days / This month, with the exact days underneath.
 *
 * Money, Results and the sales screens all render this and all read
 * `usePeriod`, so choosing a period on one is what the others show. The dates
 * are said, not implied: "7 days" alone does not tell anybody whether today is
 * included.
 */
export function PeriodSelector() {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const key = usePeriod((s) => s.key);
  const setKey = usePeriod((s) => s.setKey);
  const range = usePeriodRange(key);

  return (
    <View style={styles.wrap}>
      <SegmentedControl<PeriodKey>
        variant="filled"
        value={key}
        onChange={setKey}
        options={PERIOD_KEYS.map((k) => ({ value: k, label: t(`period.${k}` as never) }))}
      />
      <View style={styles.dates}>
        <CalendarDays size={16} color={colors.text.secondary} />
        {/* Not LTR-isolated: a localised date carries its own month word, and
            forcing it left-to-right reverses an Arabic date. */}
        <Text variant="caption" tone="secondary">
          {formatDayRange(range.from, range.to)}
        </Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles(() => ({
  wrap: { gap: space.sm },
  dates: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.xs },
}));
