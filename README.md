# ops/visual-check

Tooling only — no application code. The browser ERP's visual-quality check (owner's iPhone review, 2026-10-24) in
WebKit and Chromium on GitHub Actions, against a disposable API and one fictional test business. Edit
`verify/target.env` and push to run it again. It deploys nothing. WebKit on Linux is not a physical iPhone.

## Brand gate (`verify/brand.mjs`, D224, 2026-10-29)

The Dukan ledger mark is a release gate, run in both engines on every push, signed out, against the same export:
- the configuration: an opaque RGB 1024×1024 iOS icon (no alpha, no tRNS), `supportsTablet` false, light/dark
  automatic, the static splash on the light and dark canvas at the animation's own width, Android's adaptive layers;
- the matrix 320/375/390 px × light/dark × EN/FR/AR (RTL): the header mark at 28 px with its three layers in the
  palette's tokens, never mirrored, inside the viewport; the wordmark whole; the canvas; no sideways scroll;
- no theme-boot flash, sampled from the document's first instant;
- the launch animation: it moves, matches the splash's colour and size, ends in time, and ordinary navigation never
  plays it again;
- Reduce Motion: the halves never move (Reanimated finishes the timings at once, so the overlay may not be painted).

The native splash's hand-over is checked only as configuration here; seeing it is the physical iPhone gate.
