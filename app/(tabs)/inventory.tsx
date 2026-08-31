import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Cable, PackageSearch } from 'lucide-react-native';
import {
  Button,
  EmptyState,
  ErrorState,
  FilterChip,
  ListRow,
  MoneyValue,
  Screen,
  SearchInput,
  SkeletonList,
  StatusChip,
  Text,
} from '../../components/ui';
import { ScanTarget } from '../../components/scanner';
import { api } from '../../lib/api-client';
import { useBranch } from '../../lib/branch';
import { space } from '../../lib/design/tokens';
import { formatQuantity } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { productTitle, variantSummary } from '../../lib/product-label';
import { qk } from '../../lib/query-keys';
import { toast } from '../../lib/toast';
import type { InventoryPage, InventoryRow, ModelStockRow, ScanResult, Unit } from '../../types/api';
import { makeStyles, useColors } from '../../lib/design/theme';

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
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const router = useRouter();
  const { branchId } = useBranch();
  // Arriving from a product's detail screen: filter to that exact product
  // rather than guessing from its name, which two variants can share.
  const { productId } = useLocalSearchParams<{ productId?: string }>();
  const [status, setStatus] = useState<StatusFilter>('in_stock');
  /**
   * How the shelf is presented — by model, or one row per unit.
   *
   * By model is the default because it is the question that gets asked fifty
   * times a day: "how many 17 Pro Max do I have?" A list of individual IMEIs
   * answers a different question, and answering it first meant counting rows by
   * eye. Nothing about the data changes between the two — every phone is still
   * one Unit with its own IMEI, still searchable by either — only which of the
   * two true answers is on top.
   *
   * Arriving from a product's detail screen goes straight to the units: that
   * journey has already picked a model, so aggregating it again would show one
   * line and hide what was asked for.
   */
  const [view, setView] = useState<'model' | 'unit'>(productId ? 'unit' : 'model');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  /** Unit lookups started the moment a code is captured, keyed by code. */
  const lookups = useRef(new Map<string, Promise<Unit | null>>());

  const inventory = useInfiniteQuery({
    queryKey: qk.inventory(branchId, status, debounced, productId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (status) params.set('status', status);
      if (debounced) params.set('search', debounced);
      if (productId) params.set('productId', String(productId));
      if (pageParam) params.set('cursor', pageParam);
      return api.get<InventoryPage>(`/inventory?${params.toString()}`);
    },
    getNextPageParam: (last) => last.nextCursor,
  });

  /**
   * The shelf, counted by model.
   *
   * Not paginated, and not filtered by the search box: a shop has hundreds of
   * units and a few dozen models, so the whole list is small, and a search over
   * IMEIs is a question about one phone rather than about the shelf. Typing in
   * the search box switches the view to units for that reason.
   */
  const byModel = useQuery({
    queryKey: qk.inventoryByModel(branchId),
    queryFn: () => api.get<ModelStockRow[]>('/inventory/by-model'),
    enabled: view === 'model',
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

  /**
   * Searching is a question about one phone, so it answers with phones.
   *
   * Somebody typing an IMEI wants that handset, not the line "iPhone 17 Pro
   * Max — 4". The model view is restored the moment the box is cleared, so this
   * costs nobody a tap.
   */
  const showing: 'model' | 'unit' = searching || productId ? 'unit' : view;

  const models = byModel.data ?? [];
  /** Phones and other individually-tracked devices, then bulk stock. */
  const trackedModels = models.filter((m) => m.trackingType !== 'quantity');
  const quantityModels = models.filter((m) => m.trackingType === 'quantity');
  const modelsEmpty = showing === 'model' && !byModel.isLoading && models.length === 0;

  const onSearchChange = useCallback((value: string) => {
    setQuery(value);
  }, []);

  /** Refetching from the first page — a cursor from the old filter is invalid. */
  const refresh = useCallback(() => {
    void inventory.refetch();
    void byModel.refetch();
  }, [inventory, byModel]);

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
          {/*
            Two true answers about the same shelf, and a tap between them.
            Hidden while searching, because a search has already chosen one.
          */}
          {searching || productId ? null : (
            <View style={styles.filters}>
              <FilterChip
                label={t('inventory.view.byModel')}
                selected={showing === 'model'}
                onPress={() => setView('model')}
              />
              <FilterChip
                label={t('inventory.view.byUnit')}
                selected={showing === 'unit'}
                onPress={() => setView('unit')}
              />
            </View>
          )}
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
          ) : showing === 'model' ? (
            <ModelList
              loading={byModel.isLoading}
              empty={modelsEmpty}
              tracked={trackedModels}
              quantity={quantityModels}
              /*
                Tapping a model answers the next question: which four? It
                switches to units AND filters to that model, because landing on
                every unit in the branch would make the tap a step backwards.
              */
              onOpen={(m) => {
                const term = `${m.brand} ${m.model}`.trim();
                setView('unit');
                setQuery(term);
                setDebounced(term);
              }}
            />
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
                      /**
                       * Cost, and only when the server actually sent it — it is
                       * stripped without `cost.view`. Rendered only when
                       * present, so a role that may not see cost gets a row
                       * with no cost on it rather than a dash or a zero, either
                       * of which would read as "this phone cost nothing".
                       */
                      value={
                        row.cost !== undefined ? (
                          <MoneyValue value={row.cost} size="small" tone="muted" />
                        ) : undefined
                      }
                      valueCaption={row.cost !== undefined ? t('inventory.cost') : undefined}
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
                      /**
                       * The headline number stays PHYSICAL stock — what the
                       * branch owns. When some of it is promised to a transfer,
                       * the caption says how much can actually be sold rather
                       * than quietly showing a smaller total (H1.1).
                       */
                      valueCaption={
                        row.reservedQuantity > 0
                          ? t('inventory.availableOf', {
                              available: formatQuantity(row.availableQuantity),
                            })
                          : t('inventory.inStock')
                      }
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
  const styles = useStyles();
  const colors = useColors();
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
  const styles = useStyles();
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

/**
 * The shelf as a shopkeeper counts it: "iPhone 17 Pro Max — 4 in stock".
 *
 * Every one of those four is still an individual `Unit` with its own IMEI, and
 * still findable by either of its identifiers. This is a presentation of the
 * same rows, not a different kind of record — which is why the storage and
 * colour breakdown sits one level down rather than splitting the headline. A
 * shopkeeper asked "how many 17 Pro Max"; "two black and two blue" is the
 * answer to the next question, not this one.
 *
 * The count comes from the server on every load. Nothing here adds up rows or
 * remembers a total.
 */
function ModelList({
  loading,
  empty,
  tracked,
  quantity,
  onOpen,
}: {
  loading: boolean;
  empty: boolean;
  tracked: ModelStockRow[];
  quantity: ModelStockRow[];
  onOpen: (model: ModelStockRow) => void;
}) {
  const { t } = useTranslation();

  if (loading) return <SkeletonList count={6} />;
  if (empty) {
    return (
      <EmptyState
        icon={PackageSearch}
        title={t('inventory.empty.title')}
        body={t('inventory.empty.body')}
      />
    );
  }

  const row = (m: ModelStockRow) => {
    /*
     * Shown only when it says something. One variant adds a line that repeats
     * what the count already said; several is the reason somebody tapped.
     */
    const named = m.variants.filter((v) => v.variant);
    const breakdown =
      named.length > 1 ? named.map((v) => `${v.variant} · ${v.inStock}`).join('   ') : undefined;

    return (
      <ListRow
        key={`${m.brand} ${m.model}`}
        leading={m.trackingType === 'quantity' ? Cable : PackageSearch}
        title={`${m.brand} ${m.model}`.trim()}
        subtitle={breakdown}
        // The number in words as well as as a figure, so "4" is never a bare
        // digit somebody has to interpret.
        value={<Text variant="title">{formatQuantity(m.inStock)}</Text>}
        valueCaption={t('inventory.inStock')}
        onPress={() => onOpen(m)}
      />
    );
  };

  return (
    <>
      {tracked.length > 0 ? (
        <>
          <SectionHeading
            label={t('inventory.models')}
            // Every unit in the branch is counted, so this is a total rather
            // than a page — said plainly, unlike the paginated unit list.
            count={t('inventory.count.models', {
              models: tracked.length,
              units: tracked.reduce((n, m) => n + m.inStock, 0),
            })}
          />
          {tracked.map(row)}
        </>
      ) : null}

      {quantity.length > 0 ? (
        <>
          <SectionHeading
            label={t('inventory.accessories')}
            count={t('inventory.count.models', {
              models: quantity.length,
              units: quantity.reduce((n, m) => n + m.inStock, 0),
            })}
            spaced={tracked.length > 0}
          />
          {quantity.map(row)}
        </>
      ) : null}
    </>
  );
}

const useStyles = makeStyles((colors) => ({
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
}));
