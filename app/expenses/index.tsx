import React, { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Plus, Wallet } from 'lucide-react-native';
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  ListRow,
  MoneyValue,
  Screen,
  SegmentedControl,
  SkeletonList,
} from '../../components/ui';
import { space } from '../../lib/design/tokens';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import { useExpenses } from '../../lib/expenses';
import type { Expense, ExpenseStatus } from '../../types/api';

/**
 * What the shop has spent, and what is waiting on the Owner.
 *
 * A submitter sees only their own rows — the server enforces it, and this
 * screen never promises otherwise. Reporting what you spent must not hand you
 * the shop's whole outgoings.
 */
export default function ExpensesScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const canReview = usePermission('expense.review');

  const [status, setStatus] = useState<ExpenseStatus | 'all'>(
    // An Owner opens on what needs deciding; anybody else on what they sent.
    canReview ? 'reported' : 'all',
  );
  const query = useExpenses(status === 'all' ? undefined : status);
  const rows = query.data?.rows ?? [];

  return (
    <Screen scroll={false}>
      <Stack.Screen options={{ headerShown: true, title: t('expenses.title') }} />

      <View style={styles.controls}>
        <SegmentedControl
          options={[
            { value: 'reported', label: t('expenses.filter.reported') },
            { value: 'confirmed', label: t('expenses.filter.confirmed') },
            { value: 'all', label: t('expenses.filter.all') },
          ]}
          value={status}
          onChange={(v) => setStatus(v as ExpenseStatus | 'all')}
        />
      </View>

      {query.isLoading ? (
        <SkeletonList count={5} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title={t('expenses.empty.title')}
          body={canReview ? t('expenses.empty.body.owner') : t('expenses.empty.body')}
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(e) => e.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <ExpenseRow expense={item} onPress={() => router.push(`/expenses/${item.id}` as never)} />
          )}
        />
      )}

      <View style={styles.actions}>
        <Button
          title={t('expenses.report.action')}
          icon={Plus}
          fullWidth
          onPress={() => router.push('/expenses/new' as never)}
        />
      </View>
    </Screen>
  );
}

function ExpenseRow({ expense, onPress }: { expense: Expense; onPress: () => void }) {
  const { t } = useTranslation();

  /**
   * Warning while it is only reported: nothing has been agreed and no figure
   * includes it. Success only once confirmed — the same rule refunds and
   * supplier payments follow, for the same reason.
   */
  const tone =
    expense.status === 'confirmed' ? 'success' : expense.status === 'rejected' ? 'neutral' : 'warning';

  return (
    <ListRow
      leading={Wallet}
      title={expense.category}
      subtitle={[
        t(`expenses.class.${expense.expenseClass}`),
        expense.isSalary ? t('expenses.salary') : null,
        expense.method === 'cash' ? t('refund.method.cash') : (expense.accountLabel ?? t('refund.method.account')),
      ]
        .filter(Boolean)
        .join(' · ')}
      value={<MoneyValue value={expense.amount} size="small" />}
      accessory={<Chip tone={tone} label={t(`expenses.status.${expense.status}`)} size="sm" dot />}
      onPress={onPress}
    />
  );
}

const styles = StyleSheet.create({
  controls: { paddingBottom: space.sm },
  list: { gap: space.sm, paddingBottom: space['3xl'] },
  actions: { paddingTop: space.sm },
});
