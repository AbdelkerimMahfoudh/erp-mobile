import React, { useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import {
  Card,
  Chip,
  EmptyState,
  ErrorState,
  FilterChip,
  Screen,
  SearchInput,
  SkeletonList,
  Text,
} from '../../components/ui';
import { ApiError } from '../../lib/api-client';
import { useBranch } from '../../lib/branch';
import { space } from '../../lib/design/tokens';
import { formatMoney, formatSmartDateTime, formatDateTime } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import { policyStatus } from '../../lib/return-policy';
import { useSales } from '../../lib/sales';
import type { SaleListRow, SalePayStatus } from '../../types/api';
import { makeStyles } from '../../lib/design/theme';

/**
 * Sale history — what this branch sold, and whether it can still come back.
 *
 * Everything is resolved server-side: the search, the status filter and the
 * paging. A screen that filtered only its loaded pages would answer "nothing
 * matches" for a sale two pages down — and the person asking is usually at the
 * counter holding the receipt for that exact sale.
 *
 * The return status is on every row deliberately. "Can this still be brought
 * back?" is the question the history gets opened for, and making someone tap
 * into each sale to find out is the notebook problem this app exists to remove.
 */

type Tab = 'all' | SalePayStatus;

const TABS: Tab[] = ['all', 'paid', 'partial', 'credit'];

export default function SalesScreen() {
  const styles = useStyles();
  const { t } = useTranslation();
  const router = useRouter();
  const canView = usePermission('sale.view');
  const branchName = useBranch((s) => s.branchName);

  const [tab, setTab] = useState<Tab>('all');
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');

  const page = useSales({
    search,
    payStatus: tab === 'all' ? undefined : [tab],
  });

  const rows = page.data?.pages.flatMap((p) => p.rows) ?? [];

  /**
   * The menu should not have offered this, but a deep link or a stale session
   * can land here anyway. Say so plainly rather than showing an empty list,
   * which reads as "this branch has sold nothing".
   */
  if (!canView) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: t('sales.title') }} />
        <EmptyState title={t('sales.forbidden')} body={t('sales.forbiddenBody')} />
      </Screen>
    );
  }

  const header = (
    <View style={styles.header}>
      <SearchInput
        value={typed}
        onChangeText={setTyped}
        onDebouncedChange={setSearch}
        placeholder={t('sales.search')}
        identifier
      />
      <FlatList
        horizontal
        data={TABS}
        keyExtractor={(s) => s}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabs}
        renderItem={({ item }) => (
          <FilterChip
            label={t(`sales.filter.${item}` as never)}
            selected={tab === item}
            onPress={() => setTab(item)}
          />
        )}
      />
    </View>
  );

  const isFiltered = tab !== 'all' || search.trim().length > 0;

  return (
    <Screen scroll={false}>
      {/* The branch is in the title: this list is that branch's sales, and
          which branch you are standing in changes what you see. */}
      <Stack.Screen
        options={{
          headerShown: true,
          title: branchName ? `${t('sales.title')} — ${branchName}` : t('sales.title'),
        }}
      />

      {page.isError ? (
        <ErrorState
          error={page.error}
          onRetry={
            // A 403 is an answer about access, not a fault. Offering Retry would
            // invite the user to keep asking a question already answered.
            page.error instanceof ApiError && page.error.status === 403
              ? undefined
              : () => void page.refetch()
          }
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          ListHeaderComponent={header}
          stickyHeaderIndices={[0]}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.gap} />}
          refreshing={page.isRefetching}
          onRefresh={() => void page.refetch()}
          ListEmptyComponent={
            page.isLoading ? (
              <SkeletonList count={5} />
            ) : (
              <EmptyState
                title={
                  search.trim()
                    ? t('sales.empty.search')
                    : isFiltered
                      ? t('sales.empty.filter')
                      : t('sales.empty')
                }
                body={
                  search.trim()
                    ? t('sales.empty.searchBody')
                    : isFiltered
                      ? t('sales.empty.filterBody')
                      : t('sales.emptyBody')
                }
              />
            )
          }
          renderItem={({ item }) => (
            <Row row={item} onPress={() => router.push(`/sales/${item.id}` as never)} />
          )}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (page.hasNextPage && !page.isFetchingNextPage) void page.fetchNextPage();
          }}
          ListFooterComponent={
            page.isFetchingNextPage ? (
              <SkeletonList count={2} />
            ) : rows.length > 0 && !page.hasNextPage ? (
              // Say the list ended, so nobody keeps pulling for more history.
              <Text variant="caption" tone="tertiary" style={styles.end}>
                {t('sales.endOfResults')}
              </Text>
            ) : null
          }
        />
      )}
    </Screen>
  );
}

function Row({ row, onPress }: { row: SaleListRow; onPress: () => void }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const status = policyStatus(row.returnPolicy, t, formatDateTime);

  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Card>
        <View style={styles.rowHead}>
          <Text variant="bodyStrong">{t('sales.invoice', { no: row.invoiceNo })}</Text>
          <Text variant="caption" tone="tertiary">
            {formatSmartDateTime(row.soldAt)}
          </Text>
        </View>

        <View style={styles.rowAmount}>
          <Text variant="heading">{formatMoney(row.total)}</Text>
          {/* Status by colour AND words, and only when it is not the ordinary
              case — a "Paid" badge on every row is noise that hides the two
              rows that actually need chasing. */}
          {row.payStatus !== 'paid' ? (
            <Chip
              label={t(`sales.payStatus.${row.payStatus}` as never)}
              tone={row.payStatus === 'credit' ? 'warning' : 'neutral'}
              size="sm"
            />
          ) : null}
          {row.isReversed ? (
            <Chip label={t('sales.reversed')} tone="neutral" size="sm" />
          ) : null}
        </View>

        <Text variant="caption" tone="secondary">
          {/* '10 cables' is one row and ten things. Say both when they differ,
              and never call a carton one item. */}
          {row.lineCount === row.itemCount
            ? t('sales.items', { count: row.itemCount })
            : t('sales.itemsInLines', { count: row.itemCount, lines: row.lineCount })}
          {row.customer ? ` · ${row.customer}` : ''}
        </Text>

        <View style={styles.rowFoot}>
          <Chip label={status.label} tone={status.tone} size="sm" />
          {status.detail ? (
            <Text variant="caption" tone="tertiary" numberOfLines={1} style={styles.detail}>
              {status.detail}
            </Text>
          ) : null}
          {row.soldBy ? (
            <Text variant="caption" tone="tertiary" numberOfLines={1}>
              {row.soldBy}
            </Text>
          ) : null}
        </View>
      </Card>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  header: { backgroundColor: colors.surface.canvas, paddingBottom: space.sm, gap: space.sm },
  tabs: { gap: space.xs, paddingVertical: space.xs },
  list: { padding: space.base, paddingBottom: space['3xl'] },
  gap: { height: space.sm },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowAmount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    marginTop: space.xs,
    marginBottom: space.xs,
  },
  rowFoot: {
    marginTop: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    flexWrap: 'wrap',
  },
  detail: { flexShrink: 1 },
  end: { textAlign: 'center', paddingVertical: space.base },
}));
