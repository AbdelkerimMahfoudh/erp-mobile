import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ScanLine } from 'lucide-react-native';
import { space } from '../../lib/design/tokens';
import { useTranslation } from '../../lib/i18n';
import { BottomSheet } from '../overlay/BottomSheet';
import { ScannerSheet } from '../scanner/ScannerSheet';
import { Button } from '../ui/Button';
import { TextField } from '../ui/Field';
import { Text } from '../ui/Text';
import type { ReturnDetail } from '../../types/api';

/**
 * Recording that the shop physically has the phone.
 *
 * The identifier must be re-read from the device in front of the person, which
 * is the entire point: it is what proves the phone in the drawer is the phone
 * on the sale line. The server checks it against that exact unit and refuses
 * anything else.
 *
 * Scanning is offered first because it is faster and cannot be mistyped, but
 * typing is always available — the workflow must never require a camera.
 */
export function CustodySheet({
  open,
  onClose,
  detail,
  submitting,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  detail: ReturnDetail;
  submitting: boolean;
  onSubmit: (identifier: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [identifier, setIdentifier] = useState('');
  const [scanning, setScanning] = useState(false);

  // A half-typed identifier from a previous attempt must never carry into the
  // next one — it would be confirming a phone nobody just looked at.
  useEffect(() => {
    if (open) setIdentifier('');
  }, [open]);

  return (
    <>
      <BottomSheet open={open} onClose={onClose} title={t('returns.custody.confirm')}>
        <View style={styles.body}>
          <Text variant="body" tone="secondary">
            {t('returns.custody.body')}
          </Text>

          <Button
            title={t('returns.new.scan')}
            variant="secondary"
            icon={ScanLine}
            onPress={() => setScanning(true)}
          />

          <TextField
            label={t('returns.new.manualLabel')}
            value={identifier}
            onChangeText={setIdentifier}
            autoCapitalize="characters"
            autoCorrect={false}
            keyboardType="default"
          />

          <Button
            title={t('returns.custody.action')}
            disabled={identifier.trim().length === 0}
            loading={submitting}
            onPress={() => void onSubmit(identifier.trim())}
          />
        </View>
      </BottomSheet>

      <ScannerSheet
        open={scanning}
        onClose={() => setScanning(false)}
        // `onResult` carries the classifier's reading; `code` is the raw
        // identifier, which is what the server matches against the sale line.
        onResult={(result) => {
          setIdentifier(result.code);
          setScanning(false);
        }}
        hint={t('returns.new.scanHint')}
      />
    </>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.base, paddingBottom: space.base },
});
