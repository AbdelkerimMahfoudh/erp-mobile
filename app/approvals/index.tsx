import React from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { BadgePercent } from 'lucide-react-native';
import {
  EmptyState,
  ErrorState,
  InlineNotice,
  ListRow,
  ListSeparator,
  MoneyValue,
  Screen,
  SkeletonList,
  StatusChip,
} from '../../components/ui';
import { space } from '../../lib/design/tokens';
import { useConnectivity } from '../../lib/connectivity';
import { useDiscountApprovals } from '../../lib/discount-approvals';
import {
  discountPercent,
  minutesLeft,
  viewOf,
  type DiscountApproval,
} from '../../lib/discount-approval-state';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';

/**
 * Price approvals — the Owner's queue, or your own history.
 *
 * **The server decides which of those this is.** An approver receives every
 * request in the company; anybody else receives only their own, because
 * everyone who may sell may also ask, and a shop assistant has no business
 * reading what a colleague asked to discount. The screen renders what arrives
 * and says which it got; it does not filter, because a client filter is a
 * display preference and this is a boundary.
 */
export default function ApprovalsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const online = useConnectivity((s) => s.online);
  const mayApprove = usePermission('discount.override');

  const query = useDiscountApprovals();
  const rows = query.data?.rows ?? [];
  const scope = query.data?.scope ?? (mayApprove ? 'company' : 'mine');

  return (
    <Screen scroll={false}>
      <Stack.Screen options={{ headerShown: true, title: t('approvals.title') }} />

      {!online ? (
        /*
         * An approval is a decision, and `lib/offline/policy.ts` classifies
         * decisions as online-only. Showing a cached queue here would invite an
         * Owner to approve into a world they cannot see.
         */
        <View style={styles.notice}>
          <InlineNotice tone="warning">{t('approval.offline')}</InlineNotice>
        </View>
      ) : null}

      {query.isLoading ? (
        <SkeletonList count={4} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={BadgePercent}
          title={scope === 'company' ? t('approvals.empty') : t('approvals.emptyMine')}
          body={scope === 'company' ? t('approvals.emptyBody') : t('approvals.emptyMineBody')}
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={ListSeparator}
          refreshing={query.isRefetching}
          onRefresh={() => void query.refetch()}
          renderItem={({ item }) => (
            <Row row={item} onPress={() => router.push(`/approvals/${item.id}` as never)} />
          )}
        />
      )}
    </Screen>
  );
}

function Row({ row, onPress }: { row: DiscountApproval; onPress: () => void }) {
  const { t } = useTranslation();
  const now = new Date();
  const view = viewOf(row, now);
  const percent = discountPercent(row);

  const subtitle = [
    row.requesterName ? t('approvals.askedBy', { name: row.requesterName }) : null,
    percent === null ? null : t('approval.percentOff', { percent }),
    // A countdown only where one still means something. On a decided request it
    // would be a number ticking down beside an answer that is already given.
    view === 'pending' || view === 'approved'
      ? t('approval.expiresIn', { minutes: minutesLeft(row.expiresAt, now) })
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <ListRow
      flat
      leading={BadgePercent}
      title={row.product ? [row.product.name, row.product.variant].filter(Boolean).join(' · ') : t('approvals.item')}
      subtitle={subtitle}
      identifier={row.identifier ?? undefined}
      value={<MoneyValue value={row.approvedPrice ?? row.requestedPrice} size="small" />}
      accessory={<StatusChip domain="approval" value={view === 'lapsed' ? 'expired' : view} size="sm" />}
      onPress={onPress}
    />
  );
}

const styles = StyleSheet.create({
  notice: { paddingBottom: space.sm },
  list: { paddingBottom: space['3xl'] },
});
