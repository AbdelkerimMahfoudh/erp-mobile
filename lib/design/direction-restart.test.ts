import assert from 'node:assert/strict';
import { test } from 'node:test';
import { directionVerdict, DIRECTION_NOTICE_KEYS } from './direction-restart.ts';

const base = { needsRestart: true, wantsRtl: true, actualRtl: false, isExpoGo: false, relaunchedSinceRequest: false };

test('web applies direction at once: never a notice', () => {
  assert.equal(directionVerdict({ ...base, needsRestart: false }), 'ok');
});

test('direction and language agree: nothing to say, whatever happened before', () => {
  assert.equal(directionVerdict({ ...base, actualRtl: true }), 'ok');
  assert.equal(directionVerdict({ ...base, actualRtl: true, relaunchedSinceRequest: true }), 'ok');
  assert.equal(directionVerdict({ ...base, wantsRtl: false, actualRtl: false, isExpoGo: true }), 'ok');
});

test('Arabic chosen on a left-to-right layout: restart, the first time', () => {
  assert.equal(directionVerdict(base), 'restart');
});

test('English or French chosen on a right-to-left layout: the same rule, the other way', () => {
  assert.equal(directionVerdict({ ...base, wantsRtl: false, actualRtl: true }), 'restart');
});

test('a restart already happened and nothing flipped: the build does not support it, and the notice stays', () => {
  assert.equal(directionVerdict({ ...base, relaunchedSinceRequest: true }), 'unsupported_build');
});

test('Expo Go cannot apply a direction change, and is told apart from a broken build', () => {
  assert.equal(directionVerdict({ ...base, isExpoGo: true }), 'expo_go');
  assert.equal(directionVerdict({ ...base, isExpoGo: true, relaunchedSinceRequest: true }), 'expo_go');
});

test('every verdict that is not ok has its own words', () => {
  for (const v of ['restart', 'expo_go', 'unsupported_build'] as const) {
    assert.ok(DIRECTION_NOTICE_KEYS[v].title && DIRECTION_NOTICE_KEYS[v].body);
  }
});
