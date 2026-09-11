import React from 'react';
import { StyleSheet, View } from 'react-native';
import { X } from 'lucide-react-native';
import { radius, space } from '../../lib/design/tokens';
import { formatMoney } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { StatusChip } from '../ui/Chip';
import { IconButton } from '../ui/IconButton';
import { MoneyField } from '../ui/Field';
import { Stepper } from '../ui/Stepper';
import { Identifier, Text } from '../ui/Text';
import { lineTotal, type CartLine } from './types';
import { makeStyles } from '../../lib/design/theme';

/**
 * One line in the sale — in the Stock screen's row language.
 *
 * What it is on the left (name, variant, tracking and identifier), what it
 * comes to on the right, and underneath the two things a seller changes at the
 * counter: how many, and the unit price. The price is labelled — a bare number
 * box beside a total left people unsure which figure they were editing.
 *
 * The price is editable in place: haggling a few thousand ouguiya off is
 * routine, and a separate "apply discount" flow would cost taps on a very common
 * path. A below-cost price is flagged the moment it is typed — in words, not
 * only colour — so the employee finds out while still talking to the customer.
 * Cost itself is never shown here; the flag appears only when the server sent
 * cost, which it does not without `cost.view`.
 */

export interface CartLineRowProps {
  line: CartLine;
  onPriceChange: (key: string, price: number) => void;
  onQuantityChange: (key: string, quantity: number) => void;
  onRemove: (key: string) => void;
}

export function CartLineRow({ line, onPriceChange, onQuantityChange, onRemove }: CartLineRowProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  const isQuantity = line.kind === 'quantity';
  // `cost` is only present with `cost.view`; without it we simply cannot tell.
  const belowCost = line.cost !== undefined && line.price < line.cost;

  return (
    <View style={[styles.row, belowCost ? styles.rowWarning : null]}>
      <View style={styles.header}>
        <View style={styles.identity}>
          <Text variant="bodyStrong" numberOfLines={2}>
            {line.label}
          </Text>
          {line.variant ? (
            <Text variant="caption" tone="secondary" numberOfLines={1}>
              {line.variant}
            </Text>
          ) : null}
          <View style={styles.meta}>
            <StatusChip domain="tracking" value={line.trackingType} size="sm" dot={false} />
            {line.identifier ? <Identifier tone="tertiary">{line.identifier}</Identifier> : null}
          </View>
        </View>

        <View style={styles.end}>
          <Text variant="title" align="end">
            {formatMoney(lineTotal(line))}
          </Text>
          <IconButton
            icon={X}
            accessibilityLabel={t('action.remove')}
            onPress={() => onRemove(line.key)}
            size={36}
          />
        </View>
      </View>

      <View style={styles.controls}>
        {isQuantity ? (
          <Stepper
            value={line.quantity}
            onChange={(next) => onQuantityChange(line.key, next)}
            min={1}
            size="sm"
            accessibilityLabel={t('tracking.quantity')}
          />
        ) : null}

        <View style={styles.priceField}>
          <MoneyField
            label={t('sell.line.unitPrice')}
            // The line total beside it already says MRU; a currency suffix in a
            // field this narrow pushed out of its own border.
            showCurrency={false}
            value={String(line.price)}
            onChangeText={(text) => onPriceChange(line.key, Number(text) || 0)}
          />
        </View>
      </View>

      {belowCost ? (
        <Text variant="captionStrong" tone="danger">
          {t('sell.belowCost.title')}
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  row: {
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.subtle,
  },
  rowWarning: {
    borderColor: colors.intent.danger.border,
    backgroundColor: colors.intent.danger.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
  },
  identity: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.xs,
    marginTop: 2,
  },
  end: {
    alignItems: 'flex-end',
    gap: space.xs,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.md,
  },
  priceField: {
    flex: 1,
  },
}));
