import React from 'react';
import { Pressable, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { Text } from '../ui';
import { space, touch } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';
import { isRTL } from '../../lib/i18n';

/**
 * "View all sales ›" — the one way out of a bounded preview, at the foot of
 * the card it previews. A full-height row, not a chevron on its own, so the
 * whole width is the target. The rows above it carry the hairlines.
 */
export function LinkRow({ title, onPress }: { title: string; onPress: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <Text variant="bodyStrong" tone="accent" style={styles.title}>
        {title}
      </Text>
      <View style={isRTL() ? styles.flip : undefined}>
        <ChevronRight size={18} color={colors.text.accent} />
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles(() => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: touch.min,
  },
  pressed: { opacity: 0.6 },
  title: { flex: 1 },
  flip: { transform: [{ scaleX: -1 }] },
}));
