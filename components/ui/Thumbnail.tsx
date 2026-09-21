import React from 'react';
import { View } from 'react-native';
import { Smartphone } from 'lucide-react-native';
import { radius } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';
import type { IconComponent } from './Button';

/**
 * The picture slot beside a phone — in a sale row, a stock row, the phone
 * about to be sold.
 *
 * There are no catalogue photos yet (`docs/47`), so this is honest about it: a
 * tinted square carrying the category's icon, the same shape a photo will fill
 * later. Never a stock image pretending to be the product in the box.
 */

export const THUMB_SIZE = { md: 44, lg: 56 } as const;

export interface ThumbnailProps {
  icon?: IconComponent;
  size?: keyof typeof THUMB_SIZE;
}

export function Thumbnail({ icon: Icon = Smartphone, size = 'md' }: ThumbnailProps) {
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
