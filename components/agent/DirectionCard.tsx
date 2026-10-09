import React from 'react';
import { Pressable, View } from 'react-native';
import { ArrowDownLeft, ArrowUpRight, CheckCircle2 } from 'lucide-react-native';
import { Text } from '../ui';
import { usePressed } from '../ui/use-pressed';
import { radius, space, touch } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';
import { useTranslation } from '../../lib/i18n';
import type { AgentDirection } from '../../lib/agent-rules';

/**
 * One of the counter's two directions, as a large card (docs/73 §5.2, A5):
 * the money arrows in words — *Receive cash → send Bankily credit* — and,
 * beneath, what moves where: the drawer and the provider's float. Unmistakable
 * by design: two cards, each a whole sentence, never a toggle of two words.
 * The arrow icon points the cash's way (into the drawer, out of it); the words
 * carry the meaning, so colour and icon are never alone.
 */
export function DirectionCard({
  direction,
  provider,
  selected,
  onPress,
}: {
  direction: AgentDirection;
  /** The provider's name once chosen; until then the credit is "digital". */
  provider: string | null;
  selected: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const { pressed, pressHandlers } = usePressed();
  const name = provider ?? t('agent.credit.digital');
  const Icon = direction === 'cash_in_credit_out' ? ArrowDownLeft : ArrowUpRight;
  const title = t(`agent.direction.${direction}`, { provider: name });
  const moves = t(`agent.direction.${direction}.moves`, { provider: name });
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${moves}`}
      accessibilityState={{ selected }}
      {...pressHandlers}
      style={[
        styles.card,
        {
          backgroundColor: selected ? colors.intent.info.bg : pressed ? colors.surface.hover : colors.surface.card,
          borderColor: selected ? colors.intent.info.border : colors.border.subtle,
        },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: selected ? colors.surface.card : colors.semantic.primarySoft }]}>
        <Icon size={24} color={colors.text.accent} />
      </View>
      <View style={styles.words}>
        <Text variant="heading">{title}</Text>
        <Text variant="caption" tone="secondary">
          {moves}
        </Text>
      </View>
      {selected ? <CheckCircle2 size={22} color={colors.text.accent} /> : null}
    </Pressable>
  );
}

const useStyles = makeStyles(() => ({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: touch.large + space.xl,
    padding: space.base,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  icon: { width: 44, height: 44, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  words: { flex: 1, minWidth: 0, gap: 2 },
}));
