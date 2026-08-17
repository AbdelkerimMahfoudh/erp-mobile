import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { Ban, Building2, Check, Search, X } from 'lucide-react-native';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  InlineNotice,
  Screen,
  SearchInput,
  SegmentedControl,
  SkeletonList,
  Text,
} from '../../components/ui';
import { ApiError } from '../../lib/api-client';
import { space } from '../../lib/design/tokens';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import {
  useBlockConnection,
  useConnections,
  useDecideConnection,
  useRequestConnection,
  useStoreSearch,
  type Connection,
  type StorePreview,
} from '../../lib/consignment';

/**
 * Finding and trusting another shop (Milestone H).
 *
 * The screen shows a stranger four things: name, city, logo, and a badge that
 * openly says it is coming rather than pretending to mean something. Nothing
 * else is available to show — the server does not send it — which is the point.
 */
export default function StoresScreen() {
  const { t } = useTranslation();
  const canManage = usePermission('connection.manage');
  const [tab, setTab] = useState<'connections' | 'search'>('connections');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const connections = useConnections();
  const search = useStoreSearch(query);
  const request = useRequestConnection();

  return (
    <Screen scroll={false}>
      <Stack.Screen options={{ headerShown: true, title: t('stores.title') }} />

      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}

      {canManage ? (
        <View style={styles.controls}>
          <SegmentedControl
            options={[
              { value: 'connections', label: t('stores.tab.connections') },
              { value: 'search', label: t('stores.tab.find') },
            ]}
            value={tab}
            onChange={(v) => setTab(v as 'connections' | 'search')}
          />
        </View>
      ) : null}

      {tab === 'search' && canManage ? (
        <>
          <SearchInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('stores.search.placeholder')}
          />
          {/*
            Said plainly rather than discovered through a 400. Three characters
            is the server's floor, and it exists so a search box cannot become a
            directory of every shop on the platform.
          */}
          <Text variant="caption" tone="secondary" style={styles.hint}>
            {t('stores.search.hint')}
          </Text>

          <ScrollView contentContainerStyle={styles.list}>
            {query.trim().length < 3 ? null : search.isLoading ? (
              <SkeletonList count={3} />
            ) : search.isError ? (
              <ErrorState error={search.error} onRetry={() => void search.refetch()} />
            ) : (search.data?.rows ?? []).length === 0 ? (
              /*
                One message for every reason: no such store, not discoverable, or
                they blocked you. Distinguishing them would let somebody learn
                who exists and who has blocked them.
              */
              <EmptyState icon={Search} title={t('stores.search.none.title')} body={t('stores.search.none.body')} />
            ) : (
              (search.data?.rows ?? []).map((s) => (
                <StoreCard
                  key={s.publicStoreId}
                  store={s}
                  busy={request.isPending}
                  onConnect={() => {
                    setError(null);
                    request.mutate(
                      { publicStoreId: s.publicStoreId },
                      {
                        onSuccess: () => setTab('connections'),
                        onError: (e) =>
                          setError(e instanceof ApiError ? e.message : t('stores.request.failed')),
                      },
                    );
                  }}
                />
              ))
            )}
          </ScrollView>
        </>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {connections.isLoading ? (
            <SkeletonList count={3} />
          ) : connections.isError ? (
            <ErrorState error={connections.error} onRetry={() => void connections.refetch()} />
          ) : (connections.data?.rows ?? []).length === 0 ? (
            <EmptyState
              icon={Building2}
              title={t('stores.empty.title')}
              body={canManage ? t('stores.empty.body.owner') : t('stores.empty.body')}
            />
          ) : (
            (connections.data?.rows ?? []).map((c) => (
              <ConnectionCard key={c.id} connection={c} canManage={canManage} onError={setError} />
            ))
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

function StoreCard({
  store,
  busy,
  onConnect,
}: {
  store: StorePreview;
  busy: boolean;
  onConnect: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Card style={styles.card}>
      <Text variant="bodyStrong">{store.name}</Text>
      <Text variant="caption" tone="secondary">
        {[store.city, store.publicStoreId].filter(Boolean).join(' · ')}
      </Text>
      {/*
        Rendered as a plain note, deliberately not as a badge. Nothing verifies
        these shops yet, and a badge that looks earned is worse than none —
        somebody would extend credit on the strength of it.
      */}
      <Text variant="caption" tone="secondary">
        {t('stores.verification.pending')}
      </Text>
      <Button title={t('stores.connect')} disabled={busy} onPress={onConnect} />
    </Card>
  );
}

function ConnectionCard({
  connection: c,
  canManage,
  onError,
}: {
  connection: Connection;
  canManage: boolean;
  onError: (m: string) => void;
}) {
  const { t } = useTranslation();
  const decide = useDecideConnection();
  const block = useBlockConnection();

  const tone =
    c.status === 'accepted'
      ? 'success'
      : c.status === 'blocked'
        ? 'danger'
        : c.status === 'rejected'
          ? 'neutral'
          : 'warning';

  const fail = (e: unknown) => onError(e instanceof ApiError ? e.message : t('stores.action.failed'));

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <View style={styles.headText}>
          <Text variant="bodyStrong">{c.store.name}</Text>
          <Text variant="caption" tone="secondary">
            {[c.store.city, c.store.publicStoreId].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <Chip tone={tone} label={t(`stores.status.${c.status}`)} size="sm" dot />
      </View>

      {/* The phone number appears only once the connection is accepted. */}
      {c.store.phone ? (
        <Text variant="body" tone="secondary">
          {c.store.phone}
        </Text>
      ) : null}

      {c.status === 'pending' ? (
        <Text variant="caption" tone="secondary">
          {c.direction === 'incoming' ? t('stores.pending.incoming') : t('stores.pending.outgoing')}
        </Text>
      ) : null}

      {c.status === 'blocked' ? (
        <Text variant="caption" tone="secondary">
          {c.blockedByMe ? t('stores.blocked.byMe') : t('stores.blocked.byThem')}
        </Text>
      ) : null}

      {canManage ? (
        <View style={styles.actions}>
          {/* Only the addressee of a pending request may answer it. */}
          {c.canDecide ? (
            <>
              <Button
                title={t('stores.accept')}
                icon={Check}
                onPress={() =>
                  decide.mutate(
                    { id: c.id, accept: true, expectedVersion: c.version },
                    { onError: fail },
                  )
                }
              />
              <Button
                title={t('stores.reject')}
                icon={X}
                variant="ghost"
                onPress={() =>
                  decide.mutate(
                    { id: c.id, accept: false, expectedVersion: c.version },
                    { onError: fail },
                  )
                }
              />
            </>
          ) : null}

          {c.status !== 'blocked' ? (
            <Button
              title={t('stores.block')}
              icon={Ban}
              variant="ghost"
              onPress={() => block.mutate({ id: c.id, blocked: true }, { onError: fail })}
            />
          ) : c.blockedByMe ? (
            // Only the shop that placed the block can lift it.
            <Button
              title={t('stores.unblock')}
              variant="ghost"
              onPress={() => block.mutate({ id: c.id, blocked: false }, { onError: fail })}
            />
          ) : null}
        </View>
      ) : null}

      {c.status === 'blocked' ? (
        <Text variant="caption" tone="secondary">
          {t('stores.blocked.note')}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  controls: { paddingBottom: space.sm },
  list: { gap: space.base, paddingBottom: space['3xl'] },
  card: { gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.sm },
  headText: { flex: 1, gap: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  hint: { paddingBottom: space.sm },
});
