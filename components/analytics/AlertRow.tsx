import React, { useState } from 'react';
import { View } from 'react-native';
import { Button, Chip, Text } from '../ui';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { toErrorMessage } from '../../lib/errors';
import { formatMoney, formatSmartDateTime } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { toast } from '../../lib/toast';
import { anomalyKind } from '../../lib/attention-rules';
import { useDismissAnomaly, useUndismissAnomaly, type Anomaly } from '../../lib/anomalies';

/**
 * One alert, the same row on the Analyses overview and in the full list.
 *
 * Compact on purpose: the rule it came from and when it became true, the one
 * sentence with the figures that produced it, and a single "I understand".
 * No card, no image — an alert is a line somebody reads and answers.
 */

/** The rules that have a short name. Anything else is described by its weight. */
const KIND_LABELS = {
  dead_stock: 'attention.kind.dead_stock',
  overdue_debt: 'attention.kind.overdue_debt',
  seller_margin_drop: 'attention.kind.seller_margin_drop',
  cash_shortfall: 'attention.kind.cash_shortfall',
  below_cost_cluster: 'attention.kind.below_cost_cluster',
  low_stock: 'attention.kind.low_stock',
} as const;

export function AlertRow({
  row,
  pending,
  onAcknowledge,
}: {
  row: Anomaly;
  /** True while THIS row's acknowledgement is on its way. */
  pending: boolean;
  onAcknowledge: (row: Anomaly) => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();

  /*
   * Money in the parameters is formatted here, not by the server. The server
   * sends a number; how many decimals and which separator a reader expects is a
   * question about their locale, and it already has one answer in `formatMoney`.
   */
  const values: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(row.params)) {
    values[key] = key === 'amount' && typeof value === 'number' ? formatMoney(value) : value;
  }

  const kind = anomalyKind(row.code) as keyof typeof KIND_LABELS;
  const kindLabel =
    kind in KIND_LABELS
      ? t(KIND_LABELS[kind])
      : t(row.severity === 'caution' ? 'attention.severity.caution' : 'attention.severity.info');

  return (
    <View style={styles.row} accessibilityRole="summary">
      <View style={styles.meta}>
        {/* Type and weight in a word as well as a colour. */}
        <Chip tone={row.severity === 'caution' ? 'warning' : 'info'} label={kindLabel} size="sm" dot />
        {row.at ? (
          <Text variant="caption" tone="tertiary">
            {formatSmartDateTime(row.at)}
          </Text>
        ) : null}
      </View>
      <Text variant="body">{t(row.messageKey as never, values)}</Text>
      <View style={styles.actions}>
        <Button
          title={t('attention.ack')}
          variant="tertiary"
          size="sm"
          disabled={pending}
          loading={pending}
          onPress={() => onAcknowledge(row)}
          accessibilityLabel={t('attention.ack')}
        />
      </View>
    </View>
  );
}

/**
 * "I understand", with a way back.
 *
 * The row goes at once — the server answers a repeat with the dismissal that
 * already stands, so a double tap is one decision — and the toast offers Undo
 * for as long as it shows. docs/05 prefers undo to a confirmation dialog, and
 * here it is also faster: three alerts, three taps, no questions.
 */
export function useAcknowledge() {
  const { t } = useTranslation();
  const dismiss = useDismissAnomaly();
  const undismiss = useUndismissAnomaly();
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const acknowledge = async (row: Anomaly) => {
    setPendingKey(row.key);
    try {
      await dismiss.mutateAsync(row.key);
      toast.success(t('attention.dismissed'), {
        action: {
          label: t('attention.undo'),
          onPress: () =>
            undismiss.mutate(row.key, {
              onSuccess: () => toast.info(t('attention.restored')),
              onError: (e) => toast.error(toErrorMessage(e)),
            }),
        },
      });
    } catch (e) {
      toast.error(toErrorMessage(e));
    } finally {
      setPendingKey(null);
    }
  };

  return { acknowledge, pendingKey };
}

const useStyles = makeStyles(() => ({
  row: { paddingHorizontal: space.md, paddingVertical: space.sm, gap: space.xs },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  actions: { flexDirection: 'row', justifyContent: 'flex-end' },
}));
