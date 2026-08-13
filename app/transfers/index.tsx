import React, { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { ArrowDownLeft, ArrowUpRight, Plus } from 'lucide-react-native';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  FilterChip,
  Screen,
  SearchInput,
  SkeletonList,
  StatusChip,
  Text,
} from '../../components/ui';
import { ApiError } from '../../lib/api-client';
import { useBranch } from '../../lib/branch';
import { colors } from '../../lib/design/colors';
import { space } from '../../lib/design/tokens';
import { formatSmartDateTime } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { transferSummary } from '../../lib/transfer-summary';
import { usePermission } from '../../lib/permissions';
import { useTransfers } from '../../lib/transfers';
import type { TransferListRow, TransferStatus } from '../../types/api';

/**
 * Transfers — the history, and the work waiting.
 *
 * Everything is resolved server-side: the status filter, the search and the
 * paging. A client that filtered its loaded pages would answer "nothing
 * matches" for a transfer that exists two pages down, which is worse than
 * having no search at all.
 *
 * The tabs are the history the user asked for — somewhere to look that does not
 * lose completed and refused transfers among the live ones.
 */

type Tab = 'all' | TransferStatus;

const TABS: Tab[] = [
  'all',
  'pending_approval',
  'approved',
  'in_transit',
  'received',
  'rejected',
  'cancelled',
];

export default function TransfersScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const canView = usePermission('transfer.view');
  const canRequest = usePermission('transfer.request');
  const branchName = useBranch((s) => s.branchName);

  const [tab, setTab] = useState<Tab>('all');
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');

  const page = useTransfers({
    status: tab === 'all' ? undefined : [tab],
    search,
  });

  const rows = page.data?.pages.flatMap((p) => p.rows) ?? [];

  /**
   * The menu should not have offered this, but a deep link or a stale session
   * can land here anyway. Say so plainly rather than showing an empty list that
   * looks like "you have no transfers".
   */
  if (!canView) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: t('transfers.title') }} />
        <EmptyState title={t('transfers.forbidden')} body={t('transfers.forbiddenBody')} />
      </Screen>
    );
  }

  const header = (
    <View style={styles.header}>
      <SearchInput
        value={typed}
        onChangeText={setTyped}
        onDebouncedChange={setSearch}
        placeholder={t('transfers.search')}
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
            label={t(`transfers.filter.${item}` as never)}
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
      {/* The active branch is in the title: this list is that branch's two ends,
          and which branch you are standing in changes what you see. */}
      <Stack.Screen
        options={{
          headerShown: true,
          title: branchName ? `${t('transfers.title')} — ${branchName}` : t('transfers.title'),
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
                    ? t('transfers.empty.search')
                    : isFiltered
                      ? t('transfers.empty.filter')
                      : t('transfers.empty')
                }
                body={
                  search.trim()
                    ? t('transfers.empty.searchBody')
                    : isFiltered
                      ? t('transfers.empty.filterBody')
                      : t('transfers.emptyBody')
                }
              />
            )
          }
          renderItem={({ item }) => (
            <Row row={item} onPress={() => router.push(`/transfers/${item.id}` as never)} />
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
                {t('transfers.endOfResults')}
              </Text>
            ) : null
          }
        />
      )}

      {canRequest ? (
        <View style={styles.fab}>
          <Button
            title={t('transfers.new')}
            icon={Plus}
            onPress={() => router.push('/transfers/new' as never)}
          />
        </View>
      ) : null}
    </Screen>
  );
}

function Row({ row, onPress }: { row: TransferListRow; onPress: () => void }) {
  const { t } = useTranslation();
  const outgoing = row.direction === 'outgoing';

  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Card>
      <View style={styles.rowHead}>
        <View style={styles.rowChips}>
          {/* Status by colour AND words — never a bare coloured dot. */}
          <StatusChip domain="transfer" value={row.status} size="sm" />
          <Chip
            label={t(outgoing ? 'transfers.direction.outgoing' : 'transfers.direction.incoming')}
            tone="neutral"
            size="sm"
            icon={outgoing ? ArrowUpRight : ArrowDownLeft}
          />
        </View>
        <Text variant="caption" tone="tertiary">
          {formatSmartDateTime(row.requestedAt)}
        </Text>
      </View>

      <Text variant="bodyStrong" style={styles.rowTitle}>
        {row.transferNo ?? t('transfers.detail.title')}
      </Text>
      <Text variant="caption" tone="secondary">
        {t('transfers.route', { from: row.from.name, to: row.to.name })}
      </Text>

      <View style={styles.rowFoot}>
        <Text variant="caption" tone="secondary">
          {/* '10 chargers' is one row and ten things. The row says both when
              they differ, and never calls a carton one item. */}
          {transferSummary(row, t)}
        </Text>
        {row.requestedBy ? (
          <Text variant="caption" tone="tertiary" numberOfLines={1}>
            {t('transfers.requestedBy', { name: row.requestedBy })}
          </Text>
        ) : null}
      </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: colors.surface.canvas, paddingBottom: space.sm, gap: space.sm },
  tabs: { gap: space.xs, paddingVertical: space.xs },
  list: { padding: space.base, paddingBottom: space['3xl'] },
  gap: { height: space.sm },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowChips: { flexDirection: 'row', gap: space.xs, flexShrink: 1 },
  rowTitle: { marginTop: space.sm },
  rowFoot: {
    marginTop: space.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  end: { textAlign: 'center', paddingVertical: space.base },
  fab: { position: 'absolute', left: space.base, right: space.base, bottom: space.base },
});
