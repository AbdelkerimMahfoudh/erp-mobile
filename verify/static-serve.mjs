// Serves an expo-router `web.output: "static"` export as a static host would:
// a file if it exists; `/x` → x.html or x/index.html; an unknown segment → the [param] page; else +not-found.
import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
const ROOT = process.argv[2];
const PORT = Number(process.argv[3] || 8090);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.map': 'application/json' };
const isFile = async (p) => { try { return (await stat(p)).isFile(); } catch { return false; } };
async function resolve(pathname) {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  if (await isFile(join(ROOT, clean))) return join(ROOT, clean);
  for (const c of [join(ROOT, clean + '.html'), join(ROOT, clean, 'index.html')]) if (await isFile(c)) return c;
  const segments = clean.split('/').filter(Boolean);
  let dir = ROOT;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const entries = await readdir(dir).catch(() => []);
    if (i === segments.length - 1) {
      if (entries.includes(seg + '.html')) return join(dir, seg + '.html');
      if (await isFile(join(dir, seg, 'index.html'))) return join(dir, seg, 'index.html');
      const page = entries.find((e) => /^\[[^\]]+\]\.html$/.test(e));
      return page ? join(dir, page) : null;
    }
    if (entries.includes(seg)) { dir = join(dir, seg); continue; }
    const param = entries.find((e) => /^\[[^\]]+\]$/.test(e));
    if (!param) return null;
    dir = join(dir, param);
  }
  return null;
}
createServer(async (req, res) => {
  const file = await resolve(new URL(req.url, 'http://x').pathname);
  const target = file ?? join(ROOT, '+not-found.html');
  try {
    const body = await readFile(target);
    res.writeHead(file ? 200 : 404, { 'Content-Type': TYPES[extname(target)] ?? 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(PORT, '127.0.0.1', () => console.log(`static export on http://127.0.0.1:${PORT}`));
