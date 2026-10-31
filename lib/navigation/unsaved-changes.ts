import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useFocusEffect, useNavigation } from 'expo-router';
import { dialog } from '../dialog';
import { useTranslation } from '../i18n';
import { usePreventRemove, useRoute, useRoutesWithRemovalPrevented } from './router-internals';

/**
 * The one unsaved-changes guard every form uses (2026-10-31).
 *
 * Every exit — the header arrow, the swipe, Android's back button, a link — is one navigation
 * action, and this stops it while `dirty`, asks once, and on "Discard changes" lets exactly that
 * action through exactly once.
 *
 * Why it is shared: each screen hand-rolled it, and each did it in a way that froze the app on the
 * owner's iPhone. Replaying the blocked action while the screen was still marked dirty was blocked
 * again — the replay did nothing, or asked a second time while the first dialog's modal was still
 * being taken down, which iOS cannot present: an invisible modal then swallowed every touch. Even the
 * router's own `repeat()` lifts the prevention through React state that has not been committed when
 * it replays, so it is blocked the same way.
 *
 * So the order here is fixed:
 * 1. the answer is given, and the dialog's modal is allowed to go away completely (`dialog.afterClose`);
 * 2. the draft is reset (`onDiscard`) and the blocked action is kept, which turns the prevention off;
 * 3. once that is committed, the action is dispatched — one time.
 *
 * - "Keep editing" changes nothing: the form and its draft stay exactly as they were.
 * - "Discard changes" never saves: `onDiscard` puts the saved values back.
 * - A second exit while the question is up, or while leaving, is ignored: rapid presses ask once.
 * - `bypass` lets a screen's own deliberate exit (after a save) through without asking.
 */
export interface UnsavedChangesGuard {
  dirty: boolean;
  /** Put the unsaved draft back to its saved state. Called once, just before leaving. */
  onDiscard?: () => void;
  /** Set to true just before the screen leaves on purpose; the guard then asks nothing. */
  bypass?: MutableRefObject<boolean>;
}

type BlockedAction = Parameters<Parameters<typeof usePreventRemove>[1] & {}>[0]['data']['action'];

export function useUnsavedChangesGuard({ dirty, onDiscard, bypass }: UnsavedChangesGuard): void {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const asking = useRef(false);
  const [leaving, setLeaving] = useState<BlockedAction | null>(null);

  // Coming back to the screen (a removal that did not happen) re-arms the guard.
  useFocusEffect(
    useCallback(() => {
      setLeaving(null);
    }, []),
  );

  usePreventRemove(dirty && leaving === null, ({ data }) => {
    if (bypass?.current) {
      setLeaving(data.action);
      return;
    }
    if (asking.current) return;
    asking.current = true;
    void (async () => {
      try {
        const discard = await dialog.confirm({
          title: t('unsaved.title'),
          message: t('unsaved.body'),
          confirmLabel: t('unsaved.discard'),
          cancelLabel: t('unsaved.keep'),
          tone: 'danger',
        });
        if (!discard) return;
        await dialog.afterClose();
        onDiscard?.();
        setLeaving(data.action);
      } finally {
        asking.current = false;
      }
    })();
  });

  // Dispatched only once the router itself no longer counts this route as prevented. Lifting the
  // prevention here reaches the router a render or two later, and an action dispatched in between
  // is still blocked — and then dropped without a word, because this screen no longer asks.
  const route = useRoute();
  const stillPrevented = useRoutesWithRemovalPrevented().has(route.key);
  const dispatched = useRef<BlockedAction | null>(null);
  useEffect(() => {
    if (!leaving || stillPrevented || dispatched.current === leaving) return;
    dispatched.current = leaving;
    navigation.dispatch(leaving);
  }, [leaving, stillPrevented, navigation]);
}
