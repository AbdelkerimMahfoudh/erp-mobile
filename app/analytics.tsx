import React from 'react';
import { View, Text, ScrollView, RefreshControl } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, TrendingDown, Package, Users, GitBranch } from 'lucide-react-native';
import { Card, Badge, H2 } from '../components/ui';
import { api } from '../lib/api-client';
import { qk } from '../lib/query-keys';
import { useBranch } from '../lib/branch';
import { useTranslation } from '../lib/i18n';
import { money, num, trackingLabel } from '../lib/theme';
import { useColors } from '../lib/design/theme';

interface ProductRow { productId: string; label: string | null; trackingType: string | null; qtySold: number; revenue: number; grossProfit?: number; sold30d: number; lastSoldAt: string | null; }
interface Dashboard {
  bestSelling: ProductRow[];
  mostProfitable: ProductRow[];
  worstPerforming: ProductRow[];
  deadStock: { productId: string; label: string | null; inStock: number; inventoryValue?: number; lastSoldAt: string | null }[];
  branchComparison: { branchId: string; name: string | null; revenue: number; grossProfit?: number; netProfit?: number }[];
  employeePerformance: { userId: string; name: string | null; salesCount: number; revenue: number; margin?: number }[];
}

export default function AnalyticsScreen() {
  const colors = useColors();
  const { t } = useTranslation();
  const { branchId } = useBranch();
  const { data, isFetching, refetch } = useQuery({ queryKey: qk.dashboard(branchId), queryFn: () => api.get<Dashboard>('/dashboard') });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.canvas }}>
      <Stack.Screen options={{ headerShown: true, title: t('nav.analytics') }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 20 }} refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.brand[600]} />}>
        <Section icon={<TrendingUp size={18} color={colors.intent.success.fg} />} title={t('analytics.mostProfitable')}>
          {data?.mostProfitable.map((p) => <ProductLine key={p.productId} p={p} metric={money(p.grossProfit)} tone="green" />)}
        </Section>
        <Section icon={<Package size={18} color={colors.brand[600]} />} title={t('analytics.bestSelling')}>
          {data?.bestSelling.map((p) => <ProductLine key={p.productId} p={p} metric={t('analytics.sold', { n: num(p.qtySold) })} />)}
        </Section>
        <Section icon={<TrendingDown size={18} color={colors.intent.danger.fg} />} title={t('analytics.worstPerforming')}>
          {data?.worstPerforming.map((p) => <ProductLine key={p.productId} p={p} metric={money(p.grossProfit)} tone={((p.grossProfit ?? 0) < 0) ? 'red' : 'slate'} />)}
        </Section>
        <Section icon={<Package size={18} color={colors.intent.warning.fg} />} title={t('analytics.deadStock')}>
          {(data?.deadStock ?? []).length === 0 ? <Muted>{t('analytics.deadStock.none')}</Muted> : data?.deadStock.map((d) => (
            <View key={d.productId} className="flex-row items-center justify-between py-2">
              <Text className="flex-1" style={{ color: colors.text.primary }}>{d.label}</Text>
              <Text style={{ color: colors.text.secondary }}>{t('analytics.inStock', { n: num(d.inStock) })} · {money(d.inventoryValue)}</Text>
            </View>
          ))}
        </Section>
        <Section icon={<GitBranch size={18} color={colors.brand[600]} />} title={t('analytics.branches')}>
          {data?.branchComparison.map((b) => (
            <View key={b.branchId} className="flex-row items-center justify-between py-2">
              <Text className="flex-1 font-medium" style={{ color: colors.text.primary }}>{b.name}</Text>
              {/* Spelled out rather than "Rev"/"Net" — abbreviations do not
                  translate, and this screen is read by owners, not analysts. */}
              <Text style={{ color: colors.text.secondary }}>
                {t('analytics.revenue')} {money(b.revenue)} · {t('analytics.net')} {money(b.netProfit)}
              </Text>
            </View>
          ))}
        </Section>
        <Section icon={<Users size={18} color={colors.brand[600]} />} title={t('analytics.employees')}>
          {data?.employeePerformance.map((e) => (
            <View key={e.userId} className="flex-row items-center justify-between py-2">
              <Text className="flex-1 font-medium" style={{ color: colors.text.primary }}>{e.name}</Text>
              <Text style={{ color: colors.text.secondary }}>
                {t('analytics.sales', { n: num(e.salesCount) })} · {money(e.revenue)}
              </Text>
            </View>
          ))}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <View className="gap-2">
      <View className="flex-row items-center gap-2">{icon}<H2>{title}</H2></View>
      <Card>{children}</Card>
    </View>
  );
}
function Muted({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  return <Text className="py-2" style={{ color: colors.text.tertiary }}>{children}</Text>;
}
function ProductLine({ p, metric, tone = 'slate' }: { p: ProductRow; metric: string; tone?: 'slate' | 'green' | 'red' }) {
  const colors = useColors();
  const t: Record<string, string> = { slate: 'text-slate-700', green: 'text-emerald-600', red: 'text-red-600' };
  return (
    <View className="flex-row items-center justify-between py-2">
      <View className="flex-1 pr-2">
        <Text className="font-medium" style={{ color: colors.text.primary }} numberOfLines={1}>{p.label ?? '—'}</Text>
        {p.trackingType ? <Badge label={trackingLabel[p.trackingType]} tone="brand" /> : null}
      </View>
      <Text className={`font-semibold ${t[tone]}`}>{metric}</Text>
    </View>
  );
}
