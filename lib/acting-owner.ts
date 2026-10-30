/**
 * The Acting Owner's start and end, as a few choices rather than a calendar (D225): the common path is "now, until I
 * remove it", and the rest are the times a shopkeeper actually means. Computed in the business's time zone —
 * Africa/Nouakchott, UTC+0 all year, no daylight saving — so "end of today" is the shop's day, whatever the phone's.
 *
 *   node lib/acting-owner.test.ts
 */

export type StartChoice = 'now' | 'tomorrow_morning';
export type EndChoice = 'until_revoked' | 'end_of_today' | 'in_3_days' | 'in_7_days';

export const START_CHOICES: readonly StartChoice[] = ['now', 'tomorrow_morning'];
export const END_CHOICES: readonly EndChoice[] = ['until_revoked', 'end_of_today', 'in_3_days', 'in_7_days'];

/** The shop's calendar day of an instant, in Africa/Nouakchott (UTC+0). */
function shopDay(now: Date): { y: number; m: number; d: number } {
  return { y: now.getUTCFullYear(), m: now.getUTCMonth(), d: now.getUTCDate() };
}

/** The start to send: none for "now" (the server reads its own clock), else tomorrow 08:00 shop time. */
export function startOf(choice: StartChoice, now: Date): Date | null {
  if (choice === 'now') return null;
  const { y, m, d } = shopDay(now);
  return new Date(Date.UTC(y, m, d + 1, 8, 0, 0));
}

/** The end to send: none for "until I remove it"; otherwise the last second of the shop's day it falls on. */
export function endOf(choice: EndChoice, now: Date, start: Date | null): Date | null {
  if (choice === 'until_revoked') return null;
  const from = start ?? now;
  const { y, m, d } = shopDay(from);
  const days = choice === 'end_of_today' ? 0 : choice === 'in_3_days' ? 3 : 7;
  return new Date(Date.UTC(y, m, d + days, 23, 59, 59));
}

/** "End of today" chosen with a start tomorrow would end before it starts: offered only when it does not. */
export function endChoicesFor(start: StartChoice): readonly EndChoice[] {
  return start === 'now' ? END_CHOICES : END_CHOICES.filter((c) => c !== 'end_of_today');
}
