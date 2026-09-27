import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

/**
 * The phone's Reduce Motion setting, kept current.
 *
 * Reanimated's own hook answers with the value the app started with, so a
 * person who turns motion off while the app is open keeps seeing it until they
 * relaunch. This starts from that value (no flash on the first frame) and then
 * follows the setting as it changes. On the web it reads
 * `prefers-reduced-motion` the same way.
 *
 * One subscription for the whole app, shared by every user of the hook:
 * react-native-web keys its listeners by the handler's text, so two components
 * each subscribing their own setter would remove each other's listener, and it
 * returns no subscription at all where media queries are missing.
 */
let known: boolean | null = null;
const listeners = new Set<(reduce: boolean) => void>();
let subscribed = false;

function tell(reduce: boolean) {
  known = reduce;
  for (const listener of listeners) listener(reduce);
}

function subscribeOnce() {
  if (subscribed) return;
  subscribed = true;
  AccessibilityInfo.addEventListener('reduceMotionChanged', tell);
  AccessibilityInfo.isReduceMotionEnabled()
    .then(tell)
    .catch(() => undefined);
}

export function useReduceMotionSetting(): boolean {
  const atLaunch = useReducedMotion();
  const [reduce, setReduce] = useState(known ?? atLaunch);
  useEffect(() => {
    listeners.add(setReduce);
    subscribeOnce();
    if (known !== null) setReduce(known);
    return () => {
      listeners.delete(setReduce);
    };
  }, []);
  return reduce;
}
