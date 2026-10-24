# Visual pass (D220) — evidence summary, final commit `9e0b38b`

erp-mobile `visual/light-auth-spacing` **`9e0b38b62f5502d9fde4b0c01ae2a446ff35230e`** (contains `browser-input-setup-code`
`c8c5c0d`). Backend under test: `f5da650` (the deployed API, unchanged). WebKit is Playwright on Linux, not a physical
iPhone.

## GitHub Actions
| Workflow | Run | Target | Result |
| --- | --- | --- | --- |
| `security` (secret scan, dependency audit, tsc, lint, pure + rendered tests, release config, web/iOS export, bundle audit, shipped-deps audit) | **40116896564** | `9e0b38b` | **success** |
| `visual-check` (ops/visual-check `521f9da`) | **40116908073** | mobile `9e0b38b`, backend `f5da650` | **success** |

`visual-check` run 40116908073, step by step:
| Check | WebKit | Chromium |
| --- | --- | --- |
| visual-check.mjs (this phase) | **818/818** | **818/818** |
| D219 access journey (copied verifier, unchanged) | **21/21** | **21/21** |
| D219 input matrix (copied verifier, unchanged) | **245/245** | **245/245** |
| Expo Doctor | 20/21 — the documented finding only: `expo` ~57.0.31 vs 57.0.30, `expo-router` ~57.0.29 vs 57.0.28, `expo-sharing` ~57.0.24 vs 57.0.23 (docs/75 §15.6); the step fails on any other finding | |
| Businesses before/after the browsers | 3 → 3 | |

Earlier runs on the way, for the record:
- security: 40106059406 (`48ab55a`) success; 40106983001 (`800b949`) success; 40116276193 (`234d030`) success.
- visual-check: 40106178190 (`48ab55a`), 40106984739 and 40109005840 (`800b949`). In each, WebKit and Chromium
  passed; the runs were red only on Expo Doctor's documented finding, before the step encoded it.
- visual-check 40116290967 (`234d030`, superseded): cancelled.

## Local (Chromium; disposable MySQL 8.0 + API `f5da650`; fictional test business)
- visual-check.mjs on `9e0b38b`: **818/818**; businesses 3 → 3.
- D219 access journey **21/21**, input matrix **245/245** on `9e0b38b`.
- Gates: tsc clean; lint 0 errors / 28 warnings; pure 123/123 files; Jest 38 suites, 364/364; release config PASS;
  web + iOS export and bundle audit PASS; secret scan clean.

## What visual-check.mjs asserts (818 per browser)
- **Authentication routes:** login, register, setup, join and verify in EN/FR/AR × light/dark × 320/375/390/768/1280,
  and 1280 at 200% (= 640). For each:
  - no horizontal overflow and nothing past the screen's edge;
  - no text within 4px of the control under it;
  - WCAG AA text contrast;
  - the theme toggle visible without scrolling, ≥ 44×44, at the header's end (left in AR);
  - on a desktop, the form ≤ 520 wide.
- **Setup, join and verify (not edited by this phase):** the shared header (Dukan ERP and the toggle) is shown, and
  switching theme keeps every typed value, in EN/FR/AR.
- **Theme:**
  - a first visit follows the device (dark and light);
  - the page is dark before the app starts;
  - a choice survives a reload;
  - the toggle is reached with Tab and pressed with Enter;
  - its name is in words and localised.
- **Registration (EN/FR/AR):**
  - Continue on an empty step focuses its first field, and a refused field accepts typing;
  - switching theme keeps every value;
  - the browser's Back is a step back with its values, and Back from a typed first step asks; confirming Leave
    reaches sign-in;
  - nothing typed appears in the address or in storage;
  - **0 requests to auth/register while moving through the steps, exactly 1 POST at the end**, and the form stays
    put while activation is closed.
- **Strict CSP**, `script-src 'self' 'sha256-67fhrP0+BkBqmgGGXTtgiVO/9EQs3QruYNU/7fnRkI8='` with no
  `'unsafe-inline'` script: the page starts dark or light from the device with no violation.
- **One focus ring:** a focused field has no browser outline, in light and dark.
- **Signed in:**
  - Team: FR 390, AR dark 320, EN 1280, EN dark 375;
  - the description is ≥ 12 from Add;
  - on a desktop, a reading width ≤ 780;
  - the New team member sheet: a tapped field takes and keeps typing; the Add action can be brought into view;
  - every switch's knob stays in its track, clear of its words;
  - the store switch says "Works here / Y travaille / يعمل هنا", never "On";
  - the Arabic row reads right to left.
- **Every exported route (79: 77 pages, home, an unknown address)** at 320, 640 (1280 at 200%), 390 and 1280: no
  overflow, nothing past the edge, no text touching a control.
