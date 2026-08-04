import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, RefreshControl } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Search, Plus, Tag } from 'lucide-react-native';
import { Badge, EmptyState } from '../../components/ui';
import { api } from '../../lib/api-client';
import { qk } from '../../lib/query-keys';
import { colors, money, trackingLabel } from '../../lib/theme';
import type { Product } from '../../types/api';

export default function CatalogScreen() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const all = useQuery({ queryKey: qk.products(), queryFn: () => api.get<Product[]>('/products') });
  const search = useQuery({
    queryKey: qk.products(q),
    queryFn: () => api.get<Product[]>(`/products/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length > 0,
  });
  const list = q.trim() ? search.data ?? [] : all.data ?? [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ headerShown: true, title: 'Catalog' }} />
      <View className="border-b border-slate-200 bg-white px-4 py-3">
        <View className="flex-row items-center gap-2 rounded-xl border border-slate-300 px-3">
          <Search size={18} color={colors.brand} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search products" placeholderTextColor={colors.muted} className="flex-1 py-3 text-base text-slate-900" autoCapitalize="none" />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 90 }}
        refreshControl={<RefreshControl refreshing={all.isFetching} onRefresh={() => all.refetch()} tintColor={colors.brand} />}
      >
        {list.length === 0 ? (
          <EmptyState title="No products" body="Tap + to create your first product" />
        ) : (
          <View className="gap-2">
            {list.map((p) => (
              <View key={p.id} className="flex-row items-center justify-between rounded-2xl border border-slate-200 bg-white p-3">
                <View className="h-10 w-10 items-center justify-center rounded-xl bg-brand-100">
                  <Tag size={18} color={colors.brand} />
                </View>
                <View className="ml-3 flex-1">
                  <Text className="font-semibold text-slate-900">{p.brand} {p.model}{p.variant ? ` ${p.variant}` : ''}</Text>
                  <View className="mt-1 flex-row items-center gap-2">
                    <Badge label={trackingLabel[p.trackingType]} tone="brand" />
                    {p.barcode ? <Text className="text-xs text-slate-400">{p.barcode}</Text> : null}
                  </View>
                </View>
                <Text className="font-semibold text-slate-700">{money(p.defaultPrice)}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <Pressable
        onPress={() => router.push('/catalog/new')}
        className="absolute bottom-6 right-6 h-14 w-14 items-center justify-center rounded-full bg-brand-600 shadow-lg active:opacity-80"
      >
        <Plus color="#fff" size={28} />
      </Pressable>
    </SafeAreaView>
  );
}
