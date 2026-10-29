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
  // Content past the screen's edge: a visible leaf (text, icon) or control that leaves the screen, unless it sits in a
  // row that scrolls sideways on purpose (a chip row). Layout wrappers are not counted; what they hold is.
  const inScroller = (el) => {
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const o = getComputedStyle(n).overflowX;
      if ((o === 'auto' || o === 'scroll') && n.scrollWidth > n.clientWidth + 1) return true;
    }
    return false;
  };
  const clipped = [...document.querySelectorAll('body *')]
    .filter((el) => visible(el) && (el.children.length === 0 || el.matches('[role="button"],button,input,textarea,[role="switch"]')))
    .filter((el) => { const r = el.getBoundingClientRect(); return r.left < -1 || r.right > vw + 1; })
    .filter((el) => !inScroller(el)).length;
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
  // The step's own fields. The first step also offers the promo code's six digit boxes (D221, 0103), counted apart.
  const boxes = () => page.locator('input:not([data-testid^="promo-digit-"])');
  const promoDigits = await page.locator('input[data-testid^="promo-digit-"]').count();
  check(`register ${lang}: the first step offers the promo code, six digit boxes (D221)`, promoDigits === 6, `${promoDigits}`);
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

// ── 3b. the routes not edited by this phase get the shared header, and switching theme keeps what is typed ─────────────
for (const lang of ['en', 'fr', 'ar']) {
  for (const route of ['setup', 'join', 'verify']) {
    const { context, page } = await open({ lang, theme: 'light', width: 390 });
    await page.goto(`${APP}/${route}`);
    await settle(page);
    const header = await page.evaluate(() => {
      const t = document.querySelector('[data-testid="theme-toggle"]');
      const bar = t?.parentElement;
      return { toggle: !!t, identity: !!bar && /Dukan ERP/.test(bar.textContent ?? ''), dir: getComputedStyle(document.body).direction };
    });
    check(`${route} ${lang}: the shared header (Dukan ERP and the theme toggle) is shown`, header.toggle && header.identity);
    const inputs = page.locator('input');
    const n = await inputs.count();
    const typed = [];
    for (let i = 0; i < n; i++) {
      if (!(await inputs.nth(i).isEditable())) continue;
      await inputs.nth(i).fill(route === 'verify' ? '123456' : `Exemple-${i}-${route}`);
      // What the field holds after its own filtering (a code field keeps digits) is what must survive.
      typed.push([i, await inputs.nth(i).inputValue()]);
    }
    await page.getByTestId('theme-toggle').first().click();
    await settle(page);
    let kept = typed.length > 0;
    for (const [i, v] of typed) if ((await inputs.nth(i).inputValue()) !== v) kept = false;
    check(`${route} ${lang}: switching theme keeps every typed value (${typed.length} field(s))`, kept && (await themeOf(page)) === 'dark');
    await context.close();
  }
}

// ── 3c. the three steps are one submission: nothing reaches the server before the last step's button ────────────────
{
  const { context, page } = await open({ lang: 'fr', theme: 'light', width: 390 });
  const posts = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET' && /\/auth\/register/.test(r.url())) posts.push(r.url().replace(/^.*\/api\/v1/, ''));
  });
  await page.goto(`${APP}/register`);
  await settle(page);
  const boxes = page.locator('input');
  await boxes.nth(0).fill('Boutique Exemple');
  await boxes.nth(1).fill('Centre');
  await page.getByTestId('register-next').click();
  await settle(page);
  await boxes.nth(0).fill('Aminetou Exemple');
  await page.getByTestId('register-next').click();
  await settle(page);
  check('registration: no request to auth/register while moving through the steps', posts.length === 0, posts.join(', '));
  await boxes.nth(0).fill('+22241999777');
  await boxes.nth(2).fill('mot-de-passe-1');
  await boxes.nth(3).fill('mot-de-passe-1');
  await page.getByTestId('whatsapp-consent-check').click();
  await settle(page);
  await page.getByText('Continuer', { exact: true }).last().click();
  await page.waitForTimeout(2500);
  check('registration: the last step sends exactly one POST /auth/register', posts.length === 1 && posts[0] === '/auth/register', posts.join(', '));
  check('registration: with public activation closed, the screen stays on the form (nothing created)', new URL(page.url()).pathname.endsWith('/register'));
  await context.close();
}

// ── 3d. a strict Content Security Policy: the theme boot needs no inline script ───────────────────────────────────────
{
  const CSP = `default-src 'self'; script-src 'self' 'sha256-67fhrP0+BkBqmgGGXTtgiVO/9EQs3QruYNU/7fnRkI8='; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ${new URL(process.env.API_ORIGIN ?? 'http://127.0.0.1:3410').origin}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`;
  for (const scheme of ['dark', 'light']) {
    const { context, page } = await open({ scheme });
    await context.route('**/*', async (route) => {
      const response = await route.fetch();
      const headers = { ...response.headers() };
      if ((headers['content-type'] ?? '').includes('text/html')) headers['content-security-policy'] = CSP;
      await route.fulfill({ response, headers });
    });
    const violations = [];
    page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text().slice(0, 140)); });
    await page.goto(`${APP}/login`);
    await settle(page);
    const ok = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, ready: document.documentElement.dataset.themeReady, toggle: !!document.querySelector('[data-testid="theme-toggle"]') }));
    check(`strict CSP (script-src 'self' + Expo's hash, no 'unsafe-inline' scripts), device ${scheme}: the page starts in ${scheme} with no violation`, ok.theme === scheme && ok.ready === 'true' && ok.toggle && violations.length === 0, violations.slice(0, 2).join(' | '));
    await context.close();
  }
}

// ── 3e. one focus ring (c8c5c0d): the browser's own outline is off on a focused field, the app's ring is drawn ───────
for (const theme of ['light', 'dark']) {
  const { context, page } = await open({ theme });
  await page.goto(`${APP}/login`);
  await settle(page);
  await page.locator('input').first().focus();
  await page.waitForTimeout(300);
  const ring = await page.evaluate(() => {
    const input = document.activeElement;
    const s = getComputedStyle(input);
    return { outline: s.outlineStyle === 'none' || s.outlineWidth === '0px', marked: input.getAttribute('data-app-field') === 'true' };
  });
  check(`login ${theme}: a focused field has no browser outline (one ring, the app's)`, ring.outline && ring.marked);
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
      // Typing into the sheet: the tap focuses the field, and what is typed stays (the shared sheet-input fix).
      const field = page.locator('[aria-modal="true"] input').first();
      await field.click();
      await page.keyboard.type('Sidi Exemple');
      check(`team sheet ${lang} ${theme} ${width}: a tapped field takes and keeps typing`, (await field.inputValue()) === 'Sidi Exemple');
      const knobs = await page.evaluate(() => [...document.querySelectorAll('[aria-modal="true"] div[role="switch"][aria-label]')].map((row) => {
        const input = row.querySelector('input');
        const box = input?.parentElement;
        if (!box) return 'no switch';
        const b = box.getBoundingClientRect();
        const outside = [...box.querySelectorAll('div')].some((d) => { const r = d.getBoundingClientRect(); return r.width > 0 && (r.left < b.left - 1 || r.right > b.right + 1); });
        const words = [...row.querySelectorAll('div')].filter((d) => d.children.length === 0 && (d.textContent ?? '').trim() && !box.contains(d));
        const covers = words.some((w) => { const r = w.getBoundingClientRect(); return r.right > b.left && r.left < b.right && r.bottom > b.top && r.top < b.bottom; });
        return outside || covers ? `knob outside its track: ${outside}, over words: ${covers}` : 'ok';
      }));
      check(`team sheet ${lang} ${theme} ${width}: every switch's knob stays in its track, clear of its words`, knobs.length > 0 && knobs.every((k) => k === 'ok'), knobs.join(', '));
      const STATE = { en: 'Works here', fr: 'Y travaille', ar: 'يعمل هنا' }[lang];
      const sheetText = await page.locator('[aria-modal="true"]').last().innerText();
      check(`team sheet ${lang} ${theme} ${width}: the store switch says "${STATE}", never "On"`, sheetText.includes(STATE) && !/(^|\s)On(\s|$)/m.test(sheetText));
      if (lang === 'ar') {
        const rtl = await page.evaluate(() => {
          // The row (the app's labelled switch), its name, and the switch's knob inside it.
          const row = [...document.querySelectorAll('[aria-modal="true"] div[role="switch"][aria-label]')].pop();
          if (!row) return null;
          const name = [...row.querySelectorAll('div')].find((n) => n.children.length === 0 && (n.textContent ?? '').trim() === row.getAttribute('aria-label'));
          const knob = row.querySelector('input');
          if (!name || !knob) return null;
          const r = row.getBoundingClientRect(), k = knob.getBoundingClientRect();
          return { textAlign: getComputedStyle(name).textAlign, knobLeft: k.left + k.width / 2 < r.left + r.width / 2 };
        });
        const labelOk = rtl && rtl.knobLeft && rtl.textAlign === 'right';
        check(`team sheet ar ${theme} ${width}: the store row reads right to left (name on the right, switch on the left)`, labelOk, JSON.stringify(rtl));
      }
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
    for (const [theme, width] of [['light', 320], ['dark', 640], ['light', 390], ['dark', 1280]]) {
      const { context, page } = await open({ lang: 'en', theme, width });
      await signIn(page);
      const bad = [];
      for (const route of ROUTES) {
        await page.goto(`${APP}/${route}`);
        await page.waitForTimeout(1200);
        const f = await page.evaluate(FACTS);
        if (f.overflow > 0 || f.clipped > 0 || f.touching.length) bad.push(`${route}: overflow ${f.overflow}, past the edge ${f.clipped}, touching ${f.touching.slice(0, 2).join('; ')}`);
      }
      check(`every exported route (${ROUTES.length}) ${theme} ${width}${width === 640 ? ' (1280 at 200%)' : ''}: no overflow, nothing past the edge, no text touching a control`, bad.length === 0, bad.slice(0, 6).join(' || '));
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
