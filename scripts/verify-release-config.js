#!/usr/bin/env node
/**
 * Release configuration check (docs/48 controls 1, 18, 19; docs/64 §7).
 *
 *   EXPO_PUBLIC_API_ORIGIN=https://api.example.com node scripts/verify-release-config.js
 *   node scripts/verify-release-config.js --profile preview   # the internal build
 *
 * Run before `eas build --profile production` and in CI. It refuses a release
 * that would talk to the API in clear text, ship a debug overlay, or carry a
 * server secret's name into the bundle — each a mistake that is invisible on
 * the phone and catastrophic in the store.
 *
 * What it cannot check: the values EAS injects from its own secrets at build
 * time. Those are named in `eas.json` and set in the EAS project; this script
 * checks the names, the profile shape and whatever `EXPO_PUBLIC_*` is set in
 * the environment it runs in.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const profile = args[args.indexOf('--profile') + 1] || 'production';
const problems = [];
const notes = [];

const eas = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8'));
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;
const build = eas.build?.[profile];
if (!build) problems.push(`eas.json has no build profile "${profile}"`);

const env = { ...(build?.env ?? {}), ...process.env };

// 1. The API origin: https, no port games, no development host.
const origin = (env.EXPO_PUBLIC_API_ORIGIN ?? '').trim();
if (profile === 'production' || profile === 'preview') {
  if (!origin) {
    problems.push(
      'EXPO_PUBLIC_API_ORIGIN is not set for this build. Without it the app falls back to http://<host>:3010 — a development address.',
    );
  } else if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origin)) {
    problems.push(`EXPO_PUBLIC_API_ORIGIN must be an https:// origin with no path; got "${origin}"`);
  } else if (/localhost|127\.0\.0\.1|\b10\.\d|\b192\.168\.|\b172\.(1[6-9]|2\d|3[01])\./.test(origin)) {
    problems.push(`EXPO_PUBLIC_API_ORIGIN names a development host: "${origin}"`);
  }
  if (env.EXPO_PUBLIC_API_HOST) problems.push('EXPO_PUBLIC_API_HOST is a development override and must not be set for a release');
}

// 2. Debug overlays and staging labels never reach the store.
if (profile === 'production') {
  if (env.EXPO_PUBLIC_SCAN_GEOMETRY_OVERLAY) problems.push('EXPO_PUBLIC_SCAN_GEOMETRY_OVERLAY is set: the scanner debug overlay would ship');
  if ((env.EXPO_PUBLIC_APP_ENV ?? '').toLowerCase() === 'staging') problems.push('EXPO_PUBLIC_APP_ENV=staging on a production build');
  if (build?.developmentClient) problems.push('the production profile must not build a development client');
  if (build?.distribution === 'internal') problems.push('the production profile must not be an internal distribution');
}

// 3. No server secret is named in anything the bundle is built from.
const SERVER_SECRETS = /WHATSAPP_ACCESS_TOKEN|WHATSAPP_APP_SECRET|OTP_PEPPER|JWT_ACCESS_SECRET|PLATFORM_ADMIN_KEY|APP_DATABASE_URL|DATABASE_URL/;
for (const key of Object.keys(env)) {
  if (SERVER_SECRETS.test(key) && key.startsWith('EXPO_PUBLIC_')) problems.push(`${key} is a server secret exposed as EXPO_PUBLIC_*`);
}
for (const file of ['app.json', 'eas.json', 'constants/config.ts']) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  if (SERVER_SECRETS.test(text)) problems.push(`${file} names a server secret`);
}
for (const file of fs.readdirSync(root)) {
  if (/^\.env(\..+)?$/.test(file) && !file.endsWith('.example')) {
    notes.push(`${file} exists locally — it is git-ignored; make sure it holds no server secret`);
  }
}

// 4. iOS: the permission strings and the encryption declaration the store asks about.
const camera = (app.plugins ?? []).find((p) => Array.isArray(p) && p[0] === 'expo-camera');
if (!camera || !camera[1]?.cameraPermission) problems.push('app.json: expo-camera has no cameraPermission text (NSCameraUsageDescription)');
if (!app.ios?.bundleIdentifier) problems.push('app.json: ios.bundleIdentifier is missing');
if (app.ios?.infoPlist?.ITSAppUsesNonExemptEncryption === undefined) {
  notes.push('app.json: ios.infoPlist.ITSAppUsesNonExemptEncryption is not declared — App Store Connect will ask on every upload (set false: the app uses only standard TLS)');
}
if (!app.ios?.privacyManifests) {
  notes.push('app.json: no ios.privacyManifests — the Expo SDK supplies the required-reason API declarations; confirm in the built archive (docs/48 §10)');
}
if (!app.version) problems.push('app.json: version is missing');

// 5. Storage: session material must go through SecureStore on native.
const storage = fs.readFileSync(path.join(root, 'lib', 'storage.ts'), 'utf8');
if (!/expo-secure-store/.test(storage)) problems.push('lib/storage.ts does not use expo-secure-store');

for (const n of notes) console.log(`note: ${n}`);
if (problems.length === 0) {
  console.log(`release configuration for "${profile}" is sound${origin ? ` (API ${origin})` : ''}`);
  process.exit(0);
}
console.log(`refusing the "${profile}" release configuration:`);
for (const p of problems) console.log(`  - ${p}`);
process.exit(1);
