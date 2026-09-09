/**
 * The motion contract.
 *
 *   node lib/design/motion.test.ts
 *
 * Two things are pinned here, and only two, because the rest of motion is a
 * matter of taste and a taste cannot be asserted:
 *
 *  1. **Reduce Motion actually removes movement.** Not "shortens it". For some
 *     people travelling UI causes genuine nausea, and a fast lurch is a lurch.
 *  2. **Durations stay short.** This is counter software; a shopkeeper waiting
 *     on an animation is a shopkeeper not serving somebody.
 *
 * The animation *code* is not tested here — a renderer would be needed and the
 * result would assert implementation. What is tested is the decision, which is
 * a plain function precisely so it can be.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { motion, motionPlan, PRESS_SCALE, pressScale, type MotionRole } from './motion.ts';

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

const ROLES = Object.keys(motion) as MotionRole[];

// ── the approved timings ──────────────────────────────────────────────────

it('carries the approved durations', () => {
  assert.equal(motion.press, 120);
  assert.equal(motion.selection, 150);
  assert.equal(motion.sheet, 260);
  // The reveal sits inside the approved 180–220 band.
  assert.ok(motion.reveal >= 180 && motion.reveal <= 220, `reveal is ${motion.reveal}ms`);
});

it('nothing takes longer than a sheet', () => {
  // The sheet travels the furthest, so it is allowed the most time. Anything
  // slower than it is a mistake rather than a decision.
  for (const role of ROLES) {
    assert.ok(motion[role] <= motion.sheet, `${role} outlasts the sheet`);
  }
});

it('every duration is short enough to read as responsiveness', () => {
  for (const role of ROLES) {
    assert.ok(motion[role] <= 300, `${role} is ${motion[role]}ms, which is long enough to notice`);
    assert.ok(motion[role] > 0, `${role} has no duration`);
  }
});

// ── Reduce Motion ─────────────────────────────────────────────────────────

it('Reduce Motion removes movement from every role', () => {
  for (const role of ROLES) {
    assert.equal(motionPlan(role, true).movement, false, `${role} still moves under Reduce Motion`);
  }
});

it('Reduce Motion substitutes a transition rather than a jump', () => {
  // Zero duration is a flicker, which is its own accessibility problem.
  for (const role of ROLES) {
    const plan = motionPlan(role, true);
    assert.ok(plan.duration > 0, `${role} becomes an instant swap`);
    assert.ok(plan.duration <= motion[role], `${role} got SLOWER under Reduce Motion`);
  }
});

it('normal motion keeps movement and the role duration', () => {
  for (const role of ROLES) {
    assert.deepEqual(motionPlan(role, false), { duration: motion[role], movement: true });
  }
});

it('the press does not scale under Reduce Motion', () => {
  assert.equal(pressScale(true), 1);
  assert.equal(pressScale(false), PRESS_SCALE);
});

it('the press scale is felt, not seen', () => {
  // Deeper than this and the button looks pushed into the page.
  assert.ok(PRESS_SCALE >= 0.96 && PRESS_SCALE < 1, `${PRESS_SCALE} is too deep for a press`);
  assert.equal(PRESS_SCALE, 0.98);
});

// ── the rule animation must not break ─────────────────────────────────────

it('the motion layer holds no timers, promises or delays', () => {
  /*
   * The failure this guards against is the tempting one: making a caller
   * `await` a duration so the animation "finishes first". That is how an
   * animation ends up delaying a save or a scanner lock. Motion here is a
   * description — a number and a boolean — and nothing more.
   */
  const src = readFileSync('lib/design/motion.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const forbidden of ['setTimeout', 'setInterval', 'await', 'Promise', 'requestAnimationFrame']) {
    assert.ok(!src.includes(forbidden), `motion.ts must not contain ${forbidden}`);
  }
});

it('a destructive button is excluded from the press scale', () => {
  // High-friction controls stay high-friction. Asserted on the Button rather
  // than on motion.ts, because that is where the decision is made.
  const src = readFileSync('components/ui/Button.tsx', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(src, /variant !== 'danger'/);
});

it('the press animation cannot run on a disabled or loading button', () => {
  const src = readFileSync('components/ui/Button.tsx', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(src, /scalable\s*=\s*variant !== 'danger' && !inactive/);
});

it('the motion tokens import nothing, so they stay testable', () => {
  // The boundary that makes this whole file possible. Reanimated cannot be
  // resolved under bare node, so the moment motion.ts imports it the timings
  // and the Reduce Motion decision stop being checkable anywhere.
  const src = readFileSync('lib/design/motion.ts', 'utf8');
  assert.ok(!/^import /m.test(src), 'motion.ts must not import anything');
});

// ── overlay motion obeys the same system ──────────────────────────────────

it('no overlay hardcodes a duration', () => {
  /*
   * Dialogs and toasts each carried their own millisecond literals — 160, 120,
   * 180, 220 — so "change the motion system" meant finding every file that had
   * quietly opted out of it. Durations come from the tokens or they are not
   * durations.
   */
  const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const file of [
    'components/overlay/DialogHost.tsx',
    'components/overlay/ToastHost.tsx',
    'components/overlay/BottomSheet.tsx',
    'components/ui/Button.tsx',
  ]) {
    const src = strip(readFileSync(file, 'utf8'));
    const literals = src.match(/\.duration\(\s*\d+\s*\)|duration:\s*\d+/g) ?? [];
    assert.deepEqual(literals, [], `${file} hardcodes a duration: ${literals.join(', ')}`);
  }
});

it('every entering/exiting animation defers to the OS Reduce Motion setting', () => {
  // A layout animation that moves has to be able to stop moving. These are the
  // ones the user never asked for and cannot turn off from inside the app.
  const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const file of ['components/overlay/DialogHost.tsx', 'components/overlay/ToastHost.tsx']) {
    const src = strip(readFileSync(file, 'utf8'));
    const animations = src.match(/(entering|exiting|layout)=\{[^}]*\}/g) ?? [];
    assert.ok(animations.length > 0, `${file}: expected layout animations`);
    for (const a of animations) {
      assert.match(a, /reduceMotion\(ReduceMotion\.System\)/, `${file}: ${a}`);
    }
  }
});

it('nothing springs, overshoots or bounces', () => {
  // The approved system rules these out. A dialog that wobbles into place is
  // unreadable while it wobbles, and it reads as playful exactly where the app
  // is asking whether to move money.
  const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const file of [
    'components/overlay/DialogHost.tsx',
    'components/overlay/ToastHost.tsx',
    'components/overlay/BottomSheet.tsx',
    'components/ui/Button.tsx',
    'components/scanner/ScannerSheet.tsx',
  ]) {
    const src = strip(readFileSync(file, 'utf8'));
    for (const banned of ['springify', 'withSpring', 'withBounce', 'Bounce']) {
      assert.ok(!src.includes(banned), `${file} uses ${banned}`);
    }
  }
});

console.log(`motion: ${passed} passed`);
