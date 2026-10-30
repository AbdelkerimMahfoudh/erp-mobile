import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { phoneState, pushLocale, registrationNeeded, shouldOfferPush } from './push-policy.ts';

describe('shouldOfferPush — after sign-in, once, never at launch (D225)', () => {
  it('offers right after signing in, while iOS has not been asked', () => {
    assert.equal(shouldOfferPush({ permission: 'undetermined', justSignedIn: true, declined: false }), true);
  });
  it('never at a cold launch with a restored session', () => {
    assert.equal(shouldOfferPush({ permission: 'undetermined', justSignedIn: false, declined: false }), false);
  });
  it('never again after "Not now"', () => {
    assert.equal(shouldOfferPush({ permission: 'undetermined', justSignedIn: true, declined: true }), false);
  });
  it('never once iOS has answered, either way, or where push does not exist', () => {
    for (const permission of ['granted', 'denied', 'unsupported'] as const) assert.equal(shouldOfferPush({ permission, justSignedIn: true, declined: false }), false);
  });
});

describe('phoneState', () => {
  it('maps each permission to what "This phone" offers', () => {
    assert.equal(phoneState('granted'), 'on');
    assert.equal(phoneState('undetermined'), 'ask');
    assert.equal(phoneState('denied'), 'settings');
    assert.equal(phoneState('unsupported'), 'unsupported');
  });
});

describe('pushLocale', () => {
  it('each phone reads its pushes in the app’s language', () => {
    assert.equal(pushLocale('ar'), 'ar');
    assert.equal(pushLocale('fr'), 'fr');
    assert.equal(pushLocale('en'), 'en');
    assert.equal(pushLocale('es'), 'en');
  });
});

describe('registrationNeeded', () => {
  const now = { token: 'ExponentPushToken[a]', userId: 'u1', locale: 'ar' };
  it('registers the first time, after a rotation, for another person, or in another language', () => {
    assert.equal(registrationNeeded(null, now), true);
    assert.equal(registrationNeeded({ ...now, token: 'ExponentPushToken[b]' }, now), true);
    assert.equal(registrationNeeded({ ...now, userId: 'u2' }, now), true);
    assert.equal(registrationNeeded({ ...now, locale: 'en' }, now), true);
  });
  it('does not repeat an identical registration', () => {
    assert.equal(registrationNeeded({ ...now }, now), false);
  });
});
