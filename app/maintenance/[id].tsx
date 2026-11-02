import React, { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, ErrorState, InlineNotice, MoneyValue, Screen, SkeletonList, Text, TextField } from '../../components/ui';
import { api } from '../../lib/api-client';
import { space } from '../../lib/design/tokens';
import { toFriendlyError } from '../../lib/errors';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import { toast } from '../../lib/toast';
import { uuidv4 } from '../../lib/utils';

interface Detail {
  id: string;
  businessDate: string;
  description: string;
  customerPaid: number;
  repairAmount: number;
  profit: number;
  paidLabel: string | null;
  paidMethod: string | null;
  costLabel: string | null;
  costMethod: string | null;
  note: string | null;
  reversesId: string | null;
  reversedBy: string | null;
}

/** One repair. It is never edited: a correction is a reversing entry dated the day it is made. */
export default function MaintenanceDetailScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const canReverse = usePermission('financial.correction.approve');
  const row = useQuery({ queryKey: ['maintenance', id], queryFn: () => api.get<Detail>(`/maintenance/${id}`) });
  const key = useRef(uuidv4());
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const reverse = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await api.post(`/maintenance/${id}/reverse`, { clientUuid: key.current, reason: reason.trim() });
      void qc.invalidateQueries({ queryKey: ['maintenance'] });
      toast.success(t('maintenance.reversed'));
    } catch (e) {
      setProblem(toFriendlyError(e).title);
    } finally {
      setBusy(false);
    }
  };

  const header = <Stack.Screen options={{ headerShown: true, title: t('maintenance.title') }} />;
  if (row.isError && !row.data) {
    return (
      <Screen>
        {header}
        <ErrorState error={row.error} onRetry={() => void row.refetch()} />
      </Screen>
    );
  }
  if (!row.data) {
    return (
      <Screen>
        {header}
        <SkeletonList />
      </Screen>
    );
  }
  const r = row.data;
  const channel = (method: string | null, label: string | null) => (method === 'cash' ? t('maintenance.cash') : label ?? '');
  return (
    <Screen>
      {header}
      <View style={styles.stack}>
        <Text variant="bodyStrong">{r.description}</Text>
        <Text variant="caption" tone="tertiary">{r.businessDate}</Text>
        <View style={styles.line}>
          <Text tone="secondary">{t('maintenance.customerPaid')}</Text>
          <MoneyValue value={r.customerPaid} />
        </View>
        {r.paidMethod ? <Text variant="caption" tone="tertiary">{channel(r.paidMethod, r.paidLabel)}</Text> : null}
        <View style={styles.line}>
          <Text tone="secondary">{t('maintenance.repairCost')}</Text>
          <MoneyValue value={r.repairAmount} />
        </View>
        {r.costMethod ? <Text variant="caption" tone="tertiary">{channel(r.costMethod, r.costLabel)}</Text> : null}
        <View style={styles.line}>
          <Text tone="secondary">{t('maintenance.profit')}</Text>
          <MoneyValue value={r.profit} size="large" />
        </View>
        {r.note ? <Text tone="secondary">{r.note}</Text> : null}
        {r.reversedBy ? <InlineNotice tone="warning">{t('maintenance.alreadyReversed')}</InlineNotice> : null}
        {r.reversesId ? <InlineNotice tone="warning">{t('maintenance.reversal')}</InlineNotice> : null}
        {problem ? <InlineNotice tone="danger">{problem}</InlineNotice> : null}
        {canReverse && !r.reversedBy && !r.reversesId ? (
          <>
            <TextField label={t('maintenance.reverseReason')} value={reason} onChangeText={setReason} maxLength={500} />
            <Button title={t('maintenance.reverse')} variant="secondary" loading={busy} disabled={reason.trim().length === 0} onPress={() => void reverse()} />
          </>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.sm },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
