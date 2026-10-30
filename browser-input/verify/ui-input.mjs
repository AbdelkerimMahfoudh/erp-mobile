// Typing in the browser app (the web export), in a phone-sized touch browser — Chromium or WebKit (BROWSER=webkit).
//
// The owner's physical-iPhone defects of 2026-10-24, proven fixed in a real engine:
//  1. one focus ring on the sign-in fields — no browser outline, no layout shift — for touch and keyboard focus;
//  2. sheet fields accept and keep typing: Add an account (all four services; switching service keeps the name),
//     New team member (Name, Phone, Email; changing role and store keeps them), and a third sheet form (New category);
//  3. a validation error followed by a correction, saved for real against the API (unless MOCK=1);
// across 320/375/390 px, EN/FR/AR (RTL), light and dark. WebKit here is automation on Linux, not a physical iPhone.
import { existsSync, readFileSync } from 'node:fs';
import { APP, BROWSER, MOCK, OUT, WORK, catalogues, check, engine, finish, installMock, phoneContext } from './lib.mjs';

const T = await catalogues();
const owner = MOCK ? null : JSON.parse(readFileSync(`${WORK}owner.json`, 'utf8'));
const STATE = MOCK ? undefined : `${WORK}owner-state.json`;
if (!MOCK && !existsSync(STATE)) throw new Error('run access-journey.mjs first: it signs the Owner in');

const browser = await engine.launch();
const pageErrors = [];
const LANGS = (process.env.LANGS ?? 'en,fr,ar').split(',');
const THEMES = (process.env.THEMES ?? 'light,dark').split(',');
const WIDTHS = (process.env.WIDTHS ?? '320,375,390').split(',').map(Number);

async function signedIn(opts) {
  const context = await phoneContext(browser, { ...opts, state: STATE });
  const mock = MOCK ? await installMock(context) : null;
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(`${opts.lang}/${opts.theme}/${opts.width}: ${String(e).slice(0, 160)}`));
  return { context, page, branchName: mock?.branchName ?? owner.branchName };
}
const sheet = (page) => page.locator('[aria-modal="true"]').last();
// Plain inputs, not the app's marker: the same suite run against a build without the fix must reach the fields too.
const fields = (page) => sheet(page).locator('input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"])');

/** Focus state of an input: is it the active element, does the browser draw its own outline, how many app rings. */
async function focusState(page, input, scope) {
  const s = await input.evaluate((e) => ({ active: document.activeElement === e, outline: getComputedStyle(e).outlineStyle, width: getComputedStyle(e).outlineWidth }));
  const rings = await scope.locator('[data-testid="field-ring"]').count();
  return { ...s, rings };
}
const noOutline = (s) => s.outline === 'none' || s.width === '0px';
async function tapType(page, input, text) {
  await input.tap();
  await page.waitForTimeout(150);
  await page.keyboard.type(text, { delay: 8 });
  await page.waitForTimeout(150);
}
async function layout(page, lang) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  // What sticks out, when something does: the deepest elements past the right edge, by text.
  const wide = over > 1 ? await page.evaluate(() => [...document.querySelectorAll('body *')]
    .filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1 && ![...e.children].some((c) => c.getBoundingClientRect().right > window.innerWidth + 1))
    .slice(0, 4).map((e) => `${e.tagName.toLowerCase()} w${Math.round(e.getBoundingClientRect().width)} r${Math.round(e.getBoundingClientRect().right)} "${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 40)}"`)) : [];
  const dir = await page.evaluate(() => getComputedStyle(document.body).direction + '|' + (document.documentElement.dir || ''));
  return { over, rtl: /rtl/.test(dir), ok: over <= 1 && (lang !== 'ar' || /rtl/.test(dir)), wide };
}
async function openSheet(page, path, button) {
  await page.goto(`${APP}${path}`);
  const open = page.getByText(button, { exact: true }).first();
  await open.waitFor({ timeout: 20000 });
  await open.tap();
  await sheet(page).waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
}
async function closeSheet(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(400);
}

for (const lang of LANGS) {
  const t = T[lang];
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      const where = `${lang}/${theme}/${width}`;

      // ── 1. Sign-in: one ring, no outline, nothing moves — by touch and by keyboard ─────────────────────────────────
      {
        const context = await phoneContext(browser, { lang, theme, width });
        const page = await context.newPage();
        page.on('pageerror', (e) => pageErrors.push(`${where}: ${String(e).slice(0, 160)}`));
        await page.goto(`${APP}/login`);
        const id = page.locator('input:visible').first();
        await id.waitFor({ timeout: 20000 });
        await page.waitForTimeout(400);
        const well = id.locator('xpath=..');
        const before = await well.boundingBox();
        const rest = await focusState(page, id, page);
        await id.tap();
        await page.waitForTimeout(250);
        const touch = await focusState(page, id, page);
        const after = await well.boundingBox();
        const moved = Math.max(Math.abs(after.x - before.x), Math.abs(after.y - before.y), Math.abs(after.width - before.width), Math.abs(after.height - before.height));
        check(`sign-in, touch focus: one ring, no browser outline, nothing moves ${where}`, rest.rings === 0 && touch.active && touch.rings === 1 && noOutline(touch) && moved < 0.5, JSON.stringify({ rest: rest.rings, touch, moved }));
        if (width === 390) await page.screenshot({ path: `${OUT}/signin-focus-${lang}-${theme}.png`, clip: { x: 0, y: 0, width, height: 600 } });
        // Keyboard: focus leaves, then Tab brings it to a field again — still one ring.
        await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : null));
        await page.locator('body').press('Tab');
        let keyed = null;
        for (let i = 0; i < 6; i++) {
          keyed = await page.evaluate(() => document.activeElement?.tagName === 'INPUT');
          if (keyed) break;
          await page.keyboard.press('Tab');
        }
        const kb = await page.evaluate(() => ({ outline: getComputedStyle(document.activeElement).outlineStyle, rings: document.querySelectorAll('[data-testid="field-ring"]').length }));
        check(`sign-in, keyboard focus: a field reached by Tab shows the one ring ${where}`, keyed && kb.rings === 1 && kb.outline === 'none', JSON.stringify(kb));
        const lay = await layout(page, lang);
        check(`sign-in layout ${where}`, lay.ok, JSON.stringify(lay));
        check(`sign-in fields carry the scoped autofill rule's marker ${where}`, (await page.locator('input[data-app-field]').count()) >= 2);
        await context.close();
      }

      const { context, page, branchName } = await signedIn({ lang, theme, width });

      // ── 2. Business settings → Add an account: every service, the name typed and kept ───────────────────────────────
      {
        await openSheet(page, '/settings', t['settings.accounts.add']);
        const label = fields(page).last();
        await tapType(page, label, 'Caisse principale');
        const focus = await focusState(page, label, sheet(page));
        check(`Add an account: one tap focuses "Name staff will see", it types, one ring ${where}`, focus.active && focus.rings === 1 && noOutline(focus) && (await label.inputValue()) === 'Caisse principale', JSON.stringify(focus));
        const kept = [];
        for (const p of ['sedad', 'bim_bank', 'bankily', 'other']) {
          await sheet(page).getByText(t[`settings.provider.${p}`], { exact: true }).first().tap();
          await page.waitForTimeout(200);
          kept.push(`${p}:${(await fields(page).last().inputValue()) === 'Caisse principale'}`);
        }
        check(`Add an account: switching Sedad, BIM Bank, Bankily, Other keeps the name ${where}`, kept.every((k) => k.endsWith('true')), kept.join(' '));
        // "Other" asks for the service's name: it types too, and the account's name is still there.
        const count = await fields(page).count();
        await tapType(page, fields(page).first(), 'Masrvi');
        const both = [await fields(page).first().inputValue(), await fields(page).last().inputValue()];
        check(`Add an account, Other: the service name types and the account name stays ${where}`, count === 2 && both[0] === 'Masrvi' && both[1] === 'Caisse principale', JSON.stringify({ count, both }));
        // Edit after typing: select-all and replace (delete and retype) works.
        await fields(page).last().tap();
        await page.keyboard.press('ControlOrMeta+A');
        await page.keyboard.type('Caisse 2', { delay: 8 });
        check(`Add an account: select, delete and retype ${where}`, (await fields(page).last().inputValue()).endsWith('Caisse 2'), await fields(page).last().inputValue());
        if (width === 375) await page.screenshot({ path: `${OUT}/add-account-${lang}-${theme}.png` });
        await closeSheet(page);
      }

      // ── 3. Team → New team member: Name, Phone, Email typed; role and store changed; all kept ───────────────────────
      {
        await openSheet(page, '/team', t['team.add']);
        const f = fields(page);
        // D225: the name in Latin letters, then in Arabic, then Phone and Email.
        await tapType(page, f.nth(0), 'Aminetou Test');
        await tapType(page, f.nth(1), 'أمينتو');
        await tapType(page, f.nth(2), '+22240000001');
        await tapType(page, f.nth(3), 'aminetou@example.test');
        const values = await Promise.all([0, 1, 2, 3].map((i) => f.nth(i).inputValue()));
        const handles = await Promise.all([0, 1, 2, 3].map((i) => f.nth(i).elementHandle()));
        check(`New team member: Name, Phone and Email each take a tap and typing ${where}`, values[0] === 'Aminetou Test' && values[1] === 'أمينتو' && values[2] === '+22240000001' && values[3] === 'aminetou@example.test', JSON.stringify(values));
        await sheet(page).getByText(t['team.role.store_manager'], { exact: true }).first().tap();
        await page.waitForTimeout(150);
        const store = sheet(page).getByText(branchName, { exact: true }).first();
        await store.tap();
        await page.waitForTimeout(150);
        await store.tap();
        await page.waitForTimeout(150);
        const after = await Promise.all([0, 1, 2, 3].map((i) => f.nth(i).inputValue()));
        check(`New team member: changing role and store keeps every value ${where}`, JSON.stringify(after) === JSON.stringify(values), JSON.stringify(after));
        // The very same elements, still in the page: nothing was remounted while choices changed.
        const same = await Promise.all(handles.map((h, i) => f.nth(i).evaluate((e, old) => e === old && old.isConnected, h)));
        check(`New team member: the fields are the same elements after the choices — nothing remounted ${where}`, same.every(Boolean) && (await f.count()) === 4, same.join(','));
        if (width === 375) await page.screenshot({ path: `${OUT}/new-member-${lang}-${theme}.png` });
        await closeSheet(page);
      }

      // ── 4. A third form on the same sheet: Catalogue → New category ─────────────────────────────────────────────────
      {
        await openSheet(page, '/catalog/categories', t['categories.add']);
        const name = fields(page).first();
        await tapType(page, name, 'Chargeurs');
        check(`New category: the name types and stays ${where}`, (await name.inputValue()) === 'Chargeurs');
        await closeSheet(page);
      }

      const lay = await layout(page, lang);
      check(`signed-in layout ${where}`, lay.ok, JSON.stringify(lay));
      await context.close();
    }
  }
}

// ── 5. Validation, then correction — and saved, against the real API ─────────────────────────────────────────────────
for (const [lang, theme, width] of [['en', 'light', 375], ['ar', 'dark', 320]]) {
  const t = T[lang];
  const where = `${lang}/${theme}/${width}`;
  const { context, page } = await signedIn({ lang, theme, width });

  await openSheet(page, '/settings', t['settings.accounts.add']);
  const ringColour = () => sheet(page).locator('[data-testid="field-ring"]').first().evaluate((e) => getComputedStyle(e).borderTopColor);
  const label = fields(page).last();
  await label.tap();
  await page.waitForTimeout(150);
  const focusColour = await ringColour();
  await sheet(page).getByText(t['action.save'], { exact: true }).last().tap();
  const refused = await sheet(page).getByText(t['settings.accounts.labelRequired']).first().waitFor({ timeout: 5000 }).then(() => true, () => false);
  await page.waitForTimeout(150);
  const invalidColour = await ringColour();
  await tapType(page, label, `Bankily ${lang}`);
  const focusedInvalidColour = await ringColour();
  check(`Add an account: the empty name is refused in words; its ring turns from the focus colour to the error colour, also while focused; typing goes on ${where}`,
    refused && focusColour !== invalidColour && focusedInvalidColour === invalidColour && (await label.inputValue()) === `Bankily ${lang}`,
    JSON.stringify({ focusColour, invalidColour, focusedInvalidColour }));
  if (!MOCK) {
    const saved = page.waitForResponse((r) => r.url().endsWith('/settings/receiving-accounts') && r.request().method() === 'POST', { timeout: 15000 });
    await sheet(page).getByText(t['action.save'], { exact: true }).last().tap();
    const res = await saved.catch(() => null);
    await page.waitForTimeout(1200);
    const listed = await page.getByText(`Bankily ${lang}`, { exact: true }).first().isVisible().catch(() => false);
    check(`Add an account: corrected, it saves and is listed ${where}`, res?.status() === 201 || (res?.status() === 200 && listed), `status ${res?.status()} listed ${listed}`);
  } else await closeSheet(page);

  await openSheet(page, '/team', t['team.add']);
  const f = fields(page);
  await tapType(page, f.nth(0), `Salma ${lang}`);
  await tapType(page, f.nth(1), '12');
  await sheet(page).getByText(t['team.create.submit'], { exact: true }).last().tap();
  const phoneRefused = await sheet(page).getByText(t['team.error.phone']).first().waitFor({ timeout: 5000 }).then(() => true, () => false);
  await f.nth(1).tap();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  const phone = `+2224${String(Date.now()).slice(-7)}`;
  await page.keyboard.type(phone, { delay: 8 });
  check(`New team member: a wrong phone is refused in words, then corrected in place ${where}`, phoneRefused && (await f.nth(1).inputValue()) === phone && (await f.nth(0).inputValue()) === `Salma ${lang}`);
  // Keyboard navigation: from Phone, Tab reaches Email, which types.
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);
  const onEmail = await f.nth(2).evaluate((e) => document.activeElement === e);
  if (onEmail) await page.keyboard.type(`salma.${lang}@example.test`, { delay: 8 });
  check(`New team member: Tab moves from Phone to Email, which types ${where}`, onEmail && (await f.nth(2).inputValue()) === `salma.${lang}@example.test`);
  if (!MOCK) {
    const created = page.waitForResponse((r) => /\/users$/.test(r.url()) && r.request().method() === 'POST', { timeout: 15000 });
    await sheet(page).getByText(t['team.create.submit'], { exact: true }).last().tap();
    const res = await created.catch(() => null);
    const body = res ? await res.json().catch(() => null) : null;
    await page.waitForTimeout(800);
    // Employee invitations unchanged (D214): created pending, an invitation reference to hand over, nothing sent.
    check(`New team member: saved as a pending employee with an invitation reference, as before ${where}`, res?.status() === 201 && body?.created === true && !!body?.invitation && body?.user?.status !== 'active', `status ${res?.status()} created ${body?.created} invitation ${!!body?.invitation} user ${body?.user?.status}`);
  }
  await page.screenshot({ path: `${OUT}/validation-${lang}-${theme}-${width}.png` });
  await context.close();
}

await browser.close();
check('no uncaught page error anywhere', pageErrors.length === 0, [...new Set(pageErrors)].slice(0, 5).join(' | '));
finish('ui-input');
