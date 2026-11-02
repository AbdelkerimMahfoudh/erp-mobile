import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Store } from 'lucide-react-native';
import { Button, Chip, ErrorState, InlineNotice, ListRow, RowGroup, Section, SkeletonList, Text } from '../ui';
import { BottomSheet } from '../overlay';
import { BilingualNameFields, bilingualNameErrors, nameErrorText } from './BilingualNameFields';
import { api } from '../../lib/api-client';
import { useBranch } from '../../lib/branch';
import { space } from '../../lib/design/tokens';
import { displayName } from '../../lib/display-name';
import { toFriendlyError } from '../../lib/errors';
import { useTranslation } from '../../lib/i18n';
import { qk } from '../../lib/query-keys';
import { toast } from '../../lib/toast';
import { useAuth } from '../../hooks/useAuth';

interface Named {
  /** Optional for the business: a registered or trading name, when there is one (D227). */
  name: string | null;
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
 * The optional trading name and the stores' Latin and Arabic names (D225, D227), inside Business settings (2026-10-31: the separate
 * More → "Business and store names" entry is gone). The Owner's: the business first, then one row per store, each
 * opening its own names. working.
 * A rename changes what screens show from now on; a receipt already issued keeps the names it was issued under.
 *
 * A failure here stays here: the rest of Business settings keeps working, and the words are the app's own.
 */
export function NamesSection() {
  const { t, language } = useTranslation();
  const [editing, setEditing] = useState<Editing | null>(null);
  const query = useQuery({ queryKey: NAMES_KEY, queryFn: () => api.get<NamesOverview>('/business/names') });

  const row = (named: Named, onPress: () => void, icon: typeof Store, key?: string) => (
    <ListRow
      flat
      key={key}
      leading={icon}
      title={displayName(named, language) || t('names.trading.none')}
      // The other script under it, so the Owner sees both names at a glance.
      subtitle={(language === 'ar' ? named.name : named.nameAr) ?? undefined}
      onPress={onPress}
    />
  );

  return (
    <Section title={t('names.screen.title')} subtitle={t('names.screen.subtitle')}>
      {query.isLoading ? (
        <SkeletonList count={2} />
      ) : query.isError || !query.data ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <View style={styles.section}>
          <Text variant="label" tone="secondary">
            {t('names.screen.business')}
          </Text>
          <RowGroup>{row(query.data.business, () => setEditing({ kind: 'business', current: query.data.business }), Building2)}</RowGroup>
          <Text variant="label" tone="secondary">
            {t('names.screen.stores')}
          </Text>
          <RowGroup>
            {query.data.stores.map((s) => row(s, () => setEditing({ kind: 'store', id: s.id, current: s }), Store, s.id))}
          </RowGroup>
        </View>
      )}
      <NamesSheet editing={editing} onClose={() => setEditing(null)} />
    </Section>
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
    setValue({ name: editing.current.name ?? '', nameAr: editing.current.nameAr ?? '' });
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
        useBranch.setState({ branchName: fresh.name ?? '', branchNameAr: fresh.nameAr });
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
    const problems = bilingualNameErrors({ name, nameAr }, { nameOptional: editing.kind === 'business' });
    const next = { name: nameErrorText(problems.name, t), nameAr: nameErrorText(problems.nameAr, t) };
    setErrors(next);
    if (next.name || next.nameAr) return;
    // Each name on its own: only what changed is sent, and the server never touches the other.
    const body: Record<string, string> = {};
    if (name !== (editing.current.name ?? '')) body.name = name;
    if (nameAr !== (editing.current.nameAr ?? '')) body.nameAr = nameAr;
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
      <BilingualNameFields value={value} onChange={setValue} errors={errors} nameOptional={editing?.kind === 'business'} hint={editing?.kind === 'business' ? t('names.trading.hint') : undefined} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
});
