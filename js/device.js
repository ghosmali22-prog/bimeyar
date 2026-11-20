// Device password (v3.3): sign in with Google once per device, then unlock with a password or 6-digit PIN.
//
// The backend gives this device a session { sid, key } (key = 256-bit secret; the server keeps only its SHA-256).
// Here the key is encrypted with a key made from the password: PBKDF2-SHA-256 (250 000 rounds, random salt) -> AES-CTR.
// AES-CTR has no check value, so a wrong password gives a wrong key WITHOUT this device noticing: only the server can
// tell, and it counts wrong attempts (5 = session deleted). A copied blob therefore cannot be guessed offline.
// localStorage keeps only { sid, salt, iv, ct } plus the email and device name for the unlock screen.
// The password is never stored or sent. The decrypted key lives only in memory (lost on close / auto-lock).

const KEY = 'by_dev', SKIP = 'by_dev_skip', OLD = 'by_dev_old';
const ROUNDS = 250000;
export const LOCK_MS = 15 * 60 * 1000;

let cred = null;          // { sid, key } while unlocked
let lastUse = Date.now(), onLock = null;

const b64u = a => btoa(String.fromCharCode(...new Uint8Array(a))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => { const b = atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4)); return Uint8Array.from(b, c => c.charCodeAt(0)); };

function read() {
  try {
    const b = JSON.parse(localStorage.getItem(KEY) || 'null');
    return b && b.v === 1 && b.sid && b.ct ? b : null;
  } catch { return null; }
}
/** The stored blob (no secret in it), or null when there is none or it is past its 30 days. */
export function info() {
  const b = read();
  if (b && b.exp && Date.parse(b.exp) <= Date.now()) { forget(); return null; }
  return b;
}
export const has = () => !!info();
export const current = () => cred;
export const unlocked = () => !!cred;

/** Password rule: at least 6 characters (a 6-digit PIN or a longer password). */
export const okPin = p => typeof p === 'string' && [...p].length >= 6 && [...p].length <= 128;

async function aesKey(pin, salt, rounds) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: rounds }, base, { name: 'AES-CTR', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Encrypts the new session with the password, keeps the blob and unlocks this device. */
export async function seal(session, pin, meta) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(16));
  const k = await aesKey(pin, salt, ROUNDS);
  const ct = await crypto.subtle.encrypt({ name: 'AES-CTR', counter: iv, length: 64 }, k, unb64u(session.key));
  const blob = { v: 1, sid: session.sid, salt: b64u(salt), iv: b64u(iv), ct: b64u(ct), it: ROUNDS, exp: session.expires || '', email: meta.email || '', name: meta.name || '' };
  localStorage.setItem(KEY, JSON.stringify(blob));
  try { localStorage.removeItem(SKIP); localStorage.removeItem(OLD); } catch { }
  cred = { sid: session.sid, key: session.key };
  touch();
}

/** Decrypts with the password. Always "works": whether it was right is only known when the server answers. */
export async function open(pin) {
  const b = read(); if (!b) return null;
  const k = await aesKey(pin, unb64u(b.salt), b.it || ROUNDS);
  const pt = await crypto.subtle.decrypt({ name: 'AES-CTR', counter: unb64u(b.iv), length: 64 }, k, unb64u(b.ct));
  cred = { sid: b.sid, key: b64u(pt) };
  touch();
  return cred;
}

/** Forget the key in memory (wrong password, or auto-lock). The blob stays. */
export function lock() { cred = null; }
/** Remove everything from this device (sign out, 5 wrong passwords, session ended on the server). */
export function forget() { cred = null; try { localStorage.removeItem(KEY); } catch { } }

/** "Forgot password": remove the blob but remember its session id, so the new session replaces it on the server. */
export function forgetForReset() { const b = read(); if (b) { try { localStorage.setItem(OLD, b.sid); } catch { } } forget(); }
export const oldSid = () => { try { return localStorage.getItem(OLD) || ''; } catch { return ''; } };

export const skipped = () => { try { return localStorage.getItem(SKIP) === '1'; } catch { return false; } };
export const skip = () => { try { localStorage.setItem(SKIP, '1'); } catch { } };

/** A name for this device, e.g. "iPhone · Safari (app)". The user can change it. */
export function guessName() {
  const u = navigator.userAgent || '';
  const os = /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) || (/Macintosh/.test(u) && navigator.maxTouchPoints > 1) ? 'iPad' : /Android/.test(u) ? 'Android'
    : /Windows/.test(u) ? 'Windows' : /Mac OS X/.test(u) ? 'Mac' : /Linux/.test(u) ? 'Linux' : 'Device';
  const br = /Edg\//.test(u) ? 'Edge' : /SamsungBrowser/.test(u) ? 'Samsung' : /CriOS|Chrome\//.test(u) ? 'Chrome' : /FxiOS|Firefox\//.test(u) ? 'Firefox' : /Safari\//.test(u) ? 'Safari' : '';
  const app = matchMedia?.('(display-mode: standalone)').matches || navigator.standalone ? ' (app)' : '';
  return (br ? `${os} · ${br}` : os) + app;
}

/* ---------- auto-lock after 15 minutes without use ---------- */
export function touch() { lastUse = Date.now(); }
function check() {
  if (cred && Date.now() - lastUse >= LOCK_MS) { cred = null; onLock?.(); }
}
/** `fn` runs when the device locks itself. */
export function watchIdle(fn) {
  onLock = fn;
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) addEventListener(ev, () => { check(); touch(); }, { passive: true, capture: true });
  document.addEventListener('visibilitychange', check);   // back from the background after 15 min
  addEventListener('pageshow', check);
  setInterval(check, 20000);
}
