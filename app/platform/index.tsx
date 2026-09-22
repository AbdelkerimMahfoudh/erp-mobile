import React, { useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Button, Chip, EmptyState, ErrorState, ListSeparator, Screen, SearchInput, SkeletonList, Text } from '../../components/ui';
import { radius, space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { formatDate } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import {
  PLATFORM_STATES,
  usePlatformBusinesses,
  usePlatformDashboard,
  usePlatformGuard,
  usePlatformSignOut,
  type PlatformBusinessRow,
  type PlatformState,
} from '../../lib/platform-admin';
import { platformStateTone } from '../../lib/platform-state';

/**
 * The platform overview: how many businesses sit in each state, a search, a
 * filter, and the businesses as compact rows. Everything shown is the
 * server's — the counts come from the same rules the app enforces.
 */
export default function PlatformOverview() {
  const styles = useStyles();
  const { t } = useTranslation();
  const router = useRouter();
  const session = usePlatformGuard();
  const signOut = usePlatformSignOut();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [state, setState] = useState<PlatformState | null>(null);
  const [page, setPage] = useState(1);

  const dashboard = usePlatformDashboard();
  const list = usePlatformBusinesses(search, state, page);

  if (!session) return null;
  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  return (
    <Screen scroll={false}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: t('platform.overview.title'),
          headerRight: () => (
            <Button title={t('platform.signOut')} variant="tertiary" size="sm" onPress={() => signOut.mutate()} loading={signOut.isPending} />
          ),
        }}
      />
      <FlatList
        data={rows}
        keyExtractor={(row) => row.id}
        renderItem={({ item, index }) => (
          <BusinessRow row={item} first={index === 0} last={index === rows.length - 1} onPress={() => router.push(`/platform/${item.id}` as never)} />
        )}
        ItemSeparatorComponent={ListSeparator}
        ListHeaderComponent={
          <View style={styles.header}>
            {dashboard.data ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.counts}>
                {(['pending', 'active', 'grace', 'expired', 'suspended', 'rejected'] as const).map((s) => (
                  <Pressable key={s} onPress={() => { setState(state === s ? null : s); setPage(1); }} style={styles.count} accessibilityRole="button">
                    <Text variant="moneyLarge">{String(dashboard.data!.byState[s] ?? 0)}</Text>
                    <Chip tone={platformStateTone(s)} label={t(`platform.state.${s}` as never)} size="sm" dot />
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
            <SearchInput
              value={query}
              onChangeText={setQuery}
              onDebouncedChange={(v) => { setSearch(v); setPage(1); }}
              onSubmit={(v) => { setSearch(v); setPage(1); }}
              placeholder={t('platform.overview.search')}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
              <FilterPill label={t('platform.filter.all')} selected={state === null} onPress={() => { setState(null); setPage(1); }} />
              {PLATFORM_STATES.map((s) => (
                <FilterPill key={s} label={t(`platform.state.${s}` as never)} selected={state === s} onPress={() => { setState(s); setPage(1); }} />
              ))}
            </ScrollView>
            <View style={styles.tools}>
              <Text variant="caption" tone="secondary" style={styles.flex}>
                {t('platform.overview.total', { count: String(total) })}
              </Text>
              <Button title={t('platform.overview.audit')} variant="tertiary" size="sm" onPress={() => router.push('/platform/audit' as never)} />
              <Button title={t('platform.overview.create')} variant="secondary" size="sm" onPress={() => router.push('/platform/new' as never)} />
            </View>
            {list.isLoading ? <SkeletonList count={4} /> : null}
            {list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : null}
            {list.data && rows.length === 0 ? <EmptyState title={t('platform.overview.empty')} size="inline" /> : null}
          </View>
        }
        ListFooterComponent={
          pages > 1 ? (
            <View style={styles.pager}>
              <Button title={t('platform.pager.previous')} variant="tertiary" size="sm" disabled={page <= 1} onPress={() => setPage((p) => p - 1)} />
              <Text variant="caption" tone="secondary">{`${page} / ${pages}`}</Text>
              <Button title={t('platform.pager.next')} variant="tertiary" size="sm" disabled={page >= pages} onPress={() => setPage((p) => p + 1)} />
            </View>
          ) : null
        }
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      />
    </Screen>
  );
}

function FilterPill({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Button title={label} variant={selected ? 'primary' : 'secondary'} size="sm" onPress={onPress} />;
}

function BusinessRow({ row, first, last, onPress }: { row: PlatformBusinessRow; first: boolean; last: boolean; onPress: () => void }) {
  const styles = useStyles();
  const { t } = useTranslation();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={[styles.row, first ? styles.rowFirst : null, last ? styles.rowLast : null]}>
      <View style={styles.rowHead}>
        <Text variant="bodyStrong" numberOfLines={1} style={styles.flex}>
          {row.name}
        </Text>
        <Chip tone={platformStateTone(row.state)} label={t(`platform.state.${row.state}` as never)} size="sm" dot />
      </View>
      <Text variant="caption" tone="secondary">
        {[row.publicStoreId, row.city].filter(Boolean).join(' · ')}
      </Text>
      <Text variant="caption" tone="tertiary">
        {row.periodEnd ? t('platform.row.periodEnd', { date: formatDate(row.periodEnd) }) : t('platform.row.noPeriod')}
        {' · '}
        {t('platform.row.people', { branches: String(row.branches), users: String(row.users) })}
      </Text>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  flex: { flex: 1 },
  content: { paddingBottom: space['3xl'] },
  header: { gap: space.md, paddingBottom: space.md },
  counts: { gap: space.sm },
  count: {
    minWidth: 104,
    padding: space.md,
    gap: space.xs,
    borderRadius: radius.lg,
    backgroundColor: colors.surface.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.subtle,
  },
  filters: { gap: space.sm },
  tools: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  row: {
    backgroundColor: colors.surface.card,
    borderColor: colors.border.subtle,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    gap: 2,
  },
  rowFirst: { borderTopWidth: StyleSheet.hairlineWidth, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  rowLast: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.md, paddingTop: space.base },
}));
