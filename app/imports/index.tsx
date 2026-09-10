import React, { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { FileSpreadsheet, Upload } from 'lucide-react-native';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  InlineNotice,
  ListRow,
  Screen,
  Section,
  SkeletonList,
  Text,
} from '../../components/ui';
import { ApiError } from '../../lib/api-client';
import { space } from '../../lib/design/tokens';
import { useTranslation } from '../../lib/i18n';
import { useImports, usePreviewImport, type ImportSummary } from '../../lib/imports';

/**
 * Bringing a stock list in (Milestone G).
 *
 * The first screen a shop with an existing spreadsheet ever needs, and the one
 * that decides whether they adopt the app at all — typing four hundred phones
 * by hand is not something anybody does twice.
 *
 * Picking a file does NOT import anything. It produces a preview, and the
 * wording here says so before the picker opens, because "I selected the file
 * and it imported everything" is the mistake this flow exists to prevent.
 */
export default function ImportsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const query = useImports();
  const preview = usePreviewImport();
  const [error, setError] = useState<string | null>(null);

  const pick = async () => {
    setError(null);
    const picked = await DocumentPicker.getDocumentAsync({
      type: [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/csv',
        'text/comma-separated-values',
        // Some Android file providers report a spreadsheet as generic binary,
        // and excluding it would make the shop's own file unpickable.
        'application/octet-stream',
      ],
      copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets?.[0]) return;

    const asset = picked.assets[0];
    preview.mutate(
      { uri: asset.uri, name: asset.name, mimeType: asset.mimeType },
      {
        onSuccess: (batch) => router.push(`/imports/${batch.id}` as never),
        onError: (e) => setError(e instanceof ApiError ? e.message : t('imports.failed')),
      },
    );
  };

  const rows = query.data?.rows ?? [];

  return (
    <Screen scroll={false}>
      <Stack.Screen options={{ headerShown: true, title: t('imports.title') }} />

      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}

      <Section title={t('imports.start')}>
        <Card style={styles.intro}>
          {/*
            Said before the picker opens, not after. "I picked the file and it
            imported everything" is exactly the misunderstanding this flow
            exists to prevent.
          */}
          <Text variant="body">{t('imports.intro')}</Text>
          <Text variant="caption" tone="secondary">
            {t('imports.columns')}
          </Text>
          <Button
            title={t('imports.pick')}
            icon={Upload}
            fullWidth
            disabled={preview.isPending}
            onPress={() => void pick()}
          />
        </Card>
      </Section>

      <Section title={t('imports.recent')}>
        {query.isLoading ? (
          <SkeletonList count={3} />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState icon={FileSpreadsheet} title={t('imports.empty.title')} body={t('imports.empty.body')} />
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            {rows.map((r) => (
              <Row key={r.id} row={r} onPress={() => router.push(`/imports/${r.id}` as never)} />
            ))}
          </ScrollView>
        )}
      </Section>
    </Screen>
  );
}

function Row({ row, onPress }: { row: ImportSummary; onPress: () => void }) {
  const { t } = useTranslation();
  const tone =
    row.status === 'committed' ? 'success' : row.status === 'failed' ? 'danger' : 'warning';
  return (
    <ListRow
      leading={FileSpreadsheet}
      title={row.filename ?? t('imports.untitled')}
      subtitle={
        row.status === 'committed'
          ? t('imports.broughtIn', { count: String(row.imported) })
          : t('imports.rowsRead', { count: String(row.total) })
      }
      accessory={<Chip tone={tone} label={t(`imports.status.${row.status}`)} size="sm" dot />}
      onPress={onPress}
    />
  );
}

const styles = StyleSheet.create({
  intro: { gap: space.base },
  list: { paddingBottom: space['3xl'] },
});
