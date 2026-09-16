import React, { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { FileSpreadsheet, Upload } from 'lucide-react-native';
import { Button, Card, InlineNotice, ListRow, RowGroup, Screen, Section, Text } from '../../components/ui';
import { ApiError } from '../../lib/api-client';
import { space } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';
import { useTranslation } from '../../lib/i18n';
import { useFileBatch } from '../../lib/file-batch-store';
import { useParseReceivingFile, type ParseResult } from '../../lib/file-receiving';

/**
 * Choosing the file, and choosing what inside it to read.
 *
 * Reading the file writes nothing at all — that is said before the picker opens,
 * because "I picked the file and it received everything" is exactly the
 * misunderstanding this step exists to prevent. When a workbook holds more than
 * one sheet the sheets are listed with what each one looks like, so the
 * instructions page is never mistaken for the stock.
 */
export default function PickReceivingFileScreen() {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const router = useRouter();
  const parse = useParseReceivingFile();
  const start = useFileBatch((s) => s.start);
  const [picked, setPicked] = useState<{ uri: string; name: string; mimeType?: string } | null>(null);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const read = (file: { uri: string; name: string; mimeType?: string }, sheet?: string) => {
    setError(null);
    parse.mutate(
      { ...file, sheet },
      {
        onSuccess: (parsed) => {
          setResult(parsed);
          // One sheet worth reading: go straight to the review.
          const choices = parsed.sheets.filter((s) => !s.looksExplanatory);
          if (sheet || choices.length <= 1) {
            start(parsed);
            router.replace('/receive/file' as never);
          }
        },
        onError: (e) => setError(e instanceof ApiError ? e.message : t('fileReceive.failed')),
      },
    );
  };

  const pick = async () => {
    setError(null);
    setResult(null);
    const chosen = await DocumentPicker.getDocumentAsync({
      type: [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/pdf',
        // Some Android providers report a workbook as generic binary; excluding
        // it would make the shop's own file unpickable.
        'application/octet-stream',
      ],
      copyToCacheDirectory: true,
    });
    if (chosen.canceled || !chosen.assets?.[0]) return;
    const asset = chosen.assets[0];
    const file = { uri: asset.uri, name: asset.name, mimeType: asset.mimeType };
    setPicked(file);
    read(file);
  };

  return (
    <Screen scroll>
      <Stack.Screen options={{ headerShown: true, title: t('receive.file.action') }} />

      <Section title={t('fileReceive.pick.title')}>
        <Card style={styles.card}>
          <Text variant="body">{t('fileReceive.pick.body')}</Text>
          <Text variant="caption" tone="secondary">
            {t('fileReceive.pick.columns')}
          </Text>
          <Text variant="caption" tone="tertiary">
            {t('fileReceive.pick.nothingYet')}
          </Text>
          <Button
            title={t('fileReceive.pick.action')}
            icon={Upload}
            fullWidth
            disabled={parse.isPending}
            onPress={() => void pick()}
          />
        </Card>
      </Section>

      {parse.isPending ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.brand[600]} />
          <Text variant="caption" tone="secondary">
            {t('fileReceive.reading')}
          </Text>
        </View>
      ) : null}

      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}

      {/* More than one sheet could be the stock: the person picks. */}
      {result && !parse.isPending && result.sheets.filter((s) => !s.looksExplanatory).length > 1 ? (
        <Section title={t('fileReceive.sheets.title')} subtitle={t('fileReceive.sheets.body')}>
          <RowGroup>
            {result.sheets.map((sheet) => (
              <ListRow
                key={sheet.name}
                flat
                leading={FileSpreadsheet}
                title={sheet.name}
                subtitle={
                  sheet.looksExplanatory
                    ? t('fileReceive.sheets.explanatory')
                    : t('fileReceive.sheets.rows', { count: String(sheet.rows) })
                }
                onPress={() => picked && read(picked, sheet.name)}
              />
            ))}
          </RowGroup>
        </Section>
      ) : null}
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  card: { gap: space.sm },
  loading: { alignItems: 'center', gap: space.xs, paddingVertical: space.lg },
}));
