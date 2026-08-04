import React from 'react';
import { StyleSheet, View } from 'react-native';
import { X } from 'lucide-react-native';
import { colors } from '../../lib/design/colors';
import { radius, space } from '../../lib/design/tokens';
import { formatMoney } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { StatusChip } from '../ui/Chip';
import { IconButton } from '../ui/IconButton';
import { Identifier, Text } from '../ui/Text';
import { itemCount, type StagedItem } from './types';

/**
 * One staged product line.
 *
 * Shows the running count prominently — during a delivery the question being
 * answered constantly is "how many of these have I done?", and the employee is
 * usually holding a box rather than looking closely at the screen.
 */

export interface StagedItemRowProps {
  item: StagedItem;
  onRemove: (key: string) => void;
}

export function StagedItemRow({ item, onRemove }: StagedItemRowProps) {
  const { t } = useTranslation();
  const count = itemCount(item);
  const isQuantity = item.trackingType === 'quantity';

  return (
    <View style={styles.row}>
      <View style={styles.count}>
        <Text variant="title" align="center" style={styles.countText}>
          {count}
        </Text>
      </View>

      <View style={styles.body}>
        <Text variant="bodyStrong" numberOfLines={2}>
          {item.label}
        </Text>
        {item.variant ? (
          <Text variant="caption" tone="tertiary" numberOfLines={1}>
            {item.variant}
          </Text>
        ) : null}
        <View style={styles.meta}>
          <StatusChip domain="tracking" value={item.trackingType} size="sm" dot={false} />
          <Text variant="caption" tone="secondary">
            {formatMoney(item.unitCost)}
          </Text>
        </View>

        {/* The last few scanned identifiers, so a mis-scan is visible without
            opening anything. */}
        {!isQuantity && item.identifiers?.length ? (
          <Identifier tone="tertiary" numberOfLines={1}>
            {item.identifiers.slice(-2).join('  ')}
            {item.identifiers.length > 2 ? ' …' : ''}
          </Identifier>
        ) : null}
      </View>

      <View style={styles.end}>
        <Text variant="bodyStrong">{formatMoney(item.unitCost * count)}</Text>
        <IconButton
          icon={X}
          accessibilityLabel={t('action.remove')}
          size={36}
          onPress={() => onRemove(item.key)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.subtle,
  },
  count: {
    minWidth: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xs,
    borderRadius: radius.md,
    backgroundColor: colors.brand[50],
  },
  countText: {
    color: colors.brand[700],
    fontVariant: ['tabular-nums'],
  },
  body: {
    flex: 1,
    gap: 1,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    marginTop: 2,
  },
  end: {
    alignItems: 'flex-end',
    gap: space.xs,
  },
});
