// The Owner's setup code and the business's access, against the real API (the owner's binding clarification of
// 2026-10-24), in a phone-sized touch browser — Chromium or WebKit:
//  - redeeming a valid platform-issued setup code activates the Owner at once: they sign in, with no approval step;
//  - the code works once (a replay is refused); redeeming creates no paid subscription and grants nothing;
//  - without an entitlement the app says the business has no active access yet — never "waiting for approval" — in
//    EN/FR/AR; an answer without a state reads as unreadable, never as pending;
//  - an audited no-payment grant opens the ERP at once ("Check again", no sign-out), still with no paid period.
// Leaves the signed-in Owner's browser state in the work directory for ui-input.mjs. Prints facts only.
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { API, APP, OUT, WORK, adminPassword, call, catalogues, check, engine, finish, freshCode, phoneContext } from './lib.mjs';

const T = await catalogues();
const ADMIN_PW = adminPassword();
const SECRET = readFileSync(`${WORK}totp.secret`, 'utf8').trim();
const APPROVAL = { en: /approv|review/i, fr: /approb|approuv|examen/i, ar: /موافقة|مراجعة/ };

// ── The administrator: a test business, its Owner and store, and the setup code ─────────────────────────────────────
const signIn = await call('POST', 'platform/admin/sign-in', { body: { email: 'ops@example.test', password: ADMIN_PW } });
const cookie = signIn.setCookie.map((c) => c.split(';')[0]).join('; ');
const verified = await call('POST', 'platform/admin/mfa/verify', { cookie, admin: true, body: { code: await freshCode(SECRET) } });
check('the administrator signs in with the password and the second factor', signIn.status === 200 && verified.status === 200, `sign-in ${signIn.status}, code ${verified.status}`);
const stepUp = async () => {
  const s = await call('POST', 'platform/admin/step-up', { cookie, admin: true, body: { password: ADMIN_PW, code: await freshCode(SECRET) } });
  if (s.status !== 200) throw new Error(`step-up ${s.status}`);
};
// Fictional and disposable: this database ends with the runner, and every channel is disabled.
const phone = `+2224${String(Date.now()).slice(-7)}`;
const branchName = 'Nouakchott Test Store';
await stepUp();
const made = await call('POST', 'platform/businesses', {
  cookie, admin: true,
  body: { idempotencyKey: randomUUID(), ownerName: 'Test Owner', ownerNameAr: 'مالك تجريبي', businessName: 'TSXMR Test Business', businessNameAr: 'نشاط تجريبي', phone, branchName, branchNameAr: 'متجر نواكشوط التجريبي', language: 'en', isTest: true, reason: 'Browser input and access check', confirmPassword: ADMIN_PW },
});
const SETUP = made.json?.invitation?.token;
const BUSINESS = made.json?.companyId;
check('the administrator creates a test business, its Owner and store, with a setup code', made.status === 201 && !!SETUP && !!BUSINESS, `status ${made.status}`);

const browser = await engine.launch();
const context = await phoneContext(browser, { lang: 'en', theme: 'light', width: 390 });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)));

// ── The Owner redeems the code and chooses a password — once ────────────────────────────────────────────────────────
const OWNER_PW = `pw-${randomUUID()}`;
await page.goto(`${APP}/login`);
await page.getByText(T.en['auth.action.setup'], { exact: true }).first().tap();
await page.getByText(T.en['setup.title']).first().waitFor({ timeout: 20000 });
// Visible ones only: the navigator keeps the previous screen (sign-in) mounted, hidden, behind the current one.
const boxes = page.locator('input:not([type="checkbox"]):visible');
await boxes.nth(0).tap();
await page.keyboard.type(SETUP, { delay: 2 });
await boxes.nth(1).tap();
await page.keyboard.type(OWNER_PW, { delay: 2 });
check('the setup code and the password type into the setup screen (touch)', (await boxes.nth(0).inputValue()) === SETUP && (await boxes.nth(1).inputValue()).length === OWNER_PW.length);
await page.getByText(T.en['setup.confirm'], { exact: true }).first().tap();
await page.getByText(T.en['setup.done'].split('{business}: ')[1].slice(0, 24)).first().waitFor({ timeout: 20000 });
check('the setup code is redeemed: the Owner’s password is set, no approval is mentioned', !APPROVAL.en.test(await page.locator('body').innerText()));
const replay = await call('POST', 'auth/owner-setup', { body: { token: SETUP, password: `pw-${randomUUID()}` } });
check('the same setup code again is refused — it works once', replay.status === 400, `status ${replay.status}`);
const kept = await page.evaluate(() => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage }, url: location.href }));
check('the setup code is kept nowhere in the browser', !kept.includes(SETUP));

// ── Signed in at once, before any access: an accurate "no active access yet", never approval ──────────────────────
await page.getByText(T.en['setup.signIn'], { exact: true }).first().tap();
await page.waitForURL(/\/login$/);
await boxes.nth(0).tap();
await page.keyboard.type(phone, { delay: 5 });
await boxes.nth(1).tap();
await page.keyboard.type(OWNER_PW, { delay: 2 });
await page.getByRole('button', { name: T.en['auth.action.signIn'] }).tap();
const closed = await page.getByText(T.en['access.closed.pending.title']).first().waitFor({ timeout: 25000 }).then(() => true, () => false);
const text = await page.locator('body').innerText();
check('the Owner is active at once: signed in with the chosen password, no approval step', /access-closed/.test(page.url()), new URL(page.url()).pathname);
check('without an entitlement the app says "No active access yet" — never "waiting for approval"', closed && !APPROVAL.en.test(text), text.replace(/\s+/g, ' ').slice(0, 220));
await page.screenshot({ path: `${OUT}/access-pending-en.png`, fullPage: true });
const token = await page.evaluate(() => localStorage.getItem('erp.accessToken'));
const ent = await call('GET', 'entitlement', { token });
check('redeeming the code created no paid subscription and granted nothing (pending_activation, no period, closed)',
  ent.status === 200 && ent.json?.state === 'pending' && ent.json?.status === 'pending_activation' && ent.json?.periodEnd === null && ent.json?.isComplimentary === false && ent.json?.canRead === false,
  JSON.stringify({ status: ent.status, state: ent.json?.state, sub: ent.json?.status, periodEnd: ent.json?.periodEnd, comp: ent.json?.isComplimentary, canRead: ent.json?.canRead }));

// ── An audited no-payment grant: the ERP opens at once ──────────────────────────────────────────────────────────────
await stepUp();
const grant = await call('POST', `platform/businesses/${BUSINESS}/activate-grant`, { cookie, admin: true, body: { days: 365, reason: 'Persistent test business: access without payment', confirmPassword: ADMIN_PW } });
check('the administrator gives access without payment (audited grant)', grant.status === 200 || grant.status === 201, `status ${grant.status}`);
await page.getByText(T.en['access.recheck'], { exact: true }).first().tap();
const opened = await page.getByText(T.en['testBusiness.banner']).first().waitFor({ timeout: 20000 }).then(() => true, () => false);
await page.waitForTimeout(1500);
check('with the grant the ERP opens at once — “Check again”, no sign-out, no approval', opened && !/access-closed/.test(page.url()), new URL(page.url()).pathname);
// The first time in, the Owner picks the store to work in (the app's store picker), as any Owner does once.
if (/select-branch/.test(page.url())) {
  await page.getByText(new RegExp(`^(${branchName}|متجر نواكشوط التجريبي)$`)).first().tap();
  await page.waitForURL((u) => !/select-branch/.test(u.pathname), { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
}
check('the Owner works in the test store: the app home, the test banner on it', !/select-branch|access-closed|login/.test(page.url()) && (await page.getByText(T.en['testBusiness.banner']).first().isVisible()), new URL(page.url()).pathname);
const after = await call('GET', 'entitlement', { token });
check('the grant is access without payment: complimentary, writes, still no paid period',
  after.json?.state === 'complimentary' && after.json?.canWrite === true && after.json?.periodEnd === null,
  JSON.stringify({ state: after.json?.state, canWrite: after.json?.canWrite, periodEnd: after.json?.periodEnd }));
await page.screenshot({ path: `${OUT}/access-granted-home-en.png`, fullPage: true });
const audit = await call('GET', `platform/businesses/${BUSINESS}`, { cookie });
check('the console reads the business as a test business with its access', audit.status === 200 && JSON.stringify(audit.json ?? {}).includes('"isTest":true'), `status ${audit.status}`);

// The Owner's signed-in browser, and what the input checks need: never printed.
writeFileSync(`${WORK}owner-state.json`, JSON.stringify(await context.storageState()), { mode: 0o600 });
writeFileSync(`${WORK}owner.json`, JSON.stringify({ branchName }), { mode: 0o600 });
await context.close();

// ── The access words in EN/FR/AR, and an answer without a state ─────────────────────────────────────────────────────
for (const lang of ['en', 'fr', 'ar']) {
  const ctx = await phoneContext(browser, { lang, theme: lang === 'ar' ? 'dark' : 'light', width: 320, state: `${WORK}owner-state.json` });
  const p = await ctx.newPage();
  let answer = { state: 'pending', status: 'pending_activation', canRead: false, canWrite: false, periodEnd: null, graceEnd: null, isComplimentary: false, overLimit: false };
  await p.route(`${API}/entitlement`, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer) }));
  await p.goto(`${APP}/access-closed`);
  const shown = await p.getByText(T[lang]['access.closed.pending.title']).first().waitFor({ timeout: 20000 }).then(() => true, () => false);
  const body = await p.locator('body').innerText();
  const dir = await p.evaluate(() => getComputedStyle(document.body).direction);
  check(`${lang}: no entitlement reads "${T[lang]['access.closed.pending.title']}", no approval word${lang === 'ar' ? ', right to left' : ''}`, shown && !APPROVAL[lang].test(body) && (lang !== 'ar' || dir === 'rtl'), body.replace(/\s+/g, ' ').slice(0, 160));
  await p.screenshot({ path: `${OUT}/access-pending-${lang}-320.png`, fullPage: true });
  answer = { canRead: false, canWrite: false };
  await p.getByText(T[lang]['access.recheck'], { exact: true }).first().tap();
  const unknown = await p.getByText(T[lang]['access.closed.unknown.title']).first().waitFor({ timeout: 10000 }).then(() => true, () => false);
  const pendingStill = await p.getByText(T[lang]['access.closed.pending.title']).count();
  check(`${lang}: an answer without a state reads as unreadable, never as pending`, unknown && pendingStill === 0);
  await ctx.close();
}

await browser.close();
check('no uncaught page error in the journey', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
finish('access-journey');
