import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Store } from 'lucide-react-native';
import { Button, Chip, ErrorState, InlineNotice, ListRow, PageIntro, RowGroup, Screen, SkeletonList, Text } from '../components/ui';
import { BottomSheet } from '../components/overlay';
import { BilingualNameFields, bilingualNameErrors, nameErrorText } from '../components/names/BilingualNameFields';
import { ApiError, api } from '../lib/api-client';
import { useBranch } from '../lib/branch';
import { space } from '../lib/design/tokens';
import { displayName } from '../lib/display-name';
import { toFriendlyError } from '../lib/errors';
import { useTranslation } from '../lib/i18n';
import { usePermission } from '../lib/permissions';
import { qk } from '../lib/query-keys';
import { toast } from '../lib/toast';
import { useAuth } from '../hooks/useAuth';

interface Named {
  name: string;
  nameAr: string | null;
  nameIncomplete: boolean;
}

interface NamesOverview {
  business: Named;
  stores: (Named & { id: string })[];
}

type Editing = { kind: 'business'; current: Named } | { kind: 'store'; id: string; current: Named };

const NAMES_KEY = ['business-names'] as const;

/**
 * More → Business and store names (D225). The Owner's: each name in the Latin alphabet and in Arabic, the Arabic one
 * shown on the Arabic screens. A record created before the Arabic names existed is marked "Arabic name missing" and
 * keeps working meanwhile. A rename changes what the screens show from now on; a receipt already issued keeps the
 * names it was issued under.
 */
export default function NamesScreen() {
  const { t, language } = useTranslation();
  const canManage = usePermission('settings.manage');
  const [editing, setEditing] = useState<Editing | null>(null);
  const header = <Stack.Screen options={{ headerShown: true, title: t('names.screen.title') }} />;

  const query = useQuery({
    queryKey: NAMES_KEY,
    queryFn: () => api.get<NamesOverview>('/business/names'),
    enabled: canManage,
  });

  if (!canManage) {
    return (
      <Screen>
        {header}
        <ErrorState error={new ApiError(t('state.error.permission.body'), 403)} />
      </Screen>
    );
  }
  if (query.isLoading) {
    return (
      <Screen>
        {header}
        <SkeletonList count={3} />
      </Screen>
    );
  }
  if (query.isError || !query.data) {
    return (
      <Screen>
        {header}
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </Screen>
    );
  }

  const { business, stores } = query.data;
  const incomplete = business.nameIncomplete || stores.some((s) => s.nameIncomplete);
  const row = (named: Named, onPress: () => void, icon: typeof Store, key?: string) => (
    <ListRow
      flat
      key={key}
      leading={icon}
      title={displayName(named, language)}
      // The other script under it, so the Owner sees both names at a glance.
      subtitle={language === 'ar' ? named.name : (named.nameAr ?? undefined)}
      accessory={named.nameIncomplete ? <Chip tone="warning" label={t('names.incomplete')} /> : undefined}
      onPress={onPress}
    />
  );

  return (
    <Screen gap="xl">
      {header}
      <PageIntro description={t('names.screen.subtitle')} />
      {incomplete ? (
        <InlineNotice tone="warning" title={t('names.prompt.title')}>
          {t('names.prompt.body')}
        </InlineNotice>
      ) : null}

      <View style={styles.section}>
        <Text variant="label" tone="secondary">
          {t('names.screen.business')}
        </Text>
        <RowGroup>{row(business, () => setEditing({ kind: 'business', current: business }), Building2)}</RowGroup>
      </View>

      <View style={styles.section}>
        <Text variant="label" tone="secondary">
          {t('names.screen.stores')}
        </Text>
        <RowGroup>
          {stores.map((s) => row(s, () => setEditing({ kind: 'store', id: s.id, current: s }), Store, s.id))}
        </RowGroup>
      </View>

      <NamesSheet editing={editing} onClose={() => setEditing(null)} />
    </Screen>
  );
}

function NamesSheet({ editing, onClose }: { editing: Editing | null; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { refreshUser } = useAuth();
  const activeBranchId = useBranch((s) => s.branchId);
  const [value, setValue] = useState({ name: '', nameAr: '' });
  const [errors, setErrors] = useState<{ name?: string; nameAr?: string }>({});

  useEffect(() => {
    if (!editing) return;
    setValue({ name: editing.current.name, nameAr: editing.current.nameAr ?? '' });
    setErrors({});
  }, [editing]);

  const save = useMutation({
    mutationFn: (body: Record<string, string>) =>
      editing?.kind === 'store'
        ? api.patch<Named>(`/branches/${editing.id}/names`, body)
        : api.patch<Named>('/business/names', body),
    onSuccess: async (fresh) => {
      void queryClient.invalidateQueries({ queryKey: NAMES_KEY });
      void queryClient.invalidateQueries({ queryKey: qk.branches });
      if (editing?.kind === 'store' && editing.id === activeBranchId) {
        useBranch.setState({ branchName: fresh.name, branchNameAr: fresh.nameAr });
      }
      if (editing?.kind === 'business') await refreshUser().catch(() => undefined);
      toast.success(t('names.screen.saved'));
      onClose();
    },
    onError: (error) => toast.error(toFriendlyError(error).body),
  });

  const submit = () => {
    if (!editing) return;
    const name = value.name.trim();
    const nameAr = value.nameAr.trim();
    const problems = bilingualNameErrors({ name, nameAr }, { arabicRequired: false });
    const next = { name: nameErrorText(problems.name, t), nameAr: nameErrorText(problems.nameAr, t) };
    setErrors(next);
    if (next.name || next.nameAr) return;
    // Each name on its own: only what changed is sent, and the server never touches the other.
    const body: Record<string, string> = {};
    if (name !== editing.current.name) body.name = name;
    if (nameAr && nameAr !== (editing.current.nameAr ?? '')) body.nameAr = nameAr;
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    save.mutate(body);
  };

  return (
    <BottomSheet
      scroll
      open={editing !== null}
      onClose={onClose}
      title={t(editing?.kind === 'store' ? 'names.screen.editStore' : 'names.screen.editBusiness')}
      footer={<Button title={t('action.save')} onPress={submit} loading={save.isPending} fullWidth />}
    >
      <BilingualNameFields value={value} onChange={setValue} errors={errors} arabicRequired={false} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
});
