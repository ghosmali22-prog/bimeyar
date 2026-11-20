// Cloud storage through the Apps Script backend. Files live in the owner's Google Drive.
// Requests are POST with Content-Type text/plain and a JSON body, so the browser sends no CORS preflight.
import { API_URL, MAX_UPLOAD_MB } from './config.js';
import { getToken, drop } from './auth.js';
import * as device from './device.js';
import { VFIELDS } from './vehicles.js';

export class ApiError extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; Object.assign(this, extra); if (code === 'auth') this.auth = true; }
}

function post(body, onProgress, timeout = 300000) {
  return new Promise((res, rej) => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return rej(new ApiError('offline', 'offline'));
    const x = new XMLHttpRequest();
    x.open('POST', API_URL);
    x.setRequestHeader('Content-Type', 'text/plain;charset=utf-8');
    x.timeout = timeout;
    onProgress?.(0.3); // no x.upload listener: it forces a CORS preflight, which Apps Script rejects
    x.onload = () => {
      let j;
      try { j = JSON.parse(x.responseText); } catch { return rej(new ApiError('network', `HTTP ${x.status}`)); }
      if (j.ok) { onProgress?.(1); res(j.data); } else rej(new ApiError(j.error, j.message, { email: j.email, left: j.left, session: j.session }));
    };
    x.onerror = () => rej(new ApiError(navigator.onLine === false ? 'offline' : 'network', 'network'));
    x.ontimeout = () => rej(new ApiError('timeout', 'timeout'));
    x.send(JSON.stringify(body));
  });
}

/**
 * With a device password (v3.3) every request carries the device session instead of the Google ID token.
 * Locked device: no request at all (and no Google popup). Session ended on the server: removed from this device.
 */
async function call(action, params = {}, onProgress, timeout) {
  if (!device.has()) return googleCall(action, params, onProgress, timeout);
  const c = device.current();
  if (!c) throw new ApiError('locked', 'locked');
  device.touch();
  try { return await post({ dev: { sid: c.sid, key: c.key }, action, ...params }, onProgress, timeout); }
  catch (e) {
    if (e.code === 'bad_pin') device.lock();
    else if ((e.code === 'auth' && e.session === 'gone') || e.code === 'forbidden') device.forget();
    throw e;
  }
}

async function googleCall(action, params = {}, onProgress, timeout) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getToken();
    if (!token) throw new ApiError('auth', 'signin');
    try { return await post({ token, action, ...params }, onProgress, timeout); }
    catch (e) {
      // The server rejected the token (expired or revoked): drop it and try once more with a fresh one
      if (e.code === 'auth' && attempt === 0) { drop(); continue; }
      throw e;
    }
  }
}

export const b64 = blob => new Promise((res, rej) => {
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

/** Every customer field the backend knows (all optional except name) */
export const CUSTOMER_KEYS = ['name', 'phone', 'plate', 'car', 'nameEn', 'idNo', 'address', 'dob', 'brand', 'model', 'year', 'color', 'province', 'vin', 'engineNo',
  'insurer', 'policyNo', 'policyType', 'coverage', 'premium', 'policyStart', 'policyExpiry', 'note', 'nick', 'contractDate'];

export class ApiStore {
  kind = 'cloud';
  thumbCache = new Map();
  blobCache = new Map();

  async init() { this.me = await call('me'); return this.me; }
  get aiReady() { return !!this.me?.ai; }

  async loadAll() {
    const r = await call('list');
    this.quotaInfo = r.quota || null;
    for (const f of r.files) f.thumb = this.thumbCache.get(f.id) || '';
    return { customers: r.customers, files: r.files, invoices: r.invoices || [], vehicles: r.vehicles || [] };
  }
  /** Only the keys present in `c` are sent, so fields the form does not show are never cleared. */
  saveCustomer(c) {
    const out = {};
    for (const k of ['id', ...CUSTOMER_KEYS]) if (c[k] !== undefined) out[k] = c[k];
    return call('saveCustomer', { customer: out });
  }
  deleteCustomer(id) { return call('deleteCustomer', { id }); }
  // Vehicles (v4): data in the plate folder's description, MERGED by the backend (only the keys sent change)
  saveVehicle(v) {
    const out = {};
    for (const k of ['id', 'customerId', 'ym', ...VFIELDS]) if (v[k] !== undefined) out[k] = v[k];
    return call('saveVehicle', { vehicle: out });
  }
  deleteVehicle(id) { return call('deleteVehicle', { id }); }

  async addFile(blob, meta, onProgress) {
    if (blob.size > MAX_UPLOAD_MB * 1048576) throw new ApiError('too_big', 'too_big');
    const data = await b64(blob);
    return call('upload', { data, meta: { name: meta.name, orig: meta.orig || '', customerId: meta.customerId, type: meta.type, expiry: meta.expiry, note: meta.note, folder: meta.folder || '', vehicleId: meta.vehicleId || '', slot: meta.slot || '', mime: blob.type || 'application/octet-stream' } }, onProgress);
  }
  updateFile(f) { return call('updateFile', { file: { id: f.id, name: f.name, type: f.type, expiry: f.expiry, note: f.note } }); }
  /** to = a v3 folder ('policy'…) or { vehicleId, slot } (v4) */
  moveFile(id, to) { return call('moveFile', typeof to === 'string' ? { id, folder: to } : { id, vehicleId: to.vehicleId, slot: to.slot }); }
  // Move tool (admin, v4): only moves; the old folder is kept for "Undo last move"
  moveNew(batch, items) { return call('moveNew', { batch, items }); }
  moveUndo() { return call('moveUndo'); }
  oldFolders() { return call('oldFolders'); }
  // Restore original file names (admin, v4.2): preview, apply in small batches, undo
  restorePlan() { return call('restorePlan'); }
  restoreNames(batch, items) { return call('restoreNames', { batch, items }); }
  restoreUndo() { return call('restoreUndo'); }
  // Share ONE file by link (v3.2): "anyone with the link" can view that file only
  shareFile(id) { return call('shareFile', { id }); }
  unshareFile(id) { return call('unshareFile', { id }); }
  // Rename tool (admin, v3.2): only names change; the backend keeps the old name for "Undo last rename"
  renameFiles(batch, items) { return call('renameFiles', { batch, items }); }
  renameUndo() { return call('renameUndo'); }
  async deleteFile(id) { await call('deleteFile', { id }); this.blobCache.delete(id); this.thumbCache.delete(id); }

  async getBlob(id, fresh = false) {
    if (!fresh && this.blobCache.has(id)) return this.blobCache.get(id);
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

  // Company settings and invoices
  getSettings() { return call('getSettings'); }
  saveSettings(s) { return call('saveSettings', { settings: s }); }
  async createInvoice(inv, dateFmt) { return call('createInvoice', { invoice: inv, dateFmt }); }
  async updateInvoice(id, inv, dateFmt) { const r = await call('updateInvoice', { id, invoice: inv, dateFmt }); this.blobCache.delete(id); this.thumbCache.delete(id); return r; }

  // Sub-folder migration (admin)
  migrate(dryRun, from) { return call('migrateFolders', { dryRun, from, limit: 40 }); }

  // AI (editor+). The backend starts its last Gemini attempt within 45 s and is normally done by ~225 s; 240 s leaves
  // room for the upload. A result that comes later is cached in the backend for 10 min ("Try again" gets it at once).
  aiExtract(files) { return call('aiExtract', { files }, null, 240000); }

  // Device password (v3.3). A new device session needs the Google ID token, never the device session.
  createDeviceSession(name, replace) { return googleCall('createDeviceSession', { name, replace: replace || '' }); }
  listMySessions() { return call('listMySessions'); }
  revokeSession(sid) { return call('revokeSession', { sid }); }
  listAllSessions() { return call('listAllSessions'); }
  revokeAny(sid) { return call('revokeAny', { sid }); }

  // Team / access (admin only)
  aclList() { return call('aclList'); }
  aclSet(email, role) { return call('aclSet', { email, role }); }
  aclRemove(email) { return call('aclRemove', { email }); }
}
