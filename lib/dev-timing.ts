/**
 * Stage timings, in the development build only (docs/55).
 *
 * On a phone running Expo Go these lines reach the Metro terminal — which is how a
 * handset's own numbers are read back: "[timing] review: group opened 412 ms". In a
 * production build `__DEV__` is false, every function returns at once, and nothing is
 * measured or printed. Under bare node (the pure tests) `__DEV__` is undefined, which
 * counts as off.
 *
 *   node lib/review-screen.test.ts
 */
declare const __DEV__: boolean | undefined;

const on = (): boolean => typeof __DEV__ !== 'undefined' && __DEV__ === true;
const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const marks = new Map<string, number>();

export const devTiming = {
  /** Remember when a stage began — a tap, a request. */
  mark(name: string): void {
    if (on()) marks.set(name, now());
  },
  /** Print how long it has been since the mark, once; nothing if there was no mark. */
  end(name: string, label: string): void {
    if (!on()) return;
    const at = marks.get(name);
    if (at === undefined) return;
    marks.delete(name);
    console.log(`[timing] ${label}: ${Math.round(now() - at)} ms`);
  },
  /** Run and print a synchronous piece of work. */
  time<T>(label: string, fn: () => T): T {
    if (!on()) return fn();
    const at = now();
    const out = fn();
    console.log(`[timing] ${label}: ${Math.round(now() - at)} ms`);
    return out;
  },
};
