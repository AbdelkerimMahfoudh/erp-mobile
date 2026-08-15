import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { LogOut, User, Store, ChevronRight, Tag, BarChart3, ClipboardCheck, SlidersHorizontal, Users, Smartphone, Bell, ArrowLeftRight, ReceiptText, Undo2 } from 'lucide-react-native';
import { Screen, H1, Card, Row } from '../../components/ui';
import { Can } from '../../components/access';
import { useAuth } from '../../hooks/useAuth';
import { useBranch } from '../../lib/branch';
import { useTransferCounts } from '../../lib/transfers';
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
      <Can anyOf={['sale.view', 'return.view', 'unit.add', 'report.view', 'closing.perform', 'settings.manage', 'user.manage']}>
        <Text className="mb-1 mt-6 text-xs font-semibold uppercase text-slate-400">Manage</Text>
        <View className="mt-2 gap-3">
          {/* Browsing the catalog is open to every store role — Sell and Receive
              both depend on finding products. The create/edit/archive controls
              inside are gated on `catalog.manage`, and the server enforces that
              regardless of what this menu shows. */}
          {/* Sale history (I1). Gated on `sale.view`, which every store role
              holds — seeing what the branch sold is ordinary counter work, and
              is deliberately NOT `report.view`. Cost and profit inside are
              gated separately by the server. */}
          <Can perm="sale.view">
            <MenuRow icon={<ReceiptText size={20} color={colors.brand} />} label="Sales" onPress={() => router.push('/sales' as Href)} />
          </Can>
          {/* Returns (I2). Gated on `return.view`, which every store role holds —
              seeing what came back is ordinary counter work. The ACTIONS inside
              are gated separately, so a reachable route never implies an
              available decision. */}
          <Can perm="return.view">
            <MenuRow icon={<Undo2 size={20} color={colors.brand} />} label="Returns" onPress={() => router.push('/returns' as Href)} />
          </Can>
          <MenuRow icon={<Tag size={20} color={colors.brand} />} label="Catalog" onPress={() => router.push('/catalog' as Href)} />
          {/* Transfers (H1.3). Gated on `transfer.view` — NOT on `unit.transfer`,
              which H1.2 retired and revoked from every store role. */}
          <Can perm="transfer.view">
            <TransfersRow />
          </Can>
          {/* Owner-only team management. The screen refuses non-Owners on its
              own too, for the deep-link case where this menu never rendered. */}
          <Can perm="user.manage">
            <MenuRow icon={<Users size={20} color={colors.brand} />} label="Team" onPress={() => router.push('/team' as Href)} />
          </Can>
          <Can perm="report.view">
            <MenuRow icon={<BarChart3 size={20} color={colors.brand} />} label="Analytics" onPress={() => router.push('/analytics')} />
          </Can>
          <Can perm="closing.perform">
            <MenuRow icon={<ClipboardCheck size={20} color={colors.brand} />} label="Daily closing" onPress={() => router.push('/closing')} />
          </Can>
          {/* Owner-only. The screen refuses non-Owners on its own too, for the
              deep-link case where this menu was never rendered. */}
          <Can perm="settings.manage">
            <MenuRow icon={<SlidersHorizontal size={20} color={colors.brand} />} label="Business settings" onPress={() => router.push('/settings' as Href)} />
          </Can>
        </View>
      </Can>

      <Text className="mb-1 mt-6 text-xs font-semibold uppercase text-slate-400">Account</Text>
      <View className="mt-2 gap-3">
        {/* Every signed-in user can see and cut off their own devices — this is
            personal account security, not an Owner power. */}
        {/* Every signed-in user has notifications of their own — an Owner is
            told about price changes, a branch about incoming transfers. */}
        <MenuRow icon={<Bell size={20} color={colors.brand} />} label="Notifications" onPress={() => router.push('/notifications' as Href)} />
        <MenuRow icon={<Smartphone size={20} color={colors.brand} />} label="Devices" onPress={() => router.push('/devices' as Href)} />
        {/* One row, not two. "Branch" and "Switch branch" were adjacent rows
            calling the same handler, which only made people wonder what the
            difference was. The current branch is the label's value; tapping it
            changes it. */}
        <MenuRow icon={<Store size={20} color={colors.brand} />} label="Branch" value={branchName ?? undefined} onPress={changeBranch} />
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

/**
 * Transfers, with how much work is waiting.
 *
 * The counts come from one bounded server-side query. Draining the list to
 * tally it would make this screen slower every month the shop stays open — and
 * the numbers are the reason to tap, so they have to be cheap.
 */
function TransfersRow() {
  const router = useRouter();
  const counts = useTransferCounts(true);
  const c = counts.data;

  const waiting = c
    ? [
        c.pendingApproval > 0 ? `${c.pendingApproval} waiting` : null,
        c.approved > 0 ? `${c.approved} to send` : null,
        c.inTransit > 0 ? `${c.inTransit} on the way` : null,
      ].filter(Boolean).join(' · ')
    : undefined;

  return (
    <MenuRow
      icon={<ArrowLeftRight size={20} color={colors.brand} />}
      label="Transfers"
      value={waiting || undefined}
      onPress={() => router.push('/transfers' as Href)}
    />
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
