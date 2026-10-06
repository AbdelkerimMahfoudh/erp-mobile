/**
 * Rendered tests — the ones that mount real screens with react-test-renderer
 * under jest-expo, so React Native's own checks run (a FlatList nested in a
 * same-direction ScrollView warns here exactly as it does in LogBox).
 *
 * The pure suites stay where they are and keep running under node directly
 * (`node lib/<name>.test.ts`): only `__tests__/*.test.tsx` is Jest's.
 */
const preset = require('jest-expo/jest-preset');

const [ignoreRoot, ...ignoreRest] = preset.transformIgnorePatterns;
const babel = preset.transform['\\.[jt]sx?$'];

module.exports = {
  ...preset,
  testMatch: ['<rootDir>/__tests__/**/*.test.tsx'],
  setupFiles: [...(preset.setupFiles ?? []), '<rootDir>/__tests__/setup.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/web-build/'],
  // lucide-react-native ships ES modules (`.mjs`): transformed like the app's own code.
  transform: { ...preset.transform, '\\.m?[jt]sx?$': babel },
  transformIgnorePatterns: [ignoreRoot.replace('standard-navigation))', 'standard-navigation|lucide-react-native))'), ...ignoreRest],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'node'],
};
