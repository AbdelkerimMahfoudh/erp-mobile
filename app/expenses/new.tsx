import React, { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  Button,
  Card,
  InlineNotice,
  MoneyField,
  Screen,
  Section,
  SegmentedControl,
  Text,
  TextField,
  Toggle,
} from '../../components/ui';
import { api } from '../../lib/api-client';
import { useConnectivity } from '../../lib/connectivity';
import { space } from '../../lib/design/tokens';
import { useTranslation } from '../../lib/i18n';
import { toast } from '../../lib/toast';
import { uuidv4 } from '../../lib/utils';
import { expenseConflictKind, useReportExpense } from '../../lib/expenses';
import { dialog } from '../../lib/dialog';

interface SettingsResponse {
  receivingAccounts?: { id: string; label: string }[];
}

/**
 * Reporting an expense.
 *
 * The screen says what it does: this records a claim, and an Owner decides.
 * Nothing here moves money, and the notice says so before anything is sent — a
 * form that looks final and then turns out to need approval is how a shop
 * discovers a workflow by being surprised by it.
 */
export default function NewExpenseScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const offline = !useConnectivity((s) => s.online);

  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [expenseClass, setExpenseClass] = useState<'variable' | 'fixed'>('variable');
  const [isSalary, setIsSalary] = useState(false);
  const [dueDate, setDueDate] = useState('');
  const [method, setMethod] = useState<'cash' | 'account'>('cash');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');

  /**
   * One request id per logical report, held in a ref so a re-render cannot mint
   * a new one. A fresh id per attempt would defeat idempotency exactly when it
   * matters: a timeout followed by a retry would record two expenses.
   */
  const requestId = useRef<string>(uuidv4());
  const report = useReportExpense();

  // Only ACTIVE accounts are offered; the server refuses any other.
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<SettingsResponse>('/settings'),
  });
  const accounts = settings.data?.receivingAccounts ?? [];

  const amountValue = Number(amount);
  const canSubmit =
    category.trim().length > 0 &&
    amountValue > 0 &&
    (expenseClass === 'variable' || dueDate.length === 10) &&
    (method === 'cash' || Boolean(accountId)) &&
    !offline;

  const submit = async () => {
    try {
      await report.mutateAsync({
        category: category.trim(),
        amount: amountValue,
        expenseClass,
        isSalary,
        dueDate: expenseClass === 'fixed' ? dueDate : undefined,
        method,
        receivingAccountId: method === 'account' ? (accountId ?? undefined) : undefined,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
        clientUuid: requestId.current,
      });
      toast.success(t('expenses.report.done'));
      router.back();
      // The id is deliberately NOT regenerated: the next attempt is a retry of
      // this one and must resolve to the same expense.
    } catch (e) {
      const kind = expenseConflictKind(e);
      if (kind) {
        await dialog.alert({
          title: t(`expenses.conflict.${kind}.title` as never),
          message: t(`expenses.conflict.${kind}.body` as never),
        });
        return;
      }
      toast.error(t('expenses.report.failed'));
    }
  };

  return (
    <Screen scroll gap="lg">
      <Stack.Screen options={{ headerShown: true, title: t('expenses.report.title') }} />

      <Section title={t('expenses.report.what')}>
        <TextField
          label={t('expenses.category')}
          hint={t('expenses.category.hint')}
          value={category}
          onChangeText={setCategory}
          required
          autoFocus
        />
        <MoneyField label={t('expenses.amount')} value={amount} onChangeText={setAmount} required />
      </Section>

      <Section title={t('expenses.class.label')}>
        <SegmentedControl
          options={[
            { value: 'variable', label: t('expenses.class.variable') },
            { value: 'fixed', label: t('expenses.class.fixed') },
          ]}
          value={expenseClass}
          onChange={(v) => {
            setExpenseClass(v as 'variable' | 'fixed');
            // A variable expense has no due date, and cannot be a salary.
            if (v === 'variable') {
              setDueDate('');
              setIsSalary(false);
            }
          }}
        />
        <Text variant="caption" tone="secondary" style={styles.hint}>
          {expenseClass === 'variable'
            ? t('expenses.class.variable.hint')
            : t('expenses.class.fixed.hint')}
        </Text>

        {expenseClass === 'fixed' ? (
          <>
            <TextField
              label={t('expenses.dueDate')}
              hint={t('expenses.dueDate.hint')}
              value={dueDate}
              onChangeText={setDueDate}
              placeholder="2026-09-01"
              required
            />
            <Toggle
              label={t('expenses.salary')}
              hint={t('expenses.salary.hint')}
              value={isSalary}
              onValueChange={setIsSalary}
            />
          </>
        ) : null}
      </Section>

      <Section title={t('expenses.method')}>
        <SegmentedControl
          options={[
            { value: 'cash', label: t('refund.method.cash') },
            { value: 'account', label: t('refund.method.account') },
          ]}
          value={method}
          onChange={(v) => {
            setMethod(v as 'cash' | 'account');
            if (v === 'cash') setAccountId(null);
          }}
        />
        {method === 'account' ? (
          accounts.length === 0 ? (
            <InlineNotice tone="warning" style={styles.hint}>
              {t('expenses.noAccounts')}
            </InlineNotice>
          ) : (
            <View style={styles.accounts}>
              {accounts.map((a) => (
                <Button
                  key={a.id}
                  title={a.label}
                  variant={accountId === a.id ? 'primary' : 'secondary'}
                  fullWidth
                  onPress={() => setAccountId(a.id)}
                />
              ))}
            </View>
          )
        ) : null}
      </Section>

      <Section title={t('expenses.report.detail')}>
        <TextField label={t('expenses.reference')} value={reference} onChangeText={setReference} />
        <TextField
          label={t('expenses.note')}
          hint={t('expenses.note.hint')}
          value={note}
          onChangeText={setNote}
          multiline
        />
      </Section>

      <Card>
        {/* Said before anything is sent: reporting is not spending. */}
        <InlineNotice tone="info">{t('expenses.report.notice')}</InlineNotice>
        {offline ? (
          <InlineNotice tone="danger" style={styles.hint}>
            {t('expenses.offline')}
          </InlineNotice>
        ) : null}
        <Button
          title={t('expenses.report.submit')}
          size="lg"
          fullWidth
          style={styles.hint}
          disabled={!canSubmit}
          loading={report.isPending}
          onPress={() => void submit()}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { marginTop: space.sm },
  accounts: { gap: space.sm, marginTop: space.sm },
});
