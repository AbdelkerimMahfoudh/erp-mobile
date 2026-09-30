import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useLeave } from '../../components/navigation/HeaderBack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Trash2 } from 'lucide-react-native';
import {
  Button,
  Card,
  ErrorState,
  InlineNotice,
  Screen,
  SkeletonList,
  Text,
  TextField,
} from '../../components/ui';
import { useAuth } from '../../hooks/useAuth';
import { api, ApiError } from '../../lib/api-client';
import { space } from '../../lib/design/tokens';
import { toFriendlyError } from '../../lib/errors';
import { getLanguage, useTranslation } from '../../lib/i18n';
import { qk } from '../../lib/query-keys';
import type { AccountView, DeletionRequestView } from '../../types/api';
import { useCountdown } from './index';

/**
 * Delete your account (docs/64, App Review Guideline 5.1.1(v)).
 *
 * The screen says, before anything is sent, exactly what will happen: the
 * deletion is permanent, a code goes to the verified WhatsApp number, and
 * nothing is deleted until that code is entered and confirmed. It says what is
 * deleted — the login, or the business and every login in it — and what the
 * law requires to be kept, and how the person's details are removed from it.
 *
 * Every state on this screen is the server's: the request the server holds,
 * the attempts it has left, the instant a new code may be asked for, whether
 * the message was actually accepted. The final screen appears only once the
 * server reports `completed`; a deletion in flight is shown as in flight.
 */
type Step = 'confirm' | 'code' | 'done';

export default function DeleteAccountScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { signOut } = useAuth();
  const header = <Stack.Screen options={{ headerShown: true, title: t('account.delete.title') }} />;

  const account = useQuery({ queryKey: qk.account, queryFn: () => api.get<AccountView>('/account') });

  const [ownStep, setStep] = useState<Step>('confirm');
  const [ownRequest, setRequest] = useState<DeletionRequestView | null>(null);
  /** A server request this screen already dealt with (cancelled, or failed), so it is not resumed again. */
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /*
   * A request already under way resumes where it was — the code screen, or
   * the result — derived from the server's answer rather than copied into
   * state, so the screen and the server cannot disagree about which request
   * is live. Once the person acts here, their own request wins.
   */
  const existing = account.data?.deletion ?? null;
  const resumable =
    existing && existing.id !== dismissedId && (existing.status === 'awaiting_code' || existing.status === 'completed')
      ? existing
      : null;
  const request = ownRequest ?? resumable;
  const step: Step = ownRequest ? ownStep : resumable ? (resumable.status === 'completed' ? 'done' : 'code') : ownStep;
  const resendIn = useCountdown(request?.resendAvailableAt ?? null);
  const leave = useLeave('/account/delete');

  const explain = (e: unknown): { text: string; backToStart?: boolean } => {
    if (e instanceof ApiError) {
      switch (e.code) {
        case 'reauthentication_failed':
          return { text: t('account.wrongPassword') };
        case 'whatsapp_number_required':
          return { text: t('account.delete.needNumber') };
        case 'deletion_unavailable':
          return { text: t('account.unavailable') };
        case 'too_many_codes':
          return { text: t('account.code.tooMany') };
        case 'invalid_code': {
          const left = (e.body as { attemptsRemaining?: number } | undefined)?.attemptsRemaining;
          return { text: t('account.code.wrong', { left: String(left ?? '') }) };
        }
        case 'code_expired':
          return { text: t('account.code.expired') };
        case 'too_many_attempts':
          return { text: t('account.delete.tooManyAttempts'), backToStart: true };
        case 'request_expired':
          return { text: t('account.delete.requestExpired'), backToStart: true };
        case 'number_changed':
          return { text: t('account.delete.numberChanged'), backToStart: true };
        case 'no_open_request':
          return { text: t('account.delete.requestExpired'), backToStart: true };
        case 'code_not_active':
          return { text: t('account.code.notActive') };
        case 'deletion_failed':
          return { text: t('account.delete.failed'), backToStart: true };
      }
    }
    return { text: toFriendlyError(e).body };
  };

  const fail = (e: unknown) => {
    const { text, backToStart } = explain(e);
    setProblem(text);
    if (backToStart) {
      if (request) setDismissedId(request.id);
      setRequest(null);
      setCode('');
      setStep('confirm');
      setNotice(text);
      setProblem(null);
    }
  };

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try {
      const view = await api.post<DeletionRequestView>('/account/deletion/request', {
        password,
        language: getLanguage(),
      });
      setPassword('');
      setRequest(view);
      setStep('code');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const view = await api.post<DeletionRequestView>('/account/deletion/resend', { language: getLanguage() });
      setRequest(view);
      setCode('');
      setNotice(t('account.delete.codeSent', { destination: view.destinationMasked }));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const view = await api.post<DeletionRequestView>('/account/deletion/confirm', { code: code.trim() });
      setRequest(view);
      if (view.status === 'completed') {
        setStep('done');
      } else if (view.status === 'confirmed' || view.status === 'processing') {
        // Another confirmation is carrying it out. Show it as in flight and ask again.
        setNotice(t('account.delete.processing'));
        setTimeout(() => void poll(), 1500);
      } else {
        setNotice(null);
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const poll = async () => {
    try {
      const state = await api.get<{ request: DeletionRequestView | null }>('/account/deletion');
      if (state.request) {
        setRequest(state.request);
        if (state.request.status === 'completed') setStep('done');
        else if (state.request.status === 'failed') fail(new ApiError(state.request.failure ?? '', 503, 'deletion_failed'));
        else if (state.request.status !== 'awaiting_code') setTimeout(() => void poll(), 1500);
      }
    } catch {
      // The session ends the moment the deletion completes; a 401 here means it did.
      setStep('done');
    }
  };

  const cancel = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.post('/account/deletion/cancel', {});
      if (request) setDismissedId(request.id);
      setRequest(null);
      setCode('');
      setStep('confirm');
      setNotice(t('account.delete.cancelled'));
      await queryClient.invalidateQueries({ queryKey: qk.account });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  if (account.isLoading) {
    return (
      <Screen>
        {header}
        <SkeletonList count={3} />
      </Screen>
    );
  }
  if (account.isError || !account.data) {
    return (
      <Screen>
        {header}
        <ErrorState error={account.error} onRetry={() => void account.refetch()} />
      </Screen>
    );
  }

  const me = account.data;
  const business = me.deletionKind === 'company_closure';

  if (step === 'done') {
    return (
      <Screen gap="lg">
        {header}
        <View style={styles.done}>
          <ShieldCheck size={40} />
          <Text variant="title" align="center">
            {request?.kind === 'company_closure' ? t('account.delete.doneBusiness') : t('account.delete.doneLogin')}
          </Text>
          <Text tone="secondary" align="center">
            {t('account.delete.doneBody')}
          </Text>
          <Button title={t('account.delete.doneAction')} onPress={() => void signOut()} fullWidth />
        </View>
      </Screen>
    );
  }

  if (step === 'code' && request) {
    return (
      <Screen gap="lg">
        {header}
        <Text variant="title">{t('account.delete.heading')}</Text>
        {request.delivered ? (
          <Text tone="secondary">{t('account.delete.codeSent', { destination: request.destinationMasked })}</Text>
        ) : (
          <InlineNotice tone="danger">
            {t('account.delete.notDelivered', {
              problem: t(`account.delivery.${request.deliveryProblem ?? 'unknown'}` as never),
            })}
          </InlineNotice>
        )}
        {notice ? <InlineNotice tone="neutral">{notice}</InlineNotice> : null}
        <TextField
          label={t('account.delete.code')}
          value={code}
          onChangeText={(v) => {
            setCode(v);
            setProblem(null);
          }}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          maxLength={6}
          variant="identifier"
          error={problem ?? undefined}
        />
        <Text variant="caption" tone="tertiary">
          {t('account.delete.irreversible')}
        </Text>
        <Button
          title={t('account.delete.confirm')}
          variant="danger"
          icon={Trash2}
          onPress={() => void confirm()}
          loading={busy}
          disabled={code.trim().length !== 6}
          fullWidth
        />
        <Button
          title={resendIn > 0 ? t('account.code.resendIn', { seconds: String(resendIn) }) : t('account.code.resend')}
          variant="secondary"
          onPress={() => void resend()}
          disabled={resendIn > 0 || busy}
        />
        <Button title={t('account.delete.cancel')} variant="tertiary" onPress={() => void cancel()} disabled={busy} />
      </Screen>
    );
  }

  return (
    <Screen gap="lg">
      {header}
      <Text variant="title">{t('account.delete.heading')}</Text>
      <Text variant="bodyStrong" tone="danger">
        {t('account.delete.irreversible')}
      </Text>
      <Text tone="secondary">{t('account.delete.how')}</Text>

      <Card style={styles.card}>
        <Text variant="bodyStrong">{business ? t('account.delete.scopeBusinessTitle') : t('account.delete.scopeLoginTitle')}</Text>
        <Text tone="secondary">{business ? t('account.delete.scopeBusiness') : t('account.delete.scopeLogin')}</Text>
        <Text variant="bodyStrong" style={styles.keptTitle}>
          {t('account.delete.retainedTitle')}
        </Text>
        <Text tone="secondary">{t('account.delete.retained')}</Text>
      </Card>

      {notice ? <InlineNotice tone="neutral">{notice}</InlineNotice> : null}

      {me.whatsappVerified ? (
        <>
          <Text tone="secondary">{t('account.delete.to', { destination: me.phone ?? '' })}</Text>
          <TextField
            label={t('account.delete.password')}
            value={password}
            onChangeText={(v) => {
              setPassword(v);
              setProblem(null);
            }}
            secureTextEntry
            autoComplete="current-password"
            error={problem ?? undefined}
          />
          <Button
            title={t('account.delete.send')}
            variant="danger"
            onPress={() => void start()}
            loading={busy}
            disabled={password.length === 0}
            fullWidth
          />
        </>
      ) : (
        <>
          <InlineNotice tone="warning">{t('account.delete.needNumber')}</InlineNotice>
          <Button title={t('account.delete.goVerify')} onPress={() => router.push('/account' as never)} />
        </>
      )}
      <Button title={t('account.delete.keep')} variant="tertiary" onPress={leave} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { padding: space.md, gap: space.sm },
  keptTitle: { marginTop: space.sm },
  done: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: space.md, paddingHorizontal: space.md },
});
