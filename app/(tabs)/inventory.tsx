import React, { useCallback, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Cable, PackageSearch } from 'lucide-react-native';
import {
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
import { productTitle, searchHaystack, variantSummary } from '../../lib/product-label';
import { qk } from '../../lib/query-keys';
import { toast } from '../../lib/toast';
import type { InventoryRow, ScanResult, Unit } from '../../types/api';

/**
 * Inventory — what is physically here.
 *
 * Shows both shapes of stock, which the app previously could not: serialized
 * units (one row per device, each with a status) and quantity-tracked lines
 * (one row per exact variant with a count). An electronics shop sells
 * accessories daily; inventory that omits them is wrong, not merely partial.
 *
 * Both arrive from one `GET /inventory` call discriminated by `kind`, so there
 * is no second request to keep in sync and no misleading shared shape.
 */

const STATUS_FILTERS = ['in_stock', 'sold', 'faulty', ''] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

export default function InventoryScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { branchId } = useBranch();
  const [status, setStatus] = useState<StatusFilter>('in_stock');
  const [query, setQuery] = useState('');

  /** Unit lookups started the moment a code is captured, keyed by code. */
  const lookups = useRef(new Map<string, Promise<Unit | null>>());

  const inventory = useQuery({
    queryKey: qk.inventory(branchId, status),
    queryFn: () => api.get<InventoryRow[]>(`/inventory${status ? `?status=${status}` : ''}`),
  });

  // ── Lookup by scan ────────────────────────────────────────────────────────

  const onCodeCaptured = useCallback((code: string) => {
    if (lookups.current.has(code)) return;
    lookups.current.set(
      code,
      api.get<Unit>(`/units/${encodeURIComponent(code)}`).catch(() => null),
    );
  }, []);

  /**
   * The scan still goes through `/scan` so recognition keeps learning, while
   * the unit lookup runs alongside — the lookup is what decides whether there
   * is anything to open.
   */
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

  // ── Filtering ─────────────────────────────────────────────────────────────

  /**
   * Search is local because the list is already capped server-side and a
   * counter needs it to feel instant. If a branch ever outgrows that cap this
   * has to move to the server — noted in docs/21.
   */
  const filtered = useMemo(() => {
    const rows = inventory.data ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      searchHaystack(
        row.product,
        row.kind === 'unit' ? row.identifier : undefined,
      ).includes(needle),
    );
  }, [inventory.data, query]);

  const units = filtered.filter((row): row is Extract<InventoryRow, { kind: 'unit' }> =>
    row.kind === 'unit',
  );
  const stock = filtered.filter((row): row is Extract<InventoryRow, { kind: 'stock' }> =>
    row.kind === 'stock',
  );

  const isEmpty = !inventory.isLoading && filtered.length === 0;
  const searching = query.trim().length > 0;

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
            onChangeText={setQuery}
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
        <ErrorState error={inventory.error} onRetry={() => void inventory.refetch()} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={
            <RefreshControl
              refreshing={inventory.isFetching}
              onRefresh={() => void inventory.refetch()}
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
                    count={t('inventory.count.units', { count: units.length })}
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
                    count={t('inventory.count.stock', { count: stock.length })}
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
            </>
          )}
        </ScrollView>
      )}
    </Screen>
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
});
