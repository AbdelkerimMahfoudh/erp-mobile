import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Platform } from 'react-native';

/**
 * The browser's Back button inside a multi-step form (registration, owner's review of 2026-10-24).
 *
 * In the browser, Back is not a navigation action React Navigation can hold: it pops a history entry, and the screen is
 * gone with everything typed. So a form with steps keeps entries of its own, on the same address and carrying the same
 * navigation id (the router sees the same screen and keeps it mounted): one while anything is typed, and one more per
 * step moved forward. Back then pops one of them —
 *
 * - from a later step, to the step before it;
 * - from the first step with something typed, to `onLeaveFirstStep`, which asks; staying puts the entry back, leaving
 *   goes back for real.
 *
 * Nothing is written into the entries but the page's own state: no field, no step number, nothing in the address.
 * Native platforms have no browser history, and this does nothing there.
 */
export interface BrowserSteps {
  /** Moving forward one step: one more entry. */
  forward: () => void;
  /** The form's own "previous step" and the header arrow: through the browser, so its history stays in step. */
  back: () => void;
  /** Before leaving the form for good (it was accepted): the form's entries are removed, then `then` runs. */
  release: (then: () => void) => void;
}

const isWeb = Platform.OS === 'web';

export function useBrowserSteps({
  step,
  dirty,
  onStepBack,
  onLeaveFirstStep,
}: {
  step: number;
  dirty: boolean;
  onStepBack: () => void;
  /** Resolves true to leave the form, false to stay on it. */
  onLeaveFirstStep: () => Promise<boolean>;
}): BrowserSteps {
  /** How many entries this form has pushed and not yet popped. */
  const pushed = useRef(0);
  /** Set while the form pops its own entries on its way out, so those pops are not read as Back. */
  const releasing = useRef(false);
  const latest = useRef({ step, onStepBack, onLeaveFirstStep });
  useEffect(() => {
    latest.current = { step, onStepBack, onLeaveFirstStep };
  });

  const push = useCallback(() => {
    globalThis.history.pushState(globalThis.history.state, '');
    pushed.current += 1;
  }, []);

  // The guard entry, once something is typed on the first step.
  useEffect(() => {
    if (!isWeb || releasing.current) return;
    if (dirty && pushed.current === 0) push();
  }, [dirty, push]);

  useEffect(() => {
    if (!isWeb) return;
    const onPop = () => {
      if (releasing.current || pushed.current === 0) return;
      pushed.current -= 1;
      const { step: at, onStepBack: stepBack, onLeaveFirstStep: leaveFirst } = latest.current;
      if (at > 0) {
        stepBack();
        return;
      }
      void leaveFirst().then((leave) => {
        if (leave) {
          releasing.current = true;
          globalThis.history.back();
        } else {
          push();
        }
      });
    };
    globalThis.addEventListener('popstate', onPop);
    return () => globalThis.removeEventListener('popstate', onPop);
  }, [push]);

  return useMemo<BrowserSteps>(
    () => ({
      forward: () => {
        if (isWeb) push();
      },
      back: () => {
        if (isWeb && pushed.current > 0) globalThis.history.back();
        else latest.current.onStepBack();
      },
      release: (then) => {
        if (!isWeb || pushed.current === 0) {
          then();
          return;
        }
        releasing.current = true;
        const count = pushed.current;
        pushed.current = 0;
        const done = () => {
          globalThis.removeEventListener('popstate', done);
          then();
        };
        globalThis.addEventListener('popstate', done);
        globalThis.history.go(-count);
      },
    }),
    [push],
  );
}
