import React, { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { HandCoins, Plus } from 'lucide-react-native';
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  ListRow,
  MoneyValue,
  Screen,
  SegmentedControl,
  SkeletonList,
} from '../../components/ui';
import { space } from '../../lib/design/tokens';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import { groupTone, useLoans, type LoanGroup, type LoanSummary } from '../../lib/loans';

/**
 * Money owed and money lent (Milestone I).
 *
 * Three tabs, grouped by the server. Confirmed means the money actually moved —
 * never merely that both sides agreed on a number — and that rule lives in one
 * place so the tabs cannot drift away from what the server believes.
 */
export default function LoansScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const canRecord = usePermission('loan.manage');
  const [group, setGroup] = useState<LoanGroup>('pending');

  const query = useLoans(group);
  const rows = query.data?.rows ?? [];

  return (
    <Screen scroll={false}>
      <Stack.Screen options={{ headerShown: true, title: t('loans.title') }} />

      <View style={styles.controls}>
        <SegmentedControl
          options={[
            { value: 'pending', label: t('loans.tab.pending') },
            { value: 'accepted', label: t('loans.tab.accepted') },
            { value: 'confirmed', label: t('loans.tab.confirmed') },
          ]}
          value={group}
          onChange={(v) => setGroup(v as LoanGroup)}
        />
      </View>

      {query.isLoading ? (
        <SkeletonList count={4} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={HandCoins}
          title={t(`loans.empty.${group}.title`)}
          body={t(`loans.empty.${group}.body`)}
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(l) => l.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Row row={item} onPress={() => router.push(`/loans/${item.id}` as never)} />
          )}
        />
      )}

      {canRecord ? (
        <View style={styles.actions}>
          <Button
            title={t('loans.new')}
            icon={Plus}
            fullWidth
            onPress={() => router.push('/loans/new' as never)}
          />
        </View>
      ) : null}
    </Screen>
  );
}

function Row({ row, onPress }: { row: LoanSummary; onPress: () => void }) {
  const { t } = useTranslation();
  /*
    Once accepted, what is left. Before that, whatever number is on the table —
    a counter-offer if there is one, otherwise the original proposal.
  */
  const amount =
    row.principal == null ? (row.counterAmount ?? row.proposedAmount) : row.remaining;

  return (
    <ListRow
      leading={HandCoins}
      title={row.otherParty}
      subtitle={[
        /* In words, both ways round. Never a minus sign. */
        t(`loans.direction.${row.direction}`),
        row.statusText,
      ].join(' · ')}
      value={<MoneyValue value={amount} size="small" />}
      accessory={<Chip tone={groupTone(row.group)} label={t(`loans.tab.${row.group}`)} size="sm" dot />}
      onPress={onPress}
    />
  );
}

const styles = StyleSheet.create({
  controls: { paddingBottom: space.sm },
  list: { gap: space.sm, paddingBottom: space['3xl'] },
  actions: { paddingTop: space.sm },
});
