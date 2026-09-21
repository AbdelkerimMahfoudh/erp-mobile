import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Plus, X } from 'lucide-react-native';
import { radius, space } from '../../lib/design/tokens';
import { dialog } from '../../lib/dialog';
import { formatMoney } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { uuidv4 } from '../../lib/utils';
import { BottomSheet } from '../overlay/BottomSheet';
import { Button } from '../ui/Button';
import { Disclosure } from '../ui/Disclosure';
import { MoneyField } from '../ui/Field';
import { IconButton } from '../ui/IconButton';
import { StatusChip } from '../ui/Chip';
import { MoneyValue } from '../ui/MoneyValue';
import { Card } from '../ui/Surface';
import { Text } from '../ui/Text';
import { Thumbnail } from '../ui/Thumbnail';
import { ReceivedVia, type MoneySource } from '../money/ReceivedVia';
import { ReturnPolicyControl } from './ReturnPolicyControl';
import { DebtorPicker } from './DebtorPicker';
import { debtorProblem, methodForAccount, previewSalePayment, type DebtorDraft } from '../../lib/sale-payment-rules';
import type { PaymentEntry } from './types';
import type { PaymentMethod } from '../../types/api';
import { makeStyles } from '../../lib/design/theme';

/**
 * Taking payment.
 *
 * Opens pre-filled with the full amount on Cash, so the overwhelmingly common
 * sale is a single tap on Complete. Where the money arrived is one question —
 * the drawer, or one named account — and the account implies the method.
 * Splitting across methods, a discount and the return policy are there, one
 * tap away under "More options", never in the way.
 *
 * Less than the total may be taken (0074). The amount received now defaults to
 * the whole total, so the ordinary sale is still one tap; lowering it shows
 * what remains, what the status will be, and asks who owes the rest — a
 * customer or a partner store. Complete stays disabled until that is answered,
 * a sale with a balance is reviewed in words before it is sent, and more than
 * the total can never be taken. The server recomputes all of it.
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

export interface PaymentSheetProps {
  open: boolean;
  onClose: () => void;
  total: number;
  discount: number;
  onDiscountChange: (discount: number) => void;
  /** The payments taken now, and who owes whatever they leave unpaid. */
  onComplete: (payments: PaymentEntry[], debtor: DebtorDraft) => void;
  /** What is being sold, said once at the top: "iPhone 13 · 128 GB". */
  summary?: string | null;
  /** The customer already chosen for this sale, if any: the natural debtor. */
  presetCustomer?: { id: string; name: string | null } | null;
  submitting?: boolean;
  /**
   * The shop's active receiving accounts. Empty is a real state — a shop that
   * has configured none can still take cash, and the sheet says why the other
   * methods cannot be completed rather than offering an empty picker.
   */
  accounts: ReceivingAccount[];
  /**
   * The return policy, shown where the sale is actually finished. Stating it at
   * the moment of payment is what makes it get said out loud to the customer.
   */
  returnPolicy: {
    companyDefaultHours: number;
    windowHours: number;
    onWindowChange: (hours: number) => void;
    reason: string;
    onReasonChange: (reason: string) => void;
    canOverride: boolean;
  };
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
  discount,
  onDiscountChange,
  onComplete,
  summary = null,
  submitting = false,
  accounts,
  returnPolicy,
  presetCustomer = null,
}: PaymentSheetProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  const [source, setSource] = useState<MoneySource>({ kind: 'cash' });
  const [split, setSplit] = useState<PaymentEntry[]>([]);
  const [receivedText, setReceivedText] = useState(String(total));
  const [debtor, setDebtor] = useState<DebtorDraft>(() =>
    presetCustomer ? { kind: 'customer_existing', customerId: presetCustomer.id, name: presetCustomer.name ?? '' } : { kind: 'none' },
  );

  const accountOf = (id: string | null | undefined) => accounts.find((a) => a.id === id) ?? null;
  /** The method a source implies: cash, or whatever kind of account it is. */
  const methodOf = (s: MoneySource): PaymentMethod =>
    s.kind === 'cash' ? 'cash' : methodForAccount(accountOf(s.accountId)?.provider ?? 'other');
  const sourceOf = (entry: PaymentEntry): MoneySource =>
    entry.method === 'cash' ? { kind: 'cash' } : { kind: 'account', accountId: entry.receivingAccountId ?? null };

  const splitTotal = useMemo(() => split.reduce((sum, entry) => sum + entry.amount, 0), [split]);
  const isSplitting = split.length > 0;
  const receivedNow = Number(receivedText);
  const paid = isSplitting ? splitTotal : Number.isFinite(receivedNow) && receivedNow > 0 ? receivedNow : 0;
  const remaining = Math.round((total - paid) * 100) / 100;
  /** More than the total is never taken: change is not a payment. */
  const overpaid = remaining < -0.005;
  const preview = previewSalePayment(total, paid);
  const owedBy = debtorProblem(Math.max(0, remaining), debtor);
  const owing = remaining > 0.005;

  const policyChanged = returnPolicy.windowHours !== returnPolicy.companyDefaultHours;
  const policyNeedsReason = policyChanged && returnPolicy.reason.trim().length === 0;

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
  const sourceLabel = source.kind === 'cash' ? t('payment.cash') : (accountOf(source.accountId)?.label ?? '');

  const complete = async () => {
    // A balance is money the shop is agreeing to wait for: say it in words
    // once before it is sent.
    if (owing) {
      const name = debtor.kind === 'none' ? '' : debtor.name;
      const ok = await dialog.confirm({
        title: t('sellDebt.review.title'),
        message: t('sellDebt.review.body', {
          received: formatMoney(paid),
          method: isSplitting ? t('sell.payment.split') : sourceLabel,
          remaining: formatMoney(remaining),
          name,
        }),
        confirmLabel: t('sell.payment.complete'),
      });
      if (!ok) return;
    }
    if (isSplitting) {
      onComplete(
        split
          .filter((entry) => entry.amount > 0)
          .map((entry) => ({
            ...entry,
            // Cash carries no account: the drawer belongs to none, and the
            // database refuses the alternative.
            receivingAccountId: needsAccount(entry.method) ? entry.receivingAccountId : undefined,
          })),
        debtorToSend,
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
              },
            ]
          : [],
        debtorToSend,
      );
    }
  };

  const addSplitRow = () => {
    setSplit((prev) => [
      ...prev,
      {
        key: uuidv4(),
        method: prev.length === 0 ? method : 'cash',
        ...(prev.length === 0 && source.kind === 'account' && source.accountId ? { receivingAccountId: source.accountId } : {}),
        // Pre-fill with what is still owed so the common "rest on cash" case
        // needs no typing.
        amount: prev.length === 0 ? total : Math.max(0, remaining),
      },
    ]);
  };

  const setEntrySource = (key: string, next: MoneySource) =>
    setSplit((prev) =>
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

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={t('sell.payment.title')}
      footer={
        <>
          <Button
            title={owing ? t('sell.payment.review') : t('sell.payment.complete')}
            fullWidth
            size="lg"
            loading={submitting}
            disabled={overpaid || owedBy !== null || policyNeedsReason || !accountsSettled}
            onPress={() => void complete()}
          />
          {overpaid ? (
            <Text variant="caption" tone="tertiary" align="center">
              {t('sell.payment.exactOnly')}
            </Text>
          ) : owedBy ? (
            <Text variant="caption" tone="tertiary" align="center">
              {t(`sellDebt.problem.${owedBy}` as never, { amount: formatMoney(remaining) })}
            </Text>
          ) : !accountsSettled ? (
            <Text variant="caption" tone="tertiary" align="center">
              {t('sell.payment.account.required')}
            </Text>
          ) : policyNeedsReason ? (
            <Text variant="caption" tone="tertiary" align="center">
              {t('returns.policy.reasonRequired')}
            </Text>
          ) : null}
        </>
      }
    >
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        {summary ? (
          <View style={styles.what}>
            <Thumbnail />
            <Text variant="bodyStrong" numberOfLines={2} style={styles.grow}>
              {summary}
            </Text>
          </View>
        ) : null}

        <View style={styles.totalBlock}>
          <Text variant="caption" tone="secondary">
            {t('saleDetail.total')}
          </Text>
          <MoneyValue value={total} size="large" />
        </View>

        {!isSplitting ? (
          <>
            <MoneyField label={t('sell.payment.receivedNow')} value={receivedText} onChangeText={setReceivedText} />
            <ReceivedVia label={t('recordPayment.method')} value={source} onChange={setSource} accounts={accounts} />
          </>
        ) : null}

        {remaining > 0.005 ? (
          <>
            <Card variant="warning" style={styles.owed}>
              <View style={styles.grow}>
                <Text variant="caption" tone="secondary">
                  {t('sellDebt.remaining')}
                </Text>
                <MoneyValue value={remaining} size="large" />
              </View>
              <StatusChip domain="sale" value={preview.status} />
            </Card>
            <DebtorPicker value={debtor} onChange={setDebtor} onLeave={onClose} />
            <Text variant="caption" tone="tertiary">
              {t('sellDebt.onlyReceived', { amount: formatMoney(paid) })}
            </Text>
          </>
        ) : null}

        <Disclosure title={t('sell.payment.moreOptions')} initiallyOpen={isSplitting}>
          <View style={styles.more}>
            <ReturnPolicyControl {...returnPolicy} />

            <MoneyField
              label={t('sell.discount')}
              value={discount ? String(discount) : ''}
              onChangeText={(text) => onDiscountChange(Number(text) || 0)}
              placeholder="0"
            />

            {isSplitting ? (
              <View style={styles.group}>
                <Text variant="label" tone="secondary">
                  {t('sell.payment.split')}
                </Text>
                {split.map((entry, index) => (
                  <View key={entry.key} style={styles.splitEntry}>
                    <ReceivedVia
                      label={t('recordPayment.method')}
                      value={sourceOf(entry)}
                      onChange={(next) => setEntrySource(entry.key, next)}
                      accounts={accounts}
                    />
                    <View style={styles.splitRow}>
                      <View style={styles.grow}>
                        <MoneyField
                          value={String(entry.amount)}
                          onChangeText={(text) =>
                            setSplit((prev) => prev.map((x) => (x.key === entry.key ? { ...x, amount: Number(text) || 0 } : x)))
                          }
                          showCurrency={false}
                        />
                      </View>
                      <IconButton
                        icon={X}
                        accessibilityLabel={t('action.remove')}
                        size={36}
                        onPress={() => setSplit((prev) => prev.filter((x) => x.key !== entry.key))}
                        disabled={index === 0 && split.length === 1}
                      />
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            <Button
              title={isSplitting ? t('sell.payment.addMethod') : t('sell.payment.split')}
              variant="tertiary"
              icon={Plus}
              onPress={addSplitRow}
            />
          </View>
        </Disclosure>
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
  owed: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  more: { gap: space.base, paddingTop: space.sm },
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
