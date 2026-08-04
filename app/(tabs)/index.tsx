import React from 'react';
import { View, Text, RefreshControl, ScrollView, Pressable } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ScanLine, PackagePlus, TriangleAlert, Activity } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, StatTile, H2, Muted, Row } from '../../components/ui';
import { api } from '../../lib/api-client';
import { qk } from '../../lib/query-keys';
import { useBranch } from '../../lib/branch';
import { usePermission } from '../../lib/permissions';
import { colors, money, num } from '../../lib/theme';
import type { DashboardHome, HealthScore } from '../../types/api';

const statusTone: Record<string, string> = { green: 'text-emerald-600', amber: 'text-amber-600', red: 'text-red-600' };

export default function HomeScreen() {
  const router = useRouter();
  const { branchId, branchName } = useBranch();
  const canViewReports = usePermission('report.view');
  const canSell = usePermission('sale.create');

  /**
   * Home is the default route, but `/home` and `/health-score` both require
   * `report.view` — which sales and warehouse employees do not have. Without
   * this, the two least technical roles would open the app onto a 403.
   *
   * Each role lands on the screen its job actually starts from.
   */
  const home = useQuery({
    queryKey: qk.home(branchId),
    queryFn: () => api.get<DashboardHome>('/home'),
    enabled: canViewReports,
  });
  const health = useQuery({
    queryKey: qk.health(branchId),
    queryFn: () => api.get<HealthScore>('/health-score'),
    enabled: canViewReports,
  });

  if (!canViewReports) {
    return <Redirect href={canSell ? '/(tabs)/sell' : '/(tabs)/inventory'} />;
  }

  const refreshing = home.isFetching || health.isFetching;
  const onRefresh = () => {
    home.refetch();
    health.refetch();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
      >
        <Text className="text-sm text-slate-500">{branchName}</Text>
        <Text className="text-2xl font-bold text-slate-900">Today</Text>

        <Row className="mt-4">
          <StatTile label="Revenue" value={money(home.data?.today.revenue)} tone="accent" />
          <StatTile label="Profit" value={money(home.data?.today.grossProfit)} tone="success" />
        </Row>
        <Row className="mt-3">
          <StatTile label="Sales" value={num(home.data?.today.salesCount)} />
          <StatTile label="Items sold" value={num(home.data?.today.qtySold)} />
        </Row>

        <View className="mt-6">
          <H2>Quick actions</H2>
          <Row className="mt-3">
            <QuickAction icon={<ScanLine color="#fff" size={22} />} label="Sell" onPress={() => router.push('/(tabs)/sell')} />
            <QuickAction icon={<PackagePlus color="#fff" size={22} />} label="Receive" onPress={() => router.push('/receive')} />
          </Row>
        </View>

        <View className="mt-6 gap-3">
          <H2>Overview</H2>
          <Card>
            <Row className="justify-between">
              <Row>
                <Activity size={18} color={colors.brand} />
                <Text className="font-medium text-slate-700">Store health</Text>
              </Row>
              <Text className={`text-lg font-bold ${statusTone[health.data?.status ?? 'amber']}`}>
                {health.data ? `${health.data.score} · ${health.data.status.toUpperCase()}` : '—'}
              </Text>
            </Row>
          </Card>

          <Row>
            <MetricCard label="Inventory value" value={money(home.data?.inventory.inventoryValue)} />
            <MetricCard label="Expected profit" value={money(home.data?.inventory.expectedProfit)} />
          </Row>

          <Pressable onPress={() => router.push('/(tabs)/inventory')}>
            <Card className="flex-row items-center justify-between">
              <Row>
                <TriangleAlert size={18} color={colors.amber} />
                <Text className="font-medium text-slate-700">Low stock</Text>
              </Row>
              <Text className="text-lg font-bold text-amber-600">{num(home.data?.lowStockCount)}</Text>
            </Card>
          </Pressable>
        </View>

        <Muted className="mt-6 text-center text-xs">Month profit: {money(home.data?.month.grossProfit)}</Muted>
      </ScrollView>
    </SafeAreaView>
  );
}

function QuickAction({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="flex-1 items-center gap-2 rounded-2xl bg-brand-600 py-5 active:opacity-80">
      {icon}
      <Text className="font-semibold text-white">{label}</Text>
    </Pressable>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="flex-1">
      <Text className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</Text>
      <Text className="mt-1 text-lg font-bold text-slate-900">{value}</Text>
    </Card>
  );
}
