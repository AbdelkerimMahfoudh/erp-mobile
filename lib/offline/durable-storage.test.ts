/**
 * The web sign-in crash, pinned (CP1).
 *
 *   node lib/offline/durable-storage.test.ts
 *
 * `AuthProvider` mounts `useSyncEngine`, which loads the queue, which used to
 * construct `new Directory(Paths.document, …)`. There is no document directory
 * in a browser, so that threw — during sign-in, before any screen rendered, and
 * the whole authenticated tree came down with it.
 *
 * Two things are tested here. The decision itself, as a pure function of the
 * platform; and the **source shape** of the two storage modules, because the
 * real guarantee is not "we return early" but "no native object is constructed
 * before the platform has been checked". A behavioural test cannot see that
 * ordering; reading the file can.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { availabilityFor } from './durable-storage-rules.ts';

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

// ── The decision ────────────────────────────────────────────────────────────

it('web has no durable storage, and says why', () => {
  const a = availabilityFor('web');
  assert.equal(a.available, false);
  assert.equal(a.available === false && a.reason, 'web_has_no_document_directory');
});

it('every native platform does', () => {
  for (const os of ['ios', 'android', 'macos', 'windows']) {
    assert.equal(availabilityFor(os).available, true, `${os} should be durable`);
  }
});

it('an unrecognised platform is treated as durable, not as web', () => {
  // Only web is known to lack a document directory. Guessing that some future
  // platform also lacks one would silently disable the queue on a device that
  // can hold it, which is a worse failure than the one being fixed.
  assert.equal(availabilityFor('harmonyos').available, true);
});

// ── The source shape, which is the actual guarantee ─────────────────────────

const source = (path: string) => readFileSync(path, 'utf8');

/**
 * Every exported function that touches the filesystem must ask `isDurable()`
 * before it constructs anything native.
 */
/**
 * Comments mention `Paths.document` in prose — including the one explaining
 * this very guard. Only real code counts, so they are stripped first.
 */
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

function guardComesFirst(file: string, fnName: string): void {
  const text = withoutComments(source(file));
  const start = text.indexOf(`export function ${fnName}`);
  assert.notEqual(start, -1, `${fnName} not found in ${file}`);

  // The body up to the first native construction.
  const rest = text.slice(start);
  const nativeAt = rest.search(/new (Directory|File)\(|Paths\.document|ensureRoot\(\)|fileFor\(/);
  const guardAt = rest.indexOf('isDurable()');

  assert.notEqual(guardAt, -1, `${fnName} in ${file} never checks isDurable()`);
  assert.ok(
    nativeAt === -1 || guardAt < nativeAt,
    `${fnName} in ${file} touches the filesystem before checking isDurable()`,
  );
}

it('the queue store checks the platform before touching the filesystem', () => {
  for (const fn of ['readQueue', 'writeQueue', 'clearScope', 'listScopeFiles']) {
    guardComesFirst('lib/offline/queue-store.ts', fn);
  }
});

it('so does the draft store', () => {
  for (const fn of ['saveDraft', 'loadDraft', 'clearDraft', 'listDraftFiles']) {
    guardComesFirst('lib/offline/drafts.ts', fn);
  }
});

it('nothing native is constructed at module scope', () => {
  /*
    The lazy `ROOT` factory is what makes the guard possible at all. If either
    module ever built a Directory at import time, merely importing it from
    AuthProvider would crash on web again — before any guard could run.
  */
  for (const file of ['lib/offline/queue-store.ts', 'lib/offline/drafts.ts']) {
    const text = source(file);
    /*
      A factory is fine — `const ROOT = () => new Directory(…)` does not run at
      import. What must not exist is a direct construction, `const ROOT = new
      Directory(…)`, which would throw the moment the module is loaded.
    */
    const eagerConstruction = /^(const|let|var)\s+\w+(\s*:[^=]+)?\s*=\s*new\s+(Directory|File)\(/m;
    assert.ok(
      !eagerConstruction.test(withoutComments(text)),
      `${file} constructs a native object at module scope`,
    );
    assert.ok(
      /const ROOT = \(\) =>/.test(text),
      `${file} should reach its root through a lazy factory`,
    );
  }
});

it('AuthProvider reaches storage only through the guarded modules', () => {
  // It must never import expo-file-system, or the crash returns by a new route.
  const auth = source('hooks/useAuth.tsx');
  assert.ok(!/expo-file-system/.test(auth), 'AuthProvider must not import expo-file-system');
  assert.ok(!/Paths\.document/.test(auth), 'AuthProvider must not reference a native path');
});

it('the sync engine it mounts does not either', () => {
  const engine = source('lib/offline/use-sync.ts');
  assert.ok(!/expo-file-system/.test(engine));
  assert.ok(!/Paths\./.test(engine));
});

// ── Honesty on web ──────────────────────────────────────────────────────────

it('the queue refuses to accept work it cannot keep', () => {
  /*
    The important half. Returning an empty queue on web stops the crash; it
    would NOT stop the app telling a shop its payment report is "waiting to
    send" when a closed tab erases it. Enqueue must refuse outright.
  */
  const queue = source('lib/offline/queue.ts');
  assert.ok(/if \(!isDurable\(\)\) return \{ queued: false, reason: 'not_durable' \};/.test(queue));

  const guardAt = queue.indexOf("reason: 'not_durable'");
  const queueableAt = queue.indexOf("reason: 'not_queueable'");
  assert.ok(guardAt < queueableAt, 'the durability check should come first');
});

it('and the Sync centre says so rather than looking empty', () => {
  const screen = source('app/sync.tsx');
  assert.ok(/sync\.notDurable/.test(screen), 'the sync screen must explain the unsupported state');
});

it('no fallback store was invented to make the page render', () => {
  // A localStorage fallback would mean promising durability we cannot honour.
  for (const file of ['lib/offline/queue-store.ts', 'lib/offline/drafts.ts', 'lib/offline/queue.ts']) {
    const text = source(file);
    assert.ok(!/localStorage|sessionStorage|indexedDB/i.test(text), `${file} must not fall back to browser storage`);
  }
});

console.log(`durable storage and the web sign-in crash: ${passed} passed`);
