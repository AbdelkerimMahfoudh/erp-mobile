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
import { useBranch } from '../../lib/branch';
import { useFileBatch } from '../../lib/file-batch-store';
import { parseFailureKey, useParseReceivingFile, type ParseResult, type PickedFile } from '../../lib/file-receiving';

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
  /** Stock is received into a branch, and the server resolves permissions per branch. */
  const branchId = useBranch((s) => s.branchId);
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [result, setResult] = useState<ParseResult | null>(null);
  /** The message to show, and what to do again if the person taps Try again. */
  const [error, setError] = useState<{ message: string; retry: () => void } | null>(null);

  const read = (file: PickedFile, sheet?: string) => {
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
        onError: (e) => {
          const status = e instanceof ApiError ? e.status : null;
          const code = e instanceof ApiError ? e.code : null;
          if (__DEV__) {
            // The technical detail stays here, never on the shop's screen.
            console.warn('[receive/file] parse failed', {
              status,
              code,
              name: file.name,
              mimeType: file.mimeType,
              hasBytes: Boolean(file.file),
            });
          }
          setError({
            message: t(!branchId ? 'fileReceive.error.noBranch' : parseFailureKey(status, code)),
            retry: () => read(file, sheet),
          });
        },
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
    const file = {
      uri: asset.uri,
      name: asset.name,
      mimeType: asset.mimeType,
      // What the picker says it weighs, so the cached copy can be compared.
      size: asset.size,
      file: (asset as { file?: unknown }).file,
    };
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
          {!branchId ? <InlineNotice tone="info">{t('branch.select.title')}</InlineNotice> : null}
          <Button
            title={t('fileReceive.pick.action')}
            icon={Upload}
            fullWidth
            disabled={parse.isPending || !branchId}
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

      {error ? (
        <InlineNotice
          tone="danger"
          action={<Button title={t('action.retry')} variant="ghost" onPress={error.retry} />}
        >
          {error.message}
        </InlineNotice>
      ) : null}

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
