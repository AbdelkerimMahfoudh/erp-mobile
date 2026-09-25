import React, { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useRouter, type Href } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, CalendarDays, Paperclip } from 'lucide-react-native';
import {
  Button,
  Card,
  Disclosure,
  IconButton,
  InlineNotice,
  MoneyField,
  MoneyValue,
  Screen,
  Section,
  SegmentedControl,
  Text,
  TextField,
  Toggle,
} from '../../components/ui';
import { ReceivedVia, type MoneySource } from '../../components/money/ReceivedVia';
import { api } from '../../lib/api-client';
import { useConnectivity } from '../../lib/connectivity';
import { isRTL } from '../../lib/design/direction';
import { radius, space } from '../../lib/design/tokens';
import { formatDate } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { useDraft } from '../../lib/offline/use-draft';
import { DraftNotice } from '../../components/DraftNotice';
import { toast } from '../../lib/toast';
import { uuidv4 } from '../../lib/utils';
import {
  expenseConflictKind,
  useConfirmRecordedExpense,
  useReportExpense,
  useUploadReceipt,
  type ReceiptPhoto,
} from '../../lib/expenses';
import { previewCashAfterExpense } from '../../lib/expense-rules';
import { useMoneyOverview } from '../../lib/money-overview';
import { usePermission } from '../../lib/permissions';
import { localDay } from '../../lib/sale-payment-rules';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { dialog } from '../../lib/dialog';

interface SettingsResponse {
  receivingAccounts?: { id: string; label: string; provider?: string; providerName?: string | null }[];
}

/**
 * Adding an everyday expense — what it was, how much, paid from where, when,
 * and optionally the receipt. Then a review, because this is money the shop
 * says it has already spent.
 *
 * Who is recording decides what the review means. An **Owner** (anyone with
 * `expense.review`) records what was paid and confirms it in the same breath:
 * the review says what the drawer will read afterwards, and "Record paid
 * expense" reports and confirms in one go — confirmation is still the Owner's
 * own explicit act, made on a screen that names its effect. Anybody else sends
 * a report, and the review says plainly that nothing moves until an Owner
 * confirms it. Either way the server's workflow is unchanged: a report moves
 * nothing, a confirmation moves money out of exactly one source.
 *
 * Description is free text on purpose: no category to pick, no suggested
 * words, no employee to name. Fixed monthly costs, salaries, references and
 * notes are one tap away under "More options" and never in the daily path.
 */
export default function NewExpenseScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const offline = !useConnectivity((s) => s.online);
  const canConfirm = usePermission('expense.review');
  const canViewFigures = usePermission('report.view');

  const [step, setStep] = useState<'form' | 'review'>('form');
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [source, setSource] = useState<MoneySource>({ kind: 'cash' });
  /** Today unless the person says otherwise. The accounting day is still the confirmation day. */
  const [spentOn, setSpentOn] = useState(localDay(new Date()));
  /** Optional. Never saved in the draft: a picked photo's uri may not survive an app kill. */
  const [receipt, setReceipt] = useState<ReceiptPhoto | null>(null);
  const [expenseClass, setExpenseClass] = useState<'variable' | 'fixed'>('variable');
  const [isSalary, setIsSalary] = useState(false);
  const [dueDate, setDueDate] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const uploadReceipt = useUploadReceipt();

  /**
   * The expense form survives an app kill (J.1).
   *
   * Every field here was typed by a person and none of it is a server
   * figure, so all of it can be restored honestly. The receiving account is
   * kept as an id and re-resolved, never as a stored label that could go
   * stale.
   */
  const draft = useDraft(
    'expense.form',
    {
      category,
      amount,
      expenseClass,
      isSalary,
      dueDate,
      method: source.kind,
      accountId: source.kind === 'account' ? source.accountId : null,
      reference,
      note,
      spentOn,
    },
    (v) => {
      setCategory(v.category ?? '');
      setAmount(v.amount ?? '');
      setExpenseClass(v.expenseClass ?? 'variable');
      setIsSalary(Boolean(v.isSalary));
      setDueDate(v.dueDate ?? '');
      setSource(v.method === 'account' ? { kind: 'account', accountId: v.accountId ?? null } : { kind: 'cash' });
      setReference(v.reference ?? '');
      setNote(v.note ?? '');
      setSpentOn(v.spentOn ?? localDay(new Date()));
    },
  );

  /**
   * One request id per logical report, held in a ref so a re-render cannot mint
   * a new one. A fresh id per attempt would defeat idempotency exactly when it
   * matters: a timeout followed by a retry would record two expenses.
   */
  const requestId = useRef<string>(uuidv4());
  const report = useReportExpense();
  const confirm = useConfirmRecordedExpense();

  // Only ACTIVE accounts are offered; the server refuses any other.
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<SettingsResponse>('/settings'),
  });
  const accounts = settings.data?.receivingAccounts ?? [];
  const accountLabel = source.kind === 'account' ? (accounts.find((a) => a.id === source.accountId)?.label ?? null) : null;

  // The drawer matters only to a review that will confirm a cash expense.
  const today = localDay(new Date());
  const overview = useMoneyOverview(today, today, { enabled: canConfirm && canViewFigures && source.kind === 'cash' });

  const amountValue = Number(amount);
  const complete =
    category.trim().length > 0 &&
    amountValue > 0 &&
    (expenseClass === 'variable' || dueDate.length === 10) &&
    (source.kind === 'cash' || Boolean(source.accountId)) &&
    /^\d{4}-\d{2}-\d{2}$/.test(spentOn);
  const busy = report.isPending || confirm.isPending || uploadReceipt.isPending;

  const pickReceipt = async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];
    setReceipt({ uri: asset.uri, mimeType: asset.mimeType ?? null, file: (asset as { file?: unknown }).file });
  };

  const submit = async () => {
    try {
      const created = await report.mutateAsync({
        category: category.trim(),
        amount: amountValue,
        expenseClass,
        isSalary,
        dueDate: expenseClass === 'fixed' ? dueDate : undefined,
        method: source.kind,
        receivingAccountId: source.kind === 'account' ? (source.accountId ?? undefined) : undefined,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
        spentOn,
        clientUuid: requestId.current,
      });
      // The photo is evidence, not the expense: if it fails, the expense stands
      // and the person is told, rather than losing what they already recorded.
      if (receipt) {
        try {
          await uploadReceipt.mutateAsync({ expenseId: created.id, photo: receipt });
        } catch {
          toast.error(t('expenses.receipt.failed'));
        }
      }
      let recorded = false;
      if (canConfirm) {
        // The Owner's own record is the confirmation. An empty note is a
        // knowing omission — the review said so before this was sent.
        try {
          await confirm.mutateAsync({ id: created.id, expectedVersion: created.version, reasonOmitted: note.trim().length === 0 });
          recorded = true;
        } catch {
          toast.error(t('expenses.confirm.failed'));
        }
      }
      draft.clear();
      // The id is deliberately NOT regenerated: the next attempt is a retry of
      // this one and must resolve to the same expense.
      router.replace({ pathname: '/expenses', params: { [recorded ? 'recorded' : 'sent']: '1' } } as Href);
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

  const reviewing = step === 'review';
  const cash = source.kind === 'cash';
  const preview = overview.data ? previewCashAfterExpense(overview.data.cashNow, amountValue) : null;

  return (
    <Screen
      scroll
      gap="lg"
      footer={
        reviewing ? (
          <>
            <Button
              title={canConfirm ? t('expenses.review.record') : t('expenses.report.submit')}
              size="lg"
              fullWidth
              disabled={offline || busy}
              loading={busy}
              onPress={() => void submit()}
            />
            <Button title={t('expenses.review.edit')} variant="secondary" fullWidth onPress={() => setStep('form')} />
          </>
        ) : (
          <Button title={t('expenses.review.action')} size="lg" fullWidth disabled={!complete} onPress={() => setStep('review')} />
        )
      }
    >
      <Stack.Screen
        options={{
          headerShown: true,
          title: reviewing ? t('expenses.review.title') : t('expenses.add.title'),
          headerBackVisible: !reviewing,
          headerLeft: reviewing
            ? () => (
                <IconButton
                  icon={isRTL() ? ArrowRight : ArrowLeft}
                  accessibilityLabel={t('action.back')}
                  onPress={() => setStep('form')}
                />
              )
            : undefined,
        }}
      />

      {reviewing ? (
        <>
          <Text variant="body" tone="secondary">
            {t('expenses.review.subtitle')}
          </Text>
          <Card style={styles.rows}>
            <Row label={t('expenses.category')} value={category.trim()} strong />
            <Row label={t('expenses.amount')} money={amountValue} />
            <Row label={t('expenses.paidFrom')} value={cash ? t('payment.cash') : (accountLabel ?? '')} />
            <Row label={t('expenses.date')} value={formatDate(spentOn)} />
            {expenseClass === 'fixed' ? (
              <Row label={t('expenses.class.label')} value={isSalary ? t('expenses.salary') : t('expenses.class.fixed')} />
            ) : null}
            {receipt ? <Row label={t('expenses.receipt')} value={t('expenses.receipt.attached')} /> : null}
            {note.trim() ? (
              <Row label={t('expenses.note')} value={note.trim()} />
            ) : canConfirm ? (
              <Text variant="caption" tone="tertiary">
                {t('expenses.review.noNote')}
              </Text>
            ) : null}
          </Card>

          {/* What the drawer will read once this is confirmed — for the person
              whose tap confirms it, and only for cash: an account has no
              balance here to preview. */}
          {canConfirm && cash && preview ? (
            <Card variant="accent" style={styles.rows}>
              <Text variant="labelStrong">{t('expenses.review.expectedCash')}</Text>
              <Row label={t('expenses.review.before')} money={preview.before} />
              <Row label={t('expenses.review.expense')} money={-preview.expense} signed />
              <Row label={t('expenses.review.after')} money={preview.after} strong />
            </Card>
          ) : null}

          <Text variant="caption" tone="tertiary" align="center">
            {canConfirm ? t('expenses.review.note') : t('expenses.report.notice')}
          </Text>
          {offline ? <InlineNotice tone="danger">{t('expenses.offline')}</InlineNotice> : null}
        </>
      ) : (
        <>
          <DraftNotice
            draft={draft}
            onDiscard={() => {
              setCategory('');
              setAmount('');
              setNote('');
              setReference('');
            }}
          />
          <Text variant="body" tone="secondary">
            {t('expenses.add.subtitle')}
          </Text>

          <Section gap="md">
            <TextField label={t('expenses.category')} value={category} onChangeText={setCategory} required autoFocus />
            <MoneyField label={t('expenses.amountMru')} value={amount} onChangeText={setAmount} required />
            <ReceivedVia label={t('expenses.paidFrom')} value={source} onChange={setSource} accounts={accounts} />
            <TextField
              label={t('expenses.date')}
              icon={CalendarDays}
              value={spentOn}
              onChangeText={setSpentOn}
              placeholder="2026-09-18"
              hint={spentOn === today ? t('expenses.date.today') : undefined}
              required
            />
            {receipt ? (
              <View style={styles.receipt}>
                <Image source={{ uri: receipt.uri }} style={styles.receiptImage} contentFit="cover" accessibilityLabel={t('expenses.receipt.attached')} />
                <View style={styles.receiptActions}>
                  <Button title={t('expenses.receipt.replace')} variant="secondary" size="sm" onPress={() => void pickReceipt()} />
                  <Button title={t('expenses.receipt.remove')} variant="tertiary" size="sm" onPress={() => setReceipt(null)} />
                </View>
              </View>
            ) : (
              <Button title={t('expenses.receipt.add')} variant="secondary" icon={Paperclip} fullWidth onPress={() => void pickReceipt()} />
            )}
          </Section>

          <Disclosure title={t('expenses.more')}>
            <View style={styles.more}>
              <Text variant="label">{t('expenses.class.label')}</Text>
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
              <Text variant="caption" tone="secondary">
                {expenseClass === 'variable' ? t('expenses.class.variable.hint') : t('expenses.class.fixed.hint')}
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
                  <Toggle label={t('expenses.salary')} hint={t('expenses.salary.hint')} value={isSalary} onValueChange={setIsSalary} />
                </>
              ) : null}
              <TextField label={t('expenses.reference')} value={reference} onChangeText={setReference} />
              <TextField label={t('expenses.note')} hint={t('expenses.note.hint')} value={note} onChangeText={setNote} multiline />
            </View>
          </Disclosure>

          {offline ? <InlineNotice tone="danger">{t('expenses.offline')}</InlineNotice> : null}
        </>
      )}
    </Screen>
  );
}

/** One line of the review: a label, and the value exactly as it will be saved. */
function Row({ label, value, money, signed, strong }: { label: string; value?: string; money?: number; signed?: boolean; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text variant={strong ? 'bodyStrong' : 'body'} tone="secondary" style={styles.rowLabel}>
        {label}
      </Text>
      {money !== undefined ? (
        <MoneyValue value={money} size={strong ? 'default' : 'small'} signed={signed} tone={signed ? 'auto' : 'default'} />
      ) : (
        <Text variant="bodyStrong" align="end" style={styles.rowValue}>
          {value}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  rows: { gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.md },
  rowLabel: { flexShrink: 0 },
  rowValue: { flex: 1 },
  more: { gap: space.md, paddingTop: space.sm },
  receipt: { gap: space.sm },
  receiptImage: { width: '100%', maxWidth: 320, aspectRatio: 3 / 4, borderRadius: radius.md },
  receiptActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
