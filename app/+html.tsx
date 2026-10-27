import React from 'react';
import { ScrollViewStyleReset, useServerDocumentContext } from 'expo-router/html';

/**
 * The browser export's page shell (web only; never part of a native bundle).
 *
 * Expo's default shell, plus one thing: **no flash of the wrong theme**. Every page is pre-rendered in light, and the
 * app's scripts arrive after the first paint — so somebody who chose dark, or whose phone is in dark mode, would see a
 * bright page and then a dark one. `public/theme-boot.js`, loaded synchronously here before the body, paints the page
 * in the stored or device theme and, with `public/theme-boot.css`, keeps the light pre-render hidden while the theme is
 * dark until `ThemeProvider` marks `data-theme-ready`.
 *
 * Both are same-origin files, never inline: a strict Content Security Policy allows them with `script-src 'self'` and
 * `style-src 'self'`. (What else a strict policy must allow — Expo's own inline hydration flag and React Native Web's
 * runtime styles — is recorded in the visual phase's integration note.)
 *
 * Since Expo SDK 58 the shell places the export's own nodes itself: `headNodes` (React Native Web's styles, the app's
 * stylesheet and script preloads) and `bodyNodes` (the app's scripts) come from `useServerDocumentContext()`. A shell
 * that leaves them out exports pages with no app in them — blank, and without a single error (D222).
 */
export default function Root({ children }: { children: React.ReactNode }) {
  const { htmlAttributes, bodyAttributes, headNodes, bodyNodes } = useServerDocumentContext();
  return (
    <html lang="en" {...htmlAttributes}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        {/* Synchronous on purpose: it must run before the body is painted. */}
        <script src="/theme-boot.js" />
        <link rel="stylesheet" href="/theme-boot.css" />
        <ScrollViewStyleReset />
        {headNodes}
      </head>
      <body {...bodyAttributes}>
        {children}
        {bodyNodes}
      </body>
    </html>
  );
}
