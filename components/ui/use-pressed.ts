import { useCallback, useMemo, useState } from 'react';

/**
 * Tracks press state without Pressable's function-style API.
 *
 * `style={({ pressed }) => …}` and the children-as-function form both look
 * cleaner, but NativeWind wraps the core components and its interop does not
 * preserve function styles on native — the returned styles are dropped
 * entirely, so backgrounds, radii and heights silently vanish. Web takes a
 * different code path and looks fine, which makes the bug easy to miss in a
 * browser and obvious the moment it runs on a phone.
 *
 * Driving the state ourselves keeps every style a plain object, which both
 * platforms handle identically.
 */
export function usePressed(): {
  pressed: boolean;
  pressHandlers: { onPressIn: () => void; onPressOut: () => void };
} {
  const [pressed, setPressed] = useState(false);

  const onPressIn = useCallback(() => setPressed(true), []);
  const onPressOut = useCallback(() => setPressed(false), []);

  const pressHandlers = useMemo(() => ({ onPressIn, onPressOut }), [onPressIn, onPressOut]);

  return { pressed, pressHandlers };
}
