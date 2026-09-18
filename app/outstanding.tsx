import React from 'react';
import { Pressable, View } from 'react-native';
import { Stack, useRouter, type Href } from 'expo-router';
import {
  Button,
  Card,
  EmptyState,
  InlineNotice,
  MoneyValue,
  Screen,
  Section,
  SkeletonList,
  StatusChip,
  Text,
} from '../components/ui';
import { space, touch } from '../lib/design/tokens';
import { makeStyles } from '../lib/design/theme';
import { formatDate, formatMoney } from '../lib/format';
import { useTranslation } from '../lib/i18n';
import { useOutstanding, type OutstandingDebtor } from '../lib/money-overview';

/**
 * Who owes the shop money, and for what (0074).
 *
 * One list for customers and partner stores alike — "who owes us?" is one
 * question — largest balance first. Each debtor shows what they owe in total
 * and since when, then the sales it comes from; a sale opens its detail, where
 * the payment is recorded.
 *
 * Every figure is the server's: each is a sale's own `balance_due`, the same
 * number the sale and the Money overview show.
 */
export default function OutstandingScreen() {
  const styles = useStyles();
  const { t } = useTranslation();
  const query = useOutstanding();

  return (
    <Screen scroll gap="lg" onRefresh={() => void query.refetch()} refreshing={query.isRefetching}>
      <Stack.Screen options={{ headerShown: true, title: t('outstanding.title') }} />

      {query.isPending ? (
        <SkeletonList count={4} />
      ) : query.isError ? (
        <InlineNotice
          tone="warning"
          action={<Button title={t('action.retry')} variant="tertiary" size="sm" onPress={() => void query.refetch()} />}
        >
          {t('outstanding.unavailable')}
        </InlineNotice>
      ) : query.data.debtors.length === 0 ? (
        <EmptyState title={t('outstanding.none')} />
      ) : (
        <>
          <Card style={styles.total}>
            <Text variant="body" tone="secondary">
              {t('outstanding.total')}
            </Text>
            <MoneyValue value={query.data.total} size="display" />
            <Text variant="caption" tone="secondary">
              {t('outstanding.count', { count: String(query.data.sales) })}
            </Text>
          </Card>
          {query.data.debtors.map((d) => (
            <DebtorCard key={`${d.kind}:${d.id ?? ''}`} debtor={d} />
          ))}
        </>
      )}
    </Screen>
  );
}

function DebtorCard({ debtor: d }: { debtor: OutstandingDebtor }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <Section gap="xs">
      <Card style={styles.debtor}>
        <View style={styles.head}>
          <View style={styles.grow}>
            <Text variant="bodyStrong">{d.name ?? t('outstanding.kind.unknown')}</Text>
            <Text variant="caption" tone="secondary">
              {[t(`outstanding.kind.${d.kind}` as never), d.phone].filter(Boolean).join(' · ')}
            </Text>
            <Text variant="caption" tone="tertiary">
              {t('outstanding.since', { date: formatDate(d.oldest) })}
            </Text>
          </View>
          <MoneyValue value={d.owed} />
        </View>
        {d.sales.map((s) => (
          <Pressable
            key={s.id}
            accessibilityRole="button"
            accessibilityLabel={`${s.product ?? s.invoiceNo}, ${formatMoney(s.remaining)}`}
            onPress={() => router.push(`/sales/${s.id}` as Href)}
            style={({ pressed }) => [styles.sale, pressed && styles.pressed]}
          >
            <View style={styles.grow}>
              <Text variant="body">{s.product ?? t('saleRow.noProduct', { invoice: s.invoiceNo })}</Text>
              <Text variant="caption" tone="secondary">
                {formatDate(s.soldAt)} · {t('saleRow.received', { amount: formatMoney(s.received) })}
              </Text>
              <View style={styles.chip}>
                <StatusChip domain="sale" value={s.payStatus} size="sm" />
              </View>
            </View>
            <Text variant="bodyStrong">{formatMoney(s.remaining)}</Text>
          </Pressable>
        ))}
      </Card>
    </Section>
  );
}

const useStyles = makeStyles((colors) => ({
  total: { gap: space.xs },
  debtor: { gap: space.xs },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  grow: { flex: 1, gap: 2 },
  sale: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: touch.min,
    paddingVertical: space.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
  },
  pressed: { opacity: 0.6 },
  chip: { flexDirection: 'row', paddingTop: 2 },
}));
