// "Sign in with Google" through Google Identity Services.
// The app only receives an ID token (openid, email, profile); it never gets any Drive access.
// The token is sent with every API call and verified by the Apps Script backend.
import { GOOGLE_CLIENT_ID } from './config.js';

const KEY = 'by_idt';
let gisReady, listeners = [], token = null, payload = null, waiting = [];

function decode(t) {
  try {
    const b = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(b))));
  } catch { return null; }
}
const fresh = (p, margin = 120) => p && p.exp * 1000 > Date.now() + margin * 1000;

function load() {
  return gisReady ||= new Promise((res, rej) => {
    if (window.google?.accounts?.id) return res();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = res;
    s.onerror = () => { gisReady = null; rej(new Error('gis')); };
    document.head.append(s);
  });
}

function setToken(t) {
  const p = decode(t);
  if (!p || !fresh(p, 0)) return;
  token = t; payload = p;
  try { sessionStorage.setItem(KEY, t); } catch { }
  waiting.splice(0).forEach(r => r(t));
  listeners.forEach(fn => fn(user()));
}

export const configured = () => !!GOOGLE_CLIENT_ID;
export const user = () => payload ? { email: String(payload.email || '').toLowerCase(), name: payload.name || '', picture: payload.picture || '' } : null;
export const onSignIn = fn => listeners.push(fn);

/** Sets up GIS and restores a still-valid token from this browser session */
export async function init(locale) {
  try { const t = sessionStorage.getItem(KEY); if (t && fresh(decode(t))) { token = t; payload = decode(t); } } catch { }
  await load();
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: r => setToken(r.credential),
    auto_select: true,
    cancel_on_tap_outside: false,
    use_fedcm_for_prompt: true,
    itp_support: true,
    context: 'signin',
    ux_mode: 'popup',
    locale,
  });
  return !!token;
}

/** Renders Google's own sign-in button into `el` */
export async function button(el, locale) {
  await load();
  el.innerHTML = '';
  google.accounts.id.renderButton(el, { type: 'standard', theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', logo_alignment: 'left', locale, width: 280 });
}

/**
 * Returns a valid ID token. If it is about to expire, asks Google for a new one silently
 * (works when the user signed in before and has one Google session). Resolves to null if
 * that is not possible, so the caller can show the sign-in screen.
 */
export async function getToken() {
  if (token && fresh(payload)) return token;
  await load().catch(() => null);
  if (!window.google?.accounts?.id) return null;
  return new Promise(res => {
    let done = false;
    const finish = v => { if (!done) { done = true; res(v); } };
    waiting.push(finish);
    try {
      google.accounts.id.prompt(n => {
        if (n.isNotDisplayed?.() || n.isSkippedMoment?.() || n.isDismissedMoment?.() && n.getDismissedReason?.() !== 'credential_returned') finish(null);
      });
    } catch { finish(null); }
    setTimeout(() => finish(null), 12000);
  });
}

export function signOut() {
  token = null; payload = null;
  try { sessionStorage.removeItem(KEY); } catch { }
  try { google.accounts.id.disableAutoSelect(); } catch { }
}

/** Forget the current token (e.g. the server rejected it) without disabling auto sign-in */
export function drop() {
  token = null; payload = null;
  try { sessionStorage.removeItem(KEY); } catch { }
}
