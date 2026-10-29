import React from 'react';
import { View } from 'react-native';
import { radius } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';
import type { CategoryIllustration } from '../../lib/category-illustration';
import type { IconComponent } from './Button';
import { ILLUSTRATION_ICONS } from './CategoryIllustration';

/**
 * The picture slot beside a product — in a sale row, a stock row, the item
 * about to be sold.
 *
 * There are no catalogue photos yet (`docs/47`), so this is honest about it: a
 * tinted square carrying the category's illustration (D225,
 * `lib/category-illustration.ts`), the same shape a photo will fill later.
 * Never a stock image pretending to be the product in the box, and never a
 * phone for something that is not one: with nothing to go on, it is the
 * neutral generic.
 */

export const THUMB_SIZE = { md: 44, lg: 56 } as const;

export interface ThumbnailProps {
  /** What the product is, from its category. */
  illustration?: CategoryIllustration;
  /** A picture that is not a product — a receipt, a package of documents. Wins over `illustration`. */
  icon?: IconComponent;
  size?: keyof typeof THUMB_SIZE;
}

export function Thumbnail({ illustration = 'electronics', icon, size = 'md' }: ThumbnailProps) {
  const Icon = icon ?? ILLUSTRATION_ICONS[illustration] ?? ILLUSTRATION_ICONS.electronics;
  const styles = useStyles();
  const colors = useColors();
  const px = THUMB_SIZE[size];
  return (
    <View
      style={[styles.box, { width: px, height: px }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Icon color={colors.text.accent} size={size === 'lg' ? 26 : 20} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  box: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.intent.info.bg,
  },
}));
