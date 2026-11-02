import { PhoneField } from '../../components/PhoneField';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Mail, MessageCircle } from 'lucide-react-native';
import { Button, InlineNotice, ListRow, RowGroup, Screen, Section, Text, TextField } from '../../components/ui';
import { WhatsAppConsentCheck } from '../../components/consent/WhatsAppConsentCheck';
import { adoptRefreshToken, api, ApiError } from '../../lib/api-client';
import { space } from '../../lib/design/tokens';
import { toFriendlyError } from '../../lib/errors';
import { getLanguage, useTranslation } from '../../lib/i18n';
import { toast } from '../../lib/toast';
import { whatsAppNumber } from '../../lib/whatsapp-number';
import { qk } from '../../lib/query-keys';
import type { WhatsAppConsentCopy } from '../../types/api';

type Kind = 'password' | 'phone' | 'email';
type Stage = 'form' | 'old_channel' | 'new_channel';
interface Started {
  changeId: string;
  destinationMasked: string;
}
interface Security {
  emailChange: boolean;
  history: { event: string; at: string }[];
}

const KNOWN = ['reauthentication_failed', 'invalid_code', 'too_many_attempts', 'too_many_codes', 'change_refused', 'password_weak', 'password_same', 'no_verified_channel', 'email_unavailable', 'invalid_contact', 'code_undeliverable', 'verification_unavailable'];

/** The server's reasons in the app's words: never a raw message, and never whose number it was. */
const problemKey = (e: unknown): string | null => {
  const code = e instanceof ApiError ? e.code : null;
  return code && KNOWN.includes(code) ? `security.problem.${code}` : null;
};

/**
 * More → Your account → Security and sign-in (D227). The server holds every rule and every stage; this walks through them. A
 * failed change leaves what you sign in with exactly as it was, and the screen says so.
 */
export default function SecurityScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const security = useQuery({ queryKey: ['account', 'security'], queryFn: () => api.get<Security>('/account/security') });
  const consentCopy = useQuery({
    queryKey: ['account', 'security-consent'],
    queryFn: () => api.get<{ copy: WhatsAppConsentCopy }>(`/account/whatsapp/consent?language=${getLanguage()}`).then((r) => r.copy),
  });
  const [kind, setKind] = useState<Kind | null>(null);
  const [stage, setStage] = useState<Stage>('form');
  const [started, setStarted] = useState<Started | null>(null);
  const [password, setPassword] = useState('');
  const [value, setValue] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [code, setCode] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const clear = () => {
    setKind(null);
    setStage('form');
    setStarted(null);
    setPassword('');
    setValue('');
    setNewPassword('');
    setCode('');
    setConsent(false);
    setProblem(null);
  };

  const cancel = () => {
    if (started) void api.post('/account/security/cancel', { changeId: started.changeId }).catch(() => undefined);
    clear();
  };

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setProblem(null);
    try {
      await work();
    } catch (e) {
      const key = problemKey(e);
      setProblem(key ? t(key as never) : toFriendlyError(e).title);
    } finally {
      setBusy(false);
    }
  };

  const finish = () => {
    clear();
    void qc.invalidateQueries({ queryKey: ['account'] });
    void qc.invalidateQueries({ queryKey: qk.account });
    toast.success(t('security.done'));
  };

  const start = () =>
    run(async () => {
      const language = getLanguage();
      const answer =
        kind === 'password'
          ? await api.post<Started>('/account/security/password/start', { currentPassword: password, language })
          : await api.post<Started>('/account/security/contact/start', {
              kind,
              value: kind === 'phone' ? whatsAppNumber(value) : value.trim(),
              currentPassword: password,
              language,
              ...(kind === 'phone' && consentCopy.data ? { whatsappConsentVersion: consentCopy.data.version, whatsappConsentLocale: language } : {}),
            });
      setPassword('');
      setStarted(answer);
      setStage('old_channel');
    });

  const confirm = () =>
    run(async () => {
      const changeId = started!.changeId;
      if (kind === 'password') {
        const done = await api.post<{ refreshToken: string }>('/account/security/password/confirm', { changeId, code: code.trim(), newPassword });
        // Before anything else can run: the old refresh token no longer works.
        await adoptRefreshToken(done.refreshToken);
        finish();
      } else if (stage === 'old_channel') {
        const next = await api.post<Started>('/account/security/contact/confirm-old', { changeId, code: code.trim(), language: getLanguage() });
        setStarted({ changeId, destinationMasked: next.destinationMasked });
        setCode('');
        setStage('new_channel');
      } else {
        await api.post('/account/security/contact/confirm-new', { changeId, code: code.trim() });
        finish();
      }
    });

  const header = <Stack.Screen options={{ headerShown: true, title: t('security.title') }} />;

  if (!kind) {
    return (
      <Screen>
        {header}
        <Section title={t('security.title')}>
          <RowGroup>
            <ListRow flat title={t('security.password')} leading={KeyRound} onPress={() => setKind('password')} />
            <ListRow flat title={t('security.whatsapp')} leading={MessageCircle} onPress={() => setKind('phone')} />
            <ListRow
              flat
              title={t('security.email')}
              subtitle={security.data?.emailChange === false ? t('security.emailUnavailable') : undefined}
              leading={Mail}
              onPress={security.data?.emailChange === true ? () => setKind('email') : undefined}
            />
          </RowGroup>
        </Section>
        <Section title={t('security.history')}>
          {security.data?.history.length ? (
            security.data.history.map((h) => (
              <Text key={`${h.event}${h.at}`} variant="caption" tone="secondary">
                {t(`security.event.${h.event}` as never)} · {new Date(h.at).toLocaleString(getLanguage())}
              </Text>
            ))
          ) : (
            <Text variant="caption" tone="tertiary">
              {t('security.historyNone')}
            </Text>
          )}
        </Section>
      </Screen>
    );
  }

  return (
    <Screen>
      {header}
      <View style={styles.stack}>
        {problem ? <InlineNotice tone="danger">{problem}</InlineNotice> : null}
        {stage === 'form' ? (
          <>
            {kind === 'phone' ? <PhoneField label={t('security.newWhatsapp')} value={value} onChangeText={setValue} /> : null}
            {kind === 'email' ? <TextField label={t('security.newEmail')} value={value} onChangeText={setValue} keyboardType="email-address" autoCapitalize="none" /> : null}
            <TextField label={t('security.currentPassword')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" />
            {kind === 'phone' ? (
              <WhatsAppConsentCheck copy={consentCopy.data} loading={consentCopy.isLoading} failed={consentCopy.isError} onRetry={() => void consentCopy.refetch()} checked={consent} onChange={setConsent} explain={false} disabled={busy} />
            ) : null}
            <Button
              title={t('security.sendCode')}
              onPress={() => void start()}
              loading={busy}
              disabled={password.length === 0 || (kind !== 'password' && value.trim().length < 4) || (kind === 'phone' && !consent)}
              testID="security-start"
            />
          </>
        ) : (
          <>
            <Text tone="secondary">{t(stage === 'new_channel' ? 'security.sentNew' : 'security.sentOld', { destination: started?.destinationMasked ?? '' })}</Text>
            <TextField label={t('security.code')} value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" maxLength={6} variant="identifier" />
            {kind === 'password' ? <TextField label={t('security.newPassword')} hint={t('security.newPasswordHint')} value={newPassword} onChangeText={setNewPassword} secureTextEntry autoComplete="new-password" /> : null}
            <Button title={t('security.confirm')} onPress={() => void confirm()} loading={busy} disabled={code.trim().length < 4 || (kind === 'password' && newPassword.length < 8)} testID="security-confirm" />
          </>
        )}
        <Button title={t('action.cancel')} variant="tertiary" onPress={cancel} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ stack: { gap: space.md } });
