import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Store } from 'lucide-react-native';
import { Button, InlineNotice, PageIntro, Screen, TextField } from '../components/ui';
import { api, ApiError } from '../lib/api-client';
import { useAskingKey } from '../lib/asking-key';
import { BRANCH_LOCATION_MAX, BRANCH_NAME_MAX, BRANCH_REQUESTS_KEY, cleanBranchInput, type BranchRequest } from '../lib/branch-requests';
import { space } from '../lib/design/tokens';
import { useTranslation, type TranslationKey } from '../lib/i18n';
import { toast } from '../lib/toast';

/** The store list this screen was opened from, and returns to. */
const STORE_LIST = '/select-branch' as const;

const ERRORS: Record<string, TranslationKey> = {
  name_required: 'branchRequest.error.nameRequired',
  branch_name_required: 'branchRequest.error.nameRequired',
  name_too_long: 'branchRequest.error.nameTooLong',
  branch_name_too_long: 'branchRequest.error.nameTooLong',
  address_too_long: 'branchRequest.error.locationTooLong',
  branch_address_too_long: 'branchRequest.error.locationTooLong',
  branch_name_in_use: 'branchRequest.error.nameInUse',
};

/**
 * Add a store (0130; the owner's brief of 2026-11-05) — the Owner only, from the store list.
 *
 * A name (required, unique in the business) and an optional location: nothing about staff, stock or money. Before
 * sending, the Owner reads what happens: the store is created waiting for activation, cannot be used until it is
 * activated, and the instructions go to their verified WhatsApp number. The active store does not change. A second tap,
 * or a retry after a lost answer, sends the same key: the server returns the one request.
 */
export default function BranchNew() {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const asking = useAskingKey();
  const [name, setName] = useState('');
  const [place, setPlace] = useState('');
  const [error, setError] = useState<TranslationKey | null>(null);

  const create = useMutation({
    mutationFn: (body: { name: string; address?: string; requestKey: string }) =>
      api.post<{ request: BranchRequest; created: boolean }>('/branches/requests', body),
  });

  const submit = () => {
    const input = cleanBranchInput(name, place);
    if ('error' in input) {
      setError(ERRORS[input.error]);
      return;
    }
    setError(null);
    asking.once((done) => {
      const requestKey = asking.keyFor(`${input.name}\u0000${input.address ?? ''}`);
      create.mutate(
        { ...input, requestKey },
        {
          onSuccess: (r) => {
            asking.settled();
            void queryClient.invalidateQueries({ queryKey: BRANCH_REQUESTS_KEY });
            toast.success(t('branchRequest.created'));
            router.dismissTo(STORE_LIST);
            router.push({ pathname: '/branch-request/[id]', params: { id: r.request.id } });
          },
          onError: (e) => {
            const code = e instanceof ApiError ? e.code : undefined;
            setError(code && ERRORS[code] ? ERRORS[code] : null);
            if (!code || !ERRORS[code]) toast.error(t('branchRequest.error.generic'));
          },
          onSettled: done,
        },
      );
    });
  };

  return (
    <Screen gap="lg" footer={<Button title={t('branchRequest.submit')} icon={Store} onPress={submit} loading={create.isPending} fullWidth />}>
      <Stack.Screen options={{ title: t('branchRequest.add') }} />
      <PageIntro description={t('branchRequest.intro')} />
      <View style={styles.fields}>
        <TextField
          label={t('branchRequest.name')}
          value={name}
          onChangeText={(v) => {
            setName(v);
            setError(null);
          }}
          required
          maxLength={BRANCH_NAME_MAX}
          autoCapitalize="words"
          error={error && error !== 'branchRequest.error.locationTooLong' ? t(error) : undefined}
        />
        <TextField
          label={t('branchRequest.location')}
          hint={t('branchRequest.locationHint')}
          value={place}
          onChangeText={setPlace}
          maxLength={BRANCH_LOCATION_MAX}
          error={error === 'branchRequest.error.locationTooLong' ? t(error) : undefined}
        />
      </View>
      <InlineNotice tone="info" title={t('branchRequest.before.title')}>
        {t('branchRequest.before.body')}
      </InlineNotice>
    </Screen>
  );
}

const styles = StyleSheet.create({ fields: { gap: space.md } });
