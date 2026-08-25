import React, { forwardRef, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { ScanLine, Search, X } from 'lucide-react-native';
import { radius, space, touch, type as typeScale } from '../../lib/design/tokens';
import { textAlign } from '../../lib/design/direction';
import { useTranslation } from '../../lib/i18n';
import { haptics } from '../../lib/haptics';
import { usePressed } from './use-pressed';
import { makeStyles, useColors } from '../../lib/design/theme';

/**
 * The search input.
 *
 * Carries the scan affordance because "scan before typing" only holds if the
 * camera is reachable from wherever the employee is already looking. Every
 * search surface in the app gets the same control in the same place.
 *
 * Debouncing lives here rather than in each screen: `onDebouncedChange` fires
 * on a delay for querying, while `onChangeText` stays immediate for the
 * keystroke. A hardware wedge scanner submits with Enter and bypasses the
 * delay entirely via `onSubmit`.
 */

export interface SearchInputProps {
  value: string;
  onChangeText: (value: string) => void;
  /** Fired after the user pauses. Use this to hit the API, not `onChangeText`. */
  onDebouncedChange?: (value: string) => void;
  debounceMs?: number;
  /** Enter / wedge-scanner submit. */
  onSubmit?: (value: string) => void;
  /** Shown as a camera button when provided. Omit to hide it. */
  onScanPress?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** LTR + tabular figures, for scanning identifiers rather than words. */
  identifier?: boolean;
  style?: StyleProp<ViewStyle>;
}

export const SearchInput = forwardRef<TextInput, SearchInputProps>(function SearchInput(
  {
    value,
    onChangeText,
    onDebouncedChange,
    debounceMs = 280,
    onSubmit,
    onScanPress,
    placeholder,
    autoFocus = false,
    identifier = false,
    style,
  },
  ref,
) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  const scanPress = usePressed();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    if (!onDebouncedChange) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onDebouncedChange(latest.current), debounceMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, debounceMs, onDebouncedChange]);

  const clear = () => {
    haptics.tap();
    onChangeText('');
    onDebouncedChange?.('');
  };

  return (
    <View
      style={[
        styles.well,
        {
          borderColor: focused ? colors.brand[600] : colors.border.default,
          borderWidth: focused ? 1.5 : StyleSheet.hairlineWidth,
        },
        style,
      ]}
    >
      <Search color={focused ? colors.brand[600] : colors.text.tertiary} size={18} />

      <TextInput
        ref={ref}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={() => {
          // Cancel the pending debounce — the user already committed.
          if (timer.current) clearTimeout(timer.current);
          onSubmit?.(value);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder ?? t('action.search')}
        placeholderTextColor={colors.text.placeholder}
        autoFocus={autoFocus}
        autoCorrect={false}
        spellCheck={false}
        returnKeyType="search"
        // A wedge scanner types then hits Enter; keep the field alive for the
        // next scan instead of dismissing on submit.
        blurOnSubmit={false}
        autoCapitalize={identifier ? 'characters' : 'none'}
        style={[
          styles.input,
          { textAlign: identifier ? 'left' : textAlign('start') },
          identifier ? styles.identifierInput : null,
        ]}
      />

      {value.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('action.clear')}
          onPress={clear}
          hitSlop={10}
          style={styles.clear}
        >
          <X color={colors.text.tertiary} size={14} />
        </Pressable>
      ) : null}

      {onScanPress ? (
        <>
          <View style={styles.rule} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('action.scan')}
            onPress={() => {
              haptics.tap();
              onScanPress();
            }}
            hitSlop={8}
            {...scanPress.pressHandlers}
            style={[styles.scan, scanPress.pressed ? { opacity: 0.6 } : null]}
          >
            <ScanLine color={colors.brand[600]} size={20} />
          </Pressable>
        </>
      ) : null}
    </View>
  );
});

const useStyles = makeStyles((colors) => ({
  well: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: touch.comfortable,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface.card,
  },
  input: {
    flex: 1,
    paddingVertical: space.md,
    padding: 0,
    fontSize: typeScale.body.fontSize,
    lineHeight: typeScale.body.lineHeight,
    color: colors.text.primary,
  },
  identifierInput: {
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.4,
    writingDirection: 'ltr',
  },
  clear: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    backgroundColor: colors.surface.sunken,
  },
  rule: {
    width: StyleSheet.hairlineWidth,
    height: 22,
    backgroundColor: colors.border.subtle,
  },
  scan: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
