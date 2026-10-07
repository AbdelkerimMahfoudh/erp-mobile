import React, { useState } from 'react';
import { View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useLeave } from '../../../components/navigation/HeaderBack';
import { CalendarDays, Coins } from 'lucide-react-native';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  InlineNotice,
  MoneyField,
  MoneyValue,
  Screen,
  Section,
  SkeletonList,
  Text,
  TextField,
  Thumbnail,
  THUMB_SIZE,
} from '../../../components/ui';
import { ReceivedVia, type MoneySource } from '../../../components/money/ReceivedVia';
import { PayerNumberField } from '../../../components/sell/PayerNumberField';
import { isolateLtr } from '../../../lib/design/direction';
import { parsePayerNumber } from '../../../lib/payer-number';
import { toErrorMessage } from '../../../lib/errors';
import { OpenStoreNow } from '../../../components/day/OpenStoreNow';
import { closedDayOf, closedReasonOf } from '../../../lib/day-gate';
import { usePermission } from '../../../lib/permissions';
import { dialog } from '../../../lib/dialog';
import { radius, space } from '../../../lib/design/tokens';
import { makeStyles, useColors } from '../../../lib/design/theme';
import { formatDate, formatMoney } from '../../../lib/format';
import { useTranslation } from '../../../lib/i18n';
import { useRecordSalePayment, useSelectableAccounts } from '../../../lib/money-overview';
import { useRecentSuccess } from '../../../lib/recent-success';
import {
  collectionProblem,
  localDay,
  localTime,
  methodForAccount,
  paidAtFrom,
  remainingAfter,
} from '../../../lib/sale-payment-rules';
import { useSale } from '../../../lib/sales';
import type { PaymentMethod } from '../../../types/api';

/**
 * Recording money received LATER against a sale (0074).
 *
 * Not a second sale. The phone was sold once; this records that part of what
 * is owed has now arrived, into cash or one named account, on the day it
 * arrived. Revenue and profit stay on the original sale.
 *
 * The screen shows who owes, for what, how much before and how much after — and
 * asks once more before saving, because this is money the shop says it holds.
 * One key covers the whole attempt, so a timeout followed by a retry cannot
 * record the payment twice. Back on the sale, "Payment recorded" is said once.
 */
export default function RecordPaymentScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const sale = useSale(id);

  if (sale.data && sale.data.balanceDue > 0 && !sale.data.isReversed) return <Form sale={sale.data} />;

  return (
    <Screen scroll gap="lg">
      <Stack.Screen options={{ headerShown: true, title: t('recordPayment.title') }} />
      {sale.isLoading ? (
        <SkeletonList count={4} />
      ) : sale.isError ? (
        <ErrorState error={sale.error} onRetry={() => void sale.refetch()} />
      ) : sale.data ? (
        <EmptyState title={t('recordPayment.nothingOwed')} />
      ) : null}
    </Screen>
  );
}

function Form({ sale }: { sale: NonNullable<ReturnType<typeof useSale>['data']> }) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const leave = useLeave('/sales/pay/[id]', { id: sale.id });
  const record = useRecordSalePayment(sale.id);
  const { accounts } = useSelectableAccounts();
  const mark = useRecentSuccess((s) => s.mark);
  /*
    The store closed under this payment (docs/61): nothing was recorded. The form
    stays as typed; someone who may open the store does it here, and the refusal
    clears so the same payment can be sent again, on purpose, under the same key.
  */
  const closedDay = closedDayOf(record.error);
  // Closed and reopened by the closing authority, or not opened yet and opened by whoever counts (docs/63).
  const notOpened = closedReasonOf(record.error) === 'not_opened';
  const canPerform = usePermission('closing.perform');
  const canCount = usePermission('closing.count');
  const mayOpen = notOpened ? canCount : canPerform;

  const now = new Date();
  const [amount, setAmount] = useState('');
  const [source, setSource] = useState<MoneySource>({ kind: 'cash' });
  const [date, setDate] = useState(localDay(now));
  const [time, setTime] = useState(localTime(now));
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  /** The number the money came from, as typed (D151): offered only for an account, dropped on Cash. */
  const [payer, setPayer] = useState('');
  const chooseSource = (next: MoneySource) => {
    setSource(next);
    if (next.kind === 'cash') setPayer('');
  };

  const product = sale.lines.find((l) => !l.voided)?.product ?? t('saleRow.noProduct', { invoice: sale.invoiceNo });
  const paidAt = paidAtFrom(date, time);
  const account = source.kind === 'account' ? (accounts.find((a) => a.id === source.accountId) ?? null) : null;
  const method: PaymentMethod = source.kind === 'cash' ? 'cash' : methodForAccount(account?.provider ?? 'other');
  const problem = collectionProblem({
    amountText: amount,
    remaining: sale.balanceDue,
    method,
    accountId: account?.id ?? null,
    paidAt,
  });
  const after = remainingAfter(sale.balanceDue, amount);
  const payerParsed = parsePayerNumber(source.kind === 'account' ? payer : '');
  const payerBad = !payerParsed.ok;
  const accountLabel = source.kind === 'cash' ? t('payment.cash') : (account?.label ?? '');
  // "Bankily from 36123456" when the number the money came from was typed.
  const viaLabel =
    payerParsed.ok && payerParsed.value
      ? t('sell.payment.payerNumber.inReview', { account: accountLabel, number: isolateLtr(payerParsed.value) })
      : accountLabel;

  const submit = async () => {
    if (problem || payerBad) return;
    const value = Number(amount);
    const ok = await dialog.confirm({
      title: t('recordPayment.review.title', { amount: formatMoney(value) }),
      message:
        after > 0
          ? t('recordPayment.review.body', {
              amount: formatMoney(value),
              method: viaLabel,
              invoice: t('sales.invoice', { no: sale.invoiceNo }),
              remaining: formatMoney(after),
            })
          : t('recordPayment.review.settles', {
              amount: formatMoney(value),
              method: viaLabel,
              invoice: t('sales.invoice', { no: sale.invoiceNo }),
            }),
      confirmLabel: t('recordPayment.title'),
    });
    if (!ok) return;
    record.mutate(
      {
        amount: value,
        method,
        receivingAccountId: account?.id ?? null,
        paidAt: paidAt ? paidAt.toISOString() : null,
        reference,
        note,
        payerNumber: payer,
      },
      {
        onSuccess: () => {
          // The sale says it, once, when we get back there.
          mark(`payment:${sale.id}`);
          leave();
        },
      },
    );
  };

  return (
    <Screen
      scroll
      gap="lg"
      footer={
        <Button
          title={t('recordPayment.review')}
          size="lg"
          fullWidth
          disabled={problem !== null || payerBad}
          loading={record.isPending}
          onPress={() => void submit()}
        />
      }
    >
      <Stack.Screen options={{ headerShown: true, title: t('recordPayment.title') }} />

      {/* Who owes, for which sale, for what. */}
      <Card style={styles.who}>
        <Thumbnail />
        <View style={styles.grow}>
          <Text variant="bodyStrong" numberOfLines={2}>
            {`${sale.debtor?.name ?? t('outstanding.kind.unknown')} · ${t('sales.invoice', { no: sale.invoiceNo })}`}
          </Text>
          <Text variant="caption" tone="secondary" numberOfLines={2}>
            {product}
          </Text>
        </View>
      </Card>

      <Card variant="warning" style={styles.who}>
        <View style={styles.coin}>
          <Coins color={colors.intent.warning.fg} size={22} />
        </View>
        <View style={styles.grow}>
          <Text variant="caption" tone="secondary">
            {t('recordPayment.before')}
          </Text>
          <MoneyValue value={sale.balanceDue} size="large" />
        </View>
      </Card>

      <Section gap="md">
        <MoneyField label={t('recordPayment.amount')} value={amount} onChangeText={setAmount} required autoFocus />
        <ReceivedVia label={t('recordPayment.method')} value={source} onChange={chooseSource} accounts={accounts} />
        {source.kind === 'account' ? <PayerNumberField value={payer} onChangeText={setPayer} /> : null}
        {accounts.length === 0 ? (
          <Text variant="caption" tone="tertiary">
            {t('recordPayment.noAccounts')}
          </Text>
        ) : null}
        <View style={styles.row}>
          <View style={styles.grow}>
            <TextField label={t('recordPayment.date')} icon={CalendarDays} value={date} onChangeText={setDate} placeholder="2026-09-18" />
          </View>
          <View style={styles.time}>
            <TextField label={t('recordPayment.time')} value={time} onChangeText={setTime} placeholder="15:10" />
          </View>
        </View>
        <TextField label={t('recordPayment.reference')} value={reference} onChangeText={setReference} />
        <TextField label={t('recordPayment.note')} value={note} onChangeText={setNote} />
      </Section>

      {/* This payment beside what will still be owed — the two numbers the person checks before tapping. */}
      <Card variant="accent" style={styles.pair}>
        <View style={styles.grow}>
          <Text variant="caption" tone="secondary">
            {t('recordPayment.this')}
          </Text>
          <MoneyValue value={Number(amount) > 0 ? Number(amount) : 0} size="large" />
        </View>
        <View style={styles.grow}>
          <Text variant="caption" tone="secondary">
            {t('recordPayment.after')}
          </Text>
          <MoneyValue value={after} size="large" />
        </View>
      </Card>

      {problem && amount.trim() !== '' ? (
        <InlineNotice tone="warning">
          {t(`recordPayment.problem.${problem}` as never, { remaining: formatMoney(sale.balanceDue) })}
        </InlineNotice>
      ) : null}
      {closedDay ? (
        <>
          <InlineNotice tone="danger" title={t(notOpened ? 'gate.notOpened.title' : 'gate.closed.title')}>
            {t(notOpened ? 'recordPayment.notOpened' : 'recordPayment.storeClosed')}
          </InlineNotice>
          <OpenStoreNow
            businessDate={closedDay}
            reason={notOpened ? 'not_opened' : 'closed'}
            mayOpen={mayOpen}
            closedText={t(notOpened ? 'recordPayment.notOpened.open' : 'recordPayment.storeClosed.open', { date: formatDate(closedDay) })}
            onOpened={() => record.reset()}
          />
        </>
      ) : record.isError ? (
        <InlineNotice tone="danger">{toErrorMessage(record.error)}</InlineNotice>
      ) : null}

      <Text variant="caption" tone="tertiary" align="center">
        {t('recordPayment.onlyReceived')}
      </Text>
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  who: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  coin: {
    width: THUMB_SIZE.md,
    height: THUMB_SIZE.md,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface.card,
  },
  grow: { flex: 1, minWidth: 0 },
  row: { flexDirection: 'row', gap: space.sm },
  time: { width: 112 },
  pair: { flexDirection: 'row', gap: space.lg },
}));
