import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { LogOut, Store, Warehouse } from 'lucide-react-native';
import {
  Button,
  EmptyState,
  ErrorState,
  ListRow,
  Screen,
  SkeletonList,
  Text,
} from '../components/ui';
import { api } from '../lib/api-client';
import { qk } from '../lib/query-keys';
import { useBranch } from '../lib/branch';
import { useAuth } from '../hooks/useAuth';
import { space } from '../lib/design/tokens';
import { useTranslation } from '../lib/i18n';
import type { UserBranch } from '../types/api';

/**
 * Which branch am I working in?
 *
 * The first screen after signing in, and — until the UX pilot — one of six that
 * were hardcoded English. An Arabic-speaking employee met this before they had
 * done anything at all, which is the worst possible place to lose them.
 *
 * Rebuilt on the design system: the branch type and the signed-in role are both
 * translated rather than being raw enum values with the underscores swapped for
 * spaces.
 */
export default function SelectBranch() {
  const { t } = useTranslation();
  const { setBranch } = useBranch();
  const { signOut, user } = useAuth();

  const query = useQuery({
    queryKey: qk.branches,
    queryFn: () => api.get<UserBranch[]>('/auth/branches'),
  });

  return (
    <Screen gap="lg">
      <View style={styles.head}>
        <View style={styles.headText}>
          <Text variant="title">{t('branch.select.title')}</Text>
          <Text variant="body" tone="secondary">
            {t('branch.select.signedInAs', { name: user?.name ?? '' })}
          </Text>
        </View>
        <Button
          title={t('action.signOut')}
          variant="tertiary"
          size="sm"
          icon={LogOut}
          onPress={signOut}
        />
      </View>

      {query.isLoading ? (
        <SkeletonList count={3} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : !query.data || query.data.length === 0 ? (
        /**
         * Assigned to nothing. Signing out is the only action that helps — the
         * fix is an owner assigning them a branch, which they cannot do here.
         */
        <EmptyState
          icon={Store}
          title={t('branch.select.none.title')}
          body={t('branch.select.none.body')}
        />
      ) : (
        <View style={styles.list}>
          {query.data.map((branch) => (
            <ListRow
              key={branch.id}
              leading={branch.type === 'warehouse' ? Warehouse : Store}
              title={branch.name}
              subtitle={[
                t(`branch.type.${branch.type}` as never),
                t(`team.role.${branch.role}` as never),
              ]
                .filter(Boolean)
                .join(' · ')}
              onPress={() => setBranch(branch)}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space.md,
  },
  headText: { flex: 1, gap: space.xs },
  list: { gap: space.sm },
});
