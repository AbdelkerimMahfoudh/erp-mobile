// The browser ERP's visual-quality checks (owner's iPhone review, 2026-10-24), in Chromium or WebKit.
//
// APP      the served web export (required)
// BROWSER  chromium | webkit (default chromium)
// OWNER    optional path to {"identifier","password"} of a FICTIONAL test Owner on a disposable API: adds the signed-in
//          routes (Team, its sheet, Settings and every exported route). Never a real account; nothing is printed.
// PW       optional path to the playwright module.
// OUT      optional directory for a JSON result.
//
// Automation on Linux — not a physical iPhone. Prints facts only.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const pw = require(process.env.PW ?? 'playwright');
const engine = process.env.BROWSER === 'webkit' ? pw.webkit : pw.chromium;
const APP = process.env.APP;
const OWNER = process.env.OWNER ? JSON.parse(readFileSync(process.env.OWNER, 'utf8')) : null;
const ROUTES = (process.env.ROUTES ?? '').split(/\s+/).filter(Boolean);

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? ` — ${detail}` : ''}`);
};

const browser = await engine.launch();
async function open({ lang = 'en', theme, width = 390, height = 844, scheme = 'light' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, locale: lang === 'ar' ? 'ar' : lang === 'fr' ? 'fr-FR' : 'en-US' });
  await context.addInitScript(([l, t]) => {
    try {
      if (!sessionStorage.getItem('vc.init')) {
        localStorage.setItem('erp.language', l);
        if (t) localStorage.setItem('erp.theme', t);
        sessionStorage.setItem('vc.init', '1');
      }
    } catch {}
  }, [lang, theme ?? null]);
  const page = await context.newPage();
  return { context, page };
}
const settle = (page) => page.waitForTimeout(700);

// ── page facts, measured in the page ─────────────────────────────────────────────────────────────────────────────────
const FACTS = () => {
  const vw = window.innerWidth;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0;
  };
  const parseRgb = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(',').map((x) => Number(x.trim()));
    return { r, g, b, a };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const bgOf = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const c = parseRgb(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.9) return c;
    }
    return parseRgb(getComputedStyle(document.documentElement).backgroundColor) ?? { r: 255, g: 255, b: 255 };
  };
  const disabled = (el) => !!el.closest('[aria-disabled="true"],[disabled]');
  const dimmed = (el) => {
    for (let n = el; n; n = n.parentElement) if (Number(getComputedStyle(n).opacity) < 1) return true;
    return false;
  };
  // Text leaves: elements whose own text is non-empty.
  const texts = [...document.querySelectorAll('body *')].filter(
    (el) => visible(el) && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && !el.closest('script,style'),
  );
  const lowContrast = [];
  for (const el of texts) {
    if (disabled(el) || dimmed(el) || el.closest('input,textarea')) continue;
    const s = getComputedStyle(el);
    const fg = parseRgb(s.color);
    if (!fg) continue;
    const bg = bgOf(el);
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    const ratio = (a + 0.05) / (b + 0.05);
    const size = parseFloat(s.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5)) lowContrast.push(`${el.textContent.trim().slice(0, 30)} ${ratio.toFixed(2)}`);
  }
  // Text that touches the control below it: a text leaf whose box ends less than 4px above a button or input it overlaps
  // horizontally, with nothing between.
  const controls = [...document.querySelectorAll('[role="button"],button,input,textarea,[role="checkbox"],[role="switch"],[role="tab"],[role="radio"]')].filter(visible);
  const touching = [];
  // Only text and a control in the same scrolling region: not a line scrolled under the fixed tab bar, not the page
  // behind an open sheet.
  const scroller = (el) => {
    for (let n = el.parentElement; n; n = n.parentElement) {
      const o = getComputedStyle(n).overflowY;
      if (o === 'auto' || o === 'scroll') return n;
    }
    return document.documentElement;
  };
  const modal = document.querySelector('[aria-modal="true"]');
  for (const el of texts) {
    if (modal && !modal.contains(el)) continue;
    if (el.closest('[role="button"],button,input,textarea,[role="checkbox"],[role="switch"],[role="tab"],[role="radio"]')) continue;
    const t = el.getBoundingClientRect();
    for (const c of controls) {
      const r = c.getBoundingClientRect();
      const overlapX = Math.min(t.right, r.right) - Math.max(t.left, r.left);
      const gap = r.top - t.bottom;
      if (scroller(c) !== scroller(el)) continue;
      if (overlapX > 8 && gap > -1 && gap < 4) touching.push(`"${el.textContent.trim().slice(0, 40)}" → ${Math.round(gap)}px`);
    }
  }
  // Content past the viewport edge: any visible element whose box leaves the page horizontally.
  const clipped = [...document.querySelectorAll('body *')]
    .filter((el) => visible(el) && !el.closest('[data-testid="scroll-x"]'))
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.left < -1 || r.right > vw + 1).length;
  return { overflow: document.documentElement.scrollWidth - vw, lowContrast, touching, clipped };
};

async function pageFacts(page, label) {
  const f = await page.evaluate(FACTS);
  check(`${label}: no horizontal overflow`, f.overflow <= 0, `${f.overflow}px`);
  check(`${label}: nothing is pushed past the screen's edge`, f.clipped === 0, `${f.clipped} element(s)`);
  check(`${label}: no text touches the control under it`, f.touching.length === 0, f.touching.slice(0, 3).join(' | '));
  check(`${label}: text contrast meets WCAG AA`, f.lowContrast.length === 0, f.lowContrast.slice(0, 3).join(' | '));
  return f;
}

const toggleBox = async (page) => page.getByTestId('theme-toggle').first().boundingBox();
const themeOf = (page) => page.evaluate(() => document.documentElement.dataset.theme);

// ── 1. the authentication pages: every language, both themes, every width ─────────────────────────────────────────────
const AUTH = ['login', 'register', 'setup', 'join', 'verify'];
for (const lang of process.env.SKIP_MATRIX ? [] : ['en', 'fr', 'ar']) {
  for (const theme of ['light', 'dark']) {
    for (const width of [320, 375, 390, 768, 1280, 640]) {
      const { context, page } = await open({ lang, theme, width });
      for (const route of AUTH) {
        if (route !== 'login' && !(width === 390 || width === 1280 || width === 320)) continue;
        await page.goto(`${APP}/${route}`);
        await settle(page);
        const label = `${route} ${lang} ${theme} ${width}${width === 640 ? ' (1280 at 200%)' : ''}`;
        await pageFacts(page, label);
        const box = await toggleBox(page);
        check(`${label}: the theme toggle is visible without scrolling, at least 44×44`, box && box.y >= 0 && box.y + box.height <= 844 && box.width >= 44 && box.height >= 44, box ? `${Math.round(box.width)}×${Math.round(box.height)} at y ${Math.round(box.y)}` : 'missing');
        if (box) {
          const rtlStart = lang === 'ar' ? box.x < width / 2 : box.x > width / 2;
          check(`${label}: the toggle sits at the header's end (${lang === 'ar' ? 'left' : 'right'})`, rtlStart);
        }
        if (width >= 1280) {
          const w = await page.evaluate(() => Math.max(...[...document.querySelectorAll('input')].map((i) => i.getBoundingClientRect().width), 0));
          check(`${label}: the form keeps a phone-form width on a desktop`, w > 0 ? w <= 520 : true, `${Math.round(w)}px`);
        }
      }
      await context.close();
    }
  }
}

// ── 2. the theme: first visit, persistence, no flash, values kept ─────────────────────────────────────────────────────
{
  const { context, page } = await open({ scheme: 'dark' });
  const first = await page.goto(`${APP}/login`, { waitUntil: 'commit' });
  void first;
  await page.waitForSelector('html[data-theme]', { state: 'attached' });
  const early = await page.evaluate(() => ({ t: document.documentElement.dataset.theme, bg: getComputedStyle(document.documentElement).backgroundColor, hidden: getComputedStyle(document.getElementById('root') ?? document.body).visibility }));
  check('first visit with the device in dark: the page is dark before the app starts', early.t === 'dark' && early.bg !== 'rgb(241, 243, 248)', `${early.t} ${early.bg}`);
  await settle(page);
  check('first visit with the device in dark: the app opens dark', (await themeOf(page)) === 'dark');
  await page.getByTestId('theme-toggle').first().click();
  await settle(page);
  check('the toggle switches to light, and stores it', (await themeOf(page)) === 'light' && (await page.evaluate(() => localStorage.getItem('erp.theme'))) === 'light');
  await page.reload();
  await settle(page);
  check('the choice survives a reload, over the device’s dark', (await themeOf(page)) === 'light');
  await context.close();
}
{
  const { context, page } = await open({ scheme: 'light' });
  await page.goto(`${APP}/login`);
  await settle(page);
  check('first visit with the device in light: light', (await themeOf(page)) === 'light');
  // Keyboard: the toggle is reached with Tab and pressed with Enter.
  let reached = false;
  for (let i = 0; i < 6 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'theme-toggle');
  }
  if (reached) await page.keyboard.press('Enter');
  await settle(page);
  check('the toggle is reached by keyboard and switches with Enter', reached && (await themeOf(page)) === 'dark');
  const name = await page.getByTestId('theme-toggle').first().getAttribute('aria-label');
  check('the toggle has an accessible name in words', !!name && name.length > 5, name ?? '');
  await context.close();
}
for (const lang of ['fr', 'ar']) {
  const { context, page } = await open({ lang, theme: 'light' });
  await page.goto(`${APP}/login`);
  await settle(page);
  const name = await page.getByTestId('theme-toggle').first().getAttribute('aria-label');
  check(`the toggle's name is localised (${lang})`, !!name && !/Switch to/.test(name), name ?? '');
  await context.close();
}

// ── 3. registration: three steps, values kept, Back is a step, theme keeps everything ─────────────────────────────────
for (const lang of ['en', 'fr', 'ar']) {
  const { context, page } = await open({ lang, theme: 'light', width: 375 });
  await page.goto(`${APP}/login`);
  await settle(page);
  await page.goto(`${APP}/register`);
  await settle(page);
  const boxes = () => page.locator('input');
  const next = page.getByTestId('register-next');
  await next.click();
  await settle(page);
  const focusedFirst = await page.evaluate(() => document.activeElement === document.querySelectorAll('input')[0]);
  check(`register ${lang}: Continue on an empty step focuses its first field`, focusedFirst);
  await boxes().nth(0).fill('Boutique Exemple');
  check(`register ${lang}: a refused field still accepts typing`, (await boxes().nth(0).inputValue()) === 'Boutique Exemple');
  await boxes().nth(1).fill('Centre');
  await boxes().nth(2).fill('Rosso');
  await page.getByTestId('theme-toggle').first().click();
  await settle(page);
  check(`register ${lang}: switching theme keeps every value`, (await boxes().nth(0).inputValue()) === 'Boutique Exemple' && (await boxes().nth(2).inputValue()) === 'Rosso');
  await next.click();
  await settle(page);
  check(`register ${lang}: step 2 of 3`, (await page.locator('input').count()) === 1);
  await boxes().nth(0).fill('Aminetou Exemple');
  await page.goBack();
  await settle(page);
  const backToStep1 = (await boxes().count()) === 3 && (await boxes().nth(0).inputValue()) === 'Boutique Exemple';
  check(`register ${lang}: the browser's Back goes to the previous step with its values`, backToStep1, `url ${new URL(page.url()).pathname}`);
  await next.click();
  await settle(page);
  check(`register ${lang}: forward again keeps the Owner's name`, (await boxes().nth(0).inputValue()) === 'Aminetou Exemple');
  await next.click();
  await settle(page);
  check(`register ${lang}: the last step holds the number, email and both passwords`, (await boxes().count()) === 4);
  const url = page.url();
  check(`register ${lang}: nothing typed is in the address`, !/Boutique|Aminetou|Rosso/.test(decodeURIComponent(url)));
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  check(`register ${lang}: nothing typed is in storage`, !/Boutique|Aminetou|Rosso/.test(stored));
  await pageFacts(page, `register step 3 ${lang} light 375`);
  // Back from the last step twice: the first step, still filled; once more asks before leaving, and staying stays.
  await page.goBack();
  await settle(page);
  await page.goBack();
  await settle(page);
  check(`register ${lang}: Back twice from the last step is the first step, still filled`, (await boxes().count()) === 3 && (await boxes().nth(2).inputValue()) === 'Rosso');
  await page.goBack();
  await settle(page);
  const asked = (await page.getByRole('dialog').count()) > 0 || (await page.locator('[aria-modal="true"]').count()) > 0;
  check(`register ${lang}: Back from a typed first step asks before leaving`, asked && new URL(page.url()).pathname.endsWith('/register'));
  // Confirming leaves for sign-in.
  const LEAVE = { en: 'Leave', fr: 'Quitter', ar: 'مغادرة' }[lang];
  await page.getByText(LEAVE, { exact: true }).last().click();
  await page.waitForTimeout(1200);
  check(`register ${lang}: confirming Leave reaches sign-in`, new URL(page.url()).pathname.endsWith('/login'), new URL(page.url()).pathname);
  await context.close();
}

// ── 4. signed in (a fictional test Owner on a disposable API) ───────────────────────────────────────────────────────────
if (OWNER) {
  const signIn = async (page) => {
    await page.goto(`${APP}/login`);
    await settle(page);
    await page.locator('input').nth(0).fill(OWNER.identifier);
    await page.locator('input').nth(1).fill(OWNER.password);
    await page.locator('input').nth(1).press('Enter');
    await page.waitForURL(/select-branch|\/$/, { timeout: 20000 });
    if (page.url().includes('select-branch')) {
      await page.locator('[role="button"]').filter({ hasText: /Zeina|Tevragh/ }).first().click();
      await page.waitForTimeout(2000);
    }
  };
  for (const [lang, theme, width] of [['fr', 'light', 390], ['ar', 'dark', 320], ['en', 'light', 1280], ['en', 'dark', 375]]) {
    const { context, page } = await open({ lang, theme, width });
    await signIn(page);
    await page.goto(`${APP}/team`);
    await settle(page);
    await pageFacts(page, `team ${lang} ${theme} ${width}`);
    const gap = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('[role="button"]')].find((b) => /membre|member|عضو/.test(b.textContent));
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      const above = [...document.querySelectorAll('div[dir="auto"]')].map((d) => d.getBoundingClientRect()).filter((d) => d.bottom <= r.top + 1 && d.right > r.left && d.left < r.right);
      return above.length ? Math.round(r.top - Math.max(...above.map((d) => d.bottom))) : null;
    });
    check(`team ${lang} ${theme} ${width}: the description is at least 12 from the Add button`, gap !== null && gap >= 12, `${gap}px`);
    if (width >= 1280) {
      const w = await page.evaluate(() => Math.max(...[...document.querySelectorAll('[role="button"]')].map((b) => b.getBoundingClientRect().width)));
      check(`team ${lang} ${width}: content keeps a reading width on a desktop`, w <= 780, `${Math.round(w)}px`);
    }
    // The sheet: the primary action can be reached by scrolling inside it.
    const add = page.locator('[role="button"]').filter({ hasText: /membre|member|عضو/ }).first();
    if (await add.count()) {
      await add.click();
      await page.waitForTimeout(900);
      const submit = page.locator('[role="button"]').filter({ hasText: /Add to the team|Ajouter à l’équipe|إضافة إلى الفريق/ }).last();
      await submit.scrollIntoViewIfNeeded().catch(() => {});
      const b = await submit.boundingBox();
      const vh = page.viewportSize().height;
      check(`team sheet ${lang} ${theme} ${width}: the primary action can be brought into view`, b && b.y >= 0 && b.y + b.height <= vh + 1, b ? `y ${Math.round(b.y)}` : 'missing');
      await pageFacts(page, `team sheet ${lang} ${theme} ${width}`);
    }
    await context.close();
  }
  // Every exported route, signed in: overflow and touching text, light and dark, a phone and a desktop.
  if (ROUTES.length) {
    for (const [theme, width] of [['light', 390], ['dark', 1280]]) {
      const { context, page } = await open({ lang: 'en', theme, width });
      await signIn(page);
      const bad = [];
      for (const route of ROUTES) {
        await page.goto(`${APP}/${route}`);
        await page.waitForTimeout(1200);
        const f = await page.evaluate(FACTS);
        if (f.overflow > 0 || f.touching.length) bad.push(`${route}: overflow ${f.overflow}, touching ${f.touching.slice(0, 2).join('; ')}`);
      }
      check(`every exported route (${ROUTES.length}) ${theme} ${width}: no overflow, no text touching a control`, bad.length === 0, bad.slice(0, 6).join(' || '));
      await context.close();
    }
  }
}

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed (${process.env.BROWSER ?? 'chromium'})`);
if (process.env.OUT) {
  mkdirSync(process.env.OUT, { recursive: true });
  writeFileSync(`${process.env.OUT}/visual-check-${process.env.BROWSER ?? 'chromium'}.json`, JSON.stringify(results, null, 2));
}
process.exit(failed ? 1 : 0);
