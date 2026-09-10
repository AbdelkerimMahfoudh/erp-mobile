/**
 * Getting a report off the phone.
 *
 *   node lib/report-export.test.ts
 *
 * Most of the risk in this feature is on the server, and it is tested there.
 * What can go wrong HERE is different in kind: a request built without the
 * branch header, a file written after the user has moved to another shop, a
 * token in a filename, a temporary file left behind after sign-out. Those are
 * structural, and are read from source — the alternative is a device, and the
 * device run is deferred.
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

const source = (p: string) => readFileSync(p, 'utf8');
const withoutComments = (t: string): string =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const EXPORT = 'lib/report-export.ts';
const CLIENT = 'lib/api-client.ts';
const SHEET = 'components/reports/ExportSheet.tsx';
const ACTION = 'components/reports/ExportAction.tsx';
const AUTH = 'hooks/useAuth.tsx';

const exportCode = withoutComments(source(EXPORT));
const clientCode = withoutComments(source(CLIENT));
const sheetCode = withoutComments(source(SHEET));

/* ── the request ─────────────────────────────────────────────────────────── */

it('downloads through the app\'s own API layer, not a bare fetch', () => {
  // A second client drifts: it misses a branch switch, or holds a token past a
  // refresh, and the symptom is a report from the wrong branch.
  assert.match(exportCode, /api\.download\(/);
  assert.ok(!/\bfetch\(/.test(exportCode), 'no fetch of its own');
});

it('the download path reuses send, refresh and the branch header', () => {
  const download = clientCode.slice(clientCode.indexOf('async function download('));
  assert.match(download, /send\('GET'/, 'goes through send, which adds X-Branch-Id');
  assert.match(download, /refreshAccessToken\(\)/, 'one refresh on 401, like every other call');
  assert.match(download, /markUnreachable|markReachable/, 'connectivity is still observed');
});

it('never puts a token in a URL or a filename', () => {
  for (const code of [exportCode, clientCode.slice(clientCode.indexOf('async function download('))]) {
    assert.ok(!/token=/.test(code), 'no token query parameter');
    assert.ok(!/\$\{token\}/.test(code.replace(/Bearer \$\{[a-z]+\}/g, '')), 'token only in the header');
  }
});

it('sends a period only to the reports that take one', () => {
  // The server rejects a date range on a current-balances report, so sending
  // one anyway would turn a valid request into a 400.
  assert.match(exportCode, /PERIOD_KINDS\.has\(kind\)/);
});

/* ── the context ─────────────────────────────────────────────────────────── */

it('captures the branch before the request and checks it after', () => {
  /*
   * The failure this prevents: switch branch while a report generates, and the
   * file that lands is the previous branch's figures under the new branch's
   * name. Nothing on the screen would say so.
   */
  const body = exportCode.slice(exportCode.indexOf('export async function exportReport'));
  const capture = body.indexOf('getActiveBranchId()');
  const compare = body.indexOf('getActiveBranchId() !== branchAtStart');
  assert.ok(capture !== -1 && compare !== -1, 'both the capture and the comparison exist');
  assert.ok(capture < compare, 'captured before the await, compared after');
  assert.ok(compare < body.indexOf('shareNatively'), 'checked BEFORE anything is written');
  assert.match(body, /return \{ status: 'stale' \}/);
});

it('scopes the temporary directory by branch', () => {
  assert.match(exportCode, /new Directory\(Paths\.cache, 'reports', branchId/);
});

it('writes to the cache directory, never to documents', () => {
  // Cache is app-private and reclaimable, which is right for a file whose
  // whole life is the next few seconds.
  assert.match(exportCode, /Paths\.cache/);
  assert.ok(!/Paths\.document/.test(exportCode), 'a report is not a document to keep');
});

/* ── concurrency ─────────────────────────────────────────────────────────── */

it('refuses a second export while one is running', () => {
  assert.match(exportCode, /if \(inFlight\) return/);
  assert.match(exportCode, /inFlight = true/);
  assert.match(exportCode, /finally \{\s*inFlight = false/);
});

it('the sheet disables every row while one is working', () => {
  assert.match(sheetCode, /disabled=\{busy !== null\}/);
  assert.match(sheetCode, /if \(busy\) return/);
});

/* ── what comes back ─────────────────────────────────────────────────────── */

it('validates the response before saving or sharing it', () => {
  // A 200 carrying a captive-portal HTML page is a real thing on shop wifi.
  const download = clientCode.slice(clientCode.indexOf('async function download('));
  assert.match(download, /text\/csv/);
  assert.match(download, /did not return a report/);
});

it('rejects a server filename that could escape its directory', () => {
  const fn = clientCode.slice(clientCode.indexOf('function filenameFrom('));
  assert.match(fn, /\[\/\\\\\]/, 'a path separator is refused');
  assert.match(fn, /x20-\\x7e/, 'ASCII only');
});

it('trusts the server for the row count rather than counting lines', () => {
  assert.match(clientCode, /x-report-rows/);
});

/* ── failure, refusal and cancellation ───────────────────────────────────── */

it('tells the user which thing went wrong', () => {
  for (const status of ['401', '403', '413']) {
    assert.ok(sheetCode.includes(status), `handles ${status}`);
  }
  assert.match(sheetCode, /sharing-unavailable/);
  assert.match(sheetCode, /reports\.error\.offline/);
});

it('prefers the server\'s own message over a generic one', () => {
  // The server knows whether it was too large, expired or forbidden.
  assert.match(sheetCode, /return error\.message/);
});

it('says nothing when the user simply backs out', () => {
  const run = sheetCode.slice(sheetCode.indexOf('async function run('));
  const from = run.indexOf("case 'cancelled'");
  // The arm itself: up to its `break`, not into the surrounding catch.
  const arm = run.slice(from, run.indexOf('break;', from));
  assert.ok(!/toast\./.test(arm), `a cancellation is not an error: ${arm}`);
});

/* ── privacy ─────────────────────────────────────────────────────────────── */

it('keeps no report content in persistent state', () => {
  for (const persisted of ['AsyncStorage', 'SecureStore', 'setItem(', 'useQuery', 'zustand']) {
    assert.ok(!exportCode.includes(persisted), `report bytes never reach ${persisted}`);
  }
});

it('drops every exported file on sign-out', () => {
  const auth = withoutComments(source(AUTH));
  const signOut = auth.slice(auth.indexOf('const signOut = async'));
  assert.match(signOut, /clearExports\(\)/);
  assert.match(exportCode, /export function clearExports/);
});

it('sweeps leftovers before writing a new one', () => {
  assert.match(exportCode, /sweep\(branchId\)/);
});

it('does NOT delete the file it just shared', () => {
  /*
   * iOS resolves `shareAsync` when the sheet closes, which can be before Mail
   * has finished reading the file. Deleting there produced an empty
   * attachment; the next export sweeps it instead.
   */
  const share = exportCode.slice(exportCode.indexOf('async function shareNatively'));
  const afterShare = share.slice(share.indexOf('finally'));
  assert.ok(!/target\.delete\(\)/.test(afterShare), 'not deleted in the finally');
});

/* ── platform ────────────────────────────────────────────────────────────── */

it('uses a browser download on web, not the share sheet', () => {
  // Expo Sharing has no local file URI to share on web.
  assert.match(exportCode, /Platform\.OS === 'web'/);
  assert.match(exportCode, /createObjectURL/);
  const web = exportCode.slice(exportCode.indexOf('function saveInBrowser'));
  assert.ok(!/Sharing\./.test(web));
});

it('builds the web download from bytes already fetched, not from a link', () => {
  // A plain <a href> to the endpoint would be an unauthenticated request, and
  // a token in the URL would land in history, logs and the referer.
  const web = exportCode.slice(exportCode.indexOf('function saveInBrowser'));
  assert.match(web, /new Blob\(\[file\.text\]/);
  assert.ok(!/reports\//.test(web), 'the href is an object URL, not an API path');
});

it('does not print a CSV', () => {
  // expo-print renders HTML to PDF. A CSV is already text.
  // Comments stripped: the file explains in prose why print is not used.
  assert.ok(!/expo-print|printToFileAsync/.test(exportCode));
});

/* ── permissions ─────────────────────────────────────────────────────────── */

it('offers only the reports this user may ask for', () => {
  assert.match(exportCode, /hasPermission\('report\.view'\)/);
  assert.match(exportCode, /EXTRA_PERMISSIONS/);
  assert.match(exportCode, /'debtors-creditors': 'loan\.view'/);
});

it('renders no button at all without report.view', () => {
  const action = withoutComments(source(ACTION));
  assert.match(action, /if \(!usePermission\('report\.view'\)\) return null/);
});

it('says plainly that the client check is not the security', () => {
  // The comment is the test: the next person to read this must not mistake a
  // hidden button for a protected endpoint.
  assert.match(source(EXPORT), /UX, not security|server checks/i);
});

/* ── copy ────────────────────────────────────────────────────────────────── */

it('has no hardcoded English in the sheet', () => {
  const strings = sheetCode.match(/(title|subtitle|accessibilityLabel)=\{?["'][A-Z][a-z]/g);
  assert.equal(strings, null, `hardcoded copy: ${strings}`);
});

it('warns that a downloaded file is no longer protected', () => {
  assert.match(sheetCode, /reports\.leavingWarning/);
});

it('every key it uses exists in all three languages', () => {
  const used = [...source(SHEET).matchAll(/'(reports\.[a-zA-Z.]+)'/g)].map((m) => m[1]);
  assert.ok(used.length > 5, 'found the keys');
  for (const lang of ['en', 'fr', 'ar']) {
    const locale = source(`lib/i18n/${lang}.ts`);
    for (const key of used) {
      assert.ok(locale.includes(`'${key}'`), `${lang} is missing ${key}`);
    }
  }
});

console.log(`report export: ${passed} passed`);
