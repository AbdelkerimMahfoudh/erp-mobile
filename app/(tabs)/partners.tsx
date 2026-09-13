import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Building2, Check, Handshake, Plus, X } from 'lucide-react-native';
import {
  Button,
  Card,
  Chip,
  EmptyState,
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
import { BottomSheet } from '../../components/overlay/BottomSheet';
import { ApiError } from '../../lib/api-client';
import { space } from '../../lib/design/tokens';
import { isolateLtr } from '../../lib/design/direction';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import {
  useCancelConnection,
  useConnections,
  useDecideConnection,
  useRequestConnection,
  useStoreLookup,
  type Connection,
  type ConnectionStatus,
} from '../../lib/consignment';
import { isCompleteStoreCode, normaliseStoreCode, partnerSections } from '../../lib/partners';

/**
 * Partners — the stores this shop deals with (Partners milestone).
 *
 * The one rule behind everything here: **a store may start new business with
 * another only after that store has accepted a connection.** So the screen is
 * ordered by what the relationship allows:
 *
 * 1. requests waiting on THIS user — first, because nothing moves until answered;
 * 2. connected stores — the only ones new dealings can start with;
 * 3. requests we sent, still waiting — withdrawable;
 * 4. relationships that ended — still openable, because their history, balances
 *    and any phones still out are not erased when a connection ends.
 *
 * It is not a directory. A store is added by its exact code, and the screen
 * shows the name behind the code before a request is sent, so a mistyped code
 * cannot quietly go to the wrong shop.
 */
export default function PartnersScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const canManage = usePermission('connection.manage');
  const canView = usePermission('consignment.view');
  const connections = useConnections({ enabled: canView });
  const decide = useDecideConnection();
  const cancel = useCancelConnection();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : t('stores.action.failed'));
  const sections = partnerSections(connections.data?.rows ?? []);
  const open = (c: Connection) => router.push(`/partners/${c.id}` as Href);

  const empty =
    sections.received.length + sections.connected.length + sections.sent.length + sections.past.length === 0;

  return (
    <Screen
      scroll
      gap="xl"
      onRefresh={() => void connections.refetch()}
      refreshing={connections.isFetching}
    >
      <View style={styles.titleRow}>
        <View style={styles.titleText}>
          <Text variant="title" accessibilityRole="header">
            {t('tab.partners')}
          </Text>
          <Text variant="caption" tone="secondary">
            {t('partners.intro')}
          </Text>
        </View>
        {canManage ? (
          <Button
            title={t('partners.add')}
            icon={Plus}
            size="sm"
            variant="secondary"
            onPress={() => setAdding(true)}
          />
        ) : null}
      </View>

      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}

      {!canView ? (
        <InlineNotice tone="info">{t('partners.viewRestricted')}</InlineNotice>
      ) : connections.isLoading ? (
        <SkeletonList count={3} />
      ) : connections.isError ? (
        <ErrorState error={connections.error} onRetry={() => void connections.refetch()} />
      ) : empty ? (
        <EmptyState
          icon={Handshake}
          title={t('partners.empty.title')}
          body={canManage ? t('partners.empty.body.owner') : t('partners.empty.body')}
          action={canManage ? { label: t('partners.add'), onPress: () => setAdding(true) } : undefined}
        />
      ) : (
        <>
          {sections.received.length > 0 ? (
            <Section title={t('partners.section.received')}>
              {sections.received.map((c) => (
                <Card key={c.id} style={styles.card}>
                  <StoreHeading connection={c} />
                  <Text variant="caption" tone="secondary">
                    {t('stores.pending.incoming')}
                  </Text>
                  {c.canDecide && canManage ? (
                    <View style={styles.actions}>
                      <Button
                        title={t('stores.accept')}
                        icon={Check}
                        disabled={decide.isPending}
                        onPress={() => {
                          setError(null);
                          decide.mutate({ id: c.id, accept: true, expectedVersion: c.version }, { onError: fail });
                        }}
                      />
                      <Button
                        title={t('stores.reject')}
                        icon={X}
                        variant="secondary"
                        disabled={decide.isPending}
                        onPress={() => {
                          setError(null);
                          decide.mutate({ id: c.id, accept: false, expectedVersion: c.version }, { onError: fail });
                        }}
                      />
                    </View>
                  ) : (
                    <Text variant="caption" tone="tertiary">
                      {t('partners.ownerAnswers')}
                    </Text>
                  )}
                </Card>
              ))}
            </Section>
          ) : null}

          {sections.connected.length > 0 ? (
            <Section title={t('partners.section.connected')}>
              <RowGroup>
                {sections.connected.map((c) => (
                  <ListRow
                    key={c.id}
                    flat
                    leading={Building2}
                    title={c.store.name}
                    subtitle={[c.store.city, isolateLtr(c.store.publicStoreId)].filter(Boolean).join(' · ')}
                    accessory={<StatusChip status={c.status} />}
                    onPress={() => open(c)}
                  />
                ))}
              </RowGroup>
            </Section>
          ) : null}

          {sections.sent.length > 0 ? (
            <Section title={t('partners.section.sent')}>
              {sections.sent.map((c) => (
                <Card key={c.id} style={styles.card}>
                  <StoreHeading connection={c} />
                  <Text variant="caption" tone="secondary">
                    {t('stores.pending.outgoing')}
                  </Text>
                  {c.canCancel && canManage ? (
                    <Button
                      title={t('partners.cancelRequest')}
                      variant="tertiary"
                      size="sm"
                      disabled={cancel.isPending}
                      onPress={() => {
                        setError(null);
                        cancel.mutate({ id: c.id, expectedVersion: c.version }, { onError: fail });
                      }}
                      style={styles.start}
                    />
                  ) : null}
                </Card>
              ))}
            </Section>
          ) : null}

          {sections.past.length > 0 ? (
            <Section title={t('partners.section.past')}>
              <RowGroup>
                {sections.past.map((c) => (
                  <ListRow
                    key={c.id}
                    flat
                    leading={Building2}
                    title={c.store.name}
                    subtitle={t('partners.pastHint')}
                    accessory={<StatusChip status={c.status} />}
                    onPress={() => open(c)}
                  />
                ))}
              </RowGroup>
            </Section>
          ) : null}
        </>
      )}

      <AddStoreSheet open={adding} onClose={() => setAdding(false)} />
    </Screen>
  );
}

function StoreHeading({ connection: c }: { connection: Connection }) {
  return (
    <View style={styles.head}>
      <View style={styles.headText}>
        <Text variant="bodyStrong">{c.store.name}</Text>
        <Text variant="caption" tone="secondary">
          {[c.store.city, isolateLtr(c.store.publicStoreId)].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <StatusChip status={c.status} />
    </View>
  );
}

const TONE: Record<ConnectionStatus, 'success' | 'warning' | 'neutral' | 'danger'> = {
  accepted: 'success',
  pending: 'warning',
  rejected: 'neutral',
  cancelled: 'neutral',
  removed: 'neutral',
  blocked: 'danger',
};

/** Status in words as well as colour — never colour alone. */
export function StatusChip({ status }: { status: ConnectionStatus }) {
  const { t } = useTranslation();
  return <Chip tone={TONE[status]} label={t(`partners.status.${status}`)} size="sm" dot />;
}

/**
 * Add a store by its code.
 *
 * Three steps, and the middle one is the point: type the code, SEE who it
 * belongs to — name and city, the same public preview search shows — and only
 * then send. If this store already has a relationship with them, that is said
 * instead of offering a request that would be refused.
 */
function AddStoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normal = normaliseStoreCode(code);
  const lookup = useStoreLookup(isCompleteStoreCode(normal) ? normal : '');
  const request = useRequestConnection();

  const close = () => {
    setCode('');
    setSent(false);
    setError(null);
    onClose();
  };

  const lookupError =
    lookup.error instanceof ApiError
      ? lookup.error.status === 404
        ? t('partners.add.notFound')
        : lookup.error.message
      : null;

  const relationship = lookup.data?.relationship;
  const blockedFromRequesting = relationship && ['accepted', 'pending'].includes(relationship.status);

  return (
    <BottomSheet open={open} onClose={close} title={t('partners.add.title')}>
      <View style={styles.sheet}>
        {sent ? (
          <>
            <InlineNotice tone="success" title={t('partners.add.sent.title')}>
              {t('partners.add.sent.body')}
            </InlineNotice>
            <Button title={t('action.done')} fullWidth onPress={close} />
          </>
        ) : (
          <>
            <TextField
              label={t('partners.add.code')}
              hint={t('partners.add.codeHint')}
              value={code}
              onChangeText={(v) => {
                setCode(normaliseStoreCode(v));
                setError(null);
              }}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={12}
              variant="identifier"
            />

            {lookup.isFetching ? (
              <Text variant="caption" tone="secondary">
                {t('partners.add.looking')}
              </Text>
            ) : null}
            {lookupError ? <InlineNotice tone="warning">{lookupError}</InlineNotice> : null}
            {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}

            {lookup.data ? (
              <Card style={styles.card}>
                <Text variant="label" tone="secondary">
                  {t('partners.add.confirmWho')}
                </Text>
                <Text variant="heading">{lookup.data.store.name}</Text>
                <Text variant="caption" tone="secondary">
                  {[lookup.data.store.city, isolateLtr(lookup.data.store.publicStoreId)].filter(Boolean).join(' · ')}
                </Text>
                {/* A placeholder, worded so nobody mistakes it for an earned badge. */}
                <Text variant="caption" tone="tertiary">
                  {t('stores.verification.pending')}
                </Text>
                {relationship ? (
                  <InlineNotice tone="info">
                    {t(`partners.add.existing.${relationship.status}` as never)}
                  </InlineNotice>
                ) : null}
                {!blockedFromRequesting ? (
                  <Button
                    title={t('stores.connect')}
                    icon={Handshake}
                    fullWidth
                    loading={request.isPending}
                    onPress={() =>
                      request.mutate(
                        { publicStoreId: lookup.data!.store.publicStoreId },
                        {
                          onSuccess: () => setSent(true),
                          onError: (e) => setError(e instanceof ApiError ? e.message : t('stores.request.failed')),
                        },
                      )
                    }
                  />
                ) : null}
              </Card>
            ) : null}
          </>
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  titleText: { flexShrink: 1, gap: 2 },
  card: { gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.sm },
  headText: { flex: 1, gap: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  start: { alignSelf: 'flex-start' },
  sheet: { gap: space.md, padding: space.base },
});
