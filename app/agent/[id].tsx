import React, { useState } from 'react';
import { View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Flag, Undo2 } from 'lucide-react-native';
import {
  Button,
  Card,
  Chip,
  Divider,
  ErrorState,
  FilterChip,
  InlineNotice,
  MoneyValue,
  PermissionNotice,
  Screen,
  Section,
  SkeletonList,
  Text,
  TextField,
} from '../../components/ui';
import { BottomSheet } from '../../components/overlay';
import { activityAllows } from '../../lib/activity';
import { MISTAKE_KINDS, useAgentTransaction, useReportMistake, useReverseExchange, type AgentLegView, type AgentMistake, type AgentTransaction } from '../../lib/agent';
import { directionRowKey, legKindKey, legWordsKey, splitLegs } from '../../lib/agent-history';
import { percentOfBp } from '../../lib/agent-rules';
import { useConnectivity } from '../../lib/connectivity';
import { AMOUNT_LABEL, AMOUNT_ROW } from '../../lib/design/amount-row';
import { isolateLtr } from '../../lib/design/direction';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { useBranchActivity, useBusinessAccess } from '../../lib/entitlement';
import { toAgentError } from '../../lib/errors';
import { formatDate, formatDateTime } from '../../lib/format';
import { useTranslation, type TranslationKey } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import { toast } from '../../lib/toast';

/**
 * One exchange (docs/73 §4, A6–A7): everything the server recorded — the
 * direction in words, the provider, the amount, the commission with its rate
 * and where it went, the business day and the server's instant (the phone's
 * own time beside it, as a claim), who recorded it — and every leg it moved.
 *
 * The customer's number is masked unless the server sent it whole, which it
 * does only to whoever holds `agent.customer.reveal`. Nothing completed is
 * edited: an Employee reports a mistake (it moves nothing); the Owner or a
 * Manager reverses it, once, with a reason — every leg countered on the day of
 * the reversal, the original kept. Both are decisions, so online only (D155).
 */
export default function ExchangeDetailScreen() {
  const styles = useStyles();
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const canView = usePermission('agent.transaction.view');
  const query = useAgentTransaction(typeof id === 'string' && canView ? id : undefined);
  const title = t('agent.detail.title');

  if (!canView) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <PermissionNotice message={t('agent.permission.view')} />
      </Screen>
    );
  }

  return (
    <Screen scroll gap="lg" onRefresh={() => void query.refetch()} refreshing={query.isRefetching}>
      <Stack.Screen options={{ title }} />
      {query.isPending ? (
        <SkeletonList count={3} />
      ) : query.isError || !query.data ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <Detail tx={query.data} styles={styles} />
      )}
    </Screen>
  );
}

function Detail({ tx, styles }: { tx: AgentTransaction; styles: ReturnType<typeof useStyles> }) {
  const { t } = useTranslation();
  const activity = useBranchActivity();
  const access = useBusinessAccess();
  const online = useConnectivity((s) => s.online);
  const decide = activityAllows(activity, 'money_agent') && access.canWrite && tx.status === 'completed';
  const canReport = usePermission('agent.mistake.report') && decide;
  const canReverse = usePermission('agent.transaction.reverse') && decide;
  const [sheet, setSheet] = useState<'mistake' | 'reverse' | null>(null);
  const { original, reversal } = splitLegs(tx.legs);
  const provider = tx.providerLabel;
  const decimals = [tx.amount, tx.commission.amount, ...tx.legs.map((l) => l.amount)].some((v) => Math.round(v * 100) % 100 !== 0) ? 2 : 0;
  const where =
    tx.commission.principalFeeMode === 'deducted'
      ? t('agent.commission.deducted', { provider })
      : tx.commission.destination
        ? t(`agent.commission.${tx.commission.destination}`, { provider })
        : null;

  return (
    <>
      <Card style={styles.card}>
        <Text variant="heading">{t(directionRowKey(tx.direction) as TranslationKey, { provider })}</Text>
        <MoneyValue value={tx.amount} size="display" decimals={decimals} />
        <View style={styles.chips}>
          {tx.status === 'reversed' ? (
            <Chip label={t('agent.status.reversed')} tone="neutral" dot />
          ) : (
            <Chip label={t('agent.status.completed')} tone="success" dot />
          )}
          {tx.mistakes.some((m) => m.status === 'open') ? <Chip label={t('agent.status.mistake')} tone="warning" dot /> : null}
        </View>
      </Card>

      <Card style={styles.card}>
        <Field label={t('agent.number')} value={isolateLtr(tx.customerNumber ?? tx.customerNumberMasked)} />
        {tx.customerNumber ? (
          <Text variant="caption" tone="tertiary">
            {t('agent.detail.numberRevealed')}
          </Text>
        ) : null}
        <Field label={t('agent.reference')} value={tx.providerReference ? isolateLtr(tx.providerReference) : t('agent.detail.noReference')} />
        <Divider />
        <View style={[AMOUNT_ROW, styles.line]}>
          <View style={AMOUNT_LABEL}>
            <Text variant="body" tone="secondary">
              {t('agent.review.commission', { rate: isolateLtr(percentOfBp(tx.commission.rateBp)) })}
            </Text>
          </View>
          <MoneyValue value={tx.commission.amount} size="small" decimals={decimals} />
        </View>
        {where ? (
          <Text variant="caption" tone="secondary">
            {where}
          </Text>
        ) : null}
        <Divider />
        <Field label={t('agent.detail.businessDay')} value={formatDate(tx.businessDate)} />
        <Field label={t('agent.detail.recordedAt')} value={isolateLtr(formatDateTime(tx.recordedAt))} />
        {tx.deviceRecordedAt ? <Field label={t('agent.detail.phoneTime')} value={isolateLtr(formatDateTime(tx.deviceRecordedAt))} /> : null}
        <Field label={t('agent.detail.recordedBy')} value={tx.recordedBy.name} />
      </Card>

      <Section title={t('agent.detail.legs')} gap="xs">
        <Card style={styles.card}>
          {original.map((leg, i) => (
            <LegLine key={`o${i}`} leg={leg} provider={provider} decimals={decimals} />
          ))}
        </Card>
      </Section>

      {tx.reversal ? (
        <Section title={t('agent.detail.reversal')} gap="xs">
          <Card style={styles.card} testID="exchange-reversal">
            <Text variant="body">
              {t('agent.detail.reversedBy', {
                name: tx.reversal.byName ?? '',
                when: tx.reversal.at ? isolateLtr(formatDateTime(tx.reversal.at)) : '',
              })}
            </Text>
            {tx.reversal.reason ? (
              <Text variant="caption" tone="secondary">
                {t('agent.detail.reversalReason', { reason: tx.reversal.reason })}
              </Text>
            ) : null}
            <Divider />
            {reversal.map((leg, i) => (
              <LegLine key={`r${i}`} leg={leg} provider={provider} decimals={decimals} />
            ))}
          </Card>
        </Section>
      ) : null}

      {tx.mistakes.length > 0 ? (
        <Section title={t('agent.detail.mistakes')} gap="xs">
          {tx.mistakes.map((m) => (
            <MistakeLine key={m.id} mistake={m} />
          ))}
        </Section>
      ) : null}

      {canReport || canReverse ? (
        <View style={styles.actions}>
          {!online ? <InlineNotice tone="warning">{t('agent.detail.onlineOnly')}</InlineNotice> : null}
          {canReport ? <Button title={t('agent.mistake.action')} icon={Flag} variant="secondary" fullWidth disabled={!online} onPress={() => setSheet('mistake')} /> : null}
          {canReverse ? <Button title={t('agent.reverse.action')} icon={Undo2} variant="danger" fullWidth disabled={!online} onPress={() => setSheet('reverse')} /> : null}
        </View>
      ) : null}

      {canReport ? <MistakeSheet open={sheet === 'mistake'} onClose={() => setSheet(null)} id={tx.id} /> : null}
      {canReverse ? <ReverseSheet open={sheet === 'reverse'} onClose={() => setSheet(null)} id={tx.id} /> : null}
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={[AMOUNT_ROW, styles.line]}>
      <View style={AMOUNT_LABEL}>
        <Text variant="body" tone="secondary">
          {label}
        </Text>
      </View>
      <Text variant="bodyStrong">{value}</Text>
    </View>
  );
}

/** One leg in words — which account, which way, and why — with its amount signed the way the money went. */
function LegLine({ leg, provider, decimals }: { leg: AgentLegView; provider: string; decimals: number }) {
  const styles = useStyles();
  const { t } = useTranslation();
  return (
    <View style={[AMOUNT_ROW, styles.line]}>
      <View style={AMOUNT_LABEL}>
        <Text variant="body">{t(legWordsKey(leg) as TranslationKey, { provider })}</Text>
        <Text variant="caption" tone="tertiary">
          {t(legKindKey(leg.kind) as TranslationKey)}
        </Text>
      </View>
      <MoneyValue value={leg.direction === 'inflow' ? leg.amount : -leg.amount} size="small" signed tone="auto" decimals={decimals} />
    </View>
  );
}

function MistakeLine({ mistake }: { mistake: AgentMistake }) {
  const styles = useStyles();
  const { t } = useTranslation();
  return (
    <Card style={styles.card}>
      <View style={styles.chips}>
        <Text variant="bodyStrong">{t(`agent.mistake.kind.${mistake.kind}` as TranslationKey)}</Text>
        <Chip label={t(`agent.mistake.status.${mistake.status}` as TranslationKey)} tone={mistake.status === 'open' ? 'warning' : 'neutral'} size="sm" dot />
      </View>
      {mistake.note ? (
        <Text variant="caption" tone="secondary">
          {mistake.note}
        </Text>
      ) : null}
      <Text variant="caption" tone="tertiary">
        {t('agent.mistake.reportedBy', { name: mistake.reportedByName ?? '', when: isolateLtr(formatDateTime(mistake.reportedAt)) })}
      </Text>
    </Card>
  );
}

/** An Employee's claim that the exchange is wrong. It moves nothing; somebody who may reverse decides. */
function MistakeSheet({ open, onClose, id }: { open: boolean; onClose: () => void; id: string }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const report = useReportMistake(id);
  const [kind, setKind] = useState<AgentMistake['kind'] | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const send = () => {
    if (!kind) return;
    setError(null);
    report.mutate(
      { kind, note: note.trim() || undefined },
      {
        onSuccess: () => {
          toast.success(t('agent.mistake.sent'));
          setKind(null);
          setNote('');
          onClose();
        },
        onError: (e) => setError(toAgentError(e).body),
      },
    );
  };
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={t('agent.mistake.action')}
      subtitle={t('agent.mistake.explain')}
      footer={<Button title={t('agent.mistake.send')} fullWidth disabled={!kind || report.isPending} loading={report.isPending} onPress={send} />}
    >
      <View style={styles.sheet}>
        <View style={styles.wrap}>
          {MISTAKE_KINDS.map((k) => (
            <FilterChip key={k} label={t(`agent.mistake.kind.${k}` as TranslationKey)} selected={kind === k} onPress={() => setKind(k)} />
          ))}
        </View>
        <TextField label={t('agent.mistake.note')} value={note} onChangeText={setNote} maxLength={500} multiline />
        {error ? <InlineNotice tone="warning">{error}</InlineNotice> : null}
      </View>
    </BottomSheet>
  );
}

/** The Owner's or a Manager's reversal: once, with a reason that stays; every leg countered today (A7). */
function ReverseSheet({ open, onClose, id }: { open: boolean; onClose: () => void; id: string }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const reverse = useReverseExchange(id);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const confirm = () => {
    if (!reason.trim()) return;
    setError(null);
    reverse.mutate(reason.trim(), {
      onSuccess: () => {
        toast.success(t('agent.reverse.done'));
        setReason('');
        onClose();
      },
      onError: (e) => setError(toAgentError(e).body),
    });
  };
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={t('agent.reverse.action')}
      subtitle={t('agent.reverse.explain')}
      footer={<Button title={t('agent.reverse.confirm')} variant="danger" fullWidth disabled={!reason.trim() || reverse.isPending} loading={reverse.isPending} onPress={confirm} />}
    >
      <View style={styles.sheet}>
        <TextField label={t('agent.reverse.reason')} value={reason} onChangeText={setReason} maxLength={255} required multiline />
        {error ? <InlineNotice tone="warning">{error}</InlineNotice> : null}
      </View>
    </BottomSheet>
  );
}

const useStyles = makeStyles(() => ({
  card: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  line: { minHeight: 32 },
  actions: { gap: space.sm },
  sheet: { gap: space.md },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
}));
