#!/usr/bin/env node
/**
 * Package the web export for the protected browser-test site (docs/102 §4).
 *
 *   node scripts/web-test-release.mjs <export-dir> <release-dir> <api-origin> [--production-api]
 *
 * Writes `<release-dir>/site/` (the export, copied) and `<release-dir>/routes.caddy` (lib/web-routes.ts), the two
 * things the edge's `web-test.caddy` (staging) or `test-app.caddy` (production, D217) serves. It refuses:
 * - an API origin that is not an exact https origin;
 * - production's API unless `--production-api` says so: the owner's decision of 2026-10-20 (D217) puts the private test
 *   site beside the production API, where only persistent test businesses use it — said on purpose, never by default;
 * - an export whose bundle does not carry that origin: built without `EXPO_PUBLIC_API_ORIGIN`, or for another API;
 * - a release directory that already exists: a release is made whole, never on top of another.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { caddyRoutes, pageRoutes } from '../lib/web-routes.ts';

const PRODUCTION_API = 'https://api.tsxmr.com';

const args = process.argv.slice(2);
const productionApi = args.includes('--production-api');
const [exportDir, releaseDir, apiOrigin] = args.filter((a) => !a.startsWith('--'));
/** @param {string} message @returns {never} */
const fail = (message) => {
  console.error(`web-test-release: ${message}`);
  process.exit(1);
};

if (!exportDir || !releaseDir || !apiOrigin) fail('usage: node scripts/web-test-release.mjs <export-dir> <release-dir> <api-origin> [--production-api]');
let parsed = null;
try {
  parsed = new URL(apiOrigin);
} catch {
  parsed = null;
}
if (!parsed || parsed.protocol !== 'https:' || parsed.origin !== apiOrigin) fail(`"${apiOrigin}" is not an exact https:// origin`);
if (apiOrigin === PRODUCTION_API && !productionApi) fail('the production API needs --production-api (D217: persistent test businesses only)');
if (productionApi && apiOrigin !== PRODUCTION_API) fail(`--production-api names ${PRODUCTION_API}, not ${apiOrigin}`);
if (!existsSync(join(exportDir, 'index.html'))) fail(`${exportDir} is not a web export (no index.html)`);
if (existsSync(releaseDir)) fail(`${releaseDir} already exists`);

/** @param {string} dir @returns {string[]} */
function filesUnder(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [relative(exportDir, path).split(sep).join('/')];
  });
}

const files = filesUnder(exportDir);
const bundles = files.filter((f) => f.startsWith('_expo/static/js/') && f.endsWith('.js'));
if (!bundles.some((f) => readFileSync(join(exportDir, f), 'utf8').includes(`"${apiOrigin}"`))) {
  fail(`the export was not built for ${apiOrigin}: build it with EXPO_PUBLIC_API_ORIGIN=${apiOrigin}`);
}

const pages = files.filter((f) => f.endsWith('.html'));
const routes = pageRoutes(pages);
mkdirSync(releaseDir, { recursive: true });
cpSync(exportDir, join(releaseDir, 'site'), { recursive: true });
writeFileSync(join(releaseDir, 'routes.caddy'), caddyRoutes(routes));
console.log(`web-test-release: ${pages.length} pages, ${routes.length} dynamic routes, API ${apiOrigin} → ${releaseDir}`);
