import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { Text } from './Text';

export interface PageIntroProps {
  /** One plain sentence saying what the page is for. */
  description: string;
  /** The page's main action, directly under the sentence that explains it. */
  action?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * The line under a page's title, and the action it introduces.
 *
 * Screens used to place this sentence by hand — a bare `View` around the text
 * and a button, a `marginTop` on one page, a `marginBottom` on another — and on
 * Team the sentence sat directly on the "Add a member" button (owner's iPhone
 * review, 2026-10-24). Here the spacing is the system's: a description is 16
 * from the action it explains, and the page's own gap separates the intro from
 * the first section. Long French and Arabic sentences wrap without eating it,
 * because it is a gap, not a margin on a line of text.
 */
export function PageIntro({ description, action, style }: PageIntroProps) {
  const styles = useStyles();
  return (
    <View style={[styles.intro, style]}>
      <Text variant="body" tone="secondary">
        {description}
      </Text>
      {action}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  intro: {
    gap: space.base,
  },
}));
