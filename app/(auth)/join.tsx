import React, { useRef, useState } from 'react';
import { AccessibilityInfo, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
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
import { codeRequestBody, confirmBody, numberOf, openBody, referenceOf } from '../../lib/staff-activation';
import { consentFields, consentProblemKey } from '../../lib/whatsapp-consent';
import type { JoinConfirmResult, OpenedInvitation, WhatsAppConsentCopy } from '../../types/api';

/**
 * Joining a team (D213, D214; docs/69 §3): the employee activates the account their business Owner created.
 *
 * Signed out, on the person's own phone. Creating the account sent them nothing; the Owner gave them an invitation
 * reference. They type it — or open the app's link, which only fills it in: nothing is opened, accepted or sent until
 * they act. The invitation shows whose it is and the last two digits of the number; they type the whole number, see the
 * server's operational WhatsApp consent with an unticked box, tick it and ask for the code. Only then is their
 * agreement recorded — by them, pending until the code proves the number — and the code sent. The code and a first
 * password finish it, in one step on the server: the consent, the invitation and the account together.
 *
 * Every unusable reference — unknown, expired, replaced, used — reads the same: ask the business owner for a new one.
 */
export default function JoinScreen() {
  const { t, language } = useTranslation();
  const router = useRouter();
  const colors = useColors();
  const { ref } = useLocalSearchParams<{ ref?: string }>();

  const [step, setStep] = useState<'reference' | 'details' | 'code' | 'done'>('reference');
  const [typedReference, setTypedReference] = useState(() => (typeof ref === 'string' ? (referenceOf(ref) ?? ref) : ''));
  const [reference, setReference] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<OpenedInvitation | null>(null);
  const [typedNumber, setTypedNumber] = useState('');
  const [ticked, setTicked] = useState(false);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [referenceProblem, setReferenceProblem] = useState<string | null>(null);
  const [numberProblem, setNumberProblem] = useState<string | null>(null);
  const [consentProblem, setConsentProblem] = useState<string | null>(null);
  const [codeProblem, setCodeProblem] = useState<string | null>(null);
  const [passwordProblem, setPasswordProblem] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<JoinConfirmResult | null>(null);
  const consentRef = useRef<View>(null);

  const copy = useQuery({
    queryKey: qk.whatsappConsentCopy(language),
    queryFn: () => api.get<WhatsAppConsentCopy>(`/messaging/whatsapp/consent?language=${language}`),
    enabled: step === 'details' || step === 'code',
  });

  /** An unusable invitation, whatever the step: back to the reference, said the one way. */
  const invitationGone = () => {
    setStep('reference');
    setInvitation(null);
    setReference(null);
    setTicked(false);
    setReferenceProblem(t('join.unavailable'));
  };

  const open = async () => {
    if (busy) return;
    setFailure(null);
    const normalised = referenceOf(typedReference);
    if (!normalised) {
      setReferenceProblem(t('join.problem.reference'));
      return;
    }
    setBusy(true);
    try {
      const opened = await api.post<OpenedInvitation>('/staff/join/open', openBody(normalised));
      setReference(normalised);
      setInvitation(opened);
      setStep('details');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'invitation_unavailable') setReferenceProblem(t('join.unavailable'));
      else setFailure(toFriendlyError(e).body);
    } finally {
      setBusy(false);
    }
  };

  const askForCode = async () => {
    if (busy || !reference) return;
    setFailure(null);
    const number = numberOf(typedNumber);
    if (!number) {
      setNumberProblem(t('join.problem.numberFormat'));
      return;
    }
    if (!ticked || !copy.data) {
      setConsentProblem(t(copy.data ? 'consent.problem.required' : 'consent.loadFailed'));
      if (consentRef.current) AccessibilityInfo.sendAccessibilityEvent(consentRef.current, 'focus');
      return;
    }
    setBusy(true);
    try {
      await api.post('/staff/join/request-code', codeRequestBody(reference, number, language, consentFields(copy.data, ticked)));
      setStep('code');
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined;
      const consentKey = consentProblemKey(code);
      if (code === 'invitation_unavailable') invitationGone();
      else if (code === 'number_mismatch') {
        setStep('details');
        setNumberProblem(t('join.problem.number'));
      } else if (code === 'number_invalid') setNumberProblem(t('join.problem.numberFormat'));
      else if (consentKey) {
        setStep('details');
        if (code === 'whatsapp_consent_outdated') {
          setTicked(false);
          void copy.refetch();
        }
        setConsentProblem(t(consentKey));
      } else if (code === 'delivery_unavailable') setFailure(t('join.noDelivery'));
      else setFailure(toFriendlyError(e).body);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (busy || !reference) return;
    setFailure(null);
    setBusy(true);
    try {
      const confirmed = await api.post<JoinConfirmResult>('/staff/join/confirm', confirmBody(reference, code, password));
      setResult(confirmed);
      setPassword('');
      setStep('done');
    } catch (e) {
      const errorCode = e instanceof ApiError ? e.code : undefined;
      if (errorCode === 'invitation_unavailable') invitationGone();
      else if (errorCode === 'password_required') setPasswordProblem(t('join.problem.password'));
      else if (errorCode === 'consent_expired') {
        setTicked(false);
        setCode('');
        setStep('details');
        setConsentProblem(t('join.problem.consentExpired'));
      } else if (e instanceof ApiError && e.status === 400) setCodeProblem(t('join.problem.code'));
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
          {step === 'reference' ? (
            <View style={styles.group}>
              <Text variant="body" tone="secondary">
                {t('join.subtitle')}
              </Text>
              <TextField
                label={t('join.field.reference')}
                hint={t('join.field.reference.hint')}
                value={typedReference}
                onChangeText={(v) => {
                  setTypedReference(v);
                  setReferenceProblem(null);
                  setFailure(null);
                }}
                autoCapitalize="characters"
                autoCorrect={false}
                variant="identifier"
                maxLength={20}
                error={referenceProblem ?? undefined}
              />
              {failure ? <InlineNotice tone="warning">{failure}</InlineNotice> : null}
              <Button title={t('join.continue')} onPress={() => void open()} loading={busy} disabled={busy} />
            </View>
          ) : null}

          {step === 'details' && invitation ? (
            <View style={styles.group}>
              <Text variant="body">{t('join.hello', { name: invitation.name, business: invitation.business })}</Text>
              <TextField
                label={t('join.field.number')}
                hint={t('join.field.number.hint', { ending: invitation.numberEnding })}
                value={typedNumber}
                onChangeText={(v) => {
                  setTypedNumber(v);
                  setNumberProblem(null);
                  setFailure(null);
                }}
                keyboardType="phone-pad"
                autoComplete="tel"
                variant="identifier"
                maxLength={24}
                error={numberProblem ?? undefined}
              />
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
              {failure ? <InlineNotice tone="warning">{failure}</InlineNotice> : null}
              <Button title={t('join.send')} onPress={() => void askForCode()} loading={busy} disabled={busy} />
            </View>
          ) : null}

          {step === 'code' ? (
            <View style={styles.group}>
              <Text variant="body" tone="secondary">
                {t('join.sent')}
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
              <Button title={t('join.confirm')} onPress={() => void confirm()} loading={busy} disabled={busy || code.trim().length < 4} />
              <Button title={t('join.again')} variant="tertiary" onPress={() => void askForCode()} disabled={busy} />
            </View>
          ) : null}

          {step === 'done' && result ? (
            <View style={styles.group}>
              <InlineNotice tone={result.activated ? 'success' : 'info'}>
                {t(result.activated ? 'join.done.ready' : 'join.done.waiting', { business: result.business })}
              </InlineNotice>
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
