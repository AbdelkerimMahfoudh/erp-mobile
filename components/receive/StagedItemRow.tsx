import React from 'react';
import { StyleSheet, View } from 'react-native';
import { X } from 'lucide-react-native';
import { radius, space } from '../../lib/design/tokens';
import { formatMoney } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { Button } from '../ui/Button';
import { StatusChip } from '../ui/Chip';
import { IconButton } from '../ui/IconButton';
import { Identifier, Text } from '../ui/Text';
import { itemCount, type StagedItem } from './types';
import { makeStyles } from '../../lib/design/theme';

/**
 * One staged product line.
 *
 * Shows the running count prominently — during a delivery the question being
 * answered constantly is "how many of these have I done?", and the employee is
 * usually holding a box rather than looking closely at the screen.
 *
 * Every phone is listed with its IMEI 1 and, when it has one, its IMEI 2, so a
 * mis-scan is visible and a missing second number can be added without
 * scanning the phone again.
 */

export interface StagedItemRowProps {
  item: StagedItem;
  onRemove: (key: string) => void;
  /** Add IMEI 2 to one phone on this line. IMEI products only. */
  onAddSecondary?: (key: string, identifier: string) => void;
  /** While a submission is unconfirmed nothing may change. */
  locked?: boolean;
}

export function StagedItemRow({ item, onRemove, onAddSecondary, locked = false }: StagedItemRowProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  const count = itemCount(item);
  const isQuantity = item.trackingType === 'quantity';
  const isImei = item.trackingType === 'imei';

  return (
    <View style={styles.row}>
      <View style={styles.top}>
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
        </View>

        <View style={styles.end}>
          <Text variant="bodyStrong">{formatMoney(item.unitCost * count)}</Text>
          {!locked ? (
            <IconButton icon={X} accessibilityLabel={t('action.remove')} size={36} onPress={() => onRemove(item.key)} />
          ) : null}
        </View>
      </View>

      {!isQuantity && item.identifiers?.length ? (
        <View style={styles.units}>
          {item.identifiers.map((identifier) => {
            const secondary = item.secondaries?.[identifier];
            return (
              <View key={identifier} style={styles.unit}>
                <View style={styles.unitIds}>
                  <Identifier tone="secondary" numberOfLines={1}>
                    {identifier}
                  </Identifier>
                  {secondary ? (
                    <Identifier tone="tertiary" numberOfLines={1}>
                      {`${t('scan.imei2')} ${secondary}`}
                    </Identifier>
                  ) : null}
                </View>
                {isImei && !secondary && !locked && onAddSecondary ? (
                  <Button
                    title={t('receive.imei2.add')}
                    variant="tertiary"
                    size="sm"
                    onPress={() => onAddSecondary(item.key, identifier)}
                  />
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}
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
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  count: {
    minWidth: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xs,
    borderRadius: radius.md,
    backgroundColor: colors.intent.info.bg,
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
  units: {
    gap: space.xs,
    paddingTop: space.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border.subtle,
  },
  unit: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    minHeight: 36,
  },
  unitIds: {
    flex: 1,
    gap: 1,
  },
}));
