import React, { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Plus } from 'lucide-react-native';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  FilterChip,
  Identifier,
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
import { formatMoney, formatSmartDateTime } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import { useReturns } from '../../lib/returns';
import type { ReturnListRow, ReturnStatus } from '../../types/api';

/**
 * Returns — what has been brought back, and what is waiting for somebody.
 *
 * Search, filters and paging are all the server's, as in Sales. Every total on
 * a row is PROVISIONAL until approval, and the row says so rather than showing
 * a number that looks settled.
 */

type Tab = 'all' | ReturnStatus;

const TABS: Tab[] = ['all', 'pending_investigation', 'under_review', 'approved_refund_due', 'rejected'];

export default function ReturnsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const canView = usePermission('return.view');
  const canRequest = usePermission('return.request');
  const branchName = useBranch((s) => s.branchName);

  const [tab, setTab] = useState<Tab>('all');
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');

  const page = useReturns({ search, status: tab === 'all' ? undefined : [tab] });
  const rows = page.data?.pages.flatMap((p) => p.rows) ?? [];

  if (!canView) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: t('returns.title') }} />
        <EmptyState title={t('returns.forbidden')} body={t('returns.forbiddenBody')} />
      </Screen>
    );
  }

  const header = (
    <View style={styles.header}>
      <SearchInput
        value={typed}
        onChangeText={setTyped}
        onDebouncedChange={setSearch}
        placeholder={t('returns.search')}
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
            label={t(`returns.filter.${item}` as never)}
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
      <Stack.Screen
        options={{
          headerShown: true,
          title: branchName ? `${t('returns.title')} — ${branchName}` : t('returns.title'),
        }}
      />

      {page.isError ? (
        <ErrorState
          error={page.error}
          onRetry={
            // A 403 is an answer, not a fault; offering Retry invites the user
            // to keep asking a question already answered.
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
                    ? t('returns.empty.search')
                    : isFiltered
                      ? t('returns.empty.filter')
                      : t('returns.empty')
                }
                body={
                  search.trim()
                    ? t('returns.empty.searchBody')
                    : isFiltered
                      ? t('returns.empty.filterBody')
                      : t('returns.emptyBody')
                }
              />
            )
          }
          renderItem={({ item }) => (
            <Row row={item} onPress={() => router.push(`/returns/${item.id}` as never)} />
          )}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (page.hasNextPage && !page.isFetchingNextPage) void page.fetchNextPage();
          }}
          ListFooterComponent={
            page.isFetchingNextPage ? (
              <SkeletonList count={2} />
            ) : rows.length > 0 && !page.hasNextPage ? (
              <Text variant="caption" tone="tertiary" style={styles.end}>
                {t('returns.endOfResults')}
              </Text>
            ) : null
          }
        />
      )}

      {canRequest ? (
        <View style={styles.fab}>
          <Button title={t('returns.new.title')} icon={Plus} onPress={() => router.push('/returns/new' as never)} />
        </View>
      ) : null}
    </Screen>
  );
}

function Row({ row, onPress }: { row: ReturnListRow; onPress: () => void }) {
  const { t } = useTranslation();

  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Card>
        <View style={styles.rowHead}>
          {/* Colour AND words, from the shared registry. */}
          <StatusChip domain="return" value={row.status} size="sm" />
          <Text variant="caption" tone="tertiary">
            {formatSmartDateTime(row.requestedAt)}
          </Text>
        </View>

        <Text variant="bodyStrong" style={styles.rowTitle} numberOfLines={1}>
          {row.product}
        </Text>
        {row.identifier ? <Identifier>{row.identifier}</Identifier> : null}

        <View style={styles.rowChips}>
          <StatusChip domain="custody" value={row.custody} size="sm" />
          {row.requiresException ? (
            // Says an owner is needed, without exposing why.
            <Chip label={t('returns.exceptionNeeded')} tone="warning" size="sm" />
          ) : null}
        </View>

        <View style={styles.rowFoot}>
          <Text variant="caption" tone="secondary">
            {t('sales.invoice', { no: row.invoiceNo })}
            {row.requestedBy ? ` · ${t('returns.requestedBy', { name: row.requestedBy })}` : ''}
          </Text>
          {/* Named provisional on the row itself: an approved return shows the
              agreed figure, everything earlier is still a proposal. */}
          <Text variant="caption" tone={row.status === 'approved_refund_due' ? 'primary' : 'tertiary'}>
            {row.status === 'approved_refund_due'
              ? `${t('returns.detail.net')}: ${formatMoney(row.provisionalNetRefundDue)}`
              : `${t('returns.detail.provisional')}`}
          </Text>
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: colors.surface.canvas, paddingBottom: space.sm, gap: space.sm },
  tabs: { gap: space.xs, paddingVertical: space.xs },
  list: { padding: space.base, paddingBottom: space['4xl'] },
  gap: { height: space.sm },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowTitle: { marginTop: space.sm },
  rowChips: { flexDirection: 'row', gap: space.xs, marginTop: space.sm, flexWrap: 'wrap' },
  rowFoot: { marginTop: space.sm, gap: space.xs },
  end: { textAlign: 'center', paddingVertical: space.base },
  fab: { position: 'absolute', left: space.base, right: space.base, bottom: space.base },
});
