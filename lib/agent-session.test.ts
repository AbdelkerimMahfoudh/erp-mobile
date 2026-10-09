/**
 * The agent counter on a shared phone (2026-10-09 review).
 *
 *   node lib/agent-session.test.ts
 *
 * Structural, read from source like `report-export.test.ts`: what goes with a
 * session, what a cached answer may show, and what makes a second Confirm the
 * same request. The alternative is a device, and the device run is deferred.
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

const withoutComments = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const code = (p: string) => withoutComments(readFileSync(p, 'utf8'));
const between = (src: string, from: string, to: string) => {
  const start = src.indexOf(from);
  assert.ok(start >= 0, `missing ${from}`);
  const end = src.indexOf(to, start + from.length);
  return src.slice(start, end < 0 ? undefined : end);
};

const auth = code('hooks/useAuth.tsx');
const detail = code('app/agent/[id].tsx');
const counter = code('app/agent/new.tsx');
const keys = code('lib/query-keys.ts');
const agent = code('lib/agent.ts');

it('signing out clears every cached answer, before the next person signs in', () => {
  const signOut = between(auth, 'const signOut = async', 'const ');
  assert.match(between(auth, 'const signOut = async', 'setUser(null)'), /queryClient\.clear\(\)/);
  assert.ok(signOut.length > 0);
});

it('a new session starts from an empty cache, whatever the last one left', () => {
  assert.match(between(auth, 'const establish = async', 'setItem('), /queryClient\.clear\(\)/);
});

it('one exchange is cached per branch, never by its id alone', () => {
  assert.match(keys, /agentTransaction: \(branchId: string \| null, id: string\) => \['agent-transaction', branchId, id\]/);
  assert.match(agent, /queryKey: qk\.agentTransaction\(branchId, id \?\? ''\)/);
});

it('the full number is shown only to agent.customer.reveal, whatever the cached answer carries', () => {
  assert.match(detail, /const canReveal = usePermission\('agent\.customer\.reveal'\);/);
  assert.match(detail, /const revealed = canReveal && tx\.customerNumber \? tx\.customerNumber : null;/);
  assert.doesNotMatch(detail, /tx\.customerNumber \?\?/);
});

it('the phone’s claim of when is stamped once per key, so a second Confirm is the same request', () => {
  const confirm = between(counter, 'const confirm = async', 'const refreshProvidersAfter');
  assert.match(confirm, /const stampedAt = form\.stampedAt \?\? new Date\(\)\.toISOString\(\);/);
  assert.match(confirm, /counterPayload\(form, \{ \.\.\.provider, config: ready \}, new Date\(stampedAt\)\)/);
  assert.doesNotMatch(confirm, /counterPayload\([^)]*new Date\(\)\)/);
});

it('a lost answer on the direct path is "not confirmed yet", never "not recorded"', () => {
  const confirm = between(counter, 'const confirm = async', 'const refreshProvidersAfter');
  assert.match(confirm, /kind === 'timeout_uncertain' \|\| kind === 'server_error' \|\| kind === 'api_unreachable'/);
  assert.match(confirm, /t\('agent\.uncertain\.title'\)/);
});

it('a refusal about the configuration reads the providers again before the next review', () => {
  assert.match(counter, /code === 'stale_configuration' \|\| code === 'provider_not_configured' \|\| code === 'provider_inactive'/);
  assert.match(between(counter, 'const prepareAgain = async', 'const title'), /invalidateQueries\(\{ queryKey: qk\.agentProviders\(\) \}\)/);
  assert.match(agent, /'agent-report', 'agent-rebalancings', 'agent-providers'\]/);
});

it('discarding a restored draft takes its number off the phone', () => {
  assert.match(between(counter, 'const startOver = () =>', 'setForm(emptyCounterForm'), /if \(!sent\) void forgetNumber\(form\.clientUuid\);/);
});

console.log(`agent counter on a shared phone: ${passed} passed`);
