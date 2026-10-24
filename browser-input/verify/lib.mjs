// Shared helpers for ops/verify-browser-input. Prints facts only: never a token, a password, a setup code or a key.
import { createRequire } from 'node:module';
import { createHmac } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export const WORK = process.env.WORK ? `${process.env.WORK}/` : '/tmp/verify-browser-input/';
export const APP = process.env.APP ?? 'http://127.0.0.1:4320';
export const API = process.env.API ?? 'http://127.0.0.1:3410/api/v1';
export const APPDIR = process.env.APPDIR ?? `${WORK}../app`;
export const BROWSER = process.env.BROWSER === 'webkit' ? 'webkit' : 'chromium';
export const MOCK = process.env.MOCK === '1';
export const OUT = `${WORK}shots/${BROWSER}`;
mkdirSync(OUT, { recursive: true });

const require = createRequire(process.env.PW_FROM ?? `${process.cwd()}/package.json`);
export const playwright = require('playwright');
export const engine = playwright[BROWSER];

// ── Results ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export const results = [];
export function check(what, ok, detail = '') {
  results.push({ what, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${BROWSER}] ${what}${detail ? ` — ${detail}` : ''}`);
  return !!ok;
}
export function finish(name) {
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n[${BROWSER}] ${name}: ${passed}/${results.length} checks passed`);
  writeFileSync(`${WORK}${name}-${BROWSER}.json`, JSON.stringify({ at: new Date().toISOString(), browser: BROWSER, results }, null, 2));
  process.exitCode = passed === results.length ? 0 : 1;
}

// ── The app's own words, from the mobile checkout under test (Node strips the types) ─────────────────────────────────
export async function catalogues() {
  const [{ en }, { fr }, { ar }] = await Promise.all(['en', 'fr', 'ar'].map((l) => import(`${APPDIR}/lib/i18n/${l}.ts`)));
  return { en, fr, ar };
}

// ── A browser context as a phone: touch, a width, a language, a theme ───────────────────────────────────────────────
export async function phoneContext(browser, { lang = 'en', theme = 'light', width = 390, state } = {}) {
  const height = width <= 320 ? 640 : 844;
  const context = await browser.newContext({
    viewport: { width, height },
    hasTouch: true,
    isMobile: BROWSER === 'chromium' || BROWSER === 'webkit',
    deviceScaleFactor: 2,
    locale: lang === 'ar' ? 'ar' : lang === 'fr' ? 'fr-FR' : 'en-US',
    colorScheme: theme,
    storageState: state,
  });
  await context.addInitScript(([l, t]) => {
    try {
      localStorage.setItem('erp.language', l);
      localStorage.setItem('erp.theme', t);
    } catch {}
  }, [lang, theme]);
  return context;
}

// ── The platform administrator over HTTP (TOTP for the disposable administrator only) ──────────────────────────────
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32(text) {
  let bits = 0, value = 0;
  const out = [];
  for (const ch of text.toUpperCase().replace(/[\s=-]/g, '')) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
export function totp(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', b32(secret)).update(counter).digest();
  const o = mac[mac.length - 1] & 0x0f;
  return String((((mac[o] & 0x7f) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3]) % 1e6).padStart(6, '0');
}
// The server refuses a code from a 30-second step it has already accepted (a replay), across processes too: the last
// step used is kept in the work directory, so the next script waits for a later one.
const STEP_FILE = `${WORK}totp.step`;
export async function freshCode(secret) {
  let last = -1;
  try {
    last = Number(readFileSync(STEP_FILE, 'utf8')) || -1;
  } catch {}
  for (;;) {
    const step = Math.floor(Date.now() / 30000);
    if (step > last && Date.now() % 30000 < 27000) {
      writeFileSync(STEP_FILE, String(step), { mode: 0o600 });
      return totp(secret, step);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}
export async function call(method, path, { cookie, token, branch, body, admin } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (branch) headers['X-Branch-Id'] = branch;
  if (admin && method !== 'GET') headers['x-requested-with'] = 'erp-control-web';
  const res = await fetch(`${API}/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, setCookie: res.headers.getSetCookie?.() ?? [] };
}
export function adminPassword() {
  return readFileSync(`${WORK}admin.pw`, 'utf8').trim();
}

// ── A mocked API, for running the input matrix without a server (MOCK=1, local only) ────────────────────────────────
export async function installMock(context) {
  const perms = JSON.parse(readFileSync(new URL('./mock-permissions.json', import.meta.url), 'utf8'));
  const me = { id: '0192f000-0000-7000-8000-000000000001', name: 'Test Owner', login: 'owner', companyId: '0192f000-0000-7000-8000-0000000000c1', companyName: 'TSXMR Test Business', personalId: 'T-0001', publicStoreId: 'S-0001', isTestBusiness: true };
  const branch = { id: '0192f000-0000-7000-8000-0000000000b1', name: 'Nouakchott Test Store', type: 'store', role: 'owner' };
  const ent = { state: 'complimentary', periodEnd: null, graceEnd: null, daysRemaining: null, graceHoursRemaining: 0, subscribedBranchCount: 1, activeBranchCount: 1, includedSeats: 1, additionalSeats: 0, seatLimit: 1, seatsUsed: 0, overLimit: false, canRead: true, canWrite: true, isComplimentary: true, status: 'activated', calculatedAt: new Date().toISOString(), complimentary: { status: 'indefinite', until: null }, trial: null, timeZone: 'Africa/Nouakchott' };
  await context.addInitScript(([m, b]) => {
    localStorage.setItem('erp.accessToken', 'mock');
    localStorage.setItem('erp.refreshToken', 'mock');
    localStorage.setItem('erp.user', JSON.stringify(m));
    localStorage.setItem('erp.branch', JSON.stringify(b));
  }, [me, branch]);
  await context.route(`${API.replace(/\/api\/v1$/, '')}/**`, (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api\/v1/, '');
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const key = `${req.method()} ${path}`;
    if (key === 'GET /auth/me') return json(me);
    if (key === 'GET /auth/branches') return json([branch]);
    if (key === 'GET /auth/permissions') return json({ branchId: branch.id, role: 'owner', permissions: perms });
    if (key === 'GET /entitlement') return json(ent);
    if (key === 'GET /settings') return json({ canManage: true, returnWindowHours: 72, whatsapp: { language: 'en', includeAmounts: false, dailyEnabled: false, monthlyEnabled: false }, security: { autoLockMaxSeconds: 300 }, receivingAccounts: [], version: 1 });
    if (req.method() === 'GET') return json(/s$|list|history|items|categories/.test(path) ? [] : {});
    return json({ ok: true });
  });
  return { branchName: branch.name };
}
