import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useRouter, type Href } from 'expo-router';
import { Building2, Check, Copy, HandCoins, Handshake, Plus, X } from 'lucide-react-native';
import {
  Button,
  Card,
  Chip,
  Disclosure,
  EmptyState,
  IconButton,
  Identifier,
  MoneyValue,
  ErrorState,
  InlineNotice,
  ListRow,
  RowGroup,
  Screen,
  Section,
  SkeletonList,
  TabHeader,
  Text,
  TextField,
} from '../../components/ui';
import { BottomSheet } from '../../components/overlay/BottomSheet';
import { ApiError } from '../../lib/api-client';
import { useAuth } from '../../hooks/useAuth';
import { useBranch } from '../../lib/branch';
import { toast } from '../../lib/toast';
import { space } from '../../lib/design/tokens';
import { isolateLtr } from '../../lib/design/direction';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import {
  useCancelConnection,
  useConnectionSummary,
  useConnections,
  useCounterparties,
  useDecideConnection,
  useRequestConnection,
  useStoreLookup,
  type Connection,
  type ConnectionStatus,
} from '../../lib/consignment';
import { isCompleteStoreCode, loanMove, normaliseStoreCode, partnerSections } from '../../lib/partners';
import { consignmentStanding, whoseMove } from '../../lib/custody-state';

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

  const { branchName } = useBranch();
  const empty =
    sections.received.length + sections.connected.length + sections.sent.length + sections.past.length === 0;
  /** Empty only once the list has actually answered — never inferred while loading. */
  const settledEmpty = connections.isSuccess && empty;

  return (
    <Screen
      scroll
      gap="xl"
      onRefresh={() => void connections.refetch()}
      refreshing={connections.isFetching}
    >
      {/*
        The title and Add stay put while the list loads. In a completely empty
        state the centre card carries Add instead, so the action is not offered
        twice on one screen.
      */}
      <TabHeader
        context={branchName}
        title={t('tab.partners')}
        actions={
          canManage && !(settledEmpty && canView) ? (
            <Button title={t('partners.add')} icon={Plus} size="sm" variant="secondary" onPress={() => setAdding(true)} />
          ) : null
        }
      />

      <OwnStoreCode />

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
          size="inline"
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
              {sections.connected.map((c) => (
                <ConnectedStore key={c.id} connection={c} onOpen={() => open(c)} />
              ))}
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

          {canView ? (
            <RowGroup>
              <ListRow
                flat
                leading={Handshake}
                title={t('nav.consignments')}
                subtitle={t('partners.consignments.hint')}
                onPress={() => router.push('/consignments' as Href)}
              />
            </RowGroup>
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

/**
 * This store's own code, so it can be read out to another shop.
 *
 * Shareable by design: it only identifies the store and signs nobody in. The
 * copy reports whether the write actually landed.
 */
function OwnStoreCode() {
  const { t } = useTranslation();
  const { user } = useAuth();
  if (!user?.publicStoreId) return null;
  const code = user.publicStoreId;
  const copy = async () => {
    try {
      const ok = await Clipboard.setStringAsync(code);
      if (ok) toast.success(t('settings.storeId.copied'));
      else toast.error(t('settings.storeId.copyFailed'));
    } catch {
      toast.error(t('settings.storeId.copyFailed'));
    }
  };
  return (
    <View style={styles.codeRow}>
      <Text variant="caption" tone="secondary" style={styles.codeLabel}>
        {t('partners.ownCode')}
      </Text>
      <Identifier tone="primary">{isolateLtr(code)}</Identifier>
      <IconButton icon={Copy} variant="plain" accessibilityLabel={t('settings.storeId.copy')} onPress={() => void copy()} />
    </View>
  );
}

/**
 * A connected store that opens in place to what both stores share.
 *
 * Money is shown each way and never netted; phones are phones, not money. The
 * shared summary is fetched only when the row is opened, and nothing private to
 * the other store is ever in it — the server does not send it.
 */
function ConnectedStore({ connection: c, onOpen }: { connection: Connection; onOpen: () => void }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const canLend = usePermission('loan.manage');
  const canConsign = usePermission('consignment.request');
  const summary = useConnectionSummary(open ? c.id : undefined);
  const counterparties = useCounterparties();
  const counterparty = (counterparties.data?.rows ?? []).find((x) => x.connectionId === c.id);
  const sum = summary.data;
  // The same rule the store's own screen uses to say whose move it is.
  const moves = (sum?.pending ?? []).map((d) =>
    d.type === 'consignment' ? whoseMove(consignmentStanding(d.status as never).next, d.side) : loanMove(d.waitingOn),
  );
  const ourMove = moves.filter((m) => m === 'you' || m === 'both').length;
  const theirMove = moves.filter((m) => m === 'them').length;

  return (
    <Card style={styles.card}>
      <StoreHeading connection={c} />
      <Disclosure title={t('partners.shared.title')} onOpenChange={(v) => v && setOpen(true)}>
        {summary.isPending ? (
          <SkeletonList count={2} />
        ) : summary.isError || !sum ? (
          <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
        ) : (
          <>
            <SharedLine label={t('partners.money.theyOweUs')} value={<MoneyValue value={sum.money.theyOweUs} size="small" />} />
            <SharedLine label={t('partners.money.weOweThem')} value={<MoneyValue value={sum.money.weOweThem} size="small" />} />
            <SharedLine label={t('partners.custody.ours')} value={<Text variant="bodyStrong">{String(sum.custody.ourItemsWithThem.length)}</Text>} />
            <SharedLine label={t('partners.custody.theirs')} value={<Text variant="bodyStrong">{String(sum.custody.theirItemsWithUs.length)}</Text>} />
            <Text variant="caption" tone={ourMove > 0 ? 'warning' : 'secondary'}>
              {sum.pending.length === 0
                ? t('partners.pending.none')
                : t('partners.shared.open', { yours: String(ourMove), theirs: String(theirMove) })}
            </Text>
            {sum.canStartDealing && (canLend || canConsign) ? (
              <View style={styles.actions}>
                {canLend ? (
                  <Button
                    title={t('partners.action.lend')}
                    icon={HandCoins}
                    size="sm"
                    variant="secondary"
                    disabled={!counterparty}
                    onPress={() =>
                      counterparty &&
                      router.push({ pathname: '/loans/new', params: { counterpartyId: counterparty.id } } as never)
                    }
                  />
                ) : null}
                {canConsign ? (
                  <Button
                    title={t('partners.action.consign')}
                    icon={Handshake}
                    size="sm"
                    variant="secondary"
                    disabled={!counterparty}
                    onPress={() =>
                      counterparty &&
                      router.push({ pathname: '/consignments/new', params: { counterpartyId: counterparty.id } } as never)
                    }
                  />
                ) : null}
              </View>
            ) : null}
            <Button title={t('partners.shared.history')} variant="tertiary" size="sm" onPress={onOpen} style={styles.start} />
          </>
        )}
      </Disclosure>
    </Card>
  );
}

function SharedLine({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <View style={styles.sharedLine}>
      <Text variant="body" tone="secondary" style={styles.sharedLabel}>
        {label}
      </Text>
      {value}
    </View>
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
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  codeLabel: { flexShrink: 1 },
  sharedLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  sharedLabel: { flex: 1 },
  card: { gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.sm },
  headText: { flex: 1, gap: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  start: { alignSelf: 'flex-start' },
  sheet: { gap: space.md, padding: space.base },
});
