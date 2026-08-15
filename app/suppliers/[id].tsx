import React, { useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Screen,
  Section,
  MoneyValue,
  SkeletonList,
  Text,
} from '../../components/ui';
import { SupplierPaymentSheet } from '../../components/suppliers/SupplierPaymentSheet';
import { CorrectionSection } from '../../components/corrections';
import { ApiError } from '../../lib/api-client';
import { space } from '../../lib/design/tokens';
import { dialog } from '../../lib/dialog';
import { formatDateTime, formatMoney } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import {
  paymentProblems,
  supplierConflictKind,
  useConfirmPayment,
  useReportPayment,
  useSupplier,
  useUpdateSupplier,
} from '../../lib/suppliers';
import { toast } from '../../lib/toast';
import { uuidv4 } from '../../lib/utils';
import type { SupplierDetail, SupplierSettlement } from '../../types/api';

/**
 * One supplier: who they are, what is owed, and what has been paid.
 *
 * The ledger half is absent entirely for anyone without permission — an
 * Employee gets the contact details receiving needs and nothing about the
 * company's debts.
 */
export default function SupplierDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useSupplier(id);

  return (
    <Screen scroll={false}>
      <Stack.Screen options={{ headerShown: true, title: t('suppliers.detail.title') }} />
      {query.isLoading ? (
        <SkeletonList count={4} />
      ) : query.isError ? (
        query.error instanceof ApiError && query.error.status === 404 ? (
          <EmptyState title={t('suppliers.notFound')} body={t('suppliers.notFoundBody')} />
        ) : (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        )
      ) : query.data ? (
        <Body supplier={query.data} refetch={() => void query.refetch()} />
      ) : null}
    </Screen>
  );
}

function Body({ supplier, refetch }: { supplier: SupplierDetail; refetch: () => void }) {
  const { t } = useTranslation();
  const canManage = usePermission('supplier.manage');
  const canReport = usePermission('supplier.payment.report');
  const canConfirm = usePermission('supplier.payment.confirm');

  const update = useUpdateSupplier(supplier.id);
  const report = useReportPayment(supplier.id);
  const confirm = useConfirmPayment(supplier.id);

  const [paying, setPaying] = useState(false);
  /** One request id per attempt, so a retry cannot record two payments. */
  const requestId = useRef<string>(uuidv4());

  const ledger = supplier.ledger;
  const pending = ledger?.settlements.filter((s) => s.status === 'reported') ?? [];
  const confirmed = ledger?.settlements.filter((s) => s.status === 'confirmed') ?? [];

  const explainConflict = async (e: unknown): Promise<boolean> => {
    const kind = supplierConflictKind(e);
    if (!kind) return false;
    refetch();
    await dialog.alert({
      title: t(`suppliers.conflict.${kind}.title` as never),
      message: t(`suppliers.conflict.${kind}.body` as never),
    });
    return true;
  };

  const onToggleActive = async () => {
    const ok = await dialog.confirm({
      title: t(supplier.isActive ? 'suppliers.deactivate.title' : 'suppliers.reactivate.title'),
      message: t(supplier.isActive ? 'suppliers.deactivate.body' : 'suppliers.reactivate.body'),
      confirmLabel: t(supplier.isActive ? 'suppliers.deactivate.action' : 'suppliers.reactivate.action'),
      cancelLabel: t('action.cancel'),
      tone: supplier.isActive ? 'danger' : 'default',
    });
    if (!ok) return;
    try {
      await update.mutateAsync({ isActive: !supplier.isActive });
      toast.success(t(supplier.isActive ? 'suppliers.deactivated' : 'suppliers.reactivated'));
    } catch (e) {
      if (await explainConflict(e)) return;
      toast.error(t('suppliers.updateFailed'));
    }
  };

  const onReport = async (input: Parameters<Parameters<typeof SupplierPaymentSheet>[0]['onSubmit']>[0]) => {
    const ok = await dialog.confirm({
      title: t('suppliers.pay.confirm.title', { amount: formatMoney(input.amount) }),
      message: t('suppliers.pay.confirm.body'),
      confirmLabel: t('suppliers.pay.confirm.action'),
      cancelLabel: t('action.cancel'),
    });
    if (!ok) return;
    try {
      await report.mutateAsync({
        supplierId: supplier.id,
        clientUuid: requestId.current,
        ...input,
      });
      setPaying(false);
      toast.success(t('suppliers.pay.done'));
      // Not regenerated: the next attempt is a retry of this one.
    } catch (e) {
      const problems = paymentProblems(e);
      if (problems.length > 0) {
        await dialog.alert({
          title: t('suppliers.pay.problems'),
          message: problems.map((p) => `${p.label} — ${p.reason}`).join('\n'),
        });
        return;
      }
      if (await explainConflict(e)) return;
      toast.error(t('suppliers.pay.failed'));
    }
  };

  const onConfirm = async (s: SupplierSettlement) => {
    /**
     * High friction: this states that the money has left the shop, and there
     * is no pending state to fall back to afterwards.
     */
    const ok = await dialog.confirm({
      title: t('suppliers.confirm.title'),
      message: [
        t('suppliers.confirm.irreversible'),
        '',
        `${t('suppliers.detail.supplier')}: ${supplier.name}`,
        `${t('suppliers.pay.amount')}: ${formatMoney(s.amount)}`,
        `${t('refund.method')}: ${s.method === 'cash' ? t('refund.method.cash') : s.accountLabel ?? t('refund.method.account')}`,
        `${t('refund.reportedBy')}: ${s.reportedBy ?? '—'}`,
        `${t('refund.reportedAt')}: ${formatDateTime(new Date(s.reportedAt))}`,
      ].join('\n'),
      confirmLabel: t('suppliers.confirm.action'),
      cancelLabel: t('action.cancel'),
    });
    if (!ok) return;
    try {
      // Nothing is marked confirmed locally. The server decides.
      await confirm.mutateAsync({ settlementId: s.id, expectedVersion: s.version });
      toast.success(t('suppliers.confirm.done'));
    } catch (e) {
      if (await explainConflict(e)) return;
      toast.error(t('suppliers.confirm.failed'));
    }
  };

  return (
    <>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Section title={t('suppliers.detail.supplier')}>
          <Card>
            <View style={styles.headline}>
              <Text variant="title">{supplier.name}</Text>
              {!supplier.isActive ? <Chip tone="neutral" label={t('suppliers.inactive')} dot /> : null}
            </View>
            {supplier.phone ? <Text tone="secondary">{supplier.phone}</Text> : null}
            {supplier.notes ? (
              <Text variant="caption" tone="tertiary" style={styles.gap}>
                {supplier.notes}
              </Text>
            ) : null}
            {!supplier.isActive ? (
              <Text variant="caption" tone="secondary" style={styles.gap}>
                {t('suppliers.inactiveExplain')}
              </Text>
            ) : null}
          </Card>
        </Section>

        {ledger ? (
          <>
            <Section title={t('suppliers.detail.money')}>
              <Card>
                <Row label={t('suppliers.detail.purchased')} amount={ledger.totalPurchased} />
                <Row label={t('suppliers.detail.paid')} amount={ledger.totalConfirmedPaid} />
                {/* Owed is a warning, never a success. */}
                <Row
                  label={t('suppliers.detail.outstanding')}
                  amount={ledger.outstanding}
                  strong
                  tone={ledger.outstanding > 0 ? 'warning' : 'secondary'}
                />
                {ledger.awaitingConfirmation > 0 ? (
                  <Text variant="caption" tone="secondary" style={styles.gap}>
                    {t('suppliers.detail.awaiting', {
                      amount: formatMoney(ledger.awaitingConfirmation),
                    })}
                  </Text>
                ) : null}
              </Card>
            </Section>

            <Section title={t('suppliers.detail.purchases')}>
              <Card>
                {ledger.purchases.length === 0 ? (
                  <Text variant="caption" tone="tertiary">{t('suppliers.detail.noPurchases')}</Text>
                ) : (
                  ledger.purchases.map((p) => (
                    <View key={p.purchaseId} style={styles.ledgerRow}>
                      <View style={styles.body}>
                        <Text variant="body">
                          {p.referenceNo ?? p.purchaseId.slice(0, 8).toUpperCase()}
                        </Text>
                        <Text variant="caption" tone="tertiary">
                          {formatDateTime(new Date(p.date))} · {p.branch.name}
                        </Text>
                      </View>
                      <View style={styles.right}>
                        {/* Still owed on this delivery — a column, so tabular. */}
                        <MoneyValue
                          value={p.outstanding}
                          size="small"
                          tone={p.outstanding > 0 ? 'negative' : 'muted'}
                        />
                        <Chip
                          tone={p.status === 'paid' ? 'success' : p.status === 'partial' ? 'warning' : 'danger'}
                          label={t(`status.purchase.${p.status}` as never)}
                          size="sm"
                          dot
                        />
                      </View>
                    </View>
                  ))
                )}
              </Card>
            </Section>

            {pending.length > 0 ? (
              <Section title={t('suppliers.detail.pending')}>
                <Card>
                  {pending.map((s) => (
                    <View key={s.id} style={styles.settlement}>
                      <SettlementLines s={s} />
                      {/* Warning tone: reported is not paid. */}
                      <Chip tone="warning" label={t('suppliers.pending.status')} dot />
                      {canConfirm ? (
                        <Button
                          title={t('suppliers.confirm.action')}
                          onPress={() => void onConfirm(s)}
                          loading={confirm.isPending}
                          style={styles.gap}
                        />
                      ) : (
                        <Text variant="caption" tone="tertiary" style={styles.gap}>
                          {t('suppliers.pending.employeeNote')}
                        </Text>
                      )}
                    </View>
                  ))}
                </Card>
              </Section>
            ) : null}

            {confirmed.length > 0 ? (
              <Section title={t('suppliers.detail.payments')}>
                <Card>
                  {confirmed.map((s) => (
                    <View key={s.id} style={styles.settlement}>
                      <SettlementLines s={s} />
                      {/*
                        Success only while it stands. A corrected payment is
                        neutral: the money went out and then came back, so
                        calling it settled would be false.
                      */}
                      <Chip
                        tone={s.correction?.status === 'approved' ? 'neutral' : 'success'}
                        label={t(
                          s.correction?.status === 'approved'
                            ? 'correction.status.approved'
                            : 'suppliers.confirmed.status',
                        )}
                        dot
                      />
                      {/*
                        Correcting it (Milestone B). A confirmed settlement
                        cannot be edited, so this is the only remedy.
                      */}
                      <CorrectionSection
                        targetKind="supplier_settlement"
                        targetId={s.id}
                        amount={s.amount}
                        correction={s.correction}
                        onChanged={refetch}
                      />
                    </View>
                  ))}
                </Card>
              </Section>
            ) : null}
          </>
        ) : (
          <Section title={t('suppliers.detail.money')}>
            <Card>
              {/* Said, rather than shown as zero. */}
              <Text variant="caption" tone="tertiary">{t('suppliers.detail.moneyHidden')}</Text>
            </Card>
          </Section>
        )}
      </ScrollView>

      <View style={styles.actions}>
        {ledger && ledger.outstanding > 0 && canReport && supplier.isActive ? (
          <Button
            title={t('suppliers.pay.action')}
            onPress={() => setPaying(true)}
            loading={report.isPending}
          />
        ) : null}
        {canManage ? (
          <Button
            title={t(supplier.isActive ? 'suppliers.deactivate.action' : 'suppliers.reactivate.action')}
            variant="tertiary"
            onPress={() => void onToggleActive()}
            loading={update.isPending}
          />
        ) : null}
      </View>

      <SupplierPaymentSheet
        open={paying}
        onClose={() => setPaying(false)}
        supplierId={supplier.id}
        submitting={report.isPending}
        onSubmit={onReport}
      />
    </>
  );
}

function SettlementLines({ s }: { s: SupplierSettlement }) {
  const { t } = useTranslation();
  return (
    <View style={styles.body}>
      {/*
        Money that LEFT the shop. Neutral-toned deliberately: a payment is not
        a loss, and colouring it red beside the outstanding balance would make
        paying a supplier look like something going wrong.
      */}
      <MoneyValue value={s.amount} />
      <Text variant="caption" tone="secondary">
        {s.method === 'cash' ? t('refund.method.cash') : s.accountLabel ?? t('refund.method.account')}
        {s.transactionReference ? ` · ${s.transactionReference}` : ''}
      </Text>
      <Text variant="caption" tone="tertiary">
        {t('refund.reportedBy')}: {s.reportedBy ?? '—'} · {formatDateTime(new Date(s.reportedAt))}
      </Text>
      {s.confirmedAt ? (
        <Text variant="caption" tone="tertiary">
          {t('refund.confirmedBy')}: {s.confirmedBy ?? '—'} · {formatDateTime(new Date(s.confirmedAt))}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * A labelled figure in the ledger.
 *
 * Takes the number, not a formatted string: purchased, paid and outstanding sit
 * in a vertical column, and a column of money is the one place tabular figures
 * genuinely earn their keep — an owner checking what they owe compares these
 * three at a glance rather than reading each one.
 *
 * `amount` may be undefined, which means the server withheld it from this role
 * rather than that it is zero. `MoneyValue` renders that as an em dash.
 */
function Row({
  label,
  amount,
  strong,
  tone,
}: {
  label: string;
  amount?: number;
  strong?: boolean;
  tone?: 'warning' | 'secondary';
}) {
  return (
    <View style={styles.row}>
      <Text variant={strong ? 'bodyStrong' : 'body'} tone="secondary">
        {label}
      </Text>
      <MoneyValue
        value={amount}
        size={strong ? 'default' : 'small'}
        tone={tone === 'warning' ? 'negative' : tone === 'secondary' ? 'muted' : 'default'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { gap: space.lg, paddingBottom: space['3xl'] },
  headline: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md, marginTop: space.xs },
  ledgerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm },
  settlement: { gap: space.xs, marginTop: space.sm },
  body: { flex: 1, gap: space.xs },
  right: { alignItems: 'flex-end', gap: space.xs },
  gap: { marginTop: space.xs },
  actions: { gap: space.sm, paddingTop: space.sm },
});
