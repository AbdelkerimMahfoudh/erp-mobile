import React from 'react';
import { View } from 'react-native';
import { SegmentedControl, Text } from '../ui';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { formatDate } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { PERIOD_KEYS, periodRange, usePeriod, type PeriodKey } from '../../lib/period';

/**
 * Today / 7 days / This month, with the exact days underneath.
 *
 * Money and Results both render this and both read `usePeriod`, so choosing a
 * period on one is what the other shows. The dates are said, not implied: "7
 * days" alone does not tell anybody whether today is included.
 */
export function PeriodSelector() {
  const styles = useStyles();
  const { t } = useTranslation();
  const key = usePeriod((s) => s.key);
  const setKey = usePeriod((s) => s.setKey);
  const range = periodRange(key);
  // Not LTR-isolated: a localised date carries its own month word, and forcing
  // it left-to-right reverses an Arabic date ("سبتمبر 1 2026").
  const day = (d: string) => formatDate(`${d}T00:00:00Z`);

  return (
    <View style={styles.wrap}>
      <SegmentedControl<PeriodKey>
        value={key}
        onChange={setKey}
        options={PERIOD_KEYS.map((k) => ({ value: k, label: t(`period.${k}` as never) }))}
      />
      <Text variant="caption" tone="secondary">
        {range.from === range.to
          ? t('period.oneDay', { day: day(range.from) })
          : t('period.range', { from: day(range.from), to: day(range.to) })}
      </Text>
    </View>
  );
}

const useStyles = makeStyles(() => ({
  wrap: { gap: space.xs },
}));
