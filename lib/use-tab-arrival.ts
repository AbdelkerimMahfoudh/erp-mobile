import { useEffect, useLayoutEffect, useRef } from 'react';
import { useNavigation, useRoute } from 'expo-router';
import { leftTab } from './tab-arrival';

/**
 * Today on every arrival at a tab that owns a period — the app's launch, the
 * first visit, or coming back from another tab — while whatever the person
 * then picks there stays: a refetch, a screen opened from the tab and the way
 * back from it are not an arrival.
 *
 * `useFocusEffect` would fire on the way back from a pushed screen too, and a
 * mounted tab never sees its own route change, so leaving is read from the tab
 * bar's state (`leftTab`), and the choice goes back to Today then, before the
 * person returns.
 */
export function useTodayOnArrival(reset: () => void): void {
  const latest = useRef(reset);
  useEffect(() => {
    latest.current = reset;
  }, [reset]);
  const navigation = useNavigation();
  const route = useRoute();
  // The first visit, before the first paint, so it never shows or fetches a choice made elsewhere.
  useLayoutEffect(() => latest.current(), []);
  useEffect(
    () =>
      navigation.addListener('state', (e) => {
        if (leftTab(e.data.state, route.key)) latest.current();
      }),
    [navigation, route.key],
  );
}
