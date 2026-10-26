// What the web export shows on its first pages: console errors, page errors, the text, the test ids, a screenshot.
// Usage: node web-smoke.mjs <playwright module dir> <export dir> <out dir>
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { createRequire } from 'node:module';

const [pwDir, root, out] = process.argv.slice(2);
const { chromium } = createRequire(join(pwDir, 'package.json'))('playwright');
mkdirSync(out, { recursive: true });

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf' };
const file = (p) => (existsSync(p) && statSync(p).isFile() ? p : null);
const server = createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const base = join(root, url);
  const hit = file(base) || file(`${base}.html`) || file(join(base, 'index.html'));
  const target = hit || join(root, '+not-found.html');
  res.writeHead(hit ? 200 : 404, { 'Content-Type': types[extname(target)] || 'application/octet-stream' });
  createReadStream(target).pipe(res);
}).listen(4399, '127.0.0.1');

const browser = await chromium.launch();
const report = [];
for (const route of ['/login', '/setup', '/']) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const consoleLines = [];
  const pageErrors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleLines.push(`${m.type()}: ${m.text()}`.slice(0, 600)); });
  page.on('pageerror', (e) => pageErrors.push(`${e.name}: ${e.message}\n${(e.stack || '').split('\n').slice(0, 8).join('\n')}`));
  await page.goto(`http://127.0.0.1:4399${route}`, { waitUntil: 'load' });
  await page.waitForTimeout(5000);
  const facts = await page.evaluate(() => ({
    text: document.body.innerText.slice(0, 1500),
    testIds: [...document.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid')).slice(0, 40),
    rootChildren: document.getElementById('root')?.childElementCount ?? -1,
    theme: document.documentElement.dataset.theme ?? null,
    ready: document.documentElement.hasAttribute('data-theme-ready'),
  }));
  const name = route === '/' ? 'home' : route.slice(1);
  await page.screenshot({ path: join(out, `${name}.png`) });
  report.push(`===== ${route}\npage errors (${pageErrors.length}):\n${pageErrors.join('\n---\n')}\nconsole (${consoleLines.length}):\n${consoleLines.slice(0, 30).join('\n')}\nfacts: ${JSON.stringify({ ...facts, text: undefined })}\ntext:\n${facts.text}\n`);
  await page.close();
}
await browser.close();
server.close();
writeFileSync(join(out, 'web-smoke.txt'), report.join('\n'));
console.log(report.join('\n'));
