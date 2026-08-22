/**
 * Whether a platform can keep work on the device (CP1).
 *
 * Pure and free of any `react-native` import, so it runs under plain Node —
 * the same separation `queue-schema.ts` and `draft-schema.ts` already use.
 * Validation you cannot run is validation nobody runs.
 */

export type Availability =
  | { available: true }
  | { available: false; reason: 'web_has_no_document_directory' };

/**
 * `expo-file-system` has no document directory on web — there is no such thing
 * in a browser — so constructing `Paths.document` there throws.
 *
 * Only web is treated as lacking one. Guessing that some future platform also
 * lacks it would silently disable the queue on a device that can hold it, which
 * is a worse failure than the crash this fixes.
 */
export function availabilityFor(os: string): Availability {
  return os === 'web'
    ? { available: false, reason: 'web_has_no_document_directory' }
    : { available: true };
}
