/**
 * The one stylesheet the app imports for its side effect — `app/_layout.tsx`
 * loads `global.css`, NativeWind's entry. Metro resolves it; TypeScript has to
 * be told the module exists, or `tsc` reports TS2882 on that import — the one
 * "known error" every gate used to carry (2026-10-05).
 */
declare module '*.css';
