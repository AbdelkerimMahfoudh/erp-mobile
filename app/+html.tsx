import React from 'react';
import { ScrollViewStyleReset } from 'expo-router/html';
import { darkColors, lightColors } from '../lib/design/colors';
import { THEME_STORAGE_KEY } from '../lib/design/theme';

/**
 * The browser export's page shell (web only; never part of a native bundle).
 *
 * Expo's default shell, plus one thing: **no flash of the wrong theme**. Every
 * page is pre-rendered in light, and the app's scripts arrive after the first
 * paint — so somebody who chose dark, or whose phone is in dark mode, would see
 * a bright page and then a dark one. The script below runs before the body is
 * painted: it picks the theme exactly as `ThemeProvider` will (the stored
 * choice, else the device's appearance), paints the page background in it, and
 * while that theme is dark keeps the light pre-rendered content hidden until
 * the app says its theme is applied (`data-theme-ready`, set by
 * `ThemeProvider`). Nothing here is stored or sent anywhere.
 */
const BOOT = `(function(){var t='light';try{var s=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(s==='dark'||s==='light')t=s;else if(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)t='dark';}catch(e){}var r=document.documentElement;r.setAttribute('data-theme',t);r.style.colorScheme=t;r.style.backgroundColor=t==='dark'?${JSON.stringify(
  darkColors.surface.canvas,
)}:${JSON.stringify(lightColors.surface.canvas)};})();`;

const STYLE = `html[data-theme="dark"]:not([data-theme-ready]) #root{visibility:hidden}body{background-color:transparent}`;

export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <script dangerouslySetInnerHTML={{ __html: BOOT }} />
        <style dangerouslySetInnerHTML={{ __html: STYLE }} />
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
