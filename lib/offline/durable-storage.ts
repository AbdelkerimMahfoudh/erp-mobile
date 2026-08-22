import { Platform } from 'react-native';
import { availabilityFor, type Availability } from './durable-storage-rules.ts';

/**
 * The platform question, answered for the running app (CP1).
 *
 * The decision itself lives in `durable-storage-rules.ts` so it can be tested
 * without a device. This file only supplies the platform.
 *
 * Web is **explicitly online-only**: drafts are not kept, mutations are not
 * queued, and every surface says so. Inventing a `localStorage` fallback would
 * mean claiming durability we cannot honour — the tab closes, the profile is
 * cleared, and a shop's unsent expense report is gone with no trace it existed.
 */
export function isDurable(): boolean {
  return availabilityFor(Platform.OS).available;
}

/** For the Sync centre, so it can explain itself rather than look empty. */
export function unavailableReason(): Availability {
  return availabilityFor(Platform.OS);
}

export { availabilityFor, type Availability };
