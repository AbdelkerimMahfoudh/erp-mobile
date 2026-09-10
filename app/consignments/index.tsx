import React, { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Handshake, Plus } from 'lucide-react-native';
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  ListRow,
  ListSeparator,
  MoneyValue,
  Screen,
  SegmentedControl,
  SkeletonList,
} from '../../components/ui';
import { space } from '../../lib/design/tokens';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import {
  groupTone,
  useConsignments,
  type ConsignmentGroup,
  type ConsignmentSummary,
} from '../../lib/consignment';

/**
 * Stock sent to, or held for, another shop (Milestone H).
 *
 * Three tabs, and the grouping comes from the server rather than being derived
 * here. That is deliberate: the grouping encodes a product decision — Confirmed
 * means the money arrived or the phone came back, never merely that somebody
 * agreed — and a second copy of that rule in the client would eventually
 * disagree with the first.
 */
export default function ConsignmentsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const canRequest = usePermission('consignment.request');
  const [group, setGroup] = useState<ConsignmentGroup>('pending');

  const query = useConsignments(group);
  const rows = query.data?.rows ?? [];

  return (
    <Screen scroll={false}>
      <Stack.Screen options={{ headerShown: true, title: t('consignment.title') }} />

      <View style={styles.controls}>
        <SegmentedControl
          options={[
            { value: 'pending', label: t('consignment.tab.pending') },
            { value: 'accepted', label: t('consignment.tab.accepted') },
            { value: 'confirmed', label: t('consignment.tab.confirmed') },
          ]}
          value={group}
          onChange={(v) => setGroup(v as ConsignmentGroup)}
        />
      </View>

      {query.isLoading ? (
        <SkeletonList count={4} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Handshake}
          title={t(`consignment.empty.${group}.title`)}
          body={t(`consignment.empty.${group}.body`)}
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={ListSeparator}
          renderItem={({ item }) => (
            <Row row={item} onPress={() => router.push(`/consignments/${item.id}` as never)} />
          )}
        />
      )}

      {canRequest ? (
        <View style={styles.actions}>
          <Button
            title={t('consignment.new')}
            icon={Plus}
            fullWidth
            onPress={() => router.push('/consignments/new' as never)}
          />
        </View>
      ) : null}
    </Screen>
  );
}

function Row({ row, onPress }: { row: ConsignmentSummary; onPress: () => void }) {
  const { t } = useTranslation();
  // The amount that currently matters: agreed if there is one, otherwise
  // whatever is still on the table.
  const amount = row.agreedAmount ?? row.counterAmount ?? row.proposedAmount ?? 0;

  return (
    <ListRow
      flat
      leading={Handshake}
      /* Always the other party, whichever side we are on. */
      title={row.otherParty}
      subtitle={[
        t(row.side === 'source' ? 'consignment.side.sent' : 'consignment.side.holding'),
        t('consignment.phones', { count: String(row.phones) }),
        row.statusText,
      ].join(' · ')}
      value={<MoneyValue value={amount} size="small" />}
      accessory={<Chip tone={groupTone(row.group)} label={t(`consignment.tab.${row.group}`)} size="sm" dot />}
      onPress={onPress}
    />
  );
}

const styles = StyleSheet.create({
  controls: { paddingBottom: space.sm },
  list: { paddingBottom: space['3xl'] },
  actions: { paddingTop: space.sm },
});
