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
 * One line in the sale.
 *
 * The price is editable in place — at a counter, haggling a few thousand
 * ouguiya off is routine, and making that a separate "apply discount" flow
 * would cost taps on a very common path. A below-cost price is flagged the
 * moment it is typed rather than at checkout, so the employee finds out while
 * still talking to the customer.
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
            <Text variant="caption" tone="tertiary" numberOfLines={1}>
              {line.variant}
            </Text>
          ) : null}
          <View style={styles.meta}>
            <StatusChip domain="tracking" value={line.trackingType} size="sm" dot={false} />
            {line.identifier ? <Identifier tone="tertiary">{line.identifier}</Identifier> : null}
          </View>
        </View>

        <IconButton
          icon={X}
          accessibilityLabel={t('action.remove')}
          onPress={() => onRemove(line.key)}
          size={36}
        />
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
        ) : (
          <View style={styles.spacer} />
        )}

        <View style={styles.priceField}>
          <MoneyField
            value={String(line.price)}
            onChangeText={(text) => onPriceChange(line.key, Number(text) || 0)}
            showCurrency={false}
            containerStyle={styles.priceInput}
          />
        </View>
      </View>

      <View style={styles.footer}>
        {belowCost ? (
          <Text variant="caption" tone="danger">
            {t('sell.belowCost.title')}
          </Text>
        ) : (
          <View />
        )}
        <Text variant="bodyStrong">{formatMoney(lineTotal(line))}</Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  row: {
    gap: space.sm,
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
    gap: space.sm,
  },
  identity: {
    flex: 1,
    gap: 2,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.xs,
    marginTop: 2,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  spacer: {
    flex: 1,
  },
  priceField: {
    width: 150,
  },
  priceInput: {
    flex: 1,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
}));
