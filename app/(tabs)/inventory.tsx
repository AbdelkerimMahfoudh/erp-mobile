import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Keyboard, RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ArrowLeftRight, Cable, PackagePlus, PackageSearch, X } from 'lucide-react-native';
import {
  Button,
  EmptyState,
  ErrorState,
  FilterChip,
  IconButton,
  ListRow,
  MoneyValue,
  RowGroup,
  Screen,
  SearchInput,
  SkeletonList,
  StatusChip,
  TabHeader,
  Text,
} from '../../components/ui';
import { InlineNotice } from '../../components/ui/InlineNotice';
import { ScannerSheet } from '../../components/scanner/ScannerSheet';
import { STOCK_THUMB, StockRow } from '../../components/inventory/StockRow';
import { api } from '../../lib/api-client';
import { useBranch } from '../../lib/branch';
import { useConnectivity } from '../../lib/connectivity';
import { space } from '../../lib/design/tokens';
import { formatQuantity } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { withDismiss } from '../../lib/keyboard-dismiss';
import { usePermission } from '../../lib/permissions';
import { productTitle, variantSummary } from '../../lib/product-label';
import { qk } from '../../lib/query-keys';
import { toast } from '../../lib/toast';
import type { InventoryPage, InventoryRow, ScanResult, StockSummaryRow, Unit } from '../../types/api';
import { makeStyles, useColors } from '../../lib/design/theme';

/**
 * Stock — what this branch can sell today.
 *
 * ## Two lists, and which question each answers
 *
 * The shelf is shown one row per **exact variant** — "iPhone 17, 256 GB ·
 * Black, 2 available, price 42 000 MRU, low stock" — from
 * `GET /inventory/summary`. That is the question asked fifty times a day.
 *
 * Every phone is still an individual unit with its own IMEI. Searching, or
 * tapping a phone variant, switches to the existing **unit list**
 * (`GET /inventory`): paginated, searched on the server by name, barcode,
 * **either IMEI** and serial, filtered by lifecycle status. A search is a
 * question about one handset, so it answers with handsets.
 *
 * ## Category is not status
 *
 * All / Phones / Accessories narrows the variant list, which is complete and
 * small, so it filters on the phone without hiding anything. In, sold and faulty
 * are lifecycle statuses of units and keep their server meaning on the unit
 * list. The two never share a row of chips, because they are different kinds of
 * question.
 *
 * ## What it never shows
 *
 * No cost or margin: the summary carries none, and unit rows show cost only when
 * the server sent it. A figure the server did not send is never a zero.
 */

const STATUS_FILTERS = ['in_stock', 'sold', 'faulty', ''] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];
type Category = 'all' | 'phone' | 'accessory' | 'other';

const PAGE_SIZE = 50;
/** Long enough to feel deliberate, short enough not to feel laggy. */
const SEARCH_DEBOUNCE_MS = 350;

export default function InventoryScreen() {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const router = useRouter();
  const { branchId, branchName } = useBranch();
  const online = useConnectivity((s) => s.online);
  const canReceive = usePermission('purchase.manage');
  const canViewReports = usePermission('report.view');
  const canViewTransfers = usePermission('transfer.view');

  // Arriving from a product's detail screen: that exact product's units.
  const { productId: productIdParam, category: categoryParam, status: statusParam, sort: sortParam } = useLocalSearchParams<{
    productId?: string;
    category?: string;
    status?: string;
    sort?: string;
  }>();
  /*
   * Home's "Latest phones received" deep-link (0076): Phones, every status,
   * newest received first — the same three phones Home showed, first. The
   * server orders by intake already; the phone only preselects the filters
   * and asks for units of the phone tracking type.
   */
  const deepLinked = categoryParam === 'phone' && (statusParam === 'all' || sortParam === 'received');
  /** A variant tapped here. Takes precedence over the route parameter. */
  const [focus, setFocus] = useState<{ id: string; label: string } | null>(null);
  const focusId = focus?.id ?? (productIdParam ? String(productIdParam) : undefined);

  const [category, setCategory] = useState<Category>(deepLinked ? 'phone' : 'all');
  const [status, setStatus] = useState<StatusFilter>(deepLinked ? '' : 'in_stock');
  const [phonesByArrival, setPhonesByArrival] = useState(deepLinked);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);

  const searching = debounced.length > 0;
  const mode: 'summary' | 'units' = searching || focusId || phonesByArrival ? 'units' : 'summary';

  /*
   * A branch switch starts from the whole shelf of the NEW branch. A focus or a
   * search typed for the old branch would otherwise carry over and describe
   * stock that is not here. The query keys already include the branch, so no
   * previous-branch row can render while the new one loads.
   */
  const [shownBranch, setShownBranch] = useState(branchId);
  if (shownBranch !== branchId) {
    // Adjusted during render rather than in an effect, so the stale focus and
    // search never paint even for one frame after the switch.
    setShownBranch(branchId);
    setFocus(null);
    setQuery('');
    setDebounced('');
  }

  const summary = useQuery({
    queryKey: qk.inventorySummary(branchId),
    queryFn: () => api.get<StockSummaryRow[]>('/inventory/summary'),
    enabled: Boolean(branchId) && mode === 'summary',
  });

  /**
   * The header's two figures, both counted by the server: phones owned and in
   * stock, and what they cost. `inventoryValue` is stripped without `cost.view`,
   * so it is simply absent then — never a zero.
   */
  const value = useQuery({
    queryKey: qk.inventoryValue(branchId),
    queryFn: () => api.get<{ totals: { unitsCount: number; inventoryValue?: number } }>('/analytics/inventory-value'),
    enabled: Boolean(branchId) && canViewReports,
  });

  const inventory = useInfiniteQuery({
    queryKey: qk.inventory(branchId, status, debounced, focusId, phonesByArrival ? 'imei' : undefined),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (status) params.set('status', status);
      if (phonesByArrival) params.set('trackingType', 'imei');
      if (debounced) params.set('search', debounced);
      if (focusId) params.set('productId', focusId);
      if (pageParam) params.set('cursor', pageParam);
      return api.get<InventoryPage>(`/inventory?${params.toString()}`);
    },
    getNextPageParam: (last) => last.nextCursor,
    enabled: Boolean(branchId) && mode === 'units',
  });

  // Coming back to the tab after a sale or a delivery shows the shelf as it is
  // now, not as it was when the tab was last opened.
  useFocusEffect(
    useCallback(() => {
      if (mode === 'summary') void summary.refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode]),
  );

  // ── Scan to find one handset ──────────────────────────────────────────────

  const openScanner = withDismiss(Keyboard, () => setScannerOpen(true));

  const onScanResult = useCallback(
    async (result: ScanResult) => {
      try {
        const unit = await api.get<Unit>(`/units/${encodeURIComponent(result.code)}`);
        const identifier = unit.imeiPrimary ?? unit.serialNo ?? result.code;
        router.push({ pathname: '/unit/[identifier]', params: { identifier } });
      } catch {
        toast.error(t('inventory.notFound'));
      }
    },
    [router, t],
  );

  // ── Derived ───────────────────────────────────────────────────────────────

  const allRows = useMemo(() => summary.data ?? [], [summary.data]);
  const counts = useMemo(
    () => ({
      all: allRows.length,
      phone: allRows.filter((r) => r.category === 'phone').length,
      accessory: allRows.filter((r) => r.category === 'accessory').length,
      other: allRows.filter((r) => r.category === 'other').length,
    }),
    [allRows],
  );
  const shelf = category === 'all' ? allRows : allRows.filter((r) => r.category === category);

  const rows: InventoryRow[] = useMemo(
    () => inventory.data?.pages.flatMap((page) => page.rows) ?? [],
    [inventory.data],
  );
  const totals = inventory.data?.pages[0]?.totals ?? { units: 0, stock: 0 };
  const units = rows.filter((r): r is Extract<InventoryRow, { kind: 'unit' }> => r.kind === 'unit');
  const stock = rows.filter((r): r is Extract<InventoryRow, { kind: 'stock' }> => r.kind === 'stock');

  const focusLabel =
    focus?.label ??
    (units[0]?.product ? [productTitle(units[0].product), variantSummary(units[0].product)].filter(Boolean).join(' · ') : '');

  const clearFocus = () => {
    setFocus(null);
    if (productIdParam) router.setParams({ productId: undefined });
  };

  const leaveArrivals = () => {
    setPhonesByArrival(false);
    setCategory('all');
    setStatus('in_stock');
    router.setParams({ category: undefined, status: undefined, sort: undefined });
  };

  const openVariant = (row: StockSummaryRow) => {
    if (row.category === 'accessory') {
      // Quantity stock has no units to pick between; its detail is the product.
      router.push(`/catalog/${row.productId}` as Href);
      return;
    }
    setFocus({
      id: row.productId,
      label: [productTitle(row), variantSummary(row)].filter(Boolean).join(' · '),
    });
  };

  const refresh = useCallback(() => {
    if (canViewReports) void value.refetch();
    if (mode === 'summary') void summary.refetch();
    else void inventory.refetch();
  }, [mode, summary, inventory, value, canViewReports]);

  // ── Render ────────────────────────────────────────────────────────────────

  const header = (
    <>
      <TabHeader
        context={branchName}
        title={t('inventory.title')}
        actions={
          canViewTransfers ? (
            <IconButton
              icon={ArrowLeftRight}
              variant="plain"
              accessibilityLabel={t('nav.transfers')}
              onPress={() => router.push('/transfers' as Href)}
            />
          ) : null
        }
      />
      {value.data ? (
        <View style={styles.figures}>
          <Text variant="body" tone="secondary">
            {t('stock.header.units', { count: formatQuantity(value.data.totals.unitsCount) })}
          </Text>
          {value.data.totals.inventoryValue !== undefined ? (
            <View style={styles.figureValue}>
              <Text variant="caption" tone="tertiary">
                {t('stock.header.value')}
              </Text>
              <MoneyValue value={value.data.totals.inventoryValue} size="small" />
            </View>
          ) : null}
        </View>
      ) : null}

      <SearchInput
        value={query}
        onChangeText={setQuery}
        onDebouncedChange={setDebounced}
        debounceMs={SEARCH_DEBOUNCE_MS}
        onSubmit={setDebounced}
        onScanPress={openScanner}
        placeholder={t('inventory.search')}
      />

      {mode === 'summary' ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.filters}>
            <FilterChip
              label={t('inventory.filter.all')}
              selected={category === 'all'}
              count={summary.data ? counts.all : undefined}
              onPress={() => setCategory('all')}
            />
            <FilterChip
              label={t('stock.category.phone')}
              selected={category === 'phone'}
              count={summary.data ? counts.phone : undefined}
              onPress={() => setCategory('phone')}
            />
            <FilterChip
              label={t('stock.category.accessory')}
              selected={category === 'accessory'}
              count={summary.data ? counts.accessory : undefined}
              onPress={() => setCategory('accessory')}
            />
            {/*
              Serial-tracked goods — TVs, laptops, consoles. Always under All;
              given their own chip only when the branch holds some, so a phone
              shop is not shown an empty category it never uses.
            */}
            {counts.other > 0 || category === 'other' ? (
              <FilterChip
                label={t('stock.category.other')}
                selected={category === 'other'}
                count={summary.data ? counts.other : undefined}
                onPress={() => setCategory('other')}
              />
            ) : null}
          </View>
        </ScrollView>
      ) : (
        <>
          {phonesByArrival ? (
            <View style={styles.focusRow}>
              <Text variant="bodyStrong" style={styles.focusText}>
                {t('stock.category.phone')}
              </Text>
              <IconButton icon={X} accessibilityLabel={t('stock.clearProduct')} onPress={leaveArrivals} />
            </View>
          ) : null}
          {focusId ? (
            <View style={styles.focusRow}>
              <Text variant="caption" tone="secondary" style={styles.focusText} numberOfLines={2}>
                {t('stock.showingProduct', { product: focusLabel })}
              </Text>
              <IconButton icon={X} accessibilityLabel={t('stock.clearProduct')} onPress={clearFocus} />
            </View>
          ) : null}
          {phonesByArrival ? (
            <Text variant="caption" tone="secondary">
              {t('stock.newestReceived')}
            </Text>
          ) : null}
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
      )}
    </>
  );

  const footer = canReceive ? (
    <Button
      title={t('stock.receive')}
      icon={PackagePlus}
      fullWidth
      onPress={() => router.push('/receive' as Href)}
    />
  ) : undefined;

  const active = mode === 'summary' ? summary : inventory;
  const staleNotice =
    (!online || active.isError) && active.data ? (
      <InlineNotice tone="warning" style={styles.notice}>
        {t('stock.offline')}
      </InlineNotice>
    ) : null;

  return (
    <Screen scroll={false} padded={false} header={header} footer={footer}>
      <ScannerSheet open={scannerOpen} onClose={() => setScannerOpen(false)} onResult={onScanResult} />

      {!branchId ? (
        <EmptyState icon={PackageSearch} title={t('branch.select.title')} />
      ) : active.isError && !active.data ? (
        // A 403 renders "Not available to you" with no retry; anything else can
        // be retried. Unknown stock is never drawn as an empty shelf.
        <ErrorState error={active.error} onRetry={refresh} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onScroll={({ nativeEvent: e }) => {
            if (mode !== 'units') return;
            const nearEnd = e.layoutMeasurement.height + e.contentOffset.y >= e.contentSize.height - 600;
            if (nearEnd && inventory.hasNextPage && !inventory.isFetchingNextPage) {
              void inventory.fetchNextPage();
            }
          }}
          scrollEventThrottle={200}
          refreshControl={
            <RefreshControl
              refreshing={active.isRefetching}
              onRefresh={refresh}
              tintColor={colors.brand[600]}
              colors={[colors.brand[600]]}
            />
          }
        >
          {staleNotice}
          {mode === 'summary' ? (
            <ShelfList
              loading={summary.isLoading}
              rows={shelf}
              everything={allRows.length}
              canReceive={canReceive}
              onReceive={() => router.push('/receive' as Href)}
              onOpen={openVariant}
            />
          ) : inventory.isLoading ? (
            <SkeletonList count={6} />
          ) : rows.length === 0 ? (
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
                    count={t('inventory.count.units', { shown: units.length, total: totals.units })}
                  />
                  <RowGroup>
                    {units.map((row) => (
                      <ListRow
                        key={row.id}
                        flat
                        leading={PackageSearch}
                        title={productTitle(row.product, row.identifier)}
                        subtitle={variantSummary(row.product) || undefined}
                        identifier={row.identifier}
                        accessory={<StatusChip domain="unit" value={row.status} size="sm" />}
                        /*
                         * Cost, only when the server actually sent it — it is
                         * stripped without `cost.view`. Never a dash or a zero,
                         * which would read as "this phone cost nothing".
                         */
                        value={row.cost !== undefined ? <MoneyValue value={row.cost} size="small" tone="muted" /> : undefined}
                        valueCaption={row.cost !== undefined ? t('inventory.cost') : undefined}
                        onPress={() =>
                          router.push({ pathname: '/unit/[identifier]', params: { identifier: row.identifier } })
                        }
                      />
                    ))}
                  </RowGroup>
                </>
              ) : null}

              {stock.length > 0 ? (
                <>
                  <SectionHeading
                    label={t('inventory.accessories')}
                    count={t('inventory.count.stock', { shown: stock.length, total: totals.stock })}
                    spaced={units.length > 0}
                  />
                  <RowGroup>
                    {stock.map((row) => (
                      <ListRow
                        key={row.id}
                        flat
                        leading={Cable}
                        title={productTitle(row.product)}
                        subtitle={variantSummary(row.product) || undefined}
                        identifier={row.product?.barcode ?? undefined}
                        value={formatQuantity(row.quantity)}
                        /*
                         * The headline stays PHYSICAL stock. When some of it is
                         * promised to a transfer, the caption says how much can
                         * actually be sold (H1.1).
                         */
                        valueCaption={
                          row.reservedQuantity > 0
                            ? t('inventory.availableOf', { available: formatQuantity(row.availableQuantity) })
                            : t('inventory.inStock')
                        }
                        onPress={() => router.push(`/catalog/${row.productId}` as Href)}
                      />
                    ))}
                  </RowGroup>
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
 * The shelf, one row per variant.
 *
 * Complete rather than paginated — it is one row per variant, not per unit — so
 * narrowing by category on the phone hides nothing the server knows about.
 */
function ShelfList({
  loading,
  rows,
  everything,
  canReceive,
  onReceive,
  onOpen,
}: {
  loading: boolean;
  rows: StockSummaryRow[];
  everything: number;
  canReceive: boolean;
  onReceive: () => void;
  onOpen: (row: StockSummaryRow) => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();

  if (loading) return <SkeletonList count={6} />;

  if (everything === 0) {
    return (
      <EmptyState
        icon={PackageSearch}
        title={t('inventory.empty.title')}
        body={t('inventory.empty.body')}
        action={canReceive ? { label: t('stock.receive'), onPress: onReceive, icon: PackagePlus } : undefined}
      />
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={PackageSearch}
        title={t('stock.empty.category.title')}
        body={t('stock.empty.category.body')}
      />
    );
  }

  return (
    <>
      {/* The chips count products (rows), not pieces — said once, above the rows. */}
      <Text variant="caption" tone="tertiary" style={styles.hint}>
        {t('stock.countsHint')}
      </Text>
      <RowGroup separatorInset={STOCK_THUMB + space.md * 2}>
        {rows.map((row) => (
          <StockRow key={row.productId} row={row} onPress={() => onOpen(row)} />
        ))}
      </RowGroup>
    </>
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

function SectionHeading({ label, count, spaced = false }: { label: string; count: string; spaced?: boolean }) {
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

const useStyles = makeStyles(() => ({
  figures: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  figureValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  filters: {
    flexDirection: 'row',
    gap: space.sm,
  },
  focusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  focusText: {
    flex: 1,
  },
  notice: {
    marginBottom: space.md,
  },
  hint: {
    marginBottom: space.sm,
  },
  list: {
    padding: space.base,
    /*
     * No gap: rows abut and are separated by the group's hairline. The footer
     * with Receive stock sits OUTSIDE this scroll area, so the last row can
     * always scroll clear of it; this padding is overscroll comfort.
     */
    gap: 0,
    paddingBottom: space['3xl'],
  },
  sectionHeading: {
    marginBottom: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  sectionSpaced: {
    marginTop: space.lg,
  },
  footer: {
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.lg,
  },
}));
