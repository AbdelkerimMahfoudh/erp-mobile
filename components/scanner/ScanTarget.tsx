import React, { useEffect, useRef, useState } from 'react';
import { View, type StyleProp, type ViewStyle, Keyboard } from 'react-native';
import { useTranslation } from '../../lib/i18n';
import { toast } from '../../lib/toast';
import { SearchInput } from '../ui/SearchInput';
import { ScannerSheet, type AcceptedImei } from './ScannerSheet';
import { useScan } from './useScan';
import { withDismiss } from '../../lib/keyboard-dismiss';
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
 *
 * ## This field IS the manual entry
 *
 * The text box is not decoration and not a search bar — it is the permanent
 * "type it instead" path, sitting beside the camera button that opens the
 * sheet. That is why the scanner itself no longer carries a keyboard button:
 * the choice between scanning and typing belongs here, before the camera
 * opens, not underneath a live viewfinder.
 *
 * Do not remove it, and do not put one back inside the sheet.
 */

export interface ScanTargetProps {
  onResult: (result: ScanResult) => void;
  /**
   * Open the camera once, as soon as the screen is ready for it.
   *
   * For the two Home shortcuts, whose entire purpose is "tap Sell, aim at the
   * phone" — making somebody tap a second time to reach the camera is the tap
   * the shortcut exists to remove.
   *
   * **Once.** Closing the camera must leave it closed: the person who shut it
   * wants the field below, and a viewfinder that springs back is a screen that
   * cannot be escaped. Pass `false` until branch and permissions have resolved,
   * so the camera never opens in front of a screen that is about to say the
   * user may not sell.
   *
   * This is NOT the `autoFocus` prop that was deliberately removed (see below).
   * That one raised a KEYBOARD over a scan-first screen, hiding the thing the
   * user came for. This opens the scanner itself — the thing they came for.
   */
  autoOpenCamera?: boolean;
  /**
   * One accepted phone, complete.
   *
   * Fires the moment the user taps "Use this IMEI", carrying the classified
   * payload and TAC suggestion alongside the identifiers — so the page can
   * show what was scanned immediately, while the scanner closes itself.
   */
  onImeiAccepted?: (accepted: AcceptedImei) => void;
  /** Fires the moment a code is accepted, before recognition returns. */
  onCodeCaptured?: (code: string) => void;
  placeholder?: string;
  /** Keep the camera open across scans — for receiving a delivery. */
  mode?: 'single' | 'continuous';
  /** Tally shown inside the camera in continuous mode. */
  scannedCount?: number;
  style?: StyleProp<ViewStyle>;
}

/*
 * There is deliberately no `autoFocus` prop any more.
 *
 * It used to exist and two pages passed it, so opening Sell or Receive put the
 * keyboard over most of the screen before anybody had asked to type. On a
 * scan-first page that is backwards: the camera and the list are what somebody
 * came for, and the keypad is the fallback. Removing the prop rather than
 * defaulting it to false means a future page cannot reintroduce the behaviour
 * by passing one word.
 */

export function ScanTarget({
  onResult,
  onImeiAccepted,
  onCodeCaptured,
  autoOpenCamera = false,
  placeholder,
  mode = 'single',
  scannedCount,
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

  /** Dismiss, then open. The order is the point — see the call site. */
  const openCamera = withDismiss(Keyboard, () => setCameraOpen(true));

  /*
   * The shortcut's automatic opening — exactly once.
   *
   * A ref rather than state, and deliberately NOT depending on `cameraOpen`:
   * depending on it would reopen the viewfinder the instant somebody closed it,
   * leaving a screen with no way out. Closing it is a decision, and it stands.
   *
   * No keyboard dismissal here, unlike `openCamera`: nothing has been typed yet
   * on a screen that has only just mounted, so there is nothing to dismiss.
   */
  const autoOpened = useRef(false);
  useEffect(() => {
    if (!autoOpenCamera || autoOpened.current) return;
    autoOpened.current = true;
    setCameraOpen(true);
  }, [autoOpenCamera]);

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
        /*
         * The keyboard goes first, then the camera — and in that order.
         *
         * Opening a full-screen viewfinder over a raised keyboard leaves the
         * preview squeezed into what is left, and on Android the window resize
         * fights the modal as it animates in. `withDismiss` fixes the ordering
         * in one place and, being an ordinary function, lets a test call it and
         * watch what happened rather than read the source and hope.
         */
        onScanPress={openCamera}
        placeholder={placeholder ?? t('scanner.manual.placeholder')}
        identifier
      />

      <ScannerSheet
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onResult={onResult}
        onImeiAccepted={onImeiAccepted}
        mode={mode}
        scannedCount={scannedCount}
      />
    </View>
  );
}
