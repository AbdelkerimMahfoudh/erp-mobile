import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
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
} from '../../components/ui';
import { isolateLtr } from '../../lib/design/direction';
import { space } from '../../lib/design/tokens';
import { toFriendlyError } from '../../lib/errors';
import { formatMoney } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import { uuidv4 } from '../../lib/utils';
import {
  directionTone,
  groupTone,
  loanStatusLabel,
  iAmOwed,
  useDecideLoan,
  useForgiveLoan,
  useLoan,
  useLoanPayment,
  type LoanDetail,
  type LoanLedgerEntry,
} from '../../lib/loans';

/**
 * One debt, from whichever side you are on (Milestone I).
 *
 * Three things this screen must never blur:
 *
 * - **Reported is not paid.** A reported payment is shown, and is never taken
 *   off the balance. Only the creditor turns it into a payment.
 * - **A reference is not proof.** Nothing external was checked, and the wording
 *   never suggests a provider confirmed anything.
 * - **Who may act follows the direction**, not who typed the loan in. The
 *   debtor sees no confirm button, because the debtor cannot confirm their own
 *   repayment — and the server refuses it regardless of what is on screen.
 */
export default function LoanDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useLoan(id);
  const [error, setError] = useState<string | null>(null);

  if (query.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: t('loans.one') }} />
        <SkeletonList count={4} />
      </Screen>
    );
  }
  if (query.isError || !query.data) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: t('loans.one') }} />
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </Screen>
    );
  }

  const loan = query.data;
  const b = loan.breakdown;

  return (
    <Screen scroll={false}>
      <Stack.Screen options={{ headerShown: true, title: loan.otherParty }} />
      <ScrollView contentContainerStyle={styles.list}>
        {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}

        <Card style={styles.card}>
          <View style={styles.head}>
            {/* The status in words and colour, never the server's English sentence. */}
            <Chip tone={groupTone(loan.group)} label={loanStatusLabel(loan.status, t)} size="sm" dot />
            {/* Which way round, in words and colour — never colour alone. */}
            <Chip
              tone={directionTone(loan.direction)}
              label={t(`loans.direction.${loan.direction}`)}
              size="sm"
              dot
            />
          </View>

          <View style={styles.row}>
            <Text variant="body" tone="secondary">
              {loan.principal == null ? t('loans.onTheTable') : t('loans.remaining')}
            </Text>
            <MoneyValue
              value={loan.principal == null ? (loan.counterAmount ?? loan.proposedAmount) : b.remaining}
            />
          </View>

          {loan.principal != null ? (
            <Text variant="caption" tone="secondary">
              {/* The agreed figure, kept visible: it never changes again. */}
              {t('loans.principal', { amount: isolateLtr(formatMoney(loan.principal)) })}
            </Text>
          ) : null}

          {b.awaitingConfirmation > 0 ? (
            /*
              Separate, and NOT deducted above. Saying a debt had shrunk because
              somebody claimed to have paid would tell a shop it had money it
              has not received.
            */
            <InlineNotice tone="warning">
              {t('loans.awaiting', { amount: isolateLtr(formatMoney(b.awaitingConfirmation)) })}
            </InlineNotice>
          ) : null}

          {loan.note ? (
            <Text variant="caption" tone="secondary">
              {loan.note}
            </Text>
          ) : null}
          {loan.disputeReason ? (
            <InlineNotice tone="warning">{loan.disputeReason}</InlineNotice>
          ) : null}
        </Card>

        {loan.ledger.length > 0 ? (
          <Section title={t('loans.history')}>
            <Card style={styles.card}>
              {/* The parts, so the balance is explained rather than asserted. */}
              {b.confirmedPaid > 0 ? (
                <Line label={t('loans.paid')} value={b.confirmedPaid} />
              ) : null}
              {b.corrected > 0 ? (
                <Line label={t('loans.reversed')} value={b.corrected} />
              ) : null}
              {b.forgiven > 0 ? (
                <Line label={t('loans.forgiven')} value={b.forgiven} />
              ) : null}
              <Divider style={styles.divider} />
              {loan.ledger.map((e) => (
                <Entry key={e.id} entry={e} />
              ))}
            </Card>
          </Section>
        ) : null}

        <Actions loan={loan} onError={setError} />
      </ScrollView>
    </Screen>
  );
}

function Line({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.row}>
      <Text variant="body" tone="secondary">
        {label}
      </Text>
      <MoneyValue value={value} size="small" />
    </View>
  );
}

/** One event, in the words of what actually happened. */
function Entry({ entry: e }: { entry: LoanLedgerEntry }) {
  const { t } = useTranslation();
  return (
    <View style={styles.row}>
      <View style={styles.entryText}>
        <Text variant="body">{t(`loans.ledger.${e.kind}`)}</Text>
        {e.reason ? (
          <Text variant="caption" tone="secondary">
            {e.reason}
          </Text>
        ) : null}
        {e.reference ? (
          <Text variant="caption" tone="secondary">
            {t('loans.reference', { ref: e.reference })}
          </Text>
        ) : null}
        {e.evidenceRef ? (
          /*
            Named as something somebody attached, never as verification. No
            provider was asked, and the wording must not imply one was.
          */
          <Text variant="caption" tone="secondary">
            {t('loans.evidence', { ref: e.evidenceRef })}
          </Text>
        ) : null}
      </View>
      <MoneyValue value={e.amount} size="small" />
    </View>
  );
}

/**
 * What this side can do next.
 *
 * Gated on the permission AND on which side of the debt this company is. A
 * button nobody's company may press is the same lie as one their role may not.
 */
function Actions({ loan, onError }: { loan: LoanDetail; onError: (m: string) => void }) {
  const { t } = useTranslation();
  const owed = iAmOwed(loan);

  const canManage = usePermission('loan.manage');
  const canReport = usePermission('loan.payment.report');
  const canConfirm = usePermission('loan.payment.confirm');
  const canForgive = usePermission('loan.forgive');

  const decide = useDecideLoan();
  const payment = useLoanPayment();
  const forgive = useForgiveLoan();

  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');

  // The friendly, translated explanation — never the server's raw English message.
  const fail = (e: unknown) => onError(toFriendlyError(e).body || t('loans.failed'));
  const go = <T,>(m: { mutate: (v: { id: string; body: T }, o: object) => void }, body: T) =>
    m.mutate({ id: loan.id, body }, { onError: fail });

  const negotiating = ['proposed', 'counter_proposed', 'disputed'].includes(loan.status);
  const remaining = loan.breakdown.remaining;

  /** A report the creditor has not answered yet. */
  const unanswered = loan.ledger.find(
    (e) =>
      e.kind === 'payment_reported' &&
      !loan.ledger.some((c) => c.kind === 'payment_confirmed' && c.refersToId === e.id),
  );
  const lastConfirmed = [...loan.ledger].reverse().find((e) => e.kind === 'payment_confirmed');

  return (
    <Section title={t('loans.next')}>
      <Card style={styles.card}>
        {negotiating && canManage ? (
          <>
            <MoneyField label={t('loans.counterAmount')} value={amount} onChangeText={setAmount} />
            <View style={styles.actions}>
              <Button
                title={t('loans.accept')}
                onPress={() => go(decide, { action: 'accept' as const, expectedVersion: loan.version })}
              />
              <Button
                title={t('loans.counter')}
                variant="ghost"
                disabled={!amount.trim()}
                onPress={() =>
                  go(decide, {
                    action: 'counter' as const,
                    amount: Number(amount),
                    expectedVersion: loan.version,
                  })
                }
              />
            </View>
            <TextField label={t('loans.disputeReason')} value={reason} onChangeText={setReason} />
            <Button
              title={t('loans.dispute')}
              variant="ghost"
              disabled={reason.trim().length < 3}
              onPress={() =>
                go(decide, {
                  action: 'dispute' as const,
                  reason: reason.trim(),
                  expectedVersion: loan.version,
                })
              }
            />
            <Text variant="caption" tone="secondary">
              {/* Says plainly that agreeing is what fixes the number. */}
              {t('loans.accept.hint')}
            </Text>
          </>
        ) : null}

        {/* The debtor reports. Reporting moves nothing, and the screen says so. */}
        {remaining > 0 && !owed && canReport ? (
          <>
            <MoneyField label={t('loans.payAmount')} value={amount} onChangeText={setAmount} />
            <TextField label={t('loans.payReference')} value={reference} onChangeText={setReference} />
            <Button
              title={t('loans.reportPayment')}
              disabled={!amount.trim()}
              onPress={() =>
                go(payment, {
                  action: 'report' as const,
                  amount: Number(amount),
                  method: 'cash' as const,
                  reference: reference.trim() || undefined,
                  clientUuid: uuidv4(),
                })
              }
            />
            <Text variant="caption" tone="secondary">
              {t('loans.reportPayment.hint')}
            </Text>
          </>
        ) : null}

        {/* Only the creditor confirms, and only what somebody has reported. */}
        {owed && canConfirm && unanswered ? (
          <>
            <Divider style={styles.divider} />
            <Text variant="body">
              {t('loans.confirmPayment.ask', { amount: isolateLtr(formatMoney(unanswered.amount)) })}
            </Text>
            <Button
              title={t('loans.confirmPayment')}
              onPress={() => go(payment, { action: 'confirm' as const, entryId: unanswered.id })}
            />
            <Text variant="caption" tone="secondary">
              {t('loans.confirmPayment.hint')}
            </Text>
          </>
        ) : null}

        {/* Reversing a confirmed payment. Always with a reason. */}
        {owed && canConfirm && lastConfirmed ? (
          <>
            <Divider style={styles.divider} />
            <TextField label={t('loans.correctReason')} value={reason} onChangeText={setReason} />
            <Button
              title={t('loans.correct')}
              variant="ghost"
              disabled={reason.trim().length < 3}
              onPress={() =>
                go(payment, {
                  action: 'correct' as const,
                  entryId: lastConfirmed.id,
                  reason: reason.trim(),
                })
              }
            />
            <Text variant="caption" tone="secondary">
              {t('loans.correct.hint')}
            </Text>
          </>
        ) : null}

        {remaining > 0 && owed && canForgive ? (
          <>
            <Divider style={styles.divider} />
            <MoneyField label={t('loans.forgiveAmount')} value={amount} onChangeText={setAmount} />
            <TextField label={t('loans.forgiveReason')} value={reason} onChangeText={setReason} />
            <Button
              title={t('loans.forgive')}
              variant="ghost"
              disabled={!amount.trim() || reason.trim().length < 3}
              onPress={() => go(forgive, { amount: Number(amount), reason: reason.trim() })}
            />
            <Text variant="caption" tone="secondary">
              {t('loans.forgive.hint')}
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
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingVertical: space.xs,
  },
  entryText: { flex: 1, gap: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  divider: { marginVertical: space.xs },
});
