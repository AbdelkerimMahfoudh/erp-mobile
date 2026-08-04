import React from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Store, Warehouse, ChevronRight, LogOut } from 'lucide-react-native';
import { Screen, H1, Muted, Card } from '../components/ui';
import { api } from '../lib/api-client';
import { qk } from '../lib/query-keys';
import { useBranch } from '../lib/branch';
import { useAuth } from '../hooks/useAuth';
import { colors } from '../lib/theme';
import type { UserBranch } from '../types/api';

export default function SelectBranch() {
  const { setBranch } = useBranch();
  const { signOut, user } = useAuth();
  const { data, isLoading, error } = useQuery({ queryKey: qk.branches, queryFn: () => api.get<UserBranch[]>('/auth/branches') });

  return (
    <Screen>
      <View className="mb-6 flex-row items-center justify-between">
        <View>
          <H1>Choose a branch</H1>
          <Muted>Signed in as {user?.name}</Muted>
        </View>
        <Pressable onPress={signOut} className="flex-row items-center gap-1 rounded-lg bg-slate-100 px-3 py-2">
          <LogOut size={16} color={colors.sub} />
          <Text className="text-sm text-slate-600">Sign out</Text>
        </Pressable>
      </View>

      {isLoading ? (
        <ActivityIndicator color={colors.brand} />
      ) : error ? (
        <Text className="text-red-600">Could not load branches.</Text>
      ) : (
        <View className="gap-3">
          {data?.map((b) => (
            <Pressable key={b.id} onPress={() => setBranch(b)}>
              <Card className="flex-row items-center gap-3">
                <View className="h-11 w-11 items-center justify-center rounded-xl bg-brand-100">
                  {b.type === 'warehouse' ? <Warehouse size={22} color={colors.brand} /> : <Store size={22} color={colors.brand} />}
                </View>
                <View className="flex-1">
                  <Text className="text-base font-semibold text-slate-900">{b.name}</Text>
                  <Text className="text-xs capitalize text-slate-500">{b.type} · {b.role.replace('_', ' ')}</Text>
                </View>
                <ChevronRight size={20} color={colors.muted} />
              </Card>
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}
