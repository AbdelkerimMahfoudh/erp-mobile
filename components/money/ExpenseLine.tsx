import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { MoneyValue, Text } from '../ui';
import { space, touch } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';
import { formatMoney, formatTime } from '../../lib/format';
import { isRTL, useTranslation } from '../../lib/i18n';
import type { ExpenseToday } from '../../lib/money-overview';

/** One expense paid today: what for, where it came from and when, how much. */
export function ExpenseLine({ expense: e, onPress }: { expense: ExpenseToday; onPress?: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const source = e.method === 'cash' ? t('moneyOverview.paidFromCash') : e.accountLabel;
  const body = (
    <>
      <View style={styles.grow}>
        <Text variant="body">{e.description}</Text>
        <Text variant="caption" tone="secondary">
          {[source, e.paidAt ? formatTime(e.paidAt) : null].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <MoneyValue value={e.amount} size="small" />
      {onPress ? (
        <View style={isRTL() ? styles.flip : undefined}>
          <ChevronRight size={18} color={colors.text.tertiary} />
        </View>
      ) : null}
    </>
  );
  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${e.description}, ${formatMoney(e.amount)}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: touch.min,
    paddingVertical: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.subtle,
  },
  pressed: { opacity: 0.6 },
  grow: { flex: 1, minWidth: 0 },
  flip: { transform: [{ scaleX: -1 }] },
}));
