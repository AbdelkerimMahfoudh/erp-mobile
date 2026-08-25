import React, { useState } from 'react';
import { View } from 'react-native';
import { Check, Share2, ShoppingCart } from 'lucide-react-native';
import { radius, space } from '../../lib/design/tokens';
import { formatMoney } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { canShareReceipt, shareReceipt, type ReceiptData } from '../../lib/receipt';
import { toast } from '../../lib/toast';
import { Button } from '../ui/Button';
import { Text } from '../ui/Text';
import { makeStyles, useColors } from '../../lib/design/theme';

/**
 * The sale-complete screen.
 *
 * Shows the one number that matters, big, plus the invoice so it can be found
 * again. Profit appears only when the server sent it — a caller without
 * `cost.view` gets no `margin` field at all, and the line is omitted rather
 * than shown empty.
 *
 * "New sale" is the primary action: at a counter the next customer is already
 * waiting, and the fastest path back to scanning is the point.
 */

export interface SaleSuccessProps {
  invoiceNo: string;
  total: number;
  /** Absent when the caller lacks `cost.view`. */
  margin?: number;
  receipt: ReceiptData;
  onNewSale: () => void;
}

export function SaleSuccess({ invoiceNo, total, margin, receipt, onNewSale }: SaleSuccessProps) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const [sharing, setSharing] = useState(false);

  const share = async () => {
    setSharing(true);
    try {
      const shared = await shareReceipt(receipt);
      if (!shared) toast.info(t('sell.done.shareFailed'));
    } catch {
      toast.error(t('sell.done.shareFailed'));
    } finally {
      setSharing(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.badge}>
        <Check color={colors.intent.success.fg} size={40} />
      </View>

      <View style={styles.copy}>
        <Text variant="title" align="center">
          {t('sell.done.title')}
        </Text>
        <Text variant="body" tone="tertiary" align="center">
          {t('sell.done.invoice', { number: invoiceNo })}
        </Text>
      </View>

      <Text variant="display" align="center">
        {formatMoney(total)}
      </Text>

      {margin !== undefined ? (
        <Text variant="bodyStrong" tone="success" align="center">
          {t('sell.done.profit', { amount: formatMoney(margin) })}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Button
          title={t('sell.done.new')}
          icon={ShoppingCart}
          size="lg"
          fullWidth
          onPress={onNewSale}
        />
        {canShareReceipt() ? (
          <Button
            title={t('sell.done.share')}
            icon={Share2}
            variant="secondary"
            fullWidth
            loading={sharing}
            onPress={share}
          />
        ) : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    padding: space.xl,
  },
  badge: {
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    backgroundColor: colors.intent.success.bg,
  },
  copy: {
    gap: 2,
  },
  actions: {
    width: '100%',
    maxWidth: 380,
    gap: space.sm,
    marginTop: space.lg,
  },
}));
