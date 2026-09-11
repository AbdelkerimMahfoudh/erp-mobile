import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  ArrowRightLeft,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Info,
  PackageCheck,
  PackagePlus,
  RotateCcw,
  ShoppingBag,
  Timer,
  Truck,
  Undo2,
  type LucideIcon,
} from 'lucide-react-native';
import { Button, Card, Text } from '../ui';
import { isolateLtr } from '../../lib/design/direction';
import { radius, space } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';
import { formatDate, formatTime } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import {
  groupHistory,
  roleKey,
  type HistoryIcon,
  type HistoryRun,
  type UnitHistoryEvent,
} from '../../lib/unit-history';

/**
 * A phone's activity, newest first — in the Stock screen's visual language.
 *
 * One white card per day, headed "Today", "Yesterday" or the date. Each row is
 * a meaning in words, with an icon and a tone that fit it, who did it and when.
 * Identical consecutive entries fold into one row with a count that opens to
 * list each one: every audit entry stays reachable, none is hidden or merged.
 *
 * All wording comes from `lib/unit-history.ts`. Nothing here reads an event
 * code.
 */

const ICONS: Record<HistoryIcon, LucideIcon> = {
  received: PackagePlus,
  sold: ShoppingBag,
  reserved: Timer,
  sent: Truck,
  arrived: PackageCheck,
  undo: Undo2,
  returned: RotateCcw,
  faulty: CircleAlert,
  change: ArrowRightLeft,
  updated: Info,
};

/**
 * Rows shown before "Show N more". A phone with years of history, or one a test
 * script cycled through a flow many times, must not bury the item summary
 * under a page of entries. Nothing is removed: the rest is one tap away.
 */
const INITIAL_ROWS = 8;

export function ActivityTimeline({ events }: { events: UnitHistoryEvent[] }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const allDays = groupHistory(events);

  const totalRows = allDays.reduce((n, day) => n + day.runs.length, 0);
  const hiddenEvents = allDays
    .flatMap((day) => day.runs)
    .slice(INITIAL_ROWS)
    .reduce((n, run) => n + run.entries.length, 0);

  // Rows before each day, so every day knows how much of the budget is left
  // without a variable being reassigned during render.
  const rowsBefore = allDays.map((_, i) => allDays.slice(0, i).reduce((n, d) => n + d.runs.length, 0));
  const limit = showAll ? Number.POSITIVE_INFINITY : INITIAL_ROWS;
  const days = allDays
    .map((day, i) => ({ ...day, runs: day.runs.slice(0, Math.max(0, limit - rowsBefore[i])) }))
    .filter((day) => day.runs.length > 0);

  return (
    <View style={styles.days}>
      {days.map((day) => (
        <View key={day.day} style={styles.day}>
          <Text variant="label" tone="tertiary" accessibilityRole="header">
            {day.day === 'today'
              ? t('history.today')
              : day.day === 'yesterday'
                ? t('history.yesterday')
                : formatDate(`${day.day}T12:00:00`)}
          </Text>
          <Card padding="none">
            {day.runs.map((run, index) => (
              <RunRow key={run.lead.id ?? `${run.lead.at}-${index}`} run={run} last={index === day.runs.length - 1} />
            ))}
          </Card>
        </View>
      ))}
      {totalRows > INITIAL_ROWS ? (
        <Button
          title={showAll ? t('history.collapse') : t('history.more', { count: hiddenEvents })}
          variant="secondary"
          fullWidth
          onPress={() => setShowAll((v) => !v)}
        />
      ) : null}
    </View>
  );
}

function RunRow({ run, last }: { run: HistoryRun; last: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const { described } = run;
  const tone = colors.intent[described.tone];
  const Icon = ICONS[described.icon];
  const params = Object.fromEntries(
    Object.entries(described.params).map(([k, v]) => [k, k === 'from' || k === 'to' ? t(v as never) : v]),
  );
  const title = t(described.titleKey as never, params);
  const count = run.entries.length;

  const actor = run.lead.actor;
  const role = roleKey(actor?.role);
  const who = actor
    ? role
      ? t('history.byRole', { name: actor.name, role: t(role as never) })
      : t('history.byName', { name: actor.name })
    : t('history.system');
  const place = run.lead.branch?.name;
  const time = isolateLtr(formatTime(run.lead.at));

  const summary = [title, who, place, time, count > 1 ? t('history.repeat', { count }) : null].filter(Boolean).join(', ');

  return (
    <View style={[styles.row, !last ? styles.separated : null]}>
      <View
        style={[styles.icon, { backgroundColor: tone.bg }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Icon color={tone.fg} size={18} />
      </View>

      <View style={styles.body} accessible accessibilityLabel={summary}>
        <View style={styles.titleLine}>
          <Text variant="bodyStrong" style={styles.title}>
            {title}
          </Text>
          <Text variant="caption" tone="tertiary">
            {time}
          </Text>
        </View>
        <Text variant="caption" tone="secondary" numberOfLines={2}>
          {[who, place].filter(Boolean).join(' · ')}
        </Text>

        {count > 1 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            accessibilityLabel={open ? t('history.collapse') : t('history.expand')}
            onPress={() => setOpen((v) => !v)}
            hitSlop={8}
            style={styles.repeat}
          >
            <Text variant="caption" tone="accent">
              {t('history.repeat', { count })}
            </Text>
            {open ? <ChevronUp color={colors.text.accent} size={14} /> : <ChevronDown color={colors.text.accent} size={14} />}
          </Pressable>
        ) : null}

        {open
          ? run.entries.map((entry, i) => (
              <Text key={entry.id ?? `${entry.at}-${i}`} variant="caption" tone="tertiary">
                {isolateLtr(formatTime(entry.at))}
                {entry.actor ? ` · ${entry.actor.name}` : ''}
              </Text>
            ))
          : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  days: {
    gap: space.base,
  },
  day: {
    gap: space.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
  },
  separated: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.subtle,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  titleLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  title: {
    flex: 1,
  },
  repeat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingTop: space.xs,
    alignSelf: 'flex-start',
  },
}));
