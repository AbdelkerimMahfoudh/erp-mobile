// The Dukan brand on the app's web export, in Chromium or WebKit — a release gate (the owner's pilot brief of
// 2026-10-29 §6, D224). Automation on Linux, not a physical iPhone: the native splash's hand-over to the animation is
// checked here only as configuration (same colour, same size); its sight on a device stays in the physical gate.
//
// APP      the served web export (required)
// APPDIR   the erp-mobile checkout the export was built from (required: app.json, the icon, lib/brand.ts)
// BROWSER  chromium | webkit (default chromium)
// PW       optional path to the playwright module
// OUT      optional directory for brand-<browser>.json
//
// Checks, signed out (no account is used and nothing is sent):
//   1. configuration: an opaque RGB 1024×1024 icon; iPhone only; light/dark; the static splash's colours and size;
//   2. the matrix 320/375/390 px × light/dark × EN/FR/AR (RTL): the header mark at its small size, its three layers in
//      the palette's tokens, never mirrored, inside the viewport; the wordmark whole; the canvas; no sideways scroll;
//   3. no theme-boot flash: every frame of the start is painted in the theme the page will settle in;
//   4. the launch animation: it moves, it ends (~1.06 s + fade), and ordinary navigation never plays it again;
//   5. Reduce Motion: the mark is shown still, and goes sooner.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const pw = require(process.env.PW ?? 'playwright');
const BROWSER = process.env.BROWSER === 'webkit' ? 'webkit' : 'chromium';
const engine = pw[BROWSER];
const APP = (process.env.APP ?? '').replace(/\/+$/, '');
const APPDIR = process.env.APPDIR;
if (!APP || !APPDIR) throw new Error('APP and APPDIR are required');

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail && !ok ? ` — ${detail}` : ''}`);
};

// ── the contract, read from the checkout ─────────────────────────────────────────────────────────────────────────────
const colorsTs = readFileSync(join(APPDIR, 'lib/design/colors.ts'), 'utf8');
const brandTs = readFileSync(join(APPDIR, 'lib/brand.ts'), 'utf8');
const scale = (name) => {
  const block = colorsTs.match(new RegExp(`const ${name} = \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';
  return Object.fromEntries([...block.matchAll(/(\d+): '(#[0-9A-Fa-f]{6})'/g)].map((m) => [m[1], m[2].toUpperCase()]));
};
const brand = scale('brand');
const neutral = scale('neutral');
// The Offset Spiral (Build 4, the owner's pack of 2026-11-03): two arcs and a "D", from the `identity` tokens.
const identity = Object.fromEntries([...(colorsTs.match(/export const identity = \{([^}]*)\}/)?.[1] ?? '').matchAll(/(\w+): '(#[0-9A-Fa-f]{6})'/g)].map((m) => [m[1], m[2].toUpperCase()]));
const TOKENS = {
  light: { first: identity.navy, second: identity.violet, letter: identity.navy, canvas: '#F1F3F8' },
  dark: { first: identity.violet, second: identity.lavender, letter: identity.white, canvas: '#0B0F17' },
};
void brand;
void neutral;
const num = (key) => Number(brandTs.match(new RegExp(`${key}: (\\d+)`))?.[1]);
const INTRO = { size: num('size'), totalMs: num('totalMs'), fadeMs: num('fadeMs'), reducedHoldMs: num('reducedHoldMs') };
const SMALL = 28; // AuthHeader's <DukanMark size={28} />

const hexToRgb = (h) => `rgb(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)})`;

// ── 1. configuration ─────────────────────────────────────────────────────────────────────────────────────────────────
{
  check('the brand contract was read from the checkout', /^#/.test(TOKENS.light.second ?? '') && /^#/.test(TOKENS.dark.first ?? '') && INTRO.size > 0 && INTRO.totalMs > 0, JSON.stringify(INTRO));
  check('the launch animation lasts 800–1100 ms (the pack’s motion contract)', INTRO.totalMs >= 800 && INTRO.totalMs <= 1100, `${INTRO.totalMs}`);
  const png = readFileSync(join(APPDIR, 'assets/images/icon.png'));
  const sig = png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  const depth = png[24];
  const type = png[25];
  check('the iOS icon is a PNG of 1024×1024', sig && w === 1024 && h === 1024, `${w}×${h}`);
  check('the iOS icon is opaque RGB: colour type 2, 8-bit, no alpha channel', type === 2 && depth === 8, `type ${type}, depth ${depth}`);
  check('the iOS icon carries no transparency chunk (tRNS)', !png.includes(Buffer.from('tRNS')));
  const app = JSON.parse(readFileSync(join(APPDIR, 'app.json'), 'utf8')).expo;
  check('iPhone only: ios.supportsTablet is false', app.ios?.supportsTablet === false);
  check('light and dark follow the device: userInterfaceStyle automatic', app.userInterfaceStyle === 'automatic');
  const splash = (app.plugins ?? []).find((p) => Array.isArray(p) && p[0] === 'expo-splash-screen')?.[1] ?? {};
  check('the static splash is the mark on the light canvas', splash.backgroundColor?.toUpperCase() === TOKENS.light.canvas && /splash-icon\.png$/.test(splash.image ?? ''), `${splash.backgroundColor} ${splash.image}`);
  check('the static splash has its dark variant on the dark canvas', splash.dark?.backgroundColor?.toUpperCase() === TOKENS.dark.canvas && /splash-icon-dark\.png$/.test(splash.dark?.image ?? ''), JSON.stringify(splash.dark ?? null));
  check('the splash image is as wide as the animation’s mark, so the hand-over does not move it', splash.imageWidth === INTRO.size, `${splash.imageWidth} vs ${INTRO.size}`);
  const adaptive = app.android?.adaptiveIcon ?? {};
  check('Android has the adaptive icon’s layers', !!adaptive.foregroundImage && !!(adaptive.backgroundImage || adaptive.backgroundColor) && !!adaptive.monochromeImage, Object.keys(adaptive).join(','));
}

const browser = await engine.launch();
async function open({ lang = 'en', scheme = 'light', theme = scheme, width = 390, height = 844, reducedMotion = 'no-preference', init } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, reducedMotion, locale: lang === 'ar' ? 'ar' : lang === 'fr' ? 'fr-FR' : 'en-US' });
  await context.addInitScript(([l, t]) => {
    try {
      if (!sessionStorage.getItem('brand.init')) {
        localStorage.setItem('erp.language', l);
        if (t) localStorage.setItem('erp.theme', t);
        else localStorage.removeItem('erp.theme');
        sessionStorage.setItem('brand.init', '1');
      }
    } catch {}
  }, [lang, theme ?? null]);
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  return { context, page };
}
const introGone = (page, timeout = 4000) => page.waitForSelector('[data-testid="brand-intro"]', { state: 'detached', timeout }).then(() => true, () => false);

// ── 2. the matrix ─────────────────────────────────────────────────────────────────────────────────────────────────────
const HEADER = () => {
  const vw = window.innerWidth;
  const left = document.querySelector('header g#spiral-first, g#spiral-first');
  const svg = left?.closest('svg');
  if (!svg) return { found: false };
  const r = svg.getBoundingClientRect();
  const lr = left.getBoundingClientRect();
  const right = svg.querySelector('g#spiral-second');
  const rr = right?.getBoundingClientRect();
  const hl = svg.querySelector('g#spiral-letter');
  const mirrored = (() => {
    for (let n = svg; n && n !== document.documentElement; n = n.parentElement) {
      const t = getComputedStyle(n).transform;
      const m = t && t !== 'none' ? t.match(/matrix\(([^)]+)\)/) : null;
      if (m && Number(m[1].split(',')[0]) < 0) return true;
    }
    return false;
  })();
  // The wordmark beside the mark: the identity row's text.
  const row = svg.parentElement?.parentElement;
  const word = row ? [...row.querySelectorAll('*')].find((el) => [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) : null;
  const wr = word?.getBoundingClientRect();
  return {
    found: true,
    w: r.width,
    h: r.height,
    inside: r.left >= 0 && r.right <= vw + 0.5,
    layers: [left, right, hl].filter(Boolean).length,
    masks: svg.querySelectorAll('mask').length,
    leftFill: getComputedStyle(left).fill,
    rightFill: right ? getComputedStyle(right).fill : '',
    letterFill: hl ? getComputedStyle(hl).fill : '',
    leftIsLeft: !!rr && lr.left + lr.width / 2 > rr.left + rr.width / 2,
    mirrored,
    word: word?.textContent?.trim() ?? '',
    wordWhole: !!word && word.scrollWidth <= word.clientWidth + 1 && !/…$/.test(word.textContent.trim()),
    wordInside: !!wr && wr.left >= 0 && wr.right <= vw + 0.5,
    dir: document.documentElement.dir || getComputedStyle(document.body).direction,
    canvas: getComputedStyle(document.documentElement).backgroundColor,
    sideways: document.documentElement.scrollWidth > vw + 1,
  };
};
let matrixPassed = 0;
let matrixFailed = 0;
for (const width of [320, 375, 390]) {
  for (const scheme of ['light', 'dark']) {
    for (const lang of ['en', 'fr', 'ar']) {
      const label = `${width}px ${scheme} ${lang}`;
      const { context, page } = await open({ lang, scheme, width, reducedMotion: 'reduce' });
      await page.goto(`${APP}/login`, { waitUntil: 'load' });
      await page.waitForSelector('g#spiral-first', { timeout: 15000 }).catch(() => null);
      await introGone(page);
      await page.waitForTimeout(250);
      const f = await page.evaluate(HEADER);
      const t = TOKENS[scheme];
      const fails = [];
      if (!f.found) fails.push('no mark in the header');
      else {
        if (Math.abs(f.w - SMALL) > 1 || Math.abs(f.h - SMALL) > 1) fails.push(`mark ${f.w}×${f.h}, expected ${SMALL}×${SMALL}`);
        if (f.layers !== 3) fails.push(`${f.layers} layers`);
        if (f.leftFill !== hexToRgb(t.first)) fails.push(`spiral-first ${f.leftFill} ≠ ${t.first}`);
        if (f.rightFill !== hexToRgb(t.second)) fails.push(`spiral-second ${f.rightFill} ≠ ${t.second}`);
        if (f.letterFill !== hexToRgb(t.letter)) fails.push(`spiral-letter ${f.letterFill} ≠ ${t.letter}`);
        if (!f.leftIsLeft || f.mirrored) fails.push('the mark is mirrored');
        if (!f.inside) fails.push('the mark leaves the viewport');
        if (!f.word) fails.push('no wordmark beside the mark');
        else if (!f.wordWhole) fails.push(`the wordmark is clipped ("${f.word}")`);
        if (f.word && !f.wordInside) fails.push('the wordmark leaves the viewport');
        if ((lang === 'ar') !== (f.dir === 'rtl')) fails.push(`direction ${f.dir}`);
        if (f.canvas !== hexToRgb(t.canvas)) fails.push(`canvas ${f.canvas} ≠ ${t.canvas}`);
        if (f.sideways) fails.push('the page scrolls sideways');
      }
      if (fails.length) matrixFailed++;
      else matrixPassed++;
      check(`matrix ${label}: small mark, three layers in the tokens, not mirrored, wordmark whole, ${lang === 'ar' ? 'RTL' : 'LTR'}`, fails.length === 0, fails.join('; '));
      await context.close();
    }
  }
}

// ── 3. no theme-boot flash ───────────────────────────────────────────────────────────────────────────────────────────
// Recorded from the document's first instant, on every animation frame and every few milliseconds besides (a headless
// engine may throttle frames): once the body exists, anything could be painted, so every sample must be in the theme.
const THEME_RECORDER = () => {
  const frames = [];
  window.__brandFrames = frames;
  const sample = () => {
    if (!document.body) return;
    const html = document.documentElement;
    const root = document.getElementById('root');
    frames.push({
      t: Math.round(performance.now()),
      ready: html.hasAttribute('data-theme-ready'),
      htmlBg: getComputedStyle(html).backgroundColor,
      rootVisible: !!root && getComputedStyle(root).visibility !== 'hidden' && root.childElementCount > 0,
    });
  };
  const frame = () => {
    sample();
    if (performance.now() < 3000) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  const timer = setInterval(() => {
    sample();
    if (performance.now() > 3000) clearInterval(timer);
  }, 8);
};
for (const s of [
  { name: 'a dark phone, no stored choice', scheme: 'dark', theme: null, expect: 'dark' },
  { name: 'a light phone, dark chosen in the app', scheme: 'light', theme: 'dark', expect: 'dark' },
  { name: 'a dark phone, light chosen in the app', scheme: 'dark', theme: 'light', expect: 'light' },
]) {
  const { context, page } = await open({ scheme: s.scheme, theme: s.theme, reducedMotion: 'reduce', init: THEME_RECORDER });
  await page.goto(`${APP}/login`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-theme-ready'), null, { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(400);
  const frames = await page.evaluate(() => window.__brandFrames ?? []);
  const canvas = hexToRgb(TOKENS[s.expect].canvas);
  const wrong = frames.filter((f) => f.htmlBg !== canvas || (s.expect === 'dark' && f.rootVisible && !f.ready));
  const boot = frames.filter((f) => !f.ready).length;
  check(
    `no theme-boot flash: ${s.name} — every sample painted ${s.expect} (${frames.length} samples, ${boot} before the app was ready)`,
    frames.length >= 5 && boot >= 1 && wrong.length === 0,
    wrong.length ? wrong.slice(0, 2).map((f) => JSON.stringify(f)).join(' ') : `${frames.length} samples, ${boot} before ready`,
  );
  await context.close();
}

// ── 4 and 5. the launch animation, once; and still under Reduce Motion ──────────────────────────────────────────────
// Recorded from the document's first instant every 16 ms: when the overlay appears and goes, its background, its mark's
// width, and where its two halves are — so nothing depends on catching it with a later query.
const INTRO_RECORDER = () => {
  const rec = { seenAt: null, goneAt: null, bg: null, size: null, poses: [], arcs: [], settled: null, vw: window.innerWidth };
  window.__intro = rec;
  const sample = () => {
    const el = document.querySelector('[data-testid="brand-intro"]');
    const t = Math.round(performance.now());
    if (el) {
      if (rec.seenAt === null) {
        rec.seenAt = t;
        rec.bg = getComputedStyle(el).backgroundColor;
        // The mark's own frame, not a layer: the Offset Spiral's arcs start at 30 % scale and rotate (BRAND_INTRO).
        const box = el.firstElementChild?.getBoundingClientRect();
        rec.size = box ? Math.round(box.width) : 0;
      }
      // What is on screen: the arcs layer as drawn, scaled and turned by the animation, from its first frame to its last.
      const drawn = el.firstElementChild?.querySelector('svg')?.getBoundingClientRect();
      if (drawn) {
        rec.arcs.push(Math.round(drawn.width));
        rec.settled = { width: Math.round(drawn.width), left: Math.round(drawn.left), right: Math.round(drawn.right) };
      }
      const halves = [...el.querySelectorAll('g#spiral-first, g#spiral-letter')].map((g) => Math.round(g.getBoundingClientRect().left * 10) / 10);
      if (halves.length === 2) rec.poses.push(halves.join(','));
    } else if (rec.seenAt !== null && rec.goneAt === null) rec.goneAt = t;
    if (t < 8000 && rec.goneAt === null) setTimeout(sample, 16);
  };
  sample();
};
const watchIntro = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        let seen = false;
        const end = performance.now() + 1500;
        const tick = () => {
          if (document.querySelector('[data-testid="brand-intro"]')) seen = true;
          if (performance.now() < end) setTimeout(tick, 16);
          else resolve(seen);
        };
        tick();
      }),
  );
{
  const { context, page } = await open({ scheme: 'light', reducedMotion: 'no-preference', init: INTRO_RECORDER });
  await page.goto(`${APP}/login`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__intro?.goneAt !== null, null, { timeout: 10000 }).catch(() => null);
  const r = await page.evaluate(() => window.__intro);
  const distinct = new Set(r.poses).size;
  check('the launch animation covers the first moment', r.seenAt !== null);
  check('the animation’s background is the light canvas, as the static splash', r.bg === hexToRgb(TOKENS.light.canvas), r.bg);
  check(`the animation’s mark is ${INTRO.size} wide, as the splash image`, r.size === INTRO.size, `${r.size}`);
  check('the halves move (the animation plays)', distinct > 2, `${distinct} distinct poses of ${r.poses.length}`);
  // The Offset Spiral's motion as users see it: the arcs begin at the approved smaller scale and settle at the mark's size.
  const first = r.arcs[0] ?? 0;
  check(`the arcs begin small (about ${Math.round(INTRO.size * 0.3)} of ${INTRO.size}, the approved 30 %, turned)`, first > 0 && first < INTRO.size * 0.75, `${first}`);
  check(`the arcs settle at ${INTRO.size} wide, as drawn on screen`, !!r.settled && Math.abs(r.settled.width - INTRO.size) <= 2, JSON.stringify(r.settled));
  check('the settled mark stays inside the window', !!r.settled && r.settled.left >= 0 && r.settled.right <= r.vw, `${JSON.stringify(r.settled)} in ${r.vw}`);
  const ms = r.goneAt !== null && r.seenAt !== null ? r.goneAt - r.seenAt : null;
  check(`the animation ends and goes (~${INTRO.totalMs} ms + ${INTRO.fadeMs} ms fade)`, ms !== null && ms >= INTRO.totalMs * 0.8 && ms <= INTRO.totalMs + INTRO.fadeMs + 1200, `${ms === null ? 'never went' : `${ms} ms`}`);
  // Ordinary navigation inside the app: never again. Sign-in's "Create a business account" pushes the route.
  const createLabel = readFileSync(join(APPDIR, 'lib/i18n/en.ts'), 'utf8').match(/'auth\.action\.createAccount': '([^']+)'/)?.[1] ?? 'Create a business account';
  const toRegister = page.getByText(createLabel, { exact: true }).first();
  const hasLink = (await toRegister.count()) > 0;
  check('sign-in offers registration inside the app (for the navigation check)', hasLink);
  if (hasLink) {
    await toRegister.click();
    await page.waitForURL(/\/register/, { timeout: 10000 }).catch(() => null);
    check('navigating to registration does not play the animation again', /\/register/.test(page.url()) && !(await watchIntro(page)), page.url());
    await page.goBack();
    await page.waitForURL(/\/login/, { timeout: 10000 }).catch(() => null);
    check('navigating back does not play it again', /\/login/.test(page.url()) && !(await watchIntro(page)), page.url());
  }
  await context.close();
}
{
  const { context, page } = await open({ scheme: 'dark', reducedMotion: 'reduce', init: INTRO_RECORDER });
  await page.goto(`${APP}/login`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__intro?.goneAt !== null, null, { timeout: 10000 }).catch(() => null);
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => window.__intro);
  const distinct = new Set(r.poses).size;
  const ms = r.goneAt !== null && r.seenAt !== null ? r.goneAt - r.seenAt : null;
  // Under the system's Reduce Motion, Reanimated completes timings at once (ReduceMotion.System, its default): the
  // overlay may then never be painted at all — or be caught for a moment, still. Either is no motion; both are allowed.
  check(
    'Reduce Motion: the halves never move (no overlay painted, or one still pose)',
    r.seenAt === null || distinct <= 1,
    `${r.seenAt === null ? 'never painted' : `${distinct} distinct poses of ${r.poses.length}`}`,
  );
  check(
    `Reduce Motion: nothing is held for the animation (gone within ${INTRO.totalMs} ms, if shown at all)`,
    r.seenAt === null || (ms !== null && ms < INTRO.totalMs),
    `${r.seenAt === null ? 'never painted' : ms === null ? 'never went' : `${ms} ms`}`,
  );
  check('Reduce Motion: if it is shown, it is on the dark canvas', r.seenAt === null || r.bg === hexToRgb(TOKENS.dark.canvas), `${r.bg}`);
  const signIn = await page.evaluate(() => !!document.querySelector('g#spiral-first') && !document.querySelector('[data-testid="brand-intro"]'));
  check('Reduce Motion: the sign-in screen is there, with its mark, and no overlay remains', signIn);
  await context.close();
}

await browser.close();
const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
console.log(`\n${BROWSER}: brand ${passed}/${results.length} checks passed (matrix ${matrixPassed}/${matrixPassed + matrixFailed})`);
if (process.env.OUT) {
  mkdirSync(process.env.OUT, { recursive: true });
  writeFileSync(join(process.env.OUT, `brand-${BROWSER}.json`), JSON.stringify({ browser: BROWSER, passed, failed, results }, null, 1));
}
process.exit(failed === 0 ? 0 : 1);
