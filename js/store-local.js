// On-device storage (IndexedDB), for trying the app out or working without Drive
import { uid } from './util.js';
import { calcTotals } from './invoice.js';

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
  async addFile(blob, meta, onProgress) {
    const f = { id: uid(), createdAt: new Date().toISOString(), size: blob.size, mime: blob.type || 'application/octet-stream', folder: '', ...meta };
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
