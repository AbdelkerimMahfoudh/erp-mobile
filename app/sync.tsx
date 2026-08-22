import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { CloudOff, RefreshCw } from 'lucide-react-native';
import {
  Button,
  Card,
  Chip,
  Divider,
  EmptyState,
  InlineNotice,
  Screen,
  Section,
  Text,
} from '../components/ui';
import { space } from '../lib/design/tokens';
import { useTranslation } from '../lib/i18n';
import { useConnectivity } from '../lib/connectivity';
import { useQueue } from '../lib/offline/queue';
import { mayCancel, toneFor, type QueueItem } from '../lib/offline/queue-rules';

/**
 * Everything this device is holding (Milestone J).
 *
 * One screen that answers the question a shop actually asks — *did that go
 * through?* — without making anybody hunt through the workflow it came from.
 *
 * The rule the whole screen obeys: **nothing is green until the server has
 * agreed.** Waiting is waiting, and an item needing a decision says what the
 * server actually objected to rather than "failed", because a conflict is a
 * question for a person, not something to press retry at.
 */
export default function SyncScreen() {
  const { t } = useTranslation();
  const online = useConnectivity((s) => s.online);
  const items = useQueue((s) => s.items);
  const running = useQueue((s) => s.running);
  const lastSyncAt = useQueue((s) => s.lastSyncAt);
  const corrupted = useQueue((s) => s.corruptionDetected);
  const durable = useQueue((s) => s.durable);
  const process = useQueue((s) => s.process);

  const waiting = items.filter((i) => i.state === 'waiting_for_connection' || i.state === 'sending');
  const attention = items.filter((i) => i.state === 'needs_attention');
  const drafts = items.filter((i) => i.state === 'draft');
  const done = items.filter((i) => i.state === 'synced' || i.state === 'cancelled');

  return (
    <Screen scroll={false}>
      <Stack.Screen options={{ headerShown: true, title: t('sync.title') }} />
      <ScrollView contentContainerStyle={styles.list}>
        {/*
          On web there is no device storage, so nothing can be kept or queued
          (CP1). Said plainly rather than shown as an empty queue, which would
          read as "nothing waiting" — the opposite of the truth.
        */}
        {!durable ? (
          <InlineNotice tone="warning">{t('sync.notDurable')}</InlineNotice>
        ) : null}

        <InlineNotice tone={online ? 'success' : 'warning'}>
          {online ? t('sync.connected') : t('sync.disconnected')}
        </InlineNotice>

        {corrupted ? (
          /*
            Said out loud rather than swallowed. The bytes were kept, but a shop
            that lost an unsent report deserves to know it happened.
          */
          <InlineNotice tone="danger">{t('sync.corrupted')}</InlineNotice>
        ) : null}

        <Card style={styles.card}>
          <Row label={t('sync.count.drafts')} value={drafts.length} />
          <Row label={t('sync.count.waiting')} value={waiting.length} />
          <Row label={t('sync.count.attention')} value={attention.length} />
          <Divider style={styles.divider} />
          <Text variant="caption" tone="secondary">
            {lastSyncAt
              ? t('sync.lastAt', { when: new Date(lastSyncAt).toLocaleTimeString() })
              : t('sync.never')}
          </Text>
          <Button
            title={t('sync.retryAll')}
            icon={RefreshCw}
            variant="ghost"
            disabled={!online || running || waiting.length === 0}
            onPress={() => void process()}
          />
          {!online ? (
            <Text variant="caption" tone="secondary">
              {t('sync.retryAll.offline')}
            </Text>
          ) : null}
        </Card>

        {attention.length > 0 ? (
          <Section title={t('sync.section.attention')}>
            {attention.map((i) => (
              <QueueRow key={i.id} item={i} />
            ))}
          </Section>
        ) : null}

        {waiting.length > 0 ? (
          <Section title={t('sync.section.waiting')}>
            {waiting.map((i) => (
              <QueueRow key={i.id} item={i} />
            ))}
          </Section>
        ) : null}

        {drafts.length > 0 ? (
          <Section title={t('sync.section.drafts')}>
            {drafts.map((i) => (
              <QueueRow key={i.id} item={i} />
            ))}
          </Section>
        ) : null}

        {items.length === 0 ? (
          <EmptyState icon={CloudOff} title={t('sync.empty.title')} body={t('sync.empty.body')} />
        ) : null}

        {done.length > 0 ? (
          <Section title={t('sync.section.done')}>
            {done.slice(-10).map((i) => (
              <QueueRow key={i.id} item={i} />
            ))}
          </Section>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.row}>
      <Text variant="body" tone="secondary">
        {label}
      </Text>
      <Text variant="bodyStrong">{String(value)}</Text>
    </View>
  );
}

function QueueRow({ item }: { item: QueueItem }) {
  const { t } = useTranslation();
  const online = useConnectivity((s) => s.online);
  const cancel = useQueue((s) => s.cancel);
  const retry = useQueue((s) => s.retry);

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Text variant="bodyStrong">{item.summary}</Text>
        {/* Colour AND words: the state is never carried by colour alone. */}
        <Chip tone={toneFor(item.state)} label={t(`sync.state.${item.state}`)} size="sm" dot />
      </View>

      {item.lastError ? (
        <>
          {/* What the server actually said, kept verbatim — it was written for
              a person, and a generic message would send somebody guessing. */}
          <Text variant="caption" tone="secondary">
            {item.lastError.message}
          </Text>
          <Text variant="caption" tone="secondary">
            {t(`sync.reason.${item.lastError.kind}`)}
          </Text>
        </>
      ) : null}

      <View style={styles.actions}>
        {item.state === 'needs_attention' ? (
          <Button
            title={t('sync.tryAgain')}
            variant="ghost"
            disabled={!online}
            onPress={() => retry(item.id)}
          />
        ) : null}
        {/* Only while nothing has been sent. Mid-flight the outcome is unknown,
            and offering to cancel it would be offering a promise we cannot keep. */}
        {mayCancel(item) ? (
          <Button title={t('sync.cancel')} variant="ghost" onPress={() => cancel(item.id)} />
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.base, paddingBottom: space['3xl'] },
  card: { gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space.xs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  divider: { marginVertical: space.xs },
});
