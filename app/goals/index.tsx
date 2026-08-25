import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Plus, Target } from 'lucide-react-native';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  MoneyValue,
  Screen,
  SegmentedControl,
  SkeletonList,
  Text,
} from '../../components/ui';
import { radius, space } from '../../lib/design/tokens';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import { toneOf, useGoals, type Goal } from '../../lib/goals';
import { makeStyles } from '../../lib/design/theme';

/**
 * What the shop is aiming at, and whether it is getting there (Milestone F).
 *
 * The screen answers one question per card — *am I on target* — in a word
 * before it shows a number. "62%" does not tell somebody whether that is good
 * on the 20th of the month; "behind, 128 a day to make it" does.
 *
 * Progress arrives computed from the server. Nothing is recalculated here: a
 * second definition of on-target in the client would drift from the one the
 * shop's own analytics use.
 */
export default function GoalsScreen() {
  const styles = useStyles();
  const { t } = useTranslation();
  const router = useRouter();
  const canManage = usePermission('goal.manage');
  const [showArchived, setShowArchived] = useState(false);

  const query = useGoals(showArchived);
  const rows = query.data?.rows ?? [];

  return (
    <Screen scroll={false}>
      <Stack.Screen options={{ headerShown: true, title: t('goals.title') }} />

      <View style={styles.controls}>
        <SegmentedControl
          options={[
            { value: 'active', label: t('goals.filter.active') },
            { value: 'all', label: t('goals.filter.all') },
          ]}
          value={showArchived ? 'all' : 'active'}
          onChange={(v) => setShowArchived(v === 'all')}
        />
      </View>

      {query.isLoading ? (
        <SkeletonList count={3} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Target}
          title={t('goals.empty.title')}
          body={canManage ? t('goals.empty.body.manager') : t('goals.empty.body')}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {rows.map((g) => (
            <GoalCard key={g.id} goal={g} />
          ))}
        </ScrollView>
      )}

      {canManage ? (
        <View style={styles.actions}>
          <Button
            title={t('goals.set.action')}
            icon={Plus}
            fullWidth
            onPress={() => router.push('/goals/new' as never)}
          />
        </View>
      ) : null}
    </Screen>
  );
}

function GoalCard({ goal }: { goal: Goal }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const p = goal.progress;

  const who =
    goal.scope === 'user'
      ? (goal.targetUser?.name ?? t('goals.scope.user'))
      : t(`goals.scope.${goal.scope}`);

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <View style={styles.headText}>
          <Text variant="bodyStrong">{t(`goals.metric.${goal.metric}`)}</Text>
          <Text variant="caption" tone="secondary">
            {who} · {goal.periodStart} → {goal.periodEnd}
          </Text>
        </View>
        {/* The state in a word, always — colour never carries it alone. */}
        <Chip tone={toneOf(p.state)} label={t(`goals.state.${p.state}`)} size="sm" dot />
      </View>

      <View style={styles.figures}>
        <View style={styles.figure}>
          <Text variant="caption" tone="secondary">
            {t('goals.achieved')}
          </Text>
          {goal.isMoney ? (
            <MoneyValue value={p.achieved} />
          ) : (
            <Text variant="title">{String(p.achieved)}</Text>
          )}
        </View>
        <View style={styles.figure}>
          <Text variant="caption" tone="secondary">
            {t('goals.target')}
          </Text>
          {goal.isMoney ? (
            <MoneyValue value={p.target} size="small" />
          ) : (
            <Text variant="body">{String(p.target)}</Text>
          )}
        </View>
      </View>

      <ProgressBar percent={p.percent} state={p.state} />

      {/*
        The sentence that makes the number actionable. Which one shows depends
        on the state, because "128 a day to make it" is useless on a month that
        has already closed and misleading on one that has not begun.
      */}
      <Text variant="caption" tone="secondary">
        {p.state === 'met'
          ? t('goals.hint.met', { percent: String(Math.round(p.percent)) })
          : p.state === 'missed'
            ? t('goals.hint.missed', { percent: String(Math.round(p.percent)) })
            : p.state === 'not_started'
              ? t('goals.hint.notStarted', { days: String(p.daysTotal) })
              : t('goals.hint.running', {
                  needed: String(p.neededPerRemainingDay ?? 0),
                  days: String(p.daysRemaining),
                })}
      </Text>

      {goal.status === 'archived' && goal.archivedReason ? (
        <Text variant="caption" tone="secondary">
          {t('goals.archived.reason', { reason: goal.archivedReason })}
        </Text>
      ) : null}
    </Card>
  );
}

/**
 * A bar, capped visually at 100% while the figure above it stays uncapped.
 * Letting the fill overflow its track would just look broken; the "103%" beside
 * it is where the good news lives.
 */
function ProgressBar({ percent, state }: { percent: number; state: Goal['progress']['state'] }) {
  const styles = useStyles();
  const width = Math.max(0, Math.min(100, percent));
  return (
    <View style={styles.track}>
      <View
        style={[
          styles.fill,
          { width: `${width}%` },
          state === 'met' ? styles.fillMet : state === 'behind' ? styles.fillBehind : null,
        ]}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  controls: { paddingBottom: space.sm },
  list: { gap: space.base, paddingBottom: space['3xl'] },
  actions: { paddingTop: space.sm },
  card: { gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.sm },
  headText: { flex: 1, gap: 2 },
  figures: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  figure: { gap: 2 },
  // Tokens, not raw colour. The bar is the one place a screen is tempted to
  // invent a shade, and an invented one drifts from every chip beside it.
  track: { height: 6, borderRadius: radius.full, backgroundColor: colors.surface.sunken, overflow: 'hidden' },
  fill: { height: 6, borderRadius: radius.full, backgroundColor: colors.intent.info.solid },
  fillMet: { backgroundColor: colors.intent.success.solid },
  fillBehind: { backgroundColor: colors.intent.warning.solid },
}));
