import React, { useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Receipt, Lock, Plus, Check } from 'lucide-react-native';
import { Card, Field, Button, H2, Row } from '../components/ui';
import { api, ApiError } from '../lib/api-client';
import { qk } from '../lib/query-keys';
import { useBranch } from '../lib/branch';
import { colors, money } from '../lib/theme';
import { RefundReconciliation } from '../components/returns/RefundReconciliation';

interface Expense { id: string; category: string; amount?: number; spentOn: string }
interface ClosingResult {
  date: string;
  digest: { revenue: number; costOfGoodsSold?: number; grossProfit?: number; expenses?: number; netProfit?: number };
  cash: { expected: number; counted: number; difference: number };
  comparison: { today: { revenue: number; netProfit?: number }; yesterday: { revenue: number }; monthToDate: { revenue: number } };
}

const today = new Date().toISOString().slice(0, 10);

export default function ClosingScreen() {
  const qc = useQueryClient();
  const { branchId } = useBranch();
  const expenses = useQuery({ queryKey: qk.expenses(branchId, today), queryFn: () => api.get<Expense[]>(`/expenses?date=${today}`) });

  const [cat, setCat] = useState('');
  const [amt, setAmt] = useState('');
  const [counted, setCounted] = useState('');
  const [result, setResult] = useState<ClosingResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const addExpense = useMutation({
    mutationFn: () => api.post<Expense>('/expenses', { category: cat.trim(), amount: Number(amt) }),
    onSuccess: () => { setCat(''); setAmt(''); qc.invalidateQueries({ queryKey: qk.expenses(branchId, today) }); },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not add expense'),
  });

  const close = useMutation({
    mutationFn: () => api.post<ClosingResult>('/closings', { countedCash: Number(counted || 0) }),
    onSuccess: (r) => { setResult(r); qc.invalidateQueries({ queryKey: ['home', branchId] }); },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not close day'),
  });

  if (result) {
    const diffTone = result.cash.difference === 0 ? 'text-slate-900' : result.cash.difference < 0 ? 'text-red-600' : 'text-emerald-600';
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <Stack.Screen options={{ headerShown: true, title: 'Day closed' }} />
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
          <View className="items-center py-4">
            <View className="h-16 w-16 items-center justify-center rounded-full bg-emerald-100"><Check size={32} color={colors.emerald} /></View>
            <Text className="mt-3 text-xl font-bold text-slate-900">{result.date} closed</Text>
          </View>
          <Card className="gap-2">
            <DigestRow label="Revenue" value={money(result.digest.revenue)} />
            <DigestRow label="Cost of goods" value={money(result.digest.costOfGoodsSold)} />
            <DigestRow label="Gross profit" value={money(result.digest.grossProfit)} />
            <DigestRow label="Expenses" value={money(result.digest.expenses)} />
            <View className="my-1 h-px bg-slate-200" />
            <DigestRow label="Net profit" value={money(result.digest.netProfit)} bold />
          </Card>
          <Card className="gap-2">
            <DigestRow label="Expected cash" value={money(result.cash.expected)} />
            <DigestRow label="Counted cash" value={money(result.cash.counted)} />
            <View className="flex-row items-center justify-between">
              <Text className="text-slate-500">Difference</Text>
              <Text className={`font-bold ${diffTone}`}>{money(result.cash.difference)}</Text>
            </View>
          </Card>
          <Card className="gap-2">
            <Text className="text-xs font-semibold uppercase text-slate-400">Comparison</Text>
            <DigestRow label="Yesterday revenue" value={money(result.comparison.yesterday.revenue)} />
            <DigestRow label="Month-to-date revenue" value={money(result.comparison.monthToDate.revenue)} />
          </Card>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const expenseTotal = (expenses.data ?? []).reduce((s, e) => s + (e.amount ?? 0), 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ headerShown: true, title: 'Daily closing' }} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 20 }} keyboardShouldPersistTaps="handled">
        <View className="gap-2">
          <Row><Receipt size={18} color={colors.brand} /><H2>Expenses today</H2></Row>
          <Card className="gap-2">
            {(expenses.data ?? []).length === 0 ? <Text className="text-slate-400">No expenses yet</Text> : (
              expenses.data!.map((e) => (
                <View key={e.id} className="flex-row items-center justify-between py-1">
                  <Text className="text-slate-800">{e.category}</Text>
                  <Text className="font-medium text-slate-700">{money(e.amount)}</Text>
                </View>
              ))
            )}
            {expenseTotal > 0 ? (
              <><View className="my-1 h-px bg-slate-200" /><DigestRow label="Total" value={money(expenseTotal)} bold /></>
            ) : null}
          </Card>
        {/*
          Refund money, kept beside the till figures because that is where
          somebody asks "why is the drawer short". Expected cash already
          subtracts confirmed cash refunds, so this card explains the
          number rather than adjusting it again.
        */}
        <RefundReconciliation />
          <View className="flex-row items-end gap-2">
            <View className="flex-1"><Field label="Category" value={cat} onChangeText={setCat} placeholder="Rent, utilities…" /></View>
            <View className="w-28"><Field label="Amount" value={amt} onChangeText={(t) => setAmt(t.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0.00" /></View>
            <Button title="Add" icon={<Plus color="#fff" size={16} />} onPress={() => { setError(null); addExpense.mutate(); }} loading={addExpense.isPending} disabled={!cat.trim() || !amt} />
          </View>
        </View>

        <View className="gap-2">
          <Row><Lock size={18} color={colors.brand} /><H2>Close the day</H2></Row>
          <Field label="Counted cash in till" value={counted} onChangeText={(t) => setCounted(t.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0.00" />
          {error ? <Text className="text-sm text-red-600">{error}</Text> : null}
          <Button title="Close day" icon={<Lock color="#fff" size={18} />} onPress={() => { setError(null); close.mutate(); }} loading={close.isPending} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function DigestRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View className="flex-row items-center justify-between">
      <Text className={bold ? 'font-semibold text-slate-900' : 'text-slate-500'}>{label}</Text>
      <Text className={bold ? 'text-lg font-bold text-slate-900' : 'font-medium text-slate-700'}>{value}</Text>
    </View>
  );
}
