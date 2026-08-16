import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Banknote, Check, Lock, Scale, Smartphone } from 'lucide-react-native';
import {
  Button,
  Card,
  Chip,
  Divider,
  ErrorState,
  InlineNotice,
  MoneyField,
  MoneyValue,
  Screen,
  Section,
  SkeletonList,
  Text,
  TextField,
} from '../components/ui';
import { ApiError } from '../lib/api-client';
import { useConnectivity } from '../lib/connectivity';
import { space } from '../lib/design/tokens';
import { useTranslation } from '../lib/i18n';
import { usePermission } from '../lib/permissions';
import {
  useOpenClosing,
  useRecordCount,
  useSignOffDay,
  type ChannelRow,
} from '../lib/closing';

/**
 * The daily closing, counted one channel at a time (Milestone E).
 *
 * The E0 audit found the old screen asked for a single cash figure and locked
 * the day in the same action — so an Employee holding the drawer could not
 * report a count at all, and a shop taking Bankily had no expected figure for
 * it. Both are now separate: counting records what is in front of you and locks
 * nothing; signing off is a distinct act by somebody accountable for the day.
 *
 * Everything on this screen is one number at a time, because that is how
 * counting actually happens — the drawer now, the account balance when the
 * agent answers. Losing the first because the second was interrupted is the
 * failure this replaces.
 */
export default function ClosingScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const offline = !useConnectivity((s) => s.online);
  const canCount = usePermission('closing.count');
  const canSignOff = usePermission('closing.perform');

  const view = useOpenClosing();
  const record = useRecordCount();
  const signOff = useSignOffDay();
  const [error, setError] = useState<string | null>(null);

  if (view.isLoading) return <Loading title={t('closing.title')} />;
  if (view.isError) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: t('closing.title') }} />
        <ErrorState error={view.error} onRetry={() => void view.refetch()} />
      </Screen>
    );
  }

  const day = view.data!;

  if (day.isLocked) {
    return (
      <Screen gap="base">
        <Stack.Screen options={{ headerShown: true, title: t('closing.title') }} />
        <View style={styles.doneHead}>
          <Lock size={32} />
          <Text variant="title">{t('closing.done.headline', { date: day.date })}</Text>
        </View>
        <InlineNotice tone="info">{t('closing.locked.body')}</InlineNotice>
        <Section title={t('closing.channels')}>
          <Card>
            {day.channels.map((c, i) => (
              <View key={`${c.channel}:${c.accountId ?? 'none'}`}>
                {i > 0 ? <Divider style={styles.divider} /> : null}
                <ChannelSummary channel={c} />
              </View>
            ))}
          </Card>
        </Section>
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <Stack.Screen options={{ headerShown: true, title: t('closing.title') }} />

      {offline ? <InlineNotice tone="warning">{t('closing.offline')}</InlineNotice> : null}
      {!canCount ? <InlineNotice tone="info">{t('closing.count.noPermission')}</InlineNotice> : null}
      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}

      <ScrollView contentContainerStyle={styles.list}>
        {/*
          What is left, said plainly. A count that is nearly finished and one
          that has not started look nothing alike, and the person counting
          should not have to work out which they are in.
        */}
        <InlineNotice tone={day.complete ? 'success' : 'info'}>
          {day.complete
            ? t('closing.progress.done')
            : t('closing.progress.remaining', { count: String(day.outstanding) })}
        </InlineNotice>

        {day.channels.map((channel) => (
          <ChannelCard
            key={`${channel.channel}:${channel.accountId ?? 'none'}`}
            channel={channel}
            disabled={!canCount || offline || record.isPending}
            onSubmit={(body) => {
              setError(null);
              record.mutate(body, {
                onError: (e) => setError(e instanceof ApiError ? e.message : t('closing.count.failed')),
              });
            }}
          />
        ))}

        {canSignOff ? (
          <View style={styles.signOff}>
            {!day.complete ? (
              <Text variant="caption" tone="secondary" style={styles.hint}>
                {t('closing.signOff.incomplete')}
              </Text>
            ) : null}
            <Button
              title={t('closing.closeAction')}
              icon={Check}
              fullWidth
              disabled={offline || signOff.isPending}
              onPress={() => {
                setError(null);
                signOff.mutate(undefined, {
                  onSuccess: () => router.push('/analytics' as never),
                  onError: (e) => setError(e instanceof ApiError ? e.message : t('closing.failed')),
                });
              }}
            />
          </View>
        ) : (
          // Said, not hidden. Somebody who counted should know what happens
          // next and who does it, rather than finding a button missing.
          <Text variant="caption" tone="secondary" style={styles.hint}>
            {t('closing.signOff.notYours')}
          </Text>
        )}

        {/*
          The way in to unsettled differences. Reachable from the screen where
          somebody just discovered one, rather than buried in a menu — a
          shortage nobody can find is a shortage nobody decides.
        */}
        {canSignOff ? (
          <Button
            title={t('discrepancy.title')}
            icon={Scale}
            variant="ghost"
            fullWidth
            onPress={() => router.push('/discrepancies' as never)}
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

/** One channel: what it should hold, and the count for it. */
function ChannelCard({
  channel,
  disabled,
  onSubmit,
}: {
  channel: ChannelRow;
  disabled: boolean;
  onSubmit: (body: { channel: 'cash' | 'account'; accountId?: string; counted?: number; skip?: boolean; skipReason?: string }) => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [skipping, setSkipping] = useState(false);
  const [skipReason, setSkipReason] = useState('');

  const label =
    channel.channel === 'cash'
      ? t('closing.channel.cash')
      : channel.isUnattributed
        ? t('closing.channel.unattributed')
        : channel.labelSnapshot;

  const settled = channel.counted !== null || channel.isSkipped;

  return (
    <Card style={styles.channel}>
      <View style={styles.channelHead}>
        <View style={styles.channelTitle}>
          {channel.channel === 'cash' ? <Banknote size={20} /> : <Smartphone size={20} />}
          <Text variant="bodyStrong">{label}</Text>
        </View>
        {/* Status in a word as well as a colour, always. */}
        {channel.isSkipped ? (
          <Chip tone="neutral" label={t('closing.channel.skipped')} size="sm" dot />
        ) : channel.counted !== null ? (
          <Chip tone="success" label={t('closing.channel.counted')} size="sm" dot />
        ) : channel.countable ? (
          <Chip tone="warning" label={t('closing.channel.outstanding')} size="sm" dot />
        ) : (
          <Chip tone="neutral" label={t('closing.channel.reportOnly')} size="sm" dot />
        )}
      </View>

      <View style={styles.row}>
        <Text variant="body" tone="secondary">
          {t('closing.expected')}
        </Text>
        <MoneyValue value={channel.expected} size="small" />
      </View>

      {channel.isUnattributed ? (
        /*
         * Reported, never counted. There is no account behind this money, so
         * there is no balance to compare a count against — asking somebody to
         * confirm it would be asking them to agree with a number that means
         * nothing.
         */
        <Text variant="caption" tone="secondary" style={styles.hint}>
          {t('closing.channel.unattributed.why')}
        </Text>
      ) : settled ? (
        <SettledRow channel={channel} />
      ) : skipping ? (
        <View style={styles.form}>
          <TextField
            label={t('closing.skip.reason')}
            value={skipReason}
            onChangeText={setSkipReason}
            placeholder={t('closing.skip.reasonPlaceholder')}
          />
          <View style={styles.actions}>
            <Button title={t('action.cancel')} variant="ghost" onPress={() => setSkipping(false)} />
            <Button
              title={t('closing.skip.confirm')}
              disabled={disabled || skipReason.trim().length < 3}
              onPress={() =>
                onSubmit({
                  channel: channel.channel,
                  accountId: channel.accountId ?? undefined,
                  skip: true,
                  skipReason: skipReason.trim(),
                })
              }
            />
          </View>
        </View>
      ) : (
        <View style={styles.form}>
          <MoneyField
            label={channel.channel === 'cash' ? t('closing.countedLabel') : t('closing.countedBalance')}
            value={value}
            onChangeText={setValue}
          />
          <View style={styles.actions}>
            {/*
              Skipping is offered for accounts only. The drawer is always in
              front of whoever is closing, so there is no honest reason to skip
              it — offering the option would just invite a shortcut.
            */}
            {channel.channel === 'account' ? (
              <Button title={t('closing.skip.action')} variant="ghost" onPress={() => setSkipping(true)} />
            ) : null}
            <Button
              title={t('closing.count.action')}
              disabled={disabled || value.trim() === ''}
              onPress={() =>
                onSubmit({
                  channel: channel.channel,
                  accountId: channel.accountId ?? undefined,
                  counted: Number(value),
                })
              }
            />
          </View>
        </View>
      )}
    </Card>
  );
}

/** A channel that has been settled, and by how much it was out. */
function SettledRow({ channel }: { channel: ChannelRow }) {
  const { t } = useTranslation();
  if (channel.isSkipped) {
    return (
      <Text variant="caption" tone="secondary" style={styles.hint}>
        {t('closing.skip.recorded', { reason: channel.skipReason ?? '' })}
      </Text>
    );
  }
  const difference = channel.difference ?? 0;
  return (
    <View>
      <View style={styles.row}>
        <Text variant="body" tone="secondary">
          {t('closing.counted')}
        </Text>
        <MoneyValue value={channel.counted ?? 0} size="small" />
      </View>
      <Divider style={styles.divider} />
      <View style={styles.row}>
        <Text variant="bodyStrong">{t('closing.difference')}</Text>
        {/*
          Signed and sign-coloured: a shortage and a surplus are different
          problems, and the direction matters as much as the amount.
        */}
        <MoneyValue value={difference} tone="auto" signed />
      </View>
      {difference !== 0 ? (
        <Text variant="caption" tone="secondary" style={styles.hint}>
          {t(difference < 0 ? 'closing.short' : 'closing.over')}
        </Text>
      ) : null}
    </View>
  );
}

function ChannelSummary({ channel }: { channel: ChannelRow }) {
  const { t } = useTranslation();
  const label =
    channel.channel === 'cash'
      ? t('closing.channel.cash')
      : channel.isUnattributed
        ? t('closing.channel.unattributed')
        : channel.labelSnapshot;
  return (
    <View>
      <View style={styles.row}>
        <Text variant="bodyStrong">{label}</Text>
        {channel.isSkipped ? (
          <Chip tone="neutral" label={t('closing.channel.skipped')} size="sm" dot />
        ) : channel.counted === null ? (
          <Chip tone="neutral" label={t('closing.channel.notCounted')} size="sm" dot />
        ) : (
          <MoneyValue value={channel.difference ?? 0} tone="auto" signed size="small" />
        )}
      </View>
      <View style={styles.row}>
        <Text variant="caption" tone="secondary">
          {t('closing.expected')}
        </Text>
        <MoneyValue value={channel.expected} size="small" />
      </View>
    </View>
  );
}

function Loading({ title }: { title: string }) {
  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title }} />
      <SkeletonList count={3} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.base, paddingBottom: space['3xl'] },
  channel: { gap: space.sm },
  channelHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  channelTitle: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space.xs },
  form: { gap: space.sm },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm },
  divider: { marginVertical: space.xs },
  hint: { marginTop: space.xs },
  doneHead: { alignItems: 'center', gap: space.sm, paddingVertical: space.lg },
  signOff: { gap: space.sm, paddingTop: space.base },
});
