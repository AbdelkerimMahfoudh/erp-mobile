import React, { useRef, useState } from 'react';
import { AccessibilityInfo, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AuthLanguageSwitch, Button, InlineNotice, TextField } from '../../components/ui';
import { Text } from '../../components/ui/Text';
import { WhatsAppConsentCheck } from '../../components/consent/WhatsAppConsentCheck';
import { api, ApiError } from '../../lib/api-client';
import { toFriendlyError } from '../../lib/errors';
import { useTranslation } from '../../lib/i18n';
import { useColors } from '../../lib/design/theme';
import { space } from '../../lib/design/tokens';
import { LOGIN } from '../../lib/navigation/entry';
import { qk } from '../../lib/query-keys';
import { codeRequestBody, confirmBody, contactOf, needsConsent, type StaffContact } from '../../lib/staff-activation';
import { consentFields, consentProblemKey } from '../../lib/whatsapp-consent';
import type { StaffConfirmResult, WhatsAppConsentCopy } from '../../types/api';

/**
 * Joining a team (D213; docs/69 §3): the employee finishes the account their business Owner created.
 *
 * Signed out, on the person's own phone. They type the WhatsApp number or email address the Owner gave. For a number,
 * the server's operational WhatsApp consent is shown with an unticked box, and the code is asked for only once the
 * person ticks it — their agreement, recorded with them as its author, pending until this code proves the number. The
 * Owner never agrees for them, and cannot send this code. For an email address no WhatsApp consent is asked.
 *
 * The routes are the public ones of the employee's own side (`staff/verify/*`), which answer the same whether or not
 * an account waits: nothing here tells a stranger who works where.
 */
export default function JoinScreen() {
  const { t, language } = useTranslation();
  const router = useRouter();
  const colors = useColors();

  const [step, setStep] = useState<'contact' | 'code' | 'done'>('contact');
  const [typed, setTyped] = useState('');
  const [ticked, setTicked] = useState(false);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [contactProblem, setContactProblem] = useState<string | null>(null);
  const [consentProblem, setConsentProblem] = useState<string | null>(null);
  const [codeProblem, setCodeProblem] = useState<string | null>(null);
  const [passwordProblem, setPasswordProblem] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [accounts, setAccounts] = useState<StaffConfirmResult['accounts']>([]);
  const consentRef = useRef<View>(null);

  const contact = contactOf(typed);
  const asksConsent = needsConsent(contact);
  const copy = useQuery({
    queryKey: qk.whatsappConsentCopy(language),
    queryFn: () => api.get<WhatsAppConsentCopy>(`/messaging/whatsapp/consent?language=${language}`),
    enabled: asksConsent,
  });

  const askForCode = async () => {
    if (busy) return;
    setFailure(null);
    if (!contact) {
      setContactProblem(t('join.problem.contact'));
      return;
    }
    if (asksConsent && (!ticked || !copy.data)) {
      setConsentProblem(t(copy.data ? 'consent.problem.required' : 'consent.loadFailed'));
      if (consentRef.current) AccessibilityInfo.sendAccessibilityEvent(consentRef.current, 'focus');
      return;
    }
    setBusy(true);
    try {
      await api.post('/staff/verify/resend', codeRequestBody(contact, language, consentFields(copy.data, ticked)));
      setStep('code');
    } catch (e) {
      const key = e instanceof ApiError ? consentProblemKey(e.code) : null;
      if (key) {
        if (e instanceof ApiError && e.code === 'whatsapp_consent_outdated') {
          setTicked(false);
          void copy.refetch();
        }
        setConsentProblem(t(key));
      } else if (e instanceof ApiError && e.code === 'delivery_unavailable') {
        setFailure(t('join.unavailable'));
      } else {
        setFailure(toFriendlyError(e).body);
      }
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (target: StaffContact) => {
    if (busy) return;
    setFailure(null);
    setBusy(true);
    try {
      const result = await api.post<StaffConfirmResult>('/staff/verify/confirm', confirmBody(target, code, password));
      setAccounts(result.accounts);
      setPassword('');
      setStep('done');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'password_required') setPasswordProblem(t('join.problem.password'));
      else if (e instanceof ApiError && e.status === 400) setCodeProblem(t('join.problem.code'));
      else setFailure(toFriendlyError(e).body);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: colors.surface.canvas }]}>
      <Stack.Screen options={{ headerShown: true, title: t('join.title') }} />
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          {step === 'contact' ? (
            <View style={styles.group}>
              <Text variant="body" tone="secondary">
                {t('join.subtitle')}
              </Text>
              <TextField
                label={t('join.field.contact')}
                hint={t('join.field.contact.hint')}
                value={typed}
                onChangeText={(v) => {
                  setTyped(v);
                  setContactProblem(null);
                  setFailure(null);
                }}
                autoCapitalize="none"
                autoComplete="tel"
                error={contactProblem ?? undefined}
              />
              {asksConsent ? (
                <WhatsAppConsentCheck
                  ref={consentRef}
                  copy={copy.data}
                  loading={copy.isLoading}
                  failed={copy.isError}
                  onRetry={() => void copy.refetch()}
                  checked={ticked}
                  onChange={(next) => {
                    setTicked(next);
                    setConsentProblem(null);
                  }}
                  error={consentProblem ?? undefined}
                  disabled={busy}
                />
              ) : null}
              {failure ? <InlineNotice tone="warning">{failure}</InlineNotice> : null}
              <Button title={t('join.send')} onPress={() => void askForCode()} loading={busy} disabled={busy} />
            </View>
          ) : null}

          {step === 'code' && contact ? (
            <View style={styles.group}>
              <Text variant="body" tone="secondary">
                {t(contact.channel === 'phone' ? 'join.sent.phone' : 'join.sent.email')}
              </Text>
              <TextField
                label={t('join.field.code')}
                value={code}
                onChangeText={(v) => {
                  setCode(v);
                  setCodeProblem(null);
                }}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                maxLength={12}
                variant="identifier"
                error={codeProblem ?? undefined}
              />
              <TextField
                label={t('join.field.password')}
                hint={t('join.field.password.hint')}
                value={password}
                onChangeText={(v) => {
                  setPassword(v);
                  setPasswordProblem(null);
                }}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                error={passwordProblem ?? undefined}
              />
              {failure ? <InlineNotice tone="warning">{failure}</InlineNotice> : null}
              <Button title={t('join.confirm')} onPress={() => void confirm(contact)} loading={busy} disabled={busy || code.trim().length < 4} />
              <Button title={t('join.again')} variant="tertiary" onPress={() => void askForCode()} disabled={busy} />
            </View>
          ) : null}

          {step === 'done' ? (
            <View style={styles.group}>
              {accounts.map((a) => (
                <InlineNotice key={`${a.business}-${a.name}`} tone={a.activated ? 'success' : 'info'}>
                  {t(a.activated ? 'join.done.ready' : 'join.done.waiting', { business: a.business })}
                </InlineNotice>
              ))}
              <Button title={t('join.signIn')} onPress={() => router.replace(LOGIN as never)} />
            </View>
          ) : null}

          <Button title={t('register.back')} variant="secondary" onPress={() => router.back()} disabled={busy} />
          <AuthLanguageSwitch />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: space.lg, gap: space.lg },
  group: { gap: space.md },
});
