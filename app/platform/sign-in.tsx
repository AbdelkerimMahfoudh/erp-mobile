import React, { useState } from 'react';
import { View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { ShieldCheck } from 'lucide-react-native';
import { AuthLanguageSwitch, Button, InlineNotice, Screen, Text, TextField } from '../../components/ui';
import { space } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';
import { useTranslation } from '../../lib/i18n';
import { platformApi, usePlatformSession } from '../../lib/platform-admin';

/**
 * The platform administrator signs in.
 *
 * A different credential from a different table: a shop's email and password
 * are refused here, and nothing about a shop's session is read or written. One
 * generic refusal for every failure, as the server answers.
 */
export default function PlatformSignIn() {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const router = useRouter();
  const start = usePlatformSession((s) => s.start);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const result = await platformApi.signIn(email.trim(), password);
      start({ admin: result.admin, expiresAt: result.expiresAt, sessionToken: result.sessionToken ?? null });
      setPassword('');
      router.replace('/platform' as never);
    } catch {
      // Unknown address, wrong password, disabled administrator, no network:
      // one answer, as the server gives one.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen gap="base">
      <Stack.Screen options={{ headerShown: true, title: t('platform.signIn.title') }} />
      <View style={styles.brand}>
        <ShieldCheck size={28} color={colors.text.secondary} />
        <Text variant="body" tone="secondary" align="center">
          {t('platform.signIn.note')}
        </Text>
      </View>
      <TextField
        label={t('platform.signIn.email')}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
      />
      <TextField
        label={t('platform.signIn.password')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        onSubmitEditing={() => void submit()}
      />
      {failed ? <InlineNotice tone="danger">{t('platform.signIn.failed')}</InlineNotice> : null}
      <Button
        title={t('platform.signIn.action')}
        onPress={() => void submit()}
        loading={busy}
        disabled={busy || !email.trim() || !password}
      />
      <AuthLanguageSwitch compact />
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  brand: { alignItems: 'center', gap: space.sm, paddingVertical: space.lg },
}));
