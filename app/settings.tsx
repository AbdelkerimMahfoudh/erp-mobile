import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useNavigation } from 'expo-router';
import { usePreventRemove } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Landmark, Plus, Smartphone, Wallet } from 'lucide-react-native';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  ListRow,
  Screen,
  Section,
  SegmentedControl,
  SkeletonList,
  Chip,
  Identifier,
  Text,
  TextField,
  Toggle,
} from '../components/ui';
import { BottomSheet } from '../components/overlay';
import { ApiError, api } from '../lib/api-client';
import { space } from '../lib/design/tokens';
import { toFriendlyError } from '../lib/errors';
import { useTranslation } from '../lib/i18n';
import { useAuth } from '../hooks/useAuth';
import { usePermission } from '../lib/permissions';
import { qk } from '../lib/query-keys';
import { toast } from '../lib/toast';
import { dialog } from '../lib/dialog';
import type {
  OwnerReceivingAccount,
  OwnerSettings,
  ReceivingProvider,
  Settings,
} from '../types/api';

/**
 * Business settings — the Owner's screen.
 *
 * This is the first screen where one person's choice binds everyone else, so it
 * is built to be slow in the right places: nothing saves as you type, the save
 * button only appears once something actually differs, and leaving with unsaved
 * work asks first. A settings screen that silently discards a change is worse
 * than one that never offered the setting.
 *
 * Deliberately absent, per the approved decisions: any subscription price,
 * payment button, Bankily API field or website link. Accounts here record where
 * money is expected — the app never authenticates to a provider and never moves
 * money.
 */

const RETURN_PRESETS = [0, 24, 48] as const;
const AUTO_LOCK_CHOICES = [0, 30, 60, 300, 900] as const;
const MAX_RETURN_HOURS = 8760;

const PROVIDER_ICONS: Record<ReceivingProvider, typeof Smartphone> = {
  bankily: Smartphone,
  sedad: Smartphone,
  bim_bank: Landmark,
  other: Wallet,
};

/**
 * Language of the Owner's WhatsApp summary.
 *
 * Deliberately its own type rather than reusing the app's `Language`: they
 * happen to hold the same three values today, but they answer different
 * questions and the server owns this one.
 */
type SummaryLanguage = 'en' | 'ar' | 'fr';

/** Local edit state — what the screen owns until Save. */
interface Draft {
  returnWindowHours: number;
  language: SummaryLanguage;
  includeAmounts: boolean;
  dailyEnabled: boolean;
  monthlyEnabled: boolean;
  autoLockMaxSeconds: number;
}

function draftOf(s: OwnerSettings): Draft {
  return {
    returnWindowHours: s.returnWindowHours,
    language: s.whatsapp.language,
    includeAmounts: s.whatsapp.includeAmounts,
    dailyEnabled: s.whatsapp.dailyEnabled,
    monthlyEnabled: s.whatsapp.monthlyEnabled,
    autoLockMaxSeconds: s.security.autoLockMaxSeconds,
  };
}

export default function SettingsScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigation = useNavigation();
  const canManage = usePermission('settings.manage');

  const [draft, setDraft] = useState<Draft | null>(null);
  const [customHours, setCustomHours] = useState('');
  const [hoursError, setHoursError] = useState<string | undefined>();
  const [editing, setEditing] = useState<OwnerReceivingAccount | 'new' | null>(null);

  const settings = useQuery({
    queryKey: qk.settings,
    queryFn: () => api.get<Settings>('/settings'),
  });

  const owner = settings.data?.canManage ? settings.data : null;

  // Load the server's values into the draft once, and again after every save or
  // conflict reload — never while the Owner is mid-edit.
  useEffect(() => {
    if (!owner) return;
    setDraft((current) => current ?? draftOf(owner));
  }, [owner]);

  useEffect(() => {
    if (!owner || draft) return;
    setCustomHours(
      RETURN_PRESETS.includes(owner.returnWindowHours as never) ? '' : String(owner.returnWindowHours),
    );
  }, [owner, draft]);

  const dirty = useMemo(() => {
    if (!owner || !draft) return false;
    const saved = draftOf(owner);
    return (Object.keys(saved) as (keyof Draft)[]).some((k) => saved[k] !== draft[k]);
  }, [owner, draft]);

  // ── Unsaved-change protection ─────────────────────────────────────────────
  // Covers every exit — the back gesture, the header arrow, the hardware button
  // — because they all resolve to the same navigation action.
  usePreventRemove(dirty, ({ data }) => {
    void (async () => {
      const leave = await dialog.confirm({
        title: t('settings.unsaved.title'),
        message: t('settings.unsaved.body'),
        confirmLabel: t('settings.unsaved.confirm'),
        cancelLabel: t('action.cancel'),
        tone: 'danger',
      });
      if (leave) navigation.dispatch(data.action);
    })();
  });

  // ── Saving ────────────────────────────────────────────────────────────────

  const save = useMutation({
    mutationFn: async () => {
      if (!owner || !draft) throw new Error('nothing to save');
      return api.put<OwnerSettings>('/settings', {
        version: owner.version,
        returnWindowHours: draft.returnWindowHours,
        whatsapp: {
          language: draft.language,
          includeAmounts: draft.includeAmounts,
          dailyEnabled: draft.dailyEnabled,
          monthlyEnabled: draft.monthlyEnabled,
        },
        security: { autoLockMaxSeconds: draft.autoLockMaxSeconds },
      });
    },
    onSuccess: (fresh) => {
      queryClient.setQueryData(qk.settings, fresh);
      setDraft(draftOf(fresh));
      toast.success(t('settings.saved'));
    },
    onError: async (error) => {
      // 409 means someone else saved first. Reloading and *showing* the current
      // values is the only honest response — retrying would overwrite them.
      if (error instanceof ApiError && error.status === 409) {
        const { data } = await settings.refetch();
        if (data?.canManage) setDraft(draftOf(data));
        await dialog.alert({
          title: t('settings.conflict.title'),
          message: t('settings.conflict.body'),
        });
        return;
      }
      toast.error(toFriendlyError(error).body);
    },
  });

  const onReturnPreset = useCallback((value: string) => {
    setHoursError(undefined);
    if (value === 'custom') {
      const parsed = Number(customHours);
      setDraft((d) => (d ? { ...d, returnWindowHours: Number.isFinite(parsed) ? parsed : 0 } : d));
      return;
    }
    setCustomHours('');
    setDraft((d) => (d ? { ...d, returnWindowHours: Number(value) } : d));
  }, [customHours]);

  const onCustomHours = useCallback((text: string) => {
    setCustomHours(text);
    const parsed = Number(text);
    const valid = /^\d+$/.test(text) && parsed >= 1 && parsed <= MAX_RETURN_HOURS;
    setHoursError(text.length === 0 || valid ? undefined : t('settings.returns.invalid'));
    if (valid) setDraft((d) => (d ? { ...d, returnWindowHours: parsed } : d));
  }, [t]);

  // ── States ────────────────────────────────────────────────────────────────

  if (settings.isLoading) {
    return (
      <Screen>
        <Text variant="title">{t('settings.title')}</Text>
        <SkeletonList count={5} />
      </Screen>
    );
  }

  if (settings.isError) {
    return (
      <Screen>
        <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
      </Screen>
    );
  }

  // Non-Owners get no editable controls at all. The route is already hidden
  // from them, and the server strips the Owner-only fields regardless — this is
  // the third layer, for the case where someone arrives here by deep link.
  if (!owner || !canManage) {
    return (
      <Screen>
        {/* A real 403 shape, so the state renders the same lock and wording
            an actual server refusal would. */}
        <ErrorState error={new ApiError(t('state.error.permission.body'), 403)} />
      </Screen>
    );
  }

  const returnSegment = RETURN_PRESETS.includes(draft?.returnWindowHours as never) && !customHours
    ? String(draft?.returnWindowHours)
    : 'custom';

  return (
    <Screen
      gap="xl"
      footer={
        dirty ? (
          <Button
            title={t('settings.save')}
            onPress={() => save.mutate()}
            loading={save.isPending}
            disabled={Boolean(hoursError)}
            fullWidth
          />
        ) : undefined
      }
    >
      <View>
        <Text variant="title">{t('settings.title')}</Text>
        <Text variant="caption" tone="secondary" style={styles.subtitle}>
          {t('settings.subtitle')}
        </Text>
      </View>

      <PersonalIdCard />
      <StoreAccountIdCard />

      {/* ── Returns ─────────────────────────────────────────────────────── */}
      <Section title={t('settings.returns.section')}>
        <Card>
          <Text variant="label">{t('settings.returns.label')}</Text>
          <Text variant="caption" tone="secondary" style={styles.hint}>
            {t('settings.returns.hint')}
          </Text>
          <SegmentedControl
            style={styles.control}
            value={returnSegment}
            onChange={onReturnPreset}
            options={[
              { value: '0', label: t('settings.returns.none') },
              { value: '24', label: t('settings.returns.24h') },
              { value: '48', label: t('settings.returns.48h') },
              { value: 'custom', label: t('settings.returns.custom') },
            ]}
          />

          {returnSegment === 'custom' ? (
            <TextField
              containerStyle={styles.control}
              label={t('settings.returns.customLabel')}
              hint={t('settings.returns.customHint')}
              error={hoursError}
              value={customHours}
              onChangeText={onCustomHours}
              keyboardType="number-pad"
              variant="identifier"
            />
          ) : null}

          {/* State in words, never a bare number. */}
          <Text variant="caption" tone="secondary" style={styles.control}>
            {draft && draft.returnWindowHours > 0
              ? t('settings.returns.windowExplained', { hours: draft.returnWindowHours })
              : t('settings.returns.noneExplained')}
          </Text>
        </Card>
      </Section>

      {/* ── Receiving accounts ──────────────────────────────────────────── */}
      <Section title={t('settings.accounts.section')} subtitle={t('settings.accounts.hint')}>
        {owner.receivingAccounts.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title={t('settings.accounts.empty')}
            body={t('settings.accounts.emptyBody')}
          />
        ) : (
          <View style={styles.list}>
            {owner.receivingAccounts.map((account) => (
              <ListRow
                key={account.id}
                title={account.label}
                subtitle={
                  account.provider === 'other'
                    ? account.providerName ?? t('settings.provider.other')
                    : t(`settings.provider.${account.provider}` as never)
                }
                leading={PROVIDER_ICONS[account.provider]}
                accessory={
                  account.isActive ? undefined : (
                    <Chip tone="neutral" label={t('settings.accounts.inactive')} dot />
                  )
                }
                onPress={() => setEditing(account)}
              />
            ))}
          </View>
        )}

        <Button
          title={t('settings.accounts.add')}
          variant="secondary"
          icon={Plus}
          onPress={() => setEditing('new')}
          style={styles.control}
        />
      </Section>

      {/* ── WhatsApp summaries ──────────────────────────────────────────── */}
      <Section title={t('settings.whatsapp.section')} subtitle={t('settings.whatsapp.hint')}>
        <Card>
          <Text variant="label">{t('settings.whatsapp.language')}</Text>
          {/*
            Each language in its own words, and the same three the app itself
            speaks. This is the Owner's summary message, NOT the app's language
            — the two are chosen separately on purpose, because an Owner may
            read the app in one language and want the nightly message in
            another.
          */}
          <SegmentedControl
            style={styles.control}
            value={draft?.language ?? 'en'}
            onChange={(value) =>
              setDraft((d) => (d ? { ...d, language: value as SummaryLanguage } : d))
            }
            options={[
              { value: 'en', label: 'English' },
              { value: 'fr', label: 'Français' },
              { value: 'ar', label: 'العربية' },
            ]}
          />
        </Card>

        <View style={styles.list}>
          <Toggle
            label={t('settings.whatsapp.amounts')}
            hint={t('settings.whatsapp.amountsHint')}
            onLabel={t('settings.toggle.on')}
            offLabel={t('settings.toggle.off')}
            value={draft?.includeAmounts ?? false}
            onValueChange={(v) => setDraft((d) => (d ? { ...d, includeAmounts: v } : d))}
          />
          <Toggle
            label={t('settings.whatsapp.daily')}
            hint={t('settings.whatsapp.dailyHint')}
            onLabel={t('settings.toggle.on')}
            offLabel={t('settings.toggle.off')}
            value={draft?.dailyEnabled ?? false}
            onValueChange={(v) => setDraft((d) => (d ? { ...d, dailyEnabled: v } : d))}
          />
          <Toggle
            label={t('settings.whatsapp.monthly')}
            hint={t('settings.whatsapp.monthlyHint')}
            onLabel={t('settings.toggle.on')}
            offLabel={t('settings.toggle.off')}
            value={draft?.monthlyEnabled ?? false}
            onValueChange={(v) => setDraft((d) => (d ? { ...d, monthlyEnabled: v } : d))}
          />
        </View>

        {/* Honest about what saving does today. */}
        <Text variant="caption" tone="tertiary" style={styles.control}>
          {t('settings.whatsapp.notYet')}
        </Text>
      </Section>

      {/* ── Security ────────────────────────────────────────────────────── */}
      <Section title={t('settings.security.section')}>
        <Card>
          <Text variant="label">{t('settings.security.autoLock')}</Text>
          <Text variant="caption" tone="secondary" style={styles.hint}>
            {t('settings.security.autoLockHint')}
          </Text>
          <View style={styles.lockList}>
            {AUTO_LOCK_CHOICES.map((seconds) => (
              <ListRow
                key={seconds}
                title={autoLockLabel(seconds, t)}
                selected={draft?.autoLockMaxSeconds === seconds}
                chevron={false}
                onPress={() => setDraft((d) => (d ? { ...d, autoLockMaxSeconds: seconds } : d))}
              />
            ))}
          </View>
        </Card>
      </Section>

      <AccountSheet
        account={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void queryClient.invalidateQueries({ queryKey: qk.settings });
        }}
      />
    </Screen>
  );
}

function autoLockLabel(seconds: number, t: (key: never) => string): string {
  switch (seconds) {
    case 0:
      return t('settings.security.immediate' as never);
    case 30:
      return t('settings.security.30s' as never);
    case 60:
      return t('settings.security.1m' as never);
    case 300:
      return t('settings.security.5m' as never);
    default:
      return t('settings.security.15m' as never);
  }
}

// ───────────────────────────────────────────────────────────────────────────

const PROVIDERS: ReceivingProvider[] = ['bankily', 'sedad', 'bim_bank', 'other'];

/**
 * Add or edit one account.
 *
 * Accounts save on their own rather than joining the page-level draft: they are
 * separate rows with their own versions on the server, and batching them into
 * one Save would make a duplicate-label rejection look like the whole screen
 * failing.
 */
function AccountSheet({
  account,
  onClose,
  onSaved,
}: {
  account: OwnerReceivingAccount | 'new' | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const isNew = account === 'new';
  const existing = account && account !== 'new' ? account : null;

  const [provider, setProvider] = useState<ReceivingProvider>('bankily');
  const [providerName, setProviderName] = useState('');
  const [label, setLabel] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [errors, setErrors] = useState<{ label?: string; providerName?: string }>({});

  useEffect(() => {
    if (!account) return;
    setProvider(existing?.provider ?? 'bankily');
    setProviderName(existing?.providerName ?? '');
    setLabel(existing?.label ?? '');
    setIsActive(existing?.isActive ?? true);
    setErrors({});
  }, [account, existing]);

  const submit = useMutation({
    mutationFn: async () => {
      const body = {
        provider,
        ...(provider === 'other' ? { providerName: providerName.trim() } : {}),
        label: label.trim(),
      };
      if (existing) {
        return api.patch(`/settings/receiving-accounts/${existing.id}`, {
          version: existing.version,
          ...body,
          isActive,
        });
      }
      return api.post('/settings/receiving-accounts', body);
    },
    onSuccess: () => {
      toast.success(t(existing ? 'settings.accounts.updated' : 'settings.accounts.created'));
      onSaved();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        setErrors({ label: t('settings.accounts.duplicate') });
        return;
      }
      toast.error(toFriendlyError(error).body);
    },
  });

  const onSubmit = () => {
    const next: { label?: string; providerName?: string } = {};
    if (label.trim().length === 0) next.label = t('settings.accounts.labelRequired');
    if (provider === 'other' && providerName.trim().length === 0) {
      next.providerName = t('settings.accounts.providerNameRequired');
    }
    setErrors(next);
    if (Object.keys(next).length === 0) submit.mutate();
  };

  return (
    <BottomSheet
      open={account !== null}
      onClose={onClose}
      title={t(isNew ? 'settings.accounts.newTitle' : 'settings.accounts.editTitle')}
      footer={
        <Button
          title={t('action.save')}
          onPress={onSubmit}
          loading={submit.isPending}
          fullWidth
        />
      }
    >
      <View style={styles.sheet}>
        <View>
          <Text variant="label">{t('settings.accounts.provider')}</Text>
          <SegmentedControl
            style={styles.control}
            value={provider}
            onChange={(value) => setProvider(value as ReceivingProvider)}
            options={PROVIDERS.map((p) => ({
              value: p,
              label: t(`settings.provider.${p}` as never),
            }))}
          />
        </View>

        {provider === 'other' ? (
          <TextField
            label={t('settings.accounts.providerName')}
            required
            value={providerName}
            error={errors.providerName}
            onChangeText={setProviderName}
          />
        ) : null}

        <TextField
          label={t('settings.accounts.label')}
          hint={t('settings.accounts.labelHint')}
          required
          value={label}
          error={errors.label}
          onChangeText={setLabel}
          maxLength={80}
        />

        {existing ? (
          <Toggle
            label={t('settings.accounts.active')}
            hint={t('settings.accounts.activeHint')}
            onLabel={t('settings.toggle.on')}
            offLabel={t('settings.toggle.off')}
            value={isActive}
            onValueChange={setIsActive}
          />
        ) : null}
      </View>
    </BottomSheet>
  );
}


/**
 * The identifier this person signs in with (CP3).
 *
 * Needed here because it is generated, not chosen: without somewhere to read
 * it, anybody who has no phone number on their account would have to contact
 * support to get into the app at all.
 *
 * It is not a password and is not treated as one — it is half of a
 * credential, exactly like a username, and the screen says so. No password,
 * PIN or session token is ever shown here.
 */
function PersonalIdCard() {
  const { t } = useTranslation();
  const { user } = useAuth();

  if (!user?.personalId) return null;
  const personalId = user.personalId;

  const copy = async () => {
    try {
      const ok = await Clipboard.setStringAsync(personalId);
      if (!ok) {
        toast.error(t('settings.personalId.copyFailed'));
        return;
      }
      toast.success(t('settings.personalId.copied'));
    } catch {
      toast.error(t('settings.personalId.copyFailed'));
    }
  };

  return (
    <Section title={t('settings.personalId.section')} subtitle={t('settings.personalId.hint')}>
      <Card>
        <View style={styles.storeIdRow}>
          <Identifier tone="primary" style={styles.storeIdValue}>{personalId}</Identifier>
          <Button
            title={t('settings.personalId.copy')}
            variant="secondary"
            size="sm"
            icon={Copy}
            onPress={() => void copy()}
          />
        </View>
        <Text variant="caption" tone="secondary" style={styles.hint}>
          {t('settings.personalId.instead')}
        </Text>
      </Card>
    </Section>
  );
}
/**
 * The Store Account ID, where the Owner can actually find it.
 *
 * Employees are asked for this at sign-in, so an Owner who cannot read it off a
 * screen cannot onboard anyone. It is deliberately presented as **shareable**:
 * it selects the shop, it is not a secret, and it cannot sign anyone in on its
 * own — the wording says so, because a code that looks like a password gets
 * treated like one and never gets shared.
 *
 * Read-only by design. The internal BINARY(16) company id is never shown here
 * or anywhere else in the app.
 */
function StoreAccountIdCard() {
  const { t } = useTranslation();
  const { user } = useAuth();

  if (!user?.publicStoreId) return null;

  const storeId = user.publicStoreId;

  // `expo-clipboard` is asynchronous and reports whether the write actually
  // landed. Both matter: confirmation is the only feedback a copy ever gives,
  // and an Owner reading the ID aloud over the phone must not be told it
  // copied when it did not. Nothing here ever *reads* the clipboard.
  const copy = async () => {
    try {
      const ok = await Clipboard.setStringAsync(storeId);
      if (!ok) {
        toast.error(t('settings.storeId.copyFailed'));
        return;
      }
      toast.success(t('settings.storeId.copied'));
    } catch {
      toast.error(t('settings.storeId.copyFailed'));
    }
  };

  return (
    <Section title={t('settings.storeId.section')} subtitle={t('settings.storeId.hint')}>
      <Card>
        <View style={styles.storeIdRow}>
          <Identifier tone="primary" style={styles.storeIdValue}>{storeId}</Identifier>
          <Button
            title={t('settings.storeId.copy')}
            variant="secondary"
            size="sm"
            icon={Copy}
            onPress={() => void copy()}
          />
        </View>
        <Text variant="caption" tone="secondary" style={styles.hint}>
          {t('settings.storeId.share')}
        </Text>
      </Card>
    </Section>
  );
}

const styles = StyleSheet.create({
  subtitle: { marginTop: space.xs },
  hint: { marginTop: space.xs },
  control: { marginTop: space.md },
  list: { gap: space.sm },
  lockList: { gap: space.sm, marginTop: space.md },
  sheet: { gap: space.base },
  storeIdValue: { fontSize: 20, letterSpacing: 2 },
  storeIdRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
});
