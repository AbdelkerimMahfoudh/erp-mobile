import React from 'react';
import { StyleSheet, View } from 'react-native';
import { space } from '../../lib/design/tokens';
import { formatMoney } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { useRefundSummary } from '../../lib/returns';
import { Card, Divider, Section } from '../ui/Surface';
import { Text } from '../ui/Text';

/**
 * Refund money at closing time, with the three timings kept apart.
 *
 * They are deliberately not added together anywhere on this card, because
 * collapsing them is exactly how a refund gets counted twice:
 *
 *   approval date      profit reversed, a debt appeared
 *   report date        somebody says they paid — no money has moved
 *   confirmation date  cash actually left the till
 *
 * The outstanding figure is all-time and derived from immutable rows, so it
 * does not reset when a reporting period ends: a debt does not expire because
 * the month did.
 */
export function RefundReconciliation() {
  const { t } = useTranslation();
  const summary = useRefundSummary();

  // Nothing to say rather than a row of zeroes on a screen about today's cash.
  if (!summary.data) return null;
  const s = summary.data;
  const nothing =
    s.outstandingLiability.count === 0 &&
    s.awaitingConfirmation.count === 0 &&
    s.confirmed.count === 0;
  if (nothing) return null;

  return (
    <Section title={t('refund.recon.section')}>
      <Card>
        {/* Owed. All time, derived, not a period figure. */}
        <Row
          label={t('refund.recon.outstanding')}
          value={formatMoney(s.outstandingLiability.amount)}
          hint={t('refund.recon.outstandingHint', { count: s.outstandingLiability.count })}
          strong
        />
        {/* Claimed. Explicitly not cash. */}
        <Row
          label={t('refund.recon.awaiting')}
          value={formatMoney(s.awaitingConfirmation.amount)}
          hint={t('refund.recon.awaitingHint', { count: s.awaitingConfirmation.count })}
        />

        <Divider />

        {/* Paid. This is the only part that touched the till. */}
        <Text variant="caption" tone="secondary">
          {t('refund.recon.confirmedHeading')}
        </Text>
        <Row label={t('refund.method.cash')} value={formatMoney(s.confirmed.cash)} />
        {s.confirmed.byAccount.map((a) => (
          <Row key={a.label} label={a.label} value={formatMoney(a.amount)} />
        ))}

        <Text variant="caption" tone="tertiary" style={styles.footnote}>
          {t('refund.recon.timingNote')}
        </Text>
      </Card>
    </Section>
  );
}

function Row({
  label,
  value,
  hint,
  strong,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.labelCol}>
        <Text variant={strong ? 'bodyStrong' : 'body'} tone="secondary">
          {label}
        </Text>
        {hint ? (
          <Text variant="caption" tone="tertiary">
            {hint}
          </Text>
        ) : null}
      </View>
      <Text variant={strong ? 'bodyStrong' : 'body'}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md, marginTop: space.sm },
  labelCol: { flex: 1, gap: 2 },
  footnote: { marginTop: space.sm },
});
