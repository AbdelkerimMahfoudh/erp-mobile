import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { FilterChip, Text } from '../ui';
import { api } from '../../lib/api-client';
import { space } from '../../lib/design/tokens';
import { useTranslation } from '../../lib/i18n';
import { qk } from '../../lib/query-keys';
import type { ReceivingAccount } from '../sell/PaymentSheet';

/**
 * How a purchase was paid (first release).
 *
 * Every ordinary purchase is paid in full when it is received, so the only
 * question is HOW: cash from the drawer, or an active account. There is no
 * amount to type and no "paid / unpaid" choice — the server sets the amount to
 * the purchase total. The same method names and account wording as a sale, so
 * one shop never learns two vocabularies for one idea.
 */

export const PURCHASE_METHODS = ['cash', 'card', 'mobile', 'bank'] as const;
export type PurchaseMethod = (typeof PURCHASE_METHODS)[number];

export interface PurchasePayment {
  method: PurchaseMethod;
  receivingAccountId: string | null;
}

/** Ready to submit: cash, or a non-cash method with an account chosen. */
export function purchasePaymentReady(p: PurchasePayment): boolean {
  return p.method === 'cash' || Boolean(p.receivingAccountId);
}

/** The request fields, exactly as the server contract names them. */
export function purchasePaymentBody(p: PurchasePayment) {
  return {
    paymentMethod: p.method,
    ...(p.method !== 'cash' && p.receivingAccountId ? { receivingAccountId: p.receivingAccountId } : {}),
  };
}

export function PurchasePaymentPicker({
  value,
  onChange,
}: {
  value: PurchasePayment;
  onChange: (next: PurchasePayment) => void;
}) {
  const { t } = useTranslation();
  const settings = useQuery({
    queryKey: qk.settings,
    queryFn: () => api.get<{ receivingAccounts?: (ReceivingAccount & { isActive?: boolean })[] }>('/settings'),
  });
  // An Owner's settings include deactivated accounts; the server refuses them, so they are never offered.
  const accounts = (settings.data?.receivingAccounts ?? []).filter((a) => a.isActive !== false);

  const providerOf = (a: ReceivingAccount) =>
    a.provider === 'other' ? (a.providerName ?? t('payment.provider.other')) : t(`payment.provider.${a.provider}` as never);

  return (
    <View style={styles.group}>
      <Text variant="label" tone="secondary">
        {t('receive.payment.title')}
      </Text>
      <View style={styles.chips} accessibilityRole="radiogroup">
        {PURCHASE_METHODS.map((m) => (
          <FilterChip
            key={m}
            label={t(`payment.${m}`)}
            selected={value.method === m}
            onPress={() =>
              onChange({
                method: m,
                // One account is not a choice worth making; cash has none.
                receivingAccountId: m !== 'cash' && accounts.length === 1 ? accounts[0].id : null,
              })
            }
          />
        ))}
      </View>

      {value.method !== 'cash' ? (
        accounts.length === 0 ? (
          <Text variant="caption" tone="warning">
            {t('sell.payment.account.none')}
          </Text>
        ) : (
          <View style={styles.chips} accessibilityRole="radiogroup">
            {accounts.map((a) => (
              <FilterChip
                key={a.id}
                label={`${providerOf(a)} · ${a.label}`}
                selected={value.receivingAccountId === a.id}
                onPress={() => onChange({ ...value, receivingAccountId: a.id })}
              />
            ))}
          </View>
        )
      ) : null}

      <Text variant="caption" tone="tertiary">
        {t('receive.payment.hint')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
});
