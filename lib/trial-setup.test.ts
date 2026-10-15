/**
 * What the closed screen says about the free trial's setup instructions (0095; the owner's correction of
 * 2026-10-13) — and that it can only say it.
 *
 *   node lib/trial-setup.test.ts
 *
 * The Owner's card is display only: eligible, not started, the server's number of days, the verified contacts as
 * the server masks them, and one honest delivery line. Staff — refused that status by the server — get the neutral
 * words. Nothing on the card can be pressed, sends a request, opens a link or counts down.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deliveryLines, deliveryTone, notStartedView, refusedToStaff, type TrialSetupStatus } from './trial-setup.ts';

const code = (p: string) =>
  readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

const eligible: TrialSetupStatus = {
  state: 'trial_available',
  eligible: true,
  durationHours: 168,
  durationDays: 7,
  requiredContacts: ['email', 'phone'],
  missingContacts: [],
  destinations: [{ channel: 'email', masked: 'a•••@example.com' }],
  delivery: 'sent',
  sentTo: ['email'],
  lastAttemptAt: '2026-10-13T10:00:00.000Z',
  timeZone: 'Africa/Nouakchott',
};

describe('the delivery line', () => {
  it('sent, unavailable, failed and not sent each say their own sentence — once', () => {
    assert.deepEqual(deliveryLines({ delivery: 'sent', missingContacts: [] }), ['trialSetup.delivery.sent']);
    assert.deepEqual(deliveryLines({ delivery: 'unavailable', missingContacts: [] }), ['trialSetup.delivery.unavailable']);
    assert.deepEqual(deliveryLines({ delivery: 'failed', missingContacts: [] }), ['trialSetup.delivery.failed']);
    assert.deepEqual(deliveryLines({ delivery: 'not_sent', missingContacts: [] }), ['trialSetup.delivery.not_sent']);
  });

  it('waiting names the contact still to be verified — the WhatsApp number or the email address — and offers nothing to press', () => {
    assert.deepEqual(deliveryLines({ delivery: 'waiting_for_contact', missingContacts: ['phone'] }), ['trialSetup.delivery.waiting.phone']);
    assert.deepEqual(deliveryLines({ delivery: 'waiting_for_contact', missingContacts: ['email'] }), ['trialSetup.delivery.waiting.email']);
    assert.deepEqual(deliveryLines({ delivery: 'waiting_for_contact', missingContacts: ['email', 'phone'] }), ['trialSetup.delivery.waiting.email', 'trialSetup.delivery.waiting.phone']);
  });

  it('being sent — a link issued less than a minute ago, its outcome not recorded yet — says so in its own sentence', () => {
    assert.deepEqual(deliveryLines({ delivery: 'sending', missingContacts: [] }), ['trialSetup.delivery.sending']);
  });

  it('not sent is told apart by when the instructions last went out (C17): never, sent and no longer working, or sent and the latest lost', () => {
    const notSent = { delivery: 'not_sent', missingContacts: [] } as const;
    // Nothing was ever accepted — or a server too old to say when: the line it always had.
    assert.deepEqual(deliveryLines({ ...notSent, sentTo: [], lastSentAt: null }), ['trialSetup.delivery.not_sent']);
    assert.deepEqual(deliveryLines({ ...notSent, sentTo: [] }), ['trialSetup.delivery.not_sent']);
    // Sent once, and nothing reaches the Owner's contacts as they are now: sent on that day, and no longer working.
    assert.deepEqual(deliveryLines({ ...notSent, sentTo: [], lastSentAt: '2026-10-13T10:00:00.000Z' }), ['trialSetup.delivery.not_sent.changed']);
    // Sent, still good for a verified contact, and the newest ones lost on the way: sent on that day, the latest not.
    assert.deepEqual(deliveryLines({ ...notSent, sentTo: ['email'], lastSentAt: '2026-10-13T10:00:00.000Z' }), ['trialSetup.delivery.not_sent.latest']);
    // The other words do not change with it.
    for (const delivery of ['sent', 'sending', 'failed', 'unavailable'] as const) {
      assert.deepEqual(deliveryLines({ delivery, missingContacts: [], sentTo: [], lastSentAt: '2026-10-13T10:00:00.000Z' }), [`trialSetup.delivery.${delivery}`]);
    }
    assert.equal(deliveryTone('not_sent'), 'warning');
  });

  it('a word this build does not know says nothing rather than something untrue', () => {
    assert.deepEqual(deliveryLines({ delivery: 'something_new' as never, missingContacts: [] }), []);
    assert.deepEqual(deliveryLines({ delivery: 'waiting_for_contact', missingContacts: ['pigeon' as never] }), []);
  });

  it('sent is good news, waiting and being sent are information, anything that will not arrive is a warning', () => {
    assert.equal(deliveryTone('sent'), 'success');
    assert.equal(deliveryTone('waiting_for_contact'), 'info');
    assert.equal(deliveryTone('sending'), 'info');
    for (const d of ['unavailable', 'failed', 'not_sent'] as const) assert.equal(deliveryTone(d), 'warning');
  });
});

describe('who sees what on the closed screen of a business that has not started', () => {
  it('the Owner — an eligible answer — sees the card', () => {
    assert.equal(notStartedView({ data: eligible, error: null, isLoading: false }), 'card');
  });

  it('anybody the server refuses (403, the Owner’s alone) sees the neutral words, never the instructions', () => {
    const refusal = Object.assign(new Error('Only the business owner can see this.'), { status: 403, code: 'owner_only' });
    assert.equal(refusedToStaff(refusal), true);
    assert.equal(notStartedView({ data: undefined, error: refusal, isLoading: false }), 'neutral');
  });

  it('a business the server no longer calls eligible is told the neutral words too', () => {
    assert.equal(notStartedView({ data: { state: 'trial_active', eligible: false }, error: null, isLoading: false }), 'neutral');
  });

  it('while it is asked, a wait; when it could not be asked, that failure — never a guess at who holds the phone', () => {
    assert.equal(notStartedView({ data: undefined, error: null, isLoading: true }), 'loading');
    const offline = new TypeError('Network request failed');
    assert.equal(refusedToStaff(offline), false);
    assert.equal(notStartedView({ data: undefined, error: offline, isLoading: false }), 'unreadable');
    assert.equal(notStartedView({ data: undefined, error: Object.assign(new Error('x'), { status: 500 }), isLoading: false }), 'unreadable');
  });
});

describe('display only (the owner’s correction of 2026-10-13)', () => {
  const card = code('components/access/TrialSetupCard.tsx');

  it('the card imports nothing that can be pressed, linked, navigated or sent', () => {
    assert.doesNotMatch(card, /\b(Button|IconButton|Pressable|Touchable\w*|TouchableOpacity|Link|FilterChip|Toggle)\b/, 'nothing pressable');
    assert.doesNotMatch(card, /onPress|onLongPress|accessibilityRole=["']?(button|link)|href=/, 'no press handler, no button or link role');
    assert.doesNotMatch(card, /\bapi\b|useMutation|useQuery|fetch\(|expo-router|useRouter|router\./, 'no request and no navigation');
    assert.doesNotMatch(card, /useCountdown|Date\.now|new Date\(|setTimeout|setInterval/, 'no clock, no countdown');
    assert.doesNotMatch(card, /Linking|WebView|openURL|https?:|www\.|QR|qrcode/i, 'no link, web view or QR code');
  });

  it('the card shows the server’s days, the masked destinations, the status read as not started, and one delivery line', () => {
    assert.match(card, /t\('trialSetup\.duration', \{ durationDays: status\.durationDays \}\)/);
    assert.match(card, /status\.destinations\.map\(/);
    assert.match(card, /t\('trialSetup\.contact', \{ masked: isolateLtr\(destination\.masked\) \}\)/);
    assert.match(card, /accessibilityLabel=\{t\('trialSetup\.status\.label'\)\}/);
    assert.match(card, /deliveryLines\(status\)\.map\(/);
  });

  it('a line that names the day the instructions went out reads it on the business’s clock, isolated in its own direction', () => {
    assert.match(card, /const sentOn = status\.lastSentAt \? isolateAuto\(formatDateTime\(status\.lastSentAt, \{ timeZone: status\.timeZone \}\)\) : '';/);
    assert.match(card, /\{t\(key, \{ date: sentOn \}\)\}/);
  });

  it('the closed screen reads the status — the only trial request in the app — and keeps only its three general actions', () => {
    assert.match(code('lib/entitlement.ts'), /queryFn: \(\) => api\.get<TrialSetupStatus>\('\/account\/trial-setup'\)/);
    const closed = code('app/access-closed.tsx');
    assert.doesNotMatch(closed, /api\.(post|put|patch|delete)|useMutation/);
    assert.equal(closed.match(/<Button\b/g)?.length, 3, 'Check again, Sign out, Delete account — nothing about the trial');
    assert.match(closed, /useTrialSetup\(reason === 'not_started'\)/);
    assert.match(closed, /if \(setup\.data\?\.eligible\) return <TrialSetupCard status=\{setup\.data\} \/>;/);
  });
});
