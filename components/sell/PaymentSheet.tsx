import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Plus, X } from 'lucide-react-native';
import { isolateLtr } from '../../lib/design/direction';
import { radius, space } from '../../lib/design/tokens';
import { dialog } from '../../lib/dialog';
import { formatDate, formatMoney } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { uuidv4 } from '../../lib/utils';
import { BottomSheet } from '../overlay/BottomSheet';
import { Button } from '../ui/Button';
import { FilterChip, StatusChip } from '../ui/Chip';
import { MoneyField, TextField } from '../ui/Field';
import { IconButton } from '../ui/IconButton';
import { MoneyValue } from '../ui/MoneyValue';
import { Card } from '../ui/Surface';
import { Text } from '../ui/Text';
import { Thumbnail } from '../ui/Thumbnail';
import type { CategoryIllustration } from '../../lib/category-illustration';
import { ReceivedVia, type MoneySource } from '../money/ReceivedVia';
import { DebtorPicker } from './DebtorPicker';
import { PayerNumberField } from './PayerNumberField';
import { parsePayerNumber, payerNumberField, PAYER_NUMBER_MAX_DIGITS } from '../../lib/payer-number';
import {
  amountProblem,
  debtorProblem,
  dueDatePreview,
  MAX_PAYMENT_METHODS,
  methodForAccount,
  nextFreeSource,
  previewSalePayment,
  splitProblem,
  type DebtorDraft,
} from '../../lib/sale-payment-rules';
import type { PaymentEntry } from './types';
import type { PaymentMethod } from '../../types/api';
import { makeStyles } from '../../lib/design/theme';

/**
 * Taking payment (the owner's brief of 2026-10-17, Pictures 2 and 3).
 *
 * Opens pre-filled with the full amount on Cash, so the overwhelmingly common
 * sale is a single tap on Confirm payment. Where the money arrived is one
 * question — the drawer, or one named account — and the account implies the
 * method. Splitting across methods is its own control under it. The discount
 * and the return policy are decided on the Review sale screen, before this
 * sheet opens; the total here already carries the discount.
 *
 * Less than the total may be taken (0074). The amount received now defaults to
 * the whole total; lowering it shows what remains. Confirm payment then asks
 * once, in words — "The customer still owes 100 MRU. Record this sale with an
 * outstanding balance?" — and Go back changes nothing. Record outstanding
 * balance opens the debt card: who owes it (a customer by name and phone, new or
 * from the list, or a partner store) and in how many days it is due. Confirm
 * payment stays shut until that is valid. Changing the amount afterwards
 * recalculates what is owed and asks again before anything is sent. More than
 * the total can never be taken. The server recomputes all of it, and records
 * the balance as the sale's own receivable — never a loan.
 *
 * A split takes the money in at most four places — the drawer counts as one —
 * each place once (2026-09-27); a fifth is refused with the reason on screen,
 * and so is the server's. Its parts are judged as one method is: they pay all
 * or part of the sale, never more than the total, and whatever they leave is
 * owed by a named debtor. A split starts from the amount already typed and,
 * down to its last part removed, goes back to one method with that amount.
 * Every amount is judged as typed: past two decimals, nothing is sent.
 *
 * A non-cash place may carry the number the money came from (D151): optional,
 * one per part, kept by the part's own key so adding or removing a part can
 * never hand one part's number to another. Choosing Cash for a place drops its
 * number; moving between accounts keeps it.
 */

/** A configured place non-cash money can land. Only ACTIVE ones are offered. */
export interface ReceivingAccount {
  id: string;
  label: string;
  provider: 'bankily' | 'sedad' | 'bim_bank' | 'other';
  providerName?: string | null;
  /** Present on an Owner's settings view; `false` means it may not take new payments. */
  isActive?: boolean;
}

/**
 * Cash belongs to no account — the drawer is not a Bankily wallet, and the
 * server refuses an account on a cash payment. Everything else must name one.
 */
const needsAccount = (method: PaymentMethod) => method !== 'cash';

/** A split part while it is typed: its amount is the field's text, as the received amount is. */
type SplitPart = Omit<PaymentEntry, 'amount'> & { amountText: string };

export interface PaymentSheetProps {
  open: boolean;
  onClose: () => void;
  /** What the sale costs the customer, the discount already taken off on the Review sale screen. */
  total: number;
  /** The payments taken now, who owes whatever they leave unpaid, and in how many days it is due (null when nothing is). */
  onComplete: (payments: PaymentEntry[], debtor: DebtorDraft, dueInDays: number | null) => void;
  /** What is being sold, said once at the top: "iPhone 13 · 128 GB". */
  summary?: string | null;
  /** The picture of what is being sold, from its category (D225). The neutral generic when absent. */
  illustration?: CategoryIllustration;
  /** The customer already chosen for this sale, if any: the natural debtor. */
  presetCustomer?: { id: string; name: string | null; phone?: string | null } | null;
  submitting?: boolean;
  /**
   * The shop's active receiving accounts. Empty is a real state — a shop that
   * has configured none can still take cash, and the sheet says why the other
   * methods cannot be completed rather than offering an empty picker.
   */
  accounts: ReceivingAccount[];
}

/**
 * Fresh each time it opens: a half-built split from a previous sale must never
 * carry into the next one. Opening remounts the sheet's state under a new key,
 * so the total and the preset customer are read at that moment and nothing
 * needs syncing afterwards. Closing keeps the key, so the sheet slides away
 * with its contents rather than emptying mid-animation.
 */
export function PaymentSheet(props: PaymentSheetProps) {
  const [wasOpen, setWasOpen] = useState(props.open);
  const [opening, setOpening] = useState(0);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setOpening((n) => n + 1);
  }
  return <PaymentSheetBody key={opening} {...props} />;
}

function PaymentSheetBody({
  open,
  onClose,
  total,
  onComplete,
  summary = null,
  illustration,
  submitting = false,
  accounts,
  presetCustomer = null,
}: PaymentSheetProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  const [source, setSource] = useState<MoneySource>({ kind: 'cash' });
  /** The split's parts, each amount kept as typed so a decimal point on its way to "1500.5" survives. */
  const [parts, setParts] = useState<SplitPart[]>([]);
  /** A fifth method, or a part with no place left, was asked for: said until a part is removed. */
  const [limitHit, setLimitHit] = useState<'max' | 'noPlace' | null>(null);
  const [receivedText, setReceivedText] = useState(String(total));
  /** The payer number typed for the one method, as typed (D151). */
  const [payerText, setPayerText] = useState('');
  /** Each split part's payer number, as typed, by the part's key — never by its position. */
  const [partPayers, setPartPayers] = useState<Record<string, string>>({});
  const [debtor, setDebtor] = useState<DebtorDraft>(() =>
    presetCustomer
      ? { kind: 'customer_existing', customerId: presetCustomer.id, name: presetCustomer.name ?? '', phone: presetCustomer.phone ?? null }
      : { kind: 'none' },
  );
  /** In how many days the balance is due, as typed. */
  const [dueDaysText, setDueDaysText] = useState('');
  /**
   * The balance the person agreed to record, through "Record outstanding
   * balance". The debt card shows only once they have; a different balance —
   * the amount received changed — is asked about again before anything is sent.
   */
  const [agreedBalance, setAgreedBalance] = useState<number | null>(null);

  const accountOf = (id: string | null | undefined) => accounts.find((a) => a.id === id) ?? null;
  /** The method a source implies: cash, or whatever kind of account it is. */
  const methodOf = (s: MoneySource): PaymentMethod =>
    s.kind === 'cash' ? 'cash' : methodForAccount(accountOf(s.accountId)?.provider ?? 'other');
  const sourceOf = (entry: Pick<PaymentEntry, 'method' | 'receivingAccountId'>): MoneySource =>
    entry.method === 'cash' ? { kind: 'cash' } : { kind: 'account', accountId: entry.receivingAccountId ?? null };

  /** The parts in numbers, for the figures and the request: a blank or unfinished amount reads 0 or NaN, and splitProblem stops it. */
  const split = useMemo<PaymentEntry[]>(() => parts.map(({ amountText, ...part }) => ({ ...part, amount: Number(amountText) })), [parts]);
  const splitTotal = useMemo(() => split.reduce((sum, entry) => sum + (Number.isFinite(entry.amount) ? entry.amount : 0), 0), [split]);
  const isSplitting = split.length > 0;
  const receivedNow = Number(receivedText);
  const paid = isSplitting ? splitTotal : Number.isFinite(receivedNow) && receivedNow > 0 ? receivedNow : 0;
  const remaining = Math.round((total - paid) * 100) / 100;
  /** More than the total is never taken, split or not: change is not a payment. */
  const overpaid = remaining < -0.005;
  const preview = previewSalePayment(total, paid);
  // Whatever the money taken now leaves, one method or four, is owed by a named debtor.
  const owing = remaining > 0.005;
  const debtOpen = owing && agreedBalance !== null;
  const owedBy = debtOpen ? debtorProblem(remaining, debtor, dueDaysText) : null;
  const dueDays = Number(dueDaysText.trim());
  // Judged as typed: blank is nothing received now (or a part still to type), past two decimals is never sent.
  const splitIssue = isSplitting ? splitProblem(parts) : null;
  const amountBad = isSplitting ? splitIssue === 'bad_amount' : amountProblem(receivedText) === 'bad_amount';
  // Whole units, unless a figure carries cents: then every figure shows them, so received and owed add up to the total shown.
  const decimals = [total, paid, remaining, ...split.map((entry) => entry.amount)].some((v) => Number.isFinite(v) && Math.round(v * 100) % 100 !== 0) ? 2 : 0;

  /**
   * Every non-cash payment must name the account it reached, and the server
   * refuses one that does not. Saying so here — with Complete disabled and the
   * reason on screen — is the difference between a cashier fixing it in a tap
   * and a customer standing at the counter while a sale is rejected.
   */
  const accountsSettled = isSplitting
    ? split.every((entry) => !needsAccount(entry.method) || Boolean(entry.receivingAccountId))
    : paid === 0 || source.kind === 'cash' || Boolean(source.accountId);

  // A fully paid sale owes nobody anything, whoever was picked on the way.
  const debtorToSend: DebtorDraft = owing ? debtor : { kind: 'none' };

  const method = methodOf(source);

  /**
   * The payer numbers (D151): judged as typed, sent normalised, only for money
   * that is not cash. A malformed one holds Complete with the reason on screen;
   * a blank one is simply none.
   */
  const payerIssue = (isSplitting
    ? split.filter((entry) => needsAccount(entry.method)).map((entry) => parsePayerNumber(partPayers[entry.key]))
    : source.kind === 'account'
      ? [parsePayerNumber(payerText)]
      : []
  ).find((parsed) => !parsed.ok);
  const payerBad = payerIssue !== undefined;
  const payerFields = payerNumberField;
  /** A part’s payer number leaves with the part, or with the account it was typed for. */
  const dropPayer = (key: string) =>
    setPartPayers((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  /** Choosing Cash for the one method drops its payer number; moving between accounts keeps it. */
  const chooseSource = (next: MoneySource) => {
    setSource(next);
    if (next.kind === 'cash') setPayerText('');
  };

  const complete = async () => {
    // Money left owing is a decision: asked once in words, and again whenever the balance changed since.
    if (owing && agreedBalance !== remaining) {
      const amount = isolateLtr(formatMoney(remaining, { decimals }));
      const record = await dialog.confirm({
        title: t('sellDebt.ask.title'),
        message: paid > 0 ? t('sellDebt.ask.body', { amount }) : t('sellDebt.ask.bodyNothing', { amount }),
        confirmLabel: t('sellDebt.ask.record'),
        cancelLabel: t('sellDebt.ask.back'),
      });
      // Go back: everything typed stays, nothing is created.
      if (record) setAgreedBalance(remaining);
      return;
    }
    const due = owing ? dueDays : null;
    if (isSplitting) {
      onComplete(
        split.map((entry) => ({
          ...entry,
          // Cash carries no account: the drawer belongs to none, and the
          // database refuses the alternative.
          receivingAccountId: needsAccount(entry.method) ? entry.receivingAccountId : undefined,
          // The number THIS part came from, found by the part's key — never another part's (D151).
          ...payerFields(entry.method, partPayers[entry.key]),
        })),
        debtorToSend,
        due,
      );
    } else {
      onComplete(
        // Nothing received now is a real sale: the whole total is then owed.
        paid > 0
          ? [
              {
                key: uuidv4(),
                method,
                amount: paid,
                ...(source.kind === 'account' && source.accountId ? { receivingAccountId: source.accountId } : {}),
                ...payerFields(method, payerText),
              },
            ]
          : [],
        debtorToSend,
        due,
      );
    }
  };

  const addSplitRow = () => {
    if (split.length >= MAX_PAYMENT_METHODS) {
      setLimitHit('max');
      return;
    }
    // Every place this shop has is already taken: a new part would only repeat one.
    if (split.length > 0 && nextFreeSource(split, accounts.map((a) => a.id)) === null) {
      setLimitHit('noPlace');
      return;
    }
    // The first part is the one method so far: it keeps that method's payer number, under its own new key.
    const firstKey = uuidv4();
    if (parts.length === 0 && source.kind === 'account' && payerText) setPartPayers({ [firstKey]: payerText });
    setParts((prev) => {
      if (prev.length === 0) {
        // The first part keeps what was typed as received now, when the sale can take it; otherwise the whole total.
        const typed = Number(receivedText);
        return [
          {
            key: firstKey,
            method,
            ...(source.kind === 'account' && source.accountId ? { receivingAccountId: source.accountId } : {}),
            amountText: Number.isFinite(typed) && typed > 0 && typed <= total ? receivedText : String(total),
          },
        ];
      }
      // A new part takes a place no part uses yet, and what is still due, so the common "rest elsewhere" needs no typing.
      // With nothing left due it starts empty, ready for a figure rather than a 0 to delete first.
      const next = nextFreeSource(prev, accounts.map((a) => a.id));
      if (next === null) return prev;
      const covered = prev.reduce((sum, part) => sum + (Number(part.amountText) || 0), 0);
      const due = Math.round((total - covered) * 100) / 100;
      return [
        ...prev,
        {
          key: uuidv4(),
          method: methodOf(next),
          ...(next.kind === 'account' ? { receivingAccountId: next.accountId } : {}),
          amountText: due > 0 ? String(due) : '',
        },
      ];
    });
  };
  const removeSplitRow = (key: string) => {
    // The last part removed is the one method again, with that part's amount and place: nothing typed is lost.
    const last = parts.length === 1 && parts[0].key === key ? parts[0] : null;
    if (last) {
      setReceivedText(last.amountText);
      setSource(sourceOf(last));
    }
    // Back to one method, that part's payer number comes with it; a removed part takes its number away with it.
    if (last) setPayerText(needsAccount(last.method) ? (partPayers[key] ?? '') : '');
    dropPayer(key);
    setParts((prev) => prev.filter((x) => x.key !== key));
    setLimitHit(null);
  };
  /** A part's account choices: every account except those another part already uses. */
  const accountsFor = (entry: SplitPart) =>
    accounts.filter((a) => a.id === entry.receivingAccountId || !split.some((o) => o.key !== entry.key && o.method !== 'cash' && o.receivingAccountId === a.id));
  const splitSum = Math.round(splitTotal * 100) / 100;

  const setEntrySource = (key: string, next: MoneySource) => {
    setParts((prev) =>
      prev.map((x) =>
        x.key === key
          ? {
              ...x,
              method: methodOf(next),
              receivingAccountId: next.kind === 'account' ? (next.accountId ?? undefined) : undefined,
            }
          : x,
      ),
    );
    // Cash was paid in notes: the part's payer number goes; moving between accounts keeps it (D151).
    if (next.kind === 'cash') dropPayer(key);
  };

  /** The debt card (the owner's brief of 2026-10-17): what is owed, by whom, and when it is due. */
  const debtCard = debtOpen ? (
    <Card style={styles.debt}>
      <Text variant="labelStrong">{t('sellDebt.card.title')}</Text>
      <View style={styles.owed}>
        <View style={styles.owedFigure}>
          <Text variant="caption" tone="secondary">
            {t('sellDebt.card.outstanding')}
          </Text>
          <MoneyValue value={remaining} size="large" decimals={decimals} />
        </View>
        <StatusChip domain="sale" value={preview.status} />
      </View>
      <DebtorPicker value={debtor} onChange={setDebtor} onLeave={onClose} />
      <TextField
        label={t('sellDebt.days')}
        accessibilityLabel={t('sellDebt.days')}
        value={dueDaysText}
        onChangeText={(text) => setDueDaysText(text.replace(/[^0-9٠-٩]/g, '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)))}
        keyboardType="number-pad"
        maxLength={3}
        required
      />
      <View style={styles.chips}>
        {[7, 15, 30].map((days) => (
          <FilterChip key={days} label={t('returns.window.days', { count: days })} selected={dueDaysText === String(days)} onPress={() => setDueDaysText(String(days))} />
        ))}
      </View>
      {Number.isInteger(dueDays) && dueDays > 0 && dueDays <= 365 ? (
        <Text variant="bodyStrong">{t('sellDebt.dueOn', { date: formatDate(dueDatePreview(dueDays)) })}</Text>
      ) : null}
      <Text variant="caption" tone="tertiary">
        {t('sellDebt.dueNote')}
      </Text>
      <Text variant="caption" tone="tertiary">
        {t('sellDebt.onlyReceived', { amount: isolateLtr(formatMoney(paid, { decimals })) })}
      </Text>
    </Card>
  ) : null;

  /** What remains while it has not been agreed: one quiet line under the amount. */
  const remainingLine =
    owing && !debtOpen ? (
      <View style={styles.owed}>
        <Text variant="body" tone="secondary">
          {t('sellDebt.remaining')}
        </Text>
        <MoneyValue value={remaining} decimals={decimals} />
      </View>
    ) : null;

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={t('sell.payment.title')}
      footer={
        <>
          <Button
            title={t('sell.payment.confirm')}
            fullWidth
            size="lg"
            loading={submitting}
            disabled={amountBad || overpaid || owedBy !== null || !accountsSettled || splitIssue !== null || payerBad}
            onPress={() => void complete()}
          />
          {amountBad ? (
            <Text variant="caption" tone="tertiary" align="center">
              {t('closeDay.count.invalid')}
            </Text>
          ) : overpaid ? (
            <Text variant="caption" tone="tertiary" align="center">
              {isSplitting
                ? t('sell.payment.split.over', { sum: formatMoney(splitSum, { decimals }), total: formatMoney(total, { decimals }) })
                : t('sell.payment.exactOnly')}
            </Text>
          ) : owedBy ? (
            <Text variant="caption" tone="tertiary" align="center">
              {t(`sellDebt.problem.${owedBy}` as never, { amount: isolateLtr(formatMoney(remaining, { decimals })) })}
            </Text>
          ) : !accountsSettled ? (
            <Text variant="caption" tone="tertiary" align="center">
              {t('sell.payment.account.required')}
            </Text>
          ) : splitIssue ? (
            <Text variant="caption" tone="tertiary" align="center">
              {t(
                splitIssue === 'too_many'
                  ? 'sell.payment.split.max'
                  : splitIssue === 'duplicate'
                    ? 'sell.payment.split.duplicate'
                    : 'sell.payment.split.empty',
              )}
            </Text>
          ) : payerIssue && !payerIssue.ok ? (
            <Text variant="caption" tone="tertiary" align="center">
              {payerIssue.reason === 'too_long'
                ? t('sell.payment.payerNumber.tooLong', { max: PAYER_NUMBER_MAX_DIGITS })
                : t('sell.payment.payerNumber.invalid')}
            </Text>
          ) : null}
        </>
      }
    >
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        {summary ? (
          <View style={styles.what}>
            <Thumbnail illustration={illustration} />
            <Text variant="bodyStrong" numberOfLines={2} style={styles.grow}>
              {summary}
            </Text>
          </View>
        ) : null}

        <View style={styles.totalBlock}>
          <Text variant="caption" tone="secondary">
            {t('saleDetail.total')}
          </Text>
          <MoneyValue value={total} size="large" decimals={decimals} />
        </View>

        {!isSplitting ? (
          <>
            <MoneyField
              label={t('sell.payment.receivedNow')}
              accessibilityLabel={t('sell.payment.receivedNow')}
              value={receivedText}
              onChangeText={setReceivedText}
            />
            {remainingLine}
            <ReceivedVia label={t('recordPayment.method')} value={source} onChange={chooseSource} accounts={accounts} />
            {source.kind === 'account' ? <PayerNumberField value={payerText} onChangeText={setPayerText} /> : null}
          </>
        ) : (
          <View style={styles.group}>
            <Text variant="label" tone="secondary">
              {t('sell.payment.split')}
            </Text>
            {parts.map((entry) => (
              <View key={entry.key} style={styles.splitEntry}>
                <ReceivedVia
                  label={t('recordPayment.method')}
                  value={sourceOf(entry)}
                  onChange={(next) => setEntrySource(entry.key, next)}
                  accounts={accountsFor(entry)}
                />
                <View style={styles.splitRow}>
                  <View style={styles.grow}>
                    <MoneyField
                      value={entry.amountText}
                      onChangeText={(text) =>
                        setParts((prev) => prev.map((x) => (x.key === entry.key ? { ...x, amountText: text } : x)))
                      }
                      showCurrency={false}
                    />
                  </View>
                  <IconButton icon={X} accessibilityLabel={t('action.remove')} size={36} onPress={() => removeSplitRow(entry.key)} />
                </View>
                {needsAccount(entry.method) ? (
                  <PayerNumberField
                    value={partPayers[entry.key] ?? ''}
                    onChangeText={(text) => setPartPayers((prev) => ({ ...prev, [entry.key]: text }))}
                  />
                ) : null}
              </View>
            ))}
            {remainingLine}
          </View>
        )}

        {/* Split payment, its own control: never hidden behind another section. */}
        <Button
          title={isSplitting ? t('sell.payment.addMethod') : t('sell.payment.split')}
          variant="secondary"
          icon={Plus}
          onPress={addSplitRow}
        />
        {limitHit ? (
          <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
            {t(limitHit === 'max' ? 'sell.payment.split.max' : 'sell.payment.split.noPlace')}
          </Text>
        ) : null}

        {/* After the money, so nothing jumps above the amount being typed. */}
        {debtCard}
      </ScrollView>
    </BottomSheet>
  );
}

const useStyles = makeStyles((colors) => ({
  body: {
    paddingHorizontal: space.lg,
    paddingBottom: space.base,
    gap: space.base,
  },
  what: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  grow: { flex: 1, minWidth: 0 },
  totalBlock: {
    gap: 2,
    paddingVertical: space.md,
    paddingHorizontal: space.base,
    borderRadius: radius.lg,
    backgroundColor: colors.surface.sunken,
  },
  debt: { gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  owed: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  /** Wide enough for the figure; the chip wraps beneath when the phone is narrow. */
  owedFigure: { flexGrow: 1, minWidth: 150 },
  group: {
    gap: space.sm,
  },
  splitEntry: {
    gap: space.sm,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.subtle,
  },
  splitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
}));
