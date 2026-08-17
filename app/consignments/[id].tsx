import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import {
  Button,
  Card,
  Chip,
  Divider,
  ErrorState,
  Identifier,
  InlineNotice,
  MoneyField,
  MoneyValue,
  Screen,
  Section,
  SkeletonList,
  Text,
  TextField,
} from '../../components/ui';
import { ApiError } from '../../lib/api-client';
import { space } from '../../lib/design/tokens';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import {
  awaitingConfirmation,
  outstandingOf,
  useConsignment,
  useConsignmentPayment,
  useConsignmentReturn,
  useCustody,
  useDecideConsignment,
  useForgiveConsignment,
  useReportSold,
  type ConsignmentDetail,
} from '../../lib/consignment';

/**
 * One consignment, from whichever side you are on (Milestone H).
 *
 * The screen shows only what the server sent, and the server never sends the
 * other side's cost, resale price, customer or margin. So the privacy is not
 * something this file has to maintain — it cannot leak what it never receives.
 *
 * What this file DOES have to get right is language. A payment report is not a
 * payment; a reference is not proof; and "confirmed" is reserved for money that
 * arrived or a phone that came back.
 */
export default function ConsignmentDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useConsignment(id);
  const [error, setError] = useState<string | null>(null);

  if (query.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: t('consignment.one') }} />
        <SkeletonList count={4} />
      </Screen>
    );
  }
  if (query.isError || !query.data) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: t('consignment.one') }} />
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </Screen>
    );
  }

  const c = query.data;
  const owed = outstandingOf(c.ledger);
  const pending = awaitingConfirmation(c.ledger);

  return (
    <Screen scroll={false}>
      <Stack.Screen options={{ headerShown: true, title: c.otherParty }} />
      <ScrollView contentContainerStyle={styles.list}>
        {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}

        <Card style={styles.card}>
          <View style={styles.head}>
            <Text variant="bodyStrong">{c.statusText}</Text>
            <Chip tone="neutral" label={t(`consignment.side.${c.side}`)} size="sm" dot />
          </View>
          <Row label={t('consignment.agreed')} value={c.agreedAmount} fallback={c.proposedAmount} />
          {c.disputeReason ? (
            <InlineNotice tone="warning">{c.disputeReason}</InlineNotice>
          ) : null}
        </Card>

        {/* The money, and what it is still waiting on. */}
        {c.ledger.length > 0 ? (
          <Section title={t('consignment.money')}>
            <Card style={styles.card}>
              <View style={styles.row}>
                <Text variant="bodyStrong">{t('consignment.outstanding')}</Text>
                <MoneyValue value={owed} />
              </View>
              {pending > 0 ? (
                /*
                  Shown separately and NOT deducted. A reported payment is a
                  claim; treating it as settled would tell a shop it had been
                  paid when the other side has not agreed.
                */
                <Text variant="caption" tone="secondary">
                  {t('consignment.awaiting', { amount: String(pending) })}
                </Text>
              ) : null}
              <Divider style={styles.divider} />
              {c.ledger.map((e) => (
                <View key={e.id} style={styles.row}>
                  <View style={styles.entryText}>
                    <Text variant="body">{t(`consignment.ledger.${e.kind}`)}</Text>
                    {e.reason ? (
                      <Text variant="caption" tone="secondary">
                        {e.reason}
                      </Text>
                    ) : null}
                    {e.reference ? (
                      <Text variant="caption" tone="secondary">
                        {/* Named as a note, never as verification. */}
                        {t('consignment.reference', { ref: e.reference })}
                      </Text>
                    ) : null}
                  </View>
                  <MoneyValue value={e.amount} size="small" />
                </View>
              ))}
            </Card>
          </Section>
        ) : null}

        <Section title={t('consignment.phones.title')}>
          <Card>
            {c.lines.map((l, i) => (
              <View key={l.id}>
                {i > 0 ? <Divider style={styles.divider} /> : null}
                <View style={styles.row}>
                  <View style={styles.entryText}>
                    <Text variant="body">{[l.brand, l.model, l.variant].filter(Boolean).join(' ')}</Text>
                    <Identifier>{l.identifier}</Identifier>
                    {l.defectNote ? (
                      /* Disclosed faults, kept visible so "I was not told" is
                         answerable from the record. */
                      <Text variant="caption" tone="secondary">
                        {t('consignment.disclosed', { note: l.defectNote })}
                      </Text>
                    ) : null}
                  </View>
                  <Chip tone="neutral" label={t(`consignment.line.${l.status}`)} size="sm" dot />
                </View>
              </View>
            ))}
          </Card>
        </Section>

        <Actions consignment={c} onError={setError} />
      </ScrollView>
    </Screen>
  );
}

function Row({ label, value, fallback }: { label: string; value: number | null; fallback?: number | null }) {
  return (
    <View style={styles.row}>
      <Text variant="body" tone="secondary">
        {label}
      </Text>
      <MoneyValue value={value ?? fallback ?? 0} size="small" />
    </View>
  );
}

/**
 * What this side can do next.
 *
 * Every button is gated on BOTH the permission and the side, mirroring the
 * server. Showing an action somebody's company cannot take is the same lie as
 * showing one their role cannot.
 */
function Actions({ consignment: c, onError }: { consignment: ConsignmentDetail; onError: (m: string) => void }) {
  const { t } = useTranslation();
  const isSource = c.side === 'source';

  const canReview = usePermission('consignment.review');
  const canSend = usePermission('consignment.custody.send');
  const canReceive = usePermission('consignment.custody.receive');
  const canSell = usePermission('consignment.sell');
  const canReport = usePermission('consignment.payment.report');
  const canConfirm = usePermission('consignment.payment.confirm');
  const canReturn = usePermission('consignment.return.confirm');
  const canForgive = usePermission('consignment.forgive');

  const decide = useDecideConsignment();
  const custody = useCustody();
  const sold = useReportSold();
  const payment = useConsignmentPayment();
  const forgive = useForgiveConsignment();
  const ret = useConsignmentReturn();

  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  const fail = (e: unknown) => onError(e instanceof ApiError ? e.message : t('consignment.failed'));
  const go = <T,>(m: { mutate: (v: { id: string; body: T }, o: object) => void }, body: T) =>
    m.mutate({ id: c.id, body }, { onError: fail });

  const owed = outstandingOf(c.ledger);
  const negotiating = ['requested', 'counter_proposed', 'disputed'].includes(c.status);

  return (
    <Section title={t('consignment.next')}>
      <Card style={styles.card}>
        {negotiating && canReview ? (
          <>
            <MoneyField label={t('consignment.counterAmount')} value={amount} onChangeText={setAmount} />
            <View style={styles.actions}>
              <Button title={t('consignment.accept')} onPress={() => go(decide, { action: 'accept' as const, expectedVersion: c.version })} />
              <Button
                title={t('consignment.counter')}
                variant="ghost"
                disabled={!amount.trim()}
                onPress={() => go(decide, { action: 'counter' as const, amount: Number(amount), expectedVersion: c.version })}
              />
            </View>
            <TextField label={t('consignment.disputeReason')} value={reason} onChangeText={setReason} />
            <Button
              title={t('consignment.dispute')}
              variant="ghost"
              disabled={reason.trim().length < 3}
              onPress={() => go(decide, { action: 'dispute' as const, reason: reason.trim(), expectedVersion: c.version })}
            />
          </>
        ) : null}

        {c.status === 'accepted_awaiting_custody' && isSource && canSend ? (
          <Button title={t('consignment.send')} onPress={() => go(custody, { action: 'send' as const })} />
        ) : null}

        {c.status === 'custody_awaiting_confirmation' && !isSource && canReceive ? (
          <>
            <Button title={t('consignment.confirmReceipt')} onPress={() => go(custody, { action: 'confirm' as const })} />
            <Text variant="caption" tone="secondary">
              {t('consignment.confirmReceipt.hint')}
            </Text>
          </>
        ) : null}

        {c.status === 'in_custody' && canSell && (isSource ? !c.otherParty : true) ? (
          <Button title={t('consignment.reportSold')} onPress={() => go(sold, {})} />
        ) : null}

        {c.status === 'in_custody' && !isSource && canReturn ? (
          <Button title={t('consignment.startReturn')} variant="ghost" onPress={() => go(ret, { action: 'initiate' as const })} />
        ) : null}
        {c.status === 'return_initiated' && !isSource && canReturn ? (
          <Button title={t('consignment.shipReturn')} onPress={() => go(ret, { action: 'ship' as const })} />
        ) : null}
        {['return_initiated', 'return_in_transit'].includes(c.status) && isSource && canReturn ? (
          <>
            {/* The owner says what condition it came back in; damaged never
                goes straight back on the shelf. */}
            <Button title={t('consignment.acceptGood')} onPress={() => go(ret, { action: 'confirm' as const, condition: 'good' as const })} />
            <Button title={t('consignment.acceptDamaged')} variant="ghost" onPress={() => go(ret, { action: 'confirm' as const, condition: 'damaged' as const })} />
          </>
        ) : null}

        {owed > 0 && !isSource && canReport ? (
          <>
            <MoneyField label={t('consignment.payAmount')} value={amount} onChangeText={setAmount} />
            <Button
              title={t('consignment.reportPayment')}
              disabled={!amount.trim()}
              onPress={() => go(payment, { action: 'report' as const, amount: Number(amount), method: 'cash' as const })}
            />
            <Text variant="caption" tone="secondary">
              {t('consignment.reportPayment.hint')}
            </Text>
          </>
        ) : null}

        {owed > 0 && isSource && canConfirm ? (
          <Text variant="caption" tone="secondary">
            {t('consignment.confirmPayment.hint')}
          </Text>
        ) : null}

        {owed > 0 && isSource && canForgive ? (
          <>
            <Divider style={styles.divider} />
            <MoneyField label={t('consignment.forgiveAmount')} value={amount} onChangeText={setAmount} />
            <TextField label={t('consignment.forgiveReason')} value={reason} onChangeText={setReason} />
            <Button
              title={t('consignment.forgive')}
              variant="ghost"
              disabled={!amount.trim() || reason.trim().length < 3}
              onPress={() => go(forgive, { amount: Number(amount), reason: reason.trim() })}
            />
            <Text variant="caption" tone="secondary">
              {t('consignment.forgive.hint')}
            </Text>
          </>
        ) : null}
      </Card>
    </Section>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.base, paddingBottom: space['3xl'] },
  card: { gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.sm, paddingVertical: space.xs },
  entryText: { flex: 1, gap: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  divider: { marginVertical: space.xs },
});
