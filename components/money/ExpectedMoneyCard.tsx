import React from 'react';
import { View } from 'react-native';
import { Wallet } from 'lucide-react-native';
import { Button, Card, MoneyValue, Text, THUMB_SIZE } from '../ui';
import { AMOUNT_LABEL, AMOUNT_ROW } from '../../lib/design/amount-row';
import { radius, space } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';
import { isolateLtr } from '../../lib/design/direction';
import { useTranslation } from '../../lib/i18n';
import { formatMoney } from '../../lib/money-format';
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
 *
 * An open boutique whose drawer is still unknown is not a state to live with
 * (the brief of 2026-10-06): the card says the opening amount was not set and,
 * for the Owner while the day is open, offers **Set today's opening cash** —
 * the same review sheet, which then asks for the amount alone. The server
 * records it as the day's figure from that instant; nothing is backdated.
 *
 * An account nobody ever recorded an amount for is unknown — and stays unknown
 * however much moved through it (the brief of 2026-10-07): a movement is never
 * turned into a balance. What moved is not hidden either: under such a row the
 * card says *Starting amount unknown · +20 000 MRU recorded today*, from the
 * server's own day figure. The Owner is offered **Set account amounts** — the
 * company-wide sheet, which says every shop will see the amount — so an unknown
 * account has a way out of the card itself.
 */
export interface ExpectedMoneyCardProps {
  held: TrackedMoney;
  /** The Owner, who may review a carried opening's amounts, or set an unknown drawer. */
  canReview: boolean;
  /** The business day is open: an unknown drawer can be set now, rather than at the opening. */
  dayOpen: boolean;
  onReview: () => void;
  /** The Owner's company-account sheet, offered while an account is unknown. */
  onSetAccounts?: () => void;
}

export function ExpectedMoneyCard({ held, canReview, dayOpen, onReview, onSetAccounts }: ExpectedMoneyCardProps) {
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
  const cashUnknown = cash !== null && !cash.known;
  const unknownAccounts = held.methods.filter((m) => m.channel === 'account' && !m.known);
  /** The day's net movement of an unknown method, as the server says it — never a balance. */
  const movedToday = (m: TrackedMethod): string | null => {
    const net = m.movement?.net ?? 0;
    if (m.known || net === 0) return null;
    const amount = `${net > 0 ? '+' : '−'}${formatMoney(Math.abs(net), { decimals })}`;
    return t('moneyTab.held.unknownMoved', { amount: isolateLtr(amount) });
  };
  const name = (m: TrackedMethod) =>
    m.channel === 'cash' ? t('moneyTab.cash') : m.scope === 'company' && held.branchCount > 1 ? `${m.label} ${t('moneyTab.held.wholeBusiness')}` : m.label;

  return (
    <Card variant="accent" style={styles.card}>
      <View style={styles.head}>
        <View style={styles.icon}>
          <Wallet color={colors.text.accent} size={22} />
        </View>
        <View style={styles.grow}>
          <Text variant="body" tone="secondary">
            {t('moneyTab.expected.title')}
          </Text>
          <Text variant="caption" tone="tertiary">
            {t('moneyTab.expected.explain')}
          </Text>
        </View>
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
          <View key={m.key} style={styles.method}>
            <View style={[AMOUNT_ROW, styles.line]}>
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
            {movedToday(m) ? (
              <Text variant="caption" tone="tertiary" testID={`moved-${m.key}`}>
                {movedToday(m)}
              </Text>
            ) : null}
          </View>
        ))}
        {unknownAccounts.length > 0 && canReview && onSetAccounts ? (
          <View style={styles.row}>
            <Button title={t('moneyTab.expected.setAccounts')} variant="secondary" size="sm" wrap onPress={onSetAccounts} />
          </View>
        ) : null}
      </View>

      {cashUnknown ? (
        <View style={styles.awaiting} testID="expected-cash-unknown">
          <Text variant="caption" tone="warning">
            {t('moneyTab.expected.cashUnknown')}
          </Text>
          {canReview && dayOpen ? (
            <View style={styles.row}>
              <Button title={t('moneyTab.expected.setCash')} variant="secondary" size="sm" wrap onPress={onReview} />
            </View>
          ) : null}
        </View>
      ) : awaiting ? (
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
  method: { gap: 2 },
  line: { minHeight: 32 },
  awaiting: { gap: space.sm, borderTopWidth: 1, borderTopColor: colors.border.subtle, paddingTop: space.sm },
  row: { flexDirection: 'row' },
}));
