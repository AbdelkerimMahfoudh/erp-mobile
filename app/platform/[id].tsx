import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import {
  Button,
  Card,
  Chip,
  Disclosure,
  ErrorState,
  Screen,
  Section,
  SkeletonList,
  Text,
  TextField,
} from '../../components/ui';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { dialog } from '../../lib/dialog';
import { toErrorMessage } from '../../lib/errors';
import { formatDate, formatDateTime } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { toast } from '../../lib/toast';
import {
  PlatformApiError,
  platformApi,
  platformKeys,
  usePlatformBusiness,
  usePlatformGuard,
  type OwnerInvitation,
  type PlatformBusinessDetail,
} from '../../lib/platform-admin';
import {
  actionsFor,
  isHighImpact,
  monthsValid,
  needsDate,
  needsMonths,
  needsReason,
  periodEndInstant,
  periodEndValid,
  platformStateTone,
  type PlatformAction,
} from '../../lib/platform-state';
import { useQueryClient } from '@tanstack/react-query';

/**
 * One business as the platform sees it.
 *
 * Identity, subscription state and dates, the people and their contact
 * verification, the history — and the controlled actions. Note what is not
 * here and cannot be: sales, IMEIs, costs, margins, expenses. The server's
 * query does not return them, and no screen of the platform asks.
 *
 * Every action is a form (months or a date where it applies, a reason where
 * one is required, the administrator's own password every time), then a
 * confirmation that names the business, then the server's answer. A version
 * travels with each request, so two administrators cannot both apply the same
 * change: the loser is told the business was refreshed.
 */
export default function PlatformBusinessScreen() {
  const styles = useStyles();
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = usePlatformGuard();
  const query = usePlatformBusiness(id);
  const qc = useQueryClient();
  const [action, setAction] = useState<PlatformAction | null>(null);
  const [invitation, setInvitation] = useState<OwnerInvitation | null>(null);

  if (!session) return null;

  const business = query.data;
  const state = business?.entitlement?.state ?? 'expired';

  const done = async (result: { applied: boolean }, next?: OwnerInvitation) => {
    setAction(null);
    if (next) setInvitation(next);
    await qc.invalidateQueries({ queryKey: platformKeys.business(id ?? '') });
    await qc.invalidateQueries({ queryKey: platformKeys.dashboard() });
    await qc.invalidateQueries({ queryKey: ['platform', 'businesses'] });
    if (!next) {
      const fresh = qc.getQueryData<PlatformBusinessDetail>(platformKeys.business(id ?? ''));
      toast.success(
        result.applied
          ? t('platform.done.applied', { state: t(`platform.state.${fresh?.entitlement?.state ?? state}` as never) })
          : t('platform.done.unchanged'),
      );
    }
  };

  const failed = async (e: unknown) => {
    if (e instanceof PlatformApiError && e.status === 409) {
      // Somebody else got there first. Refresh, say so, keep the form open.
      await qc.invalidateQueries({ queryKey: platformKeys.business(id ?? '') });
      toast.warning(t('platform.detail.refreshed'));
      return;
    }
    toast.error(toErrorMessage(e));
  };

  return (
    <Screen scroll={false}>
      <Stack.Screen options={{ headerShown: true, title: business?.name ?? t('platform.detail.title') }} />
      {query.isLoading ? (
        <SkeletonList count={4} />
      ) : query.isError || !business ? (
        <ErrorState error={query.error ?? new Error('')} onRetry={() => void query.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Card style={styles.identity}>
            <View style={styles.headRow}>
              <Text variant="title" style={styles.flex}>
                {business.name}
              </Text>
              <Chip tone={platformStateTone(state)} label={t(`platform.state.${state}` as never)} dot />
            </View>
            <Line label={t('platform.detail.storeId')} value={business.publicStoreId} />
            {business.city ? <Line label={t('platform.detail.city')} value={business.city} /> : null}
            <Line label={t('platform.detail.created')} value={formatDate(business.createdAt)} />
            {business.entitlement?.periodEnd ? (
              <Line
                label={t('platform.detail.periodEnd')}
                value={`${formatDateTime(business.entitlement.periodEnd)}${
                  business.entitlement.daysRemaining !== null && business.entitlement.daysRemaining >= 0
                    ? ` · ${t('platform.detail.daysRemaining', { days: String(business.entitlement.daysRemaining) })}`
                    : ''
                }`}
              />
            ) : null}
            {business.entitlement?.graceEnd && state === 'grace' ? (
              <Line label={t('platform.detail.graceEnd')} value={formatDateTime(business.entitlement.graceEnd)} />
            ) : null}
          </Card>

          {invitation ? <InvitationCard invitation={invitation} onDismiss={() => setInvitation(null)} /> : null}

          <Section title={t('platform.detail.people')}>
            <Card padding="md" style={styles.list}>
              {business.people.map((p) => (
                <View key={p.id} style={styles.person}>
                  <Text variant="bodyStrong">{p.name}</Text>
                  <Text variant="caption" tone="secondary">
                    {[p.email, p.phone].filter(Boolean).join(' · ')}
                  </Text>
                  <View style={styles.chips}>
                    <Chip
                      tone={p.emailVerified || p.phoneVerified ? 'success' : 'neutral'}
                      label={p.emailVerified || p.phoneVerified ? t('platform.detail.verified') : t('platform.detail.unverified')}
                      size="sm"
                      dot
                    />
                    {!p.isActive ? <Chip tone="neutral" label={t('platform.detail.inactive')} size="sm" dot /> : null}
                  </View>
                </View>
              ))}
            </Card>
          </Section>

          <Section title={t('platform.detail.branches')}>
            <Card padding="md">
              {business.branches.map((b) => (
                <Text key={b.id} variant="body">
                  {b.name}
                </Text>
              ))}
            </Card>
          </Section>

          <Section>
            <View style={styles.actions}>
              {actionsFor(state).map((a) => (
                <Button
                  key={a}
                  title={t(`platform.action.${a}` as never)}
                  variant={a === action ? 'primary' : isHighImpact(a) ? 'danger' : 'secondary'}
                  size="sm"
                  onPress={() => setAction(action === a ? null : a)}
                />
              ))}
            </View>
            {action ? (
              <ActionForm
                action={action}
                business={business}
                onCancel={() => setAction(null)}
                onDone={done}
                onFailed={failed}
              />
            ) : null}
          </Section>

          <Disclosure title={t('platform.detail.history')} summary={String(business.events.length)}>
            <View style={styles.list}>
              {business.events.map((e) => (
                <View key={e.id} style={styles.event}>
                  <Text variant="bodyStrong">{t(`platform.event.${e.kind}` as never)}</Text>
                  <Text variant="caption" tone="secondary">
                    {formatDateTime(e.createdAt)}
                    {e.actor ? ` · ${t('platform.audit.by', { actor: e.actor })}` : ''}
                    {e.periodEndAfter ? ` · ${t('platform.row.periodEnd', { date: formatDate(e.periodEndAfter) })}` : ''}
                  </Text>
                  {e.note ? (
                    <Text variant="caption" tone="tertiary">
                      {e.note}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          </Disclosure>

          <Disclosure title={t('platform.detail.payments')} summary={String(business.payments.length)}>
            {business.payments.length === 0 ? (
              <Text variant="caption" tone="secondary">
                {t('platform.detail.noPayments')}
              </Text>
            ) : (
              <View style={styles.list}>
                {business.payments.map((p) => (
                  <View key={p.id} style={styles.event}>
                    <Text variant="bodyStrong">{`${p.amount} ${p.currency} · ${p.channel}`}</Text>
                    <Text variant="caption" tone="secondary">
                      {formatDateTime(p.paidAt)}
                      {` · ${t('platform.audit.by', { actor: p.recordedBy })}`}
                    </Text>
                    <Text variant="caption" tone="tertiary">
                      {t('platform.payment.note')}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </Disclosure>
        </ScrollView>
      )}
    </Screen>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.line}>
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
      <Text variant="body" selectable>
        {value}
      </Text>
    </View>
  );
}

/**
 * The invitation, shown once.
 *
 * The token exists in this response and nowhere else. Nothing sends it — no
 * provider is configured — so the administrator passes it on themselves.
 */
function InvitationCard({ invitation, onDismiss }: { invitation: OwnerInvitation; onDismiss: () => void }) {
  const styles = useStyles();
  const { t } = useTranslation();
  return (
    <Card variant="warning" style={styles.list}>
      <Text variant="heading">{t('platform.invite.title')}</Text>
      <Text variant="caption" tone="secondary">
        {t('platform.invite.body', { expires: formatDateTime(invitation.expiresAt) })}
      </Text>
      <Text variant="mono" selectable>
        {invitation.token}
      </Text>
      {invitation.replaced ? (
        <Text variant="caption" tone="tertiary">
          {t('platform.invite.replaced', { count: String(invitation.replaced) })}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button
          title={t('platform.invite.copy')}
          size="sm"
          onPress={() => {
            void Clipboard.setStringAsync(invitation.token).then(() => toast.success(t('platform.invite.copied')));
          }}
        />
        <Button title={t('platform.form.cancel')} variant="tertiary" size="sm" onPress={onDismiss} />
      </View>
    </Card>
  );
}

function ActionForm({
  action,
  business,
  onCancel,
  onDone,
  onFailed,
}: {
  action: PlatformAction;
  business: PlatformBusinessDetail;
  onCancel: () => void;
  onDone: (result: { applied: boolean }, invitation?: OwnerInvitation) => Promise<void>;
  onFailed: (e: unknown) => Promise<void>;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const [months, setMonths] = useState('1');
  const [periodEnd, setPeriodEnd] = useState('');
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const monthsOk = !needsMonths(action) || monthsValid(months);
  const dateOk = !needsDate(action) || periodEndValid(periodEnd, new Date());
  const reasonOk = !needsReason(action) || reason.trim().length >= 3;
  const ready = monthsOk && dateOk && reasonOk && password.length > 0;

  const submit = async () => {
    if (!ready || busy) return;
    const ok = await dialog.confirm({
      title: t('platform.confirm.title', { action: t(`platform.action.${action}` as never), business: business.name }),
      message: t('platform.confirm.body'),
      confirmLabel: t('platform.form.confirm'),
      cancelLabel: t('platform.form.cancel'),
      tone: isHighImpact(action) ? 'danger' : 'default',
    });
    if (!ok) return;
    setBusy(true);
    const stepUp = { confirmPassword: password, expectedVersion: business.version };
    const why = reason.trim() || undefined;
    try {
      switch (action) {
        case 'approve':
          await onDone(await platformApi.approve(business.id, { ...stepUp, months: Number(months), reason: why }));
          break;
        case 'extend':
          await onDone(await platformApi.extend(business.id, { ...stepUp, months: Number(months), reason: why }));
          break;
        case 'period':
          await onDone(await platformApi.setPeriod(business.id, { ...stepUp, periodEnd: periodEndInstant(periodEnd), reason: reason.trim() }));
          break;
        case 'reject':
          await onDone(await platformApi.reject(business.id, { ...stepUp, reason: reason.trim() }));
          break;
        case 'suspend':
          await onDone(await platformApi.suspend(business.id, { ...stepUp, reason: reason.trim() }));
          break;
        case 'reinstate':
          await onDone(await platformApi.reinstate(business.id, { ...stepUp, reason: reason.trim() }));
          break;
        case 'cancel':
          await onDone(await platformApi.cancel(business.id, { ...stepUp, reason: reason.trim() }));
          break;
        case 'invite': {
          const invitation = await platformApi.ownerInvitation(business.id, { confirmPassword: password, reason: why });
          await onDone({ applied: true }, invitation);
          break;
        }
      }
    } catch (e) {
      await onFailed(e);
    } finally {
      setPassword('');
      setBusy(false);
    }
  };

  return (
    <Card variant="sunken" padding="md" style={styles.list}>
      <Text variant="heading">{t(`platform.action.${action}` as never)}</Text>
      {needsMonths(action) ? (
        <TextField
          label={t('platform.form.months')}
          value={months}
          onChangeText={setMonths}
          keyboardType="number-pad"
          error={monthsValid(months) ? undefined : t('platform.form.invalidMonths')}
        />
      ) : null}
      {needsDate(action) ? (
        <TextField
          label={t('platform.form.periodEnd')}
          value={periodEnd}
          onChangeText={setPeriodEnd}
          variant="identifier"
          error={periodEnd && !periodEndValid(periodEnd, new Date()) ? t('platform.form.invalidDate') : undefined}
        />
      ) : null}
      <TextField
        label={t('platform.form.reason')}
        hint={t('platform.form.reasonHint')}
        required={needsReason(action)}
        value={reason}
        onChangeText={setReason}
        multiline
      />
      <TextField
        label={t('platform.form.password')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
      />
      <View style={styles.actions}>
        <Button title={t('platform.form.cancel')} variant="tertiary" size="sm" onPress={onCancel} disabled={busy} />
        <Button
          title={t('platform.form.confirm')}
          variant={isHighImpact(action) ? 'danger' : 'primary'}
          size="sm"
          disabled={!ready || busy}
          loading={busy}
          onPress={() => void submit()}
        />
      </View>
    </Card>
  );
}

const useStyles = makeStyles(() => ({
  flex: { flex: 1 },
  content: { gap: space.base, paddingBottom: space['3xl'] },
  identity: { gap: space.sm },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  line: { gap: 2 },
  list: { gap: space.sm },
  person: { gap: 2, paddingVertical: space.xs },
  chips: { flexDirection: 'row', gap: space.xs, flexWrap: 'wrap' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, justifyContent: 'flex-end' },
  event: { gap: 2, paddingVertical: space.xs },
}));
