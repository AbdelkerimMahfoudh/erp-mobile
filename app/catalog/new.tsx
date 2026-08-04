import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Field, Button } from '../../components/ui';
import { api, ApiError } from '../../lib/api-client';
import { qk } from '../../lib/query-keys';
import { colors, trackingLabel } from '../../lib/theme';
import type { Category, TrackingType, AttributeDef, Product } from '../../types/api';

const TRACKING: TrackingType[] = ['imei', 'serial', 'quantity'];

export default function NewProductScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: categories } = useQuery({ queryKey: qk.categories, queryFn: () => api.get<Category[]>('/categories') });

  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [variant, setVariant] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [trackingType, setTrackingType] = useState<TrackingType>('imei');
  const [barcode, setBarcode] = useState('');
  const [cost, setCost] = useState('');
  const [price, setPrice] = useState('');
  const [specs, setSpecs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const category = categories?.find((c) => c.id === categoryId);
  const schema: AttributeDef[] = (category?.attributeSchema as AttributeDef[]) ?? [];

  const pickCategory = (c: Category) => {
    setCategoryId(c.id);
    setTrackingType(c.defaultTrackingType);
    setSpecs({});
  };

  const create = useMutation({
    mutationFn: () => {
      const specifications: Record<string, unknown> = {};
      for (const def of schema) {
        const v = specs[def.key];
        if (v == null || v === '') continue;
        specifications[def.key] = def.type === 'number' || def.type === 'measurement' ? Number(v) : v;
      }
      return api.post<Product>('/products', {
        brand: brand.trim(),
        model: model.trim(),
        variant: variant.trim() || undefined,
        categoryId: categoryId ?? undefined,
        trackingType,
        barcode: barcode.trim() || undefined,
        defaultCost: cost ? Number(cost) : undefined,
        defaultPrice: price ? Number(price) : undefined,
        specifications: Object.keys(specifications).length ? specifications : undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      router.back();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not create product'),
  });

  const valid = brand.trim() && model.trim();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ headerShown: true, title: 'New product' }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 16 }} keyboardShouldPersistTaps="handled">
        <Field label="Brand *" value={brand} onChangeText={setBrand} placeholder="Apple" />
        <Field label="Model *" value={model} onChangeText={setModel} placeholder="iPhone 15" />
        <Field label="Variant" value={variant} onChangeText={setVariant} placeholder="128GB Black (optional)" />

        <View className="gap-2">
          <Text className="text-sm font-medium text-slate-700">Category</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View className="flex-row gap-2">
              {categories?.map((c) => (
                <Pressable key={c.id} onPress={() => pickCategory(c)} className={`rounded-full px-4 py-2 ${categoryId === c.id ? 'bg-brand-600' : 'bg-slate-100'}`}>
                  <Text className={`text-sm font-semibold ${categoryId === c.id ? 'text-white' : 'text-slate-600'}`}>{c.name}</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </View>

        <View className="gap-2">
          <Text className="text-sm font-medium text-slate-700">Tracking type</Text>
          <View className="flex-row gap-2">
            {TRACKING.map((t) => (
              <Pressable key={t} onPress={() => setTrackingType(t)} className={`flex-1 items-center rounded-xl py-3 ${trackingType === t ? 'bg-brand-600' : 'bg-slate-100'}`}>
                <Text className={`text-sm font-semibold ${trackingType === t ? 'text-white' : 'text-slate-600'}`}>{trackingLabel[t]}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {trackingType === 'quantity' ? (
          <Field label="Barcode" value={barcode} onChangeText={setBarcode} placeholder="Scan or type barcode" autoCapitalize="none" />
        ) : null}

        <View className="flex-row gap-3">
          <View className="flex-1"><Field label="Cost" value={cost} onChangeText={(t) => setCost(t.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0.00" /></View>
          <View className="flex-1"><Field label="Price" value={price} onChangeText={(t) => setPrice(t.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0.00" /></View>
        </View>

        {schema.length > 0 ? (
          <View className="gap-3">
            <Text className="text-xs font-semibold uppercase text-slate-400">{category?.name} specs</Text>
            {schema.map((def) =>
              def.type === 'enum' ? (
                <View key={def.key} className="gap-2">
                  <Text className="text-sm font-medium text-slate-700">{def.label}{def.required ? ' *' : ''}</Text>
                  <View className="flex-row flex-wrap gap-2">
                    {(def.options ?? []).map((opt) => (
                      <Pressable key={opt} onPress={() => setSpecs((s) => ({ ...s, [def.key]: opt }))} className={`rounded-full px-3 py-2 ${specs[def.key] === opt ? 'bg-brand-600' : 'bg-slate-100'}`}>
                        <Text className={`text-sm ${specs[def.key] === opt ? 'text-white' : 'text-slate-600'}`}>{opt}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : (
                <Field
                  key={def.key}
                  label={`${def.label}${def.unit ? ` (${def.unit})` : ''}${def.required ? ' *' : ''}`}
                  value={specs[def.key] ?? ''}
                  onChangeText={(t) => setSpecs((s) => ({ ...s, [def.key]: t }))}
                  keyboardType={def.type === 'number' || def.type === 'measurement' ? 'decimal-pad' : 'default'}
                />
              ),
            )}
          </View>
        ) : null}

        {error ? <Text className="text-sm text-red-600">{error}</Text> : null}
        <Button title="Create product" onPress={() => { setError(null); create.mutate(); }} loading={create.isPending} disabled={!valid} />
      </ScrollView>
    </SafeAreaView>
  );
}
