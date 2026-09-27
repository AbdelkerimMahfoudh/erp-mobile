import React, { useEffect, useLayoutEffect } from 'react';
import { View } from 'react-native';
import { useNavigation, useRouter, type Href } from 'expo-router';
import { Package, Plus, Receipt, Wallet } from 'lucide-react-native';
import {
  Button,
  Card,
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
import { isIncompatible } from '../../lib/errors';
import { formatDate, formatDayRange, formatMoney } from '../../lib/format';
import { isolateLtr } from '../../lib/design/direction';
import { useTranslation } from '../../lib/i18n';
import { useMoneyOverview, useSalesByDay, type MethodMoney, type SalesDay } from '../../lib/money-overview';
import { tabHub, visibleChildren } from '../../lib/navigation/registry';
import { usePeriod, type PeriodKey } from '../../lib/period';
import { usePeriodRange } from '../../lib/home';
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
 * 1. **Today, by method** — the money recorded today through the drawer and
 *    through each configured account, on one basis (money in less money out,
 *    no opening for any of them), with the server's total of exactly those
 *    rows. It is recorded movement: never a drawer count and never an account's
 *    balance, which the app does not see (2026-09-27).
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
  const setKey = usePeriod((s) => s.setKey);
  /*
    Today on every arrival at the tab — the first visit, or from another tab — and whatever the person then picks
    while here stays: a screen opened from the tab (Results, a day's sales) and its way back are not an arrival, and
    a background refetch changes no choice. The tab stays mounted while another tab shows, and its own route never
    changes, so the tab bar's state says when the person left: the choice goes back to Today then, before they return.
  */
  const navigation = useNavigation();
  // The first visit, before the first paint, so it never shows or fetches a choice made elsewhere.
  useLayoutEffect(() => setKey('today'), [setKey]);
  useEffect(
    () =>
      navigation.addListener('state', (e) => {
        const tabs = e.data.state;
        if (tabs.routes[tabs.index]?.name !== 'money-hub') setKey('today');
      }),
    [navigation, setKey],
  );
  const range = usePeriodRange(key);
  const overview = useMoneyOverview(range.from, range.to, { enabled: canViewFigures });
  // The card is today's whatever the period: its own query on today's range (the same cache as Today's), so it never
  // blanks while another period loads.
  const todayRange = usePeriodRange('today');
  const card = useMoneyOverview(todayRange.from, todayRange.to, { enabled: canViewFigures });
  const cardData = card.data;
  // Whole units, unless a figure carries cents: then every figure on the card shows them, so the rows visibly add up.
  const cardDecimals = cardData && [cardData.moneyToday.total.net, ...cardData.moneyToday.channels.map((c) => c.net)].some((v) => Math.round(v * 100) % 100 !== 0) ? 2 : 0;
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
              void card.refetch();
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

          {/* 1. Today: the money recorded for each method, and their total. */}
          {card.isPending ? (
            <SkeletonStat />
          ) : card.isError || !cardData ? (
            <InlineNotice
              tone="warning"
              title={isIncompatible(card.error) ? t('contract.incompatible.title') : t('moneyTab.unavailable')}
              action={<Button title={t('action.retry')} variant="tertiary" size="sm" onPress={() => void card.refetch()} />}
            >
              {isIncompatible(card.error) ? t('contract.incompatible.body') : t('moneyTab.unavailable.body')}
            </InlineNotice>
          ) : (
            <Card variant="accent" style={styles.cash}>
              <View style={styles.head}>
                <View style={styles.cashIcon}>
                  <Wallet color={colors.text.accent} size={22} />
                </View>
                <Text variant="body" tone="secondary" style={styles.grow}>
                  {t('moneyTab.today.title')}
                </Text>
              </View>
              {/* The total on a line of its own: the card's whole width, so large text does not cut it short. */}
              <View style={styles.total}>
                <MoneyValue value={cardData.moneyToday.total.net} size="display" signed={cardData.moneyToday.total.net < 0} decimals={cardDecimals} />
                <Text variant="caption" tone="tertiary">
                  {t('moneyTab.today.hint', { date: formatDate(cardData.today) })}
                </Text>
              </View>
              {/* Every configured method beneath the total — the drawer first — and the total is the server's sum of these rows. */}
              <View style={styles.methods}>
                {cardData.moneyToday.channels.map((m) => (
                  <MethodLine key={m.accountId ?? (m.isUnattributed ? 'unattributed' : 'cash')} method={m} decimals={cardDecimals} />
                ))}
              </View>
            </Card>
          )}

          <PeriodSelector />

          {/* 2. The period: four facts, never merged into one. */}
          {data ? (
            <Card style={styles.figures}>
              <View style={styles.grid}>
                <Figure label={t('moneyOverview.phonesSold')} count={data.period.unitsSold} />
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
              {/* Cancellations and returns approved in the period, on their own days: negative adjustments to the value above (docs/53). */}
              {data.period.cancellations.count > 0 ? (
                <View style={styles.line}>
                  <Text variant="caption" tone="secondary" style={styles.grow}>
                    {t('moneyOverview.cancelled', { count: String(data.period.cancellations.count) })}
                  </Text>
                  <MoneyValue value={-data.period.cancellations.value} size="small" />
                </View>
              ) : null}
              {data.period.returns.count > 0 ? (
                <View style={styles.line}>
                  <Text variant="caption" tone="secondary" style={styles.grow}>
                    {t('moneyOverview.returns', { count: String(data.period.returns.count) })}
                  </Text>
                  <MoneyValue value={-data.period.returns.value} size="small" />
                </View>
              ) : null}
              {data.period.cancellations.count + data.period.returns.count > 0 ? (
                <View style={styles.line}>
                  <Text variant="caption" tone="secondary" style={styles.grow}>
                    {t('moneyOverview.netSales')}
                  </Text>
                  <MoneyValue value={data.period.netSalesValue} size="small" />
                </View>
              ) : null}
              <Text variant="caption" tone="tertiary">
                {t('moneyOverview.countRule')}
              </Text>
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
                      {t('moneyOverview.phones', { count: String(data.period.unitsSold) })}
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
                    {isIncompatible(days.error) ? t('contract.incompatible.body') : t('moneyTab.unavailable')}
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
                  {/* Today's figure — the business day, named — whatever the period
                      switch above says: it controls sales, never this (0074). */}
                  {data.expensesToday.reversed > 0 ? (
                    <Text variant="caption" tone="secondary">
                      {t('moneyOverview.dailyExpenses.reversed', { amount: isolateLtr(formatMoney(-data.expensesToday.reversed)) })}
                    </Text>
                  ) : null}
                  <Text variant="caption" tone="tertiary">
                    {t('moneyOverview.dailyExpenses.hint', { date: formatDate(data.today) })}
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
                      onPress={expenses ? () => router.push(`${expenses.route}/${e.expenseId ?? e.id}` as Href) : undefined}
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
          title={formatDate(d.day)}
          caption={
            d.adjusted > 0
              ? t('moneyOverview.unitsAdjusted', { count: String(d.units), amount: isolateLtr(formatMoney(-d.adjusted)) })
              : t('moneyOverview.phones', { count: String(d.units) })
          }
          value={d.net}
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

/** One method's money today: its name, what was recorded in and out, and the net — beneath the card's total. */
function MethodLine({ method: m, decimals }: { method: MethodMoney; decimals: number }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const name = m.channel === 'cash' ? t('moneyTab.cash') : m.isUnattributed ? t('moneyOverview.account.unattributed') : m.label;
  return (
    <View style={styles.method}>
      <View style={styles.grow}>
        <Text variant="bodyStrong">{name}</Text>
        <Text variant="caption" tone="tertiary">
          {t('moneyOverview.account.inOut', { in: isolateLtr(formatMoney(m.moneyIn, { decimals })), out: isolateLtr(formatMoney(m.moneyOut, { decimals })) })}
        </Text>
      </View>
      <MoneyValue value={m.net} size="small" signed={m.net !== 0} tone="auto" decimals={decimals} />
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
  total: { gap: 2 },
  methods: { gap: space.xs },
  method: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44 },
}));
