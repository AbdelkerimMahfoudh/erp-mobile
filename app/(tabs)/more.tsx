import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Repeat, LogOut, User, Store, ChevronRight, Tag, BarChart3, ClipboardCheck } from 'lucide-react-native';
import { Screen, H1, Card, Row } from '../../components/ui';
import { Can } from '../../components/access';
import { useAuth } from '../../hooks/useAuth';
import { useBranch } from '../../lib/branch';
import { colors } from '../../lib/theme';

export default function MoreScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { branchName, role, clear } = useBranch();

  const changeBranch = () => {
    clear();
    router.replace('/select-branch');
  };

  return (
    <Screen>
      <H1>More</H1>

      <Card className="mt-4 flex-row items-center gap-3">
        <View className="h-12 w-12 items-center justify-center rounded-full bg-brand-100">
          <User size={24} color={colors.brand} />
        </View>
        <View>
          <Text className="text-base font-semibold text-slate-900">{user?.name}</Text>
          <Text className="text-sm capitalize text-slate-500">{role?.replace('_', ' ')}</Text>
        </View>
      </Card>

      {/* Each row is gated by the permission its destination actually requires,
          so nothing here leads to a 403. The heading hides with its contents. */}
      <Can anyOf={['unit.add', 'report.view', 'closing.perform']}>
        <Text className="mb-1 mt-6 text-xs font-semibold uppercase text-slate-400">Manage</Text>
        <View className="mt-2 gap-3">
          <Can perm="unit.add">
            <MenuRow icon={<Tag size={20} color={colors.brand} />} label="Catalog" onPress={() => router.push('/catalog' as Href)} />
          </Can>
          <Can perm="report.view">
            <MenuRow icon={<BarChart3 size={20} color={colors.brand} />} label="Analytics" onPress={() => router.push('/analytics')} />
          </Can>
          <Can perm="closing.perform">
            <MenuRow icon={<ClipboardCheck size={20} color={colors.brand} />} label="Daily closing" onPress={() => router.push('/closing')} />
          </Can>
        </View>
      </Can>

      <Text className="mb-1 mt-6 text-xs font-semibold uppercase text-slate-400">Account</Text>
      <View className="mt-2 gap-3">
        <MenuRow icon={<Store size={20} color={colors.brand} />} label="Branch" value={branchName ?? undefined} onPress={changeBranch} />
        <MenuRow icon={<Repeat size={20} color={colors.brand} />} label="Switch branch" onPress={changeBranch} />
        <Pressable onPress={signOut}>
          <Card className="flex-row items-center justify-between">
            <Row>
              <LogOut size={20} color={colors.red} />
              <Text className="font-medium text-red-600">Sign out</Text>
            </Row>
          </Card>
        </Pressable>
      </View>
    </Screen>
  );
}

function MenuRow({ icon, label, value, onPress }: { icon: React.ReactNode; label: string; value?: string; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <Card className="flex-row items-center justify-between">
        <Row>
          {icon}
          <Text className="font-medium text-slate-700">{label}</Text>
        </Row>
        <Row>
          {value ? <Text className="text-slate-500">{value}</Text> : null}
          <ChevronRight size={18} color={colors.muted} />
        </Row>
      </Card>
    </Pressable>
  );
}
