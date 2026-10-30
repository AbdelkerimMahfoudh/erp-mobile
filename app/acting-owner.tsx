import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, UserRound } from 'lucide-react-native';
import { Button, Chip, EmptyState, ErrorState, InlineNotice, ListRow, PageIntro, RowGroup, Screen, SegmentedControl, SkeletonList, Text, TextField } from '../components/ui';
import { BottomSheet, SelectSheet } from '../components/overlay';
import { ApiError, api } from '../lib/api-client';
import { useBranch } from '../lib/branch';
import { space } from '../lib/design/tokens';
import { displayName } from '../lib/display-name';
import { toFriendlyError } from '../lib/errors';
import { formatDateTime } from '../lib/format';
import { useTranslation } from '../lib/i18n';
import { qk } from '../lib/query-keys';
import { toast } from '../lib/toast';
import { endChoicesFor, endOf, startOf, START_CHOICES, type EndChoice, type StartChoice } from '../lib/acting-owner';
import { useAuth } from '../hooks/useAuth';
import type { ActingOwnerDelegation, ActingOwnerList, TeamUser } from '../types/api';

const KEY = ['acting-owner'] as const;

/** What the person may do and what stays with the Owner, in words — the server's matrix (`acting-owner-rules.ts`). */
const MAY = ['approvals', 'money', 'stock', 'closing', 'staff', 'settings', 'reports'] as const;
const KEPT = ['owner', 'appoint', 'delete', 'security', 'subscription', 'audit'] as const;

/**
 * More → Acting Owner (D225). The Owner appoints one person to run the business while they are away: from now or
 * tomorrow morning, until a chosen day or until removed. The server holds the authority and ends it on time, so it
 * does not depend on either phone being online. Appointing and removing ask for the Owner's password, after a summary
 * of who, from when, until when and what they may do.
 */
export default function ActingOwnerScreen() {
  const { t, language } = useTranslation();
  const role = useBranch((s) => s.role);
  const isOwner = role === 'owner';
  const [appointing, setAppointing] = useState(false);
  const [removing, setRemoving] = useState<ActingOwnerDelegation | null>(null);
  const header = <Stack.Screen options={{ headerShown: true, title: t('actingOwner.title') }} />;

  const query = useQuery({ queryKey: KEY, queryFn: () => api.get<ActingOwnerList>('/acting-owner') });

  if (query.isLoading) {
    return (
      <Screen>
        {header}
        <SkeletonList count={2} />
      </Screen>
    );
  }
  if (query.isError || !query.data) {
    return (
      <Screen>
        {header}
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </Screen>
    );
  }

  const live = query.data.delegations.filter((d) => d.state === 'active' || d.state === 'scheduled');
  const past = query.data.delegations.filter((d) => d.state === 'ended' || d.state === 'revoked').slice(0, 5);
  const when = (d: ActingOwnerDelegation) =>
    d.endsAt
      ? t('actingOwner.window', { from: formatDateTime(d.startsAt), until: formatDateTime(d.endsAt) })
      : t('actingOwner.windowOpen', { from: formatDateTime(d.startsAt) });
  const row = (d: ActingOwnerDelegation, action?: () => void) => (
    <ListRow
      flat
      key={d.id}
      leading={UserRound}
      title={d.delegate ? displayName(d.delegate, language) : '—'}
      subtitle={when(d)}
      accessory={<Chip tone={d.state === 'active' ? 'success' : d.state === 'scheduled' ? 'info' : 'neutral'} label={t(`actingOwner.state.${d.state}` as const)} />}
      onPress={action}
      chevron={false}
    />
  );

  return (
    <Screen gap="xl" footer={isOwner && live.length === 0 ? <Button title={t('actingOwner.appoint')} icon={ShieldCheck} onPress={() => setAppointing(true)} fullWidth /> : undefined}>
      {header}
      <PageIntro description={t(isOwner ? 'actingOwner.intro' : 'actingOwner.introDelegate')} />

      {live.length === 0 ? (
        <EmptyState icon={ShieldCheck} title={t('actingOwner.none')} body={isOwner ? t('actingOwner.noneBody') : undefined} />
      ) : (
        <View style={styles.section}>
          <RowGroup>{live.map((d) => row(d))}</RowGroup>
          {isOwner ? <Button title={t('actingOwner.remove')} variant="danger" onPress={() => setRemoving(live[0])} fullWidth /> : null}
        </View>
      )}

      <Powers />

      {isOwner && past.length > 0 ? (
        <View style={styles.section}>
          <Text variant="label" tone="secondary">
            {t('actingOwner.history')}
          </Text>
          <RowGroup>{past.map((d) => row(d))}</RowGroup>
        </View>
      ) : null}

      {isOwner ? <AppointSheet open={appointing} onClose={() => setAppointing(false)} /> : null}
      {isOwner ? <RemoveSheet delegation={removing} onClose={() => setRemoving(null)} /> : null}
    </Screen>
  );
}

function Powers() {
  const { t } = useTranslation();
  return (
    <View style={styles.section}>
      <Text variant="label" tone="secondary">
        {t('actingOwner.may.title')}
      </Text>
      {MAY.map((k) => (
        <Text key={k} variant="body">
          {`• ${t(`actingOwner.may.${k}` as const)}`}
        </Text>
      ))}
      <Text variant="label" tone="secondary" style={styles.kept}>
        {t('actingOwner.kept.title')}
      </Text>
      {KEPT.map((k) => (
        <Text key={k} variant="body" tone="secondary">
          {`• ${t(`actingOwner.kept.${k}` as const)}`}
        </Text>
      ))}
    </View>
  );
}

function AppointSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, language } = useTranslation();
  const queryClient = useQueryClient();
  const [person, setPerson] = useState<TeamUser | null>(null);
  const [picking, setPicking] = useState(false);
  const [start, setStart] = useState<StartChoice>('now');
  const [end, setEnd] = useState<EndChoice>('until_revoked');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();

  const team = useQuery({ queryKey: qk.users, queryFn: () => api.get<TeamUser[]>('/users'), enabled: open });
  // Active members who are not Owners: the server refuses anyone else.
  const candidates = (team.data ?? []).filter((u) => u.isActive && u.status !== 'pending' && !u.branches.some((b) => b.role === 'owner'));

  const now = new Date();
  const startsAt = startOf(start, now);
  const endsAt = endOf(endChoicesFor(start).includes(end) ? end : 'until_revoked', now, startsAt);

  const appoint = useMutation({
    mutationFn: () =>
      api.post<ActingOwnerDelegation>('/acting-owner', {
        delegateId: person!.id,
        ...(startsAt ? { startsAt: startsAt.toISOString() } : {}),
        ...(endsAt ? { endsAt: endsAt.toISOString() } : {}),
        currentPassword: password,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEY });
      toast.success(t('actingOwner.appointed'));
      setPassword('');
      setPerson(null);
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'password_incorrect') return setError(t('actingOwner.error.password'));
      if (e instanceof ApiError && e.code === 'delegation_overlap') return setError(t('actingOwner.error.overlap'));
      setError(toFriendlyError(e).body);
    },
  });

  return (
    <BottomSheet
      scroll
      open={open}
      onClose={onClose}
      title={t('actingOwner.appoint')}
      footer={
        <Button
          title={t('actingOwner.confirm')}
          onPress={() => (person && password ? appoint.mutate() : setError(t(person ? 'actingOwner.error.passwordRequired' : 'actingOwner.error.person')))}
          loading={appoint.isPending}
          fullWidth
        />
      }
    >
      <View style={styles.sheet}>
        <ListRow
          title={person ? displayName(person, language) : t('actingOwner.choosePerson')}
          subtitle={t('actingOwner.person')}
          leading={UserRound}
          onPress={() => setPicking(true)}
        />
        <View style={styles.block}>
          <Text variant="label">{t('actingOwner.from')}</Text>
          <SegmentedControl value={start} onChange={(v) => setStart(v)} options={START_CHOICES.map((c) => ({ value: c, label: t(`actingOwner.start.${c}` as const) }))} />
        </View>
        <View style={styles.block}>
          <Text variant="label">{t('actingOwner.until')}</Text>
          <SegmentedControl
            value={endChoicesFor(start).includes(end) ? end : 'until_revoked'}
            onChange={(v) => setEnd(v)}
            options={endChoicesFor(start).map((c) => ({ value: c, label: t(`actingOwner.end.${c}` as const) }))}
          />
        </View>
        {/* The confirmation: who, from when, until when — before the password commits it. */}
        {person ? (
          <InlineNotice tone="info" title={t('actingOwner.summary.title')}>
            {[
              t('actingOwner.summary.who', { name: displayName(person, language) }),
              t('actingOwner.summary.from', { date: startsAt ? formatDateTime(startsAt) : t('actingOwner.start.now') }),
              endsAt ? t('actingOwner.summary.until', { date: formatDateTime(endsAt) }) : t('actingOwner.summary.untilRevoked'),
              t('actingOwner.summary.what'),
            ].join('\n')}
          </InlineNotice>
        ) : null}
        <TextField
          label={t('actingOwner.password')}
          hint={t('actingOwner.passwordHint')}
          value={password}
          onChangeText={(v) => {
            setPassword(v);
            setError(undefined);
          }}
          secureTextEntry
          autoComplete="current-password"
          error={error}
        />
      </View>
      <SelectSheet
        open={picking}
        onClose={() => setPicking(false)}
        title={t('actingOwner.choosePerson')}
        items={candidates}
        keyExtractor={(u: TeamUser) => u.id}
        labelExtractor={(u: TeamUser) => displayName(u, language)}
        selectedKeys={person ? [person.id] : []}
        onSelect={(u: TeamUser) => {
          setPerson(u);
          setPicking(false);
          setError(undefined);
        }}
      />
    </BottomSheet>
  );
}

function RemoveSheet({ delegation, onClose }: { delegation: ActingOwnerDelegation | null; onClose: () => void }) {
  const { t, language } = useTranslation();
  const queryClient = useQueryClient();
  const { refreshUser } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const remove = useMutation({
    mutationFn: () => api.post(`/acting-owner/${delegation!.id}/revoke`, { currentPassword: password }),
    onSuccess: async () => {
      void queryClient.invalidateQueries({ queryKey: KEY });
      await refreshUser().catch(() => undefined);
      toast.success(t('actingOwner.removed'));
      setPassword('');
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError && e.code === 'password_incorrect' ? t('actingOwner.error.password') : toFriendlyError(e).body),
  });
  return (
    <BottomSheet
      scroll
      open={delegation !== null}
      onClose={onClose}
      title={t('actingOwner.remove')}
      footer={<Button title={t('actingOwner.removeConfirm')} variant="danger" onPress={() => (password ? remove.mutate() : setError(t('actingOwner.error.passwordRequired')))} loading={remove.isPending} fullWidth />}
    >
      <View style={styles.sheet}>
        <Text variant="body">{t('actingOwner.removeBody', { name: delegation?.delegate ? displayName(delegation.delegate, language) : '' })}</Text>
        <TextField label={t('actingOwner.password')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" error={error} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
  sheet: { gap: space.base },
  block: { gap: space.xs },
  kept: { marginTop: space.sm },
});
