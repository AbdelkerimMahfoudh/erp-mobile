import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleUserRound, ShieldCheck, Smartphone, Trash2 } from 'lucide-react-native';
import {
  Button,
  Card,
  Chip,
  ErrorState,
  InlineNotice,
  ListRow,
  RowGroup,
  Screen,
  Section,
  SkeletonList,
  Text,
  TextField,
} from '../../components/ui';
import { api, ApiError } from '../../lib/api-client';
import { space } from '../../lib/design/tokens';
import { toFriendlyError } from '../../lib/errors';
import { getLanguage, useTranslation } from '../../lib/i18n';
import { qk } from '../../lib/query-keys';
import { toast } from '../../lib/toast';
import type { AccountView, PhoneVerificationStart } from '../../types/api';

/**
 * Your account (docs/64).
 *
 * Who you are, the WhatsApp number your security codes go to, and the way to
 * delete the account. Reachable in every subscription state — a pending or
 * suspended shop still has people who must be able to verify a number, see
 * where a deletion stands, and leave.
 *
 * Everything shown comes from the server: whether the number is verified,
 * what deleting would delete (a login, or the whole business), whether a
 * deletion is already under way. The screen derives none of it.
 */
export default function AccountScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const header = <Stack.Screen options={{ headerShown: true, title: t('account.title') }} />;

  const query = useQuery({ queryKey: qk.account, queryFn: () => api.get<AccountView>('/account') });

  if (query.isLoading) {
    return (
      <Screen>
        {header}
        <SkeletonList count={3} />
      </Screen>
    );
  }
  if (query.isError || !query.data) {
    return (
      <Screen>
        {header}
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </Screen>
    );
  }

  const me = query.data;
  const deletionOpen = me.deletion && me.deletion.status === 'awaiting_code';

  return (
    <Screen gap="xl">
      {header}

      <Card style={styles.card}>
        <View style={styles.identity}>
          <CircleUserRound size={28} />
          <View style={styles.identityText}>
            <Text variant="bodyStrong">{me.name}</Text>
            <Text variant="caption" tone="secondary">
              {t('account.identity.personalId')}: <Text variant="caption">{me.personalId}</Text>
            </Text>
          </View>
        </View>
      </Card>

      <Section title={t('account.whatsapp.title')}>
        <WhatsAppSection me={me} />
      </Section>

      <Section title={t('account.delete.title')}>
        <RowGroup>
          <ListRow
            flat
            title={t('account.delete.row')}
            subtitle={
              deletionOpen
                ? t('account.delete.pending')
                : me.deletionKind === 'company_closure'
                  ? t('account.delete.rowBusiness')
                  : t('account.delete.rowLogin')
            }
            leading={Trash2}
            accessory={deletionOpen ? <Chip tone="warning" label={t('account.delete.pendingChip')} dot /> : undefined}
            onPress={() => router.push('/account/delete' as never)}
          />
        </RowGroup>
        <Text variant="caption" tone="tertiary">
          {t('account.delete.rowHint')}
        </Text>
      </Section>
    </Screen>
  );
}

/**
 * The verified WhatsApp number, or the way to prove one.
 *
 * Two steps, both on the server's terms: the password again and the number
 * (a code goes to THAT number, nothing is written yet), then the code. The
 * number becomes the verified one only when the code comes back.
 */
function WhatsAppSection({ me }: { me: AccountView }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<PhoneVerificationStart | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const reset = () => {
    setEditing(false);
    setPhone('');
    setPassword('');
    setCode('');
    setChallenge(null);
    setProblem(null);
  };

  const explain = (e: unknown): string => {
    if (e instanceof ApiError) {
      switch (e.code) {
        case 'reauthentication_failed':
          return t('account.wrongPassword');
        case 'invalid_phone':
          return t('account.whatsapp.invalid');
        case 'phone_in_use':
          return t('account.whatsapp.inUse');
        case 'already_verified':
          return t('account.whatsapp.alreadyVerified');
        case 'too_many_codes':
          return t('account.code.tooMany');
        case 'code_undeliverable':
          return t('account.whatsapp.undeliverable');
        case 'verification_unavailable':
          return t('account.unavailable');
        case 'invalid_code': {
          const left = (e.body as { attemptsRemaining?: number } | undefined)?.attemptsRemaining;
          return t('account.code.wrong', { left: String(left ?? '') });
        }
        case 'code_expired':
          return t('account.code.expired');
        case 'too_many_attempts':
          return t('account.code.locked');
        case 'code_not_active':
          return t('account.code.notActive');
      }
    }
    return toFriendlyError(e).body;
  };

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const started = await api.post<PhoneVerificationStart>('/account/whatsapp/verify/start', {
        phone,
        password,
        language: getLanguage(),
      });
      setChallenge(started);
      setPassword('');
    } catch (e) {
      setProblem(explain(e));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (busy || !challenge) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.post('/account/whatsapp/verify/confirm', { challengeId: challenge.challengeId, code: code.trim() });
      toast.success(t('account.whatsapp.done'));
      reset();
      await queryClient.invalidateQueries({ queryKey: qk.account });
    } catch (e) {
      setProblem(explain(e));
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <View style={styles.stack}>
        <Card style={styles.card}>
          <View style={styles.identity}>
            <Smartphone size={22} />
            <View style={styles.identityText}>
              <Text variant="bodyStrong">{me.phone ?? t('account.whatsapp.noNumber')}</Text>
              {me.whatsappVerified ? (
                <Chip tone="success" label={t('account.whatsapp.verified')} size="sm" dot />
              ) : (
                <Chip tone="warning" label={t('account.whatsapp.notVerified')} size="sm" dot />
              )}
            </View>
          </View>
        </Card>
        {!me.whatsappVerified ? (
          <InlineNotice tone="warning" icon={ShieldCheck}>
            {t('account.whatsapp.none')}
          </InlineNotice>
        ) : null}
        <Button
          title={me.whatsappVerified ? t('account.whatsapp.change') : t('account.whatsapp.verify')}
          variant={me.whatsappVerified ? 'secondary' : 'primary'}
          onPress={() => setEditing(true)}
        />
      </View>
    );
  }

  if (challenge) {
    return (
      <View style={styles.stack}>
        <Text tone="secondary">{t('account.whatsapp.sent', { destination: challenge.destinationMasked })}</Text>
        <TextField
          label={t('account.whatsapp.code')}
          value={code}
          onChangeText={(v) => {
            setCode(v);
            setProblem(null);
          }}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          maxLength={6}
          variant="identifier"
          error={problem ?? undefined}
        />
        <Button title={t('account.whatsapp.confirm')} onPress={() => void confirm()} loading={busy} disabled={code.trim().length !== 6} />
        <Button title={t('action.cancel')} variant="tertiary" onPress={reset} />
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      <TextField
        label={t('account.whatsapp.phone')}
        hint={t('account.whatsapp.phoneHint')}
        value={phone}
        onChangeText={(v) => {
          setPhone(v);
          setProblem(null);
        }}
        keyboardType="phone-pad"
        autoComplete="tel"
        variant="identifier"
      />
      <TextField
        label={t('account.whatsapp.password')}
        value={password}
        onChangeText={(v) => {
          setPassword(v);
          setProblem(null);
        }}
        secureTextEntry
        autoComplete="current-password"
        error={problem ?? undefined}
      />
      <Button
        title={t('account.whatsapp.send')}
        onPress={() => void start()}
        loading={busy}
        disabled={phone.trim().length < 4 || password.length === 0}
      />
      <Button title={t('action.cancel')} variant="tertiary" onPress={reset} />
    </View>
  );
}

/** Keeps a countdown honest to the server's own resend instant. */
export function useCountdown(until: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [until]);
  if (!until) return 0;
  return Math.max(0, Math.ceil((new Date(until).getTime() - now) / 1000));
}

const styles = StyleSheet.create({
  card: { padding: space.md },
  identity: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  identityText: { flex: 1, gap: space.xs },
  stack: { gap: space.md },
});
