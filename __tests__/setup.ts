/// <reference types="jest" />
/**
 * What every rendered test needs mocked: the native pieces that have no JS
 * implementation under Jest. Nothing here changes a screen's own logic.
 */
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-router', () => require('./mocks/expo-router'));
// The preset's ScrollView mock, plus the scroll context the real one provides (see mocks/ScrollView.tsx).
jest.mock('react-native/Libraries/Components/ScrollView/ScrollView', () => require('./mocks/ScrollView'));
// Worklets and Reanimated through their own Jest mocks: animations resolve at once, on the JS thread. The
// Reanimated mock predates a few hooks the app uses; they are completed here with their resting values.
jest.mock('react-native-worklets', () => require('react-native-worklets/lib/module/mock'));
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
