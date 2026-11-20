// On-device storage (IndexedDB), for trying the app out or working without Drive
import { uid } from './util.js';
import { calcTotals } from './invoice.js';
import { uniqueIn, extOf, withExt } from './naming.js';

const rq = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export class LocalStore {
  kind = 'local';
  aiReady = false;

  async init() {
    const r = indexedDB.open('bimeyar', 2);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const n of ['customers', 'files', 'invoices']) if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, { keyPath: 'id' });
      if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs');
    };
    this.db = await rq(r);
  }
  s(name, mode = 'readonly') { return this.db.transaction(name, mode).objectStore(name); }

  async loadAll() {
    const customers = await rq(this.s('customers').getAll());
    for (const c of customers) c.folders ||= { policy: 1, docs: 1, prev: 1, pay: 1 };
    const files = (await rq(this.s('files').getAll())).map(f => ({ folder: '', ...f }));
    return { customers, files, invoices: await rq(this.s('invoices').getAll()) };
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
    await rq(this.s('customers', 'readwrite').delete(id));
  }
  /** Names of the other files in the same customer folder (same rule as Drive: never the same name twice) */
  async taken(f) {
    return new Set((await rq(this.s('files').getAll())).filter(x => x.id !== f.id && x.customerId === f.customerId && (x.folder || '') === (f.folder || '')).map(x => x.name));
  }
  async addFile(blob, meta, onProgress) {
    const f = { id: uid(), createdAt: new Date().toISOString(), size: blob.size, mime: blob.type || 'application/octet-stream', folder: '', ...meta };
    f.name = uniqueIn(f.name, await this.taken(f));
    await rq(this.s('blobs', 'readwrite').put(blob, f.id));
    await rq(this.s('files', 'readwrite').put(f));
    onProgress?.(1);
    return f;
  }
  async updateFile(f) { await rq(this.s('files', 'readwrite').put(f)); return f; }
  async moveFile(id, folder) { const f = await rq(this.s('files').get(id)); f.folder = folder; return this.updateFile(f); }
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
