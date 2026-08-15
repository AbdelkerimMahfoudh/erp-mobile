import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api-client';
import { space } from '../../lib/design/tokens';
import { formatMoney } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { qk } from '../../lib/query-keys';
import { useSupplierPayable } from '../../lib/suppliers';
import { BottomSheet } from '../overlay/BottomSheet';
import { Button } from '../ui/Button';
import { MoneyField, TextField } from '../ui/Field';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Text } from '../ui/Text';
import type { Settings } from '../../types/api';

/**
 * Recording a payment to a supplier.
 *
 * Two things make this different from the refund sheet, and both are the point:
 * the **amount is chosen** here rather than fixed, and the money has to be told
 * **which purchases it settles**. The allocation is shown before anything is
 * sent — money that lands somewhere nobody looked at is money nobody can
 * explain later.
 *
 * Nothing here contacts a bank, looks up a balance or holds a credential. It
 * records what a person says happened at the counter.
 */
export function SupplierPaymentSheet({
  open,
  onClose,
  supplierId,
  submitting,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  supplierId: string;
  submitting: boolean;
  onSubmit: (input: {
    amount: number;
    method: 'cash' | 'account';
    receivingAccountId?: string;
    allocations: { purchaseId: string; amount: number }[];
    transactionReference?: string;
    note?: string;
  }) => Promise<void>;
}) {
  const { t } = useTranslation();
  // MoneyField is a text field with money formatting, so the typed value is a
  // string until it is parsed. Keeping both apart avoids a half-typed "12."
  // becoming NaN on every keystroke.
  const [amountText, setAmountText] = useState('');
  const amount = amountText.trim() ? Number(amountText) : undefined;
  const [method, setMethod] = useState<'cash' | 'account'>('cash');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');

  // The server does the allocating and returns the split, so what is shown is
  // exactly what would be recorded.
  const payable = useSupplierPayable(open ? supplierId : undefined, amount);

  const settings = useQuery({
    queryKey: qk.settings,
    queryFn: () => api.get<Settings>('/settings'),
    enabled: open && method === 'account',
  });
  const accounts = useMemo(
    () => (settings.data?.receivingAccounts ?? []).filter((a) => ('isActive' in a ? a.isActive : true)),
    [settings.data],
  );

  useEffect(() => {
    if (!open) return;
    setAmountText('');
    setMethod('cash');
    setAccountId(null);
    setReference('');
    setNote('');
  }, [open]);

  const outstanding = payable.data?.outstanding ?? 0;
  const suggested = payable.data?.suggested ?? [];
  const purchaseById = useMemo(
    () => new Map((payable.data?.purchases ?? []).map((p) => [p.purchaseId, p])),
    [payable.data],
  );

  const overOutstanding = Number.isFinite(amount) && (amount ?? 0) > outstanding;
  const needsAccount = method === 'account' && !accountId;
  const canSubmit =
    !submitting &&
    Number.isFinite(amount) &&
    (amount ?? 0) > 0 &&
    !overOutstanding &&
    !needsAccount &&
    suggested.length > 0;

  const submit = async () => {
    if (!canSubmit || amount === undefined) return;
    await onSubmit({
      amount,
      method,
      ...(accountId ? { receivingAccountId: accountId } : {}),
      allocations: suggested,
      ...(reference.trim() ? { transactionReference: reference.trim() } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
  };

  return (
    <BottomSheet open={open} onClose={onClose} title={t('suppliers.pay.title')}>
      <View style={styles.body}>
        <View style={styles.owed}>
          <Text variant="caption" tone="secondary">
            {t('suppliers.pay.outstanding')}
          </Text>
          <Text variant="title">{formatMoney(outstanding)}</Text>
        </View>

        <MoneyField
          label={t('suppliers.pay.amount')}
          value={amountText}
          onChangeText={setAmountText}
          placeholder="0.00"
        />
        {overOutstanding ? (
          // Blocked here as a courtesy; the server refuses it for real.
          <Text variant="caption" tone="danger">
            {t('suppliers.pay.tooMuch', { outstanding: formatMoney(outstanding) })}
          </Text>
        ) : null}

        {/* The whole point: where this money is going, before it goes. */}
        {suggested.length > 0 ? (
          <View style={styles.allocation}>
            <Text variant="label">{t('suppliers.pay.allocation')}</Text>
            <Text variant="caption" tone="tertiary">
              {t('suppliers.pay.allocationHint')}
            </Text>
            {suggested.map((a) => {
              const p = purchaseById.get(a.purchaseId);
              return (
                <View key={a.purchaseId} style={styles.allocationRow}>
                  <Text variant="body" tone="secondary">
                    {t('suppliers.pay.purchaseOf', {
                      ref: a.purchaseId.slice(0, 8).toUpperCase(),
                      outstanding: formatMoney(p?.outstanding ?? 0),
                    })}
                  </Text>
                  <Text variant="bodyStrong">{formatMoney(a.amount)}</Text>
                </View>
              );
            })}
          </View>
        ) : null}

        <Text variant="label">{t('refund.method')}</Text>
        <SegmentedControl
          options={[
            { value: 'cash', label: t('refund.method.cash') },
            { value: 'account', label: t('refund.method.account') },
          ]}
          value={method}
          onChange={(v) => setMethod(v as 'cash' | 'account')}
        />

        {method === 'account' ? (
          accounts.length === 0 ? (
            <Text variant="caption" tone="warning">
              {t('refund.noAccounts')}
            </Text>
          ) : (
            <SegmentedControl
              options={accounts.map((a) => ({ value: a.id, label: a.label }))}
              value={accountId ?? ''}
              onChange={setAccountId}
            />
          )
        ) : null}

        <TextField
          label={t('refund.reference')}
          value={reference}
          onChangeText={setReference}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder={t('refund.reference.placeholder')}
        />
        <TextField
          label={t('refund.note')}
          value={note}
          onChangeText={setNote}
          placeholder={t('refund.note.placeholder')}
        />

        <Text variant="caption" tone="secondary">
          {t('suppliers.pay.stillNeedsApproval')}
        </Text>

        <Button
          title={t('suppliers.pay.submit')}
          onPress={() => void submit()}
          loading={submitting}
          disabled={!canSubmit}
          fullWidth
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.base },
  owed: { gap: space.xs },
  allocation: { gap: space.xs },
  allocationRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
});
