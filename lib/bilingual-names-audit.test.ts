import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'node:test';

/**
 * D225: a screen never shows a business, store or person by its Latin name alone when the server sent the Arabic one.
 *
 * The server pairs each such name with an `…Ar` field (`requestedBy` / `requestedByAr`, `otherParty` / `otherPartyAr`,
 * …). Every read of one of these fields in a screen goes through `nameIn` or `displayName`, which pick the reader's
 * script — or is listed here with the reason it stays Latin.
 *
 *   node lib/bilingual-names-audit.test.ts
 */

const FIELDS = ['requestedBy', 'decidedBy', 'sentBy', 'receivedBy', 'reportedBy', 'confirmedBy', 'otherParty', 'soldBy', 'requesterName', 'approverName', 'overriddenBy'];

/** Files whose reads stay Latin, and why. */
const LATIN: Record<string, string> = {
  'app/(tabs)/agent-transactions.tsx': 'an agent record’s recordedBy is an immutable snapshot with no Arabic column',
  'app/agent/[id].tsx': 'the same immutable agent snapshots',
  'app/agent/rebalance.tsx': 'the same immutable agent snapshots',
};

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx?$/.test(name) && !name.includes('.test.') ? [p] : [];
  });

it('every name with an Arabic twin is read in the reader’s script', () => {
  const read = new RegExp(`[\\w\\]\\)]\\??\\.(${FIELDS.join('|')})\\b(?!Ar\\b)(?!\\s*[:=])`, 'g');
  const offending: string[] = [];
  for (const file of ['app', 'components'].flatMap((d) => sources(join(ROOT, d)))) {
    const rel = relative(ROOT, file);
    if (rel in LATIN) continue;
    const text = readFileSync(file, 'utf8').replace(/'[^'\n]*'/g, "''");
    for (const line of text.split('\n')) {
      for (const m of line.matchAll(read)) {
        // Read through the helper, which takes the Latin and the Arabic field together.
        if (!/nameIn\(|displayName\(/.test(line)) offending.push(`${rel}: ${m[1]} — ${line.trim().slice(0, 100)}`);
      }
    }
  }
  assert.deepEqual(offending, []);
});
