import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { Chip, MoneyValue, StatusChip, Text, Thumbnail } from '../ui';
import { space, touch } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';
import { formatDateTime, formatMoney, formatTime } from '../../lib/format';
import { isRTL, useTranslation } from '../../lib/i18n';
import type { SaleListRow } from '../../types/api';

/**
 * One sale, as the Money screens list it (0074).
 *
 * The phone and its selling price are the headline; when it was sold and where
 * the money went sit under them. What was received, and what is still owed and
 * by whom, appear only when a balance remains — a fully paid sale is a short
 * row, a part-paid one says what matters. Status is colour AND words.
 *
 * Every figure is the server's. Nothing here adds or subtracts.
 */
export function SaleRow({
  sale,
  onPress,
  showDate = false,
}: {
  sale: SaleListRow;
  onPress: () => void;
  /** A week or month list shows the day under its heading; a flat list shows the date. */
  showDate?: boolean;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const owes = sale.balanceDue > 0;
  const where = sale.accountLabels.length > 0 ? sale.accountLabels.join(' · ') : sale.paymentMethods.map((m) => t(`payment.${m}` as never)).join(' · ');
  const when = showDate ? formatDateTime(sale.soldAt) : formatTime(sale.soldAt);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${sale.product ?? t('saleRow.noProduct', { invoice: sale.invoiceNo })}, ${formatMoney(sale.total)}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Thumbnail />
      <View style={styles.body}>
        <View style={styles.top}>
          <Text variant="bodyStrong" style={styles.title}>
            {sale.product ?? t('saleRow.noProduct', { invoice: sale.invoiceNo })}
          </Text>
          <MoneyValue value={sale.total} size="small" />
        </View>
        <Text variant="caption" tone="secondary">
          {[when, where].filter(Boolean).join(' · ')}
        </Text>
        {owes ? (
          <>
            <Text variant="caption" tone="secondary">
              {t('saleRow.received', { amount: formatMoney(sale.amountPaid) })} ·{' '}
              <Text variant="caption" tone="warning">
                {t('saleRow.owed', { amount: formatMoney(sale.balanceDue) })}
              </Text>
            </Text>
            {sale.debtor?.name ? (
              <Text variant="caption" tone="secondary">
                {t('saleRow.owedBy', { name: sale.debtor.name })}
              </Text>
            ) : null}
          </>
        ) : null}
        <View style={styles.chip}>
          {sale.cancelled ? <Chip label={t('saleDetail.cancelled.chip')} tone="neutral" size="sm" /> : <StatusChip domain="sale" value={sale.payStatus} size="sm" />}
        </View>
      </View>
      <ChevronRight
        size={18}
        color={colors.text.tertiary}
        style={isRTL() ? styles.flip : undefined}
      />
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
    minHeight: touch.comfortable,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.subtle,
  },
  pressed: { opacity: 0.6 },
  body: { flex: 1, minWidth: 0, gap: 2 },
  top: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.sm },
  title: { flex: 1 },
  chip: { flexDirection: 'row', paddingTop: 2 },
  flip: { transform: [{ scaleX: -1 }] },
}));
