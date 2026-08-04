import React, { useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from '../../lib/i18n';
import { toast } from '../../lib/toast';
import { SearchInput } from '../ui/SearchInput';
import { ScannerSheet } from './ScannerSheet';
import { useScan } from './useScan';
import type { ScanResult } from '../../types/api';

/**
 * The inline scan control screens embed.
 *
 * One field that accepts all three ways a code actually arrives in a shop:
 * the camera (tap the icon), a hardware wedge scanner (types then presses
 * Enter — very common at a fixed counter), and thumbs. All three land on the
 * same `/scan` pipeline, so recognition learns regardless of how the code
 * was captured.
 *
 * Screens own what happens to the `ScanResult`; this owns only getting one.
 */

export interface ScanTargetProps {
  onResult: (result: ScanResult) => void;
  /** Fires the moment a code is accepted, before recognition returns. */
  onCodeCaptured?: (code: string) => void;
  placeholder?: string;
  /** Keep the camera open across scans — for receiving a delivery. */
  mode?: 'single' | 'continuous';
  /** Tally shown inside the camera in continuous mode. */
  scannedCount?: number;
  autoFocus?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function ScanTarget({
  onResult,
  onCodeCaptured,
  placeholder,
  mode = 'single',
  scannedCount,
  autoFocus = false,
  style,
}: ScanTargetProps) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  // Errors surface as a toast: this control is a single line with no room for
  // an inline message, and a scan that silently does nothing is the worst
  // possible outcome at a counter — the employee scans again, and again.
  const { scan } = useScan({
    onResult,
    onCode: onCodeCaptured,
    onError: (message) => toast.error(message),
  });

  const submit = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    // Clear immediately so a wedge scanner's next code lands in an empty field.
    setCode('');
    await scan(trimmed);
  };

  return (
    <View style={style}>
      <SearchInput
        value={code}
        onChangeText={setCode}
        onSubmit={submit}
        onScanPress={() => setCameraOpen(true)}
        placeholder={placeholder ?? t('scanner.manual.placeholder')}
        identifier
        autoFocus={autoFocus}
      />

      <ScannerSheet
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onResult={onResult}
        mode={mode}
        scannedCount={scannedCount}
      />
    </View>
  );
}
