/**
 * React Native ships these internal modules without declarations. The rendered
 * tests reach one of them to give the Jest ScrollView mock the real scroll
 * context (mocks/ScrollView.tsx); nothing in the app imports them.
 */
declare module 'react-native/Libraries/Components/ScrollView/ScrollViewContext' {
  import type React from 'react';
  export type Value = { horizontal: boolean } | null;
  const ScrollViewContext: React.Context<Value>;
  export default ScrollViewContext;
  export const HORIZONTAL: { horizontal: true };
  export const VERTICAL: { horizontal: false };
}
