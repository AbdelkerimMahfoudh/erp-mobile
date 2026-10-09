import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Power, SlidersHorizontal } from 'lucide-react-native';
import { Button, Card, Chip, Divider, ErrorState, Expandable, FilterChip, InlineNotice, PermissionNotice, Screen, SkeletonList, Text, TextField } from '../../../components/ui';
import { BottomSheet } from '../../../components/overlay';
import { ApiError } from '../../../lib/api-client';
import { activityAllows } from '../../../lib/activity';
import { useAddProviderConfig, useAgentProviders, useProviderConfigs, useUpdateProvider } from '../../../lib/agent';
import {
  COMMISSION_DESTINATIONS,
  CONFIG_REASON_MAX,
  FEE_MODES,
  REFERENCE_RULES,
  configCheck,
  formOf,
  percentText,
  providerStatus,
  type ConfigForm,
  type ConfigProblem,
} from '../../../lib/agent-providers';
import type { AgentProvider, ProviderConfig } from '../../../lib/agent-rules';
import { useConnectivity } from '../../../lib/connectivity';
import { AMOUNT_LABEL, AMOUNT_ROW } from '../../../lib/design/amount-row';
import { isolateLtr } from '../../../lib/design/direction';
import { space } from '../../../lib/design/tokens';
import { makeStyles } from '../../../lib/design/theme';
import { dialog } from '../../../lib/dialog';
import { useBranchActivity, useBusinessAccess } from '../../../lib/entitlement';
import { toAgentError } from '../../../lib/errors';
import { formatDateTime } from '../../../lib/format';
import { useTranslation, type TranslationKey } from '../../../lib/i18n';
import { usePermission } from '../../../lib/permissions';
import { toast } from '../../../lib/toast';

/**
 * One provider and its configuration (docs/73 §1.2, §4.2) — the Owner's.
 *
 * The version in force, field by field, each blank shown as a blank — *Not set,
 * ask the provider's schedule* — never as a zero or a sample; while one is
 * blank the provider is *Not set up yet* and the counter cannot choose it.
 * A change is a new version, in force from the server's instant, with the
 * reason it exists; the versions before it stay, newest first, because every
 * recorded exchange keeps the version it used. Switching a provider off stops
 * new exchanges with it; its float and history stay.
 */
export default function AgentProviderScreen() {
  const styles = useStyles();
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const canManage = usePermission('agent.provider.manage');
  const activity = useBranchActivity();
  const access = useBusinessAccess();
  const online = useConnectivity((s) => s.online);
  const providers = useAgentProviders({ enabled: canManage });
  const provider = providers.data?.providers.find((p) => p.id === id) ?? null;
  const versions = useProviderConfigs(typeof id === 'string' && canManage ? id : undefined);
  const update = useUpdateProvider(typeof id === 'string' ? id : '');
  const [editing, setEditing] = useState(0);
  const canWrite = access.canWrite && activityAllows(activity, 'money_agent');

  if (!canManage) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('nav.agent.providers') }} />
        <PermissionNotice message={t('agent.providers.permission')} />
      </Screen>
    );
  }
  if (providers.isPending) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('nav.agent.providers') }} />
        <SkeletonList count={4} />
      </Screen>
    );
  }
  if (providers.isError || !provider) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('nav.agent.providers') }} />
        <ErrorState error={providers.error ?? new ApiError(t('agent.providers.notFound'), 404)} onRetry={() => void providers.refetch()} />
      </Screen>
    );
  }

  const status = providerStatus(provider);
  const switchActive = async () => {
    if (provider.isActive) {
      const ok = await dialog.confirm({
        title: t('agent.providers.switchOff.title', { provider: provider.label }),
        message: t('agent.providers.switchOff.body'),
        confirmLabel: t('agent.providers.switchOff'),
        tone: 'danger',
      });
      if (!ok) return;
    }
    update.mutate(
      { isActive: !provider.isActive },
      {
        onSuccess: (p) => toast.success(t(p.isActive ? 'agent.providers.switchedOn' : 'agent.providers.switchedOffDone', { provider: p.label })),
        onError: (e) => toast.error(toAgentError(e).body),
      },
    );
  };

  return (
    <Screen scroll gap="lg" onRefresh={() => void Promise.all([providers.refetch(), versions.refetch()])} refreshing={providers.isRefetching}>
      <Stack.Screen options={{ title: provider.label }} />
      <Card style={styles.card}>
        <View style={styles.between}>
          <Text variant="heading" style={styles.grow}>
            {provider.label}
          </Text>
          <Chip label={t(`agent.providers.status.${status}` as TranslationKey)} tone={status === 'ready' ? 'success' : status === 'not_set_up' ? 'warning' : 'neutral'} dot />
        </View>
        <Text variant="caption" tone="secondary">
          {t(`agent.providers.kind.${provider.kind}` as TranslationKey)}
        </Text>
        <Text variant="body" tone="secondary">
          {t(`agent.providers.status.${status}.body` as TranslationKey)}
        </Text>
      </Card>

      <Card style={styles.card} testID="provider-config">
        <Text variant="heading">{t('agent.config.title')}</Text>
        {provider.config ? (
          <Text variant="caption" tone="tertiary">
            {t('agent.config.since', { when: isolateLtr(formatDateTime(provider.config.effectiveFrom)), name: provider.config.recordedByName ?? '' })}
          </Text>
        ) : (
          <Text variant="caption" tone="warning">
            {t('agent.config.none')}
          </Text>
        )}
        <Divider />
        <ConfigFields config={provider.config} />
        {provider.config?.reason ? (
          <Text variant="caption" tone="secondary">
            {t('agent.config.reasonShown', { reason: provider.config.reason })}
          </Text>
        ) : null}
      </Card>

      {canWrite ? (
        <View style={styles.actions}>
          {!online ? <InlineNotice tone="warning">{t('agent.providers.offline')}</InlineNotice> : null}
          <Button title={t('agent.config.change')} icon={SlidersHorizontal} fullWidth disabled={!online} onPress={() => setEditing((n) => n + 1)} />
          <Button
            title={provider.isActive ? t('agent.providers.switchOff') : t('agent.providers.switchOn')}
            icon={Power}
            variant={provider.isActive ? 'danger' : 'secondary'}
            fullWidth
            loading={update.isPending}
            disabled={!online || update.isPending}
            onPress={() => void switchActive()}
          />
        </View>
      ) : null}

      <Expandable title={t('agent.config.history')} tone="solid" chevron="edge" meta={versions.data ? String(versions.data.configs.length) : undefined}>
        <View style={styles.history}>
          {versions.isPending ? (
            <SkeletonList count={2} />
          ) : (versions.data?.configs ?? []).length === 0 ? (
            <Text variant="caption" tone="tertiary">
              {t('agent.config.history.none')}
            </Text>
          ) : (
            (versions.data?.configs ?? []).map((v) => <VersionLine key={v.id} version={v} />)
          )}
        </View>
      </Expandable>

      {canWrite && editing > 0 ? <ConfigSheet key={editing} provider={provider} onClose={() => setEditing(0)} /> : null}
    </Screen>
  );
}

/** The version in force, field by field: each value in words, each blank said as a blank. */
function ConfigFields({ config }: { config: ProviderConfig | null }) {
  const { t } = useTranslation();
  const rate = (bp: number | null | undefined) => (bp === null || bp === undefined ? null : `${isolateLtr(percentText(bp))} %`);
  const rows: [string, string | null][] = [
    [t('agent.config.rateIn'), rate(config?.rateInBp)],
    [t('agent.config.rateOut'), rate(config?.rateOutBp)],
    [t('agent.config.sameRate'), config ? t(config.sameRateBothDirections ? 'agent.config.sameRate.yes' : 'agent.config.sameRate.no') : null],
    [t('agent.config.destination'), config?.commissionDestination ? t(`agent.config.destination.${config.commissionDestination}` as TranslationKey) : null],
    [t('agent.config.feeMode'), config?.principalFeeMode ? t(`agent.config.feeMode.${config.principalFeeMode}` as TranslationKey) : null],
    [t('agent.config.referenceRule'), config?.referenceRule ? t(`agent.config.referenceRule.${config.referenceRule}` as TranslationKey) : null],
  ];
  return (
    <>
      {rows.map(([label, value]) => (
        <FieldLine key={label} label={label} value={value} />
      ))}
    </>
  );
}

function FieldLine({ label, value }: { label: string; value: string | null }) {
  const styles = useStyles();
  const { t } = useTranslation();
  return (
    <View style={[AMOUNT_ROW, styles.line]}>
      <View style={AMOUNT_LABEL}>
        <Text variant="body" tone="secondary">
          {label}
        </Text>
      </View>
      {value !== null ? (
        <Text variant="bodyStrong">{value}</Text>
      ) : (
        <Text variant="bodyStrong" tone="warning">
          {t('agent.config.blank')}
        </Text>
      )}
    </View>
  );
}

/** One earlier version: when, by whom, why, and its rates in a line. */
function VersionLine({ version }: { version: ProviderConfig }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const rate = (bp: number | null) => (bp === null ? t('agent.config.notSet') : `${isolateLtr(percentText(bp))} %`);
  return (
    <View style={styles.version}>
      <Text variant="bodyStrong">{isolateLtr(formatDateTime(version.effectiveFrom))}</Text>
      <Text variant="caption" tone="secondary">
        {t('agent.config.version.rates', { in: rate(version.rateInBp), out: rate(version.rateOutBp) })}
      </Text>
      {version.reason ? (
        <Text variant="caption" tone="secondary">
          {t('agent.config.reasonShown', { reason: version.reason })}
        </Text>
      ) : null}
      <Text variant="caption" tone="tertiary">
        {t('agent.config.version.by', { name: version.recordedByName ?? '' })}
      </Text>
    </View>
  );
}

/**
 * A new version of the configuration. It starts from the version in force —
 * its blanks blank — and nothing is chosen for the Owner: a field left on *Not
 * set* is sent as a blank and keeps the provider from posting. The same-rate
 * question is asked as soon as a rate is typed. Mounted afresh for each
 * opening, so a closed form never leaves a half-typed rate behind.
 */
function ConfigSheet({ provider, onClose }: { provider: AgentProvider; onClose: () => void }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const save = useAddProviderConfig(provider.id);
  const [form, setForm] = useState<ConfigForm>(() => formOf(provider.config));
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const check = configCheck(form);
  const problems: ConfigProblem[] = check.ok ? [] : check.problems;
  const set = (change: Partial<ConfigForm>) => {
    setForm((f) => ({ ...f, ...change }));
    setError(null);
  };
  const has = (p: ConfigProblem) => tried && problems.includes(p);

  const submit = () => {
    setTried(true);
    if (!check.ok) return;
    save.mutate(check.body, {
      onSuccess: (done) => {
        toast.success(done.provider.readyForTransactions ? t('agent.config.saved.ready', { provider: provider.label }) : t('agent.config.saved.notReady', { provider: provider.label }));
        onClose();
      },
      onError: (e) => setError(e instanceof ApiError && e.code === 'config_invalid' ? t('agent.config.problem.deducted_needs_float') : toAgentError(e).body),
    });
  };

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={t('agent.config.change')}
      subtitle={provider.label}
      footer={<Button title={t('agent.config.save')} fullWidth loading={save.isPending} disabled={save.isPending} onPress={submit} />}
    >
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheet}>
        <Text variant="body" tone="secondary">
          {t('agent.config.explain', { provider: provider.label })}
        </Text>

        <Text variant="label">{t('agent.config.sameRate.question')}</Text>
        <View style={styles.wrap}>
          <FilterChip label={t('agent.config.sameRate.yes')} selected={form.sameRate === true} onPress={() => set({ sameRate: true })} />
          <FilterChip label={t('agent.config.sameRate.no')} selected={form.sameRate === false} onPress={() => set({ sameRate: false })} />
        </View>
        {has('same_rate_unanswered') ? (
          <Text variant="caption" tone="warning">
            {t('agent.config.problem.same_rate_unanswered')}
          </Text>
        ) : null}
        <TextField
          label={form.sameRate ? t('agent.config.rateBoth') : t('agent.config.rateIn')}
          accessibilityLabel={form.sameRate ? t('agent.config.rateBoth') : t('agent.config.rateIn')}
          hint={t('agent.config.rate.hint')}
          value={form.rateIn}
          onChangeText={(v) => set({ rateIn: v })}
          keyboardType="decimal-pad"
          placeholder={t('agent.config.notSet')}
          error={has('rate_in_invalid') ? t('agent.config.problem.rate_invalid') : undefined}
        />
        {form.sameRate ? null : (
          <TextField
            label={t('agent.config.rateOut')}
            accessibilityLabel={t('agent.config.rateOut')}
            hint={t('agent.config.rate.hint')}
            value={form.rateOut}
            onChangeText={(v) => set({ rateOut: v })}
            keyboardType="decimal-pad"
            placeholder={t('agent.config.notSet')}
            error={has('rate_out_invalid') ? t('agent.config.problem.rate_invalid') : undefined}
          />
        )}

        <Choice
          label={t('agent.config.destination')}
          values={COMMISSION_DESTINATIONS}
          value={form.destination}
          words={(v) => t(`agent.config.destination.${v}` as TranslationKey)}
          onChange={(destination) => set({ destination })}
        />
        <Choice label={t('agent.config.feeMode')} values={FEE_MODES} value={form.feeMode} words={(v) => t(`agent.config.feeMode.${v}` as TranslationKey)} onChange={(feeMode) => set({ feeMode })} />
        {has('deducted_needs_float') || (form.feeMode === 'deducted' && form.destination !== null && form.destination !== 'provider_float') ? (
          <Text variant="caption" tone="warning">
            {t('agent.config.problem.deducted_needs_float')}
          </Text>
        ) : null}
        <Choice
          label={t('agent.config.referenceRule')}
          values={REFERENCE_RULES}
          value={form.referenceRule}
          words={(v) => t(`agent.config.referenceRule.${v}` as TranslationKey)}
          onChange={(referenceRule) => set({ referenceRule })}
        />

        <TextField
          label={t('agent.config.reason')}
          accessibilityLabel={t('agent.config.reason')}
          hint={t('agent.config.reason.hint')}
          value={form.reason}
          onChangeText={(v) => set({ reason: v })}
          maxLength={CONFIG_REASON_MAX}
          required
          multiline
          error={has('reason_missing') ? t('agent.config.problem.reason_missing') : undefined}
        />
        {check.ok && check.missing.length > 0 ? (
          <InlineNotice tone="info">{t('agent.config.stillBlank', { fields: check.missing.map((f) => t(`agent.config.field.${f}` as TranslationKey)).join(' · ') })}</InlineNotice>
        ) : null}
        {error ? <InlineNotice tone="warning">{error}</InlineNotice> : null}
      </ScrollView>
    </BottomSheet>
  );
}

/** One choice of the configuration: its values in words, and *Not set* — the blank, chosen as such. */
function Choice<T extends string>({ label, values, value, words, onChange }: { label: string; values: readonly T[]; value: T | null; words: (v: T) => string; onChange: (v: T | null) => void }) {
  const styles = useStyles();
  const { t } = useTranslation();
  return (
    <View style={styles.choice}>
      <Text variant="label">{label}</Text>
      <View style={styles.wrap}>
        {values.map((v) => (
          <FilterChip key={v} label={words(v)} selected={value === v} onPress={() => onChange(v)} />
        ))}
        <FilterChip label={t('agent.config.notSet')} selected={value === null} onPress={() => onChange(null)} />
      </View>
    </View>
  );
}

const useStyles = makeStyles(() => ({
  card: { gap: space.sm },
  between: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  grow: { flex: 1, minWidth: 0 },
  line: { minHeight: 32 },
  actions: { gap: space.sm },
  history: { gap: space.md },
  version: { gap: 2 },
  sheet: { gap: space.md, paddingBottom: space.base },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  choice: { gap: space.xs },
}));
