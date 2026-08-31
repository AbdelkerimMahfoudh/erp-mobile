import { useCallback, useRef, useState } from 'react';
import { api } from '../../lib/api-client';
import { toErrorMessage } from '../../lib/errors';
import { haptics } from '../../lib/haptics';
import type { ScanResult } from '../../types/api';

/**
 * The one scan pipeline.
 *
 *   code (camera | typed | wedge scanner) → POST /scan → ScanResult
 *
 * Everything goes through here. Resolving codes by hand — trying `/units/:id`
 * and falling back to `/products/suggest` — works, but it bypasses the
 * recognition service, so the shop's scanner never learns. Routing every scan
 * through `/scan` is what lets the system get better at recognising the
 * products this particular shop actually sells.
 *
 * Confidence thresholds mirror what the backend produces: an exact barcode
 * match scores 1, a TAC-catalogue match 0.6, and learned mappings are scored by
 * the recognition service.
 */

/** At or above this, we lead with the answer rather than asking. */
export const CONFIDENCE_HIGH = 0.8;

/**
 * A camera fires the same barcode many times a second. Without this, one
 * physical scan becomes twenty identical lookups and twenty cart lines.
 */
const DUPLICATE_WINDOW_MS = 2500;

export interface UseScanOptions {
  onResult?: (result: ScanResult) => void;
  onError?: (message: string) => void;
  /**
   * Fires the instant a code is accepted, before `/scan` is sent.
   *
   * Lets a screen start its own lookup in parallel rather than waiting for
   * recognition to return first. Sell uses it to fetch the physical unit while
   * recognition is still resolving — the two are independent, and selling is
   * the most latency-sensitive thing in the app.
   */
  onCode?: (code: string) => void;
  /** Milliseconds the same code is ignored for. */
  duplicateWindowMs?: number;
  /**
   * Run the pipeline without haptics.
   *
   * For a scan the user has ALREADY felt. The scanner buzzes when it detects an
   * identifier; sending the same identifier down `/scan` afterwards, so
   * recognition learns from it, must not buzz a second time. The device test
   * found exactly that — one physical scan, two haptics.
   */
  silent?: boolean;
}

export interface UseScanApi {
  scan: (code: string) => Promise<ScanResult | null>;
  loading: boolean;
  error: string | null;
  /** Clear the duplicate guard — call when the user is ready for the next item. */
  reset: () => void;
}

export function useScan({
  onResult,
  onError,
  onCode,
  duplicateWindowMs = DUPLICATE_WINDOW_MS,
  silent = false,
}: UseScanOptions = {}): UseScanApi {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lastCode = useRef<string | null>(null);
  const lastAt = useRef(0);
  // A second scan landing mid-request would race the first; the camera keeps
  // firing while the network is still working.
  const inFlight = useRef(false);

  const reset = useCallback(() => {
    lastCode.current = null;
    lastAt.current = 0;
    setError(null);
  }, []);

  const scan = useCallback(
    async (raw: string): Promise<ScanResult | null> => {
      const code = raw.trim();
      if (!code) return null;

      const now = Date.now();
      if (inFlight.current) return null;
      if (code === lastCode.current && now - lastAt.current < duplicateWindowMs) return null;

      lastCode.current = code;
      lastAt.current = now;
      inFlight.current = true;
      setLoading(true);
      setError(null);
      onCode?.(code);

      try {
        const result = await api.post<ScanResult>('/scan', { code });
        // Distinct feedback for "got it" vs "you'll have to help me" — the
        // employee knows which before looking at the screen.
        if (!silent) {
          if (result.recognized) haptics.success();
          else haptics.warning();
        }
        onResult?.(result);
        return result;
      } catch (e) {
        const message = toErrorMessage(e);
        if (!silent) haptics.error();
        setError(message);
        onError?.(message);
        // Let a failed code be retried immediately rather than sitting inside
        // the duplicate window.
        lastCode.current = null;
        return null;
      } finally {
        inFlight.current = false;
        setLoading(false);
      }
    },
    [duplicateWindowMs, onCode, onError, onResult, silent],
  );

  return { scan, loading, error, reset };
}
