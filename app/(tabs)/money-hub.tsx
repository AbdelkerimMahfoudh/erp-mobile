import React from 'react';
import { View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import {
  Button,
  Card,
  Disclosure,
  InlineNotice,
  ListRow,
  MoneyValue,
  RowGroup,
  Screen,
  Section,
  SkeletonStat,
  TabHeader,
  Text,
} from '../../components/ui';
import { PeriodSelector } from '../../components/money/PeriodSelector';
import { SaleRow } from '../../components/money/SaleRow';
import { HUB_ICONS } from '../../components/navigation/hub-icons';
import { useBranch } from '../../lib/branch';
import { useConnectivity } from '../../lib/connectivity';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { formatMoney } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { useMoneyOverview, type AccountToday, type ExpenseToday } from '../../lib/money-overview';
import { tabHub, visibleChildren } from '../../lib/navigation/registry';
import { periodRange, usePeriod } from '../../lib/period';
import { usePermission, usePermissionStore } from '../../lib/permissions';
import { useSales } from '../../lib/sales';

/** How many sales the overview previews before "View all sales". */
const SALES_PREVIEW = 3;

/**
 * Money — the operational financial hub, a primary tab.
 *
 * Four questions, answered in the order a shopkeeper asks them, each with its
 * own words so none is mistaken for another:
 *
 * 1. **Right now** — the cash the drawer should hold, and what moved through
 *    each account today. The cash figure is the daily closing's own expected
 *    drawer, so Money and the closing cannot disagree. Accounts show what was
 *    recorded, never a "balance": the app does not see the account itself.
 * 2. **This period** — phones sold, the full sales value, what was actually
 *    collected, and what is still owed. "Sales value" is never called money
 *    received, and a later collection never raises the sales figures.
 * 3. **Short previews** — a few sales and today's expenses, each with a way to
 *    see everything. A month of sales is never mounted here.
 * 4. **Where to go** — Results, Expenses, Daily closing, Loans and Outstanding
 *    payments, from the navigation registry so the tab cannot drift from it.
 *
 * Every figure is the server's. The phone chooses words, never amounts. The
 * figures need `report.view`; somebody who only counts the drawer or reports
 * expenses still gets the tab and their actions, without figures they may not
 * read.
 */
export default function MoneyTabScreen() {
  const styles = useStyles();
  const { t } = useTranslation();
  const router = useRouter();
  const { branchName } = useBranch();
  const granted = usePermissionStore((s) => s.granted);
  const canViewFigures = usePermission('report.view');
  const offline = !useConnectivity((s) => s.online);

  const key = usePeriod((s) => s.key);
  const range = periodRange(key);
  const overview = useMoneyOverview(range.from, range.to, { enabled: canViewFigures });
  const sales = useSales({ from: range.from, to: range.to }, { enabled: canViewFigures });

  const hub = tabHub();
  const actions = hub ? visibleChildren(hub, granted) : [];
  const expenses = actions.find((c) => c.id === 'expenses');
  const data = overview.data;
  const preview = (sales.data?.pages[0]?.rows ?? []).slice(0, SALES_PREVIEW);

  return (
    <Screen
      scroll
      gap="lg"
      onRefresh={
        canViewFigures
          ? () => {
              void overview.refetch();
              void sales.refetch();
            }
          : undefined
      }
      refreshing={overview.isRefetching}
    >
      <TabHeader context={branchName} title={t('tab.money')} />

      {canViewFigures ? (
        <Section gap="sm">
          <PeriodSelector />
          {offline ? <InlineNotice tone="warning">{t('money.offline')}</InlineNotice> : null}

          {overview.isPending ? (
            <View style={styles.statRow}>
              <SkeletonStat />
              <SkeletonStat />
            </View>
          ) : overview.isError || !data ? (
            <InlineNotice
              tone="warning"
              title={t('moneyTab.unavailable')}
              action={<Button title={t('action.retry')} variant="tertiary" size="sm" onPress={() => void overview.refetch()} />}
            >
              {t('moneyTab.unavailable.body')}
            </InlineNotice>
          ) : (
            <>
              {/* 1. Right now: the drawer, and the accounts one tap away. */}
              <Card style={styles.card}>
                <Text variant="label" tone="secondary">
                  {t('moneyOverview.now')}
                </Text>
                <Text variant="body" tone="secondary">
                  {t('moneyOverview.cashNow')}
                </Text>
                <MoneyValue value={data.cashNow} size="display" />
                <Text variant="caption" tone="tertiary">
                  {t('moneyOverview.cashNow.hint')}
                </Text>
                <Disclosure title={t('moneyTab.channels')}>
                  <Text variant="caption" tone="secondary">
                    {t('moneyOverview.accounts.hint')}
                  </Text>
                  {data.accountsToday.length === 0 ? (
                    <Text variant="caption" tone="tertiary">
                      {t('moneyOverview.accounts.none')}
                    </Text>
                  ) : (
                    data.accountsToday.map((a) => <AccountLine key={a.accountId ?? 'unattributed'} account={a} />)
                  )}
                  <Text variant="caption" tone="tertiary">
                    {t('moneyTab.recorded')}
                  </Text>
                </Disclosure>
              </Card>

              {/* 2. The period: four facts, never merged into one. */}
              <Card style={styles.card}>
                <Text variant="label" tone="secondary">
                  {t('moneyOverview.period')}
                </Text>
                <Line label={t('moneyOverview.phonesSold')}>
                  <Text variant="bodyStrong">{String(data.period.phonesSold)}</Text>
                </Line>
                <Line label={t('moneyOverview.salesValue')} hint={t('moneyOverview.salesValue.hint')}>
                  <MoneyValue value={data.period.salesValue} size="small" />
                </Line>
                <Line label={t('moneyOverview.collected')} hint={t('moneyOverview.collected.hint')}>
                  <MoneyValue value={data.period.collected} size="small" />
                </Line>
                <Line label={t('moneyOverview.outstanding')} hint={t('moneyOverview.outstanding.hint')}>
                  <MoneyValue value={data.period.outstanding} size="small" />
                </Line>
                {data.period.refunds > 0 ? (
                  <Line label={t('moneyOverview.refunds')}>
                    <MoneyValue value={-data.period.refunds} size="small" />
                  </Line>
                ) : null}
              </Card>
            </>
          )}

          {/* 3a. A few sales, and the way to all of them. */}
          <Section title={t('moneyOverview.sales')} gap="xs">
            {preview.length === 0 && !sales.isPending ? (
              <Text variant="caption" tone="tertiary">
                {t('moneyOverview.noSales')}
              </Text>
            ) : (
              <Card style={styles.list}>
                {preview.map((s) => (
                  <SaleRow key={s.id} sale={s} showDate={key !== 'today'} onPress={() => router.push(`/sales/${s.id}` as Href)} />
                ))}
              </Card>
            )}
            <Button
              title={t('moneyOverview.viewAllSales')}
              variant="secondary"
              fullWidth
              onPress={() => router.push('/sales/period' as Href)}
            />
          </Section>

          {/* 3b. What was paid out today, and from where. */}
          {data ? (
            <Section title={t('moneyOverview.expensesToday')} gap="xs">
              {data.expensesToday.rows.length === 0 ? (
                <Text variant="caption" tone="tertiary">
                  {t('moneyOverview.noExpenses')}
                </Text>
              ) : (
                <Card style={styles.list}>
                  {data.expensesToday.rows.map((e) => (
                    <ExpenseLine key={e.id} expense={e} />
                  ))}
                </Card>
              )}
              {expenses ? (
                <View style={styles.buttons}>
                  <Button
                    title={t('moneyOverview.addExpense')}
                    variant="secondary"
                    onPress={() => router.push(`${expenses.route}/new` as Href)}
                  />
                  <Button title={t('moneyOverview.viewAllExpenses')} variant="tertiary" onPress={() => router.push(expenses.route as Href)} />
                </View>
              ) : null}
            </Section>
          ) : null}
        </Section>
      ) : null}

      {/* 4. Where to go. Outstanding payments says what is owed, quietly. */}
      {actions.length > 0 ? (
        <RowGroup>
          {actions.map((child) => (
            <ListRow
              key={child.id}
              flat
              title={t(child.titleKey)}
              subtitle={
                child.id === 'outstanding' && data
                  ? data.outstandingAll.sales > 0
                    ? t('moneyOverview.outstandingRow.some', {
                        amount: formatMoney(data.outstandingAll.amount),
                        count: String(data.outstandingAll.sales),
                      })
                    : t('moneyOverview.outstandingRow.none')
                  : undefined
              }
              leading={HUB_ICONS[child.icon]}
              onPress={() => router.push(child.route as Href)}
            />
          ))}
        </RowGroup>
      ) : null}
    </Screen>
  );
}

/** A labelled figure. The label wraps; the figure never overlaps it. */
function Line({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.line}>
      <View style={styles.lineLabel}>
        <Text variant="body">{label}</Text>
        {hint ? (
          <Text variant="caption" tone="tertiary">
            {hint}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** One account today: its name as it stood, and what was recorded in and out. */
function AccountLine({ account: a }: { account: AccountToday }) {
  const styles = useStyles();
  const { t } = useTranslation();
  return (
    <View style={styles.account}>
      <View style={styles.line}>
        <Text variant="bodyStrong" style={styles.lineLabel}>
          {a.isUnattributed ? t('moneyOverview.account.unattributed') : a.label}
        </Text>
        <MoneyValue value={a.net} size="small" tone="auto" signed />
      </View>
      <Text variant="caption" tone="secondary">
        {t('moneyOverview.account.inOut', { in: formatMoney(a.moneyIn), out: formatMoney(a.moneyOut) })}
      </Text>
    </View>
  );
}

/** One expense paid today: what for, where it came from, how much. */
function ExpenseLine({ expense: e }: { expense: ExpenseToday }) {
  const styles = useStyles();
  const { t } = useTranslation();
  return (
    <View style={styles.expense}>
      <View style={styles.lineLabel}>
        <Text variant="body">{e.description}</Text>
        <Text variant="caption" tone="secondary">
          {e.method === 'cash' ? t('moneyOverview.paidFromCash') : e.accountLabel}
        </Text>
      </View>
      <MoneyValue value={-e.amount} size="small" />
    </View>
  );
}

const useStyles = makeStyles(() => ({
  statRow: { flexDirection: 'row', gap: space.sm },
  card: { gap: space.sm },
  list: { gap: 0, paddingVertical: space.xs },
  line: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.sm },
  lineLabel: { flex: 1, gap: 2 },
  account: { gap: 2, paddingVertical: space.xs },
  expense: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, paddingVertical: space.xs },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
}));
