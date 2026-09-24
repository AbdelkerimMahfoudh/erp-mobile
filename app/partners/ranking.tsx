import React from 'react';
import { FlatList, View } from 'react-native';
import { Stack } from 'expo-router';
import { Handshake } from 'lucide-react-native';
import { Button, Card, EmptyState, ErrorState, MoneyValue, Screen, SkeletonList, Text } from '../../components/ui';
import { useBranch } from '../../lib/branch';
import { radius, space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { CURRENCY_CODE, formatRelative } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { usePartnerRanking, type PartnerRankRow } from '../../lib/home';
import { isolateLtr } from '../../lib/design/direction';

/**
 * Boutique ranking (docs/50 §3.5): every partner this branch has completed a
 * trade with, all time, ordered by the value of those trades — value first,
 * then how many, with a stable tie-breaker on the server. Paginated: a shop
 * with many partners scrolls; "See more" is the way on. An honest empty state
 * when nothing has been completed yet — never a sample row.
 */
export default function PartnerRankingScreen() {
  const styles = useStyles();
  const { t } = useTranslation();
  const { branchName } = useBranch();
  const ranking = usePartnerRanking();
  const rows = ranking.data?.pages.flatMap((p) => p.rows) ?? [];
  const first = ranking.data?.pages[0];

  return (
    <Screen scroll={false} gap="md">
      <Stack.Screen options={{ headerShown: true, title: t('ranking.title') }} />
      {ranking.isPending ? (
        <SkeletonList count={6} />
      ) : ranking.isError && rows.length === 0 ? (
        <ErrorState error={ranking.error} onRetry={() => void ranking.refetch()} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.counterpartyId}
          ListHeaderComponent={
            <View style={styles.header}>
              <Text variant="label" tone="secondary">
                {t('ranking.context', { branch: branchName ?? '' })}
              </Text>
              <Text variant="display" accessibilityRole="header">
                {t('ranking.headline')}
              </Text>
              <Text variant="body" tone="secondary">
                {t('ranking.subtitle')}
              </Text>
            </View>
          }
          renderItem={({ item, index }) => (
            <Card style={[styles.card, index > 0 && styles.cardJoin]}>
              <RankRow row={item} />
            </Card>
          )}
          ListEmptyComponent={
            <EmptyState
              icon={Handshake}
              title={first?.partnersExist ? t('ranking.empty.title') : t('ranking.noPartners')}
              body={t('ranking.empty.body')}
            />
          }
          ListFooterComponent={
            <View style={styles.footer}>
              {ranking.hasNextPage ? (
                <Button title={t('ranking.more')} variant="secondary" loading={ranking.isFetchingNextPage} onPress={() => void ranking.fetchNextPage()} />
              ) : rows.length > 0 ? (
                <Text variant="caption" tone="tertiary" align="center">
                  {t('ranking.end')}
                </Text>
              ) : null}
              {ranking.dataUpdatedAt ? (
                <Text variant="caption" tone="tertiary" align="center">
                  {t('ranking.refreshed', { time: formatRelative(ranking.dataUpdatedAt) })}
                </Text>
              ) : null}
            </View>
          }
          onEndReached={() => {
            if (ranking.hasNextPage && !ranking.isFetchingNextPage) void ranking.fetchNextPage();
          }}
          onEndReachedThreshold={0.4}
          refreshing={ranking.isRefetching}
          onRefresh={() => void ranking.refetch()}
          contentContainerStyle={styles.content}
        />
      )}
    </Screen>
  );
}

/** Rank in a disc, the name and its trade count, the value right-aligned with its unit. */
function RankRow({ row }: { row: PartnerRankRow }) {
  const styles = useStyles();
  const { t } = useTranslation();
  return (
    <View style={styles.row} accessible accessibilityLabel={`${row.rank}. ${row.name}, ${t('ranking.trades', { count: String(row.completedTrades) })}`}>
      <View style={styles.rankDisc}>
        <Text variant="labelStrong" tone="accent">
          {isolateLtr(String(row.rank))}
        </Text>
      </View>
      <View style={styles.body}>
        <Text variant="heading" numberOfLines={2}>
          {row.name}
        </Text>
        <Text variant="caption" tone="secondary">
          {t('ranking.trades', { count: String(row.completedTrades) })}
        </Text>
      </View>
      <View style={styles.value}>
        <MoneyValue value={row.value} size="large" showCurrency={false} />
        <Text variant="caption" tone="tertiary">
          {isolateLtr(CURRENCY_CODE)}
        </Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  content: { paddingBottom: space['3xl'] },
  header: { gap: space.xs, paddingBottom: space.base },
  card: { paddingVertical: space.md },
  cardJoin: { marginTop: -1, borderTopLeftRadius: 0, borderTopRightRadius: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rankDisc: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.intent.info.bg,
  },
  body: { flex: 1, minWidth: 0, gap: 2 },
  value: { alignItems: 'flex-end', gap: 0 },
  footer: { paddingTop: space.base, gap: space.sm, alignItems: 'center' },
}));
