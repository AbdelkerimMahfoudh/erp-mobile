import React, { useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ScanLine } from 'lucide-react-native';
import {
  Button,
  Card,
  EmptyState,
  Identifier,
  Screen,
  SegmentedControl,
  Text,
  TextField,
} from '../../components/ui';
import { ScannerSheet } from '../../components/scanner';
import { ApiError } from '../../lib/api-client';
import { space } from '../../lib/design/tokens';
import { dialog } from '../../lib/dialog';
import { formatDateTime } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import { useCreateReturn } from '../../lib/returns';
import { useSales } from '../../lib/sales';
import { toast } from '../../lib/toast';
import { uuidv4 } from '../../lib/utils';

/**
 * Raising a return.
 *
 * Reached two ways — from a sale, or by reading the phone itself — and both
 * land in the SAME form, because the information a return needs does not depend
 * on how it was started.
 *
 * The identifier is read from the device (dial `*#06#`), not the box: a box can
 * be swapped, and the whole custody model rests on the physical phone being the
 * one on the sale line. The server enforces that; this screen just asks for it.
 */
export default function NewReturnScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const canRequest = usePermission('return.request');
  const params = useLocalSearchParams<{ saleItemId?: string; identifier?: string; product?: string }>();

  const [identifier, setIdentifier] = useState(params.identifier ?? '');
  const [scanning, setScanning] = useState(false);
  const [searched, setSearched] = useState(false);

  const [reason, setReason] = useState('');
  const [conditionNotes, setConditionNotes] = useState('');
  const [custody, setCustody] = useState<'customer_holds' | 'store_holds'>('customer_holds');

  /**
   * ONE key per logical request, reused across every retry. A flaky connection
   * must never turn one customer complaint into two claims.
   */
  const clientUuid = useRef(uuidv4());
  const create = useCreateReturn();

  // Finding the sale by identifier reuses the Sales search that already exists
  // and is already server-side — no second lookup path to keep in step.
  const found = useSales({ search: identifier.trim() });

  if (!canRequest) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: t('returns.new.title') }} />
        <EmptyState title={t('returns.forbidden')} body={t('returns.forbiddenBody')} />
      </Screen>
    );
  }

  const saleItemId = params.saleItemId;
  const ready = Boolean(saleItemId) && identifier.trim().length > 0 && reason.trim().length > 0;

  const search = () => {
    setSearched(true);
    void found.refetch();
  };

  const submit = async () => {
    if (!saleItemId) return;
    try {
      const detail = await create.mutateAsync({
        saleItemId,
        identifier: identifier.trim(),
        requestReason: reason.trim(),
        conditionNotes: conditionNotes.trim() || undefined,
        custody,
        clientUuid: clientUuid.current,
      });
      router.replace(`/returns/${detail.id}` as never);
    } catch (e) {
      /**
       * A 409 here is one of two things, and neither is retryable: the same key
       * carrying different content, or a return already open for this phone.
       * The server has already decided; say so rather than trying again.
       */
      if (e instanceof ApiError && e.status === 409) {
        toast.warning(t('returns.new.existing'), { description: t('returns.new.existingBody') });
        return;
      }
      throw e;
    }
  };

  const confirmDiscard = async () => {
    if (!reason.trim() && !conditionNotes.trim()) return true;
    return dialog.confirm({
      title: t('returns.new.discard'),
      message: t('returns.new.discardBody'),
      tone: 'danger',
    });
  };

  const rows = found.data?.pages.flatMap((p) => p.rows) ?? [];

  return (
    <Screen scroll={false}>
      <Stack.Screen options={{ headerShown: true, title: t('returns.new.title') }} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Entry by phone, when the customer arrives without a receipt. */}
        {!params.saleItemId ? (
          <Card>
            <Text variant="label" tone="secondary">
              {t('returns.new.scanHint')}
            </Text>
            <Button
              title={t('returns.new.scan')}
              variant="secondary"
              icon={ScanLine}
              onPress={() => setScanning(true)}
              style={styles.spaced}
            />
            <TextField
              label={t('returns.new.manualLabel')}
              value={identifier}
              onChangeText={(v) => {
                setIdentifier(v);
                setSearched(false);
              }}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <Button
              title={t('returns.new.find')}
              variant="tertiary"
              disabled={identifier.trim().length === 0}
              loading={found.isFetching}
              onPress={search}
              style={styles.spaced}
            />

            {searched && !found.isFetching && rows.length === 0 ? (
              <View style={styles.spaced}>
                <Text variant="bodyStrong">{t('returns.new.notFound')}</Text>
                <Text variant="caption" tone="secondary">
                  {t('returns.new.notFoundBody')}
                </Text>
              </View>
            ) : null}

            {searched && rows.length > 0 ? (
              <View style={styles.spaced}>
                <Text variant="caption" tone="secondary">
                  {t('sales.invoice', { no: rows[0]!.invoiceNo })} ·{' '}
                  {formatDateTime(new Date(rows[0]!.soldAt))}
                </Text>
                <Text variant="caption" tone="tertiary">
                  {t('returns.new.notFoundBody')}
                </Text>
              </View>
            ) : null}
          </Card>
        ) : (
          <Card>
            <Text variant="bodyStrong">{params.product ?? ''}</Text>
            {identifier ? <Identifier>{identifier}</Identifier> : null}
          </Card>
        )}

        <TextField
          label={t('returns.new.reason')}
          hint={t('returns.new.reasonHint')}
          value={reason}
          onChangeText={setReason}
          required
          multiline
        />

        <TextField
          label={t('returns.new.condition')}
          hint={t('returns.new.conditionHint')}
          value={conditionNotes}
          onChangeText={setConditionNotes}
          multiline
        />

        <View style={styles.group}>
          <Text variant="label" tone="secondary">
            {t('returns.new.custody')}
          </Text>
          <SegmentedControl
            options={[
              { value: 'customer_holds', label: t('returns.new.custody.customer') },
              { value: 'store_holds', label: t('returns.new.custody.store') },
            ]}
            value={custody}
            onChange={(v) => setCustody(v as 'customer_holds' | 'store_holds')}
          />
          {/* Said up front: an approval cannot happen until the phone is here. */}
          {custody === 'customer_holds' ? (
            <Text variant="caption" tone="secondary">
              {t('returns.new.custodyWarning')}
            </Text>
          ) : null}
        </View>
      </ScrollView>

      <View style={styles.actions}>
        <Button
          title={t('returns.new.submit')}
          disabled={!ready}
          loading={create.isPending}
          onPress={() => void submit()}
        />
        <Button
          title={t('action.cancel')}
          variant="tertiary"
          onPress={async () => {
            if (await confirmDiscard()) router.back();
          }}
        />
      </View>

      <ScannerSheet
        open={scanning}
        onClose={() => setScanning(false)}
        onResult={(result) => {
          setIdentifier(result.code);
          setSearched(false);
          setScanning(false);
        }}
        hint={t('returns.new.scanHint')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.base, paddingBottom: space['5xl'], gap: space.base },
  group: { gap: space.sm },
  spaced: { marginTop: space.sm },
  actions: {
    position: 'absolute',
    left: space.base,
    right: space.base,
    bottom: space.base,
    gap: space.xs,
  },
});
