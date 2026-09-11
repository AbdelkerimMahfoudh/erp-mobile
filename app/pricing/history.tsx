import React from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Card, EmptyState, ErrorState, Screen, SkeletonList, Text } from '../../components/ui';
import { space } from '../../lib/design/tokens';
import { formatSmartDateTime } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { money } from '../../lib/theme';
import { usePriceHistory } from '../../lib/pricing';
import type { PriceHistoryRow } from '../../types/api';

/**
 * Who changed a price, when, and from what to what.
 *
 * Bounded by design — the endpoint is keyset-paginated and this asks for one
 * page. An unbounded history fetch on a shop phone is a slow screen that gets
 * slower every month.
 *
 * The screen is reachable only from a pricing action, which is already gated on
 * `price.edit`; the endpoint enforces the same, so a deep link cannot read it.
 */
export default function PriceHistoryScreen() {
  const { t } = useTranslation();
  const { productId } = useLocalSearchParams<{ productId?: string }>();
  const history = usePriceHistory(productId);

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: t('pricing.history.title') }} />

      {history.isLoading ? (
        <SkeletonList count={6} />
      ) : history.isError ? (
        <ErrorState error={history.error as Error} onRetry={() => void history.refetch()} />
      ) : (
        <FlatList
          data={history.data?.rows ?? []}
          keyExtractor={(row) => row.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.gap} />}
          ListEmptyComponent={
            <EmptyState title={t('pricing.history.empty')} body={t('pricing.history.emptyBody')} />
          }
          renderItem={({ item }) => <HistoryRow row={item} />}
        />
      )}
    </Screen>
  );
}

function HistoryRow({ row }: { row: PriceHistoryRow }) {
  const { t } = useTranslation();

  /**
   * `initiator` is `user` or `system` — never a role. A transfer retiring an
   * override is the system acting, and saying "Automatic" is more honest than
   * naming whoever happened to receive the transfer.
   */
  const automatic = row.initiator === 'system';
  const who = automatic ? t('pricing.history.system') : (row.actorName ?? t('pricing.history.system'));

  const change =
    row.newPrice === null
      ? t('pricing.history.removed')
      : row.previousPrice === null
        ? money(row.newPrice)
        : `${money(row.previousPrice)} → ${money(row.newPrice)}`;

  return (
    <Card>
      <View style={styles.row}>
        <Text variant="bodyStrong">{change}</Text>
        <Text variant="caption" tone="tertiary">
          {formatSmartDateTime(row.at)}
        </Text>
      </View>

      <Text variant="caption" tone="tertiary" style={styles.meta}>
        {who} · {t(`pricing.history.scope.${row.scope}` as never)}
      </Text>

      {automatic && row.reason === 'branch_transfer' ? (
        <Text variant="caption" tone="tertiary" style={styles.meta}>
          {t('pricing.history.transfer')}
        </Text>
      ) : row.reason ? (
        <Text variant="caption" tone="tertiary" style={styles.meta}>
          {t('pricing.history.reason', { reason: row.reason })}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  list: { padding: space.base, paddingBottom: space['2xl'] },
  gap: { height: space.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  meta: { marginTop: space.xs },
});
