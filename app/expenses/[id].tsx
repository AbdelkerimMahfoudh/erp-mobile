import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  InlineNotice,
  MoneyValue,
  PermissionNotice,
  Screen,
  Section,
  SkeletonList,
  Text,
} from '../../components/ui';
import { ApiError } from '../../lib/api-client';
import { space } from '../../lib/design/tokens';
import { dialog } from '../../lib/dialog';
import { formatDateTime, formatMoney } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import { toast } from '../../lib/toast';
import {
  expenseConflictKind,
  needsReasonWarning,
  useConfirmExpense,
  useExpense,
  useRejectExpense,
} from '../../lib/expenses';
import type { Expense } from '../../types/api';

/**
 * One expense, and the Owner's decision on it.
 *
 * The wording carries the weight: a reported expense has moved nothing, and the
 * screen says so. Only confirmation changes the till and the day's profit.
 */
export default function ExpenseDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useExpense(id);

  return (
    <Screen scroll>
      <Stack.Screen options={{ headerShown: true, title: t('expenses.detail.title') }} />
      {query.isLoading ? (
        <SkeletonList count={4} />
      ) : query.isError ? (
        query.error instanceof ApiError && query.error.status === 404 ? (
          // Somebody else's expense answers the same 404 as an unknown one, so
          // the message says nothing about whether it exists.
          <EmptyState title={t('expenses.notFound.title')} body={t('expenses.notFound.body')} />
        ) : (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        )
      ) : query.data ? (
        <Body expense={query.data} refetch={() => void query.refetch()} />
      ) : null}
    </Screen>
  );
}

function Body({ expense, refetch }: { expense: Expense; refetch: () => void }) {
  const { t } = useTranslation();
  const canReview = usePermission('expense.review');
  const confirm = useConfirmExpense(expense.id);
  const reject = useRejectExpense(expense.id);
  const [busy, setBusy] = useState(false);

  const explain = async (e: unknown): Promise<boolean> => {
    const kind = expenseConflictKind(e);
    if (!kind) return false;
    refetch();
    await dialog.alert({
      title: t(`expenses.conflict.${kind}.title` as never),
      message: t(`expenses.conflict.${kind}.body` as never),
    });
    return true;
  };

  const onConfirm = async () => {
    /**
     * The missing-reason warning. An expense with no note is money leaving the
     * business with nothing said about why — the Owner may still confirm it,
     * but they are asked, and the answer is stored as `reasonOmitted` rather
     * than dressed up with invented copy.
     */
    const omitted = needsReasonWarning(expense);
    if (omitted) {
      const proceed = await dialog.confirm({
        title: t('expenses.reasonMissing.title'),
        message: t('expenses.reasonMissing.body'),
        confirmLabel: t('expenses.reasonMissing.confirm'),
        cancelLabel: t('expenses.reasonMissing.addReason'),
      });
      if (!proceed) return;
    }

    /**
     * High friction on the money itself. Confirming is the moment it counts as
     * spent, and a variable expense lands on today's till.
     */
    const ok = await dialog.confirm({
      title: t('expenses.confirm.title'),
      message: [
        t('expenses.confirm.irreversible'),
        '',
        `${expense.category}: ${formatMoney(expense.amount)}`,
        `${t('expenses.method')}: ${
          expense.method === 'cash' ? t('refund.method.cash') : (expense.accountLabel ?? t('refund.method.account'))
        }`,
        `${t('expenses.class.label')}: ${t(`expenses.class.${expense.expenseClass}`)}`,
      ].join('\n'),
      confirmLabel: t('expenses.confirm.action'),
      cancelLabel: t('action.cancel'),
      tone: 'danger',
    });
    if (!ok) return;

    setBusy(true);
    try {
      await confirm.mutateAsync({ expectedVersion: expense.version, reasonOmitted: omitted });
      toast.success(t('expenses.confirm.done'));
      refetch();
    } catch (e) {
      if (await explain(e)) return;
      toast.error(t('expenses.confirm.failed'));
    } finally {
      setBusy(false);
    }
  };

  const onReject = async () => {
    setBusy(true);
    try {
      await reject.mutateAsync({ expectedVersion: expense.version });
      toast.success(t('expenses.reject.done'));
      refetch();
    } catch (e) {
      if (await explain(e)) return;
      toast.error(t('expenses.reject.failed'));
    } finally {
      setBusy(false);
    }
  };

  const tone =
    expense.status === 'confirmed' ? 'success' : expense.status === 'rejected' ? 'neutral' : 'warning';

  return (
    <>
      <Section title={t('expenses.detail.title')}>
        <Card>
          <Chip tone={tone} label={t(`expenses.status.${expense.status}`)} dot />
          <Text variant="title" style={styles.gap}>
            {expense.category}
          </Text>
          <MoneyValue value={expense.amount} size="display" />

          {/* What a reported expense has NOT done, said plainly. */}
          {expense.status === 'reported' ? (
            <InlineNotice tone="warning" style={styles.gap}>
              {t('expenses.reported.explain')}
            </InlineNotice>
          ) : null}

          <View style={styles.rows}>
            <Row label={t('expenses.class.label')} value={t(`expenses.class.${expense.expenseClass}`)} />
            {expense.isSalary ? <Row label={t('expenses.salary')} value={t('action.done')} /> : null}
            {expense.dueDate ? <Row label={t('expenses.dueDate')} value={expense.dueDate} /> : null}
            <Row
              label={t('expenses.method')}
              value={
                expense.method === 'cash'
                  ? t('refund.method.cash')
                  : (expense.accountLabel ?? t('refund.method.account'))
              }
            />
            {expense.reference ? <Row label={t('expenses.reference')} value={expense.reference} /> : null}
            <Row label={t('expenses.note')} value={expense.note ?? t('expenses.note.none')} />
            <Row label={t('expenses.reportedBy')} value={expense.reportedBy ?? '—'} />
            {expense.reportedAt ? (
              <Row label={t('expenses.reportedAt')} value={formatDateTime(new Date(expense.reportedAt))} />
            ) : null}
            {expense.confirmedBy ? (
              <Row label={t('expenses.confirmedBy')} value={expense.confirmedBy} />
            ) : null}
            {expense.confirmationDate ? (
              <Row label={t('expenses.countedOn')} value={expense.confirmationDate} />
            ) : null}
            {expense.rejectedReason ? (
              <Row label={t('expenses.rejectedReason')} value={expense.rejectedReason} />
            ) : null}
          </View>

          {/* Recorded, and shown. The Owner knowingly said nothing. */}
          {expense.reasonOmitted ? (
            <InlineNotice tone="neutral" style={styles.gap}>
              {t('expenses.reasonOmitted.notice')}
            </InlineNotice>
          ) : null}

          {expense.status === 'confirmed' ? (
            <InlineNotice tone="info" style={styles.gap}>
              {t('expenses.confirmed.immutable')}
            </InlineNotice>
          ) : null}
        </Card>
      </Section>

      {expense.status === 'reported' ? (
        canReview ? (
          <View style={styles.actions}>
            <Button
              title={t('expenses.confirm.action')}
              loading={busy && confirm.isPending}
              disabled={busy}
              onPress={() => void onConfirm()}
            />
            <Button
              title={t('expenses.reject.action')}
              variant="tertiary"
              loading={busy && reject.isPending}
              disabled={busy}
              onPress={() => void onReject()}
            />
          </View>
        ) : (
          // A submitter should know who decides, rather than wonder why nothing
          // is happening.
          <PermissionNotice message={t('expenses.review.ownerOnly')} />
        )
      ) : null}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text variant="body" tone="secondary">
        {label}
      </Text>
      <Text variant="bodyStrong" style={styles.rowValue}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { marginTop: space.sm },
  rows: { gap: space.xs, marginTop: space.base },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  rowValue: { flexShrink: 1, textAlign: 'right' },
  actions: { gap: space.sm, paddingTop: space.base },
});
