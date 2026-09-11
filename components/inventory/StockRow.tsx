import React from 'react';
import { Pressable, View } from 'react-native';
import { Cable, Package, Smartphone } from 'lucide-react-native';
import { Chip, Text } from '../ui';
import { usePressed } from '../ui/use-pressed';
import { radius, space, touch } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';
import { formatMoney, formatQuantity } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { productTitle, variantSummary } from '../../lib/product-label';
import { priceWording, stockStatus } from '../../lib/stock-price';
import type { StockSummaryRow } from '../../types/api';

/**
 * One exact variant on the shelf: what it is, what it sells for, how many can
 * be sold today, and whether that is running low.
 *
 * ## The thumbnail is honest about having no photo
 *
 * The app has no product images. The only image field in the schema is
 * `units.image_ref` — a photo of ONE handset — and showing it as the picture of
 * every phone of that variant would be a different model or colour presented
 * as exact. So the tile is a neutral category mark, and it is hidden from
 * screen readers because it says nothing the title does not.
 *
 * ## The price never overstates what is known
 *
 * - nothing priced → "No price set", never `0`;
 * - one price for every unit → "Price 42 000 MRU";
 * - units that resolve to different prices (a unit override on one phone) →
 *   "From 39 000 MRU", because presenting either figure as universal would be a
 *   lie about the other phones;
 * - some units unpriced → says how many, rather than hiding them.
 *
 * ## Status is a word, not a colour
 *
 * Low and out of stock are chips with their label, so the meaning survives a
 * colour-blind reader and a monochrome screenshot.
 */

export interface StockRowProps {
  row: StockSummaryRow;
  onPress: () => void;
}

const CATEGORY_ICON = { phone: Smartphone, accessory: Cable, other: Package } as const;

/** Wording from the pure rules in `lib/stock-price.ts`, translated here. */
function priceLabel(
  row: StockSummaryRow,
  t: (key: never, values?: Record<string, string | number>) => string,
): { text: string; unset: boolean; unpricedNote: string | null } {
  const w = priceWording(row.price);
  if (w.kind === 'unset') return { text: t('stock.priceUnset' as never), unset: true, unpricedNote: null };
  const text =
    w.kind === 'single'
      ? t('stock.price' as never, { amount: formatMoney(w.amount) })
      : t('stock.priceFrom' as never, { amount: formatMoney(w.amount) });
  const unpricedNote =
    w.unpriced > 0 ? t('stock.someUnpriced' as never, { count: formatQuantity(w.unpriced) }) : null;
  return { text, unset: false, unpricedNote };
}

export function StockRow({ row, onPress }: StockRowProps) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const { pressed, pressHandlers } = usePressed();

  const Icon = CATEGORY_ICON[row.category];
  const title = productTitle(row);
  const variant = variantSummary(row);
  const price = priceLabel(row, t as never);

  const state = stockStatus(row.available, row.lowStock);
  const outOfStock = state === 'out';
  const status = state === 'out' ? t('stock.outOfStock') : state === 'low' ? t('stock.lowStock') : null;

  // One sentence for a screen reader, in reading order, instead of five
  // fragments announced separately.
  const a11y = [
    title,
    variant,
    `${formatQuantity(row.available)} ${t('stock.available')}`,
    price.text,
    price.unpricedNote,
    status,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={onPress}
      {...pressHandlers}
      style={[styles.row, pressed ? styles.pressed : null]}
    >
      <View
        style={styles.thumb}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Icon color={colors.brand[600]} size={22} />
      </View>

      <View style={styles.body}>
        <Text variant="bodyStrong" numberOfLines={2}>
          {title}
        </Text>
        {variant ? (
          <Text variant="caption" tone="secondary" numberOfLines={2}>
            {variant}
          </Text>
        ) : null}
        <Text variant="caption" tone={price.unset ? 'tertiary' : 'primary'}>
          {price.text}
          {price.unpricedNote ? ` · ${price.unpricedNote}` : ''}
        </Text>
      </View>

      <View style={styles.trailing}>
        <Text variant="title" align="end">
          {formatQuantity(row.available)}
        </Text>
        <Text variant="caption" tone="tertiary" align="end">
          {t('stock.available')}
        </Text>
        {status ? (
          <Chip label={status} tone={outOfStock ? 'danger' : 'warning'} size="sm" dot />
        ) : null}
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: touch.comfortable + space.lg,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
  },
  pressed: {
    opacity: 0.7,
  },
  thumb: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.intent.info.bg,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  trailing: {
    alignItems: 'flex-end',
    gap: 2,
    maxWidth: '40%',
  },
}));
