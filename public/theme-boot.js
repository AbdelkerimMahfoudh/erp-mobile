/*
 * Dukan ERP — the browser page's theme before the app starts (web export only).
 *
 * A file of its own, never inline, so a strict Content Security Policy needs only `script-src 'self'` for it.
 * `app/+html.tsx` loads it synchronously in <head>, before the body is painted: it picks the theme exactly as
 * `ThemeProvider` will — the stored choice (`erp.theme`), else dark (D226) — and paints the page in it.
 * While that theme is dark, `theme-boot.css` keeps the light pre-rendered page hidden until the app marks
 * `data-theme-ready`. It reads one preference and writes nothing; it sends nothing anywhere.
 *
 * The key and the two canvas colours are checked against `lib/design/theme.tsx` and `lib/design/colors.ts` by
 * `lib/design/theme.test.ts`: change them there, and here.
 */
(function () {
  var theme = 'dark';
  try {
    var stored = window.localStorage.getItem('erp.theme');
    if (stored === 'dark' || stored === 'light') theme = stored;
  } catch (e) {
    // Storage blocked (a private window): the default, dark (D226).
  }
  var root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.style.colorScheme = theme;
  root.style.backgroundColor = theme === 'dark' ? '#0B0F17' : '#F1F3F8';
})();
