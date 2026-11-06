import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Store } from 'lucide-react-native';
import { Card, ErrorState, InlineNotice, ListRow, Screen, SkeletonList, Text } from '../../components/ui';
import { api } from '../../lib/api-client';
import { BRANCH_REQUESTS_KEY, stateBodyKey, stateLabelKey, type BranchRequest } from '../../lib/branch-requests';
import { space } from '../../lib/design/tokens';
import { useTranslation } from '../../lib/i18n';

/**
 * A store waiting for activation (0130), read-only: its name, its location and where it stands, as the server says. It
 * cannot be chosen or used from here, and nothing here asks for, shows or links to anything about paying: the Owner was
 * sent the instructions on their verified WhatsApp number.
 */
export default function BranchRequestStatus() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useQuery({
    queryKey: [...BRANCH_REQUESTS_KEY, id],
    queryFn: () => api.get<BranchRequest>(`/branches/requests/${id}`),
    enabled: typeof id === 'string' && id.length > 0,
  });
  const r = query.data;

  return (
    <Screen gap="lg">
      <Stack.Screen options={{ title: t('branchRequest.statusTitle') }} />
      {query.isLoading ? (
        <SkeletonList count={2} />
      ) : query.isError || !r ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <View style={styles.body}>
          <Card>
            <ListRow flat leading={Store} title={r.name} subtitle={t(stateLabelKey(r.state))} />
            {r.address ? <ListRow flat leading={MapPin} title={r.address} subtitle={t('branchRequest.location')} /> : null}
          </Card>
          <InlineNotice tone={r.state === 'active' ? 'success' : r.state === 'rejected' || r.state === 'cancelled' ? 'warning' : 'info'}>
            {t(stateBodyKey(r.state))}
          </InlineNotice>
          {r.state !== 'active' ? (
            <Text variant="caption" tone="secondary">
              {t('branchRequest.notUsable')}
            </Text>
          ) : null}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({ body: { gap: space.md } });
