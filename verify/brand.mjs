// The Dukan brand on the app's web export, in Chromium or WebKit — a release gate (the owner's pilot brief of
// 2026-10-29 §6, D224), rewritten for the approved logo pack (Dukan-ERP-Logo-Pack, 2026-11-04; the owner's brief of
// 2026-11-05). Automation on Linux, not a physical iPhone: the native splash's hand-over to the animation is checked here
// only as configuration (same colour, same size); its sight on a device stays in the physical gate.
//
// APP      the served web export (required)
// APPDIR   the erp-mobile checkout the export was built from (required: app.json, the icon, lib/brand.ts, lib/brand-pack.ts)
// BROWSER  chromium | webkit (default chromium)
// PW       optional path to the playwright module
// OUT      optional directory for brand-<browser>.json
//
// The contract (components/brand/DukanMark.tsx, lib/brand.ts — read from the checkout, never restated here):
//   - the symbol (`dukan-mark`): the pack's D, lettering in launch navy on light and white on dark, the accent violet;
//   - the launch (`brand-intro`, `brand-intro-frame`, `brand-intro-d`, `brand-intro-ukan`, `brand-intro-erp`): the D
//     centred, then easing left as UKAN is revealed from the left; ERP fading in beside the N; a brief hold; the fade —
//     settled 280 wide, 2 s in all (motion 1.4 s); the native splash shows the D at the same width (`imageWidth`).
//
// Checks, signed out (no account is used and nothing is sent):
//   1. configuration: an opaque RGB 1024×1024 icon; iPhone only; light/dark; the splash's colours and its width;
//   2. the matrix 320/375/390 px × light/dark × EN/FR/AR (RTL): the header symbol at its small size, in the pack's
//      colours for the surface, never mirrored, inside the viewport; the wordmark whole; the canvas; no sideways scroll;
//   3. no theme-boot flash: every frame of the start is painted in the theme the page will settle in;
//   4. the launch animation: the D starts centred and ends left, UKAN is revealed, ERP fades in, it settles 280 wide
//      inside the window and goes after ~2 s (a tap skips it); ordinary navigation never plays it again;
//   5. Reduce Motion: nothing moves, and nothing is held.
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
const brandTs = readFileSync(join(APPDIR, 'lib/brand.ts'), 'utf8');
const packTs = readFileSync(join(APPDIR, 'lib/brand-pack.ts'), 'utf8');
const markTsx = readFileSync(join(APPDIR, 'components/brand/DukanMark.tsx'), 'utf8');
const hex = (src, key) => (src.match(new RegExp(`${key}: '(#[0-9A-Fa-f]{6})'`))?.[1] ?? '').toUpperCase();
const PACK = { accent: hex(packTs, 'accent'), launchNavy: hex(packTs, 'launchNavy'), lettering: hex(packTs, 'lettering'), lightLettering: hex(packTs, 'lightLettering') };
const num = (key) => Number(brandTs.match(new RegExp(`\\b${key}: (\\d+)`))?.[1]);
const wordmarkWidth = Number(brandTs.match(/const WORDMARK_WIDTH = (\d+)/)?.[1]);
// `size: Math.round((WORDMARK_WIDTH * 335) / 1540)`: the D's share of the wordmark, as the pack draws them.
const share = brandTs.match(/size: Math\.round\(\(WORDMARK_WIDTH \* (\d+)\) \/ (\d+)\)/);
const INTRO = {
  wordmarkWidth,
  size: share ? Math.round((wordmarkWidth * Number(share[1])) / Number(share[2])) : NaN,
  holdMs: num('holdMs'),
  moveEndMs: num('moveEndMs'),
  erpFromMs: num('erpFromMs'),
  erpEndMs: num('erpEndMs'),
  fadeAtMs: num('fadeAtMs'),
  totalMs: num('totalMs'),
  fadeMs: num('fadeMs'),
  reducedHoldMs: num('reducedHoldMs'),
};
const SMALL = Number(readFileSync(join(APPDIR, 'components/auth/AuthChrome.tsx'), 'utf8').match(/<DukanMark size=\{(\d+)\}/)?.[1]);
const CANVAS = { light: '#F1F3F8', dark: '#0B0F17' };
// The surface's colours for the pack's artwork (lib/brand.ts markColours): lettering by tone, the accent always.
const TONE = { light: { lettering: PACK.lightLettering, accent: PACK.accent }, dark: { lettering: PACK.lettering, accent: PACK.accent } };
const INTRO_BG = { light: CANVAS.light, dark: PACK.launchNavy };
const hexToRgb = (h) => `rgb(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)})`;

// ── 1. configuration ─────────────────────────────────────────────────────────────────────────────────────────────────
{
  check('the brand contract was read from the checkout', Object.values(PACK).every((v) => /^#/.test(v)) && Object.values(INTRO).every((v) => Number.isFinite(v) && v > 0) && SMALL > 0, JSON.stringify({ PACK, INTRO, SMALL }));
  // The owner's timing, measured on an iPhone (2026-11-06): the D-to-wordmark motion 1.4 s, 2 s in all.
  check('the launch settles 280 wide; the motion 1.4 s, 2 s in all (owner, 2026-11-06)', INTRO.wordmarkWidth === 280 && INTRO.totalMs === 2000 && INTRO.moveEndMs - INTRO.holdMs === 1400, JSON.stringify(INTRO));
  check('its phases are in order: hold, move, ERP, fade, end', INTRO.holdMs < INTRO.moveEndMs && INTRO.erpFromMs < INTRO.erpEndMs && INTRO.erpEndMs <= INTRO.fadeAtMs && INTRO.fadeAtMs + INTRO.fadeMs === INTRO.totalMs, JSON.stringify(INTRO));
  for (const id of ['brand-intro', 'brand-intro-frame', 'brand-intro-d', 'brand-intro-ukan', 'brand-intro-erp', 'dukan-mark']) {
    check(`the component names ${id}`, markTsx.includes(`testID="${id}"`));
  }
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
  check('the static splash is the D on the light canvas, as the launch’s first frame', splash.backgroundColor?.toUpperCase() === INTRO_BG.light && /splash-icon\.png$/.test(splash.image ?? ''), `${splash.backgroundColor} ${splash.image}`);
  check('the static splash’s dark variant is on launch navy, as the dark launch', splash.dark?.backgroundColor?.toUpperCase() === INTRO_BG.dark && /splash-icon-dark\.png$/.test(splash.dark?.image ?? ''), JSON.stringify(splash.dark ?? null));
  check(`the splash image is ${INTRO.size} wide, the D’s width in the launch: the hand-over does not move it`, splash.imageWidth === INTRO.size && INTRO.size === 61, `${splash.imageWidth} vs ${INTRO.size}`);
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
  const svg = [...document.querySelectorAll('[data-testid="dukan-mark"]')].map((n) => (n.tagName.toLowerCase() === 'svg' ? n : n.querySelector('svg'))).find(Boolean);
  if (!svg) return { found: false };
  const r = svg.getBoundingClientRect();
  const fills = [...new Set([...svg.querySelectorAll('path')].map((p) => getComputedStyle(p).fill))];
  const mirrored = (() => {
    for (let n = svg; n && n !== document.documentElement; n = n.parentElement) {
      const t = getComputedStyle(n).transform;
      const m = t && t !== 'none' ? t.match(/matrix\(([^)]+)\)/) : null;
      if (m && Number(m[1].split(',')[0]) < 0) return true;
    }
    return false;
  })();
  // The wordmark beside the symbol: the identity row's text.
  let row = svg.parentElement;
  for (let i = 0; i < 4 && row && !row.textContent.trim(); i++) row = row.parentElement;
  const word = row ? [...row.querySelectorAll('*')].find((el) => [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) : null;
  const wr = word?.getBoundingClientRect();
  return {
    found: true,
    w: r.width,
    inside: r.left >= 0 && r.right <= vw + 0.5,
    fills,
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
      await page.waitForSelector('[data-testid="dukan-mark"]', { timeout: 15000 }).catch(() => null);
      await introGone(page);
      await page.waitForTimeout(250);
      const f = await page.evaluate(HEADER);
      const tone = TONE[scheme];
      const fails = [];
      if (!f.found) fails.push('no symbol in the header');
      else {
        if (Math.abs(f.w - SMALL) > 1) fails.push(`symbol ${f.w} wide, expected ${SMALL}`);
        const want = [hexToRgb(tone.lettering), hexToRgb(tone.accent)].sort();
        if (JSON.stringify([...f.fills].sort()) !== JSON.stringify(want)) fails.push(`fills ${f.fills.join(' ')} ≠ lettering ${tone.lettering} + accent ${tone.accent}`);
        if (f.mirrored) fails.push('the symbol is mirrored');
        if (!f.inside) fails.push('the symbol leaves the viewport');
        if (!f.word) fails.push('no wordmark beside the symbol');
        else if (!f.wordWhole) fails.push(`the wordmark is clipped ("${f.word}")`);
        if (f.word && !f.wordInside) fails.push('the wordmark leaves the viewport');
        if ((lang === 'ar') !== (f.dir === 'rtl')) fails.push(`direction ${f.dir}`);
        if (f.canvas !== hexToRgb(CANVAS[scheme])) fails.push(`canvas ${f.canvas} ≠ ${CANVAS[scheme]}`);
        if (f.sideways) fails.push('the page scrolls sideways');
      }
      if (fails.length) matrixFailed++;
      else matrixPassed++;
      check(`matrix ${label}: small symbol in the pack’s ${scheme} colours, not mirrored, wordmark whole, ${lang === 'ar' ? 'RTL' : 'LTR'}`, fails.length === 0, fails.join('; '));
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
  const canvas = hexToRgb(CANVAS[s.expect]);
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
// Recorded from the document's first instant every 16 ms: when the overlay appears and goes, its background, the frame's
// width, and where its three layers are — the D's left edge in the frame, UKAN's revealed width, ERP's opacity — so
// nothing depends on catching it with a later query.
const INTRO_RECORDER = () => {
  const rec = { seenAt: null, goneAt: null, bg: null, samples: [], settled: null, vw: window.innerWidth };
  window.__intro = rec;
  const box = (id) => document.querySelector(`[data-testid="${id}"]`);
  const sample = () => {
    const el = box('brand-intro');
    const t = Math.round(performance.now());
    if (el) {
      if (rec.seenAt === null) {
        rec.seenAt = t;
        rec.bg = getComputedStyle(el).backgroundColor;
      }
      const frame = box('brand-intro-frame')?.getBoundingClientRect();
      const d = box('brand-intro-d');
      const ukan = box('brand-intro-ukan');
      const erp = box('brand-intro-erp');
      if (frame && d && ukan && erp) {
        const dr = d.getBoundingClientRect();
        // UKAN's window is its clipping parent, widening as it is revealed; ERP fades on its own parent.
        const window_ = ukan.parentElement.getBoundingClientRect();
        let op = 1;
        for (let n = erp; n && n !== el; n = n.parentElement) op *= Number(getComputedStyle(n).opacity);
        rec.samples.push({ t: t - rec.seenAt, frameW: Math.round(frame.width * 10) / 10, dLeft: Math.round((dr.left - frame.left) * 10) / 10, ukanW: Math.round(window_.width * 10) / 10, erp: Math.round(op * 100) / 100 });
        rec.settled = { width: Math.round(frame.width), left: Math.round(frame.left), right: Math.round(frame.right) };
      }
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
  const s = r.samples;
  const first = s[0];
  const last = s[s.length - 1];
  check('the launch animation covers the first moment', r.seenAt !== null && s.length > 0, `${s.length} samples`);
  check('the animation’s background is the light canvas, as the static splash', r.bg === hexToRgb(INTRO_BG.light), r.bg);
  check(`the wordmark’s frame is ${INTRO.wordmarkWidth} wide`, !!first && s.every((x) => Math.abs(x.frameW - INTRO.wordmarkWidth) <= 1), `${first?.frameW}`);
  // The D layer is the full canvas, the D at its left; translated right so its ${INTRO.size}-wide glyph is centred.
  check('the D starts centred, where the splash left it', !!first && Math.abs(first.dLeft + INTRO.size / 2 - INTRO.wordmarkWidth / 2) <= 3, JSON.stringify(first));
  check('the D ends at the left of the wordmark', !!last && Math.abs(last.dLeft) <= 1, JSON.stringify(last));
  check('the D moves left only, never back', s.every((x, i) => i === 0 || x.dLeft <= s[i - 1].dLeft + 0.5), s.map((x) => x.dLeft).join(','));
  check('UKAN is revealed from nothing to the whole wordmark, widening only', !!first && !!last && first.ukanW <= 6 && Math.abs(last.ukanW - INTRO.wordmarkWidth) <= 1 && s.every((x, i) => i === 0 || x.ukanW >= s[i - 1].ukanW - 0.5), `${first?.ukanW} → ${last?.ukanW}`);
  const erpStarts = s.find((x) => x.erp > 0.05);
  check('ERP fades in, after the D has begun to move', !!first && first.erp <= 0.05 && !!last && last.erp >= 0.95 && !!erpStarts && erpStarts.t >= INTRO.holdMs, `${first?.erp} → ${last?.erp}, from ${erpStarts?.t} ms`);
  check('the settled wordmark stays inside the window', !!r.settled && r.settled.left >= 0 && r.settled.right <= r.vw, `${JSON.stringify(r.settled)} in ${r.vw}`);
  const ms = r.goneAt !== null && r.seenAt !== null ? r.goneAt - r.seenAt : null;
  check(`the animation ends and goes (~${INTRO.totalMs} ms)`, ms !== null && ms >= INTRO.totalMs * 0.8 && ms <= INTRO.totalMs + 1200, `${ms === null ? 'never went' : `${ms} ms`}`);
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
// A touch skips forward (owner, 2026-11-06): the overlay never takes the tap — it reaches the screen — and the intro
// completes and goes well before its 2 s.
{
  const { context, page } = await open({ scheme: 'light', reducedMotion: 'no-preference', init: INTRO_RECORDER });
  await page.goto(`${APP}/login`, { waitUntil: 'load' });
  const shown = await page.waitForSelector('[data-testid="brand-intro"]', { state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
  check('the intro covers the first moment (for the skip check)', shown);
  if (shown) {
    const passThrough = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="brand-intro"]')).pointerEvents === 'none');
    check('the intro never takes a tap (touches pass through to the screen)', passThrough);
    const at = Date.now();
    await page.mouse.click(195, 600);
    const gone = await page.waitForSelector('[data-testid="brand-intro"]', { state: 'detached', timeout: 3000 }).then(() => true).catch(() => false);
    const ms = Date.now() - at;
    check('a touch skips forward: the overlay goes within 0.8 s', gone && ms <= 800, `${ms} ms`);
  }
  await context.close();
}
{
  const { context, page } = await open({ scheme: 'dark', reducedMotion: 'reduce', init: INTRO_RECORDER });
  await page.goto(`${APP}/login`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__intro?.goneAt !== null, null, { timeout: 10000 }).catch(() => null);
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => window.__intro);
  const poses = new Set(r.samples.map((x) => `${x.dLeft},${x.ukanW}`)).size;
  const ms = r.goneAt !== null && r.seenAt !== null ? r.goneAt - r.seenAt : null;
  // Under the system's Reduce Motion the whole wordmark is shown still, and Reanimated completes timings at once
  // (ReduceMotion.System): the overlay may never be painted at all — or be caught for a moment, still. Both are no motion.
  check('Reduce Motion: nothing moves (no overlay painted, or one still pose)', r.seenAt === null || poses <= 1, `${r.seenAt === null ? 'never painted' : `${poses} distinct poses of ${r.samples.length}`}`);
  check(`Reduce Motion: nothing is held for the animation (gone within ${INTRO.totalMs} ms, if shown at all)`, r.seenAt === null || (ms !== null && ms < INTRO.totalMs), `${r.seenAt === null ? 'never painted' : ms === null ? 'never went' : `${ms} ms`}`);
  check('Reduce Motion: if it is shown, it is on launch navy, as the dark splash', r.seenAt === null || r.bg === hexToRgb(INTRO_BG.dark), `${r.bg}`);
  const signIn = await page.evaluate(() => !!document.querySelector('[data-testid="dukan-mark"]') && !document.querySelector('[data-testid="brand-intro"]'));
  check('Reduce Motion: the sign-in screen is there, with its symbol, and no overlay remains', signIn);
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
