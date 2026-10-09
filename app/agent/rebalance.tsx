import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { Plus, Scale, Trash2 } from 'lucide-react-native';
import {
  Button,
  Card,
  Divider,
  FilterChip,
  InlineNotice,
  ListRow,
  MoneyField,
  MoneyValue,
  PermissionNotice,
  Screen,
  Section,
  SegmentedControl,
  SkeletonList,
  Text,
  TextField,
} from '../../components/ui';
import { SelectSheet } from '../../components/overlay/SelectSheet';
import { ApiError } from '../../lib/api-client';
import { activityAllows } from '../../lib/activity';
import { useAgentPositions, useAgentProviders, useAgentRebalancings, useRecordRebalancing, type AgentRebalancing } from '../../lib/agent';
import { legWordsKey } from '../../lib/agent-history';
import {
  EXTERNAL_COUNTERPARTIES,
  REBALANCING_NOTE_MAX,
  REBALANCING_REASON_MAX,
  accountKeyOf,
  negativeProblems,
  rebalancingAccounts,
  rebalancingCheck,
  startingLines,
  withAmount,
  type AccountChoice,
  type ExternalCounterparty,
  type NegativeProblem,
  type RebalancingBody,
  type RebalancingLine,
  type RebalancingProblem,
} from '../../lib/agent-money';
import type { LegDirection } from '../../lib/agent-rules';
import { useConnectivity } from '../../lib/connectivity';
import { AMOUNT_LABEL, AMOUNT_ROW } from '../../lib/design/amount-row';
import { isolateLtr } from '../../lib/design/direction';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { useBranchActivity, useBusinessAccess } from '../../lib/entitlement';
import { toAgentError } from '../../lib/errors';
import { RequestTimeout } from '../../lib/offline/classify';
import { formatSmartDateTime, formatMoney } from '../../lib/format';
import { useTranslation, type TranslationKey } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import { toast } from '../../lib/toast';
import { uuidv4 } from '../../lib/utils';

/** The reasons a counter gives most, offered as words to tap — the reason field stays the person's own. */
const REASONS = ['buyFloat', 'sellFloat', 'cashIn', 'cashOut', 'commission'] as const;

/**
 * Rebalancing (A8, docs/73 §4.3): money moved between the drawer and the
 * floats — buying float with cash, selling it back — or brought in from, or
 * sent to, the outside. Never an exchange: it adds nothing to the count, the
 * volume or the commission, and the reports list it on its own line.
 *
 * The form is lines — an account, which way, an amount — that must balance:
 * what comes in equals what goes out, or the person names who is on the other
 * side (the Owner's own money, the provider's settlement, something else) and
 * the app fills in exactly the difference. It opens on the move a counter makes
 * most — cash out of the drawer, into a float — and with two lines the amount
 * is typed once. The server checks everything again; a position the move would
 * take below zero is refused by name, and only the Owner may confirm it.
 *
 * The Owner's and a Manager's (`agent.rebalance`); online only (D155).
 */
export default function AgentRebalanceScreen() {
  const styles = useStyles();
  const { t } = useTranslation();
  const title = t('nav.agent.rebalance');
  const canRebalance = usePermission('agent.rebalance');
  const isOwner = usePermission('agent.position.set');
  const activity = useBranchActivity();
  const access = useBusinessAccess();
  const online = useConnectivity((s) => s.online);
  const allowed = canRebalance && activityAllows(activity, 'money_agent');
  const providers = useAgentProviders({ enabled: allowed });
  const positions = useAgentPositions({ enabled: allowed });
  const today = useAgentRebalancings({}, { enabled: allowed });
  const record = useRecordRebalancing();

  const accounts = useMemo(() => rebalancingAccounts(providers.data?.providers ?? [], positions.data ?? null), [providers.data, positions.data]);
  const firstFloat = accounts.find((a) => a.account === 'provider')?.providerId ?? null;
  // The lines start once the providers are known, on the move a counter makes most; the person's edits replace them.
  const providersPending = providers.isPending;
  const initial = useMemo(() => (providersPending ? null : startingLines(firstFloat, uuidv4)), [providersPending, firstFloat]);
  const [lines, setLines] = useState<RebalancingLine[] | null>(null);
  const [typedByHand, setTypedByHand] = useState<ReadonlySet<string>>(new Set());
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [external, setExternal] = useState<ExternalCounterparty | null>(null);
  const [tried, setTried] = useState(false);
  const [negative, setNegative] = useState<{ body: RebalancingBody; problems: NegativeProblem[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);

  const shown = lines ?? initial;
  const check = rebalancingCheck({ reason, note, lines: shown ?? [], external });
  const nameOf = (key: string): string => {
    const choice = accounts.find((a) => a.key === key);
    if (!choice || choice.account === 'cash') return t('agent.positions.cash');
    return choice.account === 'provider' ? t('agent.positions.float', { provider: choice.label }) : t('agent.positions.held', { provider: choice.label });
  };
  const money = (v: number) => isolateLtr(formatMoney(v));

  if (!canRebalance || !activityAllows(activity, 'money_agent')) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <PermissionNotice message={canRebalance ? t('agent.notSubscribed.body') : t('agent.rebalance.permission')} />
      </Screen>
    );
  }

  const edit = (next: RebalancingLine[]) => {
    setLines(next);
    setNegative(null);
    setError(null);
  };
  const update = (id: string, change: Partial<RebalancingLine>) => edit((shown ?? []).map((l) => (l.id === id ? { ...l, ...change } : l)));
  const typeAmount = (id: string, amount: string) => {
    setTypedByHand((s) => new Set(s).add(id));
    edit(withAmount(shown ?? [], id, amount, typedByHand));
  };

  const reset = () => {
    setLines(null);
    setTypedByHand(new Set());
    setReason('');
    setNote('');
    setExternal(null);
    setTried(false);
    setNegative(null);
    setError(null);
    record.reset();
  };

  const send = (body: RebalancingBody, confirmNegative: boolean) => {
    setError(null);
    record.mutate(
      { ...body, ...(confirmNegative ? { confirmNegative: true } : {}) },
      {
        onSuccess: () => {
          toast.success(t('agent.rebalance.done'));
          reset();
        },
        onError: (e) => {
          if (e instanceof ApiError && e.code === 'rebalancing_negative') {
            setNegative({ body, problems: negativeProblems(e.body) });
            return;
          }
          // No answer is not a refusal: the same lines sent again keep their key and can never be recorded twice.
          setError(e instanceof RequestTimeout ? t('agent.rebalance.maybeSaved') : toAgentError(e).body);
        },
      },
    );
  };

  const save = () => {
    setTried(true);
    if (!check.ok) return;
    send(check.body, false);
  };

  const balance = check.balance;
  const chosenLine = (shown ?? []).find((l) => l.id === choosing) ?? null;

  return (
    <Screen scroll gap="lg">
      <Stack.Screen options={{ title }} />
      <Text variant="body" tone="secondary">
        {t('agent.rebalance.explain')}
      </Text>
      {!online ? <InlineNotice tone="warning">{t('agent.rebalance.offline')}</InlineNotice> : null}
      {!access.canWrite ? <InlineNotice tone="warning">{t('access.blocked.body')}</InlineNotice> : null}

      <Section title={t('agent.rebalance.reason')} gap="sm">
        <TextField
          accessibilityLabel={t('agent.rebalance.reason')}
          placeholder={t('agent.rebalance.reason.placeholder')}
          value={reason}
          onChangeText={setReason}
          maxLength={REBALANCING_REASON_MAX}
          error={tried && !reason.trim() ? t('agent.rebalance.problem.reason_missing') : undefined}
        />
        <View style={styles.wrap}>
          {REASONS.map((r) => {
            const words = t(`agent.rebalance.reasons.${r}` as TranslationKey);
            return <FilterChip key={r} label={words} selected={reason === words} onPress={() => setReason(words)} />;
          })}
        </View>
      </Section>

      <Section title={t('agent.rebalance.lines')} gap="sm">
        {shown === null ? (
          <SkeletonList count={2} />
        ) : (
          shown.map((line, i) => (
            <LineCard
              key={line.id}
              index={i}
              line={line}
              name={nameOf(accountKeyOf(line))}
              removable={shown.length > 1}
              onChoose={() => setChoosing(line.id)}
              onDirection={(direction) => update(line.id, { direction })}
              onAmount={(amount) => typeAmount(line.id, amount)}
              onRemove={() => edit(shown.filter((l) => l.id !== line.id))}
            />
          ))
        )}
        {shown !== null ? (
          <Button
            title={t('agent.rebalance.addLine')}
            icon={Plus}
            variant="tertiary"
            size="sm"
            onPress={() => edit([...shown, { id: uuidv4(), account: 'cash', providerId: null, direction: balance.net > 0 ? 'outflow' : 'inflow', amount: '' }])}
          />
        ) : null}
      </Section>

      {/* The balance rule, in view: in equals out, or the outside is named for exactly the difference. */}
      <Card style={styles.card} testID="rebalance-balance">
        <View style={[AMOUNT_ROW, styles.line]}>
          <View style={AMOUNT_LABEL}>
            <Text variant="body" tone="secondary">
              {t('agent.rebalance.totalIn')}
            </Text>
          </View>
          <MoneyValue value={balance.inflows} size="small" />
        </View>
        <View style={[AMOUNT_ROW, styles.line]}>
          <View style={AMOUNT_LABEL}>
            <Text variant="body" tone="secondary">
              {t('agent.rebalance.totalOut')}
            </Text>
          </View>
          <MoneyValue value={balance.outflows} size="small" />
        </View>
        <Divider />
        {balance.net === 0 ? (
          <Text variant="bodyStrong" tone={balance.complete ? 'success' : 'secondary'}>
            {balance.complete ? t('agent.rebalance.balanced') : t('agent.rebalance.waiting')}
          </Text>
        ) : (
          <>
            <Text variant="bodyStrong" tone="warning">
              {balance.net > 0 ? t('agent.rebalance.moreIn', { amount: money(balance.net) }) : t('agent.rebalance.moreOut', { amount: money(-balance.net) })}
            </Text>
            <Text variant="caption" tone="secondary">
              {balance.net > 0 ? t('agent.rebalance.outside.from') : t('agent.rebalance.outside.to')}
            </Text>
            <View style={styles.wrap}>
              {EXTERNAL_COUNTERPARTIES.map((c) => (
                <FilterChip key={c} label={t(`agent.rebalance.outside.${c}` as TranslationKey)} selected={external === c} onPress={() => setExternal(c)} />
              ))}
            </View>
            {external ? (
              <Text variant="caption" tone="tertiary">
                {t(balance.net > 0 ? 'agent.rebalance.outside.cameIn' : 'agent.rebalance.outside.wentOut', {
                  amount: money(Math.abs(balance.net)),
                  who: t(`agent.rebalance.outside.${external}` as TranslationKey),
                })}
              </Text>
            ) : null}
          </>
        )}
      </Card>

      <TextField label={t('agent.rebalance.note')} value={note} onChangeText={setNote} maxLength={REBALANCING_NOTE_MAX} multiline />

      {tried && !check.ok ? (
        <InlineNotice tone="warning" testID="rebalance-problems">
          {check.problems.map((p: RebalancingProblem) => t(`agent.rebalance.problem.${p}` as TranslationKey)).join('\n')}
        </InlineNotice>
      ) : null}

      {negative ? (
        <InlineNotice
          tone="warning"
          title={t('agent.rebalance.negative.title')}
          testID="rebalance-negative"
          action={
            isOwner ? (
              <Button title={t('agent.rebalance.negative.confirm')} variant="secondary" size="sm" wrap loading={record.isPending} disabled={!online || record.isPending} onPress={() => send(negative.body, true)} />
            ) : undefined
          }
        >
          {[
            ...negative.problems.map((p) => t('agent.rebalance.negative.line', { account: nameOf(p.account === 'cash' ? 'cash' : `${p.account}:${p.providerId}`), amount: money(p.after) })),
            isOwner ? t('agent.rebalance.negative.owner') : t('agent.rebalance.negative.notOwner'),
          ].join('\n')}
        </InlineNotice>
      ) : null}
      {error ? <InlineNotice tone="warning">{error}</InlineNotice> : null}

      <Button title={t('agent.rebalance.save')} icon={Scale} fullWidth loading={record.isPending && !negative} disabled={!online || !access.canWrite || record.isPending || shown === null} onPress={save} />

      <Section title={t('agent.rebalance.today')} gap="xs">
        {today.isPending ? (
          <SkeletonList count={1} />
        ) : (today.data?.rows ?? []).length === 0 ? (
          <Text variant="caption" tone="tertiary">
            {t('agent.rebalance.today.none')}
          </Text>
        ) : (
          (today.data?.rows ?? []).map((r) => <RecordedRebalancing key={r.id} row={r} labelOf={(id) => accounts.find((a) => a.providerId === id)?.label ?? ''} />)
        )}
      </Section>

      <SelectSheet<AccountChoice>
        open={chosenLine !== null}
        onClose={() => setChoosing(null)}
        title={t('agent.rebalance.account')}
        items={accounts}
        keyExtractor={(a) => a.key}
        labelExtractor={(a) => nameOf(a.key)}
        selectedKeys={chosenLine ? [accountKeyOf(chosenLine)] : []}
        searchable={false}
        onSelect={(a) => {
          if (chosenLine) update(chosenLine.id, { account: a.account, providerId: a.providerId });
          setChoosing(null);
        }}
      />
    </Screen>
  );
}

/** One line: which account, which way, how much. */
function LineCard({
  index,
  line,
  name,
  removable,
  onChoose,
  onDirection,
  onAmount,
  onRemove,
}: {
  index: number;
  line: RebalancingLine;
  name: string;
  removable: boolean;
  onChoose: () => void;
  onDirection: (direction: LegDirection) => void;
  onAmount: (amount: string) => void;
  onRemove: () => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  return (
    <Card style={styles.card} testID={`rebalance-line-${index}`}>
      <ListRow flat title={name} titleLines={0} subtitle={t('agent.rebalance.account')} onPress={onChoose} />
      <SegmentedControl<LegDirection>
        value={line.direction}
        onChange={onDirection}
        options={[
          { value: 'inflow', label: t('agent.rebalance.in') },
          { value: 'outflow', label: t('agent.rebalance.out') },
        ]}
      />
      <MoneyField accessibilityLabel={`${name}, ${t('agent.amount')}`} placeholder={t('agent.amount')} value={line.amount} onChangeText={onAmount} />
      {removable ? (
        <View style={styles.end}>
          <Button title={t('agent.rebalance.removeLine')} icon={Trash2} variant="tertiary" size="sm" onPress={onRemove} />
        </View>
      ) : null}
    </Card>
  );
}

/** A rebalancing the server recorded today: its reason, each leg in words, the outside party, who and when. */
function RecordedRebalancing({ row, labelOf }: { row: AgentRebalancing; labelOf: (providerId: string) => string }) {
  const styles = useStyles();
  const { t } = useTranslation();
  return (
    <Card style={styles.card}>
      <Text variant="bodyStrong">{row.reason}</Text>
      {row.legs
        .filter((l) => l.account !== 'external')
        .map((l, i) => (
          <View key={i} style={[AMOUNT_ROW, styles.line]}>
            <View style={AMOUNT_LABEL}>
              <Text variant="body">{t(legWordsKey(l) as TranslationKey, { provider: l.providerId ? labelOf(l.providerId) : '' })}</Text>
            </View>
            <MoneyValue value={l.direction === 'inflow' ? l.amount : -l.amount} size="small" signed tone="auto" />
          </View>
        ))}
      {row.externalCounterparty && row.externalAmount !== null ? (
        <Text variant="caption" tone="secondary">
          {t(row.externalAmount > 0 ? 'agent.rebalance.outside.cameIn' : 'agent.rebalance.outside.wentOut', {
            amount: isolateLtr(formatMoney(Math.abs(row.externalAmount))),
            who: t(`agent.rebalance.outside.${row.externalCounterparty}` as TranslationKey),
          })}
        </Text>
      ) : null}
      {row.note ? (
        <Text variant="caption" tone="secondary">
          {row.note}
        </Text>
      ) : null}
      <Text variant="caption" tone="tertiary">
        {`${row.recordedBy.name} · ${formatSmartDateTime(row.recordedAt)}`}
      </Text>
    </Card>
  );
}

const useStyles = makeStyles(() => ({
  card: { gap: space.sm },
  line: { minHeight: 28 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  end: { flexDirection: 'row', justifyContent: 'flex-end' },
}));
