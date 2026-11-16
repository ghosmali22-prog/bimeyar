// Google Drive storage.
// Each customer is a folder inside the app's root folder; their files live in that folder.
// Extra details (category, expiry…) are kept in the file's own appProperties, so no separate database is needed.
// The scope is "drive.file": the app only sees files it created itself, never the rest of the Drive.
import { DRIVE_FOLDER_NAME } from './config.js';
import { t } from './i18n.js';

const API = 'https://www.googleapis.com/drive/v3';
const UP = 'https://www.googleapis.com/upload/drive/v3';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER = 'application/vnd.google-apps.folder';
const FIELDS = 'id,name,mimeType,size,createdTime,parents,appProperties,description,thumbnailLink,webViewLink';
const TOK = 'by_token';

let gisPromise;
export function loadGis() {
  return gisPromise ||= new Promise((res, rej) => {
    if (window.google?.accounts?.oauth2) return res();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = () => res();
    s.onerror = () => { gisPromise = null; rej(new Error(t('d.gis'))); };
    document.head.append(s);
  });
}

export class DriveStore {
  kind = 'drive';
  constructor(clientId) { this.clientId = clientId; }

  /** Restores this browser session's token, if still valid */
  restore() {
    try {
      const t = JSON.parse(sessionStorage.getItem(TOK) || 'null');
      if (t && t.e > Date.now() + 30000) { this.token = t.t; this.exp = t.e; return true; }
    } catch { }
    return false;
  }
  get expired() { return !this.token || Date.now() > this.exp; }

  /** Must be called straight from a click handler, or the Google popup gets blocked */
  async signIn() {
    await loadGis();
    await new Promise((res, rej) => {
      const tc = google.accounts.oauth2.initTokenClient({
        client_id: this.clientId, scope: SCOPE,
        callback: r => {
          if (r.error) return rej(new Error(r.error_description || r.error));
          this.token = r.access_token;
          this.exp = Date.now() + (r.expires_in - 60) * 1000;
          sessionStorage.setItem(TOK, JSON.stringify({ t: this.token, e: this.exp }));
          res();
        },
        error_callback: e => rej(new Error(e.type === 'popup_closed' ? t('d.popupClosed') : e.type === 'popup_failed_to_open' ? t('d.popupBlocked') : (e.message || t('d.signin')))),
      });
      tc.requestAccessToken({ prompt: '' });
    });
  }
  signOut() {
    try { if (this.token) google.accounts.oauth2.revoke(this.token, () => { }); } catch { }
    this.token = null;
    sessionStorage.removeItem(TOK);
  }

  async api(path, opt = {}) {
    if (this.expired) throw authError();
    const headers = { Authorization: 'Bearer ' + this.token, ...opt.headers };
    if (typeof opt.body === 'string') headers['Content-Type'] = 'application/json';
    const r = await fetch(path.startsWith('http') ? path : API + path, { ...opt, headers });
    if (r.status === 401) { this.token = null; sessionStorage.removeItem(TOK); throw authError(); }
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error?.message || t('d.error', { x: r.status }));
    }
    if (opt.raw) return r;
    return r.status === 204 ? null : r.json();
  }

  async init() {
    const q = encodeURIComponent("appProperties has { key='bimeyar' and value='root' } and trashed=false");
    const r = await this.api(`/files?q=${q}&fields=files(id,name,webViewLink)&spaces=drive`);
    let root = r.files[0];
    root ||= await this.api('/files?fields=id,webViewLink', { method: 'POST', body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: FOLDER, appProperties: { bimeyar: 'root' } }) });
    this.rootId = root.id;
    this.rootLink = root.webViewLink;
    const a = await this.api('/about?fields=user(displayName,emailAddress),storageQuota');
    this.user = a.user; this.sq = a.storageQuota;
  }

  async loadAll() {
    const q = encodeURIComponent("appProperties has { key='bimeyar' and value='item' } and trashed=false");
    const all = [];
    let page = '';
    do {
      const r = await this.api(`/files?q=${q}&fields=nextPageToken,files(${FIELDS})&pageSize=1000&spaces=drive${page ? '&pageToken=' + page : ''}`);
      all.push(...r.files);
      page = r.nextPageToken;
    } while (page);
    return {
      customers: all.filter(x => x.mimeType === FOLDER).map(toCustomer),
      files: all.filter(x => x.mimeType !== FOLDER).map(toFile),
    };
  }

  async saveCustomer(c) {
    const body = { name: c.name, description: JSON.stringify({ phone: c.phone || '', plate: c.plate || '', car: c.car || '' }) };
    const r = c.id
      ? await this.api(`/files/${c.id}?fields=${FIELDS}`, { method: 'PATCH', body: JSON.stringify(body) })
      : await this.api(`/files?fields=${FIELDS}`, { method: 'POST', body: JSON.stringify({ ...body, mimeType: FOLDER, parents: [this.rootId], appProperties: { bimeyar: 'item', kind: 'customer' } }) });
    return toCustomer(r);
  }
  // Deletes go to the Drive trash and can be restored for 30 days
  deleteCustomer(id) { return this.api(`/files/${id}`, { method: 'PATCH', body: JSON.stringify({ trashed: true }) }); }
  deleteFile(id) { return this.api(`/files/${id}`, { method: 'PATCH', body: JSON.stringify({ trashed: true }) }); }

  async updateFile(f) {
    const r = await this.api(`/files/${f.id}?fields=${FIELDS}`, { method: 'PATCH', body: JSON.stringify({ name: f.name, description: f.note || '', appProperties: { type: f.type, expiry: f.expiry || '' } }) });
    return toFile(r);
  }

  async addFile(blob, meta, onProgress) {
    if (this.expired) throw authError();
    const mime = blob.type || 'application/octet-stream';
    const metadata = {
      name: meta.name, mimeType: mime, parents: [meta.customerId], description: meta.note || '',
      appProperties: { bimeyar: 'item', kind: 'file', type: meta.type || 'other', expiry: meta.expiry || '' },
    };
    // Resumable upload; falls back to multipart if the browser hides the session URL
    let session = null;
    try {
      const r = await this.api(`${UP}/files?uploadType=resumable&fields=${FIELDS}`, { method: 'POST', raw: true, headers: { 'X-Upload-Content-Type': mime }, body: JSON.stringify(metadata) });
      session = r.headers.get('Location');
    } catch (e) { if (e.auth) throw e; }
    let res;
    if (session) {
      res = await xhrSend('PUT', session, blob, { 'Content-Type': mime }, onProgress);
    } else {
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      form.append('file', blob);
      res = await xhrSend('POST', `${UP}/files?uploadType=multipart&fields=${FIELDS}`, form, { Authorization: 'Bearer ' + this.token }, onProgress);
    }
    return toFile(res);
  }

  async getBlob(id) {
    const r = await this.api(`/files/${id}?alt=media`, { raw: true });
    return r.blob();
  }
  async quota() { return this.sq ? { used: +this.sq.usage || 0, limit: +this.sq.limit || 0 } : null; }
}

function authError() { const e = new Error(t('d.session')); e.auth = true; return e; }

function xhrSend(method, url, body, headers, onProgress) {
  return new Promise((res, rej) => {
    const x = new XMLHttpRequest();
    x.open(method, url);
    for (const k in headers) x.setRequestHeader(k, headers[k]);
    x.upload.onprogress = e => e.lengthComputable && onProgress?.(e.loaded / e.total);
    x.onload = () => {
      if (x.status >= 200 && x.status < 300) { onProgress?.(1); res(JSON.parse(x.responseText)); }
      else if (x.status === 401) rej(authError());
      else { let m; try { m = JSON.parse(x.responseText).error.message; } catch { } rej(new Error(m || t('d.upload', { x: x.status }))); }
    };
    x.onerror = () => rej(new Error(t('d.offline')));
    x.send(body);
  });
}

function toCustomer(x) {
  let d = {};
  try { d = JSON.parse(x.description || '{}'); } catch { }
  return { id: x.id, name: x.name, phone: d.phone || '', plate: d.plate || '', car: d.car || '', createdAt: x.createdTime, link: x.webViewLink };
}
function toFile(x) {
  const ap = x.appProperties || {};
  return {
    id: x.id, customerId: x.parents?.[0] || '', name: x.name, type: ap.type || 'other', expiry: ap.expiry || '',
    note: x.description || '', mime: x.mimeType, size: +x.size || 0, createdAt: x.createdTime, thumb: x.thumbnailLink || '', link: x.webViewLink,
  };
}
