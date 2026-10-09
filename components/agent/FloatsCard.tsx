import React from 'react';
import { View } from 'react-native';
import { Card, InlineNotice, MoneyValue, Text } from '../ui';
import { AMOUNT_LABEL, AMOUNT_ROW } from '../../lib/design/amount-row';
import { isolateLtr } from '../../lib/design/direction';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { formatDate, formatMoney } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import type { FloatView } from '../../lib/agent';
import type { PositionRow } from '../../lib/agent-positions';

/**
 * The drawer and the provider floats of one branch (docs/73 §4.4–4.5): one line
 * each — *Cash in the drawer*, *Bankily float*, *Commission held by Moov* — as
 * the server tracks it. Unknown stays Unknown, with what moved through it today
 * beside it (D152's card); a figure below zero is shown as one, with "more
 * recorded out than in". While this phone holds exchanges the server has not
 * accepted, the figures include them and the card says Provisional at the top.
 *
 * A float is the branch's stock of digital credit — never the company's
 * receiving account of the same provider, which Money shows apart (A9).
 *
 * Home shows it as the counter's glance; the positions screen with each
 * anchor; Money (the next step of checkpoint 4) beside the drawer.
 */
export function FloatsCard({
  rows,
  provisionalCount,
  anchors,
  footer,
}: {
  rows: PositionRow[];
  /** Exchanges this phone has not sent yet; 0 when every figure is the server's alone. */
  provisionalCount: number;
  /** The anchor behind each float, for the positions screen: who set or counted it, and when. */
  anchors?: Record<string, FloatView['anchor']>;
  footer?: React.ReactNode;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const decimals = rows.some((r) => r.position !== null && Math.round(r.position * 100) % 100 !== 0) ? 2 : 0;
  const name = (r: PositionRow) =>
    r.kind === 'cash' ? t('agent.positions.cash') : r.kind === 'provider' ? t('agent.positions.float', { provider: r.label }) : t('agent.positions.held', { provider: r.label });
  const moved = (r: PositionRow): string | null => {
    const net = r.movement?.net ?? 0;
    if (r.known || net === 0) return null;
    const amount = `${net > 0 ? '+' : '−'}${formatMoney(Math.abs(net), { decimals })}`;
    return t('moneyTab.held.unknownMoved', { amount: isolateLtr(amount) });
  };
  const anchorLine = (r: PositionRow): string | null => {
    const a = anchors?.[r.key];
    if (!a) return null;
    return a.source === 'counted_close'
      ? t('agent.positions.anchor.counted', { date: formatDate(a.businessDate), amount: isolateLtr(formatMoney(a.amount, { decimals })) })
      : t('agent.positions.anchor.set', { date: formatDate(a.businessDate), amount: isolateLtr(formatMoney(a.amount, { decimals })), name: a.byName ?? '' });
  };

  return (
    <Card style={styles.card}>
      {provisionalCount > 0 ? (
        <InlineNotice tone="info" title={t('agent.positions.provisional.title')} testID="positions-provisional">
          {t('agent.positions.provisional.body', { count: provisionalCount })}
        </InlineNotice>
      ) : null}
      {rows.map((r) => (
        <View key={r.key} style={styles.method} testID={`position-${r.key}`}>
          <View style={[AMOUNT_ROW, styles.line]}>
            <View style={AMOUNT_LABEL}>
              <Text variant="body">{name(r)}</Text>
            </View>
            {r.position !== null ? (
              <MoneyValue value={r.position} size="small" signed={r.position < 0} decimals={decimals} />
            ) : (
              <Text variant="bodyStrong" tone="secondary">
                {t('moneyTab.held.unknown')}
              </Text>
            )}
          </View>
          {r.position !== null && r.position < 0 ? (
            <Text variant="caption" tone="warning">
              {t('agent.positions.negative')}
            </Text>
          ) : null}
          {moved(r) ? (
            <Text variant="caption" tone="tertiary">
              {moved(r)}
            </Text>
          ) : null}
          {anchorLine(r) ? (
            <Text variant="caption" tone="tertiary">
              {anchorLine(r)}
            </Text>
          ) : null}
        </View>
      ))}
      {footer}
    </Card>
  );
}

const useStyles = makeStyles(() => ({
  card: { gap: space.sm },
  method: { gap: 2 },
  line: { minHeight: 32 },
}));
