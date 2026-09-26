import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useBranch } from '../branch';
import { clearDraft, loadDraft, saveDraft } from './drafts.ts';
import { devTiming } from '../dev-timing.ts';

/**
 * Keep a screen's work on this phone (Milestone J, extended in J.1).
 *
 * Restores once per scope on mount and saves on every change, so an app killed
 * by Android under memory pressure — the ordinary case on the cheap handsets
 * this product targets — does not cost somebody the work they were half-way
 * through.
 *
 * What it deliberately does **not** do is make that work a submission. The
 * draft returns to the same screen in the same unfinished state, the screen's
 * own rules still decide whether it may be sent, and anything the server owns
 * is re-fetched rather than restored.
 *
 * `restoredAt` is returned so the screen can **say** it restored something.
 * Silently repopulating a form is how somebody submits yesterday's numbers
 * believing they typed them today.
 */
export interface DraftHandle {
  /** When the restored draft was written, or null if nothing was restored. */
  restoredAt: number | null;
  /** Stop showing the restored notice, without discarding the work. */
  acknowledge: () => void;
  /** Confirmed acceptance, or an explicit discard by the person. Nothing else. */
  clear: () => void;
  /** True when a write was refused — a forbidden field, or too large. */
  refused: boolean;
}

export function useDraft<T>(
  form: string,
  value: T,
  restore: (value: T) => void,
  options: {
    /** Bump when this form's shape changes; older payloads are quarantined. */
    payloadVersion?: number;
    /** The subject, when there is one — a return id, a loan id. */
    recordId?: string | null;
    /** Skip persistence entirely, e.g. once a screen reaches its done state. */
    enabled?: boolean;
  } = {},
): DraftHandle {
  const { user } = useAuth();
  const branchId = useBranch((s) => s.branchId);
  const { payloadVersion = 1, recordId = null, enabled = true } = options;

  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const [refused, setRefused] = useState(false);

  const scope = user ? { companyId: user.companyId, branchId, userId: user.id } : null;
  const key = scope ? `${scope.companyId}|${scope.branchId}|${scope.userId}|${recordId}` : null;

  /*
    Restoring runs once per scope. Without the guard the save effect below would
    immediately overwrite what was just restored with the screen's empty initial
    state — the draft would be destroyed by the act of reading it.
  */
  const restoredFor = useRef<string | null>(null);

  useEffect(() => {
    if (!scope || !key || !enabled || restoredFor.current === key) return;
    restoredFor.current = key;
    const found = loadDraft<T>(form, scope, payloadVersion, recordId);
    if (found) {
      restore(found.value);
      setRestoredAt(found.savedAt);
    }
    // `restore` is intentionally excluded: screens pass an inline setter, and
    // depending on it would re-restore on every render and fight the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, key, enabled, payloadVersion, recordId]);

  useEffect(() => {
    if (!scope || !key || !enabled || restoredFor.current !== key) return;
    const result = devTiming.time(`draft written (${form})`, () => saveDraft(form, scope, value, payloadVersion, recordId));
    /*
     * Refused means THIS payload was rejected — a forbidden field or an
     * oversized draft (see `DraftNotice`). Neither an I/O hiccup nor a platform
     * that keeps no drafts at all (`unsupported`, i.e. web) is a refusal: the
     * latter used to put "this could not be saved" on every draft screen in a
     * browser, blaming the form for a storage decision.
     */
    setRefused(!result.saved && result.reason !== 'io' && result.reason !== 'unsupported');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, key, enabled, payloadVersion, recordId, value]);

  const clear = useCallback(() => {
    if (scope) clearDraft(form, scope, recordId);
    setRestoredAt(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, key, recordId]);

  return {
    restoredAt,
    acknowledge: () => setRestoredAt(null),
    clear,
    refused,
  };
}
