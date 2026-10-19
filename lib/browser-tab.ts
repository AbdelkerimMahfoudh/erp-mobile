/**
 * The web's way to read a document the app renders — a report, a customer's receipt: the page in a new tab, where the
 * browser's own Print can print it or save it as a PDF. There is no share sheet on the web.
 *
 * Only a `blob:` page made from HTML already in memory: the browser guard (`navigation/no-browser.ts`) lets a new tab
 * open for nothing else. And it must run straight from the press, before anything is awaited — a browser opens a tab
 * only for a click.
 */
export function openPageInTab(html: string): 'opened' | 'blocked' {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const tab = window.open(url, '_blank');
  // Long enough for the tab to load what it was given; it holds its own copy afterwards.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return tab ? 'opened' : 'blocked';
}
