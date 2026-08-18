import { useEffect, useRef } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useBranch } from '../branch';
import { clearDraft, loadDraft, saveDraft } from './drafts.ts';

/**
 * Keep a screen's work on this phone (Milestone J).
 *
 * Restores once on mount and saves on every change, so an app killed by Android
 * under memory pressure — the ordinary case on the cheap handsets this product
 * targets — does not cost somebody the cart they spent two minutes scanning.
 *
 * What it deliberately does **not** do is make that work into a submission.
 * The draft is restored to the same screen, in the same unfinished state, and
 * the screen's own rules still decide whether it may be sent.
 */
export function useDraft<T>(
  form: string,
  value: T,
  restore: (value: T) => void,
  options: { enabled?: boolean } = {},
): { clear: () => void } {
  const { user } = useAuth();
  const branchId = useBranch((s) => s.branchId);
  const enabled = options.enabled ?? true;

  const scope =
    user && enabled ? { companyId: user.companyId, branchId, userId: user.id } : null;

  // Restore runs once per scope. Without this guard the save effect below would
  // immediately overwrite what was just restored with the empty initial state.
  const restored = useRef<string | null>(null);
  const key = scope ? `${scope.companyId}|${scope.branchId}|${scope.userId}` : null;

  useEffect(() => {
    if (!scope || !key || restored.current === key) return;
    restored.current = key;
    const found = loadDraft<T>(form, scope);
    if (found) restore(found.value);
    // `restore` is intentionally excluded: screens pass an inline setter, and
    // depending on it would re-restore on every render and fight the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, key]);

  useEffect(() => {
    if (!scope || !key || restored.current !== key) return;
    saveDraft(form, scope, value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, key, value]);

  return {
    clear: () => {
      if (scope) clearDraft(form, scope);
    },
  };
}
