import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { ChevronDown, ChevronUp, Tag } from 'lucide-react-native';
import { radius, space, touch } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';
import { formatMoney } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { parseAmount } from '../../lib/price-input';
import { Button } from '../ui/Button';
import { MoneyField } from '../ui/Field';
import { Text } from '../ui/Text';
import { usePressed } from '../ui/use-pressed';

/**
 * The whole-sale discount, on the Review sale screen (the owner's brief of
 * 2026-10-17): its own white card under "Before you sell", marked Optional, and
 * closed until the seller opens it — most sales have none.
 *
 * It only proposes. The total and the expected profit above it follow the
 * amount typed, and the server decides whether the discount is allowed: the
 * below-cost rule and the Owner's approval are its own, exactly as before.
 * More than the price is never taken; past two decimals nothing is sent.
 */
export type DiscountProblem = 'invalid' | 'too_much' | null;

/** The discount as typed: blank is none; a bad or excessive figure is a problem, never silently clipped. */
export function discountFrom(text: string, subtotal: number): { amount: number; problem: DiscountProblem } {
  if (text.trim() === '') return { amount: 0, problem: null };
  const parsed = parseAmount(text);
  if (!parsed.ok) return { amount: 0, problem: 'invalid' };
  if (parsed.value > subtotal) return { amount: 0, problem: 'too_much' };
  return { amount: parsed.value, problem: null };
}

export function DiscountCard({
  text,
  onChangeText,
  subtotal,
}: {
  text: string;
  onChangeText: (text: string) => void;
  /** The price before the discount, so a discount larger than it is refused here. */
  subtotal: number;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const [open, setOpen] = useState(text.trim() !== '');
  const { pressed, pressHandlers } = usePressed();
  const { amount, problem } = discountFrom(text, subtotal);

  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={t('sell.discount')}
        onPress={() => setOpen((o) => !o)}
        {...pressHandlers}
        style={[styles.head, pressed ? styles.pressed : null]}
      >
        <Tag size={18} color={colors.text.secondary} />
        <View style={styles.grow}>
          <Text variant="labelStrong">{t('sell.discount')}</Text>
          {amount > 0 && !open ? (
            <Text variant="caption" tone="secondary">
              {t('sell.discount.applied', { amount: formatMoney(amount) })}
            </Text>
          ) : null}
        </View>
        <Text variant="caption" tone="tertiary">
          {t('sell.discount.optional')}
        </Text>
        {open ? <ChevronUp size={18} color={colors.text.tertiary} /> : <ChevronDown size={18} color={colors.text.tertiary} />}
      </Pressable>

      {open ? (
        <View style={styles.body}>
          <MoneyField
            label={t('sell.discount.add')}
            value={text}
            onChangeText={onChangeText}
            placeholder="0"
            error={problem === 'too_much' ? t('sell.discount.tooMuch') : problem === 'invalid' ? t('sell.discount.invalid') : undefined}
          />
          {text.trim() !== '' ? (
            <Button
              title={t('sell.discount.remove')}
              variant="tertiary"
              size="sm"
              onPress={() => {
                onChangeText('');
                setOpen(false);
              }}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    borderRadius: radius.lg,
    borderWidth: 0.5,
    borderColor: colors.border.subtle,
    backgroundColor: colors.surface.card,
    overflow: 'hidden',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: touch.min,
    paddingHorizontal: space.base,
    paddingVertical: space.md,
  },
  pressed: { opacity: 0.6 },
  grow: { flex: 1, minWidth: 0 },
  body: { gap: space.sm, paddingHorizontal: space.base, paddingBottom: space.base },
}));
