import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Keyboard, Flashlight, FlashlightOff, Plus, X } from 'lucide-react-native';
import { radius, space, touch } from '../../lib/design/tokens';
import { useTranslation } from '../../lib/i18n';
import { haptics } from '../../lib/haptics';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { TextField } from '../ui/Field';
import { Identifier, Text } from '../ui/Text';
import { EmptyState } from '../ui/EmptyState';
import { useScan } from './useScan';
// Still used by the typed path, which needs no stabilization: typing a number
// is already a deliberate act, and there is no camera to steady.
import { classifyScan, type ScanPayload } from '../../lib/scan/payload';
import {
  EMPTY_ACQUISITION,
  observe,
  prune,
  type Acquisition,
} from '../../lib/scan/stabilizer';
import {
  acceptsDetection,
  cameraActive,
  initialScannerState,
  scannerReducer,
  type ResultProblem,
  type ScannerState,
} from '../../lib/scan/machine';
import { reconcileTacs, useTacResolution, type TacResolution } from '../../lib/tac';
import type { ScanResult } from '../../types/api';
import { makeStyles, useColors } from '../../lib/design/theme';

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

/**
 * Everything the parent needs about one accepted phone.
 *
 * The digits alone were not enough: the intake page had to repeat the
 * classification and the TAC lookup to show what had just been scanned, and
 * until it did, the user saw nothing. Handing the whole result over means the
 * page can render immediately and the scanner can close.
 */
export interface AcceptedImei {
  readonly primary: string;
  readonly secondary: string | null;
  /** What the raw payload was classified as. Null for a typed identifier. */
  readonly payload: ScanPayload | null;
  /** The generic brand/model suggestion, if a TAC resolved to one. */
  readonly tac: TacResolution | null;
  /** True when two identifiers disagreed — never present one as the answer. */
  readonly tacConflict: boolean;
  /**
   * What `/scan` already knows: the existing product, and whether that is
   * recognition or a guess. Null when the lookup has not returned.
   */
  readonly scan: ScanResult | null;
}

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
  onImeiAccepted?: (accepted: AcceptedImei) => void;
  mode?: 'single' | 'continuous';
  hint?: string;
  /** Running tally shown in continuous mode, e.g. units added so far. */
  scannedCount?: number;
}

/**
 * A monotonic millisecond clock.
 *
 * `Date.now()` is a wall clock: it can jump backwards when the OS syncs time,
 * and a backwards jump would silently extend a stability window. `performance
 * .now()` only ever moves forward, which is the only property this needs.
 */
const monotonicNow = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

/**
 * Whether this platform's `cornerPoints` are in the preview's coordinate space.
 *
 * **Read from the native source in `node_modules/expo-camera`, not guessed.**
 *
 *   - **iOS** (`MetaDataDelegate.swift`) passes barcodes through
 *     `previewLayer.transformedMetadataObject`, so the points arrive in preview
 *     points and the measured preview size is the right denominator. The Vision
 *     path (`BarcodeScannerUtils.swift`) instead reports values already
 *     normalised 0–1, which `centreOf` recognises on its own.
 *   - **Android** (`BarcodeScannerResultSerializer.kt`) reports ML Kit *image*
 *     pixels divided by display density, and the image dimensions are **never
 *     put into the bundle sent to JS**. There is no denominator available, so
 *     there is nothing honest to compute.
 *
 * Android therefore ranks by stability alone, which is the whole reason the
 * reticle is advisory: no scan is ever refused for want of a coordinate. Any
 * attempt to infer Android's extent would be a speculative normalisation on
 * hardware nobody here can test, and its failure mode is a scanner that rejects
 * everything.
 */
const PREVIEW_SPACE_COORDS = Platform.OS === 'ios';

const PROBLEM_KEY: Record<ResultProblem, string> = {
  checksum: 'scan.problem.checksum',
  length: 'scan.problem.length',
  ambiguous: 'scan.problem.ambiguous',
  not_an_imei: 'scan.problem.notImei',
  same_as_primary: 'scan.problem.sameAsPrimary',
};

/**
 * The existing explanation for a code that was aimed at and cannot be used.
 *
 * Reuses the strings the result panel already shows, so a barcode rejected
 * while the camera keeps running is described in exactly the same words as one
 * rejected after acceptance. Two vocabularies for one fact would be worse than
 * either.
 */
function problemFor(payload: ScanPayload): string {
  if (payload.kind === 'invalid') return PROBLEM_KEY[payload.reason];
  if (payload.kind === 'ambiguous') return PROBLEM_KEY.ambiguous;
  return PROBLEM_KEY.not_an_imei;
}

export function ScannerSheet({
  open,
  onClose,
  onResult,
  onImeiAccepted,
  mode = 'single',
  hint,
  scannedCount,
}: ScannerSheetProps) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [manual, setManual] = useState(false);
  const [typed, setTyped] = useState('');
  const [typedSecond, setTypedSecond] = useState('');

  /**
   * One scanner opening = one session.
   *
   * The sheet is MOUNTED for the whole life of its parent — `open` only decides
   * whether it renders — so every piece of state below survives being closed
   * and reopened. That is what made the second and third scan misbehave while
   * the first was fine: the reopened sheet rendered the PREVIOUS session's
   * accepted result for one frame, and React reused the previous `CameraView`
   * instance, which comes back holding its last frame.
   *
   * The reset therefore happens during render, the moment `open` flips, rather
   * than in an effect that runs after that first frame is already on screen.
   * And `sessionId` keys the camera, so a genuinely new instance is created
   * every time instead of an old one being revived.
   */
  const [sessionId, setSessionId] = useState(0);
  const [wasOpen, setWasOpen] = useState(false);

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

  /*
   * One lookup per identifier, triggered by the identifier itself rather than
   * by a render — so a re-render cannot fire a second one, and a result that
   * survives `addSecond` is not looked up twice.
   */
  const lookedUp = useRef<string | null>(null);

  /**
   * Synchronous, like the camera lock, and reset per session.
   *
   * A double tap lands before React re-renders, and two accepts meant two
   * `onClose` calls.
   */
  const accepting = useRef(false);

  /**
   * The barcode currently being held, and how long it has been held.
   *
   * A ref for the same reason the lock is: the camera fires many times before
   * React commits a render, so a candidate kept in state would be a frame
   * behind every decision made about it.
   *
   * `holding` is the rendered shadow of it — it drives one label and nothing
   * else. No acceptance is ever made from it.
   */
  const acquisition = useRef<Acquisition>(EMPTY_ACQUISITION);
  /** 0–1 for the reticle. A rendered shadow; nothing is decided from it. */
  const [progress, setProgress] = useState(0);
  /** A brief, non-blocking word about a code that cannot be used. */
  const [notice, setNotice] = useState<string | null>(null);
  /** The preview's measured size — the denominator for iOS preview points. */
  const previewSize = useRef<{ width: number; height: number } | null>(null);

  /** True once the camera is running: `cameraActive` is true in `scanning` alone. */
  const live = cameraActive(machine);

  const handleResult = useCallback(
    (r: ScanResult) => {
      onResult(r);
      if (mode === 'single') onClose();
    },
    [mode, onClose, onResult],
  );

  const { scan, loading, error, reset } = useScan({ onResult: handleResult });

  /**
   * What the shop already knows about this identifier.
   *
   * The device test found the hole my last change opened: I sent the accepted
   * IMEI down `/scan` with a `silent` `useScan` that had **no `onResult`**, so
   * the recognised product came back and was thrown away. Silent was supposed
   * to mean "no second buzz"; it also meant "no product".
   *
   * The lookup now runs when the result APPEARS — early enough to show the
   * phone in the panel, and long before anybody taps accept. Silent still means
   * only that it does not buzz.
   */
  const [lookup, setLookup] = useState<ScanResult | null>(null);

  /**
   * Which session a lookup belongs to.
   *
   * `/scan` is a network call, and a slow one can return after the user has
   * closed the scanner and opened it again. Without this token that answer
   * lands in the NEW session and shows the previous phone.
   */
  const lookupSession = useRef(0);
  const { scan: scanQuietly, loading: lookingUp } = useScan({
    silent: true,
    onResult: (r) => {
      if (lookupSession.current !== sessionId) return;
      setLookup(r);
    },
  });

  /*
   * Fresh state the instant it opens — before the first frame, not after it.
   *
   * Adjusting state during render in response to a changed prop is the
   * documented React pattern for exactly this, and it is what an effect cannot
   * do: an effect runs after the reopened sheet has already painted the last
   * session's result.
   */
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setSessionId((n) => n + 1);
      setTorch(false);
      setManual(false);
      setTyped('');
      setTypedSecond('');
      setLookup(null);
      machineRef.current = scannerReducer(initialScannerState, { type: 'open' });
      dispatch({ type: 'open' });
      accepting.current = false;
      lookedUp.current = null;
      // A new session aims from scratch: a window half-built when the sheet
      // closed must never be completed by the next opening.
      acquisition.current = EMPTY_ACQUISITION;
      setProgress(0);
              setNotice(null);
    }
  }

  // Clearing the duplicate window touches the shared hook, so it stays in an
  // effect rather than running during render.
  useEffect(() => {
    if (open) reset();
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
    (result: BarcodeScanningResult) => {
      if (!acceptsDetection(machineRef.current)) return;

      /*
       * The device found this three times out of three: a barcode was accepted
       * in well under a second, before anybody had finished aiming — often a
       * neighbouring card, or one only half in shot. The decoder was not wrong;
       * we were, for treating the FIRST thing seen as the thing MEANT.
       *
       * Nothing here acts on one sighting. `observe` requires the same payload
       * to be decoded repeatedly across a full second of continuous visibility,
       * and until it says `accept` the camera stays live, no haptic fires, no
       * lookup starts and no result is shown.
       *
       * A ref, not state: the camera fires many times before React commits a
       * render, so a candidate held in state would be a second behind every
       * decision made about it — the same reason the accept lock is a ref.
       */
      const verdict = observe(acquisition.current, {
        raw: result.data,
        at: monotonicNow(),
        corners: result.cornerPoints,
        preview: previewSize.current ?? undefined,
        previewSpace: PREVIEW_SPACE_COORDS,
        // This sheet is booking a phone in whenever the caller wants an IMEI,
        // and a phone label's serial and model number decode just as readily.
        prefer: onImeiAccepted ? 'imei' : undefined,
      });
      acquisition.current = verdict.state;

      if (verdict.action === 'holding') {
        setProgress(verdict.progress);
        // Aiming at something usable again clears the last complaint. The
        // functional form so the callback never reads a stale closure value.
        setNotice((n) => (n ? null : n));
        return;
      }
      setProgress(0);

      if (verdict.action === 'idle') return;

      if (verdict.action === 'reject') {
        /*
         * Held long enough, and unusable — a damaged label, or a barcode that
         * is not an identifier at all. Say so briefly and KEEP SCANNING: the
         * camera stays live, the sheet stays open, nothing is committed, and
         * the code is on cooldown so it cannot repeat every frame.
         */
        haptics.warning();
        setNotice(problemFor(verdict.target.payload));
        return;
      }

      setMachine({ type: 'detected', raw: verdict.target.key });
      // ONE haptic, and only here — after the rule is satisfied, never on a
      // sighting. Buzzing at every decode is what made a sweep feel like a scan.
      haptics.success();
      setMachine({ type: 'validated', payload: verdict.payload });
    },
    [setMachine, onImeiAccepted],
  );

  /**
   * "Hold steady…" comes off the screen when the barcode leaves the frame.
   *
   * Callbacks only arrive while something is decodable, so a camera lifted away
   * produces silence rather than an event — without this, the guidance would sit
   * there implying a window is still building when nothing is being seen.
   *
   * This interval drives a LABEL. It can never accept anything: acceptance
   * happens only inside `observe`, from an observation that actually arrived.
   */
  useEffect(() => {
    if (!live) {
      setProgress(0);
      return;
    }
    const id = setInterval(() => {
      const now = monotonicNow();
      const before = acquisition.current.candidates.length;
      acquisition.current = prune(acquisition.current, now);
      if (acquisition.current.candidates.length === 0 && before > 0) setProgress(0);
    }, 250);
    return () => clearInterval(id);
  }, [live]);

  /**
   * "Use this IMEI" — once, completely, and then gone.
   *
   * The device test found three faults here. The sheet stayed open until
   * `/scan` returned, so the accepted result only appeared after the user
   * closed the scanner by hand; `useScan` fired a SECOND haptic on top of the
   * one the detection already gave; and because `accepted` had no render
   * branch, the sheet fell back to the camera view and looked as though it had
   * gone back to scanning.
   *
   * So: transition once, hand the parent everything it needs, close. The
   * `/scan` call still happens — recognition must still learn from the
   * identifier — but nothing on screen waits for it.
   */
  useEffect(() => {
    if (!primary || lookedUp.current === primary) return;
    lookedUp.current = primary;
    lookupSession.current = sessionId;
    void scanQuietly(primary);
  }, [primary, scanQuietly, sessionId]);

  const acceptImei = useCallback(() => {
    // Synchronous, like the camera lock: a double tap lands before React
    // re-renders, and two `accept` events would fire two `onClose` calls.
    if (accepting.current || !primary) return;
    accepting.current = true;

    setMachine({ type: 'accept' });
    onImeiAccepted?.({
      primary,
      secondary,
      /*
       * The complete result, not just the digits. The parent needs the
       * classified payload and the TAC suggestion to show what was scanned
       * without repeating the work — and `conflict` matters, because two
       * identifiers that disagree must not be presented as one answer.
       */
      payload: result?.payload ?? null,
      tac: tacResolution ?? null,
      tacConflict,
      /*
       * The product the shop already has for this code — the piece that went
       * missing. `suggestion.productId` is the exact product; `recognized`
       * says whether that is authority or only a guess.
       */
      scan: lookup,
    });

    /*
     * And through the ordinary channel as well, because every screen that
     * embeds a scanner already listens on `onResult` for its product. Dropping
     * this is what made the phone disappear from the intake page.
     */
    if (lookup) onResult(lookup);
    onClose();
  }, [
    lookup,
    onClose,
    onImeiAccepted,
    onResult,
    primary,
    result,
    secondary,
    setMachine,
    tacConflict,
    tacResolution,
  ]);

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
      // A typed identifier reaches the parent the same shape a scanned one
      // does, so the intake page has one code path for both.
      onImeiAccepted({
        primary: payload.primary,
        secondary: secondaryTyped ?? null,
        payload,
        tac: null,
        // A typed identifier has not been looked up yet; `scan(code)` below
        // does that and reaches the parent through `onResult` as it always has.
        tacConflict: false,
        scan: null,
      });
    }

    setTyped('');
    setTypedSecond('');
    void scan(code);
  };

  if (!open) return null;

  const canUseCamera = permission?.granted === true;
  // Web and simulators frequently have no usable camera; typing must still work.
  const cameraSupported = Platform.OS !== 'web';
  return (
    <Modal visible transparent={false} statusBarTranslucent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        {/*
          UNMOUNTED, not merely deactivated.

          The device test found the correction I made last time was half right.
          `active={false}` does stop the camera — and leaves the last frame on
          screen, frozen, so the scanner looks like it has taken a photograph.
          Worse, that frame is whatever the sensor happened to hold when the
          barcode decoded, which very often does not show the digits at all.

          Nothing is captured, nothing is kept, and no frame is ever shown as a
          result. The identifier comes from the decoder's payload, and the panel
          below renders it as text — so what is on screen does not depend on
          what the lens was pointing at when it fired.
        */}
        {canUseCamera && cameraSupported && !manual && live ? (
          <CameraView
            /*
             * A NEW instance every session. Without this React reuses the one
             * from last time — same type, same position in the tree — and it
             * comes back holding the frame it was showing when it went away.
             */
            key={sessionId}
            style={StyleSheet.absoluteFill}
            /*
             * The denominator for iOS preview points. Measured, never assumed:
             * the sheet is full-screen but the preview is not the window, and a
             * guessed size would bias every ranking toward one corner.
             */
            onLayout={(e) => {
              const { width, height } = e.nativeEvent.layout;
              previewSize.current = { width, height };
            }}
            facing="back"
            enableTorch={torch}
            barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
            // Belt and braces while it is mounted; the mount condition above is
            // what actually ends the session.
            onBarcodeScanned={live ? onBarcodeScanned : undefined}
          />
        ) : null}

        {/*
          The aiming frame.

          Somewhere to put the barcode. The device test found the scanner
          accepting whatever crossed the lens first — often a neighbouring card
          on a sheet of them — and part of that is that nothing on screen ever
          said where to point.

          It is guidance, not a gate: `PREVIEW_SPACE_COORDS` explains why the
          platform's barcode coordinates cannot always be trusted, so the copy
          says "position the barcode inside the frame" and never claims that
          only what is inside it will be read. What protects the scan on both
          platforms is holding still.
        */}
        {live && canUseCamera && cameraSupported && !manual ? (
          <View style={styles.guideLayer} pointerEvents="none">
            <View style={[styles.guide, progress > 0 ? styles.guideHolding : null]}>
              {/*
                The acquisition, shown filling the frame from the bottom.

                Without it the scanner looks frozen for a second — which is the
                complaint that started all of this, from the other direction.
                The bar says "seen, and being confirmed", so the second feels
                like the app working rather than the app hanging.
              */}
              <View style={[styles.guideFill, { height: `${Math.round(progress * 100)}%` }]} />
            </View>
            <Text variant="body" style={styles.guideHint}>
              {/*
                Plain language only. No "checksum", no "Luhn", no
                "stabilizing" — the person holding the phone is being asked to
                do one physical thing, and that is all this says.
              */}
              {progress > 0 ? t('scan.guide.holdSteady') : t('scan.guide.position')}
            </Text>
            {/*
              A code that was aimed at and cannot be used. The camera is still
              running underneath and the sheet has not closed: this is a note,
              not a dead end, and the cooldown stops it repeating every frame.
            */}
            {notice ? (
              <Text variant="caption" style={styles.guideNotice}>
                {t(notice as never)}
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* Top bar */}
        <View style={[styles.topBar, { paddingTop: insets.top + space.sm }]}>
          <IconButton
            icon={X}
            accessibilityLabel={t('scan.a11y.close')}
            variant="inverse"
            onPress={() => {
              acquisition.current = EMPTY_ACQUISITION;
              setProgress(0);
              setNotice(null);
              setMachine({ type: 'cancel' });
              onClose();
            }}
          />
          <Text variant="bodyStrong" tone="inverse">
            {t('scanner.title')}
          </Text>
          {canUseCamera && cameraSupported && !manual && live ? (
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
                      {/*
                        The decoder's payload, as selectable text. This is the
                        answer — not the camera frame, which is gone by now and
                        very often never showed the digits at all.
                      */}
                      <Identifier tone="inverse">{primary}</Identifier>
                    </View>
                  ) : null}

                  {secondary ? (
                    <View style={styles.readingRow}>
                      <Text variant="caption" tone="inverse">
                        {t('scan.imei2')}
                      </Text>
                      <Identifier tone="inverse">{secondary}</Identifier>
                    </View>
                  ) : null}

                  {primary ? (
                    <Text variant="caption" tone="inverse">
                      {secondary ? t('scan.bothOnePhone') : t('scanner.imei.single')}
                    </Text>
                  ) : null}

                  {/*
                    The phone the shop already has for this code.
                    
                    Shown HERE, before anybody accepts, because the previous
                    version resolved it and threw it away — the product only
                    reappeared if the intake page happened to look it up again.
                    `recognized` is the difference between an answer and a
                    guess, and the wording follows it.
                  */}
                  {primary && lookingUp ? (
                    <Text variant="caption" tone="inverse">
                      {t('scanner.looking')}
                    </Text>
                  ) : null}
                  {primary && !lookingUp && lookup?.suggestion ? (
                    <View style={styles.readingRow}>
                      <Text variant="caption" tone="inverse">
                        {lookup.recognized ? t('scan.knownProduct') : t('scan.maybeProduct')}
                      </Text>
                      <Text variant="bodyStrong" tone="inverse">
                        {[
                          lookup.suggestion.brand,
                          lookup.suggestion.model,
                          lookup.suggestion.variant,
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      </Text>
                    </View>
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
                      onPress={() => {
                        // Aiming at the OTHER SIM's label starts a new window.
                        acquisition.current = EMPTY_ACQUISITION;
                        setProgress(0);
              setNotice(null);
                        setMachine({ type: 'addSecond' });
                      }}
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
                    onPress={() => {
                      acquisition.current = EMPTY_ACQUISITION;
                      setProgress(0);
              setNotice(null);
                      setMachine({ type: 'scanAgain' });
                    }}
                  />
                </View>
              ) : null}

              {/*
                Manual entry is NOT here.

                It used to sit in the scanner in every state, and the device
                test showed why that is wrong: somebody who has opened the
                camera has already chosen to scan, and a keyboard button under
                a live viewfinder is a second decision in the way of the first.

                It has not gone anywhere — it lives on the intake page, beside
                the button that opens this sheet, which is where somebody
                decides HOW to enter an identifier. Typing is never taken away;
                many manufacturers print the IMEI with no code beside it.
              */}
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
  const styles = useStyles();
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
  const styles = useStyles();
  return <View style={[styles.corner, style]} />;
}

const CORNER = 34;
const CORNER_WIDTH = 3;

const useStyles = makeStyles((colors) => ({
  root: {
    flex: 1,
    backgroundColor: colors.surface.inverse,
  },
  guideLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.lg,
  },
  guide: {
    overflow: 'hidden',
    // Wide and short: an IMEI barcode is a long strip, and a square frame
    // invites people to hold the phone too close to fit it in.
    width: '78%',
    aspectRatio: 2.4,
    borderWidth: 2,
    borderColor: colors.border.inverse,
    borderRadius: radius.lg,
    backgroundColor: 'transparent',
  },
  guideHolding: {
    // Confirmation that something has been found and is being held — paired
    // with the words below, never carrying the meaning on its own.
    // The semantic focus token, not a raw ramp step: this means "the app is
    // attending to this", which is exactly what holding a candidate is.
    borderColor: colors.border.focus,
    borderWidth: 3,
  },
  guideFill: {
    // Anchored to the bottom so it reads as filling up, not sliding across.
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.border.focus,
    opacity: 0.25,
  },
  guideHint: {
    color: colors.text.inverse,
    textAlign: 'center',
    paddingHorizontal: space.xl,
  },
  guideNotice: {
    color: colors.text.inverse,
    textAlign: 'center',
    paddingHorizontal: space.xl,
    opacity: 0.9,
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
    backgroundColor: colors.surface.scrim,
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
}));
