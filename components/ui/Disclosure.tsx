import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import { Text } from './Text';
import { pressedOpacity, space, touch } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';

/**
 * A row that opens to show detail — progressive disclosure as a component.
 *
 * Closed by default: the detail is one tap away, never in the daily path. The
 * chevron points down whichever way the page reads, so it needs no mirroring,
 * and the expanded state is announced rather than only drawn.
 */
export interface DisclosureProps {
  title: string;
  /** Quiet text beside the title — a total, a count. */
  summary?: React.ReactNode;
  initiallyOpen?: boolean;
  /** Told when the reader opens or closes it — e.g. to fetch detail only once asked for. */
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

export function Disclosure({ title, summary, initiallyOpen = false, onOpenChange, children }: DisclosureProps) {
  const styles = useStyles();
  const colors = useColors();
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View>
      <Pressable
        onPress={() => {
          const next = !open;
          setOpen(next);
          onOpenChange?.(next);
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={title}
        style={({ pressed }) => [styles.head, pressed ? { opacity: pressedOpacity } : null]}
      >
        <Text variant="bodyStrong" style={styles.title}>
          {title}
        </Text>
        {summary}
        <View style={open ? styles.up : null}>
          <ChevronDown size={18} color={colors.text.tertiary} />
        </View>
      </Pressable>
      {open ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: touch.min,
  },
  title: { flex: 1 },
  up: { transform: [{ rotate: '180deg' }] },
  body: { gap: space.sm, paddingTop: space.xs },
}));
