// On-device storage (IndexedDB), for trying the app out or working without Drive
import { uid } from './util.js';
import { calcTotals } from './invoice.js';
import { uniqueIn, extOf, withExt } from './naming.js';
import { VFIELDS, VSLOTS, plateKey, ymForVehicle } from './vehicles.js';
import { FOLDERS } from './config.js';

const ALL_SLOTS = Object.fromEntries(VSLOTS.map(s => [s.id, 1]));
const nowIso = () => new Date().toISOString();

const rq = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export class LocalStore {
  kind = 'local';
  /** No AI in "this device" mode. Automated tests may set globalThis.BIMEYAR_TEST_AI (a fake reader) before the app starts. */
  get aiReady() { return typeof globalThis.BIMEYAR_TEST_AI === 'function'; }
  aiExtract(files) { return globalThis.BIMEYAR_TEST_AI(files); }

  async init() {
    const r = indexedDB.open('bimeyar', 3);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const n of ['customers', 'files', 'invoices', 'vehicles']) if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, { keyPath: 'id' });
      if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs');
    };
    this.db = await rq(r);
  }
  s(name, mode = 'readonly') { return this.db.transaction(name, mode).objectStore(name); }

  async loadAll() {
    const customers = await rq(this.s('customers').getAll());
    for (const c of customers) c.folders ||= { policy: 1, docs: 1, prev: 1, pay: 1 };
    const files = (await rq(this.s('files').getAll())).map(f => ({ folder: '', ...f }));
    const vehicles = (await rq(this.s('vehicles').getAll())).map(v => ({ ...v, folders: ALL_SLOTS }));
    return { customers, files, invoices: await rq(this.s('invoices').getAll()), vehicles };
  }
  async saveCustomer(c) {
    const old = c.id ? await rq(this.s('customers').get(c.id)) : null;
    c = { ...(old || {}), ...c };
    c.id ||= uid();
    c.createdAt ||= new Date().toISOString();
    c.folders = { policy: 1, docs: 1, prev: 1, pay: 1 };
    await rq(this.s('customers', 'readwrite').put(c));
    return c;
  }
  async deleteCustomer(id) {
    const files = (await rq(this.s('files').getAll())).filter(f => f.customerId === id);
    for (const f of files) await this.deleteFile(f.id);
    for (const i of (await rq(this.s('invoices').getAll())).filter(i => i.customerId === id)) await rq(this.s('invoices', 'readwrite').delete(i.id));
    for (const v of (await rq(this.s('vehicles').getAll())).filter(v => v.customerId === id)) await rq(this.s('vehicles', 'readwrite').delete(v.id));
    await rq(this.s('customers', 'readwrite').delete(id));
  }
  /** Names of the other files in the same folder (same rule as Drive: never the same name twice) */
  async taken(f) {
    const same = x => x.customerId === f.customerId && (x.folder || '') === (f.folder || '') && (x.vehicleId || '') === (f.vehicleId || '') && (x.vslot || '') === (f.vslot || '');
    return new Set((await rq(this.s('files').getAll())).filter(x => x.id !== f.id && same(x)).map(x => x.name));
  }

  /* ---- vehicles (v4), same rules as the backend: merge, same plate + month = same vehicle ---- */
  async saveVehicle(v) {
    const all = await rq(this.s('vehicles').getAll());
    const fields = {};
    for (const k of VFIELDS) if (v[k] !== undefined) fields[k] = String(v[k] ?? '').trim();
    let old = v.id ? all.find(x => x.id === v.id) : null;
    if (!old) {
      if (!fields.plate) throw Object.assign(new Error('vh.needPlate'), { key: 'vh.needPlate' });
      const ym = v.ym || ymForVehicle(fields, nowIso());
      old = all.find(x => x.customerId === v.customerId && x.ym === ym && plateKey(x.plate) === plateKey(fields.plate))
        || { id: uid(), customerId: v.customerId, ym, createdAt: nowIso() };
    }
    const d = { ...old };
    for (const [k, x] of Object.entries(fields)) { if (x) d[k] = x; else delete d[k]; }
    if (!d.plate) throw Object.assign(new Error('vh.needPlate'), { key: 'vh.needPlate' });
    delete d.folders;
    await rq(this.s('vehicles', 'readwrite').put(d));
    return { ...d, folders: ALL_SLOTS };
  }
  async deleteVehicle(id) {
    for (const f of (await rq(this.s('files').getAll())).filter(f => f.vehicleId === id)) await this.deleteFile(f.id);
    await rq(this.s('vehicles', 'readwrite').delete(id));
  }
  async addFile(blob, meta, onProgress) {
    const f = { id: uid(), createdAt: new Date().toISOString(), size: blob.size, mime: blob.type || 'application/octet-stream', folder: '', ...meta };
    if (meta.vehicleId) { f.vslot = meta.slot; f.folder = ''; }
    delete f.slot;
    f.name = uniqueIn(f.name, await this.taken(f));
    await rq(this.s('blobs', 'readwrite').put(blob, f.id));
    await rq(this.s('files', 'readwrite').put(f));
    onProgress?.(1);
    return f;
  }
  async updateFile(f) { await rq(this.s('files', 'readwrite').put(f)); return f; }
  async moveFile(id, to) {
    const f = await rq(this.s('files').get(id));
    if (typeof to === 'string') { f.folder = to; f.vehicleId = ''; f.vslot = ''; } else { f.folder = ''; f.vehicleId = to.vehicleId; f.vslot = to.slot; }
    f.name = uniqueIn(f.name, await this.taken(f));
    return this.updateFile(f);
  }
  // Move tool in demo mode (same rules as the backend: only moves, undo puts the files back)
  async moveNew(batch, items) {
    try { localStorage.setItem('by_mv_last', batch); } catch { }
    const rows = [];
    for (const it of items) {
      const f = await rq(this.s('files').get(it.id));
      if (!f) { rows.push({ id: it.id, status: 'error' }); continue; }
      f.moved = { batch, folder: f.folder || '', vehicleId: f.vehicleId || '', vslot: f.vslot || '', old: f.name };
      f.folder = ''; f.vehicleId = it.vehicleId; f.vslot = it.slot;
      if (it.name) f.name = withExt(String(it.name).trim(), extOf(f.name));
      f.name = uniqueIn(f.name, await this.taken(f));
      await rq(this.s('files', 'readwrite').put(f));
      rows.push({ id: it.id, status: 'ok', name: f.name });
    }
    return { rows };
  }
  async moveUndo() {
    let last = ''; try { last = localStorage.getItem('by_mv_last') || ''; } catch { }
    const out = { done: 0, skipped: 0, more: false };
    for (const f of await rq(this.s('files').getAll())) {
      if (!last || f.moved?.batch !== last) continue;
      Object.assign(f, { folder: f.moved.folder, vehicleId: f.moved.vehicleId, vslot: f.moved.vslot, name: f.moved.old });
      delete f.moved;
      f.name = uniqueIn(f.name, await this.taken(f));
      await rq(this.s('files', 'readwrite').put(f));
      out.done++;
    }
    return out;
  }
  /** The 4 old folders of every customer, with the number of files still inside (nothing is deleted) */
  async oldFolders() {
    const files = await rq(this.s('files').getAll()), out = [];
    for (const c of await rq(this.s('customers').getAll())) for (const F of FOLDERS) {
      out.push({ id: c.id + ':' + F.slot, name: F.th, customerId: c.id, customer: c.name, items: files.filter(f => f.customerId === c.id && f.folder === F.slot).length });
    }
    return out;
  }
  async deleteFile(id) {
    await rq(this.s('files', 'readwrite').delete(id));
    await rq(this.s('blobs', 'readwrite').delete(id));
  }
  getBlob(id) { return rq(this.s('blobs').get(id)); }

  // Rename tool in demo mode (same rules as the backend: only the name changes, undo puts the old name back)
  async renameFiles(batch, items) {
    try { localStorage.setItem('by_rn_last', batch); } catch { }
    const rows = [];
    for (const it of items) {
      const f = await rq(this.s('files').get(it.id));
      if (!f) { rows.push({ id: it.id, status: 'error' }); continue; }
      const name = uniqueIn(withExt(String(it.name || '').trim(), extOf(f.name)), await this.taken(f));
      if (!name || name === f.name) { rows.push({ id: it.id, status: 'same' }); continue; }
      f.renamed = { batch, old: f.name, name };
      const old = f.name; f.name = name;
      await rq(this.s('files', 'readwrite').put(f));
      rows.push({ id: it.id, status: 'ok', old, name });
    }
    return { rows };
  }
  async renameUndo() {
    let last = ''; try { last = localStorage.getItem('by_rn_last') || ''; } catch { }
    const out = { done: 0, skipped: 0, more: false };
    for (const f of await rq(this.s('files').getAll())) {
      if (!last || f.renamed?.batch !== last) continue;
      if (f.name === f.renamed.name) { f.name = uniqueIn(f.renamed.old, await this.taken(f)); out.done++; } else out.skipped++;
      delete f.renamed;
      await rq(this.s('files', 'readwrite').put(f));
    }
    return out;
  }
  async quota() { return null; }

  // Company settings are kept in this browser in demo mode
  async getSettings() { try { return { name: 'RICH INSURANS', prefix: 'DEMO', ...JSON.parse(localStorage.getItem('by_company') || '{}') }; } catch { return { name: 'RICH INSURANS', prefix: 'DEMO' }; } }
  async saveSettings(s) {
    const cur = await this.getSettings();
    const next = { ...cur, ...s };
    if (s.logo?.data) next.logo = `data:${s.logo.mime};base64,${s.logo.data}`;
    if (s.removeLogo) next.logo = '';
    delete next.removeLogo;
    try { localStorage.setItem('by_company', JSON.stringify(next)); } catch { }
    return next;
  }
  async createInvoice(inv) {
    const t = calcTotals(inv.items, inv.discount, inv.vat, inv.paid);
    const year = (inv.issue || '').slice(0, 4);
    let n = 1;
    try { n = (+localStorage.getItem('by_inv_' + year) || 0) + 1; localStorage.setItem('by_inv_' + year, n); } catch { }
    const x = { ...inv, id: uid(), no: `DEMO-${year}-${String(n).padStart(4, '0')}`, t, status: t.status, createdAt: new Date().toISOString(), local: true };
    await rq(this.s('invoices', 'readwrite').put(x));
    return x;
  }
  async updateInvoice(id, inv) {
    const old = await rq(this.s('invoices').get(id));
    const x = { ...old, ...inv, id, no: old.no };
    x.t = calcTotals(x.items, x.discount, x.vat, x.paid); x.status = x.t.status; x.updatedAt = new Date().toISOString();
    await rq(this.s('invoices', 'readwrite').put(x));
    return x;
  }
}
