import React, { useCallback, useState } from 'react';
import { displayName } from '../../lib/display-name';
import { View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { LegalPageButtons } from '../../components/legal/LegalPages';
import { AuthPage } from '../../components/auth/AuthChrome';
import { AuthLanguageSwitch, Button, Card, Field, InlineNotice, Text } from '../../components/ui';
import { useAuth } from '../../hooks/useAuth';
import { ApiError } from '../../lib/api-client';
import { useTranslation } from '../../lib/i18n';
import { looksSubmittable } from '../../lib/identifier';
import { forgetContinuation } from '../../lib/registration-session';
import type { AccountChoice } from '../../types/api';
import { classifyLoginFailure, type LoginFailureKind } from '../../lib/sign-in-decision';
import { makeStyles } from '../../lib/design/theme';
import { space } from '../../lib/design/tokens';

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
  const styles = useStyles();
  const { t, language } = useTranslation();
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

  // Whoever is at sign-in is not in the middle of a code check: a registration left unfinished takes its
  // continuation with it (`lib/registration-session.ts`).
  useFocusEffect(
    useCallback(() => {
      void forgetContinuation();
    }, []),
  );

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
    <AuthPage
      footer={
        <>
          {/*
            Below the task and apart from it: the way out of a language somebody cannot read, then what the app does
            with a person's information, the terms, help and how deletion works — readable before signing in, in the
            phone's own browser. Pages to read: none leads to a price or a sign-up.
          */}
          <AuthLanguageSwitch />
          <LegalPageButtons />
        </>
      }
    >
      <View style={styles.heading}>
        <Text variant="title" accessibilityRole="header">
          {choice ? t('auth.choose.title') : t('auth.subtitle')}
        </Text>
        <Text variant="caption" tone="tertiary">
          {t('auth.byline')}
        </Text>
      </View>

      {choice ? (
        /*
          The password already matched — every shop listed here is genuinely
          theirs. The alternative the product rules out is asking for a
          Store ID up front, which would put this rare case's cost on
          everybody, every day.
        */
        <Card padding="lg" style={styles.form}>
          <Text variant="label" tone="secondary">
            {t('auth.choose.body')}
          </Text>
          {choice.accounts.map((a) => (
            <Button
              key={a.accountRef}
              title={displayName({ name: a.companyName, nameAr: a.companyNameAr }, language)}
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
        </Card>
      ) : (
        <>
          {/* The task: one surface, two fields and the one primary action. */}
          <Card padding="lg" style={styles.form}>
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
              style={styles.submit}
            />
          </Card>

          {/*
            The other ways in, apart from the sign-in surface so none of them is
            mistaken for it.

            A clear SECONDARY action (restored 2026-10-13). Somebody whose
            business has no account yet has somewhere to go from this screen,
            on this phone: the form is a screen of this app, never a browser,
            and a server that cannot send its code says so before anything
            is saved.
          */}
          <View style={styles.others}>
            <Button
              title={t('auth.action.createAccount')}
              variant="secondary"
              onPress={() => router.push('/(auth)/register' as never)}
            />
            {/*
              Who does not sign up here: an employee's account is created by
              the business owner, in Team. One honest sentence, so staff do not
              start a second business by mistake. No price, no link.
            */}
            <Text variant="caption" tone="secondary" align="center" style={styles.managed}>
              {t('auth.accounts.managed')}
            </Text>
            <View style={styles.links}>
              {/*
                The employee's own way in (D213): prove the contact the Owner gave, agree to WhatsApp messages on this
                phone if it is a number, and choose a password.
              */}
              <Button title={t('auth.action.join')} variant="tertiary" onPress={() => router.push('/(auth)/join' as never)} />
              {/*
                An Owner whose business the platform created (D217): the one-time setup code the platform handed over
                privately, and a password of their own. Nothing is sent to them.
              */}
              <Button title={t('auth.action.setup')} variant="tertiary" onPress={() => router.push('/(auth)/setup' as never)} />
            </View>
          </View>
        </>
      )}
    </AuthPage>
  );
}

const useStyles = makeStyles(() => ({
  heading: {
    gap: space.xs,
  },
  form: {
    gap: space.base,
  },
  submit: {
    marginTop: space.xs,
  },
  others: {
    gap: space.md,
  },
  managed: {
    marginTop: space.xs,
  },
  links: {
    gap: space.xs,
  },
}));
