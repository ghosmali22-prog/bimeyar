// On-device storage (IndexedDB), for trying the app out or working without Drive
import { uid } from './util.js';

const rq = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export class LocalStore {
  kind = 'local';

  async init() {
    const r = indexedDB.open('bimeyar', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('customers', { keyPath: 'id' });
      d.createObjectStore('files', { keyPath: 'id' });
      d.createObjectStore('blobs');
    };
    this.db = await rq(r);
  }
  s(name, mode = 'readonly') { return this.db.transaction(name, mode).objectStore(name); }

  async loadAll() {
    return { customers: await rq(this.s('customers').getAll()), files: await rq(this.s('files').getAll()) };
  }
  async saveCustomer(c) {
    c = { ...c };
    c.id ||= uid();
    c.createdAt ||= new Date().toISOString();
    await rq(this.s('customers', 'readwrite').put(c));
    return c;
  }
  async deleteCustomer(id) {
    const files = (await rq(this.s('files').getAll())).filter(f => f.customerId === id);
    for (const f of files) await this.deleteFile(f.id);
    await rq(this.s('customers', 'readwrite').delete(id));
  }
  async addFile(blob, meta, onProgress) {
    const f = { id: uid(), createdAt: new Date().toISOString(), size: blob.size, mime: blob.type || 'application/octet-stream', ...meta };
    await rq(this.s('blobs', 'readwrite').put(blob, f.id));
    await rq(this.s('files', 'readwrite').put(f));
    onProgress?.(1);
    return f;
  }
  async updateFile(f) { await rq(this.s('files', 'readwrite').put(f)); return f; }
  async deleteFile(id) {
    await rq(this.s('files', 'readwrite').delete(id));
    await rq(this.s('blobs', 'readwrite').delete(id));
  }
  getBlob(id) { return rq(this.s('blobs').get(id)); }
  async quota() { return null; }
}
