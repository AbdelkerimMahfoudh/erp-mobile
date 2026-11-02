import React, { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, router, useLocalSearchParams, type Href } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Chip, EmptyState, ErrorState, InlineNotice, ListRow, MoneyField, MoneyValue, RowGroup, Screen, Section, SkeletonList, Text, TextField } from '../../components/ui';
import { api, ApiError } from '../../lib/api-client';
import { space } from '../../lib/design/tokens';
import { toFriendlyError } from '../../lib/errors';
import { useTranslation } from '../../lib/i18n';
import { selectableAccounts } from '../../lib/receiving-accounts';
import { qk } from '../../lib/query-keys';
import { toast } from '../../lib/toast';
import type { ReceivingAccount } from '../../components/sell/PaymentSheet';
import { uuidv4 } from '../../lib/utils';

interface Row {
  id: string;
  businessDate: string;
  description: string;
  customerPaid: number;
  repairAmount: number;
  profit: number;
  paidLabel: string | null;
  costLabel: string | null;
  reversesId: string | null;
}
type Method = { method: 'cash' } | { method: 'account'; accountId: string };

/**
 * Maintenance income (D227): money from a repair, never a sale. History with its totals; `?new=1` opens the form. The form asks
 * where each amount went only when there is one, shows the profit as it is typed, and carries one request id through every
 * retry, so a lost answer can never record it twice.
 */
export default function MaintenanceScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ new?: string }>();
  const [adding, setAdding] = useState(params.new === '1');
  const history = useQuery({ queryKey: ['maintenance'], queryFn: () => api.get<{ rows: Row[]; totals: { revenue: number; cost: number; profit: number } }>('/maintenance') });
  const accounts = useQuery({ queryKey: qk.settings, queryFn: () => api.get<{ receivingAccounts?: ReceivingAccount[] }>('/settings'), enabled: adding });

  const key = useRef(uuidv4());
  const [description, setDescription] = useState('');
  const [cost, setCost] = useState('');
  const [paid, setPaid] = useState('');
  const [note, setNote] = useState('');
  const [paidTo, setPaidTo] = useState<Method | null>(null);
  const [costFrom, setCostFrom] = useState<Method | null>(null);
  const [zeroOk, setZeroOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const costN = Number(cost) || 0;
  const paidN = Number(paid) || 0;
  const bothZero = costN === 0 && paidN === 0;
  const ready = description.trim().length > 0 && (paidN === 0 || paidTo) && (costN === 0 || costFrom) && (!bothZero || zeroOk);

  const save = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await api.post('/maintenance', {
        clientUuid: key.current,
        description: description.trim(),
        repairCost: costN,
        customerPaid: paidN,
        ...(paidN > 0 && paidTo ? { paidMethod: paidTo.method, ...(paidTo.method === 'account' ? { paidAccountId: paidTo.accountId } : {}) } : {}),
        ...(costN > 0 && costFrom ? { costMethod: costFrom.method, ...(costFrom.method === 'account' ? { costAccountId: costFrom.accountId } : {}) } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(bothZero ? { confirmZero: true } : {}),
      });
      key.current = uuidv4();
      setDescription('');
      setCost('');
      setPaid('');
      setNote('');
      setPaidTo(null);
      setCostFrom(null);
      setZeroOk(false);
      setAdding(false);
      void qc.invalidateQueries({ queryKey: ['maintenance'] });
      toast.success(t('maintenance.saved'));
    } catch (e) {
      // The same request id stays: trying again cannot record it twice.
      setProblem(e instanceof ApiError && e.code === 'store_closed' ? t('maintenance.closed') : toFriendlyError(e).title);
    } finally {
      setBusy(false);
    }
  };

  const header = <Stack.Screen options={{ headerShown: true, title: t('maintenance.title') }} />;

  if (adding) {
    const list = selectableAccounts(accounts.data?.receivingAccounts ?? []);
    const chooser = (chosen: Method | null, choose: (m: Method) => void) => (
      <View style={styles.chips}>
        <Button title={t('maintenance.cash')} size="sm" variant={chosen?.method === 'cash' ? 'primary' : 'secondary'} onPress={() => choose({ method: 'cash' })} />
        {list.map((a) => (
          <Button key={a.id} title={a.label} size="sm" variant={chosen?.method === 'account' && chosen.accountId === a.id ? 'primary' : 'secondary'} onPress={() => choose({ method: 'account', accountId: a.id })} />
        ))}
      </View>
    );
    return (
      <Screen>
        {header}
        <View style={styles.stack}>
          {problem ? <InlineNotice tone="danger">{problem}</InlineNotice> : null}
          <TextField label={t('maintenance.description')} value={description} onChangeText={setDescription} maxLength={200} />
          <MoneyField label={t('maintenance.customerPaid')} value={paid} onChangeText={setPaid} />
          {paidN > 0 ? (
            <View>
              <Text variant="label" tone="secondary">{t('maintenance.paidTo')}</Text>
              {chooser(paidTo, setPaidTo)}
            </View>
          ) : null}
          <MoneyField label={t('maintenance.repairCost')} value={cost} onChangeText={setCost} />
          {costN > 0 ? (
            <View>
              <Text variant="label" tone="secondary">{t('maintenance.costFrom')}</Text>
              {chooser(costFrom, setCostFrom)}
            </View>
          ) : null}
          <TextField label={t('maintenance.note')} value={note} onChangeText={setNote} multiline maxLength={500} />
          <View style={styles.total}>
            <Text tone="secondary">{t('maintenance.profit')}</Text>
            <MoneyValue value={paidN - costN} size="large" />
          </View>
          {bothZero ? <Button title={t('maintenance.zeroConfirm')} variant={zeroOk ? 'primary' : 'secondary'} onPress={() => setZeroOk((v) => !v)} /> : null}
          <Button title={t('maintenance.save')} fullWidth loading={busy} disabled={!ready} onPress={() => void save()} />
          <Button title={t('action.cancel')} variant="tertiary" onPress={() => setAdding(false)} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen footer={<Button title={t('maintenance.add')} fullWidth onPress={() => setAdding(true)} />}>
      {header}
      {history.isError && !history.data ? <ErrorState error={history.error} onRetry={() => void history.refetch()} /> : null}
      {history.isLoading ? <SkeletonList /> : null}
      {history.data ? (
        <>
          <View style={styles.total}>
            <Text tone="secondary">{t('maintenance.totalProfit')}</Text>
            <MoneyValue value={history.data.totals.profit} size="large" />
          </View>
          <Text variant="caption" tone="tertiary">{t('maintenance.separate')}</Text>
          {history.data.rows.length === 0 ? (
            <EmptyState title={t('maintenance.none')} />
          ) : (
            <Section>
              <RowGroup>
                {history.data.rows.map((r) => (
                  <ListRow
                    key={r.id}
                    flat
                    title={r.description}
                    subtitle={r.businessDate}
                    accessory={r.reversesId ? <Chip label={t('maintenance.reversal')} tone="warning" size="sm" /> : <MoneyValue value={r.profit} size="small" />}
                    onPress={() => router.push(`/maintenance/${r.id}` as Href)}
                  />
                ))}
              </RowGroup>
            </Section>
          )}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  total: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
