import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { LogOut, User, Store, ChevronRight, Tag, BarChart3, ClipboardCheck, SlidersHorizontal, Users, Smartphone, Bell, ArrowLeftRight, Building2, BadgeCheck, Check, CloudOff, FileSpreadsheet, HandCoins, Handshake, Languages, ReceiptText, Target, Truck, Undo2, Wallet } from 'lucide-react-native';
import { Screen, H1, Card, Row } from '../../components/ui';
import { Can } from '../../components/access';
import { useAuth } from '../../hooks/useAuth';
import { useBranch } from '../../lib/branch';
import { useTransferCounts } from '../../lib/transfers';
import { LANGUAGES, LANGUAGE_LABELS, useI18n, useTranslation, type Language } from '../../lib/i18n';
import { colors } from '../../lib/theme';

export default function MoreScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { branchName, role, clear } = useBranch();

  const changeBranch = () => {
    clear();
    router.replace('/select-branch');
  };

  return (
    <Screen>
      <H1>{t('tab.more')}</H1>

      <Card className="mt-4 flex-row items-center gap-3">
        <View className="h-12 w-12 items-center justify-center rounded-full bg-brand-100">
          <User size={24} color={colors.brand} />
        </View>
        <View>
          <Text className="text-base font-semibold text-slate-900">{user?.name}</Text>
          {/* The role in the reader's language, not a raw enum with its
              underscore swapped for a space. */}
          <Text className="text-sm text-slate-500">
            {role ? t(`team.role.${role}` as never) : ''}
          </Text>
        </View>
      </Card>

      {/* Each row is gated by the permission its destination actually requires,
          so nothing here leads to a 403. The heading hides with its contents. */}
      <Can anyOf={['sale.view', 'return.view', 'unit.add', 'report.view', 'closing.count', 'closing.perform', 'import.run', 'consignment.view', 'connection.manage', 'loan.view', 'settings.manage', 'user.manage']}>
        <Text className="mb-1 mt-6 text-xs font-semibold uppercase text-slate-400">{t('more.manage')}</Text>
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
            <MenuRow icon={<ReceiptText size={20} color={colors.brand} />} label={t('nav.sales')} onPress={() => router.push('/sales' as Href)} />
          </Can>
          {/* Returns (I2). Gated on `return.view`, which every store role holds —
              seeing what came back is ordinary counter work. The ACTIONS inside
              are gated separately, so a reachable route never implies an
              available decision. */}
          <Can perm="return.view">
            <MenuRow icon={<Undo2 size={20} color={colors.brand} />} label={t('nav.returns')} onPress={() => router.push('/returns' as Href)} />
          </Can>
          <MenuRow icon={<Tag size={20} color={colors.brand} />} label={t('nav.catalog')} onPress={() => router.push('/catalog' as Href)} />
          {/* Transfers (H1.3). Gated on `transfer.view` — NOT on `unit.transfer`,
              which H1.2 retired and revoked from every store role. */}
          <Can perm="transfer.view">
            <TransfersRow />
          </Can>
          {/* Suppliers (J1). Shown to anyone who can manage one or report a
              payment against one — gating on `supplier.manage` alone would hide
              payables from the very employee who reports the payment. Until the
              UX pilot this feature had no navigation entry at all. */}
          <Can anyOf={['supplier.manage', 'supplier.payment.report']}>
            <MenuRow icon={<Truck size={20} color={colors.brand} />} label={t('nav.suppliers')} onPress={() => router.push('/suppliers' as Href)} />
          </Can>
          {/* Owner-only team management. The screen refuses non-Owners on its
              own too, for the deep-link case where this menu never rendered. */}
          <Can perm="user.manage">
            <MenuRow icon={<Users size={20} color={colors.brand} />} label={t('nav.team')} onPress={() => router.push('/team' as Href)} />
          </Can>
          <Can perm="report.view">
            {/* Where the money is (Milestone L). Leads with profit, then cash,
                then what is owed — the order a shopkeeper actually asks. */}
            <MenuRow icon={<BarChart3 size={20} color={colors.brand} />} label={t('nav.money')} onPress={() => router.push('/money' as Href)} />
            <MenuRow icon={<BarChart3 size={20} color={colors.brand} />} label={t('nav.analytics')} onPress={() => router.push('/analytics')} />
          </Can>
          {/* Expenses (Milestone D). Gated on submit, which all three store
              roles hold — the person who spent the money reports it, and the
              list scopes them to their own. */}
          <Can perm="expense.submit">
            <MenuRow icon={<Wallet size={20} color={colors.brand} />} label={t('nav.expenses')} onPress={() => router.push('/expenses' as Href)} />
          </Can>
          {/* Gated on `closing.count`, not `closing.perform` (Milestone E).
              The Employee holding the drawer is the one who has to reach this
              screen; signing the day off is a separate act the screen itself
              gates. Leaving it on `closing.perform` would have hidden the
              screen from exactly the people the milestone existed to enable. */}
          <Can perm="closing.count">
            <MenuRow icon={<ClipboardCheck size={20} color={colors.brand} />} label={t('nav.closing')} onPress={() => router.push('/closing')} />
          </Can>
          {/* Goals (Milestone F). Deliberately ungated: an employee with a
              personal target must be able to see it, and the list scopes
              somebody without `goal.manage` to their own. */}
          <MenuRow icon={<Target size={20} color={colors.brand} />} label={t('nav.goals')} onPress={() => router.push('/goals' as Href)} />
          {/* Inter-store consignment (Milestone H). Two entries, because finding
              a partner and running the stock are different jobs held by
              different people: discovery is Owner-only company trust, while
              seeing consignments is operational. */}
          <Can perm="connection.manage">
            <MenuRow icon={<Building2 size={20} color={colors.brand} />} label={t('nav.stores')} onPress={() => router.push('/stores' as Href)} />
          </Can>
          <Can perm="consignment.view">
            <MenuRow icon={<Handshake size={20} color={colors.brand} />} label={t('nav.consignments')} onPress={() => router.push('/consignments' as Href)} />
          </Can>
          {/* Money loans (Milestone I). Its own entry and its own permission:
              lending money is a different decision from lending stock, and a
              shop may well want somebody who can do one but not the other. */}
          <Can perm="loan.view">
            <MenuRow icon={<HandCoins size={20} color={colors.brand} />} label={t('nav.loans')} onPress={() => router.push('/loans' as Href)} />
          </Can>
          {/* What this phone is still holding (Milestone J). Deliberately
              ungated: anybody who can create work offline must be able to see
              whether it reached the server. */}
          <MenuRow icon={<CloudOff size={20} color={colors.brand} />} label={t('nav.sync')} onPress={() => router.push('/sync' as Href)} />
          {/* Subscription (Milestone K). Ungated: every role needs to know
              whether the shop can still write, and a warning only the Owner
              sees is one the person at the counter discovers by being refused. */}
          <MenuRow icon={<BadgeCheck size={20} color={colors.brand} />} label={t('nav.subscription')} onPress={() => router.push('/subscription' as Href)} />
          {/* Bringing a stock list in (Milestone G). Gated on the permission
              that, until this milestone, guarded nothing at all. */}
          <Can perm="import.run">
            <MenuRow icon={<FileSpreadsheet size={20} color={colors.brand} />} label={t('nav.imports')} onPress={() => router.push('/imports' as Href)} />
          </Can>
          {/* Owner-only. The screen refuses non-Owners on its own too, for the
              deep-link case where this menu was never rendered. */}
          <Can perm="settings.manage">
            <MenuRow icon={<SlidersHorizontal size={20} color={colors.brand} />} label={t('nav.settings')} onPress={() => router.push('/settings' as Href)} />
          </Can>
        </View>
      </Can>

      <Text className="mb-1 mt-6 text-xs font-semibold uppercase text-slate-400">{t('more.account')}</Text>
      <View className="mt-2 gap-3">
        {/* First in the section, and ungated. Somebody who has landed in a
            language they cannot read has to be able to find their way out, and
            this is the only row whose value they are guaranteed to recognise —
            each language is named in its own words. */}
        <LanguageRow />
        {/* Every signed-in user can see and cut off their own devices — this is
            personal account security, not an Owner power. */}
        {/* Every signed-in user has notifications of their own — an Owner is
            told about price changes, a branch about incoming transfers. */}
        <MenuRow icon={<Bell size={20} color={colors.brand} />} label={t('nav.notifications')} onPress={() => router.push('/notifications' as Href)} />
        <MenuRow icon={<Smartphone size={20} color={colors.brand} />} label={t('nav.devices')} onPress={() => router.push('/devices' as Href)} />
        {/* One row, not two. "Branch" and "Switch branch" were adjacent rows
            calling the same handler, which only made people wonder what the
            difference was. The current branch is the label's value; tapping it
            changes it. */}
        <MenuRow icon={<Store size={20} color={colors.brand} />} label={t('nav.branch')} value={branchName ?? undefined} onPress={changeBranch} />
        <Pressable onPress={signOut}>
          <Card className="flex-row items-center justify-between">
            <Row>
              <LogOut size={20} color={colors.red} />
              <Text className="font-medium text-red-600">{t('action.signOut')}</Text>
            </Row>
          </Card>
        </Pressable>
      </View>
    </Screen>
  );
}

/**
 * Choosing the language the app speaks.
 *
 * Expands in place rather than pushing a screen: it is two taps either way,
 * and a reader who cannot read this menu should not have to navigate deeper
 * into it to escape.
 *
 * Every language is written in its own words — "Arabic" spelled in French is
 * no use to somebody who only reads Arabic.
 *
 * Switching to or from Arabic changes the layout direction, which React Native
 * only applies natively at startup. The notice says so plainly instead of
 * leaving somebody to wonder why the words changed and the layout did not.
 */
function LanguageRow() {
  const { t } = useTranslation();
  const language = useI18n((s) => s.language);
  const setLanguage = useI18n((s) => s.setLanguage);
  const restartRequired = useI18n((s) => s.restartRequired);
  const [open, setOpen] = useState(false);

  return (
    <View className="gap-3">
      <Pressable onPress={() => setOpen((v) => !v)}>
        <Card className="flex-row items-center justify-between">
          <Row>
            <Languages size={20} color={colors.brand} />
            <Text className="font-medium text-slate-700">{t('settings.language')}</Text>
          </Row>
          <Row>
            <Text className="text-slate-500">{LANGUAGE_LABELS[language]}</Text>
            <ChevronRight size={18} color={colors.muted} />
          </Row>
        </Card>
      </Pressable>

      {open ? (
        <Card className="gap-1">
          {LANGUAGES.map((lang: Language) => (
            <Pressable
              key={lang}
              onPress={() => {
                void setLanguage(lang);
                setOpen(false);
              }}
              className="flex-row items-center justify-between py-3"
            >
              <Text
                className={
                  lang === language ? 'font-semibold text-brand-600' : 'font-medium text-slate-700'
                }
              >
                {LANGUAGE_LABELS[lang]}
              </Text>
              {/* The chosen one is marked, not merely coloured. */}
              {lang === language ? <Check size={18} color={colors.brand} /> : null}
            </Pressable>
          ))}
        </Card>
      ) : null}

      {restartRequired ? (
        <Card className="gap-1">
          <Text className="font-semibold text-amber-700">
            {t('settings.language.restartTitle')}
          </Text>
          <Text className="text-sm text-slate-500">{t('settings.language.restartBody')}</Text>
        </Card>
      ) : null}
    </View>
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
  const { t } = useTranslation();
  const router = useRouter();
  const counts = useTransferCounts(true);
  const c = counts.data;

  const waiting = c
    ? [
        c.pendingApproval > 0 ? t('transfers.count.waiting', { n: c.pendingApproval }) : null,
        c.approved > 0 ? t('transfers.count.toSend', { n: c.approved }) : null,
        c.inTransit > 0 ? t('transfers.count.onTheWay', { n: c.inTransit }) : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : undefined;

  return (
    <MenuRow
      icon={<ArrowLeftRight size={20} color={colors.brand} />}
      label={t('nav.transfers')}
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
