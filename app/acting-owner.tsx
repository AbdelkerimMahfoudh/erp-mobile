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
 * does not depend on either phone being online. Appointing and removing ask for the Owner's password and then a code
 * sent to the Owner's verified WhatsApp number for that very change (the account-deletion code service), after a
 * summary of who, from when, until when and what they may do.
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

/** The code the server sent for one change (`POST /acting-owner/code`): where it went, never the code. */
interface StepUpSent {
  challengeId: string;
  destinationMasked: string;
  expiresAt: string;
  resendAvailableAt: string | null;
}

type Translate = ReturnType<typeof useTranslation>['t'];

/** The server's refusals of the step-up and of the change, in words. */
function stepUpProblem(e: unknown, t: Translate): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'password_incorrect':
        return t('actingOwner.error.password');
      case 'delegation_overlap':
        return t('actingOwner.error.overlap');
      case 'whatsapp_number_required':
        return t('actingOwner.error.needNumber');
      case 'step_up_unavailable':
        return t('actingOwner.error.unavailable');
      case 'too_many_codes':
        return t('account.code.tooMany');
      case 'invalid_code':
        return t('account.code.wrong', { left: String((e.body as { attemptsRemaining?: number } | undefined)?.attemptsRemaining ?? '') });
      case 'code_expired':
        return t('account.code.expired');
      case 'code_locked':
        return t('account.code.locked');
      case 'code_not_active':
        return t('account.code.notActive');
    }
  }
  return toFriendlyError(e).body;
}

/** The second half of the step-up: where the code went, and the field to type it in. */
function CodeStep({ sent, code, onCode, error }: { sent: StepUpSent; code: string; onCode: (v: string) => void; error?: string }) {
  const { t } = useTranslation();
  return (
    <>
      <InlineNotice tone="info">{t('actingOwner.stepUp.sent', { destination: sent.destinationMasked })}</InlineNotice>
      <TextField
        label={t('actingOwner.stepUp.code')}
        value={code}
        onChangeText={onCode}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        maxLength={6}
        variant="identifier"
        error={error}
      />
    </>
  );
}

/**
 * Naming an Acting Owner: who, from when, until when — then the Owner's password, then the code WhatsApp brings for
 * exactly that appointment. The times are fixed when the code is asked for, so the code confirms what was shown.
 */
function AppointSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, language } = useTranslation();
  const queryClient = useQueryClient();
  const [person, setPerson] = useState<TeamUser | null>(null);
  const [picking, setPicking] = useState(false);
  const [start, setStart] = useState<StartChoice>('now');
  const [end, setEnd] = useState<EndChoice>('until_revoked');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState<(StepUpSent & { startsAt: string | null; endsAt: string | null }) | null>(null);
  const [error, setError] = useState<string | undefined>();

  const team = useQuery({ queryKey: qk.users, queryFn: () => api.get<TeamUser[]>('/users'), enabled: open });
  // Active members who are not Owners: the server refuses anyone else.
  const candidates = (team.data ?? []).filter((u) => u.isActive && u.status !== 'pending' && !u.branches.some((b) => b.role === 'owner'));

  const now = new Date();
  const startsAt = startOf(start, now);
  const endsAt = endOf(endChoicesFor(start).includes(end) ? end : 'until_revoked', now, startsAt);

  const reset = () => {
    setPassword('');
    setCode('');
    setSent(null);
    setError(undefined);
  };

  const requestCode = useMutation({
    mutationFn: () => {
      const window = { startsAt: startsAt?.toISOString() ?? null, endsAt: endsAt?.toISOString() ?? null };
      return api
        .post<StepUpSent>('/acting-owner/code', {
          action: 'appoint',
          delegateId: person!.id,
          ...(window.startsAt ? { startsAt: window.startsAt } : {}),
          ...(window.endsAt ? { endsAt: window.endsAt } : {}),
          currentPassword: password,
          language,
        })
        .then((s) => ({ ...s, ...window }));
    },
    onSuccess: (s) => {
      setSent(s);
      setCode('');
      setError(undefined);
    },
    onError: (e) => setError(stepUpProblem(e, t)),
  });

  const appoint = useMutation({
    mutationFn: () =>
      api.post<ActingOwnerDelegation>('/acting-owner', {
        delegateId: person!.id,
        ...(sent!.startsAt ? { startsAt: sent!.startsAt } : {}),
        ...(sent!.endsAt ? { endsAt: sent!.endsAt } : {}),
        currentPassword: password,
        challengeId: sent!.challengeId,
        code: code.trim(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEY });
      toast.success(t('actingOwner.appointed'));
      reset();
      setPerson(null);
      onClose();
    },
    onError: (e) => setError(stepUpProblem(e, t)),
  });

  const footer = sent ? (
    <View style={styles.block}>
      <Button title={t('actingOwner.confirm')} onPress={() => appoint.mutate()} loading={appoint.isPending} disabled={code.trim().length !== 6} fullWidth />
      <Button title={t('account.code.resend')} variant="secondary" onPress={() => requestCode.mutate()} loading={requestCode.isPending} disabled={appoint.isPending} fullWidth />
      <Button title={t('actingOwner.stepUp.back')} variant="tertiary" onPress={() => reset()} disabled={appoint.isPending} />
    </View>
  ) : (
    <Button
      title={t('actingOwner.stepUp.send')}
      onPress={() => (person && password ? requestCode.mutate() : setError(t(person ? 'actingOwner.error.passwordRequired' : 'actingOwner.error.person')))}
      loading={requestCode.isPending}
      fullWidth
    />
  );

  return (
    <BottomSheet scroll open={open} onClose={onClose} title={t('actingOwner.appoint')} footer={footer}>
      <View style={styles.sheet}>
        {sent ? null : (
          <>
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
          </>
        )}
        {/* The confirmation: who, from when, until when — before the password and the code commit it. */}
        {person ? (
          <InlineNotice tone="info" title={t('actingOwner.summary.title')}>
            {[
              t('actingOwner.summary.who', { name: displayName(person, language) }),
              t('actingOwner.summary.from', { date: (sent ? sent.startsAt : startsAt) ? formatDateTime((sent ? sent.startsAt : startsAt)!) : t('actingOwner.start.now') }),
              (sent ? sent.endsAt : endsAt) ? t('actingOwner.summary.until', { date: formatDateTime((sent ? sent.endsAt : endsAt)!) }) : t('actingOwner.summary.untilRevoked'),
              t('actingOwner.summary.what'),
            ].join('\n')}
          </InlineNotice>
        ) : null}
        {sent ? (
          <CodeStep
            sent={sent}
            code={code}
            onCode={(v) => {
              setCode(v);
              setError(undefined);
            }}
            error={error}
          />
        ) : (
          <TextField
            label={t('actingOwner.password')}
            hint={t('actingOwner.stepUp.why')}
            value={password}
            onChangeText={(v) => {
              setPassword(v);
              setError(undefined);
            }}
            secureTextEntry
            autoComplete="current-password"
            error={error}
          />
        )}
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

/** Removing the Acting Owner now: the Owner's password, then the code WhatsApp brings for this removal. */
function RemoveSheet({ delegation, onClose }: { delegation: ActingOwnerDelegation | null; onClose: () => void }) {
  const { t, language } = useTranslation();
  const queryClient = useQueryClient();
  const { refreshUser } = useAuth();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState<StepUpSent | null>(null);
  const [error, setError] = useState<string | undefined>();

  const reset = () => {
    setPassword('');
    setCode('');
    setSent(null);
    setError(undefined);
  };

  const requestCode = useMutation({
    mutationFn: () => api.post<StepUpSent>('/acting-owner/code', { action: 'revoke', delegationId: delegation!.id, currentPassword: password, language }),
    onSuccess: (s) => {
      setSent(s);
      setCode('');
      setError(undefined);
    },
    onError: (e) => setError(stepUpProblem(e, t)),
  });

  const remove = useMutation({
    mutationFn: () => api.post(`/acting-owner/${delegation!.id}/revoke`, { currentPassword: password, challengeId: sent!.challengeId, code: code.trim() }),
    onSuccess: async () => {
      void queryClient.invalidateQueries({ queryKey: KEY });
      await refreshUser().catch(() => undefined);
      toast.success(t('actingOwner.removed'));
      reset();
      onClose();
    },
    onError: (e) => setError(stepUpProblem(e, t)),
  });

  const footer = sent ? (
    <View style={styles.block}>
      <Button title={t('actingOwner.removeConfirm')} variant="danger" onPress={() => remove.mutate()} loading={remove.isPending} disabled={code.trim().length !== 6} fullWidth />
      <Button title={t('account.code.resend')} variant="secondary" onPress={() => requestCode.mutate()} loading={requestCode.isPending} disabled={remove.isPending} fullWidth />
    </View>
  ) : (
    <Button
      title={t('actingOwner.stepUp.send')}
      variant="danger"
      onPress={() => (password ? requestCode.mutate() : setError(t('actingOwner.error.passwordRequired')))}
      loading={requestCode.isPending}
      fullWidth
    />
  );

  return (
    <BottomSheet
      scroll
      open={delegation !== null}
      onClose={() => {
        reset();
        onClose();
      }}
      title={t('actingOwner.remove')}
      footer={footer}
    >
      <View style={styles.sheet}>
        <Text variant="body">{t('actingOwner.removeBody', { name: delegation?.delegate ? displayName(delegation.delegate, language) : '' })}</Text>
        {sent ? (
          <CodeStep
            sent={sent}
            code={code}
            onCode={(v) => {
              setCode(v);
              setError(undefined);
            }}
            error={error}
          />
        ) : (
          <TextField
            label={t('actingOwner.password')}
            hint={t('actingOwner.stepUp.why')}
            value={password}
            onChangeText={(v) => {
              setPassword(v);
              setError(undefined);
            }}
            secureTextEntry
            autoComplete="current-password"
            error={error}
          />
        )}
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
