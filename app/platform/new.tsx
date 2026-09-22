import React, { useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Button, Card, InlineNotice, Screen, SegmentedControl, Text, TextField } from '../../components/ui';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { toErrorMessage } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { LANGUAGES, LANGUAGE_LABELS, useTranslation, type Language } from '../../lib/i18n';
import { toast } from '../../lib/toast';
import { platformApi, usePlatformGuard, type OwnerInvitation } from '../../lib/platform-admin';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Creating a business for a shop, at the counter or over the phone.
 *
 * The same provisioning as a self-service registration, minus the password:
 * nobody chooses one here. The server hands back a one-time invitation, shown
 * once, which the Owner spends to set their own. Approval is a separate act
 * on the business's own screen — creating grants nothing.
 *
 * The idempotency key is minted once per form, so a retry after a dropped
 * answer recognises the business it already made rather than making a second.
 */
export default function PlatformNewBusiness() {
  const styles = useStyles();
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const session = usePlatformGuard();
  // Minted on the first submit, not during render; one key for the life of the form.
  const key = useRef<string | null>(null);

  const [businessName, setBusinessName] = useState('');
  const [branchName, setBranchName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [language, setLanguage] = useState<Language>('fr');
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ companyId: string; invitation: OwnerInvitation | null } | null>(null);

  if (!session) return null;

  const ready =
    businessName.trim().length > 0 &&
    ownerName.trim().length > 0 &&
    (email.trim().length > 0 || phone.trim().length > 0) &&
    reason.trim().length >= 3 &&
    password.length > 0;

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    if (!key.current) key.current = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      const result = await platformApi.createBusiness({
        idempotencyKey: key.current,
        businessName: businessName.trim(),
        branchName: branchName.trim() || undefined,
        ownerName: ownerName.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        city: city.trim() || undefined,
        language,
        reason: reason.trim(),
        confirmPassword: password,
      });
      setCreated({ companyId: result.companyId, invitation: result.invitation });
      await qc.invalidateQueries({ queryKey: ['platform'] });
      toast.success(t('platform.new.created'));
    } catch (e) {
      toast.error(toErrorMessage(e));
    } finally {
      setPassword('');
      setBusy(false);
    }
  };

  return (
    <Screen scroll={false}>
      <Stack.Screen options={{ headerShown: true, title: t('platform.new.title') }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {created ? (
          <Card variant="warning" style={styles.list}>
            <Text variant="heading">{t('platform.invite.title')}</Text>
            {created.invitation ? (
              <>
                <Text variant="caption" tone="secondary">
                  {t('platform.invite.body', { expires: formatDateTime(created.invitation.expiresAt) })}
                </Text>
                <Text variant="mono" selectable>
                  {created.invitation.token}
                </Text>
                <Button
                  title={t('platform.invite.copy')}
                  size="sm"
                  onPress={() => {
                    void Clipboard.setStringAsync(created.invitation!.token).then(() => toast.success(t('platform.invite.copied')));
                  }}
                />
              </>
            ) : (
              <InlineNotice tone="info">{t('platform.new.created')}</InlineNotice>
            )}
            <Button title={t('platform.new.open')} variant="secondary" onPress={() => router.replace(`/platform/${created.companyId}` as never)} />
          </Card>
        ) : (
          <>
            <TextField label={t('platform.new.businessName')} value={businessName} onChangeText={setBusinessName} required />
            <TextField label={t('platform.new.branchName')} value={branchName} onChangeText={setBranchName} />
            <TextField label={t('platform.new.ownerName')} value={ownerName} onChangeText={setOwnerName} required />
            <TextField
              label={t('platform.new.email')}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TextField
              label={t('platform.new.phone')}
              hint={t('platform.new.contactHint')}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />
            <TextField label={t('platform.new.city')} value={city} onChangeText={setCity} />
            <View style={styles.list}>
              <Text variant="label" tone="secondary">
                {t('platform.new.language')}
              </Text>
              <SegmentedControl
                options={LANGUAGES.map((l) => ({ value: l, label: LANGUAGE_LABELS[l] }))}
                value={language}
                onChange={setLanguage}
                size="sm"
              />
            </View>
            <TextField
              label={t('platform.form.reason')}
              hint={t('platform.form.reasonHint')}
              value={reason}
              onChangeText={setReason}
              required
              multiline
            />
            <TextField
              label={t('platform.form.password')}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
            />
            <Button title={t('platform.new.create')} onPress={() => void submit()} disabled={!ready || busy} loading={busy} />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  content: { gap: space.base, paddingBottom: space['3xl'] },
  list: { gap: space.sm },
}));
