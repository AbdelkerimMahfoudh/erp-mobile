import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Users } from 'lucide-react-native';
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  ListRow,
  RowGroup,
  Screen,
  SkeletonList,
  StatusChip,
  Text,
  TextField,
  Toggle,
} from '../components/ui';
import { BottomSheet } from '../components/overlay';
import { ApiError, api } from '../lib/api-client';
import { space } from '../lib/design/tokens';
import { toFriendlyError } from '../lib/errors';
import { useTranslation } from '../lib/i18n';
import { usePermission } from '../lib/permissions';
import { useAuth } from '../hooks/useAuth';
import { qk } from '../lib/query-keys';
import { toast } from '../lib/toast';
import { dialog } from '../lib/dialog';
import type { TeamUser } from '../types/api';

/**
 * Team — the Owner's list of who can use the shop's app (F1 Stage 1).
 *
 * This screen shows the people, their branch and role, whether they can sign in,
 * and whether they are reachable (have a phone) for the WhatsApp codes that
 * arrive in a later stage. It edits only identity and contact: name, phone,
 * email and the active switch. There is deliberately NO invite button, no "send
 * code", no "reset passcode" and no role picker — those belong to stages that do
 * not exist yet, and a button that does nothing is worse than no button.
 *
 * The route is Owner-only, and the screen refuses non-Owners itself for the
 * deep-link case, but the server is the real authority: every /users call is
 * guarded by `user.manage`.
 */

/** E.164-ish, matched after stripping punctuation — mirrors the server. */
const E164 = /^\+[1-9]\d{7,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const cleanedPhone = (raw: string) => {
  const s = raw.trim().replace(/[\s\-().]/g, '');
  return s.startsWith('00') ? '+' + s.slice(2) : s;
};

export default function TeamScreen() {
  const { t } = useTranslation();
  const canManage = usePermission('user.manage');
  const [editing, setEditing] = useState<TeamUser | null>(null);

  const usersQuery = useQuery({
    queryKey: qk.users,
    queryFn: () => api.get<TeamUser[]>('/users'),
    enabled: canManage,
  });

  const roleLabel = (role: string): string => {
    switch (role) {
      case 'owner':
        return t('team.role.owner');
      case 'store_manager':
        return t('team.role.store_manager');
      case 'store_employee':
        return t('team.role.store_employee');
      case 'administrator':
        return t('team.role.administrator');
      default:
        return role.replace(/_/g, ' ');
    }
  };

  const branchSummary = (u: TeamUser): string =>
    u.branches.length === 0
      ? t('team.noBranches')
      : u.branches
          .map((b) => t('team.branchRole', { role: roleLabel(b.role), branch: b.branchName }))
          .join(' · ');

  // Non-Owners get a real 403 shape, so the lock and wording match a server
  // refusal exactly. The route is already hidden from them in More.
  if (!canManage) {
    return (
      <Screen>
        <ErrorState error={new ApiError(t('state.error.permission.body'), 403)} />
      </Screen>
    );
  }

  if (usersQuery.isLoading) {
    return (
      <Screen>
        <Text variant="title">{t('team.title')}</Text>
        <SkeletonList count={5} />
      </Screen>
    );
  }

  if (usersQuery.isError) {
    return (
      <Screen>
        <ErrorState error={usersQuery.error} onRetry={() => void usersQuery.refetch()} />
      </Screen>
    );
  }

  const users = usersQuery.data ?? [];

  return (
    <Screen gap="xl">
      <View>
        <Text variant="title">{t('team.title')}</Text>
        <Text variant="caption" tone="secondary" style={styles.subtitle}>
          {t('team.subtitle')}
        </Text>
      </View>

      {users.length === 0 ? (
        <EmptyState icon={Users} title={t('team.empty')} body={t('team.emptyBody')} />
      ) : (
        <RowGroup>
          {users.map((u) => (
            <ListRow
              flat
              key={u.id}
              title={u.name}
              subtitle={branchSummary(u)}
              accessory={<StatusChip domain="user" value={u.status} />}
              onPress={() => setEditing(u)}
            />
          ))}
        </RowGroup>
      )}

      <EditSheet user={editing} onClose={() => setEditing(null)} roleLabel={roleLabel} />
    </Screen>
  );
}

/**
 * Edit one team member. Saves on its own rather than through a page-level draft:
 * it is one row, and its own Save keeps a duplicate-phone rejection scoped to
 * this person instead of looking like the whole screen failed.
 */
function EditSheet({
  user,
  onClose,
  roleLabel,
}: {
  user: TeamUser | null;
  onClose: () => void;
  roleLabel: (role: string) => string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user: authUser } = useAuth();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [errors, setErrors] = useState<{ name?: string; phone?: string; email?: string }>({});

  useEffect(() => {
    if (!user) return;
    setName(user.name);
    setPhone(user.phone ?? '');
    setEmail(user.email ?? '');
    setIsActive(user.isActive);
    setErrors({});
  }, [user]);

  // You cannot switch off your own access — so we do not even offer the toggle.
  const isSelf = !!user && !!authUser && user.id === authUser.id;

  const save = useMutation({
    mutationFn: async (body: Record<string, unknown>) => api.patch<TeamUser>(`/users/${user!.id}`, body),
    onSuccess: (fresh) => {
      queryClient.setQueryData<TeamUser[]>(qk.users, (list) =>
        list ? list.map((u) => (u.id === fresh.id ? fresh : u)) : list,
      );
      toast.success(t('team.saved'));
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        setErrors({ phone: t('team.error.phoneTaken') });
        return;
      }
      toast.error(toFriendlyError(error).body);
    },
  });

  const onSubmit = () => {
    if (!user) return;

    const nextErrors: { name?: string; phone?: string; email?: string } = {};
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const normalizedPhone = phone.trim() === '' ? '' : cleanedPhone(phone);

    if (trimmedName.length === 0) nextErrors.name = t('team.error.noChanges');
    if (normalizedPhone !== '' && !E164.test(normalizedPhone)) nextErrors.phone = t('team.error.phone');
    if (trimmedEmail !== '' && !EMAIL.test(trimmedEmail)) nextErrors.email = t('team.error.email');
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    // Send only what changed; '' clears phone/email on the server.
    const body: Record<string, unknown> = {};
    if (trimmedName !== user.name) body.name = trimmedName;
    if (normalizedPhone !== (user.phone ?? '')) body.phone = normalizedPhone;
    if (trimmedEmail !== (user.email ?? '')) body.email = trimmedEmail;
    if (!isSelf && isActive !== user.isActive) body.isActive = isActive;

    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    save.mutate(body);
  };

  const lastLogin = user?.lastLoginAt
    ? new Date(user.lastLoginAt).toLocaleDateString()
    : t('team.detail.never');

  return (
    <BottomSheet
      open={user !== null}
      onClose={onClose}
      title={t('team.editTitle')}
      footer={<Button title={t('action.save')} onPress={onSubmit} loading={save.isPending} fullWidth />}
    >
      {user ? (
        <View style={styles.sheet}>
          {/* Identity the Owner cannot change here: username, branches, status. */}
          <View>
            <Text variant="label">{t('team.field.login')}</Text>
            <Text variant="body" tone="secondary" style={styles.readValue}>
              {user.login}
            </Text>
          </View>

          <View style={styles.chips}>
            {user.branches.length === 0 ? (
              <Chip tone="neutral" label={t('team.noBranches')} />
            ) : (
              user.branches.map((b) => (
                <Chip
                  key={b.branchId}
                  tone="neutral"
                  label={t('team.branchRole', { role: roleLabel(b.role), branch: b.branchName })}
                />
              ))
            )}
            <StatusChip domain="user" value={user.status} />
          </View>

          <TextField
            label={t('team.field.name')}
            value={name}
            error={errors.name}
            onChangeText={setName}
            maxLength={160}
          />

          <TextField
            label={t('team.field.phone')}
            hint={t('team.field.phoneHint')}
            value={phone}
            error={errors.phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            variant="identifier"
            maxLength={24}
          />

          <TextField
            label={t('team.field.email')}
            hint={t('team.field.emailHint')}
            value={email}
            error={errors.email}
            onChangeText={setEmail}
            keyboardType="email-address"
            maxLength={160}
          />

          {/* No toggle for yourself — you cannot lock yourself out. */}
          {isSelf ? null : (
            <Toggle
              label={t('team.field.active')}
              hint={t('team.field.activeHint')}
              onLabel={t('settings.toggle.on')}
              offLabel={t('settings.toggle.off')}
              value={isActive}
              onValueChange={setIsActive}
            />
          )}

          <PriceEditDelegation user={user} />

          <Text variant="caption" tone="tertiary">
            {t('team.detail.lastLogin')}: {lastLogin}
          </Text>
        </View>
      ) : null}
    </BottomSheet>
  );
}

/** The one delegatable permission. Mirrors the server's allow-list. */
const PRICE_EDIT = 'price.edit';

/**
 * Per-branch price-edit delegation.
 *
 * Deliberately NOT a permission picker: one explicit control per branch the
 * person actually manages, because "which authority" is a decision the product
 * makes, not the Owner. Employees have no eligible assignment, so the whole
 * section disappears for them rather than showing a disabled control that
 * invites the question "why not?".
 *
 * Each branch is its own switch and its own request. Authority is per branch on
 * the server, so showing one combined toggle would be a lie about what is being
 * granted.
 */
function PriceEditDelegation({ user }: { user: TeamUser }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [pendingBranch, setPendingBranch] = useState<string | null>(null);

  // The server decides what is delegatable AND which assignments may receive
  // it. If it ever stops offering price.edit, this section vanishes on its own.
  const eligible = user.delegatablePermissions?.includes(PRICE_EDIT)
    ? user.branches.filter((b) => b.canDelegate)
    : [];

  const mutate = useMutation({
    mutationFn: ({ branchId, next }: { branchId: string; next: boolean }) => {
      const path = `/users/${user.id}/branches/${branchId}/delegations/price-edit`;
      return next ? api.put<TeamUser>(path, {}) : api.delete<TeamUser>(path);
    },
    onSuccess: (fresh, { branchId, next }) => {
      const branch = user.branches.find((b) => b.branchId === branchId);
      // Replace the row we have and refetch, so the list, this sheet and any
      // permission-dependent screen all agree.
      queryClient.setQueryData<TeamUser[]>(qk.users, (list) =>
        list ? list.map((u) => (u.id === fresh.id ? fresh : u)) : list,
      );
      void queryClient.invalidateQueries({ queryKey: qk.users });
      // Prefix, not `qk.permissions(branchId)`: the cache holds one entry per
      // branch, and the grant changes what the TARGET user may do in one of
      // them. Matching the prefix drops every branch's copy so the next read is
      // the server's answer, whichever branch is active.
      void queryClient.invalidateQueries({ queryKey: ['permissions'] });
      toast.success(
        t(next ? 'team.delegation.granted' : 'team.delegation.revoked', {
          branch: branch?.branchName ?? '',
        }),
      );
    },
    onError: (error) => {
      // 409 means the assignment stopped being eligible while the sheet was
      // open — a role change, or a deactivation. Retrying would not help.
      if (error instanceof ApiError && error.status === 409) {
        toast.error(t('team.delegation.conflict'));
        void queryClient.invalidateQueries({ queryKey: qk.users });
        return;
      }
      // 403, offline and everything else keep the server's own wording.
      toast.error(toFriendlyError(error).body);
    },
    onSettled: () => setPendingBranch(null),
  });

  if (eligible.length === 0) return null;

  const onToggle = async (branchId: string, branchName: string, next: boolean) => {
    const ok = await dialog.confirm({
      title: t(next ? 'team.delegation.confirmOnTitle' : 'team.delegation.confirmOffTitle'),
      message: t(next ? 'team.delegation.confirmOnBody' : 'team.delegation.confirmOffBody', {
        name: user.name,
        branch: branchName,
      }),
      confirmLabel: t(next ? 'team.delegation.confirmOn' : 'team.delegation.confirmOff'),
      cancelLabel: t('action.cancel'),
      tone: next ? 'default' : 'danger',
    });
    if (!ok) return;
    setPendingBranch(branchId);
    mutate.mutate({ branchId, next });
  };

  return (
    <View style={styles.delegation}>
      <Text variant="label">{t('team.delegation.section')}</Text>
      <Text variant="caption" tone="secondary">
        {t('team.delegation.hint')}
      </Text>

      {eligible.map((b) => (
        <Toggle
          key={b.branchId}
          label={t('team.delegation.allow', { branch: b.branchName })}
          hint={t('team.delegation.allowHint')}
          onLabel={t('settings.toggle.on')}
          offLabel={t('settings.toggle.off')}
          value={b.grantedPermissions.includes(PRICE_EDIT)}
          disabled={mutate.isPending && pendingBranch === b.branchId}
          onValueChange={(next) => void onToggle(b.branchId, b.branchName, next)}
        />
      ))}

      {/* The limit is stated every time, not buried in a confirmation people
          learn to dismiss. */}
      <Text variant="caption" tone="warning">
        {t('team.delegation.belowCost')}
      </Text>
      <Text variant="caption" tone="tertiary">
        {t('team.delegation.notYet')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  subtitle: { marginTop: space.xs },
  list: {},
  sheet: { gap: space.base },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  readValue: { marginTop: space.xs },
  delegation: { gap: space.sm },
});
