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
import { FilterChip } from '../ui/Chip';
import { Text } from '../ui/Text';
import { ReturnPolicyControl } from './ReturnPolicyControl';
import type { PaymentEntry } from './types';
import { makeStyles } from '../../lib/design/theme';

/**
 * Taking payment.
 *
 * Opens pre-filled with the full amount on Cash, so the overwhelmingly common
 * sale is a single tap on Complete. Splitting across methods is available but
 * never in the way.
 *
 * The full total must be covered. The backend treats an underpayment as a
 * credit sale and demands a customer to hold the receivable — and there is no
 * customers API yet — so allowing a short payment here would only produce a
 * confusing rejection at the counter. Complete stays disabled until the
 * remainder is zero, and the reason is stated on screen rather than left as a
 * mystery.
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
  onComplete: (payments: PaymentEntry[]) => void;
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
}: PaymentSheetProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  const [method, setMethod] = useState<Method>('cash');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [split, setSplit] = useState<PaymentEntry[]>([]);

  // Reset each time it opens: a half-built split from a previous sale must
  // never carry into the next one.
  useEffect(() => {
    if (open) {
      setMethod('cash');
      setAccountId(null);
      setSplit([]);
    }
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
  const paid = isSplitting ? splitTotal : total;
  const remaining = Math.round((total - paid) * 100) / 100;
  const settled = Math.abs(remaining) < 0.005;

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
    : !needsAccount(method) || Boolean(accountId);

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
      );
    } else {
      onComplete([
        {
          key: uuidv4(),
          method,
          amount: total,
          ...(needsAccount(method) && accountId ? { receivingAccountId: accountId } : {}),
        },
      ]);
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
            disabled={!settled || policyNeedsReason || !accountsSettled}
            onPress={complete}
          />
          {!settled ? (
            <Text variant="caption" tone="tertiary" align="center">
              {t('sell.payment.exactOnly')}
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
          {!settled ? (
            <Text variant="bodyStrong" tone="danger" align="center">
              {t('sell.payment.remaining', { amount: formatMoney(remaining) })}
            </Text>
          ) : null}
        </View>

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
}));
