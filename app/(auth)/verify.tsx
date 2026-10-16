import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { AuthLanguageSwitch, Button, InlineNotice, TextField } from '../../components/ui';
import { Text } from '../../components/ui/Text';
import { useAuth } from '../../hooks/useAuth';
import { api, ApiError } from '../../lib/api-client';
import { toFriendlyError } from '../../lib/errors';
import { useTranslation } from '../../lib/i18n';
import { useColors } from '../../lib/design/theme';
import { space } from '../../lib/design/tokens';
import { ACCESS_CLOSED, LOGIN } from '../../lib/navigation/entry';
import { classifyError } from '../../lib/offline/classify';
import { forgetContinuation, readContinuation } from '../../lib/registration-session';
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
 *
 * An answer that does not arrive in time is not a wrong code: the request
 * reached the server, which may well have created the account, and the code
 * has then been spent. The screen says so, and offers sign-in with the
 * password the person just chose, for as long as it is open — never "That
 * code did not match" for that code: the server refuses a registration it has
 * already finished exactly as it refuses a wrong code, so confirming the same
 * code again cannot tell the two apart. A refusal — of the code, of a request
 * for one, or by the rate limit — is said in the person's own language, never
 * in the server's English.
 */
export default function VerifyScreen() {
  const { t, language } = useTranslation();
  const router = useRouter();
  const colors = useColors();
  const { adoptSession } = useAuth();
  const { destination } = useLocalSearchParams<{ destination?: string }>();

  const [code, setCode] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** The code whose answer was lost: the account may already exist, made with it. */
  const [lostCode, setLostCode] = useState<string | null>(null);
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
      // The language on screen now, so a code asked for again after switching arrives in the new one.
      await api.post('/auth/register/verify/start', { continuation, language });
      setWaitSeconds(RESEND_SECONDS);
      setFailure(null);
      if (isResend) setNotice(t('register.verify.sent', { destination: destination ?? '' }));
    } catch (e) {
      // An answer that did not arrive is not a refusal: the code may be on its way.
      const lost = classifyError(e).kind === 'timeout_uncertain';
      setNotice(lost ? t('register.verify.sendUnknown') : null);
      setFailure(lost ? null : refusal(e, 'register.verify.notSent'));
    }
  }

  /**
   * A request of the code check that did not go through, in the person's language — never the server's English: it
   * answers every refused code request with one sentence ("That registration cannot be continued.", or a code limit's
   * own), and its rate limit with a class name. The rate limit asks for a minute, no connection says so, and anything
   * else is `otherwise`.
   */
  function refusal(e: unknown, otherwise: 'register.verify.notSent' | 'auth.error.unknown'): string {
    if (e instanceof ApiError) return t(e.status === 429 ? 'register.verify.tooMany' : otherwise);
    return e instanceof TypeError ? toFriendlyError(e).body : t(otherwise);
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
    const sent = code.trim();
    try {
      const tokens = await api.post<AuthTokens>('/auth/register/verify/confirm', {
        continuation,
        code: sent,
      });

      // The session is real from here on. Everything after this point may fail
      // WITHOUT taking the account down with it.
      await adoptSession(tokens);
      await forgetContinuation();

      // A business created a moment ago has not started: the screen that says
      // so is the next thing to see, and the sign-in guard keeps it there until
      // the server opens the business. Nothing opens a browser.
      router.replace(ACCESS_CLOSED as never);
    } catch (e) {
      // Only the server says a code is wrong; a lost answer or no connection is not its verdict. Nor is its refusal of
      // the code whose answer was lost: the registration it made with that code is refused the same way.
      if (classifyError(e).kind === 'timeout_uncertain') setLostCode(sent);
      else if (e instanceof ApiError && e.status === 400) {
        if (sent !== lostCode) setFailure(t('register.verify.wrong'));
      } else setFailure(refusal(e, 'auth.error.unknown'));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: colors.surface.canvas }]}>
      <Stack.Screen options={{ headerShown: true, title: t('register.verify.title') }} />
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text variant="body" tone="secondary">
            {t('register.verify.sent', { destination: destination ?? '' })}
          </Text>

          <TextField
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

          {lostCode !== null ? (
            <View style={styles.group}>
              <InlineNotice tone="warning">{t('register.verify.timeout')}</InlineNotice>
              <Button title={t('auth.action.signIn')} onPress={() => router.replace(LOGIN as never)} />
            </View>
          ) : null}

          <View style={styles.group}>
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

            {/*
              Compact here: the screen inherits whatever was chosen on the
              previous one, and this exists only so an accidental selection is
              not a trap. Changing it does not touch the code already typed, the
              continuation, or the pending verification — it writes a preference
              and re-renders.
            */}
            <AuthLanguageSwitch compact />
          </View>
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
