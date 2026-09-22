import React from 'react';
import { View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Package, Plus, Receipt, Wallet } from 'lucide-react-native';
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
  Thumbnail,
  THUMB_SIZE,
} from '../../components/ui';
import { DayRow } from '../../components/money/DayRow';
import { ExpenseLine } from '../../components/money/ExpenseLine';
import { LinkRow } from '../../components/money/LinkRow';
import { PeriodSelector } from '../../components/money/PeriodSelector';
import { SaleRow } from '../../components/money/SaleRow';
import { HUB_ICONS } from '../../components/navigation/hub-icons';
import { useBranch } from '../../lib/branch';
import { useConnectivity } from '../../lib/connectivity';
import { radius, space } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';
import { formatDate, formatDayRange, formatMoney } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { useMoneyOverview, useSalesByDay, type AccountToday, type SalesDay } from '../../lib/money-overview';
import { tabHub, visibleChildren } from '../../lib/navigation/registry';
import { periodRange, usePeriod, type PeriodKey } from '../../lib/period';
import { usePermission, usePermissionStore } from '../../lib/permissions';
import { useSales } from '../../lib/sales';

/** How many sales the overview previews before "View all sales". */
const SALES_PREVIEW = 3;
/** How many recent days a month shows before the rest fold into one line. */
const DAYS_PREVIEW = 3;

/**
 * Money — the operational financial hub, a primary tab.
 *
 * Four questions, answered in the order a shopkeeper asks them, each with its
 * own words so none is mistaken for another:
 *
 * 1. **Right now** — the cash the store should hold, and what moved through
 *    each account today. The cash figure is the daily closing's own expected
 *    drawer, so Money and the closing cannot disagree. Accounts show what was
 *    recorded, never a "balance": the app does not see the account itself.
 * 2. **This period** — phones sold, the full sales value, what was actually
 *    collected, and what is still owed. "Sales value" is never called money
 *    received, and a later collection never raises the sales figures.
 * 3. **Short previews** — today's sales, or a week or month a day at a time,
 *    and today's expenses, each with a way to see everything. A month of sales
 *    is never mounted here, and the phone never adds days up itself.
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
  const colors = useColors();
  const { t } = useTranslation();
  const router = useRouter();
  const { branchName } = useBranch();
  const granted = usePermissionStore((s) => s.granted);
  const canViewFigures = usePermission('report.view');
  const offline = !useConnectivity((s) => s.online);

  const key = usePeriod((s) => s.key);
  const range = periodRange(key);
  const overview = useMoneyOverview(range.from, range.to, { enabled: canViewFigures });
  const sales = useSales({ from: range.from, to: range.to }, { enabled: canViewFigures && key === 'today' });
  const days = useSalesByDay(range.from, range.to, { enabled: canViewFigures && key !== 'today' });

  const hub = tabHub();
  const actions = hub ? visibleChildren(hub, granted) : [];
  const expenses = actions.find((c) => c.id === 'expenses');
  const data = overview.data;
  const preview = (sales.data?.pages[0]?.rows ?? []).slice(0, SALES_PREVIEW);
  const openSales = (day?: string) => router.push((day ? `/sales/period?day=${day}` : '/sales/period') as Href);

  return (
    <Screen
      scroll
      gap="lg"
      onRefresh={
        canViewFigures
          ? () => {
              void overview.refetch();
              void (key === 'today' ? sales.refetch() : days.refetch());
            }
          : undefined
      }
      refreshing={overview.isRefetching}
    >
      <TabHeader context={branchName} title={t('tab.money')} />

      {canViewFigures ? (
        <Section gap="md">
          {offline ? <InlineNotice tone="warning">{t('money.offline')}</InlineNotice> : null}

          {/* 1. Right now: the cash the store should hold, and the accounts one tap away. */}
          {overview.isPending ? (
            <SkeletonStat />
          ) : overview.isError || !data ? (
            <InlineNotice
              tone="warning"
              title={t('moneyTab.unavailable')}
              action={<Button title={t('action.retry')} variant="tertiary" size="sm" onPress={() => void overview.refetch()} />}
            >
              {t('moneyTab.unavailable.body')}
            </InlineNotice>
          ) : (
            <Card variant="accent" style={styles.cash}>
              <View style={styles.head}>
                <View style={styles.cashIcon}>
                  <Wallet color={colors.text.accent} size={22} />
                </View>
                <View style={styles.grow}>
                  <Text variant="body" tone="secondary">
                    {t('moneyOverview.cashNow')}
                  </Text>
                  <MoneyValue value={data.cashNow} size="display" />
                  <Text variant="caption" tone="tertiary">
                    {t('moneyOverview.cashNow.hint')}
                  </Text>
                </View>
              </View>
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
          )}

          <PeriodSelector />

          {/* 2. The period: four facts, never merged into one. */}
          {data ? (
            <Card style={styles.figures}>
              <View style={styles.grid}>
                <Figure label={t('moneyOverview.phonesSold')} count={data.period.phonesSold} />
                <Figure label={t('moneyOverview.salesValue')} value={data.period.salesValue} />
                <Figure label={t('moneyOverview.collected')} value={data.period.collected} />
                <Figure label={t('moneyOverview.outstanding')} value={data.period.outstanding} />
              </View>
              {data.period.refunds > 0 ? (
                <View style={styles.line}>
                  <Text variant="caption" tone="secondary" style={styles.grow}>
                    {t('moneyOverview.refunds')}
                  </Text>
                  <MoneyValue value={-data.period.refunds} size="small" />
                </View>
              ) : null}
            </Card>
          ) : null}

          {/* 3a. Today's sales, or the week or month a day at a time — and the way to all of them. */}
          {key === 'today' ? (
            <Card style={styles.block}>
              <View style={styles.head}>
                <Thumbnail icon={Package} />
                <View style={styles.grow}>
                  <Text variant="bodyStrong">{t('moneyOverview.phoneSales')}</Text>
                  {data ? <MoneyValue value={data.period.salesValue} size="large" /> : null}
                  {data ? (
                    <Text variant="caption" tone="secondary">
                      {t('moneyOverview.phones', { count: String(data.period.phonesSold) })}
                    </Text>
                  ) : null}
                </View>
              </View>
              {sales.isPending ? (
                <SkeletonStat />
              ) : preview.length === 0 ? (
                <Text variant="caption" tone="tertiary">
                  {t('moneyOverview.noSales')}
                </Text>
              ) : (
                <View>
                  {preview.map((s) => (
                    <SaleRow key={s.id} sale={s} onPress={() => router.push(`/sales/${s.id}` as Href)} />
                  ))}
                </View>
              )}
              <LinkRow title={t('moneyOverview.viewAllSales')} onPress={() => openSales()} />
            </Card>
          ) : (
            <Section title={t('moneyOverview.salesByDay')} gap="xs">
              <Card style={styles.list}>
                {days.isPending ? (
                  <SkeletonStat />
                ) : days.isError || !days.data ? (
                  <InlineNotice
                    tone="warning"
                    action={<Button title={t('action.retry')} variant="tertiary" size="sm" onPress={() => void days.refetch()} />}
                  >
                    {t('moneyTab.unavailable')}
                  </InlineNotice>
                ) : days.data.days.length === 0 ? (
                  <Text variant="caption" tone="tertiary">
                    {t('moneyOverview.noSales')}
                  </Text>
                ) : (
                  <DaysPreview days={days.data.days} periodKey={key} from={range.from} onOpen={openSales} />
                )}
                <LinkRow title={t('moneyOverview.viewAllSales')} onPress={() => openSales()} />
              </Card>
            </Section>
          )}

          {/* 3b. What was paid out today, from where — and the way to add one. */}
          {data ? (
            <Card style={styles.block}>
              <View style={styles.head}>
                <Thumbnail icon={Receipt} />
                <View style={styles.grow}>
                  <Text variant="bodyStrong">{t('moneyOverview.dailyExpenses')}</Text>
                  <MoneyValue value={data.expensesToday.total} size="large" />
                  {/* Today's figure, whatever the period switch above says — it
                      controls sales, never this. */}
                  <Text variant="caption" tone="tertiary">
                    {t('moneyOverview.dailyExpenses.hint')}
                  </Text>
                </View>
              </View>
              {expenses ? (
                <Button
                  title={t('moneyOverview.addExpense')}
                  icon={Plus}
                  fullWidth
                  onPress={() => router.push(`${expenses.route}/new` as Href)}
                />
              ) : null}
              {data.expensesToday.rows.length === 0 ? (
                <Text variant="caption" tone="tertiary">
                  {t('moneyOverview.noExpenses')}
                </Text>
              ) : (
                <View>
                  {data.expensesToday.rows.map((e) => (
                    <ExpenseLine
                      key={e.id}
                      expense={e}
                      onPress={expenses ? () => router.push(`${expenses.route}/${e.id}` as Href) : undefined}
                    />
                  ))}
                </View>
              )}
              {expenses ? (
                <LinkRow title={t('moneyOverview.viewAllExpenses')} onPress={() => router.push(expenses.route as Href)} />
              ) : null}
            </Card>
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

/** One of the period's four facts: its own label, its own figure. */
function Figure({ label, count, value }: { label: string; count?: number; value?: number }) {
  const styles = useStyles();
  return (
    <View style={styles.figure}>
      <Text variant="body" tone="secondary">
        {label}
      </Text>
      {value !== undefined ? <MoneyValue value={value} size="large" /> : <Text variant="title">{String(count ?? 0)}</Text>}
    </View>
  );
}

/**
 * A week is every day; a month is its latest days and one line for the rest.
 * The folded line names its span and how many days it holds — never a sum,
 * because the phone does not add figures up.
 */
function DaysPreview({
  days,
  periodKey,
  from,
  onOpen,
}: {
  days: SalesDay[];
  periodKey: PeriodKey;
  from: string;
  onOpen: (day?: string) => void;
}) {
  const { t } = useTranslation();
  const shown = periodKey === 'week' ? days : days.slice(0, DAYS_PREVIEW);
  const folded = days.length - shown.length;
  return (
    <>
      {shown.map((d) => (
        <DayRow
          key={d.day}
          title={formatDate(`${d.day}T00:00:00Z`)}
          caption={t('moneyOverview.phones', { count: String(d.phones) })}
          value={d.value}
          onPress={() => onOpen(d.day)}
        />
      ))}
      {folded > 0 ? (
        <DayRow
          title={formatDayRange(from, days[shown.length].day)}
          caption={t('moneyOverview.earlierDays', { count: String(folded) })}
          onPress={() => onOpen()}
        />
      ) : null}
    </>
  );
}

/** One account today: its name as it stood, and what was recorded in and out. */
function AccountLine({ account: a }: { account: AccountToday }) {
  const styles = useStyles();
  const { t } = useTranslation();
  return (
    <View style={styles.account}>
      <View style={styles.line}>
        <Text variant="bodyStrong" style={styles.grow}>
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

const useStyles = makeStyles((colors) => ({
  cash: { gap: space.md },
  cashIcon: {
    width: THUMB_SIZE.md,
    height: THUMB_SIZE.md,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface.card,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  grow: { flex: 1, minWidth: 0 },
  figures: { gap: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  /** Two to a row where they fit, one under the other on a narrow phone. */
  figure: { flexGrow: 1, flexBasis: '40%', minWidth: 132, gap: 2 },
  block: { gap: space.md },
  list: { gap: space.xs },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  account: { gap: 2, paddingVertical: space.xs },
}));
