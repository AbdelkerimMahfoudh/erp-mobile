import React, { forwardRef, useState } from 'react';
import {
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';
import { radius, space, touch, type as typeScale } from '../../lib/design/tokens';
import { textAlign } from '../../lib/design/direction';
import { CURRENCY_CODE } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { IconButton } from './IconButton';
import { Text } from './Text';
import type { IconComponent } from './Button';
import { makeStyles, useColors } from '../../lib/design/theme';

/**
 * Text inputs.
 *
 * Typing is the slowest thing an employee can do, so these are built to be the
 * fallback rather than the default — but when they are used they must be
 * forgiving: large targets, obvious focus, errors in plain words underneath.
 */

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  /** Quiet guidance under the input. Hidden while an error is showing. */
  hint?: string;
  /** Plain-language problem. Presence turns the field red. */
  error?: string;
  required?: boolean;
  icon?: IconComponent;
  /** Rendered at the trailing edge — a clear button, a unit, a scan affordance. */
  trailing?: React.ReactNode;
  /**
   * `identifier` pins the input LTR with tabular figures, for IMEIs, serials
   * and barcodes. Those are machine values and must never be reordered by
   * Arabic layout or "corrected" by autocapitalisation.
   */
  variant?: 'default' | 'identifier';
  containerStyle?: StyleProp<ViewStyle>;
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  {
    label,
    hint,
    error,
    required = false,
    icon: Icon,
    trailing,
    variant = 'default',
    containerStyle,
    onFocus,
    onBlur,
    editable = true,
    secureTextEntry,
    ...rest
  },
  ref,
) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  const [revealed, setReveal] = useState(false);
  const isIdentifier = variant === 'identifier';

  /**
   * Any secure field gets a reveal toggle, automatically.
   *
   * Passwords are the one place this app cannot "prefer scanning over typing",
   * so the least it can do is let someone check what they typed. Shop staff
   * enter these on a phone, one-handed, often with a case on — and a mistyped
   * password with no way to see it is a support call.
   */
  const isSecure = Boolean(secureTextEntry);
  const hideText = isSecure && !revealed;

  const borderColor = error
    ? colors.intent.danger.solid
    : focused
      ? colors.brand[600]
      : colors.border.default;

  return (
    <View style={[styles.group, containerStyle]}>
      {label ? (
        <View style={styles.labelRow}>
          <Text variant="label" tone="secondary">
            {label}
          </Text>
          {required ? (
            <Text variant="caption" tone="tertiary">
              {t('field.required')}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View
        style={[
          styles.well,
          {
            borderColor,
            backgroundColor: editable ? colors.surface.card : colors.surface.sunken,
            // A second ring on focus rather than a thicker border, so the field
            // does not resize and shove the layout when it gains focus.
            borderWidth: focused || error ? 1.5 : StyleSheet.hairlineWidth,
          },
        ]}
      >
        {Icon ? <Icon color={focused ? colors.brand[600] : colors.text.tertiary} size={18} /> : null}
        <TextInput
          ref={ref}
          editable={editable}
          placeholderTextColor={colors.text.placeholder}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          secureTextEntry={hideText}
          style={[
            styles.input,
            {
              color: editable ? colors.text.primary : colors.text.disabled,
              textAlign: isIdentifier ? 'left' : textAlign('start'),
            },
            isIdentifier ? styles.identifierInput : null,
            // A revealed password keeps the monospaced treatment so characters
            // stay individually countable while being checked.
            isSecure && revealed ? styles.identifierInput : null,
          ]}
          {...(isIdentifier
            ? {
                autoCapitalize: 'characters' as const,
                autoCorrect: false,
                spellCheck: false,
              }
            : null)}
          {...rest}
        />
        {isSecure ? (
          <IconButton
            icon={revealed ? EyeOff : Eye}
            accessibilityLabel={revealed ? t('field.password.hide') : t('field.password.show')}
            onPress={() => setReveal((v) => !v)}
            size={36}
          />
        ) : null}
        {trailing}
      </View>

      {error ? (
        <Text variant="caption" tone="danger">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="tertiary">
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

export interface MoneyFieldProps extends Omit<TextFieldProps, 'keyboardType' | 'variant'> {
  /** Hide the trailing currency code where a column header already says it. */
  showCurrency?: boolean;
}

/**
 * Money input. Sanitises as you type so a price can never carry a stray letter
 * into a sale, and shows the currency inline so nobody has to wonder.
 */
export const MoneyField = forwardRef<TextInput, MoneyFieldProps>(function MoneyField(
  { showCurrency = true, onChangeText, trailing, ...rest },
  ref,
) {
  return (
    <TextField
      ref={ref}
      keyboardType="decimal-pad"
      inputMode="decimal"
      onChangeText={(text) => {
        // Digits and a single separator; both `.` and `,` accepted, `.` stored.
        const normalized = text.replace(/,/g, '.').replace(/[^0-9.]/g, '');
        const [head, ...tail] = normalized.split('.');
        onChangeText?.(tail.length ? `${head}.${tail.join('')}` : head);
      }}
      trailing={
        trailing ?? (showCurrency ? (
          <Text variant="label" tone="tertiary">
            {CURRENCY_CODE}
          </Text>
        ) : null)
      }
      {...rest}
    />
  );
});

const useStyles = makeStyles((colors) => ({
  group: {
    gap: space.xs,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  well: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: touch.comfortable,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
  },
  input: {
    flex: 1,
    paddingVertical: space.md,
    fontSize: typeScale.body.fontSize,
    lineHeight: typeScale.body.lineHeight,
    // Android draws its own underline and inner padding on TextInput.
    padding: 0,
  },
  identifierInput: {
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.4,
    writingDirection: 'ltr',
  },
}));
