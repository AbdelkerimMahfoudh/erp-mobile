import { format as formatDateFns } from 'date-fns';
import { dateLocaleFor } from './date-locale.ts';

/**
 * An instant on a named zone's clock — the business's own, never the phone's
 * (the owner's correction of 2026-10-13).
 *
 * A free trial ends at one exact instant, which the server stores and sends in
 * UTC. "Ends 20 Oct · 19:30" means something only with the zone it is read in,
 * and the zone that counts is the business's configured one, which the server
 * names beside the instant — not whatever zone this phone is set to, and not a
 * zone written here: Mauritania keeping GMT today is the server's answer, not
 * an assumption of this file.
 *
 * `Intl` does the conversion, because it knows every zone's rules, summer time
 * included; date-fns then writes the day in the app's own pattern and month
 * words, so a zoned date reads exactly like every other date in the app, and
 * the zone's name follows it so nobody has to guess which clock it means. No
 * arithmetic on the instant. Pure — no React — so a plain node test can run it
 * on phones set to several zones.
 */

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** The zone's own name in the reader's language: "Greenwich Mean Time", "heure normale du Japon". */
  zoneName: string;
}

/** The app's language for `Intl`, its digits kept Latin as everywhere in the app (`USE_LATIN_DIGITS`). */
function intlLocale(language: string): string {
  if (language === 'ar') return 'ar-u-nu-latn';
  if (language === 'fr') return 'fr';
  return 'en';
}

/** What a clock in `timeZone` shows at `instant`, or null when this device cannot read that zone. */
function wallClock(instant: Date, timeZone: string, language: string): WallClock | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(instant);
    const field = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
    const zoneName = new Intl.DateTimeFormat(intlLocale(language), { timeZone, timeZoneName: 'long' })
      .formatToParts(instant)
      .find((p) => p.type === 'timeZoneName')?.value;
    const clock = { year: field('year'), month: field('month'), day: field('day'), hour: field('hour'), minute: field('minute'), zoneName: zoneName ?? timeZone };
    return [clock.year, clock.month, clock.day, clock.hour, clock.minute].every(Number.isFinite) ? clock : null;
  } catch {
    return null;
  }
}

const two = (n: number) => String(n).padStart(2, '0');

/**
 * `instant` as "20 Oct 2026 · 19:30 (Japan Standard Time)": the app's date and
 * time pattern on `timeZone`'s clock, then the zone's name.
 *
 * A zone this device does not know is shown on UTC's clock, named as such —
 * still the exact instant, honestly labelled — rather than on the phone's own
 * clock, which would be a different time under the same words.
 */
export function formatInZone(instant: Date, timeZone: string, language: string): string {
  const at = wallClock(instant, timeZone, language) ??
    wallClock(instant, 'UTC', language) ?? {
      year: instant.getUTCFullYear(),
      month: instant.getUTCMonth() + 1,
      day: instant.getUTCDate(),
      hour: instant.getUTCHours(),
      minute: instant.getUTCMinutes(),
      zoneName: 'UTC',
    };
  // Noon of that calendar day, so no summer-time change on the phone can move the date the zone's clock shows.
  const day = formatDateFns(new Date(at.year, at.month - 1, at.day, 12), 'd MMM yyyy', { locale: dateLocaleFor(language) });
  return `${day} · ${two(at.hour)}:${two(at.minute)} (${at.zoneName})`;
}
