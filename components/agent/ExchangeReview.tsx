import React from 'react';
import { View } from 'react-native';
import { Card, Divider, MoneyValue, Text } from '../ui';
import { AMOUNT_LABEL, AMOUNT_ROW } from '../../lib/design/amount-row';
import { isolateLtr } from '../../lib/design/direction';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { useTranslation } from '../../lib/i18n';
import { percentOfBp, type AgentDirection, type ExchangePreview } from '../../lib/agent-rules';

/**
 * The one review before Confirm (docs/73 §5.2, A5): both principal movements
 * in words and figures — the drawer and the provider's float — then the
 * commission, its rate and where it goes as the provider is configured, then
 * the customer's number and the reference as typed. Every figure is the
 * configured rate applied to the amount; the server calculates it again and
 * its own is the one recorded.
 */
export function ExchangeReview({
  direction,
  provider,
  preview,
  customerNumber,
  reference,
}: {
  direction: AgentDirection;
  provider: string;
  preview: ExchangePreview;
  customerNumber: string;
  reference: string | null;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const cashIn = preview.cash.direction === 'inflow';
  const floatIn = preview.float.direction === 'inflow';
  const decimals = [preview.cash.amount, preview.float.amount, preview.commission].some((v) => Math.round(v * 100) % 100 !== 0) ? 2 : 0;
  const commissionWhere =
    preview.feeMode === 'deducted'
      ? t('agent.commission.deducted', { provider })
      : t(`agent.commission.${preview.destination}`, { provider });
  return (
    <Card style={styles.card}>
      <Text variant="heading">{t(`agent.direction.${direction}`, { provider })}</Text>

      <View style={styles.lines}>
        <Line label={cashIn ? t('agent.review.cashIn') : t('agent.review.cashOut')} value={cashIn ? preview.cash.amount : -preview.cash.amount} decimals={decimals} />
        <Line
          label={floatIn ? t('agent.review.floatIn', { provider }) : t('agent.review.floatOut', { provider })}
          value={floatIn ? preview.float.amount : -preview.float.amount}
          decimals={decimals}
        />
      </View>

      <Divider />

      <View style={styles.lines}>
        <Line label={t('agent.review.commission', { rate: isolateLtr(percentOfBp(preview.rateBp)) })} value={preview.commission} decimals={decimals} plain />
        <Text variant="caption" tone="secondary">
          {commissionWhere}
        </Text>
      </View>

      <Divider />

      <View style={styles.lines}>
        <View style={[AMOUNT_ROW, styles.line]}>
          <View style={AMOUNT_LABEL}>
            <Text variant="body" tone="secondary">
              {t('agent.number')}
            </Text>
          </View>
          <Text variant="bodyStrong">{isolateLtr(customerNumber)}</Text>
        </View>
        {reference ? (
          <View style={[AMOUNT_ROW, styles.line]}>
            <View style={AMOUNT_LABEL}>
              <Text variant="body" tone="secondary">
                {t('agent.reference')}
              </Text>
            </View>
            <Text variant="bodyStrong">{isolateLtr(reference)}</Text>
          </View>
        ) : null}
      </View>
    </Card>
  );
}

/** A movement: its words, and the amount signed the way the money goes — into the account or out of it. */
function Line({ label, value, decimals, plain }: { label: string; value: number; decimals: number; plain?: boolean }) {
  const styles = useStyles();
  return (
    <View style={[AMOUNT_ROW, styles.line]}>
      <View style={AMOUNT_LABEL}>
        <Text variant="body">{label}</Text>
      </View>
      <MoneyValue value={value} size="small" signed={!plain} tone={plain ? 'default' : 'auto'} decimals={decimals} />
    </View>
  );
}

const useStyles = makeStyles(() => ({
  card: { gap: space.md },
  lines: { gap: space.xs },
  line: { minHeight: 32 },
}));
