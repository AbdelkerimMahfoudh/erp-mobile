import React from 'react';
import { usePermissionStore, type Permission } from '../../lib/permissions';

/**
 * Declarative permission gate.
 *
 *   <Can perm="cost.view">
 *     <StatTile label="Profit" value={formatMoney(profit)} />
 *   </Can>
 *
 * Renders nothing when the role lacks access — which is the point. A control
 * that 403s on tap, or a money tile the server already emptied, teaches staff
 * that the app is unreliable. Omitting it says "this is not part of your job".
 *
 * Use `fallback` only when the absence would leave something confusing behind
 * (a lopsided row of tiles, an empty section). Most of the time, nothing is
 * the right answer.
 *
 * This is presentation only — see the note in `lib/permissions.ts`. The server
 * enforces the same rules and does not trust any of this.
 */

export interface CanProps {
  /** Single permission. */
  perm?: Permission;
  /** Passes when the role has at least one. */
  anyOf?: Permission[];
  /** Passes only when the role has all. */
  allOf?: Permission[];
  /** Rendered instead when the check fails. */
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export function Can({ perm, anyOf, allOf, fallback = null, children }: CanProps) {
  const allowed = usePermissionStore((s) => {
    const granted = s.granted;
    if (perm && !granted.has(perm)) return false;
    if (anyOf && !anyOf.some((p) => granted.has(p))) return false;
    if (allOf && !allOf.every((p) => granted.has(p))) return false;
    // No constraint given — render. Guards against an empty <Can> silently
    // hiding content because someone forgot the prop.
    return true;
  });

  return <>{allowed ? children : fallback}</>;
}
