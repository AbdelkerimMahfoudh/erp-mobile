import React from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Clock } from 'lucide-react-native';
import { Card, Badge, Row } from '../../components/ui';
import { api } from '../../lib/api-client';
import { colors, money, trackingLabel } from '../../lib/theme';

interface TimelineEvent {
  at: string;
  entity: string;
  action: string;
  reason: string | null;
  after?: Record<string, unknown> | null;
}
interface UnitDetail {
  id: string;
  imeiPrimary: string | null;
  serialNo: string | null;
  status: string;
  cost?: number;
  dateIn?: string;
  product?: { brand: string; model: string; variant: string | null; trackingType?: string };
  branch?: { name: string };
  timeline: TimelineEvent[];
}

const statusTone: Record<string, 'green' | 'slate' | 'red' | 'amber' | 'brand'> = {
  in_stock: 'green', sold: 'slate', faulty: 'red', returned: 'amber', in_transit: 'brand',
};

export default function UnitDetailScreen() {
  const { identifier } = useLocalSearchParams<{ identifier: string }>();
  const { data, isLoading } = useQuery({
    queryKey: ['unit', identifier],
    queryFn: () => api.get<UnitDetail>(`/units/${encodeURIComponent(identifier)}`),
    enabled: !!identifier,
  });

  const idValue = data ? data.imeiPrimary ?? data.serialNo ?? '' : identifier;
  const tracking = data?.product?.trackingType ?? (data?.imeiPrimary ? 'imei' : 'serial');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ headerShown: true, title: 'Unit' }} />
      {isLoading ? (
        <View className="flex-1 items-center justify-center"><ActivityIndicator color={colors.brand} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <Card>
            <Text className="text-xl font-bold text-slate-900">
              {data?.product ? `${data.product.brand} ${data.product.model}` : idValue}
            </Text>
            <Row className="mt-2">
              <Badge label={trackingLabel[tracking] ?? tracking} tone="brand" />
              <Badge label={(data?.status ?? '').replace('_', ' ')} tone={statusTone[data?.status ?? ''] ?? 'slate'} />
            </Row>
            <View className="mt-4 gap-2">
              <DetailRow label="Identifier" value={idValue} />
              {data?.branch ? <DetailRow label="Branch" value={data.branch.name} /> : null}
              {data?.cost !== undefined ? <DetailRow label="Cost" value={money(data.cost)} /> : null}
            </View>
          </Card>

          <Text className="mb-2 mt-6 text-xs font-semibold uppercase text-slate-400">History</Text>
          <View className="gap-3">
            {(data?.timeline ?? []).map((e, i) => (
              <View key={i} className="flex-row gap-3">
                <View className="items-center">
                  <View className="h-8 w-8 items-center justify-center rounded-full bg-brand-100">
                    <Clock size={16} color={colors.brand} />
                  </View>
                  {i < (data?.timeline.length ?? 0) - 1 ? <View className="w-0.5 flex-1 bg-slate-200" /> : null}
                </View>
                <Card className="mb-1 flex-1">
                  <Text className="font-semibold capitalize text-slate-900">{e.action.replace('_', ' ')} · {e.entity}</Text>
                  {e.reason ? <Text className="text-sm text-slate-500">{e.reason}</Text> : null}
                  <Text className="mt-1 text-xs text-slate-400">{new Date(e.at).toLocaleString()}</Text>
                </Card>
              </View>
            ))}
            {(data?.timeline?.length ?? 0) === 0 ? <Text className="text-slate-400">No history yet.</Text> : null}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between">
      <Text className="text-slate-500">{label}</Text>
      <Text className="font-medium text-slate-900">{value}</Text>
    </View>
  );
}
