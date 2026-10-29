import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { CATEGORY_ILLUSTRATIONS, type CategoryIllustration } from '../../lib/category-illustration';
import { radius, space, touch } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';
import { useTranslation } from '../../lib/i18n';
import { Text } from '../ui/Text';
import { CategoryIllustrationIcon } from '../ui/CategoryIllustration';

/**
 * The picture a shop's own category wears (D225): the whole supported library, each drawn as it will
 * appear in Stock, Sale and the reports, with its name in the reader's language underneath — a picture
 * alone is not a label. "None" keeps the neutral generic (or the built-in parent's picture).
 *
 * A wrapping grid of 48-point targets: it reflows at 320 pt and at large text rather than scrolling
 * sideways, and the selected one is marked by its border AND a "selected" state, never by colour alone.
 */
export function IllustrationPicker({
  value,
  onChange,
}: {
  value: CategoryIllustration | null;
  onChange: (next: CategoryIllustration | null) => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();

  const option = (name: CategoryIllustration | null) => {
    const selected = value === name;
    const label = name ? t(`category.icon.${name}` as never) : t('categories.icon.none');
    return (
      <Pressable
        key={name ?? 'none'}
        accessibilityRole="radio"
        aria-checked={selected}
        accessibilityLabel={label}
        onPress={() => onChange(name)}
        style={[styles.option, selected ? styles.selected : null]}
      >
        {name ? (
          <CategoryIllustrationIcon name={name} color={selected ? colors.semantic.primary : colors.text.secondary} size={24} />
        ) : (
          <View style={styles.none} />
        )}
        <Text variant="caption" align="center" tone={selected ? 'primary' : 'secondary'}>
          {label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View>
      <Text variant="label">{t('categories.icon.label')}</Text>
      <Text variant="caption" tone="secondary" style={styles.hint}>
        {t('categories.icon.hint')}
      </Text>
      <View style={styles.grid} accessibilityRole="radiogroup">
        {option(null)}
        {CATEGORY_ILLUSTRATIONS.map((name) => option(name))}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  hint: { marginTop: space.xs, marginBottom: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  option: {
    width: 88,
    minHeight: touch.comfortable + space.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    padding: space.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.card,
  },
  selected: {
    borderWidth: 2,
    borderColor: colors.semantic.primary,
    backgroundColor: colors.semantic.primarySoft,
  },
  none: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.border.strong,
  },
}));
