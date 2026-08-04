import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { space } from '../../lib/design/tokens';
import { useTranslation } from '../../lib/i18n';
import { BottomSheet } from '../overlay/BottomSheet';
import { ProductConfirmationCard } from '../product';
import { MoneyField, TextField } from '../ui/Field';
import type { ProductSuggestion, ScanResult } from '../../types/api';

/**
 * Cost entry for a newly-scanned product.
 *
 * Only ever appears for the FIRST unit of a product in a delivery — once a
 * cost is established, later scans of the same product are appended silently.
 * Asking twenty times for the cost of twenty identical phones is exactly the
 * kind of typing this app exists to remove.
 *
 * Selling price is offered here too, because receiving is the moment the shop
 * actually decides it — and a product with no price stalls the Sell screen
 * later.
 */

export interface ReceiveItemDraft {
  unitCost: number;
  price?: number;
  quantity?: number;
}

export interface ReceiveItemSheetProps {
  open: boolean;
  result: ScanResult | null;
  suggestion: ProductSuggestion | null;
  /** Set when the scan cannot be staged — wrong code type, unknown product. */
  notice?: { tone: 'warning' | 'danger'; message: string };
  onClose: () => void;
  onAdd: (draft: ReceiveItemDraft) => void;
  onCreateProduct?: () => void;
}

export function ReceiveItemSheet({
  open,
  result,
  suggestion,
  notice,
  onClose,
  onAdd,
  onCreateProduct,
}: ReceiveItemSheetProps) {
  const { t } = useTranslation();
  const [cost, setCost] = useState('');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('1');

  // Prefill from the product's remembered defaults — confirm, don't originate.
  useEffect(() => {
    if (!open) return;
    setCost(suggestion?.defaultCost != null ? String(suggestion.defaultCost) : '');
    setPrice(suggestion?.defaultPrice != null ? String(suggestion.defaultPrice) : '');
    setQuantity('1');
  }, [open, suggestion]);

  if (!result) return null;

  const isQuantity = suggestion?.trackingType === 'quantity';
  const costValue = Number(cost);
  const quantityValue = Number(quantity);
  const valid =
    Boolean(suggestion) &&
    !notice &&
    costValue > 0 &&
    (!isQuantity || quantityValue >= 1);

  const submit = () =>
    onAdd({
      unitCost: costValue,
      price: Number(price) > 0 ? Number(price) : undefined,
      quantity: isQuantity ? quantityValue : undefined,
    });

  return (
    <BottomSheet open={open} onClose={onClose} padded={false}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <ProductConfirmationCard
          result={result}
          context="receive"
          confirmLabel={t('receive.addItem')}
          notice={notice}
          confirmDisabled={!valid}
          onConfirm={submit}
          onCreateProduct={!suggestion ? onCreateProduct : undefined}
          onScanAgain={onClose}
        >
          {suggestion && !notice ? (
            <View style={styles.fields}>
              <MoneyField
                label={t('receive.cost')}
                hint={t('receive.cost.hint')}
                value={cost}
                onChangeText={setCost}
                autoFocus
                required
              />
              {isQuantity ? (
                <TextField
                  label={t('receive.quantity')}
                  value={quantity}
                  onChangeText={(text) => setQuantity(text.replace(/[^0-9]/g, ''))}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  required
                />
              ) : null}
              <MoneyField
                label={t('receive.price')}
                hint={t('receive.price.hint')}
                value={price}
                onChangeText={setPrice}
              />
            </View>
          ) : null}
        </ProductConfirmationCard>
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    padding: space.base,
  },
  fields: {
    gap: space.md,
  },
});
