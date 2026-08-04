import React, { useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { Check, Plus } from 'lucide-react-native';
import { colors } from '../../lib/design/colors';
import { space } from '../../lib/design/tokens';
import { useTranslation } from '../../lib/i18n';
import { Button, type IconComponent } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState } from '../ui/ErrorState';
import { ListRow } from '../ui/ListRow';
import { SearchInput } from '../ui/SearchInput';
import { SkeletonList } from '../ui/Skeleton';
import { Text } from '../ui/Text';
import { BottomSheet } from './BottomSheet';

/**
 * The one picker.
 *
 * Supplier, branch, category, product, payment method — all of them are "choose
 * one (or several) from a list, maybe searching, maybe creating a new one".
 * Building that once means every picker in the app searches the same way,
 * filters the same way and creates the same way.
 *
 * `onCreate` is what keeps receiving fast: when a supplier is not in the list,
 * typing their name offers to create it inline rather than sending someone to
 * a settings screen in the middle of unloading a delivery.
 */

export interface SelectSheetProps<T> {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  items: T[];

  keyExtractor: (item: T) => string;
  /** The row's headline. */
  labelExtractor: (item: T) => string;
  /** Quiet second line — a balance, a branch, a category. */
  descriptionExtractor?: (item: T) => string | undefined;
  /** Monospaced third line for identifiers. */
  identifierExtractor?: (item: T) => string | undefined;
  /** Right-aligned value, e.g. a price or a count. */
  valueExtractor?: (item: T) => string | undefined;
  /** Chip or badge rendered before the value. */
  accessoryExtractor?: (item: T) => React.ReactNode;
  leadingIcon?: IconComponent;

  selectedKeys?: string[];
  onSelect: (item: T) => void;
  /** Keep the sheet open and confirm a set instead of choosing one. */
  multi?: boolean;
  onConfirm?: (items: T[]) => void;

  searchable?: boolean;
  searchPlaceholder?: string;
  /**
   * Provide to search on the server. Omit and the list is filtered locally
   * across label, description and identifier.
   */
  onSearchChange?: (query: string) => void;

  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyBody?: string;

  /** Offer "Create <query>" when the search finds nothing. */
  onCreate?: (name: string) => void;
  creating?: boolean;
}

export function SelectSheet<T>({
  open,
  onClose,
  title,
  subtitle,
  items,
  keyExtractor,
  labelExtractor,
  descriptionExtractor,
  identifierExtractor,
  valueExtractor,
  accessoryExtractor,
  leadingIcon,
  selectedKeys = [],
  onSelect,
  multi = false,
  onConfirm,
  searchable = true,
  searchPlaceholder,
  onSearchChange,
  loading = false,
  error,
  onRetry,
  emptyTitle,
  emptyBody,
  onCreate,
  creating = false,
}: SelectSheetProps<T>) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>(selectedKeys);

  // Server-side search returns pre-filtered items; only filter locally when we
  // own the query.
  const visible = useMemo(() => {
    if (onSearchChange || !query.trim()) return items;
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      const haystack = [
        labelExtractor(item),
        descriptionExtractor?.(item),
        identifierExtractor?.(item),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [items, query, onSearchChange, labelExtractor, descriptionExtractor, identifierExtractor]);

  const selection = multi ? picked : selectedKeys;

  const choose = (item: T) => {
    if (!multi) {
      onSelect(item);
      onClose();
      return;
    }
    const key = keyExtractor(item);
    setPicked((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
    onSelect(item);
  };

  const confirmMulti = () => {
    onConfirm?.(items.filter((item) => picked.includes(keyExtractor(item))));
    onClose();
  };

  const showCreate = Boolean(onCreate) && query.trim().length > 0 && visible.length === 0;

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      padded={false}
      footer={
        multi ? (
          <Button
            title={t('select.confirm')}
            fullWidth
            disabled={picked.length === 0}
            onPress={confirmMulti}
          />
        ) : undefined
      }
    >
      {searchable ? (
        <View style={styles.search}>
          <SearchInput
            value={query}
            onChangeText={setQuery}
            onDebouncedChange={onSearchChange}
            placeholder={searchPlaceholder ?? t('select.search')}
          />
          {multi && picked.length > 0 ? (
            <Text variant="caption" tone="secondary">
              {t('select.selected', { count: picked.length })}
            </Text>
          ) : null}
        </View>
      ) : null}

      {error ? (
        <ErrorState error={error} onRetry={onRetry} size="inline" />
      ) : loading ? (
        <View style={styles.list}>
          <SkeletonList count={5} />
        </View>
      ) : visible.length === 0 ? (
        <View style={styles.list}>
          {showCreate ? (
            <Button
              title={t('select.create', { name: query.trim() })}
              icon={Plus}
              variant="secondary"
              fullWidth
              loading={creating}
              onPress={() => {
                onCreate?.(query.trim());
                setQuery('');
              }}
            />
          ) : (
            <EmptyState
              title={emptyTitle ?? t('state.noResults.title')}
              body={emptyBody ?? t('state.noResults.body')}
              size="inline"
            />
          )}
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
          ListFooterComponent={
            showCreate ? (
              <Button
                title={t('select.create', { name: query.trim() })}
                icon={Plus}
                variant="secondary"
                fullWidth
                loading={creating}
                onPress={() => {
                  onCreate?.(query.trim());
                  setQuery('');
                }}
                style={{ marginTop: space.md }}
              />
            ) : null
          }
          renderItem={({ item }) => {
            const key = keyExtractor(item);
            const isSelected = selection.includes(key);
            return (
              <ListRow
                title={labelExtractor(item)}
                subtitle={descriptionExtractor?.(item)}
                identifier={identifierExtractor?.(item)}
                value={valueExtractor?.(item)}
                leading={leadingIcon}
                selected={isSelected}
                accessory={
                  isSelected ? (
                    <Check color={colors.brand[600]} size={18} />
                  ) : (
                    accessoryExtractor?.(item)
                  )
                }
                chevron={false}
                onPress={() => choose(item)}
              />
            );
          }}
        />
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  search: {
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
    gap: space.xs,
  },
  list: {
    paddingHorizontal: space.lg,
    paddingBottom: space.base,
  },
});
