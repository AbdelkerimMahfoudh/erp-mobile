import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Search, Plus, Tag, FolderTree } from 'lucide-react-native';
import { Badge, EmptyState, Text as AppText } from '../../components/ui';
import { usePressed } from '../../components/ui/use-pressed';
import { radius, space, touch } from '../../lib/design/tokens';
import { api } from '../../lib/api-client';
import { qk } from '../../lib/query-keys';
import { usePermission } from '../../lib/permissions';
import { useTranslation } from '../../lib/i18n';
import type { ProductListRow, ProductPage, TrackingType } from '../../types/api';
import { useColors } from '../../lib/design/theme';

/**
 * Catalog (G1).
 *
 * Everything is resolved server-side — search, filters and cursor pagination —
 * because the catalog outgrows any fixed page long before a shop notices. The
 * create control is gated on `catalog.manage`: employees browse the catalog,
 * managers shape it. The server enforces that regardless; this only keeps the
 * UI from offering a button that would 403.
 */

type ActiveFilter = 'active' | 'inactive' | 'all';

const TRACKING_FILTERS: { value: TrackingType | 'all'; key: string }[] = [
  { value: 'all', key: 'catalog.filter.allTypes' },
  { value: 'imei', key: 'catalog.filter.phones' },
  { value: 'serial', key: 'catalog.filter.serial' },
  { value: 'quantity', key: 'catalog.filter.quantity' },
];

export default function CatalogScreen() {
  const colors = useColors();
  const router = useRouter();
  const { t } = useTranslation();
  const canManage = usePermission('catalog.manage');
  const [q, setQ] = useState('');
  const [tracking, setTracking] = useState<TrackingType | 'all'>('all');
  const [active, setActive] = useState<ActiveFilter>('active');

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    if (tracking !== 'all') p.set('trackingType', tracking);
    if (active !== 'active') p.set('active', active);
    return p;
  }, [q, tracking, active]);

  const page = useInfiniteQuery({
    queryKey: qk.products(params.toString()),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams(params);
      if (pageParam) p.set('cursor', pageParam);
      return api.get<ProductPage>(`/products?${p.toString()}`);
    },
    getNextPageParam: (last) => last.nextCursor,
  });

  const rows = page.data?.pages.flatMap((p) => p.rows) ?? [];
  const total = page.data?.pages[0]?.totalActive ?? 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.canvas }}>
      <Stack.Screen options={{ headerShown: true, title: t('catalog.title') }} />

      <View className="border-b px-4 py-3" style={{ borderColor: colors.border.subtle, backgroundColor: colors.surface.card }}>
        <View className="flex-row items-center gap-2 rounded-xl border px-3" style={{ borderColor: colors.border.default }}>
          <Search size={18} color={colors.brand[600]} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder={t('catalog.search')}
            placeholderTextColor={colors.text.tertiary}
            className="flex-1 py-3 text-base" style={{ color: colors.text.primary }}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <View className="mt-3 flex-row flex-wrap gap-2">
          {TRACKING_FILTERS.map((f) => (
            <Pressable
              key={f.value}
              onPress={() => setTracking(f.value)}
              className="rounded-full border px-3 py-1"
              style={{
                borderColor:
                  tracking === f.value ? colors.intent.info.solid : colors.border.default,
                backgroundColor:
                  tracking === f.value ? colors.intent.info.bg : colors.surface.card,
              }}
            >
              <Text
                className="text-sm"
                style={{
                  color: tracking === f.value ? colors.intent.info.fg : colors.text.secondary,
                }}
              >
                {t(f.key as never)}
              </Text>
            </Pressable>
          ))}
          {/* Categories management — managers only, same gate as create/edit. */}
          {canManage ? (
            <Pressable
              onPress={() => router.push('/catalog/categories' as never)}
              className="flex-row items-center gap-1 rounded-full border px-3 py-1" style={{ borderColor: colors.border.default, backgroundColor: colors.surface.card }}
            >
              <FolderTree size={14} color={colors.brand[600]} />
              <Text className="text-sm" style={{ color: colors.text.secondary }}>{t('categories.title')}</Text>
            </Pressable>
          ) : null}
          {/* Archived products are a manager concern; employees never need the toggle. */}
          {canManage ? (
            <Pressable
              onPress={() => setActive(active === 'active' ? 'all' : 'active')}
              className="rounded-full border px-3 py-1"
              style={{
                borderColor:
                  active === 'active' ? colors.border.default : colors.intent.info.solid,
                backgroundColor:
                  active === 'active' ? colors.surface.card : colors.intent.info.bg,
              }}
            >
              <Text
                className="text-sm"
                style={{
                  color: active === 'active' ? colors.text.secondary : colors.intent.info.fg,
                }}
              >
                {t(active === 'active' ? 'catalog.filter.activeOnly' : 'catalog.filter.includingArchived')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {page.isError ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-center" style={{ color: colors.text.secondary }}>{t('catalog.error')}</Text>
          <Pressable
            onPress={() => page.refetch()}
            className="mt-3 rounded-xl px-4 py-2"
            style={{ backgroundColor: colors.intent.info.solid }}
          >
            <Text className="font-medium" style={{ color: colors.text.inverse }}>{t('catalog.retry')}</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(p) => p.id}
          /*
           * No horizontal padding on the container: the rows are full-bleed so
           * their hairlines run edge to edge, which is what makes the list read
           * as one surface instead of a stack. Each row carries its own inset.
           */
          contentContainerStyle={{ paddingBottom: 90 }}
          ItemSeparatorComponent={() => (
            <View
              style={{
                height: StyleSheet.hairlineWidth,
                backgroundColor: colors.semantic.divider,
                // Indented past the icon, so the separator groups the text
                // rather than cutting the row in half.
                marginStart: space.base + 36 + space.md,
              }}
            />
          )}
          refreshControl={
            <RefreshControl refreshing={page.isRefetching} onRefresh={() => page.refetch()} tintColor={colors.brand[600]} />
          }
          ListHeaderComponent={
            rows.length > 0 ? (
              // Carries its own inset now that the list is full-bleed.
              <Text
                className="text-xs"
                style={{
                  color: colors.text.secondary,
                  paddingHorizontal: space.base,
                  paddingTop: space.md,
                  paddingBottom: space.sm,
                }}
              >
                {total === 1 ? t('catalog.count.one') : t('catalog.count', { count: total })}
              </Text>
            ) : null
          }
          ListEmptyComponent={
            page.isLoading ? (
              <ActivityIndicator color={colors.brand[600]} />
            ) : (
              <EmptyState
                title={q.trim() ? t('catalog.empty.search') : t('catalog.empty')}
                body={q.trim() ? t('catalog.empty.searchBody') : t(canManage ? 'catalog.empty.manager' : 'catalog.empty.employee')}
              />
            )
          }
          renderItem={({ item }) => (
            <ProductRow
              row={item}
              archivedLabel={t('catalog.status.archived')}
              trackingText={t(`catalog.tracking.${item.trackingType}` as never)}
              onPress={() => router.push(`/catalog/${item.id}` as never)}
            />
          )}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (page.hasNextPage && !page.isFetchingNextPage) void page.fetchNextPage();
          }}
          ListFooterComponent={page.isFetchingNextPage ? <ActivityIndicator color={colors.brand[600]} /> : null}
        />
      )}

      {canManage ? (
        <Pressable
          onPress={() => router.push('/catalog/new' as never)}
          className="absolute bottom-6 right-6 h-14 w-14 items-center justify-center rounded-full shadow-lg"
          style={{ backgroundColor: colors.intent.info.solid }}
          accessibilityLabel={t('catalog.add')}
        >
          <Plus size={26} color={colors.text.inverse} />
        </Pressable>
      ) : null}
    </SafeAreaView>
  );
}

/**
 * One product, as a flat row.
 *
 * This used to be a bordered, rounded card with a margin under it, so a screen
 * of forty products was forty boxes — the eye has to cross a border, a corner
 * and a gap between every line, and the list reads as a pile of things rather
 * than as a list. Stock work is scanning down a column looking for one name.
 *
 * So: no border, no radius, no gap. A hairline between rows and the surface
 * carrying straight through. The name is the strongest thing on the line
 * because the name is what is being looked for; everything else is support.
 */
function ProductRow({
  row,
  archivedLabel,
  trackingText,
  onPress,
}: {
  row: ProductListRow;
  archivedLabel: string;
  trackingText: string;
  onPress: () => void;
}) {
  const colors = useColors();
  const { pressed, pressHandlers } = usePressed();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      {...pressHandlers}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: touch.comfortable,
        paddingHorizontal: space.base,
        paddingVertical: space.md,
        backgroundColor: pressed ? colors.surface.hover : colors.semantic.surface,
      }}
    >
      {/*
        A category mark, not a photograph. There is no product image in the API
        or the model, and inventing one would mean a storage feature nobody
        asked for — so this is a consistent icon that never lies about what it
        is showing.
      */}
      <View
        style={{
          height: 36,
          width: 36,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: radius.md,
          backgroundColor: colors.semantic.primarySoft,
        }}
      >
        <Tag size={18} color={colors.semantic.primary} />
      </View>
      <View style={{ marginStart: space.md, flex: 1, gap: 2 }}>
        {/* The exact-variant label the server assembled — one name everywhere. */}
        <AppText variant="bodyStrong" numberOfLines={1}>
          {row.label}
        </AppText>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <AppText variant="caption" tone="secondary">
            {trackingText}
          </AppText>
          {/* Status by colour AND words, never colour alone. */}
          {!row.isActive ? <Badge label={archivedLabel} tone="slate" /> : null}
        </View>
      </View>
    </Pressable>
  );
}
