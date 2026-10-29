# Dukan brand assets

Generated from the owner's interlocking-ledger pack (2026-10-29) with the design tokens (`lib/design/colors.ts`), never
the pack's own hex values:

1. `py -3 scripts/brand/make-svgs.py` writes the SVG variants (mark light/dark/mono, lockups, app icon, Android
   adaptive layers, splash) into `scripts/brand/svg/`, keeping the layers `ledger-left`, `ledger-right` and
   `interlock-highlight`.
2. `node scripts/brand/rasterize.cjs` renders every PNG size with headless Chrome (Playwright, `channel: 'chrome'`;
   run it where `playwright` resolves) and re-encodes the opaque ones as RGB with no alpha channel (`pngjs`).
3. Copy `png/icon.png`, `android-icon-*.png`, `splash-icon*.png` and `favicon.png` into `assets/images/`, and the mark
   and lockup SVGs into `assets/brand/`. `lib/brand.test.ts` holds the result to the contract.
