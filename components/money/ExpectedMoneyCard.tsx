import React from 'react';
import { View } from 'react-native';
import { Wallet } from 'lucide-react-native';
import { Button, Card, MoneyValue, Text, THUMB_SIZE } from '../ui';
import { AMOUNT_LABEL, AMOUNT_ROW } from '../../lib/design/amount-row';
import { radius, space } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';
import { useTranslation } from '../../lib/i18n';
import type { TrackedMethod, TrackedMoney } from '../../lib/money-overview';

/**
 * Money's top card (docs/63): the money expected in the store today, in one
 * place — one large figure, the server's, and one short line per method: the
 * shop's cash, then each configured account.
 *
 * Every figure is what the app tracks — an amount known at one moment plus what
 * was recorded after it — never a bank's or a wallet's balance, which the app
 * does not see, and never presented as checked. A method the records cannot
 * establish reads Unknown, never 0, and then there is no total at all: the card
 * names what is missing. The accounts are the company's, so only the Owner sees
 * them; anybody else gets the drawer alone, as its own figure.
 *
 * When the shop was opened by somebody other than the Owner, with the amounts
 * carried forward, the card says so until the Owner reviews them — and offers
 * the Owner that review.
 */
export interface ExpectedMoneyCardProps {
  held: TrackedMoney;
  /** The Owner, who may review a carried opening's amounts. */
  canReview: boolean;
  onReview: () => void;
}

export function ExpectedMoneyCard({ held, canReview, onReview }: ExpectedMoneyCardProps) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const cash = held.methods.find((m) => m.channel === 'cash') ?? null;
  // The server's total; for anybody but the Owner, the drawer's own figure — the phone adds nothing up.
  const figure = held.accountsVisible ? held.total : (cash?.position ?? null);
  const unknown = held.methods.filter((m) => !m.known);
  // Whole units, unless a figure carries cents: then every figure on the card shows them, so the lines visibly add up.
  const decimals = [figure, ...held.methods.map((m) => m.position)].some((v) => v !== null && Math.round(v * 100) % 100 !== 0) ? 2 : 0;
  const awaiting = cash?.anchor?.awaitingOwnerReview === true;
  const name = (m: TrackedMethod) =>
    m.channel === 'cash' ? t('moneyTab.cash') : m.scope === 'company' && held.branchCount > 1 ? `${m.label} ${t('moneyTab.held.wholeBusiness')}` : m.label;

  return (
    <Card variant="accent" style={styles.card}>
      <View style={styles.head}>
        <View style={styles.icon}>
          <Wallet color={colors.text.accent} size={22} />
        </View>
        <Text variant="body" tone="secondary" style={styles.grow}>
          {t('moneyTab.expected.title')}
        </Text>
      </View>

      <View style={styles.total}>
        {figure !== null ? (
          <MoneyValue value={figure} size="display" signed={figure < 0} decimals={decimals} />
        ) : (
          <Text variant="bodyStrong">{t('moneyTab.expected.unknown', { names: unknown.map(name).join(' · ') })}</Text>
        )}
        {!held.accountsVisible ? (
          <Text variant="caption" tone="tertiary">
            {t('moneyTab.held.ownerOnly')}
          </Text>
        ) : null}
      </View>

      <View style={styles.lines}>
        {held.methods.map((m) => (
          <View key={m.key} style={[AMOUNT_ROW, styles.line]}>
            <View style={AMOUNT_LABEL}>
              <Text variant="body">{name(m)}</Text>
            </View>
            {m.position !== null ? (
              <MoneyValue value={m.position} size="small" signed={m.position < 0} decimals={decimals} />
            ) : (
              <Text variant="bodyStrong" tone="secondary">
                {t('moneyTab.held.unknown')}
              </Text>
            )}
          </View>
        ))}
      </View>

      {awaiting ? (
        <View style={styles.awaiting}>
          <Text variant="caption" tone="warning">
            {t('moneyTab.expected.awaiting')}
          </Text>
          {canReview ? (
            <View style={styles.row}>
              <Button title={t('moneyTab.expected.review')} variant="secondary" size="sm" wrap onPress={onReview} />
            </View>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

const useStyles = makeStyles((colors) => ({
  card: { gap: space.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  icon: {
    width: THUMB_SIZE.md,
    height: THUMB_SIZE.md,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface.card,
  },
  grow: { flex: 1, minWidth: 0 },
  total: { gap: 2 },
  lines: { gap: space.xs },
  line: { minHeight: 32 },
  awaiting: { gap: space.sm, borderTopWidth: 1, borderTopColor: colors.border.subtle, paddingTop: space.sm },
  row: { flexDirection: 'row' },
}));
