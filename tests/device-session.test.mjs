// Device password (v3.3): the real backend/Code.gs doPost with fake Apps Script services.
// Run: node tests/device-session.test.mjs
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';

let pass = 0, fail = 0;
function eq(a, b, msg) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  ok ? pass++ : fail++;
  if (!ok) console.log('FAIL', msg, '\n  got     ', JSON.stringify(a), '\n  expected', JSON.stringify(b));
}

const gs = readFileSync(new URL('../backend/Code.gs', import.meta.url), 'utf8');
const props = { ACL: JSON.stringify({ 'ed@example.com': 'editor', 'view@example.com': 'viewer', 'adm@example.com': 'admin' }), ROOT_ID: 'root1' };
let now = Date.UTC(2026, 10, 21, 10, 0, 0);
const RealDate = Date;
class FakeDate extends RealDate { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } }

const PropertiesService = { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; } }) };
const LockService = { getScriptLock: () => ({ waitLock() { }, releaseLock() { } }) };
const toSigned = buf => [...buf].map(b => (b > 127 ? b - 256 : b));
const Utilities = {
  DigestAlgorithm: { SHA_256: 'sha256' },
  getUuid: () => randomUUID(),
  computeDigest: (alg, s) => toSigned(createHash('sha256').update(String(s), 'utf8').digest()),
  base64EncodeWebSafe: bytes => Buffer.from(bytes.map(b => b & 255)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
  newBlob: s => ({ getBytes: () => [...Buffer.from(String(s), 'utf8')] }),
};
const Session = { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) };
// Google ID tokens: "gt:<email>" is valid, anything else is rejected by tokeninfo
let tokeninfoCalls = 0;
const UrlFetchApp = {
  fetch: url => {
    tokeninfoCalls++;
    const tok = decodeURIComponent(url.split('id_token=')[1]);
    const ok = tok.startsWith('gt:');
    const body = ok ? { aud: '519755009610-vqs6e182v4rv7p0gu25thalqefrps3lt.apps.googleusercontent.com', iss: 'https://accounts.google.com', email_verified: 'true', email: tok.slice(3), exp: String(Math.floor(now / 1000) + 3600) } : {};
    return { getResponseCode: () => (ok ? 200 : 400), getContentText: () => JSON.stringify(body) };
  },
};
const CacheService = { getScriptCache: () => ({ get: () => null, put() { } }) };
const ContentService = { createTextOutput: s => ({ s, setMimeType() { return this; } }), MimeType: { JSON: 'json' } };
const Drive = { About: { get: () => ({ storageQuota: {} }) }, Files: { list: () => ({ files: [] }) } };

const B = new Function('Drive', 'PropertiesService', 'LockService', 'Utilities', 'Session', 'UrlFetchApp', 'CacheService', 'ContentService', 'Date',
  `${gs}\nreturn { doPost };`)(Drive, PropertiesService, LockService, Utilities, Session, UrlFetchApp, CacheService, ContentService, FakeDate);
const post = body => JSON.parse(B.doPost({ postData: { contents: JSON.stringify(body) } }).s);
const sessions = () => JSON.parse(props.DEVICE_SESSIONS || '{}');

/* 1. first sign-in with Google, then a device session */
let r = post({ token: 'gt:ed@example.com', action: 'createDeviceSession', name: 'iPhone · Safari' });
eq(r.ok, true, 'createDeviceSession with a Google token');
const s1 = r.data;
eq([s1.sid.length >= 16, s1.key.length >= 43], [true, true], 'random id and a 256-bit secret');
eq(props.DEVICE_SESSIONS.includes(s1.key), false, 'the secret itself is never stored');
const rec = sessions()[s1.sid];
eq(rec.h === createHash('sha256').update('bimeyar-device:' + s1.key).digest('base64url'), true, 'only the SHA-256 hash is stored');
eq([rec.e, rec.n, rec.x - rec.c], ['ed@example.com', 'iPhone · Safari', 30 * 86400000], 'email, device name, 30 days');

/* 2. reopen the app: the session works without any Google token */
tokeninfoCalls = 0;
r = post({ dev: { sid: s1.sid, key: s1.key }, action: 'me' });
eq([r.ok, r.data.email, r.data.role, r.data.dev], [true, 'ed@example.com', 'editor', true], 'me with the device session');
eq(tokeninfoCalls, 0, 'no Google call with a device session');
r = post({ dev: { sid: s1.sid, key: s1.key }, action: 'createDeviceSession', name: 'x' });
eq([r.ok, r.error], [false, 'role'], 'a device session cannot create another one (Google needed)');
eq(post({ dev: { sid: s1.sid, key: s1.key, email: 'owner@example.com' }, email: 'owner@example.com', action: 'aclList' }).error, 'role', 'an email sent by the client is ignored');

/* 3. wrong password x5: the server counts and deletes the session */
const wrong = 'A'.repeat(43);
const lefts = [];
for (let i = 0; i < 4; i++) { r = post({ dev: { sid: s1.sid, key: wrong }, action: 'me' }); lefts.push([r.error, r.left]); }
eq(lefts, [['bad_pin', 4], ['bad_pin', 3], ['bad_pin', 2], ['bad_pin', 1]], 'wrong attempts are counted');
r = post({ dev: { sid: s1.sid, key: s1.key }, action: 'me' });
eq(r.ok, true, 'the right password still works after 4 wrong ones');
eq(sessions()[s1.sid].f, 0, 'a right password resets the count');
for (let i = 0; i < 4; i++) post({ dev: { sid: s1.sid, key: wrong }, action: 'me' });
r = post({ dev: { sid: s1.sid, key: wrong }, action: 'me' });
eq([r.error, r.session], ['auth', 'gone'], '5th wrong password: session ended');
eq(sessions()[s1.sid], undefined, 'session deleted on the server');
r = post({ dev: { sid: s1.sid, key: s1.key }, action: 'me' });
eq([r.error, r.session], ['auth', 'gone'], 'even the right password does not work after that');

/* 4. revoke from another device */
const a = post({ token: 'gt:ed@example.com', action: 'createDeviceSession', name: 'Laptop' }).data;
const b = post({ token: 'gt:ed@example.com', action: 'createDeviceSession', name: 'Phone' }).data;
r = post({ dev: a, action: 'listMySessions' });
eq(r.data.map(x => [x.name, x.current]).sort(), [['Laptop', true], ['Phone', false]], 'my devices, this one marked');
eq(JSON.stringify(r.data).includes(sessions()[a.sid].h), false, 'the list never contains the hash');
r = post({ dev: a, action: 'revokeSession', sid: b.sid });
eq(r.data.map(x => x.name), ['Laptop'], 'phone signed out from the laptop');
r = post({ dev: b, action: 'list' });
eq([r.error, r.session], ['auth', 'gone'], 'the phone is logged out on its next request');
const v = post({ token: 'gt:view@example.com', action: 'createDeviceSession', name: 'V' }).data;
eq(post({ dev: v, action: 'revokeSession', sid: a.sid }).error, 'not_found', 'nobody can sign out another person’s device');
eq(post({ dev: v, action: 'listAllSessions' }).error, 'role', 'listAllSessions is admin only');
eq(post({ dev: v, action: 'revokeAny', sid: a.sid }).error, 'role', 'revokeAny is admin only');

/* 5. admin sees everyone and can revoke */
const ad = post({ token: 'gt:adm@example.com', action: 'createDeviceSession', name: 'Office PC' }).data;
r = post({ dev: ad, action: 'listAllSessions' });
eq(r.data.map(x => x.email).sort(), ['adm@example.com', 'ed@example.com', 'view@example.com'], 'admin sees all devices');
r = post({ dev: ad, action: 'revokeAny', sid: v.sid });
eq(r.data.some(x => x.sid === v.sid), false, 'admin revoked a device');
eq(post({ dev: v, action: 'me' }).error, 'auth', 'revoked device is out');

/* 6. user removed from the ACL: blocked at once */
const acl = JSON.parse(props.ACL); delete acl['ed@example.com']; props.ACL = JSON.stringify(acl);
r = post({ dev: a, action: 'me' });
eq([r.ok, r.error, r.email], [false, 'forbidden', 'ed@example.com'], 'removed from the ACL: forbidden on the next request');
eq(sessions()[a.sid], undefined, 'and the session is deleted');
acl['ed@example.com'] = 'editor'; props.ACL = JSON.stringify(acl);
eq(post({ dev: a, action: 'me' }).error, 'auth', 'added back: the old session stays ended (Google again)');

/* 7. older than 30 days: rejected */
const old = post({ token: 'gt:ed@example.com', action: 'createDeviceSession', name: 'Old' }).data;
now += 29 * 86400000;
eq(post({ dev: old, action: 'me' }).ok, true, 'day 29: still works');
now += 2 * 86400000;
r = post({ dev: old, action: 'me' });
eq([r.error, r.session], ['auth', 'gone'], 'day 31: expired');
eq(sessions()[old.sid], undefined, 'expired session removed');

/* 8. at most 5 devices per person; "Forgot password" replaces this device's old session */
const many = [];
for (let i = 0; i < 6; i++) { now += 60000; many.push(post({ token: 'gt:ed@example.com', action: 'createDeviceSession', name: 'D' + i }).data); }
const mine = Object.values(sessions()).filter(x => x.e === 'ed@example.com');
eq(mine.length, 5, '5 devices per person');
eq(mine.some(x => x.n === 'D0'), false, 'the least recently used one was removed');
const nu = post({ token: 'gt:ed@example.com', action: 'createDeviceSession', name: 'D5 new', replace: many[5].sid }).data;
eq([sessions()[many[5].sid], !!sessions()[nu.sid]], [undefined, true], 'forgot password: old session of this device removed');
const other = post({ token: 'gt:adm@example.com', action: 'createDeviceSession', name: 'X', replace: nu.sid }).data;
eq(!!sessions()[nu.sid], true, '`replace` cannot remove another person’s session');

/* 9. bad input, Google path unchanged, ACL and ROOT_ID untouched */
eq(post({ dev: { sid: 'x', key: 'y' }, action: 'me' }).error, 'auth', 'malformed session rejected');
eq(post({ dev: { sid: other.sid, key: other.key.slice(0, -1) + (other.key.endsWith('A') ? 'B' : 'A') }, action: 'me' }).error, 'bad_pin', 'one changed character = wrong');
eq(post({ token: 'bad', action: 'me' }).error, 'auth', 'bad Google token rejected');
eq(post({ token: 'gt:ed@example.com', action: 'me' }).data.dev, false, 'Google token still works as before');
eq([JSON.parse(props.ACL)['ed@example.com'], props.ROOT_ID], ['editor', 'root1'], 'ACL and ROOT_ID not changed by sessions');
eq(Buffer.byteLength(props.DEVICE_SESSIONS) < 9000, true, 'DEVICE_SESSIONS fits one Script Property');

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `All ${pass} device-session tests passed.`);
process.exit(fail ? 1 : 0);
