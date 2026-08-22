import React, { useState } from 'react';
import { View, Text, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Store } from 'lucide-react-native';
import { Button, Field } from '../../components/ui';
import { useAuth } from '../../hooks/useAuth';
import { ApiError } from '../../lib/api-client';
import { useTranslation } from '../../lib/i18n';
import { looksSubmittable } from '../../lib/identifier';
import type { AccountChoice } from '../../types/api';
import { classifyLoginFailure, type LoginFailureKind } from '../../lib/sign-in-decision';
import { colors } from '../../lib/theme';

/**
 * Signing in (CP3).
 *
 * One identifier and a password. Nothing else.
 *
 * The Store ID field is gone, and so are the demo values that used to sit in
 * it: the screen shipped with a real store code and the login `owner` as
 * placeholders, which is both a credential hint in the bundle and a promise
 * that the app is a demo. A shopkeeper should not have to know their
 * business's identifier to reach their own till — the server works out which
 * shop they belong to from the credential itself.
 *
 * The field takes either a phone number or the generated personal ID, and the
 * app deliberately does not try to tell which: guessing here would let it
 * refuse something the server would have accepted, and the person holding the
 * phone would have no way to argue with it.
 */
export default function Login() {
  const { t } = useTranslation();
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
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View className="flex-1 justify-center px-6">
          <View className="mb-8 items-center">
            <View className="h-16 w-16 items-center justify-center rounded-2xl bg-brand-600">
              <Store color="#fff" size={30} />
            </View>
            <Text className="mt-4 text-2xl font-bold text-slate-900">{t('auth.title')}</Text>
            <Text className="mt-1 text-slate-500">{t('auth.subtitle')}</Text>
          </View>

          {choice ? (
            /*
              The password already matched — every shop listed here is genuinely
              theirs. The alternative the product rules out is asking for a
              Store ID up front, which would put this rare case's cost on
              everybody, every day.
            */
            <View className="gap-4">
              <Text className="text-center text-base font-semibold text-slate-900">
                {t('auth.choose.title')}
              </Text>
              <Text className="text-center text-sm text-slate-500">{t('auth.choose.body')}</Text>
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
                <Text className="text-center text-sm text-red-600">{inlineError}</Text>
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
          <View className="gap-4">
            <Field
              label={t('auth.field.identifier')}
              hint={t('auth.field.identifier.hint')}
              /*
                A general keyboard, NOT a phone pad: the same field has to accept
                an alphanumeric personal ID, and a numeric keyboard would make
                that impossible to type.
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
              <View className="rounded-xl border border-amber-300 bg-amber-50 p-4">
                <Text className="text-center text-base font-semibold text-amber-900">
                  {t('auth.device.title')}
                </Text>
                <Text className="mt-2 text-center text-sm leading-5 text-amber-800">
                  {t('auth.device.body')}
                </Text>
              </View>
            ) : inlineError ? (
              <Text className="text-center text-sm text-red-600">{inlineError}</Text>
            ) : null}

            <Button
              title={t('auth.action.signIn')}
              onPress={onSubmit}
              loading={loading}
              disabled={!canSubmit || loading}
            />
          </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
