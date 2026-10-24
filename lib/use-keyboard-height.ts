import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';
import { coveredByKeyboard } from './web-keyboard';

/**
 * Current on-screen keyboard height, or 0 when hidden.
 *
 * Bottom sheets need this: a sheet anchored to the bottom of the screen is
 * exactly what the keyboard covers, so a search field inside one becomes
 * invisible the moment it is focused. `KeyboardAvoidingView` handles the
 * common case but behaves differently per platform inside a `Modal`, which is
 * where sheets live — measuring directly is predictable on both.
 *
 * On the web (2026-10-24) React Native's keyboard events never fire, so a sheet in a phone's browser stayed where the
 * keyboard covered it. There the keyboard is measured as what it takes from the window: the part of the layout viewport
 * the visual viewport no longer shows below it. A change smaller than `WEB_KEYBOARD_MIN` is the browser's own bars
 * moving, not a keyboard, and reads as none (`web-keyboard.ts`).
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (Platform.OS === 'web') return watchWebKeyboard(setHeight);

    // iOS reports the frame before the animation; Android only on completion.
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const show = Keyboard.addListener(showEvent, (event) => {
      setHeight(event.endCoordinates?.height ?? 0);
    });
    const hide = Keyboard.addListener(hideEvent, () => setHeight(0));

    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return height;
}

interface ViewportLike {
  readonly height: number;
  readonly offsetTop: number;
  addEventListener(type: 'resize' | 'scroll', listener: () => void): void;
  removeEventListener(type: 'resize' | 'scroll', listener: () => void): void;
}

function watchWebKeyboard(set: (height: number) => void): (() => void) | undefined {
  const w = globalThis as unknown as { innerHeight?: number; visualViewport?: ViewportLike | null };
  const viewport = w.visualViewport;
  if (!viewport || typeof w.innerHeight !== 'number') return undefined;
  const update = () => set(coveredByKeyboard(w.innerHeight ?? 0, viewport));
  viewport.addEventListener('resize', update);
  viewport.addEventListener('scroll', update);
  update();
  return () => {
    viewport.removeEventListener('resize', update);
    viewport.removeEventListener('scroll', update);
  };
}
