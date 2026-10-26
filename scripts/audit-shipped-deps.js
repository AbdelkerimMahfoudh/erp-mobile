#!/usr/bin/env node
/**
 * Dependency advisories, classified by what the app actually ships (docs/48 §7.3).
 *
 *   npm audit --omit=dev --json > audit.json
 *   node scripts/audit-shipped-deps.js audit.json <web export dir> <ios export dir>
 *
 * `npm audit --omit=dev` counts Expo's command-line tools, Metro, Jest's preset and Tailwind's compiler as production
 * dependencies, because `expo` and `react-native` depend on them; nearly every high advisory it reports lives there.
 * Those tools run on a developer's machine or a build server and never reach a phone. This gate reads the exported
 * bundles' source maps — every module the web and iOS bundles contain — and:
 *
 *   - FAILS when any package carrying a high or critical advisory has a module in either bundle;
 *   - FAILS when it read no source map or no module, so it cannot pass by reading nothing;
 *   - FAILS on any critical advisory at all, shipped or not;
 *   - lists every other advisory by package as "build and test tooling only", which docs/48 §7.3 triages.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
// SDK 58: Metro writes indexed source maps; read as plain maps, or no shipped module would be seen (D222).
const { flatten } = require('./source-map-flat.cjs');

const [auditFile, ...exportDirs] = process.argv.slice(2);
if (!auditFile || exportDirs.length === 0) {
  console.error('usage: audit-shipped-deps.js <npm audit --json file> <export dir>...');
  process.exit(2);
}

let audit;
try {
  audit = JSON.parse(fs.readFileSync(auditFile, 'utf8'));
} catch (e) {
  console.error(`the audit could not be read (${e.message}): npm audit must have run`);
  process.exit(1);
}
if (!audit || typeof audit.vulnerabilities !== 'object' || !audit.metadata?.vulnerabilities) {
  console.error('the audit holds no vulnerability report: npm audit must have run');
  process.exit(1);
}

/** A package with an advisory of its own (not merely depending on one), and its worst severity. */
const RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const advised = new Map();
for (const [name, v] of Object.entries(audit.vulnerabilities)) {
  for (const via of v.via) {
    if (typeof via === 'string') continue;
    const prev = advised.get(name) ?? { severity: 'info', ids: new Set() };
    if (RANK[via.severity] > RANK[prev.severity]) prev.severity = via.severity;
    prev.ids.add(String(via.url ?? via.source).split('/').pop());
    advised.set(name, prev);
  }
}

const walk = (d) =>
  fs.readdirSync(d).flatMap((n) => (fs.statSync(path.join(d, n)).isDirectory() ? walk(path.join(d, n)) : [path.join(d, n)]));

/** The innermost package a module belongs to: `node_modules/a/node_modules/@b/c/x.js` is `@b/c`. */
const packageOf = (source) => source.match(/node_modules\/((?:@[^/]+\/)?[^/]+)\/(?!.*node_modules\/)/)?.[1];

const shipped = new Map(); // package -> Set of platforms
let maps = 0;
let modules = 0;
for (const dir of exportDirs) {
  const root = path.resolve(dir);
  for (const file of walk(root)) {
    if (!file.endsWith('.map')) continue;
    const platform = path.relative(root, file).match(/^_expo[\\/]static[\\/]js[\\/](\w+)[\\/]/)?.[1] ?? path.basename(root);
    const map = flatten(JSON.parse(fs.readFileSync(file, 'utf8')));
    maps += 1;
    for (const source of map.sources ?? []) {
      modules += 1;
      const pkg = packageOf(source);
      if (!pkg) continue;
      if (!shipped.has(pkg)) shipped.set(pkg, new Set());
      shipped.get(pkg).add(platform);
    }
  }
}

const problems = [];
if (maps === 0 || modules === 0) problems.push(`read ${maps} source map(s) and ${modules} module(s): export with --source-maps`);

const rows = [...advised.entries()].sort((a, b) => RANK[b[1].severity] - RANK[a[1].severity] || a[0].localeCompare(b[0]));
for (const [name, { severity, ids }] of rows) {
  const where = shipped.get(name);
  const place = where ? `SHIPPED in ${[...where].sort().join(', ')}` : 'build and test tooling only';
  console.log(`${severity.padEnd(8)} ${name.padEnd(28)} ${place}  ${[...ids].join(' ')}`);
  if (severity === 'critical') problems.push(`${name}: a critical advisory (${[...ids].join(', ')}) — fix or remove it, shipped or not`);
  else if (where && RANK[severity] >= RANK.high) problems.push(`${name}: a ${severity} advisory (${[...ids].join(', ')}) in the shipped ${[...where].join(', ')} bundle`);
}

const counts = audit.metadata.vulnerabilities;
console.log(
  `\nnpm audit (production tree): ${counts.critical} critical, ${counts.high} high, ${counts.moderate} moderate, ${counts.low} low; ` +
    `${advised.size} package(s) with an advisory of their own; ${maps} source map(s), ${modules} module(s), ${shipped.size} package(s) shipped`,
);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log('no package with a high or critical advisory is shipped in the app');
