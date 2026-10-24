// A fictional test business on the runner's disposable API: the administrator enrols MFA from the server-issued token,
// creates a test business with a no-payment grant, and its Owner chooses a password with the setup code. The Owner's
// sign-in goes to $WORK/vc-owner.json (mode 600) for the browser check. Prints statuses only, never a secret or a code.
import { createHmac, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const W = `${process.env.WORK}/`;
const API = process.env.API ?? 'http://127.0.0.1:3410/api/v1';
const ADMIN_PW = readFileSync(`${W}admin.pw`, 'utf8').trim();
const ENROL = readFileSync(`${W}enrol.out`, 'utf8').match(/^\s{4}(\S{24,})\s*$/m)?.[1];
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const b32 = (t) => { let bits = 0, v = 0; const o = []; for (const ch of t.toUpperCase()) { v = (v << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(o); };
let SECRET = '';
const totp = (s) => { const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(s)); const m = createHmac('sha1', b32(SECRET)).update(c).digest(); const o = m[m.length - 1] & 15; return String((((m[o] & 127) << 24) | (m[o + 1] << 16) | (m[o + 2] << 8) | m[o + 3]) % 1e6).padStart(6, '0'); };
let last = Math.floor(Date.now() / 30000);
const fresh = async () => { for (;;) { const s = Math.floor(Date.now() / 30000); if (s > last && Date.now() % 30000 < 27000) { last = s; return totp(s); } await new Promise((r) => setTimeout(r, 500)); } };
let cookie = '';
async function call(method, path, body) {
  const h = { Accept: 'application/json', Cookie: cookie };
  if (body) h['Content-Type'] = 'application/json';
  if (method !== 'GET') h['x-requested-with'] = 'erp-control-web';
  const r = await fetch(`${API}/${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
  const t = await r.text();
  return { status: r.status, json: t ? JSON.parse(t) : null };
}
const step = (what, status) => { console.log(`${what}: ${status}`); if (status >= 300) process.exit(1); };
step('admin sign-in', (await call('POST', 'platform/admin/sign-in', { email: 'ops@example.test', password: ADMIN_PW })).status);
if (existsSync(`${W}totp.secret`)) {
  // Already enrolled (browser-input/verify/enrol.mjs ran first): its key, and the second factor of this sign-in.
  SECRET = readFileSync(`${W}totp.secret`, 'utf8').trim();
  step('MFA', (await call('POST', 'platform/admin/mfa/verify', { code: await fresh() })).status);
} else {
  const enrol = await call('POST', 'platform/admin/mfa/enrolment/start', { enrolmentToken: ENROL });
  SECRET = enrol.json?.secret ?? '';
  step('MFA enrolment', enrol.status);
  step('MFA confirmed', (await call('POST', 'platform/admin/mfa/enrolment/confirm', { code: await fresh() })).status);
}
step('step-up', (await call('POST', 'platform/admin/step-up', { password: ADMIN_PW, code: await fresh() })).status);
const made = await call('POST', 'platform/businesses', { idempotencyKey: randomUUID(), ownerName: 'Mariem Test', businessName: 'Boutique Démo Tevragh', phone: '+22241999001', branchName: 'Tevragh Zeina', language: 'fr', isTest: true, reason: 'Visual check (fictional)', confirmPassword: ADMIN_PW });
step('test business', made.status);
step('no-payment grant', (await call('POST', `platform/businesses/${made.json.companyId}/activate-grant`, { days: 30, reason: 'Test access', confirmPassword: ADMIN_PW })).status);
const password = `demo-${randomUUID()}`;
step('Owner setup', (await call('POST', 'auth/owner-setup', { token: made.json.invitation.token, password })).status);
writeFileSync(`${W}vc-owner.json`, JSON.stringify({ identifier: '+22241999001', password }), { mode: 0o600 });
