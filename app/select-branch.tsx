import React from 'react';
import { displayName } from '../lib/display-name';
import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { CircleUserRound, Clock, LogOut, Plus, Store, Warehouse } from 'lucide-react-native';
import { LegalPageButtons } from '../components/legal/LegalPages';
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  ListRow,
  Screen,
  SkeletonList,
  Text,
} from '../components/ui';
import { BRANCH_REQUESTS_KEY, checklistDoneKey, isWaiting, offersChecklist, stateLabelKey, type BranchRequest } from '../lib/branch-requests';
import { getItem } from '../lib/storage';
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
/** The Home tab: the tabs' first screen. */
const HOME = '/(tabs)' as const;

export default function SelectBranch() {
  const { t, language } = useTranslation();
  const { setBranch, branchId } = useBranch();
  const { signOut, user } = useAuth();
  const router = useRouter();

  const query = useQuery({
    queryKey: qk.branches,
    queryFn: () => api.get<UserBranch[]>('/auth/branches'),
  });
  // 0130: the Owner adds stores here, and sees the ones waiting for activation. Owner of any store in the business.
  const isOwner = !!query.data?.some((b) => b.role === 'owner');
  const requests = useQuery({
    queryKey: BRANCH_REQUESTS_KEY,
    queryFn: () => api.get<BranchRequest[]>('/branches/requests'),
    enabled: isOwner,
  });
  const waiting = (requests.data ?? []).filter(isWaiting);

  const choose = async (branch: UserBranch) => {
    // Chosen on purpose: the store becomes active and the Home tab opens. `dismissTo` closes this list and
    // shows the existing tabs on Home — nothing is pushed, so there is no second Home and no way "back" to
    // More from it (Build 6). On a first choice, with no tabs yet, it replaces this list with them.
    setBranch(branch);
    // A store just activated from a request, opened for the first time: its setup checklist, once (0130).
    const done = (await getItem(checklistDoneKey(branch.id)).catch(() => null)) === '1';
    router.dismissTo(HOME);
    if (offersChecklist(branch.id, requests.data, done)) router.push('/branch-setup');
  };

  return (
    <Screen gap="lg">
      <View style={styles.head}>
        <View style={styles.headText}>
          <Text variant="title">{t('branch.select.title')}</Text>
          <Text variant="body" tone="secondary">
            {t('branch.select.signedInAs', { name: user ? displayName(user, language) : '' })}
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

      {/* Opened to switch: the current store is still chosen, so leaving is one tap, back where it came from, and changes nothing. */}
      {branchId ? <Button title={t('action.cancel')} variant="secondary" onPress={() => (router.canDismiss() ? router.dismiss() : router.dismissTo(HOME))} /> : null}

      {query.isLoading ? (
        <SkeletonList count={3} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : !query.data || query.data.length === 0 ? (
        /**
         * Assigned to nothing. The fix is an owner assigning them a branch,
         * which they cannot do here; signing out is one way on, and their own
         * account is the other — verifying a number and deleting the account
         * are rights no branch is needed for (docs/64, App Review 5.1.1(v)).
         */
        <View style={styles.list}>
          <EmptyState
            icon={Store}
            title={t('branch.select.none.title')}
            body={t('branch.select.none.body')}
          />
          <Button
            title={t('nav.account')}
            variant="secondary"
            icon={CircleUserRound}
            onPress={() => router.push('/account' as never)}
          />
          <LegalPageButtons />
        </View>
      ) : (
        <View style={styles.list}>
          {query.data.map((branch) => (
            <ListRow
              key={branch.id}
              leading={branch.type === 'warehouse' ? Warehouse : Store}
              title={displayName(branch, language)}
              subtitle={[
                branch.id === branchId ? t('branch.select.current') : null,
                t(`branch.type.${branch.type}` as never),
                t(`team.role.${branch.role}` as never),
              ]
                .filter(Boolean)
                .join(' · ')}
              onPress={() => void choose(branch)}
            />
          ))}
          {/* Waiting for activation: shown, never chosen — the row opens its read-only status page. */}
          {waiting.map((r) => (
            <ListRow
              key={r.id}
              leading={Clock}
              title={r.name}
              subtitle={[r.address, t(stateLabelKey(r.state))].filter(Boolean).join(' · ')}
              accessory={<Chip label={t('branchRequest.badge')} tone="warning" size="sm" dot={false} />}
              onPress={() => router.push({ pathname: '/branch-request/[id]', params: { id: r.id } })}
            />
          ))}
          {isOwner ? <Button title={t('branchRequest.add')} variant="secondary" icon={Plus} onPress={() => router.push('/branch-new')} /> : null}
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
