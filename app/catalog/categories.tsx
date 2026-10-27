import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react-native';
import {
  Button,
  Chip,
  EmptyState,
  InlineNotice,
  ErrorState,
  ListRow,
  Screen,
  SegmentedControl,
  SkeletonList,
  Text,
  TextField,
  Toggle,
} from '../../components/ui';
import { BottomSheet, SelectSheet } from '../../components/overlay';
import { inTreeOrder } from '../../lib/category-label';
import { useCategoryLabel } from '../../lib/use-category-label';
import { ApiError, api } from '../../lib/api-client';
import { toFriendlyError } from '../../lib/errors';
import { space } from '../../lib/design/tokens';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import { qk } from '../../lib/query-keys';
import { toast } from '../../lib/toast';
import type { Category, TrackingType } from '../../types/api';

/**
 * Catalog → Categories (G1). Owner and Store Manager only (`catalog.manage`).
 *
 * Uses the existing category API rather than a second one. There is **no
 * delete**: a category is deactivated, which only hides it when adding new
 * products — existing products, their stock and their history keep it and stay
 * visible. Merging is deliberately not built.
 *
 * D223: every shop starts with the built-in categories (Phones › Smartphones,
 * Cables › USB-C, …), shown in the reader's language by their stable key. A
 * built-in can only be hidden or shown again; the shop adds its own categories,
 * top-level or one level under another.
 */
export default function CategoriesScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const canManage = usePermission('catalog.manage');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const label = useCategoryLabel();

  const categories = useQuery({
    queryKey: qk.categories,
    queryFn: () => api.get<Category[]>('/categories?includeInactive=true'),
  });

  const rows = inTreeOrder(
    (categories.data ?? []).filter((c) => showInactive || c.isActive),
    label,
  );

  if (!canManage) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: t('categories.title') }} />
        <ErrorState error={new ApiError(t('state.error.permission.body'), 403)} />
      </Screen>
    );
  }

  return (
    <Screen
      gap="xl"
      footer={<Button title={t('categories.add')} icon={Plus} onPress={() => setEditing('new')} fullWidth />}
    >
      <Stack.Screen options={{ headerShown: true, title: t('categories.title') }} />

      <View>
        <Text variant="title">{t('categories.title')}</Text>
        <Text variant="caption" tone="secondary" style={styles.note}>
          {t('categories.subtitle')}
        </Text>
      </View>

      <Toggle
        label={t('categories.showInactive')}
        onLabel={t('settings.toggle.on')}
        offLabel={t('settings.toggle.off')}
        value={showInactive}
        onValueChange={setShowInactive}
      />

      {categories.isLoading ? (
        <SkeletonList count={4} />
      ) : categories.isError ? (
        <ErrorState error={categories.error} onRetry={() => void categories.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('categories.empty')} body={t('categories.emptyBody')} />
      ) : (
        <View style={styles.list}>
          {rows.map(({ category: c, depth }) => (
            <View key={c.id} style={depth ? styles.child : undefined}>
              <ListRow
                title={label(c)}
                subtitle={t(`catalog.tracking.${c.defaultTrackingType}` as never)}
                // Status in colour AND words — never colour alone.
                accessory={
                  !c.isActive ? (
                    <Chip tone="neutral" label={t('catalog.status.archived')} dot />
                  ) : c.key ? (
                    <Chip tone="neutral" label={t('categories.builtin')} />
                  ) : undefined
                }
                onPress={() => setEditing(c)}
              />
            </View>
          ))}
        </View>
      )}

      <CategorySheet
        category={editing}
        all={categories.data ?? []}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          // Categories drive the product form's picker and the catalog filter.
          void queryClient.invalidateQueries({ queryKey: qk.categories });
          void queryClient.invalidateQueries({ queryKey: ['products'] });
        }}
      />
    </Screen>
  );
}

/**
 * Create or edit one category. Saves on its own rather than joining a page-level
 * draft: each is its own row, and a duplicate-name rejection should turn one
 * field red instead of failing the whole screen.
 */
function CategorySheet({
  category,
  all,
  onClose,
  onSaved,
}: {
  category: Category | 'new' | null;
  all: readonly Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const label = useCategoryLabel();
  const isNew = category === 'new';
  const existing = category && category !== 'new' ? category : null;
  /** A built-in is shared vocabulary: it can be hidden or shown, nothing else (D223). */
  const builtIn = Boolean(existing?.key);

  const [name, setName] = useState('');
  const [tracking, setTracking] = useState<TrackingType>('quantity');
  const [isActive, setIsActive] = useState(true);
  const [parentId, setParentId] = useState<string | null>(null);
  const [parentSheet, setParentSheet] = useState(false);
  const [error, setError] = useState<string | undefined>();

  /** Where a category may go: an active top-level category other than itself. One level only. */
  const parents = all.filter((c) => !c.parentId && c.isActive && c.id !== existing?.id);
  const hasChildren = Boolean(existing && all.some((c) => c.parentId === existing.id));
  const parent = all.find((c) => c.id === parentId) ?? null;

  useEffect(() => {
    if (!category) return;
    setName(existing?.name ?? '');
    setTracking(existing?.defaultTrackingType ?? 'quantity');
    setIsActive(existing?.isActive ?? true);
    setParentId(existing?.parentId ?? null);
    setError(undefined);
  }, [category, existing]);

  const save = useMutation({
    mutationFn: () => {
      if (existing && builtIn) return api.patch<Category>(`/categories/${existing.id}`, { isActive });
      const body = { name: name.trim(), defaultTrackingType: tracking };
      return existing
        ? api.patch<Category>(`/categories/${existing.id}`, { ...body, isActive, parentId })
        : api.post<Category>('/categories', { ...body, ...(parentId ? { parentId } : {}) });
    },
    onSuccess: () => {
      toast.success(t(existing ? 'categories.updated' : 'categories.created'));
      onSaved();
    },
    onError: (e) => {
      // A mode the parent does not allow, or a depth the server refuses: its own words.
      if (e instanceof ApiError && (e.code === 'category_mode_not_allowed' || e.code === 'category_depth')) {
        setError(e.message);
        return;
      }
      if (e instanceof ApiError && (e.status === 409 || e.status === 400)) {
        setError(t('categories.duplicate'));
        return;
      }
      toast.error(toFriendlyError(e).body);
    },
  });

  const submit = () => {
    if (!builtIn && !name.trim()) {
      setError(t('catalog.form.required'));
      return;
    }
    save.mutate();
  };

  return (
    <BottomSheet
      scroll
      open={category !== null}
      onClose={onClose}
      title={t(isNew ? 'categories.newTitle' : 'categories.editTitle')}
      footer={<Button title={t('action.save')} onPress={submit} loading={save.isPending} fullWidth />}
    >
      <View style={styles.sheet}>
        {existing && builtIn ? (
          <>
            <Text variant="heading">{label(existing)}</Text>
            <InlineNotice tone="info">{t('categories.builtinFixed')}</InlineNotice>
          </>
        ) : (
        <>
        <TextField
          label={t('categories.name')}
          required
          value={name}
          error={error}
          onChangeText={(v) => {
            setName(v);
            setError(undefined);
          }}
          maxLength={80}
        />

        <View>
          <Text variant="label">{t('categories.tracking')}</Text>
          <SegmentedControl
            style={styles.note}
            value={tracking}
            onChange={(v) => setTracking(v as TrackingType)}
            options={[
              { value: 'imei', label: t('catalog.tracking.imei') },
              /*
                `serial` is offered again (D223): televisions, laptops and
                consoles carry a serial and no IMEI. A shop's own category
                allows every mode; under a built-in parent the server keeps
                the parent's allowed modes and says so if one is refused.
              */
              { value: 'serial', label: t('catalog.tracking.serial') },
              { value: 'quantity', label: t('catalog.tracking.quantity') },
            ]}
          />
          {/*
            Stated rather than enforced here, because the client does not know
            how many products use this category and must not guess. The server
            refuses the change and says how many are affected; this makes that
            refusal unsurprising instead of a wall the employee walks into.
          */}
          <Text variant="caption" tone="secondary" style={styles.note}>
            {existing ? t('categories.tracking.locked') : t('categories.tracking.hint')}
          </Text>
        </View>

        {/* One level deep: a category with subcategories of its own stays top-level. */}
        {hasChildren ? null : (
          <ListRow
            title={parent ? label(parent) : t('categories.parent.none')}
            subtitle={t('categories.parent.label')}
            onPress={() => setParentSheet(true)}
          />
        )}
        </>
        )}

        {/* Deactivating is the only "removal" — history must stay readable. */}
        {existing ? (
          <Toggle
            label={t('categories.active')}
            hint={t('categories.activeHint')}
            onLabel={t('settings.toggle.on')}
            offLabel={t('settings.toggle.off')}
            value={isActive}
            onValueChange={setIsActive}
          />
        ) : null}
      </View>
      <SelectSheet
        open={parentSheet}
        onClose={() => setParentSheet(false)}
        title={t('categories.parent.label')}
        items={[{ id: '', name: t('categories.parent.none'), defaultTrackingType: 'quantity', isActive: true } as Category, ...parents]}
        keyExtractor={(c: Category) => c.id || 'none'}
        labelExtractor={(c: Category) => (c.id ? label(c) : c.name)}
        selectedKeys={[parentId ?? 'none']}
        onSelect={(c: Category) => {
          setParentId(c.id || null);
          setParentSheet(false);
        }}
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  note: { marginTop: space.xs },
  list: { gap: space.sm },
  child: { paddingStart: space.xl },
  sheet: { gap: space.base },
});
