import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import {
  Button,
  Card,
  FilterChip,
  InlineNotice,
  MoneyField,
  Screen,
  Section,
  SegmentedControl,
  Text,
  TextField,
} from '../../components/ui';
import { ApiError } from '../../lib/api-client';
import { useBranch } from '../../lib/branch';
import { space } from '../../lib/design/tokens';
import { useTranslation } from '../../lib/i18n';
import { useDraft } from '../../lib/offline/use-draft';
import { DraftNotice } from '../../components/DraftNotice';
import { useAssignableTeam } from '../../lib/closing';
import { thisMonth, useCreateGoal, type GoalMetric, type GoalScope } from '../../lib/goals';

/**
 * Setting a target (Milestone F).
 *
 * Defaults to the branch, this month, gross profit — the goal a shop actually
 * sets, pre-filled, so the common case is a number and a tap. Every other
 * combination is still reachable, which is the whole point of a smart default
 * rather than a fixed one.
 */
export default function NewGoalScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const branchId = useBranch((s) => s.branchId);
  const create = useCreateGoal();
  const team = useAssignableTeam();

  const month = thisMonth();
  const [scope, setScope] = useState<GoalScope>('branch');
  const [metric, setMetric] = useState<GoalMetric>('gross_profit');
  const [personId, setPersonId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  /** The target being drafted survives an app kill (J.1). */
  const draft = useDraft('goal.form', { scope, metric, personId, amount, note }, (v) => {
    setScope(v.scope ?? 'branch');
    setMetric(v.metric ?? 'gross_profit');
    setPersonId(v.personId ?? null);
    setAmount(v.amount ?? '');
    setNote(v.note ?? '');
  });

  const isMoney = metric === 'gross_profit' || metric === 'revenue';
  const canSubmit =
    amount.trim() !== '' && Number(amount) > 0 && (scope !== 'user' || personId !== null);

  return (
    <Screen gap="base">
      <Stack.Screen options={{ headerShown: true, title: t('goals.set.title') }} />

      <DraftNotice draft={draft} onDiscard={() => { setAmount(''); setNote(''); }} />
      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}

      <Section title={t('goals.set.who')}>
        <Card style={styles.block}>
          <SegmentedControl
            options={[
              { value: 'branch', label: t('goals.scope.branch') },
              { value: 'user', label: t('goals.scope.user') },
              { value: 'company', label: t('goals.scope.company') },
            ]}
            value={scope}
            onChange={(v) => {
              setScope(v as GoalScope);
              if (v !== 'user') setPersonId(null);
            }}
          />

          {scope === 'user' ? (
            <View style={styles.chips}>
              {(team.data ?? []).map((m) => (
                <FilterChip
                  key={m.id}
                  label={m.name}
                  selected={personId === m.id}
                  onPress={() => setPersonId(personId === m.id ? null : m.id)}
                />
              ))}
            </View>
          ) : null}
        </Card>
      </Section>

      <Section title={t('goals.set.what')}>
        <Card style={styles.block}>
          <SegmentedControl
            options={[
              { value: 'gross_profit', label: t('goals.metric.gross_profit') },
              { value: 'revenue', label: t('goals.metric.revenue') },
              { value: 'sales_count', label: t('goals.metric.sales_count') },
              { value: 'units_sold', label: t('goals.metric.units_sold') },
            ]}
            value={metric}
            onChange={(v) => setMetric(v as GoalMetric)}
          />
          {/*
            Said plainly rather than left to be discovered. Somebody choosing
            between "money kept" and "money taken" is choosing between two very
            different targets.
          */}
          <Text variant="caption" tone="secondary">
            {t(`goals.metric.${metric}.help`)}
          </Text>
        </Card>
      </Section>

      <Section title={t('goals.set.howMuch')}>
        <Card style={styles.block}>
          {isMoney ? (
            <MoneyField label={t('goals.target')} value={amount} onChangeText={setAmount} />
          ) : (
            <TextField
              label={t('goals.target')}
              value={amount}
              onChangeText={setAmount}
              keyboardType="number-pad"
            />
          )}
          <Text variant="caption" tone="secondary">
            {t('goals.set.period', { from: month.periodStart, to: month.periodEnd })}
          </Text>
          <TextField
            label={t('goals.set.note')}
            value={note}
            onChangeText={setNote}
            placeholder={t('goals.set.notePlaceholder')}
          />
        </Card>
      </Section>

      <Button
        title={t('goals.set.action')}
        fullWidth
        disabled={!canSubmit || create.isPending}
        onPress={() => {
          setError(null);
          create.mutate(
            {
              scope,
              // A company goal deliberately carries no branch: it is the whole
              // business, and the server refuses one that names a branch.
              branchId: scope === 'company' ? undefined : (branchId ?? undefined),
              targetUserId: scope === 'user' ? (personId as string) : undefined,
              metric,
              periodStart: month.periodStart,
              periodEnd: month.periodEnd,
              periodLabel: 'monthly',
              targetAmount: Number(amount),
              note: note.trim() || undefined,
            },
            {
              onSuccess: () => {
                draft.clear();
                router.back();
              },
              onError: (e) => setError(e instanceof ApiError ? e.message : t('goals.set.failed')),
            },
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.base },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
