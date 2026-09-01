/**
 * The Storage and Colour choosers, and the four states they must keep apart.
 *
 *   node lib/variant-chooser.test.ts
 *
 * ## What a device found
 *
 * Opening either chooser showed a search box, no options, and the message "The
 * list could not be loaded. You can still type it." — pushing everybody to
 * manual entry.
 *
 * ## The root cause was not in this component
 *
 * `GET /api/v1/device-catalogue/attributes` returned **404** from the running
 * backend, while `brands` and `version` returned **401**. That difference is
 * the whole diagnosis: the auth guard runs AFTER routing, so 401 means the
 * route exists and 404 means it does not. A backend started from current source
 * maps all four routes and answers `attributes` with 401 like the others — so
 * the code was right and the RUNNING PROCESS was stale, predating the commit
 * that added the endpoint.
 *
 * ## But the component was wrong too, and that is what these tests pin
 *
 * The list was fetched into an array and nothing recorded *why* it might be
 * empty. An empty array from a failed request was indistinguishable from an
 * empty array from a search matching nothing, so a failure rendered BOTH
 * "Nothing matches" and "could not be loaded", and offered no way to retry.
 *
 * A stale server will happen again. What must not happen again is the app being
 * unable to say which of four things went wrong.
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

const SELECT = 'components/catalog/VariantSelect.tsx';
const CATALOGUE = 'lib/device-catalogue.ts';

// ── the four states are distinct ──────────────────────────────────────────

it('loading, error, empty and no-match are four separate branches', () => {
  const code = withoutComments(source(SELECT));
  const body = code.slice(code.indexOf('const chooserBody'), code.indexOf('return (\n    <View style={styles.wrap}>'));

  assert.match(body, /if \(status === 'loading'\)/);
  assert.match(body, /if \(status === 'error'\)/);
  assert.match(body, /if \(options\.length === 0\)/);
  assert.match(body, /if \(visible\.length === 0\)/);

  // Order matters: a failure must return before the filter is ever consulted.
  assert.ok(
    body.indexOf("status === 'error'") < body.indexOf('visible.length === 0'),
    'the error branch comes first',
  );
});

it('a failure and a filtered-out search can never both be shown', () => {
  /*
   * THE defect, stated as the property that was violated. Each branch returns,
   * so exactly one message renders — and the failure branch returns before the
   * filter runs at all.
   */
  const code = withoutComments(source(SELECT));
  const body = code.slice(code.indexOf('const chooserBody'), code.indexOf('return (\n    <View style={styles.wrap}>'));

  const errorBranch = body.slice(body.indexOf("status === 'error'"), body.indexOf('options.length === 0'));
  assert.match(errorBranch, /catalog\.select\.unavailable/);
  assert.ok(!errorBranch.includes('noMatch'), 'the failure message says nothing about matching');

  const noMatchBranch = body.slice(body.indexOf('visible.length === 0'));
  assert.match(noMatchBranch, /catalog\.select\.noMatch/);
  assert.ok(!noMatchBranch.includes('unavailable'), 'the no-match message never claims a failure');
});

it('the bottom notice no longer duplicates the failure message', () => {
  // It used to report `unavailable` here as well as inside the chooser, which
  // is how two contradictory messages reached the screen together.
  const code = withoutComments(source(SELECT));
  const notice = code.slice(code.indexOf("origin === 'cached'"));
  assert.match(code, /status === 'ready' && origin === 'cached'/);
  assert.ok(!notice.includes('unavailable'), 'only the cached case is reported out here');
});

it('the initial state is loading, not an empty list', () => {
  // Showing an empty chooser while the request is in flight is the same lie in
  // a smaller font.
  const code = withoutComments(source(SELECT));
  assert.match(code, /useState<'loading' \| 'ready' \| 'error'>\('loading'\)/);
  assert.match(code, /setStatus\('loading'\);/);
});

// ── options appear before typing ──────────────────────────────────────────

it('options render without any search text', () => {
  /*
   * Requirement 2 and 6. The filter is applied to the full list, so an empty
   * query keeps everything — nothing gates rendering on the query being
   * non-empty.
   */
  const code = withoutComments(source(SELECT));
  assert.match(code, /const visibleStorage = storage\.filter\(\(o\) => matches\(o\.label \+ ' ' \+ o\.key, storageQuery\)\)/);
  assert.match(code, /const visibleColour = colour\.filter\(\(o\) => matches\(o\.label \+ ' ' \+ o\.key, colourQuery\)\)/);

  // `matches` treats an empty query as "everything".
  const search = withoutComments(source('lib/catalogue-search.ts'));
  assert.match(search, /if \(!q\) return true|!term|\.length === 0/, 'an empty query matches all');
});

it('both choosers share one body, so they cannot drift apart', () => {
  // The report described Storage and Colour behaving identically wrongly. Two
  // copies of this logic would eventually mean two behaviours.
  const code = withoutComments(source(SELECT));
  assert.equal((code.match(/const chooserBody = \(/g) ?? []).length, 1, 'defined once');
  assert.equal((code.match(/\{chooserBody\(/g) ?? []).length, 2, 'used by both choosers');
  assert.match(code, /\{chooserBody\(storage, visibleStorage, storageQuery, parts\.storageKey, chooseStorage\)\}/);
  assert.match(code, /\{chooserBody\(colour, visibleColour, colourQuery, parts\.colourKey, chooseColour\)\}/);
});

// ── retry ─────────────────────────────────────────────────────────────────

it('a failure offers Retry, and Retry refetches', () => {
  const code = withoutComments(source(SELECT));
  assert.match(code, /<ListRow title=\{t\('action\.retry'\)\} onPress=\{retry\} \/>/);
  assert.match(code, /const retry = \(\) => setAttempt\(\(n\) => n \+ 1\)/);
  // The effect depends on `attempt`, which is the whole mechanism.
  assert.match(code, /\}, \[attempt\]\);/);
});

it('manual entry survives a failure but does not replace the list', () => {
  /*
   * Requirement 10. `Something else` is a row in the list and a field below it,
   * not a substitute for options that loaded perfectly well.
   */
  const code = withoutComments(source(SELECT));
  assert.match(code, /parts\.storageKey === OTHER_KEY \|\| \(storage\.length === 0 && parts\.storageCustom\)/);
  assert.match(code, /parts\.colourKey === OTHER_KEY \|\| \(colour\.length === 0 && parts\.colourCustom\)/);
});

// ── independence and selection ────────────────────────────────────────────

it('choosing storage leaves colour alone, and the reverse', () => {
  const code = withoutComments(source(SELECT));
  assert.match(code, /apply\(\{ \.\.\.parts, storageKey: option\.key, storageCustom: '' \}\)/);
  assert.match(code, /apply\(\{ \.\.\.parts, colourKey: option\.key, colourCustom: '' \}\)/);
});

it('the selection is derived from the stored value, so reopening shows it', () => {
  // Requirement 11. There is no second copy to go stale, so a reopened chooser
  // reads the current selection out of the same string the row displays.
  const code = withoutComments(source(SELECT));
  assert.match(code, /const parts = parseVariant\(value, storage, colour, separator\)/);
  assert.ok(!code.includes('useState<VariantParts>'), 'no separate copy of the selection');
  // And the tick follows it.
  assert.match(code, /selectedKey === o\.key \? <Check/);
});

it('the chooser does not force the keyboard open', () => {
  // Requirement: opening a selector must not raise the keyboard. The search
  // field is an ordinary input and nothing focuses it.
  const code = withoutComments(source(SELECT));
  assert.ok(!code.includes('autoFocus'), 'no autofocus on the search field');
  assert.ok(!code.includes('.focus()'), 'nothing focuses imperatively');
});

// ── the client contract against the endpoint ──────────────────────────────

it('the client calls the endpoint the backend actually exposes', () => {
  /*
   * The path that 404'd on a stale server and 401s on a current one. Pinned
   * here so a rename on either side is caught by a test rather than by
   * somebody holding a phone.
   */
  assert.match(source(CATALOGUE), /api\.get<DeviceAttributes>\('\/device-catalogue\/attributes'\)/);

  const controller = source('../backend/src/catalog/device-catalogue.controller.ts');
  assert.match(controller, /@Get\('attributes'\)/);
  assert.match(controller, /path: 'device-catalogue', version: '1'/);
});

it('the response shape the client reads is the one the service returns', () => {
  const service = source('../backend/src/catalog/device-catalogue.service.ts');
  const attributes = service.slice(service.indexOf('attributes()'), service.indexOf('async version()'));
  for (const field of ['storage:', 'colour:', 'separator:']) {
    assert.ok(attributes.includes(field), `the service returns ${field}`);
  }

  const client = source(CATALOGUE);
  for (const field of ['storage:', 'colour:', 'separator:']) {
    assert.ok(client.includes(field), `the client type declares ${field}`);
  }
});

it('a cached copy is still used, and is reported as cached', () => {
  // Once the list has loaded once, a later outage is not a failure — it is a
  // stored answer, and it says so rather than pretending to be live.
  const client = withoutComments(source(CATALOGUE));
  assert.match(client, /const cached = read<DeviceAttributes>\(ATTRIBUTES_FILE\)/);
  assert.match(client, /origin: 'cached'/);
  assert.match(client, /origin: 'unavailable'/);
});

console.log(`variant choosers: ${passed} passed`);
