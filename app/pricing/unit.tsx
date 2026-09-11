import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ScanLine, Trash2 } from 'lucide-react-native';
import {
  Button,
  Card,
  ErrorState,
  Identifier,
  Screen,
  Section,
  SkeletonList,
  TextField,
  Text,
} from '../../components/ui';
import { ScannerSheet } from '../../components/scanner';
import { PriceEditor, PriceSummary } from '../../components/pricing';
import { useBranch } from '../../lib/branch';
import { space } from '../../lib/design/tokens';
import { dialog } from '../../lib/dialog';
import { ApiError } from '../../lib/api-client';
import { toFriendlyError } from '../../lib/errors';
import { useTranslation } from '../../lib/i18n';
import { money } from '../../lib/theme';
import { toast } from '../../lib/toast';
import { isStaleEdit, usePricingUnit, useRemovePrice } from '../../lib/pricing';

/**
 * Price one exact phone.
 *
 * Deliberately a separate screen from the model's branch price: they are
 * different decisions with different blast radius, and a single screen with a
 * scope toggle is exactly how someone reprices every phone in the shop by
 * accident.
 *
 * The identifier comes from the phone itself — `*#06#` on the dialer shows the
 * IMEI, which is scanned from the screen. Scanning the box is not the preferred
 * route: boxes get separated from phones, and then the price follows the wrong
 * one. Manual entry is always available, for a phone that will not power on and
 * for a camera that will not focus.
 */
export default function UnitPricingScreen() {
  const { t } = useTranslation();
  const { branchName } = useBranch();
  useLocalSearchParams<{ productId?: string }>(); // arrived from a product; identity still comes from the scan

  const [identifier, setIdentifier] = useState('');
  const [typed, setTyped] = useState('');
  const [scanning, setScanning] = useState(false);
  const [editing, setEditing] = useState(false);

  const pricing = usePricingUnit(identifier || undefined);
  const remove = useRemovePrice();

  const confirmRemove = async () => {
    const current = pricing.data;
    if (!current || current.version === null) return;

    const ok = await dialog.confirm({
      title: t('pricing.remove.title'),
      message:
        current.fallback === null || current.fallback.price === null
          ? t('pricing.fallbackPreviewNone')
          : t('pricing.fallbackPreview', { price: money(current.fallback.price) }),
      confirmLabel: t('pricing.remove.confirm'),
      cancelLabel: t('action.cancel'),
      tone: 'danger',
    });
    if (!ok) return;

    try {
      await remove.mutateAsync({ scope: { kind: 'unit', identifier }, expectedVersion: current.version });
    } catch (error) {
      if (isStaleEdit(error)) {
        await dialog.alert({ title: t('pricing.conflict.title'), message: t('pricing.conflict.reload') });
        void pricing.refetch();
        return;
      }
      toast.error(toFriendlyError(error).body);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: t('pricing.unit.title') }} />

      <Section>
        <Card>
          <Text tone="secondary" style={styles.howTo}>
            {t('pricing.unit.howTo')}
          </Text>
          <View style={styles.actions}>
            <Button title={t('pricing.unit.scan')} icon={ScanLine} onPress={() => setScanning(true)} />
          </View>
        </Card>
      </Section>

      {/* Manual entry is not a fallback for failure; it is always available. */}
      <Section title={t('pricing.unit.manual')}>
        <Card>
          <TextField
            value={typed}
            onChangeText={setTyped}
            keyboardType="number-pad"
            autoCorrect={false}
            placeholder="356938035643809"
            onSubmitEditing={() => setIdentifier(typed.trim())}
            returnKeyType="search"
          />
          <View style={styles.actions}>
            <Button
              title={t('action.search')}
              variant="secondary"
              disabled={typed.trim().length === 0}
              onPress={() => setIdentifier(typed.trim())}
            />
          </View>
        </Card>
      </Section>

      {identifier ? <Result /> : null}

      <ScannerSheet
        open={scanning}
        onClose={() => setScanning(false)}
        hint={t('pricing.unit.howTo')}
        onResult={(result) => {
          const code = result.code ?? '';
          if (code) {
            setTyped(code);
            setIdentifier(code);
          }
          setScanning(false);
        }}
      />
    </Screen>
  );

  function Result() {
    if (pricing.isLoading) return <SkeletonList count={3} />;

    if (pricing.isError) {
      const status = pricing.error instanceof ApiError ? pricing.error.status : undefined;
      /**
       * 404 and 403 are answers about this identifier, not faults: the number
       * belongs to nothing, or to a phone in another branch. Offering Retry
       * would invite the user to keep asking a question already answered.
       */
      if (status === 404 || status === 403) {
        return (
          <Section>
            <Card>
              <Text tone="warning">
                {status === 404 ? t('pricing.unit.notFound') : t('pricing.unit.wrongBranch')}
              </Text>
            </Card>
          </Section>
        );
      }
      return (
        <Section>
          <ErrorState error={pricing.error} size="inline" onRetry={() => void pricing.refetch()} />
        </Section>
      );
    }

    const current = pricing.data;
    if (!current) return null;

    return (
      <>
        <Section title={t('pricing.section')}>
          <View style={styles.stack}>
            <Card>
              {/*
                The full identifier is shown deliberately: the user is standing
                in front of the phone and must confirm this is the same one they
                scanned before changing its price.
              */}
              <Identifier>{identifier}</Identifier>
              <Text variant="caption" tone="tertiary" style={styles.howTo}>
                {current.source === 'unit_override'
                  ? t('pricing.unit.hasOverride')
                  : t('pricing.unit.noOverride')}
              </Text>
              {/*
                A phone that has left the shelf cannot be priced. Say so here
                rather than letting the user find out by being refused.
              */}
              {!current.canPrice ? (
                <Text tone="warning" style={styles.howTo}>
                  {t('pricing.unit.notPriceable', { status: current.status })}
                </Text>
              ) : null}
            </Card>

            <PriceSummary pricing={current} branchName={branchName ?? ''} />
          </View>
        </Section>

        <Section>
          <View style={styles.actions}>
            {current.canPrice ? (
              <Button title={t('pricing.action.setUnit')} onPress={() => setEditing(true)} />
            ) : null}
            {current.canRemove ? (
              <Button
                title={t('pricing.action.remove')}
                icon={Trash2}
                variant="tertiary"
                onPress={confirmRemove}
                loading={remove.isPending}
              />
            ) : null}
          </View>
        </Section>

        {editing ? (
          <PriceEditor
            open={editing}
            onClose={() => setEditing(false)}
            scope={{ kind: 'unit', identifier }}
            current={current}
            productLabel={identifier}
            branchName={branchName ?? ''}
            onSaved={() => void pricing.refetch()}
          />
        ) : null}
      </>
    );
  }
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
  actions: { gap: space.sm, marginTop: space.md },
  howTo: {},
});
