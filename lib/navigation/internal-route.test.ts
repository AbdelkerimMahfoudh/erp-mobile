/**
 * A server's link is followed only to a screen of the app's own (`internal-route.ts`).
 *
 *   node lib/navigation/internal-route.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { internalRoute } from './internal-route.ts';

test('the links the server writes are the app’s own screens, and are followed as written', () => {
  for (const link of [
    '/',
    '/analytics',
    '/closing',
    '/returns/0190f5a2-7c1e-7d3a-9b2c-1f2e3d4c5b6a',
    '/approvals/0190f5a2-7c1e-7d3a-9b2c-1f2e3d4c5b6a',
    '/transfers/0190f5a2-7c1e-7d3a-9b2c-1f2e3d4c5b6a',
    '/catalog/0190f5a2-7c1e-7d3a-9b2c-1f2e3d4c5b6a?unit=0190f5a2-7c1e-7d3a-9b2c-1f2e3d4c5b6b',
  ]) {
    assert.equal(internalRoute(link), link);
  }
});

test('an address outside the app opens nothing: a scheme, a host, a backslash, a space or a control character', () => {
  for (const link of [
    'https://example.invalid/account/trial#t=token',
    'http://example.invalid',
    '//example.invalid/start',
    '/\\example.invalid',
    '\\\\example.invalid',
    'tel:+22243210987',
    'mailto:owner@example.invalid',
    'javascript:alert(1)',
    'dukanerp://closing',
    'closing',
    ' /closing',
    '/closing\n',
    '/clo\u0000sing',
    '',
    null,
    undefined,
  ]) {
    assert.equal(internalRoute(link), null, JSON.stringify(link));
  }
});
