import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, InlineNotice, Text, Toggle } from '../ui';
import { BottomSheet } from '../overlay';
import { ApiError, api } from '../../lib/api-client';
import { space } from '../../lib/design/tokens';
import { dialog } from '../../lib/dialog';
import { displayName } from '../../lib/display-name';
import { toFriendlyError } from '../../lib/errors';
import { useTranslation } from '../../lib/i18n';
import { qk } from '../../lib/query-keys';
import { toast } from '../../lib/toast';
import type { TeamUser, UserBranch } from '../../types/api';

export type ChangeableRole = 'store_manager' | 'store_employee';

/** What the person becomes: a Manager when they manage no store yet, an Employee when they manage one. */
export function nextRoleOf(user: Pick<TeamUser, 'branches'>): ChangeableRole {
  return user.branches.some((b) => b.role === 'store_manager') ? 'store_employee' : 'store_manager';
}

/** The stores preselected: where they work now, for a promotion; where they manage now, for a demotion. */
export function preselectedStores(user: Pick<TeamUser, 'branches'>, role: ChangeableRole): string[] {
  return role === 'store_manager'
    ? user.branches.filter((b) => b.role === 'store_employee').map((b) => b.branchId)
    : user.branches.filter((b) => b.role === 'store_manager').map((b) => b.branchId);
}

/**
 * Employee ↔ Manager (D225): the Owner chooses the stores — which ones the new Manager manages, or which ones the
 * former Manager keeps working in — sees what changes, and confirms. The server puts it in force on the person's
 * next request and tells them.
 */
export function RoleChangeSheet({ user, onClose }: { user: TeamUser | null; onClose: () => void }) {
  const { t, language } = useTranslation();
  const queryClient = useQueryClient();
  const role = user ? nextRoleOf(user) : 'store_manager';
  const [stores, setStores] = useState<string[]>([]);
  const [error, setError] = useState<string | undefined>();
  const branches = useQuery({ queryKey: qk.branches, queryFn: () => api.get<UserBranch[]>('/auth/branches'), enabled: user !== null });

  useEffect(() => {
    if (!user) return;
    setStores(preselectedStores(user, nextRoleOf(user)));
    setError(undefined);
  }, [user]);

  const change = useMutation({
    mutationFn: () => api.put(`/users/${user!.id}/role`, { role, branchIds: stores }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.users });
      toast.success(t(role === 'store_manager' ? 'team.role.promoted' : 'team.role.demoted', { name: user ? displayName(user, language) : '' }));
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'SEAT_LIMIT_REACHED') return setError(t('team.error.noSeat'));
      setError(toFriendlyError(e).body);
    },
  });

  const submit = async () => {
    if (!user) return;
    if (stores.length === 0) return setError(t('team.create.error.stores'));
    const ok = await dialog.confirm({
      title: t(role === 'store_manager' ? 'team.role.promoteTitle' : 'team.role.demoteTitle', { name: displayName(user, language) }),
      message: t(role === 'store_manager' ? 'team.role.promoteBody' : 'team.role.demoteBody'),
      confirmLabel: t(role === 'store_manager' ? 'team.role.promote' : 'team.role.demote'),
    });
    if (ok) change.mutate();
  };

  return (
    <BottomSheet
      scroll
      open={user !== null}
      onClose={onClose}
      title={t(role === 'store_manager' ? 'team.role.promote' : 'team.role.demote')}
      footer={<Button title={t('action.next')} onPress={() => void submit()} loading={change.isPending} fullWidth />}
    >
      <View style={styles.sheet}>
        <Text variant="body" tone="secondary">
          {t(role === 'store_manager' ? 'team.role.storesPromote' : 'team.role.storesDemote')}
        </Text>
        {(branches.data ?? []).map((b) => (
          <Toggle
            key={b.id}
            flat
            label={displayName(b, language)}
            value={stores.includes(b.id)}
            onValueChange={(on) => setStores((s) => (on ? [...new Set([...s, b.id])] : s.filter((x) => x !== b.id)))}
            onLabel={t(role === 'store_manager' ? 'team.role.store.manages' : 'team.role.store.works')}
            offLabel={t('team.create.store.off')}
          />
        ))}
        {error ? <InlineNotice tone="warning">{error}</InlineNotice> : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({ sheet: { gap: space.base } });
