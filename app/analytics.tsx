import React from 'react';
import { RefreshControl, ScrollView } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { ExportAction } from '../components/reports/ExportAction';
import { AttentionList } from '../components/analytics/AttentionList';
import { GitBranch, Package, TrendingDown, TrendingUp, Users } from 'lucide-react-native';
import {
  EmptyState,
  ListRow,
  MoneyValue,
  RowGroup,
  Section,
  SkeletonList,
  Text,
} from '../components/ui';
import { api } from '../lib/api-client';
import { qk } from '../lib/query-keys';
import { useBranch } from '../lib/branch';
import { useTranslation } from '../lib/i18n';
import { num } from '../lib/theme';
import { space } from '../lib/design/tokens';
import { makeStyles, useColors } from '../lib/design/theme';

/**
 * Analytics — what the shop actually did.
 *
 * Rebuilt onto the design system. It previously styled itself with NativeWind
 * classes and hand-formatted money into strings, which cost it three things
 * that matter here more than on most screens:
 *
 *  - **Figures did not line up.** Amounts were plain text, so a column of them
 *    wandered by a character or two and could not be compared down the page.
 *    `MoneyValue` uses tabular figures, which is the whole reason it exists.
 *  - **Profit and loss were told apart by colour alone.** Red text and green
 *    text, same shape. Now the sign is shown, so the direction survives both
 *    colour blindness and a monochrome screenshot.
 *  - **The tracking badge was English everywhere.** `trackingLabel` is a
 *    hardcoded map — "Serial", "Quantity" — that never went through i18n. The
 *    catalog's own translated keys are used instead.
 *
 * Each analytic is its own `Section` because they answer unrelated questions;
 * the rows inside are grouped, because they are supporting values rather than
 * records to act on.
 */

interface ProductRow {
  productId: string;
  label: string | null;
  trackingType: string | null;
  qtySold: number;
  /** Units returned in the window — their own measure (docs/53 R6). */
  unitsReturned?: number;
  revenue: number;
  grossProfit?: number;
  sold30d: number;
  lastSoldAt: string | null;
}

interface Dashboard {
  bestSelling: ProductRow[];
  mostProfitable: ProductRow[];
  worstPerforming: ProductRow[];
  /** The shop's own `dead_stock_days`: how long without a sale that stands makes stock "not moving". */
  deadStockDays?: number;
  deadStock: {
    productId: string;
    label: string | null;
    inStock: number;
    inventoryValue?: number;
    lastSoldAt: string | null;
  }[];
  branchComparison: {
    branchId: string;
    name: string | null;
    revenue: number;
    grossProfit?: number;
    netProfit?: number;
  }[];
  employeePerformance: {
    userId: string;
    name: string | null;
    salesCount: number;
    returnsCount?: number;
    revenue: number;
    margin?: number;
  }[];
}

export default function AnalyticsScreen() {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const { branchId } = useBranch();
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: qk.dashboard(branchId),
    queryFn: () => api.get<Dashboard>('/dashboard'),
  });

  /** One empty state, so every group says "nothing yet" the same way. */
  const empty = () => <EmptyState title={t('analytics.none')} size="inline" />;

  return (
    <SafeAreaView style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: t('nav.analytics'),
          /* The dashboard is a 30-day view, so its export is too. */
          headerRight: () => <ExportAction days={30} />,
        }}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.semantic.primary} />
        }
      >
        {isLoading ? (
          <SkeletonList count={6} />
        ) : (
          <>
            {/*
              What needs attention, first (A3).

              Above the analytics rather than below them: a figure that needs
              acting on today outranks last month's best seller, and a panel
              somebody has to scroll to find is a panel nobody reads.
            */}
            <AttentionList />

            <Section
              icon={<TrendingUp size={18} color={colors.semantic.success} />}
              title={t('analytics.mostProfitable')}
            >
              {data?.mostProfitable.length ? (
                <RowGroup separatorInset={space.md}>
                  {data.mostProfitable.map((p) => (
                    <ProductLine key={p.productId} p={p} value={<MoneyValue value={p.grossProfit} signed tone="auto" />} />
                  ))}
                </RowGroup>
              ) : (
                empty()
              )}
            </Section>

            <Section
              icon={<Package size={18} color={colors.semantic.primary} />}
              title={t('analytics.bestSelling')}
            >
              {data?.bestSelling.length ? (
                <RowGroup separatorInset={space.md}>
                  {data.bestSelling.map((p) => (
                    <ProductLine
                      key={p.productId}
                      p={p}
                      valueText={
                        (p.unitsReturned ?? 0) > 0
                          ? t('analytics.soldReturned', { n: num(p.qtySold), r: num(p.unitsReturned ?? 0) })
                          : t('analytics.sold', { n: num(p.qtySold) })
                      }
                    />
                  ))}
                </RowGroup>
              ) : (
                empty()
              )}
            </Section>

            <Section
              icon={<TrendingDown size={18} color={colors.semantic.danger} />}
              title={t('analytics.worstPerforming')}
            >
              {data?.worstPerforming.length ? (
                <RowGroup separatorInset={space.md}>
                  {data.worstPerforming.map((p) => (
                    <ProductLine
                      key={p.productId}
                      p={p}
                      /*
                       * `signed` is what keeps this readable without colour: a
                       * loss reads as -1,200 whether or not the red lands.
                       */
                      value={
                        <MoneyValue
                          value={p.grossProfit}
                          signed
                          tone="auto"
                        />
                      }
                    />
                  ))}
                </RowGroup>
              ) : (
                empty()
              )}
            </Section>

            <Section
              icon={<Package size={18} color={colors.semantic.warning} />}
              title={t('analytics.deadStock')}
            >
              {data?.deadStock.length ? (
                <RowGroup separatorInset={space.md}>
                  {data.deadStock.map((d) => (
                    <ListRow
                      key={d.productId}
                      flat
                      title={d.label ?? '—'}
                      subtitle={t('analytics.inStock', { n: num(d.inStock) })}
                      value={<MoneyValue value={d.inventoryValue} />}
                      chevron={false}
                    />
                  ))}
                </RowGroup>
              ) : (
                empty()
              )}
              {/* What "not moving" counts, and what it leaves out (docs/54). */}
              {typeof data?.deadStockDays === 'number' ? (
                <Text variant="caption" tone="tertiary">
                  {t('analytics.deadStock.rule', { days: num(data.deadStockDays) })}
                </Text>
              ) : null}
            </Section>

            <Section
              icon={<GitBranch size={18} color={colors.semantic.primary} />}
              title={t('analytics.branches')}
            >
              {data?.branchComparison.length ? (
                <RowGroup separatorInset={space.md}>
                  {/*
                    "Revenue" and "Net" are spelled out rather than abbreviated
                    to "Rev"/"Net" — abbreviations do not translate, and owners
                    read this screen, not analysts.
                  */}
                  {data.branchComparison.map((b) => (
                    <ListRow
                      key={b.branchId}
                      flat
                      title={b.name ?? '—'}
                      subtitle={`${t('analytics.revenue')} ${num(b.revenue)}`}
                      value={<MoneyValue value={b.netProfit} signed />}
                      valueCaption={t('analytics.net')}
                      chevron={false}
                    />
                  ))}
                </RowGroup>
              ) : (
                empty()
              )}
            </Section>

            <Section
              icon={<Users size={18} color={colors.semantic.primary} />}
              title={t('analytics.employees')}
            >
              {data?.employeePerformance.length ? (
                <RowGroup separatorInset={space.md}>
                  {data.employeePerformance.map((e) => (
                    <ListRow
                      key={e.userId}
                      flat
                      title={e.name ?? '—'}
                      subtitle={
                        (e.returnsCount ?? 0) > 0
                          ? t('analytics.salesReturns', { n: num(e.salesCount), r: num(e.returnsCount ?? 0) })
                          : t('analytics.sales', { n: num(e.salesCount) })
                      }
                      value={<MoneyValue value={e.revenue} />}
                      chevron={false}
                    />
                  ))}
                </RowGroup>
              ) : (
                empty()
              )}
              <Text variant="caption" tone="tertiary">
                {t('analytics.rule')}
              </Text>
            </Section>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * One product line.
 *
 * Takes either a rendered value (money, which brings its own tone and tabular
 * figures) or plain text (a count), so a caller never formats money by hand.
 * The tracking type is said under the name rather than in a chip beside it: at
 * 320 points in Arabic the chip and the value left the name 54 points (docs/54).
 */
function ProductLine({
  p,
  value,
  valueText,
}: {
  p: ProductRow;
  value?: React.ReactElement;
  valueText?: string;
}) {
  const { t } = useTranslation();
  return (
    <ListRow
      flat
      title={p.label ?? '—'}
      subtitle={p.trackingType ? t(`catalog.tracking.${p.trackingType}` as never) : undefined}
      value={value ?? valueText}
      chevron={false}
    />
  );
}

const useStyles = makeStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.semantic.background,
  },
  content: {
    padding: space.base,
    paddingBottom: space['3xl'],
    gap: space.xl,
  },
}));
