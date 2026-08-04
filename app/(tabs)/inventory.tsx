import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Cable, PackageSearch } from 'lucide-react-native';
import {
  Button,
  EmptyState,
  ErrorState,
  FilterChip,
  ListRow,
  Screen,
  SearchInput,
  SkeletonList,
  StatusChip,
  Text,
} from '../../components/ui';
import { ScanTarget } from '../../components/scanner';
import { api } from '../../lib/api-client';
import { useBranch } from '../../lib/branch';
import { colors } from '../../lib/design/colors';
import { space } from '../../lib/design/tokens';
import { formatQuantity } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { productTitle, variantSummary } from '../../lib/product-label';
import { qk } from '../../lib/query-keys';
import { toast } from '../../lib/toast';
import type { InventoryPage, InventoryRow, ScanResult, Unit } from '../../types/api';

/**
 * Inventory — what is physically here.
 *
 * Shows both shapes of stock: serialized units (one row per device, each with a
 * status) and quantity-tracked lines (one row per exact variant with a count).
 * An electronics shop sells accessories daily; inventory that omits them is
 * wrong, not merely partial.
 *
 * Paging is cursor-based and search runs on the server, because the alternative
 * — showing the first N rows and filtering only those on the phone — quietly
 * answers "we don't have it" for stock that is sitting on the shelf.
 */

const STATUS_FILTERS = ['in_stock', 'sold', 'faulty', ''] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const PAGE_SIZE = 50;
/** Long enough to feel deliberate, short enough not to feel laggy. */
const SEARCH_DEBOUNCE_MS = 350;

export default function InventoryScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { branchId } = useBranch();
  const [status, setStatus] = useState<StatusFilter>('in_stock');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  /** Unit lookups started the moment a code is captured, keyed by code. */
  const lookups = useRef(new Map<string, Promise<Unit | null>>());

  const inventory = useInfiniteQuery({
    queryKey: qk.inventory(branchId, status, debounced),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (status) params.set('status', status);
      if (debounced) params.set('search', debounced);
      if (pageParam) params.set('cursor', pageParam);
      return api.get<InventoryPage>(`/inventory?${params.toString()}`);
    },
    getNextPageParam: (last) => last.nextCursor,
  });

  // ── Lookup by scan ────────────────────────────────────────────────────────

  const onCodeCaptured = useCallback((code: string) => {
    if (lookups.current.has(code)) return;
    lookups.current.set(
      code,
      api.get<Unit>(`/units/${encodeURIComponent(code)}`).catch(() => null),
    );
  }, []);

  const onScanResult = useCallback(
    async (result: ScanResult) => {
      const unit = (await lookups.current.get(result.code)) ?? null;
      lookups.current.delete(result.code);

      if (!unit) {
        toast.error(t('inventory.notFound'));
        return;
      }
      const identifier = unit.imeiPrimary ?? unit.serialNo ?? result.code;
      router.push({ pathname: '/unit/[identifier]', params: { identifier } });
    },
    [router, t],
  );

  // ── Derived ───────────────────────────────────────────────────────────────

  const rows: InventoryRow[] = useMemo(
    () => inventory.data?.pages.flatMap((page) => page.rows) ?? [],
    [inventory.data],
  );
  const totals = inventory.data?.pages[0]?.totals ?? { units: 0, stock: 0 };

  const units = rows.filter((r): r is Extract<InventoryRow, { kind: 'unit' }> => r.kind === 'unit');
  const stock = rows.filter((r): r is Extract<InventoryRow, { kind: 'stock' }> => r.kind === 'stock');

  const isEmpty = !inventory.isLoading && rows.length === 0;
  const searching = debounced.length > 0;

  const onSearchChange = useCallback((value: string) => {
    setQuery(value);
  }, []);

  /** Refetching from the first page — a cursor from the old filter is invalid. */
  const refresh = useCallback(() => {
    void inventory.refetch();
  }, [inventory]);

  return (
    <Screen
      scroll={false}
      padded={false}
      header={
        <>
          <Text variant="title">{t('inventory.title')}</Text>
          <ScanTarget
            onResult={onScanResult}
            onCodeCaptured={onCodeCaptured}
            placeholder={t('inventory.scan.placeholder')}
          />
          <SearchInput
            value={query}
            onChangeText={onSearchChange}
            onDebouncedChange={setDebounced}
            debounceMs={SEARCH_DEBOUNCE_MS}
            onSubmit={setDebounced}
            placeholder={t('inventory.search')}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.filters}>
              {STATUS_FILTERS.map((value) => (
                <FilterChip
                  key={value || 'all'}
                  label={t(`inventory.filter.${value || 'all'}` as never)}
                  selected={status === value}
                  onPress={() => setStatus(value)}
                />
              ))}
            </View>
          </ScrollView>
        </>
      }
    >
      {inventory.error ? (
        // ErrorState reads the thrown value: a 403 renders "Not available to
        // you" with no retry, since retrying a role boundary never succeeds.
        <ErrorState error={inventory.error} onRetry={refresh} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onScroll={({ nativeEvent: e }) => {
            // Prefetch one screen ahead so the list rarely stalls visibly.
            const nearEnd =
              e.layoutMeasurement.height + e.contentOffset.y >= e.contentSize.height - 600;
            if (nearEnd && inventory.hasNextPage && !inventory.isFetchingNextPage) {
              void inventory.fetchNextPage();
            }
          }}
          scrollEventThrottle={200}
          refreshControl={
            <RefreshControl
              refreshing={inventory.isRefetching}
              onRefresh={refresh}
              tintColor={colors.brand[600]}
              colors={[colors.brand[600]]}
            />
          }
        >
          {inventory.isLoading ? (
            <SkeletonList count={6} />
          ) : isEmpty ? (
            <EmptyState
              icon={PackageSearch}
              title={t(
                searching
                  ? 'inventory.empty.search.title'
                  : status
                    ? 'inventory.empty.filtered.title'
                    : 'inventory.empty.title',
              )}
              body={t(
                searching
                  ? 'inventory.empty.search.body'
                  : status
                    ? 'inventory.empty.filtered.body'
                    : 'inventory.empty.body',
              )}
            />
          ) : (
            <>
              {units.length > 0 ? (
                <>
                  <SectionHeading
                    label={t('inventory.units')}
                    // Shown vs total, never a bare count — a page is not the
                    // whole branch, and implying otherwise hides stock.
                    count={t('inventory.count.units', {
                      shown: units.length,
                      total: totals.units,
                    })}
                  />
                  {units.map((row) => (
                    <ListRow
                      key={row.id}
                      leading={PackageSearch}
                      title={productTitle(row.product, row.identifier)}
                      subtitle={variantSummary(row.product) || undefined}
                      identifier={row.identifier}
                      accessory={<StatusChip domain="unit" value={row.status} size="sm" />}
                      onPress={() =>
                        router.push({
                          pathname: '/unit/[identifier]',
                          params: { identifier: row.identifier },
                        })
                      }
                    />
                  ))}
                </>
              ) : null}

              {stock.length > 0 ? (
                <>
                  <SectionHeading
                    label={t('inventory.accessories')}
                    count={t('inventory.count.stock', {
                      shown: stock.length,
                      total: totals.stock,
                    })}
                    spaced={units.length > 0}
                  />
                  {stock.map((row) => (
                    <ListRow
                      key={row.id}
                      leading={Cable}
                      title={productTitle(row.product)}
                      subtitle={variantSummary(row.product) || undefined}
                      identifier={row.product?.barcode ?? undefined}
                      value={formatQuantity(row.quantity)}
                      valueCaption={t('inventory.inStock')}
                      // No product-detail screen yet, so nothing to navigate to.
                      chevron={false}
                    />
                  ))}
                </>
              ) : null}

              <ListFooter
                loading={inventory.isFetchingNextPage}
                hasMore={Boolean(inventory.hasNextPage)}
                failed={Boolean(inventory.isFetchNextPageError)}
                onRetry={() => void inventory.fetchNextPage()}
              />
            </>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

/**
 * End-of-list state. Says explicitly when the list is complete — without it,
 * a user cannot tell "that is all the stock" from "it stopped loading".
 */
function ListFooter({
  loading,
  hasMore,
  failed,
  onRetry,
}: {
  loading: boolean;
  hasMore: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();

  if (failed) {
    return (
      <View style={styles.footer}>
        <Text variant="caption" tone="danger" align="center">
          {t('inventory.loadFailed')}
        </Text>
        <Button title={t('action.retry')} variant="secondary" size="sm" onPress={onRetry} />
      </View>
    );
  }
  if (loading) {
    return (
      <View style={styles.footer}>
        <ActivityIndicator color={colors.brand[600]} />
        <Text variant="caption" tone="tertiary" align="center">
          {t('inventory.loadingMore')}
        </Text>
      </View>
    );
  }
  if (hasMore) {
    return (
      <View style={styles.footer}>
        <Button title={t('inventory.loadMore')} variant="secondary" size="sm" onPress={onRetry} />
      </View>
    );
  }
  return (
    <View style={styles.footer}>
      <Text variant="caption" tone="tertiary" align="center">
        {t('inventory.endOfResults')}
      </Text>
    </View>
  );
}

function SectionHeading({
  label,
  count,
  spaced = false,
}: {
  label: string;
  count: string;
  spaced?: boolean;
}) {
  return (
    <View style={[styles.sectionHeading, spaced ? styles.sectionSpaced : null]}>
      <Text variant="label" tone="tertiary">
        {label}
      </Text>
      <Text variant="caption" tone="tertiary">
        {count}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  filters: {
    flexDirection: 'row',
    gap: space.sm,
  },
  list: {
    padding: space.base,
    gap: space.sm,
    paddingBottom: space['3xl'],
  },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  sectionSpaced: {
    marginTop: space.md,
  },
  footer: {
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.lg,
  },
});
