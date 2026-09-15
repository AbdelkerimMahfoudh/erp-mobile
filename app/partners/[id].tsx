import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { Check, HandCoins, Handshake, Link2Off, ShoppingCart, X } from 'lucide-react-native';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  InlineNotice,
  ListRow,
  MoneyValue,
  RowGroup,
  Screen,
  Section,
  SkeletonList,
  Text,
} from '../../components/ui';
import { StatusChip } from '../(tabs)/partners';
import { ApiError } from '../../lib/api-client';
import { consignmentStanding, whoseMove } from '../../lib/custody-state';
import { isolateLtr } from '../../lib/design/direction';
import { space } from '../../lib/design/tokens';
import { dialog } from '../../lib/dialog';
import { formatDate } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { consignmentStatusLabel } from '../../lib/consignment';
import { loanStatusLabel } from '../../lib/loans';
import { loanMove, type Move } from '../../lib/partners';
import { usePermission } from '../../lib/permissions';
import {
  useCancelConnection,
  useConnectionSummary,
  useCounterparties,
  useDecideConnection,
  useRemoveConnection,
  type SharedDealing,
  type SharedPhone,
} from '../../lib/consignment';

/**
 * One store this shop deals with.
 *
 * Everything on it is something both stores already share — their dealings with
 * each other — and nothing the other store keeps private: its stock, costs,
 * margins and customers never reach this screen, because the server never sends
 * them.
 *
 * Money and custody are separate sections and are never netted. "They owe us
 * 3 000" and "we owe them 1 000" are two debts with two histories; showing
 * "they owe us 2 000" would erase a payment somebody still has to make. Likewise
 * a phone of ours in their shop is not money, and is listed as a phone.
 */
export default function PartnerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const canManage = usePermission('connection.manage');
  const canLend = usePermission('loan.manage');
  const canConsign = usePermission('consignment.request');
  const summary = useConnectionSummary(id);
  const counterparties = useCounterparties();
  const decide = useDecideConnection();
  const cancel = useCancelConnection();
  const remove = useRemoveConnection();
  const [error, setError] = useState<string | null>(null);
  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : t('stores.action.failed'));

  const s = summary.data;
  /** Our counterparty row for this relationship — what a new loan or consignment is addressed to. */
  const counterparty = (counterparties.data?.rows ?? []).find((c) => c.connectionId === id);

  const confirmRemove = async () => {
    if (!s) return;
    const ok = await dialog.confirm({
      title: t('partners.remove.title', { store: s.store.name }),
      message: t('partners.remove.body'),
      confirmLabel: t('partners.remove.confirm'),
      tone: 'danger',
    });
    if (!ok) return;
    setError(null);
    remove.mutate({ id: s.id, expectedVersion: s.version }, { onError: fail });
  };

  return (
    <Screen scroll gap="xl" onRefresh={() => void summary.refetch()} refreshing={summary.isFetching}>
      <Stack.Screen options={{ headerShown: true, title: s?.store.name ?? t('tab.partners') }} />

      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}

      {summary.isLoading ? (
        <SkeletonList count={4} />
      ) : summary.isError || !s ? (
        <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
      ) : (
        <>
          {/* ── Who, and where the relationship stands ── */}
          <Card style={styles.card}>
            <View style={styles.head}>
              <View style={styles.headText}>
                <Text variant="title">{s.store.name}</Text>
                <Text variant="caption" tone="secondary">
                  {[s.store.city, isolateLtr(s.store.publicStoreId)].filter(Boolean).join(' · ')}
                </Text>
                {s.store.phone ? (
                  <Text variant="body" tone="secondary">
                    {isolateLtr(s.store.phone)}
                  </Text>
                ) : null}
              </View>
              <StatusChip status={s.status} />
            </View>
            <Text variant="body" tone="secondary">
              {t(`partners.standing.${s.status}` as never)}
            </Text>

            {s.canDecide && canManage ? (
              <View style={styles.actions}>
                <Button
                  title={t('stores.accept')}
                  icon={Check}
                  onPress={() => decide.mutate({ id: s.id, accept: true, expectedVersion: s.version }, { onError: fail })}
                />
                <Button
                  title={t('stores.reject')}
                  icon={X}
                  variant="secondary"
                  onPress={() => decide.mutate({ id: s.id, accept: false, expectedVersion: s.version }, { onError: fail })}
                />
              </View>
            ) : null}
            {s.canCancel && canManage ? (
              <Button
                title={t('partners.cancelRequest')}
                variant="tertiary"
                size="sm"
                onPress={() => cancel.mutate({ id: s.id, expectedVersion: s.version }, { onError: fail })}
                style={styles.start}
              />
            ) : null}
          </Card>

          {/* ── What can be started with them ── */}
          {s.canStartDealing ? (
            <Section title={t('partners.actions.title')}>
              <RowGroup>
                {/*
                  Selling a phone outright to another store is not a supported
                  transaction yet. It is NOT faked with an ordinary customer
                  sale — that would give the buyer no receipt of ownership,
                  record no purchase on their side and leave the IMEI in two
                  stories. Stated, with the supported way to do it today.
                */}
                <ListRow
                  flat
                  leading={ShoppingCart}
                  title={t('partners.action.sell')}
                  subtitle={t('partners.action.sell.unavailable')}
                  disabled
                />
                {canLend ? (
                  <ListRow
                    flat
                    leading={HandCoins}
                    title={t('partners.action.lend')}
                    subtitle={t('partners.action.lend.hint')}
                    disabled={!counterparty}
                    onPress={() =>
                      counterparty &&
                      router.push({ pathname: '/loans/new', params: { counterpartyId: counterparty.id } } as never)
                    }
                  />
                ) : null}
                {canConsign ? (
                  <ListRow
                    flat
                    leading={Handshake}
                    title={t('partners.action.consign')}
                    subtitle={t('partners.action.consign.hint')}
                    disabled={!counterparty}
                    onPress={() =>
                      counterparty &&
                      router.push({ pathname: '/consignments/new', params: { counterpartyId: counterparty.id } } as never)
                    }
                  />
                ) : null}
              </RowGroup>
            </Section>
          ) : (
            <InlineNotice tone="info" title={t('partners.closed.title')}>
              {t('partners.closed.body')}
            </InlineNotice>
          )}

          {/* ── Money, each way, never netted ── */}
          <Section title={t('partners.money.title')}>
            <Card style={styles.card}>
              <MoneyRow label={t('partners.money.theyOweUs')} value={s.money.theyOweUs} />
              <MoneyRow label={t('partners.money.weOweThem')} value={s.money.weOweThem} />
              <Text variant="caption" tone="tertiary">
                {t('partners.money.hint')}
              </Text>
            </Card>
          </Section>

          {/* ── Phones, each way — custody is not money ── */}
          <Section title={t('partners.custody.title')}>
            <PhoneList title={t('partners.custody.ours')} phones={s.custody.ourItemsWithThem} />
            <PhoneList title={t('partners.custody.theirs')} phones={s.custody.theirItemsWithUs} />
          </Section>

          {/* ── Waiting on somebody ── */}
          <Section title={t('partners.pending.title')}>
            {s.pending.length === 0 ? (
              <Text variant="body" tone="secondary">
                {t('partners.pending.none')}
              </Text>
            ) : (
              <RowGroup>
                {s.pending.map((d) => (
                  <DealingRow key={`${d.type}-${d.id}`} dealing={d} showMove />
                ))}
              </RowGroup>
            )}
          </Section>

          {/* ── Everything, including what is finished ── */}
          <Section title={t('partners.history.title')}>
            {s.history.length === 0 ? (
              <EmptyState icon={Handshake} title={t('partners.history.none.title')} body={t('partners.history.none.body')} />
            ) : (
              <RowGroup>
                {s.history.map((d) => (
                  <DealingRow key={`h-${d.type}-${d.id}`} dealing={d} />
                ))}
              </RowGroup>
            )}
          </Section>

          {s.canRemove && canManage ? (
            <Button
              title={t('partners.remove.action')}
              icon={Link2Off}
              variant="tertiary"
              onPress={() => void confirmRemove()}
              style={styles.start}
            />
          ) : null}
        </>
      )}
    </Screen>
  );
}

function MoneyRow({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.row}>
      <Text variant="body" tone="secondary" style={styles.rowLabel}>
        {label}
      </Text>
      <MoneyValue value={value} size="small" />
    </View>
  );
}

function PhoneList({ title, phones }: { title: string; phones: SharedPhone[] }) {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Card style={styles.card}>
      <Text variant="labelStrong">{title}</Text>
      {phones.length === 0 ? (
        <Text variant="caption" tone="secondary">
          {t('partners.custody.none')}
        </Text>
      ) : (
        phones.map((p) => (
          <ListRow
            key={`${p.consignmentId}-${p.identifier}`}
            flat
            title={[p.brand, p.model, p.variant].filter(Boolean).join(' ') || isolateLtr(p.identifier)}
            subtitle={`${isolateLtr(p.identifier)} · ${
              p.custody === 'in_transit' ? t('partners.custody.inTransit') : t('partners.custody.held')
            }`}
            onPress={() => router.push(`/consignments/${p.consignmentId}` as Href)}
          />
        ))
      )}
    </Card>
  );
}

function DealingRow({ dealing: d, showMove = false }: { dealing: SharedDealing; showMove?: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();

  let move: Move = 'none';
  if (d.type === 'consignment') {
    move = whoseMove(consignmentStanding(d.status as never).next, d.side);
  } else {
    move = loanMove(d.waitingOn);
  }

  const title =
    d.type === 'consignment'
      ? t('partners.dealing.consignment', { count: String(d.phones) })
      : d.direction === 'they_owe_us'
        ? t('partners.dealing.loan.theyOwe')
        : t('partners.dealing.loan.weOwe');

  const status =
    d.type === 'consignment' ? consignmentStatusLabel(d.status, t) : loanStatusLabel(d.status, t);

  const amount =
    d.type === 'consignment'
      ? (d.agreedAmount ?? d.proposedAmount)
      : (d.principal ?? d.proposedAmount);

  return (
    <ListRow
      flat
      title={title}
      subtitle={[
        status,
        showMove && move !== 'none' ? t(`partners.move.${move}` as never) : null,
        formatDate(d.createdAt),
      ]
        .filter(Boolean)
        .join(' · ')}
      accessory={amount != null ? <MoneyValue value={amount} size="small" /> : undefined}
      onPress={() => router.push(`/${d.type === 'consignment' ? 'consignments' : 'loans'}/${d.id}` as Href)}
    />
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.sm },
  headText: { flex: 1, gap: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  start: { alignSelf: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  rowLabel: { flex: 1 },
});
