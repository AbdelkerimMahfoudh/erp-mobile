# Brand assets

The identity is the owner's approved logo pack, **Dukan-ERP-Logo-Pack** (2026-11-04). It is the source of truth: nothing
is redrawn here.

    node scripts/brand/import-pack.cjs "<path to Dukan-ERP-Logo-Pack>"

writes:

| Output | From the pack |
|---|---|
| `assets/images/icon.png` | `Icon/Home-icon-1024.png`, byte for byte (iOS home icon; the pack supplies one icon, used for light and dark) |
| `assets/images/splash-icon-dark.png` | `Logo/D-symbol-640.png`, byte for byte (dark launch, on launch navy `#000A37`) |
| `assets/images/splash-icon.png` | the same PNG with its white lettering turned launch navy, accent and edges kept (light launch) |
| `assets/brand/pack/*.svg` | every SVG as supplied, and its `-light` variant (lettering `#FFFFFF` → `#000A37`, nothing else) |
| `lib/brand-pack.ts` | the SVGs' paths, fills and offsets, which the app draws (`components/brand/DukanMark.tsx`) |

Not in the pack, so not invented: an iOS tinted icon, and Android-specific icon artwork (the Android icons and the web
favicon still carry the previous mark until the pack supplies them or the owner decides).
