import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { AuthLanguageSwitch, Button, InlineNotice, TextField } from '../../components/ui';
import { Text } from '../../components/ui/Text';
import { api, ApiError } from '../../lib/api-client';
import { toFriendlyError } from '../../lib/errors';
import { useTranslation } from '../../lib/i18n';
import { useColors } from '../../lib/design/theme';
import { space } from '../../lib/design/tokens';
import { LOGIN } from '../../lib/navigation/entry';

/** The server's minimum (OWNER_PASSWORD_MIN_LENGTH): said before anything is sent. */
const PASSWORD_MIN = 8;

interface SetupResult {
  publicStoreId: string;
  businessName: string;
}

/**
 * An Owner's first password, from the one-time setup code the platform handed them (0075, D217).
 *
 * A business the platform created has an Owner whose password nobody knows. The platform's administrator gave the Owner
 * a setup code privately; the Owner pastes it here and chooses their own password, once. Nothing is sent to the
 * Owner's number and nothing about it is verified here: the code and the password are the whole exchange. The code
 * opens no session — the Owner then signs in like anybody else.
 *
 * Every unusable code — unknown, expired, used, replaced, or for a business the platform has not opened yet — reads the
 * same: ask the platform for a new one.
 */
export default function OwnerSetupScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const colors = useColors();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [codeProblem, setCodeProblem] = useState<string | null>(null);
  const [passwordProblem, setPasswordProblem] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SetupResult | null>(null);

  const submit = async () => {
    if (busy) return;
    setFailure(null);
    const token = code.replace(/\s+/g, '');
    if (token.length < 16) {
      setCodeProblem(t('setup.problem.code'));
      return;
    }
    if (password.length < PASSWORD_MIN) {
      setPasswordProblem(t('setup.problem.password'));
      return;
    }
    setBusy(true);
    try {
      const done = await api.post<SetupResult>('/auth/owner-setup', { token, password });
      setResult(done);
      setCode('');
      setPassword('');
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) setCodeProblem(t('setup.unavailable'));
      else setFailure(toFriendlyError(e).body);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: colors.surface.canvas }]}>
      <Stack.Screen options={{ headerShown: true, title: t('setup.title') }} />
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'web' ? 'none' : 'on-drag'}>
          {result ? (
            <View style={styles.group}>
              <InlineNotice tone="success">{t('setup.done', { business: result.businessName })}</InlineNotice>
              <Button title={t('setup.signIn')} onPress={() => router.replace(LOGIN as never)} />
            </View>
          ) : (
            <View style={styles.group}>
              <Text variant="body" tone="secondary">
                {t('setup.subtitle')}
              </Text>
              <TextField
                label={t('setup.field.code')}
                hint={t('setup.field.code.hint')}
                value={code}
                onChangeText={(v) => {
                  setCode(v);
                  setCodeProblem(null);
                  setFailure(null);
                }}
                autoCapitalize="none"
                autoCorrect={false}
                variant="identifier"
                maxLength={200}
                error={codeProblem ?? undefined}
              />
              <TextField
                label={t('setup.field.password')}
                hint={t('setup.field.password.hint')}
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
              <Button title={t('setup.confirm')} onPress={() => void submit()} loading={busy} disabled={busy} />
            </View>
          )}
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
