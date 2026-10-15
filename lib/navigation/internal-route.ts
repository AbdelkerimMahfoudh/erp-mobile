/**
 * A link the server hands the app — a notification's `actionLink` — as a
 * screen of the app's own, or nothing.
 *
 * expo-router takes any `href` with a scheme (`https:`, `tel:`) or that starts
 * with `//` for an address outside the app and gives it to the system browser,
 * so a link is followed only when it is a path of this app: `/`, then a segment
 * — never `//host` or `/\host`, never a backslash, a space or a control
 * character. The server's links are all of that shape (`/approvals/…`,
 * `/transfers/…`, `/catalog/…?unit=…`); anything else opens nothing.
 */
export function internalRoute(link: string | null | undefined): string | null {
  return typeof link === 'string' && /^\/(?![/\\])[^\\\s\u0000-\u001f\u007f]*$/.test(link) ? link : null;
}
