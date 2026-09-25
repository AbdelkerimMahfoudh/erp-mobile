import React, { useState } from 'react';
import { FlatList, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { Button, Card, EmptyState, InlineNotice, MoneyValue, Screen, SkeletonList, SkeletonStat, Text } from '../../components/ui';
import { DayRow } from '../../components/money/DayRow';
import { PeriodSelector } from '../../components/money/PeriodSelector';
import { SaleRow } from '../../components/money/SaleRow';
import { radius, space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { formatDate, formatMoney } from '../../lib/format';
import { isolateLtr } from '../../lib/design/direction';
import { useTranslation } from '../../lib/i18n';
import { useMoneyOverview, useSalesByDay, type SalesDay } from '../../lib/money-overview';
import { usePeriod } from '../../lib/period';
import { usePeriodRange } from '../../lib/home';
import { usePermission } from '../../lib/permissions';
import { useSales } from '../../lib/sales';
import type { SaleListRow } from '../../types/api';

/**
 * Every phone sold in the selected period (0074).
 *
 * Today is a list of sales. Seven days or a month is read a DAY at a time: one
 * line per day with its phones, its value and what is still owed on it, and a
 * day's sales are fetched only when that day is opened. A month is thirty
 * short lines, never hundreds of rows mounted at once — and the list is
 * virtualised either way.
 *
 * The period is the one Money and Results already share, so arriving here from
 * the Money overview shows the same days; arriving from one of its day lines
 * opens that day.
 */
export default function SalesForPeriodScreen() {
  const styles = useStyles();
  const { t } = useTranslation();
  const router = useRouter();
  const { day: openDay } = useLocalSearchParams<{ day?: string }>();
  const key = usePeriod((s) => s.key);
  const range = usePeriodRange(key);
  const canViewFigures = usePermission('report.view');
  const overview = useMoneyOverview(range.from, range.to, { enabled: canViewFigures });
  const days = useSalesByDay(range.from, range.to, { enabled: key !== 'today' });
  const sales = useSales({ from: range.from, to: range.to }, { enabled: key === 'today' });
  const rows = sales.data?.pages.flatMap((p) => p.rows) ?? [];

  const header = (
    <View style={styles.header}>
      <PeriodSelector />
      {canViewFigures ? (
        overview.data ? (
          <Card variant="accent" style={styles.summary}>
            <Text variant="body" tone="secondary">
              {t('salesPeriod.total')}
            </Text>
            <MoneyValue value={overview.data.period.salesValue} size="display" />
            <Text variant="caption" tone="secondary">
              {t('salesPeriod.phones', { count: String(overview.data.period.phonesSold) })}
            </Text>
            {/* The period's cancellations and returns, on their own days, and what the sales come to after them (docs/53). */}
            {overview.data.period.adjusted > 0 ? (
              <Text variant="caption" tone="secondary">
                {t('moneyOverview.adjustedNet', {
                  amount: isolateLtr(formatMoney(-overview.data.period.adjusted)),
                  net: isolateLtr(formatMoney(overview.data.period.netSalesValue)),
                })}
              </Text>
            ) : null}
            <View style={styles.pair}>
              <Mini label={t('moneyOverview.collected')} value={overview.data.period.collected} />
              <Mini label={t('moneyOverview.outstanding')} value={overview.data.period.outstanding} />
            </View>
          </Card>
        ) : overview.isPending ? (
          <SkeletonStat />
        ) : null
      ) : null}
    </View>
  );

  const hint =
    (key === 'today' ? rows.length : (days.data?.days.length ?? 0)) > 0 ? (
      <Text variant="caption" tone="tertiary" style={styles.hint}>
        {t('salesPeriod.tapSale')}
      </Text>
    ) : null;

  return (
    <Screen scroll={false}>
      <Stack.Screen options={{ headerShown: true, title: t('salesPeriod.title') }} />

      {key === 'today' ? (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          renderItem={({ item, index }) => (
            <View style={[styles.rowShell, index === 0 ? styles.first : null, index === rows.length - 1 ? styles.last : null]}>
              <SaleRow sale={item} onPress={() => router.push(`/sales/${item.id}` as Href)} />
            </View>
          )}
          ListEmptyComponent={sales.isPending ? <SkeletonList count={4} /> : <EmptyState title={t('salesPeriod.none')} />}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (sales.hasNextPage && !sales.isFetchingNextPage) void sales.fetchNextPage();
          }}
          ListFooterComponent={sales.isFetchingNextPage ? <SkeletonList count={2} /> : hint}
        />
      ) : (
        <FlatList
          data={days.data?.days ?? []}
          keyExtractor={(d) => d.day}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.gap} />}
          renderItem={({ item }) => <DayGroup day={item} initiallyOpen={item.day === openDay} />}
          ListEmptyComponent={
            days.isPending ? (
              <SkeletonList count={4} />
            ) : days.isError ? (
              <InlineNotice
                tone="warning"
                action={<Button title={t('action.retry')} variant="tertiary" size="sm" onPress={() => void days.refetch()} />}
              >
                {t('moneyTab.unavailable')}
              </InlineNotice>
            ) : (
              <EmptyState title={t('salesPeriod.none')} />
            )
          }
          ListFooterComponent={hint}
        />
      )}
    </Screen>
  );
}

/** A small figure beside another, under the headline. */
function Mini({ label, value }: { label: string; value: number }) {
  const styles = useStyles();
  return (
    <View style={styles.mini}>
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
      <MoneyValue value={value} size="small" />
    </View>
  );
}

/** One day: its line, and its sales once opened. */
function DayGroup({ day, initiallyOpen }: { day: SalesDay; initiallyOpen: boolean }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const [open, setOpen] = useState(initiallyOpen);

  return (
    <Card style={styles.day}>
      <DayRow
        title={formatDate(`${day.day}T00:00:00Z`)}
        caption={t('salesPeriod.dayLine', { count: String(day.phones) })}
        value={day.value}
        open={open}
        divider={open}
        onPress={() => setOpen((v) => !v)}
      />
      {day.outstanding > 0 ? (
        <Text variant="caption" tone="warning">
          {t('saleRow.owed', { amount: formatMoney(day.outstanding) })}
        </Text>
      ) : null}
      {open ? <DaySales day={day.day} /> : null}
    </Card>
  );
}

/** The sales of one day, paged by the server. Mounted only when shown. */
function DaySales({ day }: { day: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const sales = useSales({ from: day, to: day });
  const rows: SaleListRow[] = sales.data?.pages.flatMap((p) => p.rows) ?? [];

  if (sales.isPending) return <SkeletonStat />;
  if (rows.length === 0) {
    return (
      <Text variant="caption" tone="tertiary">
        {t('salesPeriod.none')}
      </Text>
    );
  }
  return (
    <View>
      {rows.map((s) => (
        <SaleRow key={s.id} sale={s} onPress={() => router.push(`/sales/${s.id}` as Href)} />
      ))}
      {sales.hasNextPage ? (
        <Button
          title={t('salesPeriod.more')}
          variant="tertiary"
          loading={sales.isFetchingNextPage}
          onPress={() => void sales.fetchNextPage()}
        />
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  header: { gap: space.md, paddingBottom: space.md },
  summary: { gap: 2 },
  pair: { flexDirection: 'row', gap: space.lg, paddingTop: space.sm },
  mini: { flex: 1, gap: 2 },
  list: { paddingBottom: space['3xl'] },
  /** The rows of a virtualised list still read as one card: each row carries a slice of it. */
  rowShell: {
    paddingHorizontal: space.base,
    backgroundColor: colors.surface.card,
    borderColor: colors.border.subtle,
    borderStartWidth: 1,
    borderEndWidth: 1,
  },
  first: { borderTopWidth: 1, borderTopStartRadius: radius.lg, borderTopEndRadius: radius.lg, paddingTop: space.xs },
  last: { borderBottomWidth: 1, borderBottomStartRadius: radius.lg, borderBottomEndRadius: radius.lg, paddingBottom: space.xs },
  gap: { height: space.sm },
  day: { gap: space.xs },
  hint: { textAlign: 'center', paddingVertical: space.md },
}));
