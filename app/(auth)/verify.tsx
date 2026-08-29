import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Button, Field } from '../../components/ui';
import { Text } from '../../components/ui/Text';
import { useAuth } from '../../hooks/useAuth';
import { api, ApiError } from '../../lib/api-client';
import { useTranslation } from '../../lib/i18n';
import { useColors } from '../../lib/design/theme';
import { forgetContinuation, readContinuation } from '../../lib/registration-session';
import { openAccountPortal } from '../../lib/portal';
import type { AuthTokens } from '../../types/api';

/** How long before the code may be asked for again. Presentation only. */
const RESEND_SECONDS = 60;

/**
 * Proving the contact, and finishing the registration.
 *
 * The code proves **this attempt**, not the address. The continuation held in
 * secure storage names the exact challenge that was sent for it, and the server
 * refuses anything else — a code from another attempt, a code for the same
 * address proved last week, a code that has already been spent.
 *
 * On success the server issues an ordinary session, the same kind a password
 * sign-in produces. The registration password is never replayed to obtain it,
 * and by this point it is no longer in memory.
 */
export default function VerifyScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const colors = useColors();
  const { adoptSession } = useAuth();
  const { destination } = useLocalSearchParams<{ destination?: string }>();

  const [code, setCode] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [waitSeconds, setWaitSeconds] = useState(RESEND_SECONDS);

  const inFlight = useRef(false);
  const sent = useRef(false);

  // Ask for the code once, on arrival. A second request here would burn a
  // resend allowance the person has not asked to spend.
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    void requestCode(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (waitSeconds <= 0) return;
    const id = setTimeout(() => setWaitSeconds((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [waitSeconds]);

  async function requestCode(isResend: boolean) {
    const continuation = await readContinuation();
    if (!continuation) {
      setFailure(t('register.failed'));
      return;
    }
    try {
      await api.post('/platform/register/verify/start', { continuation, language: 'en' });
      setWaitSeconds(RESEND_SECONDS);
      if (isResend) setNotice(t('register.verify.sent', { destination: destination ?? '' }));
    } catch (e) {
      setFailure(e instanceof ApiError && e.message ? e.message : t('register.failed'));
    }
  }

  async function confirm() {
    if (inFlight.current || !code.trim()) return;
    const continuation = await readContinuation();
    if (!continuation) {
      setFailure(t('register.failed'));
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    setFailure(null);
    try {
      const tokens = await api.post<AuthTokens>('/platform/register/verify/confirm', {
        continuation,
        code: code.trim(),
      });

      // The session is real from here on. Everything after this point may fail
      // WITHOUT taking the account down with it.
      await adoptSession(tokens);
      await forgetContinuation();

      /*
       * The portal is opened as a convenience, not as a step that can fail the
       * registration. If the browser refuses, the account still exists, the
       * session is still valid, and the pending screen offers to try again.
       */
      await openAccountPortal();
      router.replace('/subscription-blocked' as never);
    } catch (e) {
      setFailure(e instanceof ApiError && e.message ? e.message : t('register.verify.wrong'));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: colors.surface.canvas }}>
      <Stack.Screen options={{ headerShown: true, title: t('register.verify.title') }} />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerClassName="p-5 gap-5" keyboardShouldPersistTaps="handled">
          <Text variant="body" tone="secondary">
            {t('register.verify.sent', { destination: destination ?? '' })}
          </Text>
          <Text variant="caption" tone="secondary">
            {t('register.verify.staging')}
          </Text>

          <Field
            label={t('register.verify.code')}
            value={code}
            onChangeText={(v) => {
              setCode(v);
              setFailure(null);
            }}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            maxLength={12}
            error={failure ?? undefined}
          />

          {notice ? (
            <Text variant="caption" tone="secondary">
              {notice}
            </Text>
          ) : null}

          <View className="gap-3">
            <Button
              title={t('register.verify.confirm')}
              onPress={() => void confirm()}
              loading={submitting}
              disabled={submitting || !code.trim()}
            />
            <Button
              title={
                waitSeconds > 0
                  ? t('register.verify.resendWait', { seconds: waitSeconds })
                  : t('register.verify.resend')
              }
              variant="secondary"
              onPress={() => void requestCode(true)}
              disabled={submitting || waitSeconds > 0}
            />
            <Button
              title={t('register.verify.change')}
              variant="tertiary"
              onPress={() => {
                // Restarting is explicit, and takes the credential with it.
                void forgetContinuation();
                router.replace('/(auth)/register' as never);
              }}
              disabled={submitting}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
