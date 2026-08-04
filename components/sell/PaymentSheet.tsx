import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Plus, X } from 'lucide-react-native';
import { colors } from '../../lib/design/colors';
import { radius, space } from '../../lib/design/tokens';
import { formatMoney } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { uuidv4 } from '../../lib/utils';
import { BottomSheet } from '../overlay/BottomSheet';
import { Button } from '../ui/Button';
import { MoneyField } from '../ui/Field';
import { IconButton } from '../ui/IconButton';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Text } from '../ui/Text';
import type { PaymentEntry } from './types';

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

export interface PaymentSheetProps {
  open: boolean;
  onClose: () => void;
  total: number;
  discount: number;
  onDiscountChange: (discount: number) => void;
  onComplete: (payments: PaymentEntry[]) => void;
  submitting?: boolean;
}

export function PaymentSheet({
  open,
  onClose,
  total,
  discount,
  onDiscountChange,
  onComplete,
  submitting = false,
}: PaymentSheetProps) {
  const { t } = useTranslation();
  const [method, setMethod] = useState<Method>('cash');
  const [split, setSplit] = useState<PaymentEntry[]>([]);

  // Reset each time it opens: a half-built split from a previous sale must
  // never carry into the next one.
  useEffect(() => {
    if (open) {
      setMethod('cash');
      setSplit([]);
    }
  }, [open]);

  const splitTotal = useMemo(
    () => split.reduce((sum, entry) => sum + entry.amount, 0),
    [split],
  );
  const isSplitting = split.length > 0;
  const paid = isSplitting ? splitTotal : total;
  const remaining = Math.round((total - paid) * 100) / 100;
  const settled = Math.abs(remaining) < 0.005;

  const complete = () => {
    if (isSplitting) {
      onComplete(split.filter((entry) => entry.amount > 0));
    } else {
      onComplete([{ key: uuidv4(), method, amount: total }]);
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
            disabled={!settled}
            onPress={complete}
          />
          {!settled ? (
            <Text variant="caption" tone="tertiary" align="center">
              {t('sell.payment.exactOnly')}
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
            <SegmentedControl
              options={METHODS.map((m) => ({ value: m, label: t(`payment.${m}`) }))}
              value={method}
              onChange={setMethod}
            />
          </View>
        ) : (
          <View style={styles.group}>
            <Text variant="label" tone="secondary">
              {t('sell.payment.split')}
            </Text>
            {split.map((entry, index) => (
              <View key={entry.key} style={styles.splitRow}>
                <View style={styles.splitMethod}>
                  <SegmentedControl
                    size="sm"
                    options={METHODS.map((m) => ({ value: m, label: t(`payment.${m}`) }))}
                    value={entry.method}
                    onChange={(next) =>
                      setSplit((prev) =>
                        prev.map((x) => (x.key === entry.key ? { ...x, method: next } : x)),
                      )
                    }
                  />
                </View>
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

const styles = StyleSheet.create({
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
  splitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  splitMethod: {
    flex: 1.4,
  },
  splitAmount: {
    flex: 1,
  },
});
