import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Landmark, Package, Plus, Receipt } from 'lucide-react-native';
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
} from '../../components/ui';
import { AccessNotice } from '../../components/access';
import { OpeningMoneySheet } from '../../components/day/OpeningMoneySheet';
import { CompanyAccountsSheet } from '../../components/money/CompanyAccountsSheet';
import { ExpectedMoneyCard } from '../../components/money/ExpectedMoneyCard';
import { DayRow } from '../../components/money/DayRow';
import { ExpenseLine } from '../../components/money/ExpenseLine';
import { LinkRow } from '../../components/money/LinkRow';
import { PeriodSelector } from '../../components/money/PeriodSelector';
import { SaleRow } from '../../components/money/SaleRow';
import { HUB_ICONS } from '../../components/navigation/hub-icons';
import { useBranch } from '../../lib/branch';
import { useConnectivity } from '../../lib/connectivity';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { isIncompatible, toFriendlyError } from '../../lib/errors';
import { formatDate, formatDayRange, formatMoney } from '../../lib/format';
import { isolateLtr } from '../../lib/design/direction';
import { useTranslation } from '../../lib/i18n';
import { useMoneyOverview, useSalesByDay, type SalesDay } from '../../lib/money-overview';
import { ApiError } from '../../lib/api-client';
import { useReviewOpening } from '../../lib/closing';
import { openingMethodsOf, type OpeningMoneyInput } from '../../lib/opening-money';
import { moneyRows } from '../../lib/navigation/registry';
import { usePeriod, type PeriodKey } from '../../lib/period';
import { useBusinessDay, usePeriodRange } from '../../lib/home';
import { usePermission, usePermissionStore } from '../../lib/permissions';
import { useBranchActivity, useBusinessAccess } from '../../lib/entitlement';
import { useSales } from '../../lib/sales';
import { toast } from '../../lib/toast';
import { useTodayOnArrival } from '../../lib/use-tab-arrival';

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
 * 1. **Expected money in store today** (docs/63) — one card: the server's total
 *    in large type, and one short line per method — the shop's cash, then each
 *    configured account — as the app tracks it: an amount known at one moment
 *    plus everything recorded since, carried across midnight. A method the
 *    records cannot establish says Unknown, and then there is no total at all —
 *    never a made-up 0, never an account's balance, which the app does not see.
 *    The accounts are the company's, so only the Owner sees them; anyone else
 *    gets the drawer. A shop opened with carried amounts says so until the Owner
 *    reviews them, here. Setting a company account is its own, company-wide row
 *    below, never part of a shop's opening.
 * 2. **This period** — phones sold, the full sales value, what was actually
 *    collected, and what is still owed. "Sales value" is never called money
 *    received, and a later collection never raises the sales figures.
 * 3. **Short previews** — today's sales, or a week or month a day at a time,
 *    and today's expenses, each with a way to see everything. A month of sales
 *    is never mounted here, and the phone never adds days up itself.
 * 4. **Where to go** — Results, Expenses, Loans and Outstanding payments, from
 *    the navigation registry so the tab cannot drift from it (the Daily closing
 *    is reached from Home, docs/63), and, for the Owner, the company accounts.
 *    On a branch with the money services counter the registry adds its rows
 *    (D157): the exchange reports beside Results on a combined branch,
 *    rebalancing and the providers after.
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
  const setKey = usePeriod((s) => s.setKey);
  // Today on every arrival at the tab; a choice made here stays through Results, a day's sales and the way back.
  useTodayOnArrival(() => setKey('today'));
  /*
    Pull-to-refresh reads the business day again too, the way Home does, so a tab left open across 06:00 moves on
    with the card. Only for somebody the server answers (`closing.count`): `refetch()` asks even when disabled.
  */
  const canCount = usePermission('closing.count');
  const dayQuery = useBusinessDay({ enabled: canCount });
  const refetchDay = dayQuery.refetch;
  const range = usePeriodRange(key);
  const overview = useMoneyOverview(range.from, range.to, { enabled: canViewFigures });
  // The two top cards are today's whatever the period: their own query on today's range (the same cache as Today's),
  // so they never blank while another period loads.
  const todayRange = usePeriodRange('today');
  const card = useMoneyOverview(todayRange.from, todayRange.to, { enabled: canViewFigures });
  const cardData = card.data;
  const held = cardData?.trackedMoney;
  // The server's word on business writes (lib/access.ts): a read-only business records nothing new here.
  const access = useBusinessAccess();
  // Only the Owner records money positions: the review of a carried opening, and the company's accounts.
  const canAnchor = usePermission('money.anchor.record') && access.canWrite;
  const review = useReviewOpening();
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [companyOpen, setCompanyOpen] = useState(false);
  const companyAccounts = held?.accountsVisible ? held.methods.filter((m) => m.channel === 'account') : [];
  const confirmReview = (money: OpeningMoneyInput | undefined) => {
    if (!money?.decision) return;
    setReviewError(null);
    review.mutate(
      { clientUuid: money.clientUuid, decision: money.decision, ...(money.cashAmount !== undefined ? { cashAmount: money.cashAmount } : {}) },
      {
        onSuccess: () => {
          setReviewing(false);
          toast.success(t('opening.review.done'));
          void card.refetch();
        },
        // Nothing was saved: the sheet keeps the amounts and says why — a keep of an unknown drawer in its own words.
        onError: (e) => setReviewError(e instanceof ApiError && e.code === 'opening_cash_unknown' ? t('opening.keep.unavailable.body') : e instanceof ApiError && e.code === 'opening_cash_negative' ? t('opening.keep.negative.body') : toFriendlyError(e).body || t('opening.review.failed')),
      },
    );
  };
  const sales = useSales({ from: range.from, to: range.to }, { enabled: canViewFigures && key === 'today' });
  const days = useSalesByDay(range.from, range.to, { enabled: canViewFigures && key !== 'today' });

  // The rows come from the registry, by role and by what the branch is subscribed to (D157).
  const activity = useBranchActivity();
  const actions = moneyRows(granted, activity);
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
              if (canCount) void refetchDay();
              void overview.refetch();
              void card.refetch();
              void (key === 'today' ? sales.refetch() : days.refetch());
            }
          : undefined
      }
      refreshing={overview.isRefetching}
    >
      <TabHeader context={branchName} title={t('tab.money')} />
      <AccessNotice />

      {canViewFigures ? (
        <Section gap="md">
          {offline ? <InlineNotice tone="warning">{t('money.offline')}</InlineNotice> : null}

          {card.isPending ? (
            <SkeletonStat />
          ) : card.isError || !cardData || !held ? (
            <InlineNotice
              tone="warning"
              title={isIncompatible(card.error) ? t('contract.incompatible.title') : t('moneyTab.unavailable')}
              action={<Button title={t('action.retry')} variant="tertiary" size="sm" onPress={() => void card.refetch()} />}
            >
              {isIncompatible(card.error) ? t('contract.incompatible.body') : t('moneyTab.unavailable.body')}
            </InlineNotice>
          ) : (
            // 1. Expected money in store today: one card, the server's figures, short lines (docs/63).
            <ExpectedMoneyCard
              held={held}
              canReview={canAnchor}
              dayOpen={dayQuery.data?.door === 'open'}
              onReview={() => setReviewing(true)}
              onSetAccounts={() => setCompanyOpen(true)}
            />
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
              {expenses && access.canWrite ? (
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

      {/* The company's accounts: a separate, company-wide action, the Owner's alone (docs/63). */}
      {canAnchor && companyAccounts.length > 0 ? (
        <RowGroup>
          <ListRow flat leading={Landmark} title={t('moneyTab.company.title')} subtitle={t('moneyTab.company.subtitle')} onPress={() => setCompanyOpen(true)} />
        </RowGroup>
      ) : null}

      {canAnchor ? <CompanyAccountsSheet open={companyOpen} onClose={() => setCompanyOpen(false)} accounts={companyAccounts} /> : null}
      {canAnchor && held && cardData ? (
        <OpeningMoneySheet
          intent="review"
          open={reviewing}
          onClose={() => setReviewing(false)}
          businessDate={cardData.today}
          mayDecide
          methods={openingMethodsOf(held.methods)}
          branchCount={held.branchCount}
          busy={review.isPending}
          error={reviewError}
          onConfirm={confirmReview}
        />
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

const useStyles = makeStyles(() => ({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  grow: { flex: 1, minWidth: 0 },
  figures: { gap: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  /** Two to a row where they fit, one under the other on a narrow phone. */
  figure: { flexGrow: 1, flexBasis: '40%', minWidth: 132, gap: 2 },
  block: { gap: space.md },
  list: { gap: space.xs },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
}));
