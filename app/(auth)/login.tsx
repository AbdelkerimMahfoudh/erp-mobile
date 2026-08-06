import React, { useState } from 'react';
import { View, Text, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Store } from 'lucide-react-native';
import { Button, Field } from '../../components/ui';
import { useAuth } from '../../hooks/useAuth';
import { ApiError } from '../../lib/api-client';
import { useTranslation } from '../../lib/i18n';
import { classifyLoginFailure, type LoginFailureKind } from '../../lib/sign-in-decision';
import { colors } from '../../lib/theme';

export default function Login() {
  const { t } = useTranslation();
  const { signIn } = useAuth();
  const [login, setLogin] = useState('owner');
  const [password, setPassword] = useState('');
  const [failure, setFailure] = useState<LoginFailureKind | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    setFailure(null);
    setLoading(true);
    try {
      await signIn(login.trim(), password);
    } catch (e) {
      // A fail-closed device error is NEVER auto-recovered here (Stage 3.2): it
      // maps to a blocking verification state, not a silent retry, and the stored
      // credential is left untouched.
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

          <View className="gap-4">
            <Field
              label={t('auth.field.login')}
              autoCapitalize="none"
              autoCorrect={false}
              value={login}
              onChangeText={setLogin}
              placeholder="owner"
            />
            <Field
              label={t('auth.field.password')}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              onSubmitEditing={onSubmit}
            />

            {/* Blocking, translated device-verification state. No Continue / Retry
                as new device / Send code action — none of those exist yet. */}
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

            <Button title={t('auth.action.signIn')} onPress={onSubmit} loading={loading} disabled={!login || !password} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
