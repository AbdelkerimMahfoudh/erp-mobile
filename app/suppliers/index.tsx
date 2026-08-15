import React, { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Plus, Truck } from 'lucide-react-native';
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  ListRow,
  Screen,
  SearchInput,
  SegmentedControl,
  SkeletonList,
  Text,
} from '../../components/ui';
import { space } from '../../lib/design/tokens';
import { formatMoney } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import { useSuppliers } from '../../lib/suppliers';
import type { SupplierRow } from '../../types/api';

/**
 * Who the shop buys from, and what it still owes them.
 *
 * The money is not always here: the outstanding figure is **absent** rather
 * than zero for anyone without permission to see it, so an Employee can find a
 * supplier to receive against without being shown the company's debts.
 */
export default function SuppliersScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const canManage = usePermission('supplier.manage');

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive' | 'all'>('active');
  const query = useSuppliers({ search, status });

  const rows = query.data?.pages.flatMap((p) => p.rows) ?? [];

  return (
    <Screen scroll={false}>
      <Stack.Screen options={{ headerShown: true, title: t('suppliers.title') }} />

      <View style={styles.controls}>
        <SearchInput
          value={search}
          onChangeText={setSearch}
          placeholder={t('suppliers.search')}
        />
        <SegmentedControl
          options={[
            { value: 'active', label: t('suppliers.filter.active') },
            { value: 'inactive', label: t('suppliers.filter.inactive') },
            { value: 'all', label: t('suppliers.filter.all') },
          ]}
          value={status}
          onChange={(v) => setStatus(v as typeof status)}
        />
      </View>

      {query.isLoading ? (
        <SkeletonList count={4} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Truck}
          title={search ? t('suppliers.empty.search') : t('suppliers.empty')}
          body={search ? t('suppliers.empty.searchBody') : t('suppliers.emptyBody')}
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.list}
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
          }}
          renderItem={({ item }) => (
            <SupplierCard row={item} onPress={() => router.push(`/suppliers/${item.id}` as never)} />
          )}
          ListFooterComponent={
            query.isFetchingNextPage ? (
              <Text variant="caption" tone="tertiary" style={styles.footer}>
                {t('inventory.loadingMore')}
              </Text>
            ) : null
          }
        />
      )}

      {canManage ? (
        <View style={styles.actions}>
          <Button
            title={t('suppliers.add')}
            icon={Plus}
            onPress={() => router.push('/suppliers/new' as never)}
          />
        </View>
      ) : null}
    </Screen>
  );
}

function SupplierCard({ row, onPress }: { row: SupplierRow; onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <ListRow
      title={row.name}
      subtitle={row.phone ?? undefined}
      leading={Truck}
      // Absent means the caller may not see it, never zero.
      value={row.outstanding !== undefined ? formatMoney(row.outstanding) : undefined}
      // ListRow has no warning tone; danger is the one that reads as "owed".
      valueTone={row.outstanding !== undefined && row.outstanding > 0 ? 'danger' : 'primary'}
      // Status in a word as well as a tone.
      accessory={!row.isActive ? <Chip tone="neutral" label={t('suppliers.inactive')} dot /> : undefined}
      onPress={onPress}
    />
  );
}

const styles = StyleSheet.create({
  controls: { gap: space.sm, paddingBottom: space.sm },
  list: { gap: space.sm, paddingBottom: space['3xl'] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  body: { flex: 1, gap: space.xs },
  right: { alignItems: 'flex-end', gap: space.xs },
  actions: { paddingTop: space.sm },
  footer: { textAlign: 'center', paddingVertical: space.md },
});
