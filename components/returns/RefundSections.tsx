import React from 'react';
import { StyleSheet, View } from 'react-native';
import { space } from '../../lib/design/tokens';
import { formatDateTime, formatMoney } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { CorrectionSection } from '../corrections';
import { Card, Section } from '../ui/Surface';
import { Chip } from '../ui/Chip';
import { Text } from '../ui/Text';
import type { ReturnDetail, ReturnPayout } from '../../types/api';

/**
 * The three refund states, said in words that cannot be misread.
 *
 * The wording carries the whole risk here. Money owed, money somebody SAYS they
 * handed over, and money a manager has vouched for are three different facts,
 * and a screen that blurs them is how a shop pays a refund twice.
 *
 * Only the confirmed state may use a success tone. Nothing here claims a bank
 * or a provider verified anything — the app never talked to one.
 */

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text variant={strong ? 'bodyStrong' : 'body'} tone="secondary">
        {label}
      </Text>
      <Text variant={strong ? 'bodyStrong' : 'body'}>{value}</Text>
    </View>
  );
}

/** How the money went out, from the frozen snapshot rather than a live lookup. */
function MethodRow({ payout }: { payout: ReturnPayout }) {
  const { t } = useTranslation();
  return (
    <Row
      label={t('refund.method')}
      value={
        payout.method === 'cash'
          ? t('refund.method.cash')
          : payout.accountLabel ?? t('refund.method.account')
      }
    />
  );
}

/** Approved, nobody has paid it yet. An obligation, stated as one. */
export function RefundDueSection({ detail }: { detail: ReturnDetail }) {
  const { t } = useTranslation();
  return (
    <Section title={t('refund.section')}>
      <Card>
        {/* Warning tone, never success: this is a debt, not a settlement. */}
        <Chip tone="warning" label={t('refund.due.status')} dot />
        <Text variant="caption" tone="secondary" style={styles.gap}>
          {t('refund.due.explain')}
        </Text>
        <Row label={t('returns.detail.gross')} value={formatMoney(detail.money.grossRefund)} />
        {detail.adjustments.map((a) => (
          <Row key={a.id} label={a.label} value={`-${formatMoney(a.totalAmount)}`} />
        ))}
        <Row label={t('refund.due.net')} value={formatMoney(detail.money.netRefundDue)} strong />
        <Text variant="caption" tone="tertiary" style={styles.gap}>
          {t('refund.phoneHeld')}
        </Text>
      </Card>
    </Section>
  );
}

/** Reported, waiting on a manager or owner. Still not money that has moved. */
export function RefundPendingSection({ payout }: { payout: ReturnPayout }) {
  const { t } = useTranslation();
  return (
    <Section title={t('refund.section')}>
      <Card>
        <Chip tone="warning" label={t('refund.pending.status')} dot />
        <Text variant="caption" tone="secondary" style={styles.gap}>
          {t('refund.pending.explain')}
        </Text>
        <Row label={t('refund.reportedAmount')} value={formatMoney(payout.reportedAmount)} strong />
        <MethodRow payout={payout} />
        {payout.transactionReference ? (
          <Row label={t('refund.reference')} value={payout.transactionReference} />
        ) : null}
        {payout.note ? <Row label={t('refund.note')} value={payout.note} /> : null}
        <Row label={t('refund.reportedBy')} value={payout.reportedBy ?? '—'} />
        {/* The SERVER's time, never the device clock. */}
        <Row label={t('refund.reportedAt')} value={formatDateTime(new Date(payout.reportedAt))} />
        <Text variant="caption" tone="tertiary" style={styles.gap}>
          {t('refund.phoneHeld')}
        </Text>
      </Card>
    </Section>
  );
}

/** Confirmed. The only state allowed a success tone. */
export function RefundConfirmedSection({
  payout,
  onChanged,
}: {
  payout: ReturnPayout;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Section title={t('refund.section')}>
      <Card>
        <Chip tone="success" label={t('refund.confirmed.status')} dot />
        <Row label={t('refund.confirmedAmount')} value={formatMoney(payout.reportedAmount)} strong />
        <MethodRow payout={payout} />
        {payout.transactionReference ? (
          <Row label={t('refund.reference')} value={payout.transactionReference} />
        ) : null}
        <Row label={t('refund.reportedBy')} value={payout.reportedBy ?? '—'} />
        <Row label={t('refund.confirmedBy')} value={payout.confirmedBy ?? '—'} />
        {payout.confirmedAt ? (
          <Row label={t('refund.confirmedAt')} value={formatDateTime(new Date(payout.confirmedAt))} />
        ) : null}
        {/* The refund is settled; the phone is not back on sale. */}
        <Text variant="caption" tone="tertiary" style={styles.gap}>
          {t('refund.phoneHeld')}
        </Text>
      </Card>

      {/*
        Correcting it (Milestone B). A confirmed payout cannot be edited, so
        this is the only remedy for one that was wrong — and it appears only
        for a role allowed to ask.
      */}
      <CorrectionSection
        targetKind="refund_payout"
        targetId={payout.id}
        amount={payout.reportedAmount}
        correction={payout.correction}
        onChanged={onChanged}
      />
    </Section>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md, marginTop: space.xs },
  gap: { marginTop: space.xs },
});
