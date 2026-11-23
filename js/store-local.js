// On-device storage (IndexedDB), for trying the app out or working without Drive
import { uid } from './util.js';
import { calcTotals } from './invoice.js';
import { uniqueIn, extOf, withExt } from './naming.js';
import { VFIELDS, VSLOTS, plateKey, ymForVehicle } from './vehicles.js';
import { FOLDERS } from './config.js';
import { PRB_FIELDS, prbTotals, findDup } from './prb.js';

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
      f.moved = { batch, folder: f.folder || '', vehicleId: f.vehicleId || '', vslot: f.vslot || '', old: f.name, first: !f.movedFrom };
      f.movedFrom ||= { folder: f.folder || '', vehicleId: f.vehicleId || '', vslot: f.vslot || '' };
      f.folder = ''; f.vehicleId = it.vehicleId; f.vslot = it.slot;
      if (it.name) f.name = withExt(String(it.name).trim(), extOf(f.name));
      f.name = uniqueIn(f.name, await this.taken(f));
      if (f.name !== f.moved.old) (f.hist ||= []).push({ old: f.moved.old, name: f.name });
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
      if (f.name !== f.moved.old && f.hist?.at(-1)?.name === f.name) f.hist.pop();
      if (f.moved.first) delete f.movedFrom;
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
      (f.hist ||= []).push({ old: f.name, name });
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
      if (f.name === f.renamed.name) { if (f.hist?.at(-1)?.name === f.name) f.hist.pop(); f.name = uniqueIn(f.renamed.old, await this.taken(f)); out.done++; } else out.skipped++;
      delete f.renamed;
      await rq(this.s('files', 'readwrite').put(f));
    }
    return out;
  }
  // Restore original file names in demo mode (same rules as the backend: oldest name, optional previous folder, undo)
  async restorePlan() {
    const cs = Object.fromEntries((await rq(this.s('customers').getAll())).map(c => [c.id, c.name]));
    const label = m => m.vslot ? m.vslot : (FOLDERS.find(F => F.slot === m.folder)?.th || 'ไม่ระบุ');
    return (await rq(this.s('files').getAll())).filter(f => f.hist?.length && f.hist[0].old !== f.name && cs[f.customerId])
      .map(f => ({ id: f.id, customerId: f.customerId, customer: cs[f.customerId], name: f.name, old: f.hist[0].old,
        from: f.movedFrom && (f.movedFrom.folder !== (f.folder || '') || (f.movedFrom.vslot || '') !== (f.vslot || '')) ? { id: 'local', name: label(f.movedFrom), ok: true } : null }));
  }
  async restoreNames(batch, items) {
    try { localStorage.setItem('by_rs_last', batch); } catch { }
    const rows = [];
    for (const it of items) {
      const f = await rq(this.s('files').get(it.id));
      if (!f?.hist?.length) { rows.push({ id: it.id, status: 'nohistory' }); continue; }
      const prev = { folder: f.folder || '', vehicleId: f.vehicleId || '', vslot: f.vslot || '' }, prevName = f.name;
      const moved = !!(it.back && f.movedFrom);
      if (moved) Object.assign(f, f.movedFrom);
      f.name = uniqueIn(withExt(String(it.name || f.hist[0].old).trim(), extOf(f.hist[0].old) || extOf(prevName)), await this.taken(f));
      f.restored = { batch, prevName, prev };
      await rq(this.s('files', 'readwrite').put(f));
      rows.push({ id: it.id, status: 'ok', name: f.name, moved });
    }
    return { rows };
  }
  async restoreUndo() {
    let last = ''; try { last = localStorage.getItem('by_rs_last') || ''; } catch { }
    const out = { done: 0, skipped: 0, more: false };
    for (const f of await rq(this.s('files').getAll())) {
      if (!last || f.restored?.batch !== last) continue;
      Object.assign(f, f.restored.prev, { name: f.restored.prevName });
      delete f.restored;
      f.name = uniqueIn(f.name, await this.taken(f));
      await rq(this.s('files', 'readwrite').put(f));
      out.done++;
    }
    return out;
  }
  // Edit with AI in demo mode (same rules as the backend: keep the previous state, undo the last 5 batches)
  aiLog() { try { return JSON.parse(localStorage.getItem('by_ai_log') || '[]'); } catch { return []; } }
  aiLogPut(a) { try { localStorage.setItem('by_ai_log', JSON.stringify(a.slice(-5))); } catch { } }
  async aiEditApply(batch, customerId, items, vehicles = []) {
    const loc = f => ({ name: f.name, folder: f.folder || '', vehicleId: f.vehicleId || '', vslot: f.vslot || '', type: f.type || '' });
    const TYPE = { '1': 'policy', '2': 'policy', '3': 'policy', '5.2': 'policy', '4': 'payment', '5.4': 'payment', '5.1': 'car', '5.3': 'car', '5.5': 'id' };
    const rows = [], vrows = [];
    for (const x of vehicles) {
      const v = await rq(this.s('vehicles').get(x.id));
      if (!v || v.customerId !== customerId) { vrows.push({ id: x.id, status: 'error' }); continue; }
      const o = {}, n = {};
      for (const [k, val] of Object.entries(x.fields || {})) if (k !== 'plate' && VFIELDS.includes(k) && (v[k] || '') !== (val || '')) { o[k] = v[k] || ''; n[k] = val || ''; }
      if (!Object.keys(n).length) { vrows.push({ id: x.id, status: 'same' }); continue; }
      for (const [k, val] of Object.entries(n)) { if (val) v[k] = val; else delete v[k]; }
      v._ai = [...(v._ai || []).slice(-4), { b: batch, o, n }]; v.aib = batch;
      await rq(this.s('vehicles', 'readwrite').put(v));
      vrows.push({ id: x.id, status: 'ok' });
    }
    for (const it of items) {
      const f = await rq(this.s('files').get(it.id));
      if (!f || f.customerId !== customerId) { rows.push({ id: it.id, status: 'error' }); continue; }
      const before = loc(f);
      if (it.vehicleId) { f.folder = ''; f.vehicleId = it.vehicleId; f.vslot = it.slot; f.type = TYPE[it.slot] || f.type; }
      if (it.name) f.name = withExt(String(it.name).trim(), extOf(before.name));
      f.name = uniqueIn(f.name, await this.taken(f));
      const after = loc(f);
      if (JSON.stringify(after) === JSON.stringify(before)) { rows.push({ id: it.id, status: 'same' }); continue; }
      f.aiHist = [...(f.aiHist || []).slice(-4), { b: batch, before, after }]; f.aib = batch;
      await rq(this.s('files', 'readwrite').put(f));
      rows.push({ id: it.id, status: 'ok', name: f.name });
    }
    const n = rows.filter(r => r.status === 'ok').length;
    if (n || vrows.some(r => r.status === 'ok')) {
      const a = this.aiLog(), c = await rq(this.s('customers').get(customerId));
      let e = a.find(x => x.b === batch);
      if (!e) a.push(e = { b: batch, at: nowIso(), by: 'demo', c: customerId, cn: c?.name || '', n: 0 });
      e.n += n; this.aiLogPut(a);
    }
    return { rows, vehicles: vrows };
  }
  async aiEditUndo(batch, id = '') {
    const a = this.aiLog();
    if (!a.some(x => x.b === batch)) throw Object.assign(new Error('ae.tooOld'), { key: 'ae.tooOld' });
    const out = { done: 0, skipped: 0, more: false };
    const loc = f => ({ name: f.name, folder: f.folder || '', vehicleId: f.vehicleId || '', vslot: f.vslot || '', type: f.type || '' });
    for (const f of await rq(this.s('files').getAll())) {
      if (f.aib !== batch || (id && f.id !== id)) continue;
      const e = f.aiHist?.at(-1);
      if (!e || e.b !== batch || JSON.stringify(loc(f)) !== JSON.stringify(e.after)) { out.skipped++; continue; }
      Object.assign(f, e.before); f.aiHist.pop(); f.aib = f.aiHist.at(-1)?.b || '';
      f.name = uniqueIn(f.name, await this.taken(f));
      await rq(this.s('files', 'readwrite').put(f)); out.done++;
    }
    if (!id) {
      for (const v of await rq(this.s('vehicles').getAll())) {
        const e = v._ai?.find(x => x.b === batch); if (!e) continue;
        for (const k of Object.keys(e.n)) if ((v[k] || '') === (e.n[k] || '')) { if (e.o[k]) v[k] = e.o[k]; else delete v[k]; }
        v._ai = v._ai.filter(x => x !== e); v.aib = v._ai.at(-1)?.b || '';
        if (!v._ai.length) delete v._ai;
        await rq(this.s('vehicles', 'readwrite').put(v)); out.done++;
      }
      const e = a.find(x => x.b === batch); if (e) { e.u = 1; this.aiLogPut(a); }
    }
    return out;
  }
  async aiEditList() { return this.aiLog(); }
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

  /* ---- พ.ร.บ. section (v4.5) in demo mode ---- */
  _prbLoad() {
    try {
      const d = JSON.parse(localStorage.getItem('by_prb') || '{}') || {};
      return { insured: Array.isArray(d.insured) ? d.insured : [], rows: Array.isArray(d.rows) ? d.rows : [], invoices: Array.isArray(d.invoices) ? d.invoices : [] };
    } catch { return { insured: [], rows: [], invoices: [] }; }
  }
  _prbSave(d) { try { localStorage.setItem('by_prb', JSON.stringify(d)); } catch { } }
  _prbEnsureInsured(d, insured = {}) {
    const clean = s => String(s == null ? '' : s).replace(/[\/\\:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim();
    const name = clean(insured.name) || 'ลูกค้า';
    let ins = d.insured.find(x => clean(x.name) === name);
    if (!ins) { ins = { id: uid(), name, taxId: '', address: '', createdAt: nowIso() }; d.insured.push(ins); }
    if (insured.taxId) ins.taxId = String(insured.taxId).trim();
    if (insured.address) ins.address = String(insured.address).trim();
    return ins;
  }
  async prbList() {
    const d = this._prbLoad();
    return { root: d.insured.length || d.rows.length ? 'local' : '', insured: d.insured, rows: d.rows, invoices: d.invoices };
  }
  async prbUpload(blob, insured, row, meta = {}, onProgress) {
    const d = this._prbLoad();
    const dup = findDup(row, d.rows);
    if (dup) throw Object.assign(new Error(dup.name || 'duplicate'), { code: 'duplicate' });
    const ins = this._prbEnsureInsured(d, insured);
    const taken = new Set(d.rows.filter(r => r.insuredId === ins.id).map(r => r.name));
    const name = uniqueIn(String(meta.name || 'prb.pdf').trim(), taken);
    const clean = {};
    for (const k of PRB_FIELDS) clean[k] = String(row?.[k] ?? '').trim();
    const r = {
      id: uid(), insuredId: ins.id, name, mime: meta.mime || blob?.type || 'application/octet-stream',
      size: blob?.size || 0, createdAt: nowIso(), by: 'demo', shared: false, src: '', ...clean,
    };
    if (blob && this.db) await rq(this.s('blobs', 'readwrite').put(blob, r.id));
    d.rows.push(r);
    this._prbSave(d);
    onProgress?.(1);
    return { insured: ins, row: r };
  }
  async prbUpdate(id, row) {
    const d = this._prbLoad(), cur = d.rows.find(x => x.id === id);
    if (!cur) throw Object.assign(new Error('not_found'), { code: 'not_found' });
    const next = { ...cur };
    for (const k of PRB_FIELDS) if (row?.[k] !== undefined) next[k] = String(row[k] ?? '').trim();
    const dup = findDup(next, d.rows, id);
    if (dup) throw Object.assign(new Error(dup.name || 'duplicate'), { code: 'duplicate' });
    Object.assign(cur, next);
    this._prbSave(d);
    return cur;
  }
  prbGetBlob(id) { return rq(this.s('blobs').get(id)); }
  async prbShare(id) {
    const d = this._prbLoad(), r = d.rows.find(x => x.id === id);
    if (!r) throw Object.assign(new Error('not_found'), { code: 'not_found' });
    r.shared = true;
    this._prbSave(d);
    return { row: r, link: `local://${id}` };
  }
  async prbUnshare(id) {
    const d = this._prbLoad(), r = d.rows.find(x => x.id === id);
    if (!r) throw Object.assign(new Error('not_found'), { code: 'not_found' });
    r.shared = false;
    this._prbSave(d);
    return r;
  }
  async prbDelete(id) {
    const d = this._prbLoad();
    d.rows = d.rows.filter(x => x.id !== id);
    d.invoices = d.invoices.filter(x => x.id !== id);
    this._prbSave(d);
    if (this.db) await rq(this.s('blobs', 'readwrite').delete(id));
    return true;
  }
  async prbDeleteInsured(id) {
    const d = this._prbLoad();
    if (!d.insured.some(x => x.id === id)) throw Object.assign(new Error('Insured folder not found'), { code: 'not_found' });
    if (d.rows.some(r => r.insuredId === id) || d.invoices.some(i => i.insuredId === id)) {
      throw Object.assign(new Error('Insured folder is not empty'), { code: 'bad_request', key: 'prb.notEmpty' });
    }
    d.insured = d.insured.filter(x => x.id !== id);
    this._prbSave(d);
    return true;
  }
  async prbSeqReset() {
    const d = this._prbLoad();
    if (d.invoices.length) throw Object.assign(new Error('PRB invoices exist'), { code: 'bad_request', key: 'prb.invExist' });
    try { localStorage.removeItem('by_prb_seq'); } catch { }
    return { ok: true };
  }
  async prbImportPlan() {
    const { customers, files, vehicles } = await this.loadAll();
    const d = this._prbLoad();
    const cs = Object.fromEntries(customers.map(c => [c.id, c]));
    const vs = Object.fromEntries(vehicles.map(v => [v.id, v]));
    const bySrc = Object.fromEntries(d.rows.filter(r => r.src).map(r => [r.src, r.id]));
    return files.filter(f => f.vslot === '3').map(f => {
      const c = cs[f.customerId], v = vs[f.vehicleId];
      return {
        id: f.id, name: f.name, mime: f.mime || '', size: f.size || 0,
        customerId: f.customerId || '', customer: c?.name || '',
        vehicleId: f.vehicleId || '', plate: v?.plate || '', ym: v?.ym || '',
        imported: bySrc[f.id] || '',
      };
    });
  }
  async prbImport(items = []) {
    const d = this._prbLoad(), done = [], skipped = [];
    for (const it of items.slice(0, 20)) {
      const f = this.db ? await rq(this.s('files').get(it.id)) : null;
      if (!f) { skipped.push({ id: it.id, why: 'not_found' }); continue; }
      if (d.rows.some(r => r.src === it.id)) { skipped.push({ id: it.id, why: 'already_imported' }); continue; }
      const dup = findDup(it.row, d.rows);
      if (dup) { skipped.push({ id: it.id, why: 'duplicate' }); continue; }
      const ins = this._prbEnsureInsured(d, it.insured);
      const taken = new Set(d.rows.filter(r => r.insuredId === ins.id).map(r => r.name));
      const name = uniqueIn(withExt(String(it.name || f.name).trim(), extOf(f.name)), taken);
      const clean = {};
      for (const k of PRB_FIELDS) clean[k] = String(it.row?.[k] ?? '').trim();
      const r = {
        id: uid(), insuredId: ins.id, name, mime: f.mime || 'application/octet-stream',
        size: f.size || 0, createdAt: nowIso(), by: 'demo', shared: false, src: f.id, ...clean,
      };
      if (this.db) {
        const blob = await rq(this.s('blobs').get(f.id));
        if (blob) await rq(this.s('blobs', 'readwrite').put(blob.slice(0, blob.size, blob.type), r.id));
      }
      d.rows.push(r);
      done.push({ id: it.id, row: r });
    }
    this._prbSave(d);
    return { done, skipped };
  }
  async prbInvoice(req = {}) {
    const d = this._prbLoad(), ins = d.insured.find(x => x.id === req.insuredId);
    if (!ins) throw Object.assign(new Error('not_found'), { code: 'not_found' });
    const picked = (req.rowIds || []).map(id => d.rows.find(r => r.id === id && r.insuredId === ins.id)).filter(Boolean);
    if (!picked.length || picked.length !== (req.rowIds || []).length) throw Object.assign(new Error('not_found'), { code: 'not_found' });
    const tot = prbTotals(picked);
    const lines = picked.map((r, i) => ({
      rowId: r.id, prbNo: r.prbNo || '', plate: r.plate || '', model: r.model || r.brand || '',
      net: tot.lines[i].net, stamps: tot.lines[i].stamps, vat: tot.lines[i].vat, total: tot.lines[i].total,
    }));
    const issue = req.issue || nowIso().slice(0, 10);
    const year = /^\d{4}/.test(issue) ? issue.slice(0, 4) : String(new Date().getFullYear());
    let seq = {};
    try { seq = JSON.parse(localStorage.getItem('by_prb_seq') || '{}') || {}; } catch { seq = {}; }
    let n = (+seq[year] || 0) + 1;
    const takenNos = new Set(d.invoices.map(x => x.no));
    while (takenNos.has(`PRB-${year}-${String(n).padStart(4, '0')}`)) n++;
    seq[year] = n;
    try { localStorage.setItem('by_prb_seq', JSON.stringify(seq)); } catch { }
    const no = `PRB-${year}-${String(n).padStart(4, '0')}`, now = nowIso();
    const inv = {
      v: 1, id: uid(), no, fileName: no + '.pdf', insuredId: ins.id,
      issue, due: req.due || '', lang: req.lang || 'both', notes: req.notes || '',
      cust: { name: ins.name || '', taxId: ins.taxId || '', address: ins.address || '' },
      lines, t: { net: tot.net, stamps: tot.stamps, vat: tot.vat, total: tot.total },
      status: 'unpaid', createdBy: 'demo', createdAt: now, createdTime: now,
    };
    d.invoices.push(inv);
    this._prbSave(d);
    return inv;
  }
}
