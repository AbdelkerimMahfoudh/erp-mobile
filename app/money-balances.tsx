import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, ErrorState, InlineNotice, MoneyField, MoneyValue, Screen, SkeletonList, Text, TextField, Toggle } from '../components/ui';
import { api, ApiError } from '../lib/api-client';
import { space } from '../lib/design/tokens';
import { toFriendlyError } from '../lib/errors';
import { useTranslation } from '../lib/i18n';
import { toast } from '../lib/toast';

export interface TrackedLocation {
  location: string;
  label: string | null;
  on: boolean;
  openingAmount?: number;
  effectiveDate?: string;
  moneyIn?: number;
  moneyOut?: number;
  expected?: number;
  version?: number;
}
export interface TrackedBalances {
  asOf: string;
  locations: TrackedLocation[];
}
export const BALANCES_KEY = ['money', 'tracking'] as const;

/**
 * Dedicated store balances (D227). Off by default, one choice per location: a customer can still pay by any method either way.
 * On, the figure is what Dukan's records add up to, never what the cash, wallet or bank really holds, and it says so.
 */
export default function MoneyBalancesScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const balances = useQuery({ queryKey: BALANCES_KEY, queryFn: () => api.get<TrackedBalances>('/money/tracking') });
  const [editing, setEditing] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    setProblem(null);
    try {
      qc.setQueryData(BALANCES_KEY, await api.post<TrackedBalances>('/money/tracking', body));
      void qc.invalidateQueries({ queryKey: ['closing'] });
      setEditing(null);
      toast.success(t('balances.saved'));
    } catch (e) {
      setProblem(e instanceof ApiError && e.code === 'stale_version' ? t('balances.stale') : toFriendlyError(e).title);
    } finally {
      setBusy(false);
    }
  };

  const header = <Stack.Screen options={{ headerShown: true, title: t('balances.title') }} />;
  if (balances.isError && !balances.data) {
    return (
      <Screen>
        {header}
        <ErrorState error={balances.error} onRetry={() => void balances.refetch()} />
      </Screen>
    );
  }
  if (!balances.data) {
    return (
      <Screen>
        {header}
        <SkeletonList />
      </Screen>
    );
  }
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
  return (
    <Screen>
      {header}
      <View style={styles.stack}>
        <Text tone="secondary">{t('balances.explain')}</Text>
        {problem ? <InlineNotice tone="danger">{problem}</InlineNotice> : null}
        {balances.data.locations.map((l) => {
          const name = l.label ?? t('balances.cash');
          return (
            <Card key={l.location} style={styles.stack}>
              <Toggle
                flat
                label={name}
                hint={t('balances.toggle')}
                                  value={l.on || editing === l.location}
                  disabled={busy}
                  onValueChange={(next: boolean) => {
                    if (next) {
                      setAmount('');
                      setDate(balances.data.asOf);
                      setEditing(l.location);
                    } else if (l.on) {
                      void send({ location: l.location, on: false, expectedVersion: l.version });
                    } else {
                      setEditing(null);
                    }
                  }}
                />
              {l.on ? (
                <>
                  <View style={styles.line}>
                    <Text tone="secondary" style={styles.flex}>{t('balances.expected')}</Text>
                    <MoneyValue value={l.expected ?? 0} size="large" />
                  </View>
                  <Text variant="caption" tone="tertiary">{t('balances.notLive', { date: l.effectiveDate ?? '' })}</Text>
                </>
              ) : editing === l.location ? (
                <>
                  <MoneyField label={t('balances.opening')} value={amount} onChangeText={setAmount} />
                  <TextField label={t('balances.date')} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" />
                  <Button
                    title={t('balances.start')}
                    loading={busy}
                    disabled={amount.trim() === '' || !validDate}
                    onPress={() => void send({ location: l.location, on: true, openingAmount: Number(amount), effectiveDate: date, expectedVersion: l.version })}
                  />
                </>
              ) : (
                <Text variant="caption" tone="tertiary">{t('balances.off')}</Text>
              )}
            </Card>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.sm },
  flex: { flex: 1 },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
});
