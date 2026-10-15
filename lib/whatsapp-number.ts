/**
 * A WhatsApp number as the server stores it, so the app can recognise it in
 * the account it reads back (`app/account/index.tsx`, after a confirmation
 * whose answer was lost).
 *
 * The server's rule, mirrored exactly: `normalisePhone`
 * (`erp-backend/src/auth/identifier.ts`), else `toE164`
 * (`erp-backend/src/users/contact.util.ts`) — spaces, hyphens, dots and
 * brackets dropped; eight digits are a Mauritanian number (+222), eleven
 * starting 222 carry the country code, nine to fifteen are kept as written
 * with a `+`; otherwise a leading `00` reads as `+`. The server decides what a
 * number is and refuses one it cannot read; this only compares with it. The
 * two are kept identical by their tests.
 */
export function whatsAppNumber(raw: string): string | null {
  const cleaned = raw.trim().replace(/[\s\-().]/g, '');
  if (/^\+?\d+$/.test(cleaned)) {
    const digits = cleaned.replace(/^\+/, '');
    if (digits.length === 8) return `+222${digits}`;
    if (digits.length === 11 && digits.startsWith('222')) return `+${digits}`;
    if (digits.length >= 9 && digits.length <= 15) return `+${digits}`;
  }
  const international = cleaned.startsWith('00') ? `+${cleaned.slice(2)}` : cleaned;
  return /^\+[1-9]\d{7,14}$/.test(international) ? international : null;
}
