// The disposable administrator's second factor, from the enrolment token the server CLI printed into the runner's work
// directory. Writes the TOTP key to the work directory (mode 600) for the next steps; prints statuses only.
import { readFileSync, writeFileSync } from 'node:fs';
import { WORK, adminPassword, call, check, finish, freshCode } from './lib.mjs';

const ENROL = readFileSync(`${WORK}enrol.out`, 'utf8').match(/^\s{4}(\S{24,})\s*$/m)?.[1];
const signIn = await call('POST', 'platform/admin/sign-in', { body: { email: 'ops@example.test', password: adminPassword() } });
const cookie = signIn.setCookie.map((c) => c.split(';')[0]).join('; ');
check('the administrator signs in with the password', signIn.status === 200, `status ${signIn.status}`);
const start = await call('POST', 'platform/admin/mfa/enrolment/start', { cookie, admin: true, body: { enrolmentToken: ENROL } });
const secret = start.json?.secret;
if (secret) writeFileSync(`${WORK}totp.secret`, secret, { mode: 0o600 });
check('enrolment with the server-issued token returns the key once', start.status === 200 && !!secret, `status ${start.status}`);
const confirm = await call('POST', 'platform/admin/mfa/enrolment/confirm', { cookie, admin: true, body: { code: await freshCode(secret) } });
check('the first code confirms the second factor', confirm.status === 200, `status ${confirm.status}`);
finish('enrol');
