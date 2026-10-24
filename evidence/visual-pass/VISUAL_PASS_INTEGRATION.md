# 104 — Visual-quality pass: light mode, authentication, spacing, layout (D220) — code complete, verified, NOT deployed

Session: CLAUDE (cloud, https://claude.ai/code/session_01H7TfZHzwCoXvkvJ7ZuSzA9), parallel and code-only, 2026-10-24.
It deployed nothing, migrated nothing, accessed no server, and changed no DNS, tsxmr.com, email, WhatsApp, payment or
activation setting. It never used `+22231229945`.

## 1. Commits

| Repository | Branch | Commit | |
| --- | --- | --- | --- |
| erp-mobile | `visual/light-auth-spacing` | **`9e0b38b62f5502d9fde4b0c01ae2a446ff35230e`** | **final — deploy this (after the combined gates)** |
| erp-mobile | `ops/visual-check` | `521f9da`, then the evidence commit (§6) | tooling and evidence only — no app code |
| erp-backend, erp-control-web | — | unchanged | |

History of `visual/light-auth-spacing`, oldest first, from `superadmin-provisioning` `da5c73c` (the build on erp-test):

| Commit | What |
| --- | --- |
| `ef4c279` | design system: light palette, card lift, PageIntro, page width, theme preference, sheet insets, Field input |
| `48ab55a` | authentication header and frame, grouped sign-in, registration in three steps, browser Back |
| `800b949` | **merge of `browser-input-setup-code` `c8c5c0d`** (D219 — focus ring, sheet input, access wording) |
| `9ddb8be` | toggles in the reader's language; SearchInput at 320 px; a localised 404 page |
| `234d030` | theme boot from same-origin files (CSP `script-src 'self'`) instead of inline script |
| `9e0b38b` | a switch's knob stays in its track in Arabic; the palette's knob colour on the web |

## 2. Integration (the local deployment session)

`visual/light-auth-spacing` **contains** `browser-input-setup-code` at `c8c5c0d` (verified with
`git merge-base --is-ancestor`). Nothing on `browser-input-setup-code` was rewritten.

1. If `origin/browser-input-setup-code` is still `c8c5c0d`, fast-forward:
   ```
   git fetch origin
   git checkout browser-input-setup-code
   git merge --ff-only origin/visual/light-auth-spacing     # → 9e0b38b
   git push origin browser-input-setup-code
   ```
   Or deploy straight from `9e0b38b`.
2. If it has moved on since, merge (`git merge origin/visual/light-auth-spacing`); never rebase or force-push. Files
   both lines touch:
   - `components/ui/Field.tsx`: the visual line changed only the `input` style block (`minWidth: 0`,
     `type.inputWeb` on the web);
   - `components/legal/LegalPages.tsx` and `components/team/CreateMemberSheet.tsx`: already resolved in `800b949`;
   - `components/ui/SearchInput.tsx`: the visual line changed only the `input` style block.
3. The release build for erp-test is the web export of **`9e0b38b`**, not `c8c5c0d`. Rebuild it the same way:
   `ops/build-test-console` with app `9e0b38b`, or locally. Run the combined gates and `docs/103` §5 as written.
   `public/theme-boot.js` and `public/theme-boot.css` are part of the export and must be served beside the pages;
   `web-test-release.mjs` copies the whole export, so nothing changes in the runbook.
4. No backend deployment, migration or backup gate applies to this phase.

## 3. What changed, and why

### 3.1 Theme
- **One implementation** (`lib/design/theme.tsx`). A first visit follows the device's appearance; a choice (the
  Appearance switch, or the new sun/moon) is stored under `erp.theme` and wins from then on. The device is read once at
  start, not followed live.
- **Sun/moon** (`components/ui/ThemeToggle.tsx`): 48×48, lucide Moon/Sun, named in EN/FR/AR
  (`theme.toggle.toDark` / `.toLight`). It sits at the end of the shared authentication header (right in EN/FR, left in
  AR). Switching re-renders in place and keeps every typed value, the registration step and validation messages.
- **No flash of the wrong theme (browser):**
  - The export's pages are pre-rendered in light. `app/+html.tsx` loads **`/theme-boot.js` synchronously in
    `<head>`**, before the body paints. It reads `localStorage['erp.theme']`, else `prefers-color-scheme`, then sets
    `<html data-theme>`, `color-scheme` and the canvas background.
  - **`/theme-boot.css`** hides `#root` while `data-theme="dark"` and `data-theme-ready` is absent.
    `ThemeProvider` sets `data-theme-ready` after it applies the same theme, in a layout effect before React's first
    paint.
  - The boot script reads one preference, writes nothing and sends nothing. `lib/design/theme.test.ts` holds its key
    and both canvas colours to the palette.
- **Content Security Policy:**
  - The theme boot is **not inline**, so it needs only `script-src 'self'`.
  - Expo's static export still adds one inline script of its own,
    `<script type="module">globalThis.__EXPO_ROUTER_HYDRATE__=true;</script>`. A strict policy allows it by hash:
    **`'sha256-67fhrP0+BkBqmgGGXTtgiVO/9EQs3QruYNU/7fnRkI8='`**. Recompute it if the Expo SDK changes.
  - React Native Web injects its styles at run time through a `<style>` element, so `style-src` still needs
    `'unsafe-inline'` (or a nonce) whatever this phase does.
  - Verified in Chromium with:
    `default-src 'self'; script-src 'self' 'sha256-67fh…kI8='; style-src 'self' 'unsafe-inline'; img-src 'self' data:
    blob:; font-src 'self' data:; connect-src 'self' <API origin>; object-src 'none'; base-uri 'none';
    frame-ancestors 'none'`.
    The result: no violation, and the page starts dark or light from the device.
  - erp-test sends no CSP today, so this is ready rather than in force. **Before any public browser deployment, add
    this policy at the edge.** That is a separate, approved change; it does not block the password-protected test
    deployment.
- **Decision (D220):** until now the documented default was "light for everybody". It is now "the device's appearance
  until a choice". There are no production users yet, so no installed app changes appearance on its own.

### 3.2 Light-mode hierarchy (tokens; dark mode unchanged)
| Token | Before | After | Why |
| --- | --- | --- | --- |
| `surface.canvas` / `semantic.background` | `#F7F8FB` | `#F1F3F8` | card vs page 1.06:1 → 1.11:1 |
| `border.subtle` | `#E7EAEF` | `#E1E5EC` | a card's edge holds on the tinted canvas |
| `text.secondary` | `#5F6877` | `#535C6B` | 6.08:1 canvas, 6.75:1 card |
| `text.tertiary` | `#828B9B` (3.2:1) | `#666F80` | AA: 4.56:1 canvas, 5.06:1 card |
| `lift.card` (new) | — | faint shadow in light, none in dark | Card and RowGroup sit on the page |
| `type.inputWeb` (new) | — | 16/22 | under 16px, Safari on an iPhone zooms into the field and stays zoomed |
| `layout.contentMaxWidth` (new) | — | 760 | desktop pages stop stretching |

### 3.3 Authentication surfaces
- **One compact header for every `(auth)` route**: sign-in, register, **setup code, join, verify**. It comes from the
  stack's `header` option in `app/(auth)/_layout.tsx`, so setup/join/verify got it **without being edited**. It holds
  the Dukan ERP mark, a back arrow when there is history, and the toggle. Every one of these routes is centred in a
  480 column (`screenLayout`).
- **Sign-in:** top-aligned (the old vertical centring clipped the logo on phones), the fields and Sign in on one card,
  the other ways in set apart, language and policies at the foot.

### 3.4 Registration in three steps
`REGISTRATION_STEPS` (`lib/registration.ts`):
1. **Business:** business name, first store, city.
2. **You:** the Owner's name, the only Owner field the flow has.
3. **Sign-in:** WhatsApp number, consent, optional email, password ×2.

- **One submission.** The single `POST /auth/register` is unchanged. Nothing is sent between steps; nothing goes into
  the address or storage. Verified:
  - in the browser: 0 requests while moving through the steps, exactly 1 at the last step's button;
  - in the database: businesses 3 → 3 locally, and counted again on GitHub; with public activation closed, the server
    creates nothing;
  - by tests: `lib/registration.test.ts`, `__tests__/registration.test.tsx`.
- **Validation per step:** each step checks only its own fields and focuses the first one to fix. A refused field
  still accepts typing.
- **Back:**
  - The header arrow and the system gesture go back one step (`usePreventRemove`).
  - The browser's Back does too: `lib/navigation/browser-steps.ts` keeps the form's own history entries on the same
    address and navigation id.
  - Leaving a typed first step asks first; a reload asks through `beforeunload`.
  - The draft policy is unchanged: nothing is persisted.

### 3.5 Spacing, empty space and layout
- **`PageIntro`**: a page's description sits 16 from the action it introduces. This fixed Team ("Les personnes
  autorisées…" touched "Ajouter un membre"); Devices, Settings, Appearance and the hubs use it too.
- Doubled sheet inset removed in six sheets.
- `Screen` content stops at 760 on a desktop.
- More: the branch control no longer touches the title. Devices: the section labels sit apart from their rows.
- Legal links wrap at 320.

| Where | Verdict | Action |
| --- | --- | --- |
| Sign-in, phone | **Defect**: centred in a non-scrolling view, logo clipped | top-aligned scroll page |
| Sign-in / registration, desktop | **Defect**: 1,900-wide inputs | 480 column |
| Operational pages, desktop | **Defect**: stretched rows and buttons | 760 column |
| Six form sheets | **Defect**: doubled inset, a large gap under the title | inner padding removed |
| Registration | **Defect**: one long repetitive form | three steps |
| Team with one member, choose-a-branch, empty Notifications, empty accounts | **Legitimate**: a short list or a real empty state | kept; nothing added |
| Home figure cards, Money hub | **Legitimate**: content-led | unchanged |

### 3.6 Found by the final checks and fixed
- **"On" in French and Arabic:**
  - `Toggle` fell back to English "On"/"Off" on 13 screens that pass no words of their own.
  - The default now comes from `settings.toggle.*` ("Activé"/"Désactivé", "مفعّل"/"متوقف").
  - A store in the New team member sheet says "Works here / Y travaille / يعمل هنا".
  - Test: `components/ui/toggle-language.test.ts`.
- **The switch's knob in Arabic:**
  - React Native Web placed it with logical `start` from its own direction context, while the track followed the
    page's CSS direction, so the knob was drawn outside its track, over the state words.
  - The switch's wrapper now has `dir="ltr"` on the web.
  - The "on" knob was also RNW's default teal (`activeThumbColor`); it now uses the palette's colour.
- **320 px:**
  - SearchInput's web input would not shrink, so Receive and Quick receive pushed the Scan button 6 px past the
    screen. It now shrinks, with 16px text on the web.
  - The password eye was pushed out of a narrow RTL field; the Field input now shrinks too.
  - An unknown address showed Expo's default page: English only, 23 px too wide, and linking to `/_sitemap`, the list
    of every route.
  - `app/+not-found.tsx` replaces it: EN/FR/AR, one way on, no link. Test: `lib/not-found.test.ts`.

## 4. D219 corrections (`c8c5c0d`) — intact
The D219 session's own verifier, erp-control-web `ops/verify-browser-input` `657ced4`, was copied **unchanged** into
`ops/visual-check/browser-input/` and run against this branch:
- **access journey:** setup code → no approval step, no paid subscription, the grant opens the ERP;
- **input matrix:** one focus ring, typeable sheet fields through the modal boundary, validation saved, across
  320/375/390 × EN/FR/AR × light/dark.

Results on the final tree `9e0b38b`:
- GitHub run **40116908073**: access journey **21/21** and input matrix **245/245** in **WebKit and in Chromium**.
- Locally (Chromium): the same, 21/21 and 245/245. The D219 unit tests (`lib/sheet-input.test.ts`, `lib/access-pending-wording.test.ts`,
`lib/access.test.ts`, `__tests__/field-focus-ring.test.tsx`) pass on the merged tree.

## 5. Verification on `9e0b38b`
- **Local gates:**
  - `tsc` clean;
  - `expo lint` 0 errors, 28 warnings (CI limit 40; unchanged from before);
  - pure tests 123/123 files;
  - Jest 38 suites, **364/364**;
  - release config PASS;
  - web and iOS exports PASS; bundle audit PASS;
  - `web-test-release.mjs`: 99 pages + `+not-found`, 16 dynamic routes;
  - secret scan clean.
- **Expo Doctor:**
  - Locally it reports 19/21; its two network checks cannot reach exp.host.
  - On GitHub it reports **20/21**. The one finding, "packages match versions required by installed Expo SDK", is the
    documented, accepted patch-version observation (docs/75 §15.6, docs/71); `expo-camera` is pinned by the native
    patch.
  - This phase changes no package, lockfile or app config. The CI step now passes with exactly that finding and fails
    on any other.
- **Browser check** (`ops/visual-check:verify/visual-check.mjs`): **818/818 in WebKit and 818/818 in Chromium** on
  GitHub (run 40116908073), and 818/818 locally in Chromium. Every exported route passed at 320 and at 200% zoom.

## 6. Evidence
| Workflow | Run | Result |
| --- | --- | --- |
| `security` on `9e0b38b` | **40116896564** | success |
| `visual-check` on `9e0b38b` (ops `521f9da`) | **40116908073** | success — WebKit 818/818, Chromium 818/818; D219 journey 21/21 ×2, input 245/245 ×2; Doctor 20/21 (documented finding only); businesses 3 → 3 |

The full summary is `EVIDENCE_SUMMARY.md`. The 19 labelled before/after screenshots, this note and the summary are
committed on erp-mobile `ops/visual-check` under `evidence/visual-pass/`; the note is also `docs/104` in erp-docs.

## 7. Remaining physical-iPhone checks (owner)
Automation (Chromium, and WebKit on Linux) does not replace these:
1. The sun/moon is at the top of sign-in, Create account, the setup code, "I was added to a team" and the code check.
   It switches without losing typed text.
2. A first visit in a private tab with the iPhone in Dark mode: no white flash, the app opens dark.
3. Tapping a field does not zoom the page (sign-in, a sheet, the stock search).
4. Light mode: cards read as cards on the page, and text is comfortable in daylight.
5. Registration Step 1 → 2 → 3, and Safari's Back returns a step with its values. Back from a typed step 1 asks.
6. Team in French: the description no longer touches "Ajouter un membre".
7. New team member and Add an account: fields line up with the sheet title, typing works, and Save/Add stays
   reachable with the keyboard open.
8. Arabic: the header toggle is on the left; the store switch reads "يعمل هنا" with its knob inside the track; the
   password eye stays inside its field.
9. The D219 items in docs/103 §5.9: one focus ring, sheet typing, setup code without an approval screen.
