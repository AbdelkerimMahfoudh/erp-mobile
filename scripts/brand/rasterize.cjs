// Rasterize the generated Dukan SVGs with Chromium (Playwright from erp-control-web) and write PNGs; the opaque ones are
// re-encoded as true RGB (no alpha channel) with pngjs from erp-mobile.
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');

const SVG = path.join(__dirname, 'svg');
const OUT = path.join(__dirname, 'png');
fs.mkdirSync(OUT, { recursive: true });

const JOBS = [
  // [svg, png, size, opaque background or null]
  ['dukan-app-icon.svg', 'icon.png', 1024, '#5146D9'],
  ['android-foreground.svg', 'android-icon-foreground.png', 1024, null],
  ['android-monochrome.svg', 'android-icon-monochrome.png', 1024, null],
  [null, 'android-icon-background.png', 1024, '#5146D9'],
  ['splash-light.svg', 'splash-icon.png', 1024, null],
  ['splash-dark.svg', 'splash-icon-dark.png', 1024, null],
  ['dukan-app-icon.svg', 'favicon.png', 48, '#5146D9'],
  ['dukan-app-icon.svg', 'dukan-icon-192.png', 192, '#5146D9'],
  ['dukan-app-icon.svg', 'dukan-icon-512.png', 512, '#5146D9'],
  ['dukan-app-icon.svg', 'dukan-apple-touch-icon.png', 180, '#5146D9'],
  // Small-size legibility review sheet sizes.
  ['dukan-mark.svg', 'review-mark-16.png', 16, '#F7F8FB'],
  ['dukan-mark.svg', 'review-mark-24.png', 24, '#F7F8FB'],
  ['dukan-mark-dark.svg', 'review-mark-dark-16.png', 16, '#0B0F17'],
  ['dukan-mark-dark.svg', 'review-mark-dark-24.png', 24, '#0B0F17'],
  ['dukan-app-icon.svg', 'review-icon-29.png', 29, '#5146D9'],
];

function toRgb(file) {
  const src = PNG.sync.read(fs.readFileSync(file));
  const out = new PNG({ width: src.width, height: src.height, colorType: 2, inputHasAlpha: false });
  const rgb = Buffer.alloc(src.width * src.height * 3);
  for (let i = 0, j = 0; i < src.data.length; i += 4, j += 3) {
    if (src.data[i + 3] !== 255) throw new Error(`${path.basename(file)} has a transparent pixel at ${i / 4}`);
    rgb[j] = src.data[i];
    rgb[j + 1] = src.data[i + 1];
    rgb[j + 2] = src.data[i + 2];
  }
  out.data = rgb;
  fs.writeFileSync(file, PNG.sync.write(out, { colorType: 2, inputHasAlpha: false }));
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [svg, png, size, bg] of JOBS) {
    const body = svg ? fs.readFileSync(path.join(SVG, svg), 'utf8').replace('<svg ', `<svg width="${size}" height="${size}" `) : '';
    const html = `<!doctype html><html><body style="margin:0;background:${bg ?? 'transparent'}"><div style="width:${size}px;height:${size}px;display:block">${body}</div></body></html>`;
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(html);
    const file = path.join(OUT, png);
    await page.screenshot({ path: file, omitBackground: !bg, clip: { x: 0, y: 0, width: size, height: size } });
    if (bg) toRgb(file);
    console.log(`${png} ${size}px ${bg ? 'opaque RGB' : 'transparent'}`);
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
