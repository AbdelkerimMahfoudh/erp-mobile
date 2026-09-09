/**
 * The rule that a crashed iPhone taught us.
 *
 *   node lib/design/worklet-safety.test.ts
 *
 * A `useAnimatedStyle` body is a **worklet**: it runs on the UI thread, in a
 * separate JS runtime. Anything it references has to be able to travel there.
 * A plain function imported from another module cannot, and on this stack the
 * failure is not an exception you can catch — the process dies. Expo Go simply
 * disappeared, with no redbox, no unhandled rejection, and no network request.
 *
 * That shipped past TypeScript, lint, 686 assertions, Expo Doctor and a web
 * export, because **none of them execute a worklet on a UI thread**. A source
 * check is a poor substitute for running the thing — but it is the only gate
 * that can catch this before somebody is holding the phone, so it exists.
 *
 * The rule: animate on the JS thread, and let the worklet do nothing but READ a
 * shared value. Every animation in this app already worked that way; the button
 * was the one exception, and it was the one that crashed.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

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

const withoutComments = (t: string): string =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name).split('\\').join('/');
    if (entry.isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const FILES = [...sourceFiles('components'), ...sourceFiles('app'), ...sourceFiles('lib')];

/** Every `useAnimatedStyle(...)` body in a file, by brace matching. */
function animatedStyleBodies(source: string): string[] {
  const bodies: string[] = [];
  const re = /useAnimatedStyle\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < source.length && depth > 0) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')') depth--;
      i++;
    }
    bodies.push(source.slice(m.index, i));
  }
  return bodies;
}

it('no animation is started inside a useAnimatedStyle worklet', () => {
  /*
   * `withTiming` itself is workletized and would survive alone. What does not
   * survive is what gets dragged in with it — an easing object built at module
   * scope, a helper imported from another file. Keeping the whole family out of
   * the worklet removes the question rather than requiring everyone to answer
   * it correctly every time.
   */
  const offenders: string[] = [];
  for (const file of FILES) {
    for (const body of animatedStyleBodies(withoutComments(readFileSync(file, 'utf8')))) {
      if (/\bwith(Timing|Spring|Repeat|Decay|Sequence|Delay)\s*\(/.test(body)) {
        offenders.push(file);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `animate on the JS thread and read the shared value in the worklet:\n  ${offenders.join('\n  ')}`,
  );
});

it('the button animates the way the rest of the app does', () => {
  // The specific regression. If this file ever goes back to computing its
  // animation inside the worklet, the app crashes on the first button press —
  // which is the first thing anybody does with it.
  const src = withoutComments(readFileSync('components/ui/Button.tsx', 'utf8'));
  assert.match(src, /useSharedValue\(1\)/, 'the scale must live in a shared value');
  assert.match(src, /scale\.value = withTiming\(/, 'the animation must start on the JS thread');

  const bodies = animatedStyleBodies(src);
  assert.equal(bodies.length, 1, 'expected exactly one animated style');
  assert.match(bodies[0], /scale\.value/, 'the worklet must read the shared value');
  assert.ok(!/pressScale\(/.test(bodies[0]), 'no imported helper may be called inside the worklet');
  assert.ok(!/easing\./.test(bodies[0]), 'no easing object may be captured inside the worklet');
});

it('sign-in reaches the network without a worklet in the way', () => {
  /*
   * Why this lives here: the crash presented as a LOGIN failure. Nothing about
   * authentication was wrong — the process died during the button press, so the
   * request was never sent. Pinning the shape of that path keeps the next
   * person from looking at auth again.
   */
  const src = withoutComments(readFileSync('hooks/useAuth.tsx', 'utf8'));
  const signIn = src.slice(src.indexOf('const signIn ='), src.indexOf('const chooseAccount'));
  assert.ok(!/useAnimatedStyle|withTiming|worklet/.test(signIn), 'sign-in must contain no animation');
  assert.match(signIn, /api\.post<LoginResult>\('\/auth\/login'/);
});

console.log(`worklet safety: ${passed} passed`);
