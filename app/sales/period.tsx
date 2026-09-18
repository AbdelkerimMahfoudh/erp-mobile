import React, { useState } from 'react';
import { View } from 'react-native';
import { Stack, useRouter, type Href } from 'expo-router';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { Button, Card, EmptyState, InlineNotice, MoneyValue, Screen, Section, SkeletonStat, Text } from '../../components/ui';
import { PeriodSelector } from '../../components/money/PeriodSelector';
import { SaleRow } from '../../components/money/SaleRow';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { formatDate, formatMoney } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { useMoneyOverview, useSalesByDay, type SalesDay } from '../../lib/money-overview';
import { periodRange, usePeriod } from '../../lib/period';
import { usePermission } from '../../lib/permissions';
import { useSales } from '../../lib/sales';

/**
 * Every sale in the selected period (0074).
 *
 * Today is a plain list. Seven days or a month is read a DAY at a time: one line
 * per day with its count, its value and what is still owed on it, and a day's
 * sales are fetched only when that day is opened. A month is thirty short lines,
 * never hundreds of rows mounted at once.
 *
 * The period is the one Money and Results already share, so arriving here from
 * the Money overview shows the same days.
 */
export default function SalesForPeriodScreen() {
  const styles = useStyles();
  const { t } = useTranslation();
  const key = usePeriod((s) => s.key);
  const range = periodRange(key);
  const canViewFigures = usePermission('report.view');
  const overview = useMoneyOverview(range.from, range.to, { enabled: canViewFigures });
  const days = useSalesByDay(range.from, range.to, { enabled: key !== 'today' });

  return (
    <Screen scroll gap="lg">
      <Stack.Screen options={{ headerShown: true, title: t('salesPeriod.title') }} />
      <PeriodSelector />

      {canViewFigures && overview.data ? (
        <Card style={styles.summary}>
          <Text variant="body" tone="secondary">
            {t('moneyOverview.salesValue')}
          </Text>
          <MoneyValue value={overview.data.period.salesValue} size="display" />
          <Text variant="caption" tone="secondary">
            {t('salesPeriod.phones', { count: String(overview.data.period.phonesSold) })}
          </Text>
        </Card>
      ) : canViewFigures && overview.isPending ? (
        <SkeletonStat />
      ) : null}

      {key === 'today' ? (
        <DaySales day={range.from} />
      ) : days.isPending ? (
        <SkeletonStat />
      ) : days.isError ? (
        <InlineNotice
          tone="warning"
          action={<Button title={t('action.retry')} variant="tertiary" size="sm" onPress={() => void days.refetch()} />}
        >
          {t('moneyTab.unavailable')}
        </InlineNotice>
      ) : (days.data?.days.length ?? 0) === 0 ? (
        <EmptyState title={t('salesPeriod.none')} />
      ) : (
        <Section title={t('salesPeriod.byDay')} subtitle={t('salesPeriod.tapDay')} gap="xs">
          {days.data!.days.map((d) => (
            <DayGroup key={d.day} day={d} />
          ))}
        </Section>
      )}
    </Screen>
  );
}

/** One day: its line, and its sales once opened. */
function DayGroup({ day }: { day: SalesDay }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <Card style={styles.day}>
      <Button
        title={formatDate(`${day.day}T00:00:00Z`)}
        variant="tertiary"
        icon={open ? ChevronDown : ChevronRight}
        onPress={() => setOpen((v) => !v)}
        accessibilityState={{ expanded: open }}
      />
      <View style={styles.dayLine}>
        <Text variant="caption" tone="secondary" style={styles.grow}>
          {t('salesPeriod.dayLine', { count: String(day.sales), value: formatMoney(day.value) })}
        </Text>
      </View>
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
  const styles = useStyles();
  const { t } = useTranslation();
  const router = useRouter();
  const sales = useSales({ from: day, to: day });
  const rows = sales.data?.pages.flatMap((p) => p.rows) ?? [];

  if (sales.isPending) return <SkeletonStat />;
  if (rows.length === 0) {
    return (
      <Text variant="caption" tone="tertiary">
        {t('salesPeriod.none')}
      </Text>
    );
  }
  return (
    <View style={styles.rows}>
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

const useStyles = makeStyles(() => ({
  summary: { gap: space.xs },
  day: { gap: space.xs },
  dayLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  grow: { flex: 1 },
  rows: { gap: 0 },
}));
