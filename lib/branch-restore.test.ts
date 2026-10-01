/**
 * No request leaves before the branch the device already knows has been read.
 *
 *   node lib/branch-restore.test.ts
 *
 * Found by the visual review of 2026-10-01 (docs/66): a screen opened directly — a web reload, a link from a
 * notification — mounted and asked for its figures before the sign-in bootstrap had restored the branch,
 * and every branch-scoped read was refused once (403 "Missing permission", or 400 "X-Branch-Id header is
 * required") before the screen recovered. `lib/branch.ts` and `lib/api-client.ts` need the native storage
 * module, so the rule is read from their source, the way `report-export.test.ts` reads its own.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0;
const it = (name: string, fn: () => void) => {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`FAIL  ${name}`);
    throw e;
  }
};
const code = (p: string) => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const client = code('lib/api-client.ts');
const branch = code('lib/branch.ts');

it('the API client waits for the restored branch before it builds a request', () => {
  const send = client.slice(client.indexOf('async function send('));
  const wait = send.indexOf('await branchRestored()');
  const header = send.indexOf('getActiveBranchId()');
  assert.ok(wait > 0, 'send() does not wait for the branch');
  assert.ok(header > wait, 'the branch header is read before the wait');
});

it('every request goes through send(): plain requests and downloads alike', () => {
  assert.equal((client.match(/fetch\(`\$\{API_V1_URL\}\$\{path\}`/g) ?? []).length, 1);
  assert.match(client, /async function download\([\s\S]*?send\('GET', path/);
});

it('the branch is restored at start-up only with a stored session, and never over a choice made meanwhile', () => {
  const restore = branch.slice(branch.indexOf('const restored'));
  assert.match(restore, /getItem\(TOKEN_KEYS\.ACCESS_TOKEN\)/);
  assert.match(restore, /if \(!token \|\| !raw \|\| settled\) return;/);
  assert.match(restore, /activeBranchId = b\.id;/);
  assert.match(restore, /useBranch\.setState\(/);
});

it('choosing, restoring and clearing a branch each settle it', () => {
  for (const fn of ['setBranch: (b) => {', 'hydrate: async () => {', 'clear: () => {']) {
    const body = branch.slice(branch.indexOf(fn), branch.indexOf(fn) + 120);
    assert.match(body, /settled = true;/, `${fn} does not settle the branch`);
  }
});

console.log(`branch restore: ${passed} passed`);
