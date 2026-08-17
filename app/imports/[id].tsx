import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Check } from 'lucide-react-native';
import {
  Button,
  Card,
  Chip,
  Divider,
  ErrorState,
  InlineNotice,
  Screen,
  Section,
  SkeletonList,
  Text,
} from '../../components/ui';
import { ApiError } from '../../lib/api-client';
import { space } from '../../lib/design/tokens';
import { useTranslation } from '../../lib/i18n';
import { rowTone, useCommitImport, useImport, type ImportRow } from '../../lib/imports';

/**
 * What this file will do, before it does it (Milestone G).
 *
 * The screen leads with one sentence — "197 will be added, 3 cannot" — because
 * that is the only thing somebody needs in order to decide. Everything else is
 * the detail behind it.
 *
 * A row that cannot be imported is shown with the reason in plain words next to
 * the line number from the shop's own spreadsheet, so the fix happens in the
 * file rather than in a support conversation.
 */
export default function ImportDetailScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useImport(id);
  const commit = useCommitImport(id ?? '');
  const [error, setError] = useState<string | null>(null);

  if (query.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: t('imports.preview.title') }} />
        <SkeletonList count={4} />
      </Screen>
    );
  }
  if (query.isError || !query.data) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: t('imports.preview.title') }} />
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </Screen>
    );
  }

  const batch = query.data;
  const c = batch.counts;
  const done = batch.status === 'committed';
  const unreadable = batch.status === 'failed';

  return (
    <Screen scroll={false}>
      <Stack.Screen
        options={{ headerShown: true, title: batch.filename ?? t('imports.preview.title') }}
      />

      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}

      <ScrollView contentContainerStyle={styles.list}>
        {unreadable ? (
          <>
            <InlineNotice tone="danger">{t('imports.unreadable')}</InlineNotice>
            {/*
              Which columns were missing, not just that something was. A shop
              can fix a header; they cannot fix "invalid file".
            */}
            <Card style={styles.block}>
              {(batch.problems ?? []).map((p) => (
                <Text key={p.field} variant="body">
                  · {p.message}
                </Text>
              ))}
              <Text variant="caption" tone="secondary">
                {t('imports.columns')}
              </Text>
            </Card>
          </>
        ) : (
          <>
            {/* The one sentence somebody needs in order to decide. */}
            <InlineNotice tone={c.error > 0 ? 'warning' : 'success'}>
              {done
                ? t('imports.done', { count: String(c.imported) })
                : c.error > 0
                  ? t('imports.summary.mixed', {
                      willImport: String(c.willImport),
                      errors: String(c.error),
                    })
                  : t('imports.summary.clean', { willImport: String(c.willImport) })}
            </InlineNotice>

            <Card style={styles.counts}>
              <Count label={t('imports.count.total')} value={c.total} />
              <Count label={t('imports.count.willImport')} value={done ? c.imported : c.willImport} />
              <Count label={t('imports.count.warning')} value={c.warning} />
              <Count label={t('imports.count.error')} value={c.error} />
            </Card>

            {!done ? (
              <Button
                title={t('imports.commit', { count: String(c.willImport) })}
                icon={Check}
                fullWidth
                disabled={c.willImport === 0 || commit.isPending}
                onPress={() => {
                  setError(null);
                  commit.mutate(batch.version, {
                    onSuccess: () => router.replace(`/imports/${batch.id}` as never),
                    onError: (e) =>
                      setError(e instanceof ApiError ? e.message : t('imports.commit.failed')),
                  });
                }}
              />
            ) : null}

            <Section title={t('imports.rows')}>
              <Card>
                {batch.rows.map((r, i) => (
                  <View key={r.rowNumber}>
                    {i > 0 ? <Divider style={styles.divider} /> : null}
                    <RowLine row={r} />
                  </View>
                ))}
              </Card>
            </Section>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.count}>
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
      <Text variant="title">{String(value)}</Text>
    </View>
  );
}

function RowLine({ row }: { row: ImportRow }) {
  const { t } = useTranslation();
  const parsed = (row.parsed ?? {}) as { model?: string; brand?: string };
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        {/* The line number from the shop's own spreadsheet, so the fix happens
            in the file rather than in a support conversation. */}
        <Text variant="bodyStrong">
          {t('imports.line', { n: String(row.rowNumber) })}
          {row.identifier ? ` · ${row.identifier}` : ''}
        </Text>
        {parsed.model ? (
          <Text variant="caption" tone="secondary">
            {[parsed.brand, parsed.model].filter(Boolean).join(' ')}
          </Text>
        ) : null}
        {row.message ? (
          <Text variant="caption" tone="secondary">
            {row.message}
          </Text>
        ) : null}
      </View>
      <Chip tone={rowTone(row.status)} label={t(`imports.row.${row.status}`)} size="sm" dot />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.base, paddingBottom: space['3xl'] },
  block: { gap: space.sm },
  counts: { flexDirection: 'row', justifyContent: 'space-between' },
  count: { gap: 2 },
  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.sm, paddingVertical: space.xs },
  rowText: { flex: 1, gap: 2 },
  divider: { marginVertical: space.xs },
});
