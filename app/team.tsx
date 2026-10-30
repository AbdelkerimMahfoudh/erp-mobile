import React, { useEffect, useState } from 'react';
import { RoleChangeSheet, nextRoleOf } from '../components/team/RoleChangeSheet';
import { Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Users } from 'lucide-react-native';
import { Button, Chip, EmptyState, ErrorState, ListRow, PageIntro, RowGroup, Screen, SearchInput, SkeletonList, StatusChip, Text, TextField, Toggle } from '../components/ui';
import { BilingualNameFields, bilingualNameErrors, nameErrorText } from '../components/names/BilingualNameFields';
import { displayName, matchesName } from '../lib/display-name';
import { BottomSheet } from '../components/overlay';
import { ApiError, api } from '../lib/api-client';
import { space } from '../lib/design/tokens';
import { toFriendlyError } from '../lib/errors';
import { useTranslation, type TranslationKey } from '../lib/i18n';
import { usePermission } from '../lib/permissions';
import { useAuth } from '../hooks/useAuth';
import { qk } from '../lib/query-keys';
import { toast } from '../lib/toast';
import { dialog } from '../lib/dialog';
import type { TeamUser } from '../types/api';
import { useBusinessAccess } from '../lib/entitlement';
import { CreateMemberSheet } from '../components/team/CreateMemberSheet';
import { PendingPanel } from '../components/team/PendingPanel';

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
  const { t, language } = useTranslation();
  const [search, setSearch] = useState('');
  const header = <Stack.Screen options={{ headerShown: true, title: t('team.title') }} />;
  const canManage = usePermission('user.manage');
  const access = useBusinessAccess();
  const [editing, setEditing] = useState<TeamUser | null>(null);
  const [creating, setCreating] = useState(false);

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
      // Retired roles an older shop may still hold: worded too, never shown as a key.
      case 'branch_manager':
        return t('team.role.branch_manager');
      case 'sales_employee':
        return t('team.role.sales_employee');
      case 'warehouse_employee':
        return t('team.role.warehouse_employee');
      default:
        return role.replace(/_/g, ' ');
    }
  };

  const branchSummary = (u: TeamUser): string =>
    u.branches.length === 0
      ? t('team.noBranches')
      : u.branches
          .map((b) => t('team.branchRole', { role: roleLabel(b.role), branch: displayName({ name: b.branchName, nameAr: b.branchNameAr }, language) }))
          .join(' · ');

  // Non-Owners get a real 403 shape, so the lock and wording match a server
  // refusal exactly. The route is already hidden from them in More.
  if (!canManage) {
    return (
      <Screen>
        {header}
        <ErrorState error={new ApiError(t('state.error.permission.body'), 403)} />
      </Screen>
    );
  }

  if (usersQuery.isLoading) {
    return (
      <Screen>
        {header}
        <SkeletonList count={5} />
      </Screen>
    );
  }

  if (usersQuery.isError) {
    return (
      <Screen>
        {header}
        <ErrorState error={usersQuery.error} onRetry={() => void usersQuery.refetch()} />
      </Screen>
    );
  }

  // D225: either name finds the person, whichever script it is typed in.
  const users = (usersQuery.data ?? []).filter((u) => matchesName(u, search));
  const total = usersQuery.data?.length ?? 0;

  return (
    <Screen gap="xl">
      {header}
      {/*
        Accounts are created here and activated by the server (docs/21,
        2026-10-05): the person proves each contact given, and a seat is held
        at each store. Hidden, like every write, while the business cannot write.
      */}
      <PageIntro
        description={t('team.subtitle')}
        action={access.canWrite ? <Button title={t('team.add')} icon={UserPlus} onPress={() => setCreating(true)} /> : undefined}
      />

      {total > 5 ? <SearchInput value={search} onChangeText={setSearch} placeholder={t('team.search')} /> : null}

      {total === 0 ? (
        <EmptyState icon={Users} title={t('team.empty')} body={t('team.emptyBody')} />
      ) : users.length === 0 ? (
        <EmptyState icon={Users} title={t('state.noResults.title')} />
      ) : (
        <RowGroup>
          {users.map((u) => (
            <ListRow
              flat
              key={u.id}
              title={displayName(u, language)}
              subtitle={branchSummary(u)}
              accessory={
                <View style={styles.rowChips}>
                  {u.nameIncomplete ? <Chip tone="warning" label={t('names.incomplete')} /> : null}
                  <StatusChip domain="user" value={u.status} />
                </View>
              }
              onPress={() => setEditing(u)}
            />
          ))}
        </RowGroup>
      )}

      <EditSheet user={editing} onClose={() => setEditing(null)} roleLabel={roleLabel} />
      <CreateMemberSheet open={creating} onClose={() => setCreating(false)} />
    </Screen>
  );
}

/** The controls of the edit sheet a refusal can stand beside. */
type EditRefusal = Partial<Record<'phone' | 'email' | 'active', TranslationKey>>;

/**
 * What a refused save says, and beside which control — decided by the
 * server's code and by what this save changed, never by its English:
 *  - 409 `SEAT_LIMIT_REACHED`: the person was being let back in and no seat
 *    is free for them right now, store by store — whether or not a seat
 *    bought during a free trial waits for its end. Beside "Can use the app",
 *    in neutral words: no price, no payment, nothing to buy;
 *  - 403 `password_confirmation_required`: a phone number or an email
 *    changed, which the server accepts only with the Owner's own password,
 *    and this sheet does not ask for it. Beside each contact that changed;
 *  - any other 409 while only the phone changed: another member already uses
 *    that number.
 * Anything else keeps the friendly error.
 */
function editRefusal(error: unknown, body: Record<string, unknown>): EditRefusal | null {
  if (!(error instanceof ApiError)) return null;
  if (error.status === 409 && error.code === 'SEAT_LIMIT_REACHED') return { active: 'team.error.noSeat' };
  const contacts = (['phone', 'email'] as const).filter((field) => field in body);
  if (error.status === 403 && error.code === 'password_confirmation_required' && contacts.length > 0) {
    return Object.fromEntries(contacts.map((field) => [field, 'team.error.contactPassword'])) as EditRefusal;
  }
  if (error.status === 409 && contacts.length === 1 && contacts[0] === 'phone') return { phone: 'team.error.phoneTaken' };
  return null;
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
  const { t, language } = useTranslation();
  const queryClient = useQueryClient();
  const { user: authUser } = useAuth();

  const [name, setName] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [changingRole, setChangingRole] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; nameAr?: string; phone?: string; email?: string; active?: string }>({});

  useEffect(() => {
    if (!user) return;
    setName(user.name);
    setNameAr(user.nameAr ?? '');
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
    onError: (error, body) => {
      const refused = editRefusal(error, body);
      if (refused) {
        setErrors({
          phone: refused.phone && t(refused.phone),
          email: refused.email && t(refused.email),
          active: refused.active && t(refused.active),
        });
        return;
      }
      toast.error(toFriendlyError(error).body);
    },
  });

  const onSubmit = () => {
    if (!user) return;

    const nextErrors: { name?: string; nameAr?: string; phone?: string; email?: string } = {};
    const trimmedName = name.trim();
    const trimmedNameAr = nameAr.trim();
    const trimmedEmail = email.trim();
    const normalizedPhone = phone.trim() === '' ? '' : cleanedPhone(phone);

    // D225: completing the Arabic name is optional here; a name given is held to its script's rule.
    const named = bilingualNameErrors({ name: trimmedName, nameAr: trimmedNameAr }, { arabicRequired: false });
    if (named.name) nextErrors.name = nameErrorText(named.name, t);
    if (named.nameAr) nextErrors.nameAr = nameErrorText(named.nameAr, t);
    if (normalizedPhone !== '' && !E164.test(normalizedPhone)) nextErrors.phone = t('team.error.phone');
    if (trimmedEmail !== '' && !EMAIL.test(trimmedEmail)) nextErrors.email = t('team.error.email');
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    // Send only what changed; '' clears phone/email on the server.
    const body: Record<string, unknown> = {};
    if (trimmedName !== user.name) body.name = trimmedName;
    // Each name on its own: the server never touches the one not sent.
    if (trimmedNameAr && trimmedNameAr !== (user.nameAr ?? '')) body.nameAr = trimmedNameAr;
    // With a name changed and the Arabic one known, both are sent so the server holds both to their rules.
    if (body.name !== undefined && trimmedNameAr) body.nameAr = trimmedNameAr;
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
      scroll
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
                  label={t('team.branchRole', { role: roleLabel(b.role), branch: displayName({ name: b.branchName, nameAr: b.branchNameAr }, language) })}
                />
              ))
            )}
            <StatusChip domain="user" value={user.status} />
          </View>

          <BilingualNameFields
            value={{ name, nameAr }}
            onChange={(next) => {
              setName(next.name);
              setNameAr(next.nameAr);
            }}
            errors={{ name: errors.name, nameAr: errors.nameAr }}
            arabicRequired={false}
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

          {/*
            A pending account is activated by the server alone, once the person
            has proven every contact and a seat is held — never by this toggle
            (the server refuses it too). Delegations wait until it is active.
          */}
          {user.status === 'pending' ? (
            <PendingPanel user={user} onCancelled={onClose} />
          ) : (
            <>
              {/* D225: Employee ↔ Manager, never for yourself and never for an Owner. */}
              {isSelf || user.branches.some((b) => b.role === 'owner') ? null : (
                <Button
                  title={t(nextRoleOf(user) === 'store_manager' ? 'team.role.promote' : 'team.role.demote')}
                  variant="secondary"
                  onPress={() => setChangingRole(true)}
                  fullWidth
                />
              )}
              {/* No toggle for yourself — you cannot lock yourself out. */}
              {isSelf ? null : (
                <View style={styles.block}>
                  <Toggle
                    label={t('team.field.active')}
                    hint={t('team.field.activeHint')}
                    onLabel={t('settings.toggle.on')}
                    offLabel={t('settings.toggle.off')}
                    value={isActive}
                    onValueChange={setIsActive}
                  />
                  {errors.active ? (
                    <Text variant="caption" tone="warning">
                      {errors.active}
                    </Text>
                  ) : null}
                </View>
              )}

              <PriceEditDelegation user={user} />
              <ClosingDelegation user={user} />
            </>
          )}

          <Text variant="caption" tone="tertiary">
            {t('team.detail.lastLogin')}: {lastLogin}
          </Text>
        </View>
      ) : null}
      <RoleChangeSheet
        user={changingRole ? user : null}
        onClose={() => {
          setChangingRole(false);
          onClose();
        }}
      />
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
  const { t, language } = useTranslation();
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
          branch: branch ? displayName({ name: branch.branchName, nameAr: branch.branchNameAr }, language) : '',
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
          label={t('team.delegation.allow', { branch: displayName({ name: b.branchName, nameAr: b.branchNameAr }, language) })}
          hint={t('team.delegation.allowHint')}
          onLabel={t('settings.toggle.on')}
          offLabel={t('settings.toggle.off')}
          value={b.grantedPermissions.includes(PRICE_EDIT)}
          disabled={mutate.isPending && pendingBranch === b.branchId}
          onValueChange={(next) => void onToggle(b.branchId, displayName({ name: b.branchName, nameAr: b.branchNameAr }, language), next)}
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

/** The second delegatable key. Mirrors the server's allow-list. */
const CLOSING = 'closing.perform';

/**
 * Per-branch closing delegation (0076).
 *
 * The Owner plus at most two people per branch may count, close, reopen and
 * close the business day again; a manager or an employee alike. Same shape as
 * price editing — one explicit switch per eligible branch — and the limit is
 * the server's: a third delegate is refused with a 409 that names it, and the
 * screen repeats the rule beside the switches rather than in a confirmation
 * people learn to dismiss. Starting the next day early stays the Owner's and
 * is not delegated here.
 */
function ClosingDelegation({ user }: { user: TeamUser }) {
  const { t, language } = useTranslation();
  const queryClient = useQueryClient();
  const [pendingBranch, setPendingBranch] = useState<string | null>(null);

  const eligible = user.delegatablePermissions?.includes(CLOSING) ? user.branches.filter((b) => b.canDelegateClosing) : [];

  const mutate = useMutation({
    mutationFn: ({ branchId, next }: { branchId: string; next: boolean }) => {
      const path = `/users/${user.id}/branches/${branchId}/delegations/closing`;
      return next ? api.put<TeamUser>(path, {}) : api.delete<TeamUser>(path);
    },
    onSuccess: (fresh, { branchId, next }) => {
      const branch = user.branches.find((b) => b.branchId === branchId);
      queryClient.setQueryData<TeamUser[]>(qk.users, (list) => (list ? list.map((u) => (u.id === fresh.id ? fresh : u)) : list));
      void queryClient.invalidateQueries({ queryKey: qk.users });
      void queryClient.invalidateQueries({ queryKey: ['permissions'] });
      toast.success(t(next ? 'team.closing.granted' : 'team.closing.revoked', { branch: branch ? displayName({ name: branch.branchName, nameAr: branch.branchNameAr }, language) : '' }));
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        // The seat limit, or an assignment that stopped being eligible. Both are the server's call.
        toast.error(/closing_delegates_limit/.test(String((error as { code?: string }).code ?? error.message)) ? t('team.closing.limit') : t('team.closing.conflict'));
        void queryClient.invalidateQueries({ queryKey: qk.users });
        return;
      }
      toast.error(toFriendlyError(error).body);
    },
    onSettled: () => setPendingBranch(null),
  });

  if (eligible.length === 0) return null;

  const onToggle = async (branchId: string, branchName: string, next: boolean) => {
    const ok = await dialog.confirm({
      title: t(next ? 'team.closing.confirmOnTitle' : 'team.closing.confirmOffTitle', { name: user.name }),
      message: t(next ? 'team.closing.confirmOnBody' : 'team.closing.confirmOffBody', { name: displayName(user, language), branch: branchName }),
      confirmLabel: t(next ? 'team.closing.confirmOn' : 'team.closing.confirmOff'),
      cancelLabel: t('action.cancel'),
      tone: next ? 'default' : 'danger',
    });
    if (!ok) return;
    setPendingBranch(branchId);
    mutate.mutate({ branchId, next });
  };

  return (
    <View style={styles.delegation}>
      <Text variant="label">{t('team.closing.section')}</Text>
      <Text variant="caption" tone="secondary">
        {t('team.closing.hint')}
      </Text>
      {eligible.map((b) => (
        <Toggle
          key={b.branchId}
          label={t('team.closing.allow', { branch: displayName({ name: b.branchName, nameAr: b.branchNameAr }, language) })}
          hint={t('team.closing.allowHint')}
          onLabel={t('settings.toggle.on')}
          offLabel={t('settings.toggle.off')}
          value={b.grantedPermissions.includes(CLOSING)}
          disabled={mutate.isPending && pendingBranch === b.branchId}
          onValueChange={(next) => void onToggle(b.branchId, displayName({ name: b.branchName, nameAr: b.branchNameAr }, language), next)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {},
  sheet: { gap: space.base },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  readValue: { marginTop: space.xs },
  block: { gap: space.xs },
  delegation: { gap: space.sm },
  rowChips: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
});
