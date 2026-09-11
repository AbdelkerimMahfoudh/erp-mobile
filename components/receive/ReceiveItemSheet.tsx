import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { space } from '../../lib/design/tokens';
import { useTranslation } from '../../lib/i18n';
import { toErrorMessage } from '../../lib/errors';
import { imei2Problem, type ReceiveLine } from '../../lib/receive-outcome';
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
 *
 * ## IMEI 2
 *
 * Optional, for a phone scanned by IMEI. Prefilled when the camera captured it,
 * typed otherwise, and checked twice before the phone joins the delivery: on
 * the phone (valid, not IMEI 1 again, not already in this delivery) and on the
 * server, together with IMEI 1, against every unit in stock.
 */

export interface ReceiveItemDraft {
  unitCost: number;
  price?: number;
  quantity?: number;
  imeiSecondary?: string;
}

export interface ReceiveItemSheetProps {
  open: boolean;
  result: ScanResult | null;
  suggestion: ProductSuggestion | null;
  /** IMEI 2 already captured with this scan. */
  secondary?: string | null;
  /** Set when the scan cannot be staged — wrong code type, phone already in stock. */
  notice?: { tone: 'warning' | 'danger'; message: string };
  recovery?: { label: string; onPress: () => void };
  /** The delivery so far, so IMEI 2 cannot repeat a number already in it. */
  lines: ReceiveLine[];
  onClose: () => void;
  onAdd: (draft: ReceiveItemDraft) => void;
  /** Receives the IMEI 2 typed so far, so it survives the detour. */
  onCreateProduct?: (imeiSecondary: string | null) => void;
  onChooseProduct?: () => void;
  /** `POST /scan` with both IMEIs. */
  lookUp: (code: string, secondary: string | null) => Promise<ScanResult>;
}

export function ReceiveItemSheet({
  open,
  result,
  suggestion,
  secondary = null,
  notice,
  recovery,
  lines,
  onClose,
  onAdd,
  onCreateProduct,
  onChooseProduct,
  lookUp,
}: ReceiveItemSheetProps) {
  const { t } = useTranslation();
  const [cost, setCost] = useState('');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [imei2, setImei2] = useState('');
  const [imei2Error, setImei2Error] = useState<string | undefined>();
  const [checking, setChecking] = useState(false);

  // Prefill from the product's remembered defaults — confirm, don't originate.
  useEffect(() => {
    if (!open) return;
    setCost(suggestion?.defaultCost != null ? String(suggestion.defaultCost) : '');
    setPrice(suggestion?.defaultPrice != null ? String(suggestion.defaultPrice) : '');
    setQuantity('1');
  }, [open, suggestion]);

  /*
   * IMEI 2 starts from what the camera captured each time the sheet opens for a
   * phone. Adjusted during render rather than in an effect, so a stale number
   * from the previous phone never paints; choosing a different product keeps
   * what was typed.
   */
  const openedFor = open ? `${result?.code ?? ''}|${secondary ?? ''}` : null;
  const [shownFor, setShownFor] = useState<string | null>(null);
  if (openedFor !== shownFor) {
    setShownFor(openedFor);
    if (openedFor !== null) {
      setImei2(secondary ?? '');
      setImei2Error(undefined);
    }
  }

  if (!result) return null;

  const blocked = notice?.tone === 'danger';
  const isQuantity = suggestion?.trackingType === 'quantity';
  const takesImei2 = result.kind === 'imei' && !blocked && (!suggestion || suggestion.trackingType === 'imei');
  const costValue = Number(cost);
  const quantityValue = Number(quantity);
  const valid =
    Boolean(suggestion) &&
    !notice &&
    costValue > 0 &&
    (!isQuantity || quantityValue >= 1);

  /*
   * A product chosen by hand, or just created, replaces the scanner's guess on
   * the card. The person picked it, so it is shown as certain.
   */
  const shown: ScanResult =
    suggestion && result.suggestion?.productId !== suggestion.productId
      ? { ...result, suggestion, recognized: true, confidence: 1, hintCode: undefined, hintParams: undefined }
      : result;

  const submit = async () => {
    const second = takesImei2 ? imei2.trim() : '';
    if (second) {
      const problem = imei2Problem(result.code, second, lines);
      if (problem) {
        setImei2Error(t(`receive.imei2.${problem}` as never));
        return;
      }
      // The camera path already sent both numbers to /scan; a typed one has not.
      if (second !== secondary) {
        setChecking(true);
        try {
          const check = await lookUp(result.code, second);
          if (check.inventory?.alreadyInInventory) {
            setImei2Error(t('receive.imei2.registered'));
            return;
          }
        } catch (e) {
          setImei2Error(toErrorMessage(e));
          return;
        } finally {
          setChecking(false);
        }
      }
    }
    onAdd({
      unitCost: costValue,
      price: Number(price) > 0 ? Number(price) : undefined,
      quantity: isQuantity ? quantityValue : undefined,
      ...(second ? { imeiSecondary: second } : {}),
    });
  };

  const imei2Field = takesImei2 ? (
    <TextField
      label={t('receive.imei2.label')}
      hint={t('receive.imei2.hint')}
      value={imei2}
      onChangeText={(text) => {
        setImei2(text.replace(/[^0-9]/g, '').slice(0, 15));
        setImei2Error(undefined);
      }}
      keyboardType="number-pad"
      inputMode="numeric"
      maxLength={15}
      error={imei2Error}
    />
  ) : null;

  return (
    <BottomSheet open={open} onClose={onClose} padded={false}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <ProductConfirmationCard
          result={shown}
          context="receive"
          confirmLabel={t('receive.addItem')}
          notice={notice}
          recovery={recovery}
          secondaryCode={secondary}
          confirmDisabled={!valid || checking}
          loading={checking}
          onConfirm={() => void submit()}
          onChooseProduct={!blocked ? onChooseProduct : undefined}
          onCreateProduct={!suggestion && !blocked && onCreateProduct ? () => onCreateProduct(imei2.trim() || null) : undefined}
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
              {imei2Field}
              <MoneyField
                label={t('receive.price')}
                hint={t('receive.price.hint')}
                value={price}
                onChangeText={setPrice}
              />
            </View>
          ) : imei2Field ? (
            <View style={styles.fields}>{imei2Field}</View>
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
