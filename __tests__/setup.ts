/// <reference types="jest" />
/**
 * What every rendered test needs mocked: the native pieces that have no JS
 * implementation under Jest. Nothing here changes a screen's own logic.
 */
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
// Gesture Handler 3's own Jest setup: its native module and detectors, mocked as the library ships them.
require('react-native-gesture-handler/jestSetup');
jest.mock('expo-router', () => require('./mocks/expo-router'));
// The preset's ScrollView mock, plus the scroll context the real one provides (see mocks/ScrollView.tsx).
jest.mock('react-native/Libraries/Components/ScrollView/ScrollView', () => require('./mocks/ScrollView'));
// Worklets and Reanimated through their own Jest mocks: animations resolve at once, on the JS thread. The
// Reanimated mock predates a few hooks the app uses; they are completed here with their resting values.
jest.mock('react-native-worklets', () => require('react-native-worklets/lib/module/mock'));
// Reanimated 4.7 (SDK 58) under Jest: the iOS preset resolves its native initializer, which hands a CSS event handler to
// the JS module Jest gets instead of the native one — and that module throws by design. The platform-neutral
// initializer is the one that fits Jest: it registers nothing native.
jest.doMock('react-native-reanimated/src/initializers', () =>
  jest.requireActual('react-native-reanimated/src/initializers.ts'),
);
jest.mock('react-native-reanimated', () => {
  const mock = require('react-native-reanimated/mock');
  return {
    ...mock,
    useReducedMotion: () => false,
    ReduceMotion: { System: 'system', Always: 'always', Never: 'never' },
    useAnimatedReaction: () => undefined,
    runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
    runOnUI: (fn: (...args: unknown[]) => unknown) => fn,
  };
});
