import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Lock, Plus } from 'lucide-react-native';
import {
  Button,
  Card,
  Divider,
  InlineNotice,
  MoneyField,
  MoneyValue,
  Screen,
  Section,
  Text,
  TextField,
} from '../components/ui';
import { api, ApiError } from '../lib/api-client';
import { qk } from '../lib/query-keys';
import { useBranch } from '../lib/branch';
import { useConnectivity } from '../lib/connectivity';
import { space } from '../lib/design/tokens';
import { useTranslation } from '../lib/i18n';
import { RefundReconciliation } from '../components/returns/RefundReconciliation';

/**
 * Daily closing — counting the till and locking the day.
 *
 * Rebuilt for the UX pilot: it was hardcoded English, which is a poor place for
 * it. This is the screen where someone reconciles real money at the end of a
 * shift, and where "expected" versus "counted" has to be unambiguous in the
 * reader's own language.
 *
 * **No behaviour changed.** Expenses are Milestone D; this pass translates and
 * restyles only.
 */

interface Expense {
  id: string;
  category: string;
  amount?: number;
  spentOn: string;
}

interface ClosingResult {
  date: string;
  digest: {
    revenue: number;
    costOfGoodsSold?: number;
    grossProfit?: number;
    expenses?: number;
    netProfit?: number;
  };
  cash: { expected: number; counted: number; difference: number };
  comparison: {
    today: { revenue: number; netProfit?: number };
    yesterday: { revenue: number };
    monthToDate: { revenue: number };
  };
}

const today = new Date().toISOString().slice(0, 10);

export default function ClosingScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { branchId } = useBranch();
  const offline = !useConnectivity((s) => s.online);

  const expenses = useQuery({
    queryKey: qk.expenses(branchId, today),
    queryFn: () => api.get<Expense[]>(`/expenses?date=${today}`),
  });

  const [cat, setCat] = useState('');
  const [amt, setAmt] = useState('');
  const [counted, setCounted] = useState('');
  const [result, setResult] = useState<ClosingResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const addExpense = useMutation({
    mutationFn: () => api.post<Expense>('/expenses', { category: cat.trim(), amount: Number(amt) }),
    onSuccess: () => {
      setCat('');
      setAmt('');
      void qc.invalidateQueries({ queryKey: qk.expenses(branchId, today) });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('closing.expense.failed')),
  });

  const close = useMutation({
    mutationFn: () => api.post<ClosingResult>('/closings', { countedCash: Number(counted || 0) }),
    onSuccess: (r) => {
      setResult(r);
      void qc.invalidateQueries({ queryKey: ['home', branchId] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('closing.failed')),
  });

  // ── Closed ────────────────────────────────────────────────────────────────

  if (result) {
    const { difference } = result.cash;
    return (
      <Screen gap="base">
        <Stack.Screen options={{ headerShown: true, title: t('closing.done.title') }} />

        <View style={styles.doneHead}>
          <Check size={32} />
          <Text variant="title">{t('closing.done.headline', { date: result.date })}</Text>
        </View>

        <Section title={t('closing.digest')}>
          <Card>
            <DigestRow label={t('closing.revenue')} amount={result.digest.revenue} />
            <DigestRow label={t('closing.cogs')} amount={result.digest.costOfGoodsSold} />
            <DigestRow label={t('closing.grossProfit')} amount={result.digest.grossProfit} />
            <DigestRow label={t('closing.expenses')} amount={result.digest.expenses} />
            <Divider style={styles.divider} />
            <DigestRow label={t('closing.netProfit')} amount={result.digest.netProfit} bold />
          </Card>
        </Section>

        <Section title={t('closing.till')}>
          <Card>
            <DigestRow label={t('closing.expected')} amount={result.cash.expected} />
            <DigestRow label={t('closing.counted')} amount={result.cash.counted} />
            <Divider style={styles.divider} />
            <View style={styles.row}>
              <Text variant="bodyStrong">{t('closing.difference')}</Text>
              {/*
                Signed and sign-coloured: a shortage and a surplus are different
                problems, and the direction matters as much as the amount.
              */}
              <MoneyValue value={difference} tone="auto" signed />
            </View>
            {difference !== 0 ? (
              <Text variant="caption" tone="secondary" style={styles.hint}>
                {t(difference < 0 ? 'closing.short' : 'closing.over')}
              </Text>
            ) : null}
          </Card>
        </Section>

        <Section title={t('closing.comparison')}>
          <Card>
            <DigestRow label={t('closing.yesterday')} amount={result.comparison.yesterday.revenue} />
            <DigestRow
              label={t('closing.monthToDate')}
              amount={result.comparison.monthToDate.revenue}
            />
          </Card>
        </Section>
      </Screen>
    );
  }

  // ── Before closing ────────────────────────────────────────────────────────

  const expenseTotal = (expenses.data ?? []).reduce((s, e) => s + (e.amount ?? 0), 0);

  return (
    <Screen gap="lg">
      <Stack.Screen options={{ headerShown: true, title: t('closing.title') }} />

      <Section title={t('closing.expensesToday')}>
        <Card>
          {(expenses.data ?? []).length === 0 ? (
            <Text variant="body" tone="secondary">
              {t('closing.expenses.none')}
            </Text>
          ) : (
            expenses.data!.map((e) => (
              <View key={e.id} style={styles.row}>
                <Text variant="body">{e.category}</Text>
                <MoneyValue value={e.amount} size="small" />
              </View>
            ))
          )}
          {expenseTotal > 0 ? (
            <>
              <Divider style={styles.divider} />
              <DigestRow label={t('closing.total')} amount={expenseTotal} bold />
            </>
          ) : null}
        </Card>

        <View style={styles.expenseForm}>
          <View style={styles.grow}>
            <TextField
              label={t('closing.expense.category')}
              value={cat}
              onChangeText={setCat}
              placeholder={t('closing.expense.categoryPlaceholder')}
            />
          </View>
          <View style={styles.amount}>
            <MoneyField label={t('closing.expense.amount')} value={amt} onChangeText={setAmt} />
          </View>
          <Button
            title={t('action.add')}
            icon={Plus}
            onPress={() => {
              setError(null);
              addExpense.mutate();
            }}
            loading={addExpense.isPending}
            disabled={!cat.trim() || !amt || offline}
          />
        </View>
      </Section>

      {/*
        Refund money, kept beside the till figures because that is where
        somebody asks "why is the drawer short". Expected cash already subtracts
        confirmed cash refunds, so this card explains the number rather than
        adjusting it again.
      */}
      <RefundReconciliation />

      <Section title={t('closing.closeDay')}>
        <MoneyField
          label={t('closing.countedLabel')}
          hint={t('closing.countedHint')}
          value={counted}
          onChangeText={setCounted}
        />
        {error ? (
          <InlineNotice tone="danger" style={styles.hint}>
            {error}
          </InlineNotice>
        ) : null}
        {offline ? (
          <InlineNotice tone="danger" style={styles.hint}>
            {t('closing.offline')}
          </InlineNotice>
        ) : null}
        <Button
          title={t('closing.closeAction')}
          icon={Lock}
          size="lg"
          fullWidth
          style={styles.hint}
          onPress={() => {
            setError(null);
            close.mutate();
          }}
          loading={close.isPending}
          // A closing recorded against a dead connection is the worst possible
          // half-finished state: the day looks closed and the server never
          // heard about it.
          disabled={offline}
        />
      </Section>
    </Screen>
  );
}

/**
 * A labelled figure. Takes the number so `MoneyValue` can render a withheld
 * field (no `cost.view`) as an em dash rather than as zero — several of these
 * are cost-derived and are genuinely absent for some roles.
 */
function DigestRow({ label, amount, bold }: { label: string; amount?: number; bold?: boolean }) {
  return (
    <View style={styles.row}>
      <Text variant={bold ? 'bodyStrong' : 'body'} tone={bold ? 'primary' : 'secondary'}>
        {label}
      </Text>
      <MoneyValue value={amount} size={bold ? 'default' : 'small'} />
    </View>
  );
}

const styles = StyleSheet.create({
  doneHead: { alignItems: 'center', gap: space.sm, paddingVertical: space.base },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingVertical: space.xs,
  },
  divider: { marginVertical: space.xs },
  hint: { marginTop: space.sm },
  expenseForm: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, marginTop: space.sm },
  grow: { flex: 1 },
  amount: { width: 120 },
});
