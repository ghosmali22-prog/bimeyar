// Cloud storage through the Apps Script backend. Files live in the owner's Google Drive.
// Requests are POST with Content-Type text/plain and a JSON body, so the browser sends no CORS preflight.
import { API_URL, MAX_UPLOAD_MB } from './config.js';
import { getToken, drop } from './auth.js';

export class ApiError extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; Object.assign(this, extra); if (code === 'auth') this.auth = true; }
}

function post(body, onProgress) {
  return new Promise((res, rej) => {
    const x = new XMLHttpRequest();
    x.open('POST', API_URL);
    x.setRequestHeader('Content-Type', 'text/plain;charset=utf-8');
    x.timeout = 300000;
    if (onProgress) x.upload.onprogress = e => e.lengthComputable && onProgress(Math.min(.97, e.loaded / e.total));
    x.onload = () => {
      let j;
      try { j = JSON.parse(x.responseText); } catch { return rej(new ApiError('network', `HTTP ${x.status}`)); }
      if (j.ok) { onProgress?.(1); res(j.data); } else rej(new ApiError(j.error, j.message, { email: j.email }));
    };
    x.onerror = () => rej(new ApiError('network', 'network'));
    x.ontimeout = () => rej(new ApiError('network', 'timeout'));
    x.send(JSON.stringify(body));
  });
}

async function call(action, params = {}, onProgress) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getToken();
    if (!token) throw new ApiError('auth', 'signin');
    try { return await post({ token, action, ...params }, onProgress); }
    catch (e) {
      // The server rejected the token (expired or revoked): drop it and try once more with a fresh one
      if (e.code === 'auth' && attempt === 0) { drop(); continue; }
      throw e;
    }
  }
}

const b64 = blob => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1] || '');
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});
const unb64 = (data, mime) => {
  const bin = atob(data), a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return new Blob([a], { type: mime || 'application/octet-stream' });
};

export class ApiStore {
  kind = 'cloud';
  thumbCache = new Map();
  blobCache = new Map();

  async init() { this.me = await call('me'); return this.me; }

  async loadAll() {
    const r = await call('list');
    this.quotaInfo = r.quota || null;
    for (const f of r.files) f.thumb = this.thumbCache.get(f.id) || '';
    return { customers: r.customers, files: r.files };
  }
  saveCustomer(c) { return call('saveCustomer', { customer: { id: c.id, name: c.name, phone: c.phone, plate: c.plate, car: c.car } }); }
  deleteCustomer(id) { return call('deleteCustomer', { id }); }

  async addFile(blob, meta, onProgress) {
    if (blob.size > MAX_UPLOAD_MB * 1048576) throw new ApiError('too_big', 'too_big');
    const data = await b64(blob);
    return call('upload', { data, meta: { name: meta.name, customerId: meta.customerId, type: meta.type, expiry: meta.expiry, note: meta.note, mime: blob.type || 'application/octet-stream' } }, onProgress);
  }
  updateFile(f) { return call('updateFile', { file: { id: f.id, name: f.name, type: f.type, expiry: f.expiry, note: f.note } }); }
  async deleteFile(id) { await call('deleteFile', { id }); this.blobCache.delete(id); this.thumbCache.delete(id); }

  async getBlob(id) {
    if (this.blobCache.has(id)) return this.blobCache.get(id);
    const r = await call('getFile', { id });
    const blob = unb64(r.data, r.mime);
    if (blob.size < 8 * 1048576) this.blobCache.set(id, blob);
    return blob;
  }

  /** Fetches thumbnails for the given files; returns { id: dataUrl } for new ones */
  async thumbs(ids) {
    const need = ids.filter(id => !this.thumbCache.has(id)).slice(0, 24);
    if (!need.length) return {};
    need.forEach(id => this.thumbCache.set(id, ''));
    const r = await call('thumbs', { ids: need });
    for (const [id, url] of Object.entries(r)) this.thumbCache.set(id, url);
    return r;
  }

  async quota() { return this.quotaInfo; }

  // Team / access (admin only)
  aclList() { return call('aclList'); }
  aclSet(email, role) { return call('aclSet', { email, role }); }
  aclRemove(email) { return call('aclRemove', { email }); }
}
