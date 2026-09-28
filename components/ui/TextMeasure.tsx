import React from 'react';
import { Platform, StyleSheet, View, type StyleProp, type TextStyle } from 'react-native';
import { Text } from './Text';

/**
 * Words measured at full size on one line — never shown, never read aloud, never
 * touched. A label that must stay whole decides its size or its row from these
 * widths (`lib/label-fit.ts`), the way `MoneyValue` measures its figures.
 *
 * Drawn in `style` — which sets every measure that decides a width — so a caller
 * passes the very style its label is drawn in: the app's type scale, or the tab
 * bar's font.
 */
export interface TextMeasureProps {
  texts: readonly string[];
  style: StyleProp<TextStyle>;
  /** As the label measured does: the tab bar's names do not grow with system text on iOS. */
  allowFontScaling?: boolean;
  onWidth: (text: string, width: number) => void;
}

export function TextMeasure({ texts, style, allowFontScaling, onWidth }: TextMeasureProps) {
  return (
    <View
      style={styles.measure}
      pointerEvents="none"
      aria-hidden
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={styles.line}>
        {[...new Set(texts)].map((text) => (
          <Text
            key={text}
            style={style}
            allowFontScaling={allowFontScaling}
            onLayout={(e) => onWidth(text, e.nativeEvent.layout.width)}
          >
            {text}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  measure: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 0,
    height: 0,
    overflow: 'hidden',
    opacity: 0,
    // On the web, also out of the page's text and its accessibility tree.
    ...(Platform.OS === 'web' ? ({ visibility: 'hidden' } as object) : null),
  },
  line: { position: 'absolute', top: 0, left: 0, width: 100000, alignItems: 'flex-start' },
});
