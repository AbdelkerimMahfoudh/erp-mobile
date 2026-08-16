import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { File as FsFile } from 'expo-file-system';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Barcode, Keyboard, Flashlight, FlashlightOff, ScanText, X } from 'lucide-react-native';
import { colors } from '../../lib/design/colors';
import { radius, space, touch } from '../../lib/design/tokens';
import { useTranslation } from '../../lib/i18n';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { TextField } from '../ui/Field';
import { Text } from '../ui/Text';
import { EmptyState } from '../ui/EmptyState';
import { useScan } from './useScan';
import { readImeisFromImage, isOcrAvailable } from '../../lib/ocr';
import type { ImeiCandidate } from '../../lib/imei';
import { reconcileTacs, useTacResolution } from '../../lib/tac';
import type { ScanResult } from '../../types/api';

/**
 * The camera scanner.
 *
 * Full-screen and camera-first, because docs/05 makes scanning the default and
 * typing the fallback — so the keypad lives *inside* this sheet rather than
 * being a separate path a hurried employee has to go find.
 *
 * Two modes:
 *  - `single`   — one scan, then close. Selling a phone, looking a unit up.
 *  - `continuous` — stays open and keeps reporting. Receiving a delivery of
 *    twenty units, where reopening the camera each time would be absurd.
 *
 * The barcode formats are the ones that actually appear on electronics: Code128
 * and Code39 carry IMEIs and serials on device boxes, EAN/UPC cover retail
 * packaging, QR and DataMatrix show up on newer labels.
 */

const BARCODE_TYPES = [
  'code128',
  'code39',
  'code93',
  'ean13',
  'ean8',
  'upc_a',
  'upc_e',
  'itf14',
  'codabar',
  'qr',
  'datamatrix',
  'pdf417',
] as const;

export interface ScannerSheetProps {
  open: boolean;
  onClose: () => void;
  /** Fired for every successful lookup. */
  onResult: (result: ScanResult) => void;
  mode?: 'single' | 'continuous';
  /** Replaces the default instruction under the viewfinder. */
  hint?: string;
  /** Running tally shown in continuous mode, e.g. units added so far. */
  scannedCount?: number;
}

export function ScannerSheet({
  open,
  onClose,
  onResult,
  mode = 'single',
  hint,
  scannedCount,
}: ScannerSheetProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [manual, setManual] = useState(false);
  const [typed, setTyped] = useState('');
  // Guards against the camera firing again while the result is being handled.
  const handling = useRef(false);

  /**
   * Which of the three intake modes is active (Milestone C).
   *
   * `barcode` reads a printed code. `imei` photographs the phone's own `*#06#`
   * screen and reads the digits off it, which is the only route for a used
   * phone with no box and no label. Typing is the third, and it is reachable
   * from both — see `manual`.
   */
  const [scanMode, setScanMode] = useState<'barcode' | 'imei'>('barcode');
  const cameraRef = useRef<CameraView | null>(null);
  const [reading, setReading] = useState<ImeiCandidate[]>([]);
  const [capturing, setCapturing] = useState(false);
  const [ocrNote, setOcrNote] = useState<string | null>(null);

  /**
   * The TAC behind each IMEI read, resolved through the company overlay. Both
   * are resolved for a dual-SIM phone, because they must be reconciled before
   * anything is offered — see `reconcileTacs`.
   */
  const primaryTac = useTacResolution(reading[0]?.imei);
  const secondaryTac = useTacResolution(reading[1]?.imei);
  const { resolution: tacResolution, conflict: tacConflict } = reconcileTacs(
    primaryTac.data,
    secondaryTac.data,
  );

  /**
   * Photograph the screen and read it, on the device.
   *
   * The image is deleted immediately after recognition, in a `finally` so it
   * goes even when recognition throws. Nothing is uploaded — see `lib/ocr.ts`.
   */
  const captureImei = useCallback(async () => {
    if (capturing || !cameraRef.current) return;
    setCapturing(true);
    setOcrNote(null);
    let uri: string | null = null;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.6, skipProcessing: true });
      uri = photo?.uri ?? null;
      if (!uri) return;
      const out = await readImeisFromImage(uri, reading);
      if (out.unavailable) {
        // Honest, and immediately actionable: typing is right there.
        setOcrNote(t('scanner.imei.unavailable'));
        return;
      }
      setReading(out.candidates);
      if (out.candidates.length === 0) setOcrNote(t('scanner.imei.nothingFound'));
    } catch {
      setOcrNote(t('scanner.imei.failed'));
    } finally {
      /**
       * The photograph never outlives the read. In a `finally`, so it goes even
       * when recognition throws — an IMEI photo left in the cache is exactly
       * the kind of thing that should not accumulate on a shop's phone.
       */
      if (uri) {
        try {
          new FsFile(uri).delete();
        } catch {
          // Already gone, or never written. Nothing to recover from.
        }
      }
      setCapturing(false);
    }
  }, [capturing, reading, t]);

  const handleResult = useCallback(
    (result: ScanResult) => {
      onResult(result);
      if (mode === 'single') {
        onClose();
      }
    },
    [mode, onClose, onResult],
  );

  const { scan, loading, error, reset } = useScan({ onResult: handleResult });

  // Fresh state each time it opens — a stale torch or half-typed code from the
  // last scan has no business being here.
  useEffect(() => {
    if (open) {
      setTorch(false);
      setManual(false);
      setTyped('');
      handling.current = false;
      setScanMode('barcode');
      setReading([]);
      setOcrNote(null);
      reset();
    }
  }, [open, reset]);

  const onBarcodeScanned = useCallback(
    ({ data }: BarcodeScanningResult) => {
      if (handling.current || loading) return;
      handling.current = true;
      void scan(data).finally(() => {
        // Duplicate suppression lives in useScan; this only stops the callback
        // from stacking while a request is in flight.
        handling.current = false;
      });
    },
    [loading, scan],
  );

  const submitTyped = () => {
    const code = typed.trim();
    if (!code) return;
    setTyped('');
    void scan(code);
  };

  if (!open) return null;

  const canUseCamera = permission?.granted === true;
  // Web and simulators frequently have no usable camera; typing must still work.
  const cameraSupported = Platform.OS !== 'web';

  return (
    <Modal visible transparent={false} statusBarTranslucent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        {canUseCamera && cameraSupported && !manual ? (
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing="back"
            enableTorch={torch}
            /**
             * Barcode detection is switched OFF while reading a phone screen.
             * A `*#06#` display often carries a QR alongside the digits, and a
             * stray barcode hit would close the sheet mid-read.
             */
            barcodeScannerSettings={
              scanMode === 'barcode' ? { barcodeTypes: [...BARCODE_TYPES] } : undefined
            }
            onBarcodeScanned={scanMode === 'barcode' ? onBarcodeScanned : undefined}
          />
        ) : null}

        {/* Top bar */}
        <View style={[styles.topBar, { paddingTop: insets.top + space.sm }]}>
          <IconButton
            icon={X}
            accessibilityLabel={t('action.close')}
            variant="inverse"
            onPress={onClose}
          />
          <Text variant="bodyStrong" tone="inverse">
            {t('scanner.title')}
          </Text>
          {canUseCamera && cameraSupported && !manual ? (
            <IconButton
              icon={torch ? FlashlightOff : Flashlight}
              accessibilityLabel={torch ? t('scanner.torch.off') : t('scanner.torch.on')}
              variant="inverse"
              onPress={() => setTorch((v) => !v)}
            />
          ) : (
            <View style={{ width: touch.min }} />
          )}
        </View>

        {/* Body */}
        {!cameraSupported ? (
          <Fallback
            title={t('scanner.unavailable.title')}
            body={t('scanner.unavailable.body')}
            typed={typed}
            setTyped={setTyped}
            onSubmit={submitTyped}
            loading={loading}
            error={error}
          />
        ) : !permission ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.text.inverse} />
          </View>
        ) : !permission.granted ? (
          <View style={styles.center}>
            <View style={styles.panel}>
              <EmptyState
                icon={Keyboard}
                title={t('scanner.permission.title')}
                body={
                  permission.canAskAgain
                    ? t('scanner.permission.body')
                    : t('scanner.permission.denied')
                }
                action={
                  permission.canAskAgain
                    ? { label: t('scanner.permission.grant'), onPress: () => void requestPermission() }
                    : undefined
                }
                secondaryAction={{ label: t('action.typeInstead'), onPress: () => setManual(true) }}
              />
            </View>
          </View>
        ) : manual ? (
          <Fallback
            title={t('scanner.manual.title')}
            typed={typed}
            setTyped={setTyped}
            onSubmit={submitTyped}
            loading={loading}
            error={error}
            onBack={() => setManual(false)}
          />
        ) : (
          <>
            <View style={styles.viewfinderArea} pointerEvents="none">
              <View style={styles.viewfinder}>
                <Corner style={styles.tl} />
                <Corner style={styles.tr} />
                <Corner style={styles.bl} />
                <Corner style={styles.br} />
              </View>
              <View style={styles.hintBox}>
                {loading ? (
                  <View style={styles.loadingRow}>
                    <ActivityIndicator color={colors.text.inverse} size="small" />
                    <Text variant="label" tone="inverse">
                      {t('scanner.looking')}
                    </Text>
                  </View>
                ) : (
                  <Text variant="label" tone="inverse" align="center">
                    {scanMode === 'imei'
                      ? t('scanner.imei.hint')
                      : (hint ??
                        (mode === 'continuous' ? t('scanner.hint.continuous') : t('scanner.hint')))}
                  </Text>
                )}
              </View>
              {error ? (
                <View style={styles.errorBox}>
                  <Text variant="label" tone="inverse" align="center">
                    {error}
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={[styles.bottomBar, { paddingBottom: insets.bottom + space.base }]}>
              {mode === 'continuous' && scannedCount !== undefined ? (
                <Text variant="bodyStrong" tone="inverse" align="center">
                  {t('scanner.scanned', { count: scannedCount })}
                </Text>
              ) : null}

              {/*
                What was read, before anything enters inventory. Every character
                the recogniser reinterpreted is listed, so a human agrees to the
                reading rather than being told about it.
              */}
              {scanMode === 'imei' && reading.length > 0 ? (
                <View style={styles.readingBox}>
                  {reading.map((c) => (
                    <View key={c.imei} style={styles.readingRow}>
                      <Text variant="bodyStrong" tone="inverse">
                        {c.label ? `${c.label.toUpperCase()}: ` : ''}
                        {c.imei}
                      </Text>
                      {c.substitutions.length > 0 ? (
                        <Text variant="caption" tone="inverse">
                          {t('scanner.imei.substituted', { list: c.substitutions.join(' ') })}
                        </Text>
                      ) : null}
                    </View>
                  ))}
                  <Text variant="caption" tone="inverse">
                    {reading.length > 1 ? t('scanner.imei.dualSim') : t('scanner.imei.single')}
                  </Text>

                  {/*
                    What the shop knows about this model, and WHERE that came
                    from. Shown before anything is submitted, because a
                    suggestion the user cannot trace is a suggestion they cannot
                    judge — and a proposal must never look like a decision.
                  */}
                  <Text variant="caption" tone="inverse">
                    {tacConflict
                      ? t('scanner.tac.conflict')
                      : tacResolution?.source === 'company_confirmed'
                        ? t('scanner.tac.confirmed', {
                            product:
                              tacResolution.product
                                ? [tacResolution.product.brand, tacResolution.product.model]
                                    .filter(Boolean)
                                    .join(' ')
                                : '',
                          })
                        : tacResolution?.source === 'company_proposed'
                          ? t('scanner.tac.proposed')
                          : tacResolution?.source === 'global_catalog'
                            ? t('scanner.tac.generic', {
                                product: [tacResolution.brand, tacResolution.model]
                                  .filter(Boolean)
                                  .join(' '),
                              })
                            : t('scanner.tac.unknown')}
                  </Text>

                  <Button
                    title={t('scanner.imei.use')}
                    /**
                     * Blocked on a dual-SIM conflict. Two TACs naming different
                     * products is a question for a human, not something to
                     * resolve by picking one.
                     */
                    disabled={tacConflict}
                    fullWidth
                    onPress={() => {
                      // The primary identifier goes down the SAME `/scan`
                      // pipeline as a barcode, so recognition learns from an
                      // OCR read exactly as it does from a scan.
                      const first = reading[0];
                      setReading([]);
                      void scan(first.imei);
                    }}
                  />
                </View>
              ) : null}

              {ocrNote ? (
                <Text variant="label" tone="inverse" align="center">
                  {ocrNote}
                </Text>
              ) : null}

              {scanMode === 'imei' ? (
                <Button
                  title={capturing ? t('scanner.imei.reading') : t('scanner.imei.capture')}
                  icon={ScanText}
                  fullWidth
                  loading={capturing}
                  onPress={() => void captureImei()}
                />
              ) : null}

              {/*
                The mode switch. Offered only where OCR can actually run — a
                button that always fails is worse than one that is absent, and
                typing is available either way.
              */}
              {isOcrAvailable() ? (
                <Button
                  title={
                    scanMode === 'imei' ? t('scanner.mode.barcode') : t('scanner.mode.imei')
                  }
                  variant="secondary"
                  icon={scanMode === 'imei' ? Barcode : ScanText}
                  fullWidth
                  onPress={() => {
                    setScanMode((m) => (m === 'imei' ? 'barcode' : 'imei'));
                    setReading([]);
                    setOcrNote(null);
                  }}
                />
              ) : null}

              {/* Always present, in every mode. Typing is never taken away. */}
              <Button
                title={t('action.typeInstead')}
                variant="secondary"
                icon={Keyboard}
                fullWidth
                onPress={() => setManual(true)}
              />
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

/** Keypad fallback — also the whole UI when there is no camera at all. */
function Fallback({
  title,
  body,
  typed,
  setTyped,
  onSubmit,
  loading,
  error,
  onBack,
}: {
  title: string;
  body?: string;
  typed: string;
  setTyped: (v: string) => void;
  onSubmit: () => void;
  loading: boolean;
  error: string | null;
  onBack?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.center}>
      <View style={styles.panel}>
        <Text variant="heading" align="center">
          {title}
        </Text>
        {body ? (
          <Text variant="body" tone="secondary" align="center">
            {body}
          </Text>
        ) : null}
        <TextField
          variant="identifier"
          placeholder={t('scanner.manual.placeholder')}
          value={typed}
          onChangeText={setTyped}
          autoFocus
          error={error ?? undefined}
          returnKeyType="search"
          onSubmitEditing={onSubmit}
        />
        <Button
          title={t('scanner.manual.submit')}
          fullWidth
          loading={loading}
          disabled={!typed.trim()}
          onPress={onSubmit}
        />
        {onBack ? (
          <Button title={t('action.scan')} variant="tertiary" fullWidth onPress={onBack} />
        ) : null}
      </View>
    </View>
  );
}

function Corner({ style }: { style: object }) {
  return <View style={[styles.corner, style]} />;
}

const CORNER = 34;
const CORNER_WIDTH = 3;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface.inverse,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.base,
    paddingBottom: space.sm,
    gap: space.md,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
  },
  panel: {
    width: '100%',
    maxWidth: 400,
    gap: space.base,
    padding: space.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.surface.card,
  },
  viewfinderArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.lg,
  },
  viewfinder: {
    width: '78%',
    aspectRatio: 1.35,
    maxWidth: 340,
  },
  corner: {
    position: 'absolute',
    width: CORNER,
    height: CORNER,
    borderColor: colors.text.inverse,
  },
  tl: { top: 0, left: 0, borderTopWidth: CORNER_WIDTH, borderLeftWidth: CORNER_WIDTH, borderTopLeftRadius: radius.md },
  tr: { top: 0, right: 0, borderTopWidth: CORNER_WIDTH, borderRightWidth: CORNER_WIDTH, borderTopRightRadius: radius.md },
  bl: { bottom: 0, left: 0, borderBottomWidth: CORNER_WIDTH, borderLeftWidth: CORNER_WIDTH, borderBottomLeftRadius: radius.md },
  br: { bottom: 0, right: 0, borderBottomWidth: CORNER_WIDTH, borderRightWidth: CORNER_WIDTH, borderBottomRightRadius: radius.md },
  hintBox: {
    paddingHorizontal: space.base,
    paddingVertical: space.sm,
    borderRadius: radius.full,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  readingBox: { gap: space.xs, paddingBottom: space.sm },
  readingRow: { gap: 2 },
  errorBox: {
    marginHorizontal: space.xl,
    paddingHorizontal: space.base,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    backgroundColor: colors.intent.danger.solid,
  },
  bottomBar: {
    paddingHorizontal: space.base,
    paddingTop: space.md,
    gap: space.md,
  },
});
