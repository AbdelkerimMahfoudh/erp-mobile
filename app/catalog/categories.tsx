import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react-native';
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  ListRow,
  Screen,
  SegmentedControl,
  SkeletonList,
  Text,
  TextField,
  Toggle,
} from '../../components/ui';
import { BottomSheet } from '../../components/overlay';
import { ApiError, api } from '../../lib/api-client';
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
 */
export default function CategoriesScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const canManage = usePermission('catalog.manage');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Category | 'new' | null>(null);

  const categories = useQuery({
    queryKey: qk.categories,
    queryFn: () => api.get<Category[]>('/categories?includeInactive=true'),
  });

  const rows = (categories.data ?? []).filter((c) => showInactive || c.isActive);

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
          {rows.map((c) => (
            <ListRow
              key={c.id}
              title={c.name}
              subtitle={t(`catalog.tracking.${c.defaultTrackingType}` as never)}
              // Status in colour AND words — never colour alone.
              accessory={
                c.isActive ? undefined : <Chip tone="neutral" label={t('catalog.status.archived')} dot />
              }
              onPress={() => setEditing(c)}
            />
          ))}
        </View>
      )}

      <CategorySheet
        category={editing}
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
  onClose,
  onSaved,
}: {
  category: Category | 'new' | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const isNew = category === 'new';
  const existing = category && category !== 'new' ? category : null;

  const [name, setName] = useState('');
  const [tracking, setTracking] = useState<TrackingType>('quantity');
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!category) return;
    setName(existing?.name ?? '');
    setTracking(existing?.defaultTrackingType ?? 'quantity');
    setIsActive(existing?.isActive ?? true);
    setError(undefined);
  }, [category, existing]);

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), defaultTrackingType: tracking };
      return existing
        ? api.patch<Category>(`/categories/${existing.id}`, { ...body, isActive })
        : api.post<Category>('/categories', body);
    },
    onSuccess: () => {
      toast.success(t(existing ? 'categories.updated' : 'categories.created'));
      onSaved();
    },
    onError: (e) => {
      if (e instanceof ApiError && (e.status === 409 || e.status === 400)) {
        setError(t('categories.duplicate'));
        return;
      }
      toast.error(e instanceof ApiError ? e.message : t('state.error.body'));
    },
  });

  const submit = () => {
    if (!name.trim()) {
      setError(t('catalog.form.required'));
      return;
    }
    save.mutate();
  };

  return (
    <BottomSheet
      open={category !== null}
      onClose={onClose}
      title={t(isNew ? 'categories.newTitle' : 'categories.editTitle')}
      footer={<Button title={t('action.save')} onPress={submit} loading={save.isPending} fullWidth />}
    >
      <View style={styles.sheet}>
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
              { value: 'serial', label: t('catalog.tracking.serial') },
              { value: 'quantity', label: t('catalog.tracking.quantity') },
            ]}
          />
        </View>

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
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  note: { marginTop: space.xs },
  list: { gap: space.sm },
  sheet: { gap: space.base },
});
