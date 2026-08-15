import React, { useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Identifier,
  Screen,
  Section,
  SkeletonList,
  StatusChip,
  Text,
  WorkflowTimeline,
} from '../../components/ui';
import { ApiError } from '../../lib/api-client';
import { space } from '../../lib/design/tokens';
import { dialog } from '../../lib/dialog';
import { formatDateTime, formatMoney } from '../../lib/format';
import { returnStages } from '../../lib/return-timeline';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import { describeWindow } from '../../lib/return-policy';
import {
  handleConflict,
  refundConflictKind,
  useApproveReturn,
  useConfirmRefund,
  useCorrectRefund,
  useReceiveCustody,
  useRejectReturn,
  useReportRefund,
  useReturn,
} from '../../lib/returns';
import { canShareRefundReceipt, shareRefundReceipt } from '../../lib/refund-receipt';
import { uuidv4 } from '../../lib/utils';
import { toast } from '../../lib/toast';
import { InvestigationSheet } from '../../components/returns/InvestigationSheet';
import { RefundPayoutSheet } from '../../components/returns/RefundPayoutSheet';
import {
  RefundConfirmedSection,
  RefundDueSection,
  RefundPendingSection,
} from '../../components/returns/RefundSections';
import { CustodySheet } from '../../components/returns/CustodySheet';
import type { RefundMethod, ReturnDetail } from '../../types/api';

/**
 * One return, in full.
 *
 * The financial wording carries the weight here. Before approval every figure
 * is labelled provisional; after approval it is the agreed, immutable amount —
 * and the screen says "refund due, payment not yet confirmed" rather than
 * anything that could be read as money having changed hands. I2 records an
 * obligation; paying it is I3.
 */
export default function ReturnDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useReturn(id);

  return (
    <Screen scroll={false}>
      <Stack.Screen options={{ headerShown: true, title: t('returns.detail.title') }} />
      {query.isLoading ? (
        <View style={styles.padded}>
          <SkeletonList count={4} />
        </View>
      ) : query.isError ? (
        query.error instanceof ApiError && query.error.status === 404 ? (
          // Unknown, another branch's and another company's all answer the same
          // 404 by design, so the screen suggests the one cause a user can act on.
          <EmptyState title={t('returns.detail.notFound')} body={t('returns.detail.notFoundBody')} />
        ) : (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        )
      ) : query.data ? (
        <Body detail={query.data} refetch={() => void query.refetch()} />
      ) : null}
    </Screen>
  );
}

function Body({ detail, refetch }: { detail: ReturnDetail; refetch: () => void }) {
  const { t } = useTranslation();
  const canRequest = usePermission('return.request');
  const canReview = usePermission('return.review');
  const canApprove = usePermission('return.approve');
  const canReject = usePermission('return.reject');
  const canException = usePermission('return.exception');

  const canReportRefund = usePermission('refund.report');
  const canConfirmRefund = usePermission('refund.confirm');

  const report = useReportRefund(detail.id);
  const correct = useCorrectRefund(detail.id);
  const confirm = useConfirmRefund(detail.id);

  const [payoutSheet, setPayoutSheet] = useState<null | 'report' | 'correct'>(null);
  const [sharing, setSharing] = useState(false);

  /**
   * One request id per logical report, held in a ref so a re-render cannot
   * mint a new one. A fresh id per attempt would defeat idempotency: a
   * timeout followed by a retry would record a second payout.
   */
  const reportRequestId = useRef<string>(uuidv4());

  const [custodyOpen, setCustodyOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);

  const approve = useApproveReturn(detail.id);
  const reject = useRejectReturn(detail.id);
  const custody = useReceiveCustody(detail.id);

  const payout = detail.payout;
  const awaitingReport = detail.status === 'approved_refund_due' && !payout;
  const pending = payout?.status === 'reported_pending_confirmation';
  const confirmed = payout?.status === 'confirmed';

  /** Turn a refund conflict into the sentence that actually explains it. */
  const explainRefundConflict = async (e: unknown): Promise<boolean> => {
    const kind = refundConflictKind(e);
    if (!kind) return false;
    refetch();
    await dialog.alert({
      title: t(`refund.conflict.${kind}.title` as never),
      message: t(`refund.conflict.${kind}.body` as never),
    });
    return true;
  };

  const onReport = async (input: {
    method: RefundMethod;
    receivingAccountId?: string;
    transactionReference?: string;
    note?: string;
  }) => {
    // Said before anything is sent: a report is a claim, not a settlement.
    const ok = await dialog.confirm({
      title: t('refund.report.confirm.title'),
      message: t('refund.report.confirm.body', {
        amount: formatMoney(detail.money.netRefundDue),
      }),
      confirmLabel: t('refund.report.confirm.action'),
      cancelLabel: t('action.cancel'),
    });
    if (!ok) return;
    try {
      await report.mutateAsync({
        reportedAmount: detail.money.netRefundDue,
        clientUuid: reportRequestId.current,
        ...input,
      });
      setPayoutSheet(null);
      toast.success(t('refund.report.done'));
      // The id is deliberately NOT regenerated: the next attempt is a retry
      // of this one and must resolve to the same payout.
    } catch (e) {
      if (await explainRefundConflict(e)) return;
      toast.error(t('refund.report.failed'));
    }
  };

  const onCorrect = async (input: {
    method: RefundMethod;
    receivingAccountId?: string;
    transactionReference?: string;
    note?: string;
  }) => {
    if (!payout) return;
    try {
      await correct.mutateAsync({ expectedVersion: payout.version, ...input });
      setPayoutSheet(null);
      toast.success(t('refund.correct.done'));
    } catch (e) {
      if (await explainRefundConflict(e)) return;
      toast.error(t('refund.correct.failed'));
    }
  };

  const onConfirm = async () => {
    if (!payout) return;
    /**
     * High friction on purpose. This is the moment the shop states that the
     * customer has their money; there is no pending state to fall back to
     * afterwards, so everything being vouched for is on screen first.
     */
    const ok = await dialog.confirm({
      title: t('refund.confirm.title'),
      message: [
        t('refund.confirm.irreversible'),
        '',
        `${t('returns.detail.sale')}: ${detail.sale.invoiceNo}`,
        `${t('returns.detail.phone')}: ${detail.phone.product}`,
        `${t('refund.confirmedAmount')}: ${formatMoney(payout.reportedAmount)}`,
        `${t('refund.method')}: ${
          payout.method === 'cash'
            ? t('refund.method.cash')
            : payout.accountLabel ?? t('refund.method.account')
        }`,
        `${t('refund.reportedBy')}: ${payout.reportedBy ?? '\u2014'}`,
        `${t('refund.reportedAt')}: ${formatDateTime(new Date(payout.reportedAt))}`,
      ].join('\n'),
      confirmLabel: t('refund.confirm.action'),
      cancelLabel: t('action.cancel'),
    });
    if (!ok) return;
    try {
      // Nothing is marked confirmed locally first. The server decides.
      await confirm.mutateAsync({ expectedVersion: payout.version });
      toast.success(t('refund.confirm.done'));
    } catch (e) {
      if (await explainRefundConflict(e)) return;
      toast.error(t('refund.confirm.failed'));
    }
  };

  const onShareReceipt = async () => {
    setSharing(true);
    try {
      // Generated ONLY from the immutable confirmed-refund API, never from
      // whatever this screen happens to be holding.
      const shared = await shareRefundReceipt(detail.id);
      if (!shared) toast.error(t('refund.receipt.unavailable'));
    } catch {
      // A failed share changes nothing about the confirmed record.
      toast.error(t('refund.receipt.failed'));
    } finally {
      setSharing(false);
    }
  };

  const decided = detail.status === 'approved_refund_due' || detail.status === 'rejected';
  const approved = detail.status === 'approved_refund_due';
  /** The two Owner-only cases, exactly as the server decides them. */
  const isException = detail.policy.requiresException || detail.responsibility === 'customer_damage';

  const onApprove = async () => {
    if (isException && !canException) {
      toast.warning(t('returns.approve.notAllowed'));
      return;
    }

    const summary = t('returns.approve.body', { amount: formatMoney(detail.money.netRefundDue) });

    if (isException) {
      const res = await dialog.confirmWithReason({
        title: t('returns.approve.exceptionTitle'),
        message: `${summary}\n\n${t('returns.approve.exceptionBody')}`,
        reasonLabel: t('returns.approve.exceptionReason'),
        confirmLabel: t('returns.approve.action'),
        tone: 'danger',
      });
      if (!res.confirmed || !res.reason?.trim()) return;
      try {
        await approve.mutateAsync({ expectedVersion: detail.version, exceptionReason: res.reason.trim() });
        toast.success(t('returns.approve.done'));
      } catch (e) {
        if (!handleConflict(e, refetch)) throw e;
      }
      return;
    }

    const ok = await dialog.confirm({
      title: t('returns.approve.title'),
      message: summary,
      confirmLabel: t('returns.approve.action'),
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await approve.mutateAsync({ expectedVersion: detail.version });
      toast.success(t('returns.approve.done'));
    } catch (e) {
      if (!handleConflict(e, refetch)) throw e;
    }
  };

  const onReject = async () => {
    const res = await dialog.confirmWithReason({
      title: t('returns.reject.title'),
      message: detail.custody === 'store_holds' ? t('returns.reject.handBack') : '',
      reasonLabel: t('returns.reject.reason'),
      confirmLabel: t('returns.reject.action'),
      tone: 'danger',
    });
    if (!res.confirmed || !res.reason?.trim()) return;
    try {
      await reject.mutateAsync({ expectedVersion: detail.version, reason: res.reason.trim() });
      toast.success(t('returns.reject.done'));
    } catch (e) {
      if (!handleConflict(e, refetch)) throw e;
    }
  };

  return (
    <>
      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <View style={styles.headRow}>
            <StatusChip domain="return" value={detail.status} />
            <StatusChip domain="custody" value={detail.custody} size="sm" />
          </View>
          {/* The sentence that must never be mistaken for a payment. */}
          {approved ? (
            <View style={styles.notice}>
              <Text variant="bodyStrong">{t('returns.detail.dueNotPaid')}</Text>
              <Text variant="caption" tone="secondary">
                {t('returns.detail.heldNotSellable')}
              </Text>
            </View>
          ) : null}
        </Card>

        <Section title={t('returns.detail.phone')}>
          <Card>
            <Text variant="bodyStrong">{detail.phone.product}</Text>
            {detail.phone.imei ?? detail.phone.serialNo ? (
              <Identifier>{detail.phone.imei ?? detail.phone.serialNo}</Identifier>
            ) : null}
            <View style={styles.inlineChips}>
              <StatusChip domain="unit" value={detail.phone.unitStatus} size="sm" />
            </View>
          </Card>
        </Section>

        <Section title={t('returns.detail.sale')}>
          <Card>
            <Text variant="body">{t('sales.invoice', { no: detail.sale.invoiceNo })}</Text>
            <Text variant="caption" tone="secondary">
              {formatDateTime(new Date(detail.sale.soldAt))}
            </Text>
          </Card>
        </Section>

        <Section title={t('returns.detail.policy')}>
          <Card>
            <Text variant="body">
              {detail.policy.windowHours > 0
                ? describeWindow(detail.policy.windowHours, t)
                : t('returns.window.none')}
            </Text>
            {detail.policy.deadlineAt ? (
              <Text variant="caption" tone="secondary">
                {t('returns.status.until', { deadline: formatDateTime(new Date(detail.policy.deadlineAt)) })}
              </Text>
            ) : null}
            {detail.policy.requiresException ? (
              <Chip label={t('returns.exceptionNeeded')} tone="warning" size="sm" style={styles.chipTop} />
            ) : null}
          </Card>
        </Section>

        <Section title={t('returns.detail.investigation')}>
          <Card>
            <Text variant="label" tone="secondary">
              {t('returns.detail.reason')}
            </Text>
            <Text variant="body">{detail.requestReason}</Text>
            {detail.conditionNotes ? (
              <>
                <Text variant="label" tone="secondary" style={styles.chipTop}>
                  {t('returns.detail.notes')}
                </Text>
                <Text variant="body">{detail.conditionNotes}</Text>
              </>
            ) : null}
            <View style={styles.inlineChips}>
              <StatusChip domain="responsibility" value={detail.responsibility} size="sm" />
            </View>
            {detail.responsibilityNotes ? (
              <Text variant="caption" tone="secondary">
                {detail.responsibilityNotes}
              </Text>
            ) : null}
          </Card>
        </Section>

        <Section title={t('returns.detail.money')}>
          <Card>
            {/* Provisional before approval, agreed after. Never "refunded". */}
            <Text variant="caption" tone={approved ? 'secondary' : 'warning'}>
              {approved ? t('returns.detail.final') : t('returns.detail.provisional')}
            </Text>
            <Amount label={t('returns.detail.gross')} value={detail.money.grossRefund} />
            {detail.adjustments.length > 0 ? (
              detail.adjustments.map((a) => (
                <Amount
                  key={a.id}
                  label={`${t(`returns.adjustment.${a.kind}` as never)} — ${a.label}`}
                  value={-a.totalAmount}
                  small
                />
              ))
            ) : (
              <Text variant="caption" tone="tertiary">
                {t('returns.detail.noAdjustments')}
              </Text>
            )}
            <Amount label={t('returns.detail.net')} value={detail.money.netRefundDue} strong />
            {/* Absent means gated, not zero. */}
            <View style={styles.amountRow}>
              <Text variant="body" tone="secondary">
                {t('returns.detail.cost')}
              </Text>
              <Text variant="body">
                {detail.money.cost === undefined ? t('returns.detail.hidden') : formatMoney(detail.money.cost)}
              </Text>
            </View>
          </Card>
        </Section>

        {/* One of three, never two: owed, claimed, or vouched for. */}
        {awaitingReport ? <RefundDueSection detail={detail} /> : null}
        {pending && payout ? <RefundPendingSection payout={payout} /> : null}
        {confirmed && payout ? <RefundConfirmedSection payout={payout} onChanged={refetch} /> : null}

        {/*
          The workflow, not the event log.

          The server's `detail.timeline` is an append-only record of what has
          happened — faithful, but it cannot show a stage that has NOT happened,
          so everything still to come was invisible and every row looked
          identical. `returnStages` maps the lifecycle instead, and each stage
          differs in shape before it differs in colour.

          The rule this protects: due, reported and confirmed are three
          different amounts of certainty about the same money, and only
          confirmed is ever allowed to read as settled.
        */}
        <Section title={t('returns.detail.timeline')}>
          <Card>
            <WorkflowTimeline
              steps={returnStages(detail).map((stage) => {
                const event = detail.timeline.find((e) => e.event === stage.key);
                const at = stage.at ?? event?.at ?? null;
                const by = stage.by ?? event?.by ?? null;
                return {
                  key: stage.key,
                  label: t(`returns.stage.${stage.key}` as never),
                  detail: by ?? undefined,
                  // Only stamp a time on something that actually happened.
                  timestamp: at ? formatDateTime(new Date(at)) : undefined,
                  state: stage.state,
                };
              })}
            />
          </Card>
        </Section>
      </ScrollView>

      {/* Actions are gated by permission AND by lifecycle: a reachable route
          never implies an available action. */}
      {!decided ? (
        <View style={styles.actions}>
          {canRequest && detail.custody === 'customer_holds' ? (
            <Button title={t('returns.custody.action')} variant="secondary" onPress={() => setCustodyOpen(true)} />
          ) : null}
          {canReview ? (
            <Button title={t('returns.review.action')} variant="secondary" onPress={() => setReviewOpen(true)} />
          ) : null}
          {canApprove ? (
            <Button
              title={t('returns.approve.action')}
              onPress={() => void onApprove()}
              loading={approve.isPending}
              disabled={detail.custody !== 'store_holds'}
            />
          ) : null}
          {canReject ? (
            <Button
              title={t('returns.reject.action')}
              variant="tertiary"
              onPress={() => void onReject()}
              loading={reject.isPending}
            />
          ) : null}
        </View>
      ) : null}

      {/*
        Refund actions. Permission AND lifecycle, both required: an Employee
        never sees correct or confirm, and nobody sees report before the
        return is approved or after somebody already reported one.
      */}
      {awaitingReport && canReportRefund ? (
        <View style={styles.actions}>
          <Button
            title={t('refund.report.action')}
            onPress={() => setPayoutSheet('report')}
            loading={report.isPending}
          />
        </View>
      ) : null}

      {pending && canConfirmRefund ? (
        <View style={styles.actions}>
          <Button
            title={t('refund.correct.action')}
            variant="secondary"
            onPress={() => setPayoutSheet('correct')}
            loading={correct.isPending}
          />
          <Button
            title={t('refund.confirm.action')}
            onPress={() => void onConfirm()}
            loading={confirm.isPending}
          />
        </View>
      ) : null}

      {/* Sharing needs a native share sheet; on web the button stays hidden
          rather than offering something that cannot work. */}
      {confirmed && canShareRefundReceipt() ? (
        <View style={styles.actions}>
          <Button
            title={t('refund.receipt.action')}
            variant="secondary"
            onPress={() => void onShareReceipt()}
            loading={sharing}
          />
        </View>
      ) : null}

      <RefundPayoutSheet
        open={payoutSheet !== null}
        onClose={() => setPayoutSheet(null)}
        mode={payoutSheet ?? 'report'}
        netAmountDue={detail.money.netRefundDue}
        payout={payout}
        submitting={report.isPending || correct.isPending}
        onSubmit={payoutSheet === 'correct' ? onCorrect : onReport}
      />
      <CustodySheet
        open={custodyOpen}
        onClose={() => setCustodyOpen(false)}
        detail={detail}
        submitting={custody.isPending}
        onSubmit={async (identifier) => {
          try {
            await custody.mutateAsync({ identifier, expectedVersion: detail.version });
            toast.success(t('returns.custody.done'));
            setCustodyOpen(false);
          } catch (e) {
            if (!handleConflict(e, refetch)) throw e;
            setCustodyOpen(false);
          }
        }}
      />

      <InvestigationSheet
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        detail={detail}
        refetch={refetch}
      />
    </>
  );
}

function Amount({
  label,
  value,
  strong,
  small,
}: {
  label: string;
  value: number;
  strong?: boolean;
  small?: boolean;
}) {
  return (
    <View style={styles.amountRow}>
      <Text
        variant={strong ? 'bodyStrong' : small ? 'caption' : 'body'}
        tone={strong ? 'primary' : 'secondary'}
        numberOfLines={2}
        style={styles.amountLabel}
      >
        {label}
      </Text>
      <Text variant={strong ? 'bodyStrong' : small ? 'caption' : 'body'}>{formatMoney(value)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  padded: { padding: space.base },
  content: { padding: space.base, paddingBottom: space['5xl'], gap: space.base },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  notice: { marginTop: space.sm, gap: space.xs },
  inlineChips: { flexDirection: 'row', gap: space.xs, marginTop: space.sm, flexWrap: 'wrap' },
  chipTop: { marginTop: space.sm },
  amountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: space.xs,
    gap: space.sm,
  },
  amountLabel: { flexShrink: 1 },
  timelineRow: { marginTop: space.sm },
  actions: {
    position: 'absolute',
    left: space.base,
    right: space.base,
    bottom: space.base,
    gap: space.xs,
  },
});
