import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Keyboard, Flashlight, FlashlightOff, Plus, X } from 'lucide-react-native';
import { colors } from '../../lib/design/colors';
import { radius, space, touch } from '../../lib/design/tokens';
import { useTranslation } from '../../lib/i18n';
import { haptics } from '../../lib/haptics';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { TextField } from '../ui/Field';
import { Text } from '../ui/Text';
import { EmptyState } from '../ui/EmptyState';
import { useScan } from './useScan';
import { classifyScan } from '../../lib/scan/payload';
import {
  acceptsDetection,
  cameraActive,
  initialScannerState,
  scannerReducer,
  type ResultProblem,
  type ScannerState,
} from '../../lib/scan/machine';
import { reconcileTacs, useTacResolution } from '../../lib/tac';
import type { ScanResult } from '../../types/api';

/**
 * The camera scanner.
 *
 * Full-screen and camera-first, because docs/05 makes scanning the default and
 * typing the fallback — so the keypad lives *inside* this sheet rather than
 * being a separate path a hurried employee has to go find.
 *
 * ## What replaced OCR (milestone O)
 *
 * Reading a `*#06#` screen with on-device text recognition was retired. The
 * supported intake methods are a scanned IMEI barcode or QR code, an ordinary
 * product barcode, and typing — and **typing is permanent**, because whether a
 * phone shows a scannable code beside its IMEI is up to its manufacturer.
 *
 * ## Why the state machine
 *
 * A valid IMEI used to be detected while the camera carried on scanning, and
 * nothing appeared until the sheet was closed by hand. The guard released
 * itself in a `finally`, so the camera resumed the moment the lookup returned.
 *
 * `lib/scan/machine.ts` makes the lock the state itself: a detection is taken
 * only in `scanning`, and only an explicit decision goes back there. The state
 * is held in a **ref as well as** React state, because the camera fires again
 * before React re-renders — a `useState` value read inside the callback is
 * stale exactly when it matters.
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
  onResult: (result: ScanResult) => void;
  /**
   * What an accepted IMEI means to the caller.
   *
   * Separate from `onResult` on purpose: an IMEI identifies one physical phone
   * and belongs in a unit's identifier fields, while a product barcode
   * identifies a reusable model. Collapsing them is how an IMEI ends up in the
   * Product barcode box.
   */
  onImeiAccepted?: (imei: { primary: string; secondary: string | null }) => void;
  mode?: 'single' | 'continuous';
  hint?: string;
  /** Running tally shown in continuous mode, e.g. units added so far. */
  scannedCount?: number;
}

const PROBLEM_KEY: Record<ResultProblem, string> = {
  checksum: 'scan.problem.checksum',
  length: 'scan.problem.length',
  ambiguous: 'scan.problem.ambiguous',
  not_an_imei: 'scan.problem.notImei',
  same_as_primary: 'scan.problem.sameAsPrimary',
};

export function ScannerSheet({
  open,
  onClose,
  onResult,
  onImeiAccepted,
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
  const [typedSecond, setTypedSecond] = useState('');

  const [machine, dispatch] = useReducer(scannerReducer, initialScannerState);
  /**
   * The same state, readable synchronously.
   *
   * THE LOCK. The camera can fire several times before React commits a render,
   * so the callback must not consult `machine` — it would still say `scanning`
   * for the second and third event of the same barcode.
   */
  const machineRef = useRef<ScannerState>(initialScannerState);
  const setMachine = useCallback((event: Parameters<typeof scannerReducer>[1]) => {
    machineRef.current = scannerReducer(machineRef.current, event);
    dispatch(event);
  }, []);

  const result = machine.name === 'result' ? machine : null;
  const primary = result?.primary ?? null;
  const secondary = result?.secondary ?? null;

  /**
   * The TAC behind each identifier, resolved through the company overlay. Both
   * are resolved for a dual-SIM phone, because they must be reconciled before
   * anything is offered — see `reconcileTacs`.
   */
  const primaryTac = useTacResolution(primary ?? undefined);
  const secondaryTac = useTacResolution(secondary ?? undefined);
  const { resolution: tacResolution, conflict: tacConflict } = reconcileTacs(
    primaryTac.data,
    secondaryTac.data,
  );

  const handleResult = useCallback(
    (r: ScanResult) => {
      onResult(r);
      if (mode === 'single') onClose();
    },
    [mode, onClose, onResult],
  );

  const { scan, loading, error, reset } = useScan({ onResult: handleResult });

  // Fresh state each time it opens — a stale torch, a half-typed code or a
  // result from the last phone has no business being here.
  useEffect(() => {
    if (open) {
      setTorch(false);
      setManual(false);
      setTyped('');
      setTypedSecond('');
      machineRef.current = scannerReducer(initialScannerState, { type: 'open' });
      dispatch({ type: 'open' });
      reset();
    }
  }, [open, reset]);

  /**
   * One camera detection.
   *
   * Everything that makes this safe happens before the first `await`: the ref
   * is consulted and advanced synchronously, so every callback that arrives
   * while this one is still working is dropped by the machine rather than
   * racing it.
   */
  const onBarcodeScanned = useCallback(
    ({ data }: BarcodeScanningResult) => {
      if (!acceptsDetection(machineRef.current)) return;
      setMachine({ type: 'detected', raw: data });

      const payload = classifyScan(data);
      if (payload.kind === 'imei') haptics.success();
      else haptics.warning();
      setMachine({ type: 'validated', payload });
    },
    [setMachine],
  );

  const acceptImei = useCallback(() => {
    if (!primary) return;
    setMachine({ type: 'accept' });
    onImeiAccepted?.({ primary, secondary });
    // The identifier still goes down the same `/scan` pipeline, so recognition
    // and the TAC overlay learn from it exactly as they do from a barcode.
    void scan(primary);
  }, [onImeiAccepted, primary, scan, secondary, setMachine]);

  const submitTyped = () => {
    const code = typed.trim();
    if (!code) return;
    const second = typedSecond.trim();

    // Typed input goes through the same classifier, so a pasted QR payload or a
    // spaced-out number behaves identically to a scan.
    const payload = classifyScan(code);
    if (payload.kind === 'imei' && onImeiAccepted) {
      const secondPayload = second ? classifyScan(second) : null;
      const secondaryTyped =
        secondPayload?.kind === 'imei' && secondPayload.primary !== payload.primary
          ? secondPayload.primary
          : payload.secondary;
      setMachine({ type: 'manual', primary: payload.primary, secondary: secondaryTyped ?? null });
      onImeiAccepted({ primary: payload.primary, secondary: secondaryTyped ?? null });
    }

    setTyped('');
    setTypedSecond('');
    void scan(code);
  };

  if (!open) return null;

  const canUseCamera = permission?.granted === true;
  // Web and simulators frequently have no usable camera; typing must still work.
  const cameraSupported = Platform.OS !== 'web';
  const live = cameraActive(machine);

  return (
    <Modal visible transparent={false} statusBarTranslucent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        {canUseCamera && cameraSupported && !manual ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            enableTorch={torch}
            barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
            /**
             * Detaching the handler is what actually pauses scanning. Leaving it
             * attached and filtering inside would keep the camera pipeline
             * running behind a result the user is still reading.
             */
            onBarcodeScanned={live ? onBarcodeScanned : undefined}
          />
        ) : null}

        {/* Top bar */}
        <View style={[styles.topBar, { paddingTop: insets.top + space.sm }]}>
          <IconButton
            icon={X}
            accessibilityLabel={t('scan.a11y.close')}
            variant="inverse"
            onPress={() => {
              setMachine({ type: 'cancel' });
              onClose();
            }}
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
            typedSecond={typedSecond}
            setTypedSecond={setTypedSecond}
            allowSecond={Boolean(onImeiAccepted)}
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
            typedSecond={typedSecond}
            setTypedSecond={setTypedSecond}
            allowSecond={Boolean(onImeiAccepted)}
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
                {loading || machine.name === 'validating' ? (
                  <View style={styles.loadingRow}>
                    <ActivityIndicator color={colors.text.inverse} size="small" />
                    <Text variant="label" tone="inverse">
                      {t('scanner.looking')}
                    </Text>
                  </View>
                ) : (
                  <Text variant="label" tone="inverse" align="center">
                    {hint ??
                      (mode === 'continuous'
                        ? t('scanner.hint.continuous')
                        : onImeiAccepted
                          ? t('scan.hint.barcode')
                          : t('scanner.hint'))}
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
                The result, shown here and now. Nothing waits for the sheet to be
                closed, and the camera is already detached above.
              */}
              {result ? (
                <View style={styles.readingBox}>
                  {result.problem ? (
                    <Text variant="bodyStrong" tone="inverse">
                      {t(PROBLEM_KEY[result.problem] as never)}
                    </Text>
                  ) : (
                    <Text variant="bodyStrong" tone="inverse">
                      {t('scan.detected')}
                    </Text>
                  )}

                  {primary ? (
                    <View style={styles.readingRow}>
                      <Text variant="caption" tone="inverse">
                        {t('scan.imei1')}
                      </Text>
                      <Text variant="bodyStrong" tone="inverse">
                        {primary}
                      </Text>
                    </View>
                  ) : null}

                  {secondary ? (
                    <View style={styles.readingRow}>
                      <Text variant="caption" tone="inverse">
                        {t('scan.imei2')}
                      </Text>
                      <Text variant="bodyStrong" tone="inverse">
                        {secondary}
                      </Text>
                    </View>
                  ) : null}

                  {primary ? (
                    <Text variant="caption" tone="inverse">
                      {secondary ? t('scan.bothOnePhone') : t('scanner.imei.single')}
                    </Text>
                  ) : null}

                  {/*
                    What the shop knows about this model, and WHERE that came
                    from. A suggestion the user cannot trace is one they cannot
                    judge — and a proposal must never look like a decision.
                  */}
                  {primary ? (
                    <Text variant="caption" tone="inverse">
                      {tacConflict
                        ? t('scanner.tac.conflict')
                        : tacResolution?.source === 'company_confirmed'
                          ? t('scanner.tac.confirmed', {
                              product: tacResolution.product
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
                              : t('scan.productUnknown')}
                    </Text>
                  ) : null}

                  {primary && !result.problem ? (
                    <Button
                      title={t('scanner.imei.use')}
                      /**
                       * Blocked on a dual-SIM conflict. Two TACs naming
                       * different products is a question for a human, not
                       * something to resolve by picking one.
                       */
                      disabled={tacConflict}
                      fullWidth
                      onPress={acceptImei}
                    />
                  ) : null}

                  {primary && !secondary && !result.problem ? (
                    <Button
                      title={t('scan.addSecond')}
                      variant="secondary"
                      icon={Plus}
                      fullWidth
                      onPress={() => setMachine({ type: 'addSecond' })}
                    />
                  ) : null}

                  {secondary ? (
                    <Button
                      title={t('scan.removeSecond')}
                      variant="tertiary"
                      fullWidth
                      onPress={() => setMachine({ type: 'removeSecond' })}
                    />
                  ) : null}

                  <Button
                    title={t('scan.scanAgain')}
                    variant="secondary"
                    fullWidth
                    onPress={() => setMachine({ type: 'scanAgain' })}
                  />
                </View>
              ) : null}

              {/*
                Always present, in every state. Typing is never taken away —
                many manufacturers show the IMEI with no code beside it.
              */}
              <Button
                title={t('scan.enterManually')}
                variant="secondary"
                icon={Keyboard}
                fullWidth
                onPress={() => setManual(true)}
              />
              {!result ? (
                <Text variant="caption" tone="inverse" align="center">
                  {t('scan.hint.notEveryPhone')}
                </Text>
              ) : null}
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
  typedSecond,
  setTypedSecond,
  allowSecond,
  onSubmit,
  loading,
  error,
  onBack,
}: {
  title: string;
  body?: string;
  typed: string;
  setTyped: (v: string) => void;
  typedSecond: string;
  setTypedSecond: (v: string) => void;
  /** Offer the optional second identifier. Only where an IMEI is expected. */
  allowSecond: boolean;
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
        {/*
          The optional second identifier. A single-SIM phone is never blocked
          for lacking it, so this is an extra box and never a required one.
        */}
        {allowSecond ? (
          <TextField
            variant="identifier"
            label={t('scan.manual.secondaryOptional')}
            value={typedSecond}
            onChangeText={setTypedSecond}
            returnKeyType="done"
            onSubmitEditing={onSubmit}
          />
        ) : null}
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
