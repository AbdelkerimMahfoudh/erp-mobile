import React, { useState } from 'react';
import { FlatList, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { Plus, Wallet } from 'lucide-react-native';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  FilterChip,
  InlineNotice,
  ListRow,
  ListSeparator,
  MoneyValue,
  Screen,
  Section,
  SkeletonList,
  SkeletonStat,
  Text,
  THUMB_SIZE,
} from '../../components/ui';
import { ExpenseLine } from '../../components/money/ExpenseLine';
import { useBranch } from '../../lib/branch';
import { radius, space } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';
import { formatDate } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { useMoneyOverview } from '../../lib/money-overview';
import { usePermission } from '../../lib/permissions';
import { localDay } from '../../lib/sale-payment-rules';
import { useExpenses } from '../../lib/expenses';
import type { Expense, ExpenseStatus } from '../../types/api';

const FILTERS = ['reported', 'confirmed', 'all'] as const;

/**
 * Daily expenses — what was paid out today, and everything else the shop has
 * spent or is waiting on the Owner to decide.
 *
 * Today first, because that is what somebody opening this from Money wants:
 * the cash the store should now hold, and each expense paid today with where
 * it came from. Both figures are the server's overview, so they cannot
 * disagree with the Money tab. Below that, the full record with its status
 * filter — an Owner opens on what needs deciding, anybody else on what they
 * sent. A submitter sees only their own rows: the server enforces it, and
 * this screen never promises otherwise.
 */
export default function ExpensesScreen() {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const router = useRouter();
  const { recorded, sent } = useLocalSearchParams<{ recorded?: string; sent?: string }>();
  const { branchName } = useBranch();
  const canReview = usePermission('expense.review');
  const canViewFigures = usePermission('report.view');

  const today = localDay(new Date());
  const overview = useMoneyOverview(today, today, { enabled: canViewFigures });

  const [status, setStatus] = useState<ExpenseStatus | 'all'>(canReview ? 'reported' : 'all');
  const query = useExpenses(status === 'all' ? undefined : status);
  const rows = query.data?.rows ?? [];

  const header = (
    <View style={styles.header}>
      {recorded ? (
        <InlineNotice tone="success">{t('expenses.recorded')}</InlineNotice>
      ) : sent ? (
        <InlineNotice tone="success">{t('expenses.report.done')}</InlineNotice>
      ) : null}

      <View>
        {branchName ? (
          <Text variant="label" tone="secondary">
            {branchName}
          </Text>
        ) : null}
        <Text variant="caption" tone="secondary">
          {t('expenses.today', { date: formatDate(`${today}T00:00:00Z`) })}
        </Text>
      </View>

      {canViewFigures ? (
        overview.data ? (
          <>
            <Card variant="accent">
              <View style={styles.cashHead}>
                <View style={styles.cashIcon}>
                  <Wallet color={colors.text.accent} size={22} />
                </View>
                <View style={styles.grow}>
                  <Text variant="body" tone="secondary">
                    {t('moneyOverview.cashNow')}
                  </Text>
                  <MoneyValue value={overview.data.cashNow} size="display" />
                  <Text variant="caption" tone="tertiary">
                    {t('moneyOverview.cashNow.hint')}
                  </Text>
                </View>
              </View>
            </Card>
            <Card style={styles.todayCard}>
              <View style={styles.line}>
                <Text variant="bodyStrong" style={styles.grow}>
                  {t('expenses.todayTotal')}
                </Text>
                <MoneyValue value={overview.data.expensesToday.total} />
              </View>
              {overview.data.expensesToday.rows.length === 0 ? (
                <Text variant="caption" tone="tertiary">
                  {t('moneyOverview.noExpenses')}
                </Text>
              ) : (
                overview.data.expensesToday.rows.map((e) => (
                  <ExpenseLine key={e.id} expense={e} onPress={() => router.push(`/expenses/${e.id}` as Href)} />
                ))
              )}
            </Card>
          </>
        ) : overview.isPending ? (
          <SkeletonStat />
        ) : null
      ) : null}

      <Section title={t('expenses.allExpenses')} gap="xs">
        <View style={styles.controls} accessibilityRole="radiogroup">
          {FILTERS.map((value) => (
            <FilterChip key={value} label={t(`expenses.filter.${value}`)} selected={status === value} onPress={() => setStatus(value)} />
          ))}
        </View>
      </Section>
    </View>
  );

  return (
    <Screen
      scroll={false}
      footer={
        <>
          <Button title={t('expenses.report.action')} icon={Plus} fullWidth onPress={() => router.push('/expenses/new' as Href)} />
          <Button title={t('expenses.backToMoney', { tab: t('tab.money') })} variant="secondary" fullWidth onPress={() => router.navigate('/(tabs)/money-hub' as Href)} />
        </>
      }
    >
      <Stack.Screen options={{ headerShown: true, title: t('expenses.title') }} />

      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(e) => e.id}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={ListSeparator}
          ListEmptyComponent={
            query.isLoading ? (
              <SkeletonList count={4} />
            ) : (
              <EmptyState
                icon={Wallet}
                title={t('expenses.empty.title')}
                body={canReview ? t('expenses.empty.body.owner') : t('expenses.empty.body')}
              />
            )
          }
          renderItem={({ item }) => <ExpenseRow expense={item} onPress={() => router.push(`/expenses/${item.id}` as Href)} />}
        />
      )}
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
  const tone = expense.status === 'confirmed' ? 'success' : expense.status === 'rejected' ? 'neutral' : 'warning';

  return (
    <ListRow
      flat
      leading={Wallet}
      title={expense.category}
      // Where it was paid from; the kind of cost only when it is not the everyday one.
      subtitle={[
        expense.method === 'cash' ? t('refund.method.cash') : (expense.accountLabel ?? t('refund.method.account')),
        expense.isSalary ? t('expenses.salary') : expense.expenseClass === 'fixed' ? t('expenses.class.fixed') : null,
      ]
        .filter(Boolean)
        .join(' · ')}
      value={<MoneyValue value={expense.amount} size="small" />}
      accessory={<Chip tone={tone} label={t(`expenses.status.${expense.status}`)} size="sm" dot />}
      onPress={onPress}
    />
  );
}

const useStyles = makeStyles((colors) => ({
  header: { gap: space.md, paddingBottom: space.sm },
  cashHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  cashIcon: {
    width: THUMB_SIZE.md,
    height: THUMB_SIZE.md,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface.card,
  },
  grow: { flex: 1, minWidth: 0 },
  todayCard: { gap: space.xs },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingBottom: space.xs },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  list: { paddingBottom: space['3xl'] },
}));
