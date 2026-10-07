import React, { useState } from 'react';
import { View } from 'react-native';
import { BottomSheet } from '../overlay/BottomSheet';
import { Button, Text, TextField } from '../ui';
import { PayerNumberField } from '../sell/PayerNumberField';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { toFriendlyError } from '../../lib/errors';
import { useTranslation } from '../../lib/i18n';
import { parsePayerNumber } from '../../lib/payer-number';
import { useCorrectPayerNumber } from '../../lib/sales';
import { toast } from '../../lib/toast';
import type { SalePaymentRecord } from '../../types/api';

/**
 * Correct the number a non-cash payment came from (docs/21 D151) — from the
 * sale it belongs to, where the number is read. Only the number changes: the
 * sheet says so, the server enforces it, and the audit keeps before and after.
 * Clearing the field removes the number. Values stay typed after a failure.
 */
export function PayerNumberSheet({ saleId, payment, onClose }: { saleId: string; payment: SalePaymentRecord; onClose: () => void }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const correct = useCorrectPayerNumber(saleId);
  const [typed, setTyped] = useState(payment.payerNumber ?? '');
  const [reason, setReason] = useState('');
  const parsed = parsePayerNumber(typed);
  const unchanged = parsed.ok && parsed.value === payment.payerNumber;

  const save = async () => {
    if (!parsed.ok) return;
    try {
      await correct.mutateAsync({ paymentId: payment.id, payerNumber: parsed.value, reason });
      toast.success(t('saleDetail.payer.saved'));
      onClose();
    } catch (e) {
      toast.error(toFriendlyError(e).body || t('correctTx.failed'));
    }
  };

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={t('saleDetail.payer.title')}
      footer={
        <Button
          title={t('saleDetail.payer.save')}
          fullWidth
          size="lg"
          loading={correct.isPending}
          disabled={!parsed.ok || unchanged || correct.isPending}
          onPress={() => void save()}
        />
      }
    >
      <View style={styles.sheet}>
        <Text variant="body" tone="secondary">
          {t('saleDetail.payer.body')}
        </Text>
        <PayerNumberField value={typed} onChangeText={setTyped} />
        <TextField label={t('saleDetail.payer.reason')} value={reason} onChangeText={setReason} maxLength={255} />
      </View>
    </BottomSheet>
  );
}

const useStyles = makeStyles(() => ({
  sheet: { gap: space.md, paddingVertical: space.sm },
}));
