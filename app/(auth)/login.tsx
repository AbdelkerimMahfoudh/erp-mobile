import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Store } from 'lucide-react-native';
import { AuthLanguageSwitch, Button, Field, InlineNotice, Text } from '../../components/ui';
import { useAuth } from '../../hooks/useAuth';
import { ApiError } from '../../lib/api-client';
import { useTranslation } from '../../lib/i18n';
import { looksSubmittable } from '../../lib/identifier';
import type { AccountChoice } from '../../types/api';
import { classifyLoginFailure, type LoginFailureKind } from '../../lib/sign-in-decision';
import { makeStyles, useColors } from '../../lib/design/theme';
import { radius, space } from '../../lib/design/tokens';

/**
 * Signing in.
 *
 * One identifier and a password. Nothing else.
 *
 * The identifier is an **email address or a WhatsApp number** — something the
 * person already knows, rather than a code the product invented and asked them
 * to keep. No Store ID, no branch, no company, no generated personal ID and no
 * username: a shopkeeper should not have to know their business's identifier
 * to reach their own till, and the server works out which shop they belong to
 * from the credential itself.
 *
 * The app deliberately does not try to tell which of the two was typed.
 * Guessing here would let it refuse something the server would have accepted,
 * and the person holding the phone would have no way to argue with it. The
 * server classifies; the screen just sends what was typed.
 *
 * "WhatsApp number" is what a shop calls the number they are reachable on. It
 * is a label, not a claim — nothing here verifies that the number is
 * registered with WhatsApp, because nothing can yet.
 */
export default function Login() {
  const colors = useColors();
  const styles = useStyles();
  const { t } = useTranslation();
  const router = useRouter();
  const { signIn, chooseAccount } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [failure, setFailure] = useState<LoginFailureKind | null>(null);
  const [loading, setLoading] = useState(false);
  /*
    Set only when the server says one phone number belongs to a person at more
    than one shop — which it can only know after the password matched. Holding
    it swaps the form for the shop list; it carries no token and expires on its
    own, so an abandoned attempt simply stops working.
  */
  const [choice, setChoice] = useState<AccountChoice | null>(null);
  /*
    Opening a browser is slow enough that an impatient second tap is the
    normal case, and two taps would open two browser sessions on top of each
    other. The guard is state rather than a debounce timer so it survives
    however long the handoff takes.
  */

  const onSubmit = async () => {
    if (loading) return;
    setFailure(null);
    setLoading(true);
    try {
      const ambiguous = await signIn(identifier.trim(), password);
      if (ambiguous) setChoice(ambiguous);
    } catch (e) {
      // A fail-closed device error is NEVER auto-recovered here (Stage 3.2): it
      // maps to a blocking verification state, not a silent retry, and the
      // stored credential is left untouched.
      setFailure(
        classifyLoginFailure({
          code: e instanceof ApiError ? e.code : undefined,
          status: e instanceof ApiError ? e.status : undefined,
          isNetworkError: !(e instanceof ApiError),
        }),
      );
    } finally {
      setLoading(false);
    }
  };

  const onChoose = async (accountRef: string) => {
    if (loading) return;
    setFailure(null);
    setLoading(true);
    try {
      await chooseAccount(choice!, accountRef);
    } catch (e) {
      // An expired or refused continuation sends them back to the form rather
      // than leaving a dead list on screen with nothing that works.
      setChoice(null);
      setPassword('');
      setFailure(
        classifyLoginFailure({
          code: e instanceof ApiError ? e.code : undefined,
          status: e instanceof ApiError ? e.status : undefined,
          isNetworkError: !(e instanceof ApiError),
        }),
      );
    } finally {
      setLoading(false);
    }
  };

  /**
   * Creating an account is a screen in this app now, not a website.
   *
   * It used to open a browser. Setting a shop up means scanning stock, scanning
   * happens here, and sending somebody to a browser to type the longest form in
   * the product was never the shorter path.
   */
  const onCreateAccount = () => {
    router.push('/(auth)/register' as never);
  };

  const inlineError =
    failure === 'network'
      ? t('auth.error.network')
      : failure === 'auth_failed'
        ? t('auth.error.failed')
        : failure === 'unknown'
          ? t('auth.error.unknown')
          : null;

  const canSubmit = looksSubmittable(identifier) && password.length > 0;

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
        <View style={styles.page}>
          <View style={styles.brand}>
            <View style={styles.logo}>
              <Store color={colors.text.inverse} size={30} />
            </View>
            <Text variant="title" align="center" accessibilityRole="header">
              {t('auth.title')}
            </Text>
            <Text variant="body" tone="secondary" align="center">
              {t('auth.subtitle')}
            </Text>
          </View>

          {choice ? (
            /*
              The password already matched — every shop listed here is genuinely
              theirs. The alternative the product rules out is asking for a
              Store ID up front, which would put this rare case's cost on
              everybody, every day.
            */
            <View style={styles.stack}>
              <Text variant="heading" align="center">
                {t('auth.choose.title')}
              </Text>
              <Text variant="label" tone="secondary" align="center">
                {t('auth.choose.body')}
              </Text>
              {choice.accounts.map((a) => (
                <Button
                  key={a.accountRef}
                  title={a.companyName}
                  variant="secondary"
                  disabled={loading}
                  onPress={() => void onChoose(a.accountRef)}
                />
              ))}
              {inlineError ? (
                <Text variant="label" tone="danger" align="center">
                  {inlineError}
                </Text>
              ) : null}
              <Button
                title={t('auth.choose.cancel')}
                variant="ghost"
                disabled={loading}
                onPress={() => {
                  setChoice(null);
                  setPassword('');
                }}
              />
            </View>
          ) : (
            <View style={styles.stack}>
              <Field
                label={t('auth.field.identifier')}
                hint={t('auth.field.identifier.hint')}
                /*
                  A general keyboard, NOT a phone pad: the same field has to
                  accept an email address, and a numeric keyboard would make that
                  impossible to type. `email-address` is wrong for the same
                  reason in reverse — it would make the number awkward.
                */
                keyboardType="default"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                textContentType="username"
                value={identifier}
                onChangeText={setIdentifier}
              />
              <Field
                label={t('auth.field.password')}
                /* Field renders its own show/hide control for a secure input. */
                secureTextEntry
                autoComplete="current-password"
                textContentType="password"
                value={password}
                onChangeText={setPassword}
                onSubmitEditing={onSubmit}
              />

              {/* Blocking, translated device-verification state. No Continue /
                  Retry as new device / Send code action — none of those exist. */}
              {failure === 'device_verification_required' ? (
                <InlineNotice tone="warning" title={t('auth.device.title')}>
                  {t('auth.device.body')}
                </InlineNotice>
              ) : inlineError ? (
                <Text variant="label" tone="danger" align="center">
                  {inlineError}
                </Text>
              ) : null}

              <Button
                title={t('auth.action.signIn')}
                onPress={onSubmit}
                loading={loading}
                disabled={!canSubmit || loading}
              />

              {/*
                A clear SECONDARY action. Somebody whose shop has no account
                yet currently has nowhere to go from this screen at all, and
                the answer to "how do I get one" should not be a phone call.
              */}
              <Button
                title={t('auth.action.createAccount')}
                variant="secondary"
                onPress={onCreateAccount}
              />

              {/*
                Last on the screen, and the first thing somebody needs.

                A person handed a phone in a language they cannot read cannot sign
                in to change the language, and could not change the language
                without signing in — the setting lived behind this screen. It sits
                below the actions because it is not the task; it is the way out of
                being unable to start the task.
              */}
              <AuthLanguageSwitch />
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  safe: {
    flex: 1,
    backgroundColor: colors.surface.canvas,
  },
  fill: {
    flex: 1,
  },
  page: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  brand: {
    alignItems: 'center',
    gap: space.xs,
    marginBottom: space['2xl'],
  },
  logo: {
    width: 64,
    height: 64,
    borderRadius: radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.intent.info.solid,
    marginBottom: space.md,
  },
  stack: {
    gap: space.base,
  },
}));