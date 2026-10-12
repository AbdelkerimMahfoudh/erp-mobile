import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Power, SlidersHorizontal } from 'lucide-react-native';
import { Button, Card, Chip, Divider, ErrorState, Expandable, FilterChip, InlineNotice, PermissionNotice, Screen, SkeletonList, Text, TextField } from '../../../components/ui';
import { BottomSheet } from '../../../components/overlay';
import { ApiError } from '../../../lib/api-client';
import { activityAllows } from '../../../lib/activity';
import { useAddProviderConfig, useAgentProviders, useProviderConfigs, useUpdateProvider } from '../../../lib/agent';
import { CONFIG_REASON_MAX, REFERENCE_RULES, configCheck, formOf, percentText, providerStatus, type ConfigForm, type ConfigProblem } from '../../../lib/agent-providers';
import type { AgentProvider, LegacyPricing, ProviderConfig } from '../../../lib/agent-rules';
import { useConnectivity } from '../../../lib/connectivity';
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
 * One provider (docs/73 §1.2, D164) — the Owner's.
 *
 * A provider has no rate: the employee types the commission the customer pays
 * with every exchange, and the provider neither pays nor checks it. What the
 * Owner keeps here is whether the provider asks for its own reference, and
 * whether it is switched on. A change is a new version, in force from the
 * server's instant, with the reason it exists; earlier versions stay, newest
 * first — those written before D164 with the rates they held, shown as history
 * only. Switching a provider off stops new exchanges with it; its float and
 * history stay. Every line is a label above its value, so nothing is squeezed
 * on a narrow phone, with large text, or right to left.
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
        <Text variant="heading">{provider.label}</Text>
        <View style={styles.wrap}>
          <Chip label={t(`agent.providers.status.${status}` as TranslationKey)} tone={status === 'active' ? 'success' : 'neutral'} dot />
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
        <FieldLine label={t('agent.config.referenceRule')} value={t(`agent.config.referenceRule.${provider.referenceRule}` as TranslationKey)} />
        <Text variant="body" tone="secondary">
          {t('agent.config.commissionNote', { provider: provider.label })}
        </Text>
        {provider.config ? (
          <>
            <Divider />
            <Text variant="caption" tone="tertiary">
              {t('agent.config.since', { when: isolateLtr(formatDateTime(provider.config.effectiveFrom)), name: provider.config.recordedByName ?? '' })}
            </Text>
            {provider.config.reason ? (
              <Text variant="caption" tone="secondary">
                {t('agent.config.reasonShown', { reason: provider.config.reason })}
              </Text>
            ) : null}
            {provider.config.legacy ? <LegacyLines legacy={provider.config.legacy} /> : null}
          </>
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

/** A label above its value: readable at 320 px, with large text and right to left. */
function FieldLine({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.field}>
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
      <Text variant="bodyStrong">{value}</Text>
    </View>
  );
}

/** The rates a version written before D164 held, said as history: they price nothing now. */
function LegacyLines({ legacy }: { legacy: LegacyPricing }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const rate = (bp: number | null) => (bp === null ? t('agent.config.notSet') : `${isolateLtr(percentText(bp))} %`);
  return (
    <View style={styles.legacy}>
      <Text variant="caption" tone="secondary">
        {t('agent.config.legacy.title')}
      </Text>
      <Text variant="caption" tone="tertiary">
        {t('agent.config.version.rates', { in: rate(legacy.rateInBp), out: rate(legacy.rateOutBp) })}
      </Text>
    </View>
  );
}

/** One version: when, by whom, why, its reference rule — and, written before D164, its rates as history. */
function VersionLine({ version }: { version: ProviderConfig }) {
  const styles = useStyles();
  const { t } = useTranslation();
  return (
    <View style={styles.version}>
      <Text variant="bodyStrong">{isolateLtr(formatDateTime(version.effectiveFrom))}</Text>
      <Text variant="caption" tone="secondary">
        {t('agent.config.version.rule', { rule: t(`agent.config.referenceRule.${version.referenceRule}` as TranslationKey) })}
      </Text>
      {version.reason ? (
        <Text variant="caption" tone="secondary">
          {t('agent.config.reasonShown', { reason: version.reason })}
        </Text>
      ) : null}
      {version.legacy ? <LegacyLines legacy={version.legacy} /> : null}
      <Text variant="caption" tone="tertiary">
        {t('agent.config.version.by', { name: version.recordedByName ?? '' })}
      </Text>
    </View>
  );
}

/**
 * A new version: whether the provider asks for its reference, and why. It
 * starts from the rule in force. Mounted afresh for each opening, so a closed
 * form never leaves a half-typed reason behind.
 */
function ConfigSheet({ provider, onClose }: { provider: AgentProvider; onClose: () => void }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const save = useAddProviderConfig(provider.id);
  const [form, setForm] = useState<ConfigForm>(() => formOf(provider));
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
      onSuccess: () => {
        toast.success(t('agent.config.saved', { provider: provider.label }));
        onClose();
      },
      onError: (e) => setError(toAgentError(e).body),
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
        <View style={styles.choice}>
          <Text variant="label">{t('agent.config.referenceRule')}</Text>
          <View style={styles.wrap}>
            {REFERENCE_RULES.map((rule) => (
              <FilterChip
                key={rule}
                label={t(`agent.config.referenceRule.${rule}` as TranslationKey)}
                selected={form.referenceRule === rule}
                onPress={() => set({ referenceRule: rule })}
              />
            ))}
          </View>
        </View>
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
        {error ? <InlineNotice tone="warning">{error}</InlineNotice> : null}
      </ScrollView>
    </BottomSheet>
  );
}

const useStyles = makeStyles(() => ({
  card: { gap: space.sm },
  field: { gap: 2 },
  legacy: { gap: 2 },
  actions: { gap: space.sm },
  history: { gap: space.md },
  version: { gap: 2 },
  sheet: { gap: space.md, paddingBottom: space.base },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  choice: { gap: space.xs },
}));
