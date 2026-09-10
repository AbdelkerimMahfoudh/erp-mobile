import React from 'react';
import { FlatList, StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Scale } from 'lucide-react-native';
import {
  Chip,
  EmptyState,
  ErrorState,
  ListRow,
  ListSeparator,
  MoneyValue,
  Screen,
  SkeletonList,
} from '../../components/ui';
import { space } from '../../lib/design/tokens';
import { useTranslation } from '../../lib/i18n';
import { useDiscrepancies, type Discrepancy } from '../../lib/closing';

/**
 * Days where the money did not match, still waiting on a decision (E-CP2).
 *
 * Before Milestone E a difference was a number on a locked row and nothing
 * else — no investigation, no decision, no record of who was held responsible.
 * This is the list that stops one being quietly forgotten.
 */
export default function DiscrepanciesScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const query = useDiscrepancies();
  const rows = query.data?.rows ?? [];

  return (
    <Screen scroll={false}>
      <Stack.Screen options={{ headerShown: true, title: t('discrepancy.title') }} />

      {query.isLoading ? (
        <SkeletonList count={4} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Scale} title={t('discrepancy.empty.title')} body={t('discrepancy.empty.body')} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={ListSeparator}
          renderItem={({ item }) => (
            <Row row={item} onPress={() => router.push(`/discrepancies/${item.id}` as never)} />
          )}
        />
      )}
    </Screen>
  );
}

function Row({ row, onPress }: { row: Discrepancy; onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <ListRow
      flat
      leading={Scale}
      title={row.channel ? row.channel.label : t('closing.channel.cash')}
      subtitle={`${row.date} · ${t(`discrepancy.kind.${row.kind}`)}`}
      // Signed, so the direction reads at a glance — a shortage and a surplus
      // are different problems, not one problem with a different number.
      value={<MoneyValue value={row.amount} tone="auto" signed size="small" />}
      accessory={<Chip tone="warning" label={t('discrepancy.status.pending')} size="sm" dot />}
      onPress={onPress}
    />
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: space['3xl'] },
});
