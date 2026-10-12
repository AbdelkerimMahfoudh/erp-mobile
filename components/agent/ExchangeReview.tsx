import React from 'react';
import { View } from 'react-native';
import { Card, Divider, MoneyValue, Text } from '../ui';
import { AMOUNT_LABEL, AMOUNT_ROW } from '../../lib/design/amount-row';
import { isolateLtr } from '../../lib/design/direction';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { useTranslation } from '../../lib/i18n';
import type { AgentDirection, ExchangePreview } from '../../lib/agent-rules';

/**
 * The one review before Confirm (docs/73 §5.2, A5, D164): the amount and the
 * commission the employee typed, then what each side moves — the cash the
 * customer hands over (the amount plus the commission) or is handed (the
 * amount less the commission), and the provider's credit sent or received,
 * which is always the amount — then the customer's number and the reference as
 * typed. The commission is the business's, paid by the customer: the provider
 * neither pays nor checks it, and it never changes the credit. The server
 * records exactly these figures, with the person signed in.
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
  const creditIn = preview.credit.direction === 'inflow';
  const decimals = [preview.amount, preview.commission, preview.cash.amount].some((v) => Math.round(v * 100) % 100 !== 0) ? 2 : 0;
  return (
    <Card style={styles.card}>
      <Text variant="heading">{t(`agent.direction.${direction}`, { provider })}</Text>

      <View style={styles.lines}>
        <Line label={t('agent.review.amount')} value={preview.amount} decimals={decimals} plain />
        <Line label={t('agent.review.commission')} value={preview.commission} decimals={decimals} plain />
        <Text variant="caption" tone="secondary">
          {t('agent.review.commissionNote', { provider })}
        </Text>
      </View>

      <Divider />

      <View style={styles.lines}>
        <Line label={cashIn ? t('agent.review.cashReceived') : t('agent.review.cashHanded')} value={cashIn ? preview.cash.amount : -preview.cash.amount} decimals={decimals} />
        <Line
          label={creditIn ? t('agent.review.creditReceived', { provider }) : t('agent.review.creditSent', { provider })}
          value={creditIn ? preview.credit.amount : -preview.credit.amount}
          decimals={decimals}
        />
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

/** A figure: its words, and — for a movement — the amount signed the way the money goes, into the account or out of it. */
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
