import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack, useRouter, type Href } from 'expo-router';
import { Plus, Store } from 'lucide-react-native';
import { Button, Chip, EmptyState, ErrorState, FilterChip, InlineNotice, ListRow, PermissionNotice, RowGroup, Screen, SkeletonList, Text, TextField } from '../../components/ui';
import { BottomSheet } from '../../components/overlay';
import { ApiError } from '../../lib/api-client';
import { activityAllows } from '../../lib/activity';
import { useAgentProviders, useCreateProvider } from '../../lib/agent';
import { PROVIDER_KINDS, PROVIDER_LABEL_MAX, percentText, providersInOrder, providerStatus, suggestedLabel, type ProviderKind } from '../../lib/agent-providers';
import type { AgentProvider } from '../../lib/agent-rules';
import { useConnectivity } from '../../lib/connectivity';
import { isolateLtr } from '../../lib/design/direction';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { useBranchActivity, useBusinessAccess } from '../../lib/entitlement';
import { toAgentError } from '../../lib/errors';
import { useTranslation, type TranslationKey } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import { toast } from '../../lib/toast';

/**
 * The providers the company's counters exchange credit with (docs/73 §1.2,
 * §4.1) — the Owner's alone (`agent.provider.manage`).
 *
 * Each with how it stands for the counter: **Ready**, with its rates; **Not set
 * up yet**, naming what is still blank — a provider posts nothing until every
 * field of its configuration is filled from its real schedule; or **Switched
 * off**, its float and history kept. One tap opens a provider to fill in or
 * change its configuration, or to switch it off.
 *
 * The providers are the company's; the floats are each branch's (A9).
 */
export default function AgentProvidersScreen() {
  const styles = useStyles();
  const { t } = useTranslation();
  const router = useRouter();
  const title = t('nav.agent.providers');
  const canManage = usePermission('agent.provider.manage');
  const activity = useBranchActivity();
  const access = useBusinessAccess();
  const online = useConnectivity((s) => s.online);
  const query = useAgentProviders({ enabled: canManage });
  const [adding, setAdding] = useState(false);
  // Every write under agent/ needs the counter at this branch (D156): the list stays readable either way.
  const canWrite = access.canWrite && activityAllows(activity, 'money_agent');

  if (!canManage) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <PermissionNotice message={t('agent.providers.permission')} />
      </Screen>
    );
  }

  const providers = providersInOrder(query.data?.providers ?? []);

  return (
    <Screen scroll gap="lg" onRefresh={() => void query.refetch()} refreshing={query.isRefetching}>
      <Stack.Screen options={{ title }} />
      <Text variant="body" tone="secondary">
        {t('agent.providers.explain')}
      </Text>
      {query.isPending ? (
        <SkeletonList count={3} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : providers.length === 0 ? (
        <EmptyState icon={Store} title={t('agent.providers.empty')} body={t('agent.providers.empty.body')} />
      ) : (
        <RowGroup>
          {providers.map((p) => (
            <ProviderRow key={p.id} provider={p} onPress={() => router.push(`/agent/providers/${p.id}` as Href)} />
          ))}
        </RowGroup>
      )}
      {canWrite ? (
        <View style={styles.actions}>
          <Button title={t('agent.providers.add')} icon={Plus} variant="secondary" fullWidth disabled={!online} onPress={() => setAdding(true)} />
          {!online ? (
            <Text variant="caption" tone="secondary">
              {t('agent.providers.offline')}
            </Text>
          ) : null}
        </View>
      ) : null}
      {canWrite ? (
        <AddProviderSheet
          open={adding}
          onClose={() => setAdding(false)}
          onAdded={(p) => {
            setAdding(false);
            // Straight to its configuration: a provider is of no use to the counter until it is filled in.
            router.push(`/agent/providers/${p.id}` as Href);
          }}
        />
      ) : null}
    </Screen>
  );
}

/** One provider: its name, how it stands, and its rates — or what is still blank. */
function ProviderRow({ provider, onPress }: { provider: AgentProvider; onPress: () => void }) {
  const { t } = useTranslation();
  const status = providerStatus(provider);
  const c = provider.config;
  const subtitle =
    status === 'switched_off'
      ? t('agent.providers.switchedOff.body')
      : status === 'not_set_up'
        ? t('agent.providers.missing', { fields: provider.missing.map((f) => t(`agent.config.field.${f}` as TranslationKey)).join(' · ') })
        : c && c.rateInBp !== null && c.rateOutBp !== null
          ? c.sameRateBothDirections
            ? t('agent.providers.rate.both', { rate: isolateLtr(percentText(c.rateInBp)) })
            : t('agent.providers.rate.each', { in: isolateLtr(percentText(c.rateInBp)), out: isolateLtr(percentText(c.rateOutBp)) })
          : undefined;
  return (
    <ListRow
      flat
      title={provider.label}
      titleLines={0}
      subtitle={subtitle}
      subtitleLines={0}
      accessory={<Chip label={t(`agent.providers.status.${status}` as TranslationKey)} tone={status === 'ready' ? 'success' : status === 'not_set_up' ? 'warning' : 'neutral'} size="sm" dot />}
      onPress={onPress}
    />
  );
}

/** A new provider: its kind and its name. It posts nothing until its configuration is complete. */
function AddProviderSheet({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (provider: AgentProvider) => void }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const create = useCreateProvider();
  const [kind, setKind] = useState<ProviderKind | null>(null);
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const name = label.trim();

  const choose = (next: ProviderKind) => {
    // A known provider's own name is offered; one the Owner typed is never replaced.
    if (!name || PROVIDER_KINDS.some((k) => suggestedLabel(k) === name)) setLabel(suggestedLabel(next));
    setKind(next);
  };
  const close = () => {
    setKind(null);
    setLabel('');
    setError(null);
    // The submission ends with the sheet: the same name added another time is a new request, never a replay (D160).
    create.reset();
    onClose();
  };
  const save = () => {
    if (!kind || !name) return;
    setError(null);
    create.mutate(
      { kind, label: name },
      {
        onSuccess: (created) => {
          toast.success(t('agent.providers.added', { provider: created.label }));
          setKind(null);
          setLabel('');
          onAdded(created);
        },
        onError: (e) => setError(e instanceof ApiError && e.code === 'provider_label_in_use' ? t('agent.providers.labelInUse', { provider: name }) : toAgentError(e).body),
      },
    );
  };

  return (
    <BottomSheet
      open={open}
      onClose={close}
      title={t('agent.providers.add')}
      footer={<Button title={t('agent.providers.add.save')} fullWidth loading={create.isPending} disabled={!kind || !name || create.isPending} onPress={save} />}
    >
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheet}>
        <Text variant="label">{t('agent.providers.kind')}</Text>
        <View style={styles.wrap}>
          {PROVIDER_KINDS.map((k) => (
            <FilterChip key={k} label={t(`agent.providers.kind.${k}` as TranslationKey)} selected={kind === k} onPress={() => choose(k)} />
          ))}
        </View>
        <TextField label={t('agent.providers.label')} value={label} onChangeText={setLabel} maxLength={PROVIDER_LABEL_MAX} required />
        <Text variant="caption" tone="tertiary">
          {t('agent.providers.add.note')}
        </Text>
        {error ? <InlineNotice tone="warning">{error}</InlineNotice> : null}
      </ScrollView>
    </BottomSheet>
  );
}

const useStyles = makeStyles(() => ({
  actions: { gap: space.xs },
  sheet: { gap: space.md, paddingBottom: space.base },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
}));
