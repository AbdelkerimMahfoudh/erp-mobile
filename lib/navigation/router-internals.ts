/**
 * Two React Navigation symbols that Expo Router uses but does not re-export.
 *
 * ## Why this file exists
 *
 * As of SDK 56, Expo Router **vendors** React Navigation under its own
 * `build/react-navigation/` tree rather than depending on the published
 * packages, and Expo Doctor fails the project if `@react-navigation/*` are
 * installed as direct dependencies.
 *
 * That rule is not bureaucratic. A standalone `@react-navigation/elements` is a
 * *different module instance* from the vendored one, so its
 * `HeaderShownContext` is a different React context object — one no provider
 * ever fills. `useContext` on it would silently return the default forever.
 * Here that would mean {@link Screen} believing no header is shown on routes
 * that have one, reserving the status-bar inset twice, and quietly restoring
 * the ~50pt of dead space between a native title and the first line of content
 * that was already fixed once.
 *
 * Silent, and visible only to somebody holding the phone.
 *
 * ## Why the deep paths are tolerable here, and only here
 *
 * These are internal paths and they may move. They are concentrated in this one
 * module so a break is one edit rather than four, and
 * `router-internals.test.ts` asserts both resolve — so a future SDK bump that
 * moves them fails a test run instead of degrading behaviour on a device.
 *
 * If Expo Router ever exports these publicly, delete this file and import from
 * `expo-router` directly.
 */

// eslint-disable-next-line import/no-internal-modules
export { HeaderShownContext } from 'expo-router/build/react-navigation/elements/Header/HeaderShownContext';

// eslint-disable-next-line import/no-internal-modules
export { usePreventRemove } from 'expo-router/build/react-navigation/core/usePreventRemove';
