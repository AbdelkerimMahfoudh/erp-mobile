import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { Button, Text } from '../ui';
import type { IconComponent } from '../ui/Button';
import { radius, space } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';

/**
 * The app's own explanation before iOS asks for a permission (D225, the owner's TestFlight feedback of 2026-10-29).
 *
 * iOS's prompt cannot be styled, and it is asked once: a person who taps "Don't Allow" there out of surprise has to go
 * to Settings to undo it. So the app asks first, in its own words — what the permission is for in this shop, in two or
 * three short lines — with a clear way forward and a way that does not need it at all ("Type it instead", "Not now").
 * Only the primary action opens iOS's prompt. After a refusal, iOS will not ask again, so the screen says where in
 * Settings to turn it on — in words: the app opens no other app and no address (`lib/access-boundary.test.ts`) — and
 * keeps the way that needs no permission. It never asks again by itself.
 */
export interface PermissionExplainerProps {
  icon: IconComponent;
  title: string;
  /** Why it helps, each a short line. */
  benefits: readonly string[];
  /** iOS already refused (it will not ask again): show how to turn it on in Settings instead of the prompt. */
  denied: boolean;
  /** Opens iOS's own prompt. */
  onAllow: () => void;
  allowLabel: string;
  /** The way that needs no permission, or "Not now". */
  alternative: { label: string; onPress: () => void };
  /** The Settings path, already in the reader's words. */
  deniedSteps: string;
}

export function PermissionExplainer({ icon: Icon, title, benefits, denied, onAllow, allowLabel, alternative, deniedSteps }: PermissionExplainerProps) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.card} accessibilityRole="summary">
      <View style={styles.badge} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Icon color={colors.brand[600]} size={30} />
      </View>
      <Text variant="heading" align="center" accessibilityRole="header">
        {title}
      </Text>
      {denied ? (
        <Text variant="body" tone="secondary" align="center">
          {deniedSteps}
        </Text>
      ) : (
        <View style={styles.benefits}>
          {benefits.map((line) => (
            <View key={line} style={styles.benefit}>
              <Check color={colors.intent.success.fg} size={18} />
              <Text variant="body" style={styles.grow}>
                {line}
              </Text>
            </View>
          ))}
        </View>
      )}
      <View style={styles.actions}>
        {denied ? null : <Button title={allowLabel} onPress={onAllow} fullWidth />}
        <Button title={alternative.label} variant="tertiary" onPress={alternative.onPress} fullWidth />
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    gap: space.base,
    padding: space.xl,
    borderRadius: radius.xl,
    backgroundColor: colors.surface.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.subtle,
    alignItems: 'stretch',
  },
  badge: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.intent.info.bg,
  },
  benefits: { gap: space.sm },
  benefit: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  grow: { flex: 1 },
  actions: { gap: space.xs, marginTop: space.sm },
}));
