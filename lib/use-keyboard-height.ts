import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * Current on-screen keyboard height, or 0 when hidden.
 *
 * Bottom sheets need this: a sheet anchored to the bottom of the screen is
 * exactly what the keyboard covers, so a search field inside one becomes
 * invisible the moment it is focused. `KeyboardAvoidingView` handles the
 * common case but behaves differently per platform inside a `Modal`, which is
 * where sheets live — measuring directly is predictable on both.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
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
