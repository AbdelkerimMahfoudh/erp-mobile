import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Plus, X } from 'lucide-react-native';
import { radius, space } from '../../lib/design/tokens';
import { formatMoney } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { uuidv4 } from '../../lib/utils';
import { BottomSheet } from '../overlay/BottomSheet';
import { Button } from '../ui/Button';
import { MoneyField } from '../ui/Field';
import { IconButton } from '../ui/IconButton';
import { FilterChip, StatusChip } from '../ui/Chip';
import { Text } from '../ui/Text';
import { ReturnPolicyControl } from './ReturnPolicyControl';
import { DebtorPicker } from './DebtorPicker';
import { debtorProblem, previewSalePayment, type DebtorDraft } from '../../lib/sale-payment-rules';
import type { PaymentEntry } from './types';
import { makeStyles } from '../../lib/design/theme';

/**
 * Taking payment.
 *
 * Opens pre-filled with the full amount on Cash, so the overwhelmingly common
 * sale is a single tap on Complete. Splitting across methods is available but
 * never in the way.
 *
 * Less than the total may be taken (0074). The amount received now defaults to
 * the whole total, so the ordinary sale is still one tap; lowering it shows
 * what remains, what the status will be, and asks who owes the rest — a
 * customer or a partner store. Complete stays disabled until that is answered,
 * and more than the total can never be taken. The server recomputes all of it.
 */

const METHODS = ['cash', 'card', 'mobile', 'bank'] as const;
type Method = (typeof METHODS)[number];

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
const needsAccount = (method: Method) => method !== 'cash';

export interface PaymentSheetProps {
  open: boolean;
  onClose: () => void;
  total: number;
  discount: number;
  onDiscountChange: (discount: number) => void;
  /** The payments taken now, and who owes whatever they leave unpaid. */
  onComplete: (payments: PaymentEntry[], debtor: DebtorDraft) => void;
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

export function PaymentSheet({
  open,
  onClose,
  total,
  discount,
  onDiscountChange,
  onComplete,
  submitting = false,
  accounts,
  returnPolicy,
  presetCustomer = null,
}: PaymentSheetProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  const [method, setMethod] = useState<Method>('cash');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [split, setSplit] = useState<PaymentEntry[]>([]);
  const [receivedText, setReceivedText] = useState(String(total));
  const presetDebtor = (): DebtorDraft =>
    presetCustomer ? { kind: 'customer_existing', customerId: presetCustomer.id, name: presetCustomer.name ?? '' } : { kind: 'none' };
  const [debtor, setDebtor] = useState<DebtorDraft>(presetDebtor);

  // Reset each time it opens: a half-built split from a previous sale must
  // never carry into the next one.
  useEffect(() => {
    if (open) {
      setMethod('cash');
      setAccountId(null);
      setSplit([]);
      setReceivedText(String(total));
      setDebtor(presetDebtor());
    }
    // Reset on OPEN only; the total and the preset are read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** The provider and label, said in full before the sale is completed. */
  const describe = (account: ReceivingAccount) =>
    t('sell.payment.account.chosen', {
      provider:
        account.provider === 'other'
          ? (account.providerName ?? t('payment.provider.other'))
          : t(`payment.provider.${account.provider}` as never),
      label: account.label,
    });

  const accountPicker = (
    selected: string | null,
    onPick: (id: string) => void,
    key: string,
  ) => {
    if (accounts.length === 0) {
      return (
        <Text variant="caption" tone="warning">
          {t('sell.payment.account.none')}
        </Text>
      );
    }
    const chosen = accounts.find((a) => a.id === selected) ?? null;
    return (
      <View style={styles.group}>
        <Text variant="label" tone="secondary">
          {t('sell.payment.account')}
        </Text>
        <View style={styles.chips} accessibilityRole="radiogroup">
          {accounts.map((account) => (
            <FilterChip
              key={`${key}:${account.id}`}
              label={account.label}
              selected={selected === account.id}
              onPress={() => onPick(account.id)}
            />
          ))}
        </View>
        {/* Provider AND label, so nobody confirms against a name alone. */}
        <Text variant="caption" tone={chosen ? 'secondary' : 'warning'}>
          {chosen ? describe(chosen) : t('sell.payment.account.required')}
        </Text>
      </View>
    );
  };

  const splitTotal = useMemo(
    () => split.reduce((sum, entry) => sum + entry.amount, 0),
    [split],
  );
  const isSplitting = split.length > 0;
  const receivedNow = Number(receivedText);
  const paid = isSplitting ? splitTotal : Number.isFinite(receivedNow) && receivedNow > 0 ? receivedNow : 0;
  const remaining = Math.round((total - paid) * 100) / 100;
  /** More than the total is never taken: change is not a payment. */
  const overpaid = remaining < -0.005;
  const preview = previewSalePayment(total, paid);
  const owedBy = debtorProblem(Math.max(0, remaining), debtor);

  const policyChanged = returnPolicy.windowHours !== returnPolicy.companyDefaultHours;
  const policyNeedsReason = policyChanged && returnPolicy.reason.trim().length === 0;

  /**
   * Every non-cash payment must name the account it reached, and the server
   * refuses one that does not. Saying so here — with Complete disabled and the
   * reason on screen — is the difference between a cashier fixing it in a tap
   * and a customer standing at the counter while a sale is rejected.
   */
  const accountsSettled = isSplitting
    ? split.every((entry) => !needsAccount(entry.method as Method) || Boolean(entry.receivingAccountId))
    : paid === 0 || !needsAccount(method) || Boolean(accountId);

  // A fully paid sale owes nobody anything, whoever was picked on the way.
  const debtorToSend: DebtorDraft = remaining > 0.005 ? debtor : { kind: 'none' };

  const complete = () => {
    if (isSplitting) {
      onComplete(
        split
          .filter((entry) => entry.amount > 0)
          .map((entry) => ({
            ...entry,
            // Cash carries no account: the drawer belongs to none, and the
            // database refuses the alternative.
            receivingAccountId: needsAccount(entry.method as Method)
              ? entry.receivingAccountId
              : undefined,
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
                ...(needsAccount(method) && accountId ? { receivingAccountId: accountId } : {}),
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
        // Pre-fill with what is still owed so the common "rest on cash" case
        // needs no typing.
        amount: prev.length === 0 ? total : Math.max(0, remaining),
      },
    ]);
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={t('sell.payment.title')}
      footer={
        <>
          <Button
            title={t('sell.payment.complete')}
            fullWidth
            size="lg"
            loading={submitting}
            disabled={overpaid || owedBy !== null || policyNeedsReason || !accountsSettled}
            onPress={complete}
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
        <View style={styles.totalBlock}>
          <Text variant="caption" tone="tertiary" align="center">
            {t('sell.total')}
          </Text>
          <Text variant="display" align="center">
            {formatMoney(total)}
          </Text>
        </View>

        {!isSplitting ? (
          <MoneyField label={t('recordPayment.amount')} value={receivedText} onChangeText={setReceivedText} />
        ) : null}

        {remaining > 0.005 ? (
          <View style={styles.owed}>
            <View style={styles.owedHead}>
              <View style={styles.grow}>
                <Text variant="caption" tone="secondary">
                  {t('sellDebt.remaining')}
                </Text>
                <Text variant="title">{formatMoney(remaining)}</Text>
              </View>
              <StatusChip domain="sale" value={preview.status} />
            </View>
            <DebtorPicker value={debtor} onChange={setDebtor} onLeave={onClose} />
            <Text variant="caption" tone="tertiary">
              {t('sellDebt.onlyReceived', { amount: formatMoney(paid) })}
            </Text>
          </View>
        ) : null}

        <ReturnPolicyControl {...returnPolicy} />

        <MoneyField
          label={t('sell.discount')}
          value={discount ? String(discount) : ''}
          onChangeText={(text) => onDiscountChange(Number(text) || 0)}
          placeholder="0"
        />

        {!isSplitting ? (
          <View style={styles.group}>
            <Text variant="label" tone="secondary">
              {t('sell.payment.method')}
            </Text>
            {/*
              Chips that wrap, not a segmented bar: four method names in French or
              Arabic do not fit one row at phone width, and a truncated
              "Paieme…" is a choice nobody can read.
            */}
            <View style={styles.chips} accessibilityRole="radiogroup">
              {METHODS.map((m) => (
                <FilterChip
                  key={m}
                  label={t(`payment.${m}`)}
                  selected={method === m}
                  onPress={() => {
                    setMethod(m);
                    // One configured account is not a choice worth making, so
                    // it is pre-picked; cash clears it, because cash has none.
                    setAccountId(needsAccount(m) && accounts.length === 1 ? accounts[0].id : null);
                  }}
                />
              ))}
            </View>
            {needsAccount(method) ? accountPicker(accountId, setAccountId, 'single') : null}
          </View>
        ) : (
          <View style={styles.group}>
            <Text variant="label" tone="secondary">
              {t('sell.payment.split')}
            </Text>
            {split.map((entry, index) => (
              <View key={entry.key} style={styles.splitEntry}>
                <View style={styles.chips} accessibilityRole="radiogroup">
                  {METHODS.map((m) => (
                    <FilterChip
                      key={m}
                      label={t(`payment.${m}`)}
                      selected={entry.method === m}
                      onPress={() =>
                        setSplit((prev) =>
                          prev.map((x) =>
                            x.key === entry.key
                              ? {
                                  ...x,
                                  method: m,
                                  receivingAccountId:
                                    needsAccount(m) && accounts.length === 1 ? accounts[0].id : undefined,
                                }
                              : x,
                          ),
                        )
                      }
                    />
                  ))}
                </View>
                {needsAccount(entry.method as Method)
                  ? accountPicker(
                      entry.receivingAccountId ?? null,
                      (id) =>
                        setSplit((prev) =>
                          prev.map((x) => (x.key === entry.key ? { ...x, receivingAccountId: id } : x)),
                        ),
                      entry.key,
                    )
                  : null}
              <View style={styles.splitRow}>
                <View style={styles.splitAmount}>
                  <MoneyField
                    value={String(entry.amount)}
                    onChangeText={(text) =>
                      setSplit((prev) =>
                        prev.map((x) =>
                          x.key === entry.key ? { ...x, amount: Number(text) || 0 } : x,
                        ),
                      )
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
        )}

        <Button
          title={isSplitting ? t('sell.payment.addMethod') : t('sell.payment.split')}
          variant="tertiary"
          icon={Plus}
          onPress={addSplitRow}
        />
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
  totalBlock: {
    gap: 2,
    paddingVertical: space.md,
    paddingHorizontal: space.base,
    borderRadius: radius.lg,
    backgroundColor: colors.surface.sunken,
  },
  group: {
    gap: space.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
  splitAmount: {
    flex: 1,
  },
  owed: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface.sunken,
  },
  owedHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  grow: { flex: 1 },
}));
