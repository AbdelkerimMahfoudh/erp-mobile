import React, { useState } from 'react';
import { View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
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
} from '../../../components/ui';
import { toErrorMessage } from '../../../lib/errors';
import { dialog } from '../../../lib/dialog';
import { space } from '../../../lib/design/tokens';
import { makeStyles } from '../../../lib/design/theme';
import { formatMoney } from '../../../lib/format';
import { useTranslation } from '../../../lib/i18n';
import { useRecordSalePayment, useSelectableAccounts } from '../../../lib/money-overview';
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
 * record the payment twice.
 */
export default function RecordPaymentScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const sale = useSale(id);

  return (
    <Screen scroll gap="lg">
      <Stack.Screen options={{ headerShown: true, title: t('recordPayment.title') }} />
      {sale.isLoading ? (
        <SkeletonList count={4} />
      ) : sale.isError ? (
        <ErrorState error={sale.error} onRetry={() => void sale.refetch()} />
      ) : sale.data ? (
        sale.data.balanceDue > 0 && !sale.data.isReversed ? (
          <Form sale={sale.data} />
        ) : (
          <EmptyState title={t('recordPayment.nothingOwed')} />
        )
      ) : null}
    </Screen>
  );
}

type Via = { kind: 'cash' } | { kind: 'account'; id: string; label: string; method: PaymentMethod };

function Form({ sale }: { sale: NonNullable<ReturnType<typeof useSale>['data']> }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const router = useRouter();
  const record = useRecordSalePayment(sale.id);
  const { accounts } = useSelectableAccounts();

  const now = new Date();
  const [amount, setAmount] = useState('');
  const [via, setVia] = useState<Via>({ kind: 'cash' });
  const [date, setDate] = useState(localDay(now));
  const [time, setTime] = useState(localTime(now));
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');

  const product = sale.lines.find((l) => !l.voided)?.product ?? t('saleRow.noProduct', { invoice: sale.invoiceNo });
  const paidAt = paidAtFrom(date, time);
  const method: PaymentMethod = via.kind === 'cash' ? 'cash' : via.method;
  const problem = collectionProblem({
    amountText: amount,
    remaining: sale.balanceDue,
    method,
    accountId: via.kind === 'account' ? via.id : null,
    paidAt,
  });
  const after = remainingAfter(sale.balanceDue, amount);
  const viaLabel = via.kind === 'cash' ? t('payment.cash') : via.label;

  const submit = async () => {
    if (problem) return;
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
        receivingAccountId: via.kind === 'account' ? via.id : null,
        paidAt: paidAt ? paidAt.toISOString() : null,
        reference,
        note,
      },
      {
        onSuccess: () => {
          void dialog.alert({ title: t('recordPayment.done') });
          router.back();
        },
      },
    );
  };

  return (
    <>
      <Card style={styles.card}>
        <Text variant="bodyStrong">{sale.debtor?.name ?? t('outstanding.kind.unknown')}</Text>
        <Text variant="caption" tone="secondary">
          {t('sales.invoice', { no: sale.invoiceNo })} · {product}
        </Text>
        <View style={styles.line}>
          <Text variant="body" tone="secondary" style={styles.grow}>
            {t('recordPayment.before')}
          </Text>
          <MoneyValue value={sale.balanceDue} />
        </View>
      </Card>

      <Section gap="sm">
        <MoneyField label={t('recordPayment.amount')} value={amount} onChangeText={setAmount} required />

        <Text variant="label">{t('recordPayment.method')}</Text>
        <View style={styles.choices}>
          <Button
            title={t('payment.cash')}
            variant={via.kind === 'cash' ? 'primary' : 'secondary'}
            onPress={() => setVia({ kind: 'cash' })}
          />
          {accounts.map((a) => (
            <Button
              key={a.id}
              title={a.label}
              variant={via.kind === 'account' && via.id === a.id ? 'primary' : 'secondary'}
              onPress={() => setVia({ kind: 'account', id: a.id, label: a.label, method: methodForAccount(a.provider) })}
            />
          ))}
        </View>
        {accounts.length === 0 ? (
          <Text variant="caption" tone="tertiary">
            {t('recordPayment.noAccounts')}
          </Text>
        ) : null}

        <View style={styles.row}>
          <View style={styles.grow}>
            <TextField label={t('recordPayment.date')} value={date} onChangeText={setDate} placeholder="2026-09-18" />
          </View>
          <View style={styles.grow}>
            <TextField label={t('recordPayment.time')} value={time} onChangeText={setTime} placeholder="15:10" />
          </View>
        </View>
        <TextField label={t('recordPayment.reference')} value={reference} onChangeText={setReference} />
        <TextField label={t('recordPayment.note')} value={note} onChangeText={setNote} />
      </Section>

      <Card style={styles.card}>
        <View style={styles.line}>
          <Text variant="body" tone="secondary" style={styles.grow}>
            {t('recordPayment.this')}
          </Text>
          <MoneyValue value={Number(amount) > 0 ? Number(amount) : 0} />
        </View>
        <View style={styles.line}>
          <Text variant="body" tone="secondary" style={styles.grow}>
            {t('recordPayment.after')}
          </Text>
          <MoneyValue value={after} />
        </View>
      </Card>

      {problem && amount.trim() !== '' ? (
        <InlineNotice tone="warning">
          {t(`recordPayment.problem.${problem}` as never, { remaining: formatMoney(sale.balanceDue) })}
        </InlineNotice>
      ) : null}
      {record.isError ? <InlineNotice tone="danger">{toErrorMessage(record.error)}</InlineNotice> : null}

      <Text variant="caption" tone="tertiary">
        {t('recordPayment.onlyReceived')}
      </Text>
      <Button
        title={t('recordPayment.review')}
        size="lg"
        fullWidth
        disabled={problem !== null}
        loading={record.isPending}
        onPress={() => void submit()}
      />
    </>
  );
}

const useStyles = makeStyles(() => ({
  card: { gap: space.xs },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  grow: { flex: 1 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
}));
