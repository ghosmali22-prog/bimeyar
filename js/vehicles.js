// Vehicles and their Drive folders (v4). Pure functions (no DOM), also used by tests/vehicles.test.mjs.
//
//   customer → month ("07 July 2026", month of the contract date) → plate ("99-0016") → 1, 2, 3, 4, 5 (5.1–5.5 inside 5)
//
// A vehicle record = one plate folder in one month: the same plate renewed next year is a new record in that year's
// month. Customers from before v4 keep their single plate/policy in the customer details: they are shown as
// "vehicle #1" (legacy) until a real record with that plate and month exists. Nothing is ever copied out of or
// removed from the customer details.
import { plateOnly, buildName, plateFromName, safeName, extOf, customerPart } from './naming.js';
import { latinDigits, beToCe } from './validate.js';

/**
 * The folders inside every plate folder. Must match VSLOTS in backend/Code.gs.
 * th = folder name in Drive, doc = document name in file names (the folder name without its number; "/" is not
 * allowed in file names, so it becomes "-"; the dot of พรบ. is dropped, so never "..pdf"), type = the v2/v3 file type kept for old screens and filters.
 */
export const VSLOTS = [
  { id: '1', th: '1. กรมธรรม์รถยนต์', doc: 'กรมธรรม์รถยนต์', icon: 'shield', type: 'policy' },
  { id: '2', th: '2. กรมธรรม์ขนส่งสินค้า', doc: 'กรมธรรม์ขนส่งสินค้า', icon: 'shield', type: 'policy' },
  { id: '3', th: '3. พรบ.', doc: 'พรบ', icon: 'shield', type: 'policy' },
  { id: '4', th: '4. ใบวางบิล/ใบเสนอราคา', doc: 'ใบวางบิล-ใบเสนอราคา', icon: 'invoice', type: 'payment' },
  { id: '5', th: '5. เอกสารตัวรถยนต์', doc: '', icon: 'folder', type: 'car', group: true },
  { id: '5.1', th: '5.1 สำเนาทะเบียนรถ', doc: 'สำเนาทะเบียนรถ', icon: 'idcard', type: 'car', in: '5' },
  { id: '5.2', th: '5.2 สำเนากรมธรรม์เดิม', doc: 'สำเนากรมธรรม์เดิม', icon: 'history', type: 'policy', in: '5' },
  { id: '5.3', th: '5.3 รูปรถ', doc: 'รูปรถ', icon: 'camera', type: 'car', in: '5' },
  { id: '5.4', th: '5.4 หลักฐานการโอนเงิน', doc: 'หลักฐานการโอนเงิน', icon: 'receipt', type: 'payment', in: '5' },
  { id: '5.5', th: '5.5 หนังสือแต่งตั้ง/หนังสือรับรองบริษัท', doc: 'หนังสือแต่งตั้ง-หนังสือรับรองบริษัท', icon: 'idcard', type: 'id', in: '5' },
];
export const VSLOT = Object.fromEntries(VSLOTS.map(s => [s.id, s]));
/** Folders that hold files (never 5 itself) */
export const FILE_SLOTS = VSLOTS.filter(s => !s.group).map(s => s.id);
/** Vehicle fields. All optional except the plate. Must match VFIELDS in backend/Code.gs. */
export const VFIELDS = ['plate', 'province', 'brand', 'model', 'year', 'color', 'body', 'vin', 'engineNo',
  'insurer', 'policyNo', 'policyType', 'coverage', 'premium', 'contractDate', 'policyStart', 'policyExpiry', 'note'];
export const VGROUPS = {
  vehicle: ['plate', 'province', 'brand', 'model', 'year', 'color', 'body', 'vin', 'engineNo'],
  policy: ['insurer', 'policyNo', 'policyType', 'coverage', 'premium', 'contractDate', 'policyStart', 'policyExpiry'],
};

/* ---------------- months ---------------- */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "2026-07" from the first usable date (YYYY-MM-DD, a Buddhist year is converted to CE); '' when none. */
export function ymOf(...dates) {
  for (const d of dates) {
    const m = String(d || '').match(/^(\d{4})-(\d{2})/);
    if (m && +m[2] >= 1 && +m[2] <= 12) return `${beToCe(+m[1])}-${m[2]}`;
  }
  return '';
}
/** Month of a NEW vehicle: contract date, else policy start, else the day it is added. */
export const ymForVehicle = (v, added) => ymOf(v?.contractDate, v?.policyStart, added);
/** Drive folder name: "07 July 2026" */
export const ymFolder = ym => ym ? `${ym.slice(5, 7)} ${MONTHS[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}` : '';
/** "July 2026" (search results, cards) */
export const ymText = ym => ym ? `${MONTHS[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}` : '';
/** Month number for file names, without a leading zero: "2026-07" -> 7 */
export const ymMonth = ym => +String(ym || '').slice(5, 7) || 0;

/* ---------------- keys for comparing ---------------- */
export const plateKey = p => plateOnly(latinDigits(p)).replace(/[\s.\-]/g, '').toLowerCase();
export const vinKey = v => latinDigits(v).replace(/[\s.\-]/g, '').toUpperCase();
const PERSON = /^(นาย|นางสาว|นาง|น\.ส\.|ด\.ช\.|ด\.ญ\.|mr\.?|mrs\.?|ms\.?|miss)\s*/i;
/** Names compared without company words, titles, spaces and case */
export const nameKey = s => customerPart({ name: s }).replace(PERSON, '').replace(/[\s.]/g, '').toLowerCase();

/* ---------------- vehicles of a customer ---------------- */
const LEGACY_KEYS = ['province', 'brand', 'model', 'year', 'color', 'vin', 'engineNo', 'insurer', 'policyNo', 'policyType', 'coverage', 'premium', 'contractDate', 'policyStart', 'policyExpiry'];
/** The pre-v4 single vehicle of a customer (from the customer details), or null. Its id is "L:<customer id>". */
export function legacyVehicle(c) {
  if (!c) return null;
  const plate = plateOnly(c.plate, c.province);
  if (!plate && !LEGACY_KEYS.some(k => c[k])) return null;
  const v = { id: 'L:' + c.id, legacy: true, customerId: c.id, plate, folders: {} };
  for (const k of LEGACY_KEYS) v[k] = c[k] || '';
  if (!v.brand && !v.model && c.car) v.model = c.car;
  v.ym = ymOf(c.contractDate, c.policyStart, c.createdAt) || ymOf(new Date().toISOString());
  return v;
}
/** All vehicle records of a customer + the legacy one while no record has its plate in its month. Newest month first. */
export function vehiclesOf(c, vehicles) {
  if (!c) return [];
  const mine = vehicles.filter(v => v.customerId === c.id);
  const L = legacyVehicle(c);
  if (L && !(L.plate && mine.some(v => plateKey(v.plate) === plateKey(L.plate) && v.ym === L.ym))) mine.push(L);
  return mine.sort((a, b) => b.ym.localeCompare(a.ym) || plateKey(a.plate).localeCompare(plateKey(b.plate)));
}
/** The latest month of every plate (renewals, status): one entry per vehicle */
export function latestOf(list) {
  const best = {};
  for (const v of list) {
    const k = v.customerId + '|' + (plateKey(v.plate) || v.id);
    if (!best[k] || v.ym > best[k].ym) best[k] = v;
  }
  return Object.values(best);
}
/** { ym: [vehicles] } newest month first */
export function byMonth(list) {
  const out = new Map();
  for (const v of [...list].sort((a, b) => b.ym.localeCompare(a.ym))) { if (!out.has(v.ym)) out.set(v.ym, []); out.get(v.ym).push(v); }
  return out;
}

/* ---------------- file names (v4) ---------------- */
/** {PLATE} - {CUSTOMER}({M}) - {DOCNAME}.{ext}, from the vehicle's month and the folder. Never the nickname. */
export function vehicleFileName({ vehicle, customer, slot, ext = '' }) {
  return buildName({ plate: plateOnly(vehicle?.plate), customer, month: ymMonth(vehicle?.ym) || new Date().getMonth() + 1, doc: VSLOT[slot]?.doc || 'เอกสาร', ext });
}

/* ---------------- which folder (AI answer or old folder) ---------------- */
const CMI = /พ\s*\.?\s*ร\s*\.?\s*บ|ภาคบังคับ|compulsory|\bcmi\b/i;
/**
 * Folder for a document the AI read: its own answer (slot), corrected by what it found:
 * a พ.ร.บ. is 3, a policy whose cover already ended is a previous policy (5.2). '' = the user must choose.
 */
export function slotFromAi(n, today = new Date().toISOString().slice(0, 10)) {
  if (!n) return '';
  let s = FILE_SLOTS.includes(n.slot) ? n.slot : '';
  if (!s) s = { registration: '5.1', id_card: '5.5', receipt: '5.4' }[n.docType] || '';
  if (!s && n.docType === 'policy') s = '1';
  if ((s === '1' || s === '2') && CMI.test(`${n.values?.policyType || ''} ${n.docName || ''}`)) s = '3';
  if (['1', '2', '3'].includes(s) && n.values?.policyExpiry && n.values.policyExpiry < today) s = '5.2';
  return s;
}
const has = (s, re) => re.test(String(s || ''));
/** Folder for an old file (move tool): from its v3 folder, v2 type and name. '' = the user must choose. */
export function slotForOld(f, today = new Date().toISOString().slice(0, 10)) {
  const n = String(f.name || '');
  const img = String(f.mime || '').startsWith('image/');
  if (f.invoice) return '4';
  if (has(n, /ใบวางบิล|ใบเสนอราคา|ใบแจ้งหนี้|quotation|invoice/i)) return '4';
  if (has(n, /กรมธรรม์เดิม|previous/i) || f.folder === 'prev') return '5.2';
  if (has(n, /สลิป|โอนเงิน|หลักฐานการชำระ|ใบเสร็จ|slip|receipt/i) || f.folder === 'pay' || f.type === 'payment') return '5.4';
  if (has(n, /ขนส่งสินค้า|cargo/i)) return '2';
  if (f.folder === 'policy' || f.type === 'policy' || has(n, /กรมธรรม์|policy/i)) {
    if (CMI.test(n)) return '3';
    if (!f.folder && f.expiry && f.expiry < today) return '5.2';
    return '1';
  }
  if (has(n, /ทะเบียนรถ|เล่มทะเบียน|registration/i)) return '5.1';
  if (has(n, /รูปรถ|ภาพถ่ายรถ|เคลม|claim|photo/i) || f.type === 'claim') return '5.3';
  if (has(n, /บัตรประชาชน|ใบขับขี่|หนังสือเดินทาง|หนังสือรับรอง|แต่งตั้ง|มอบอำนาจ|id.?card|licen[cs]e|passport/i) || f.type === 'id') return '5.5';
  if (f.folder === 'docs' || f.type === 'car') return img ? '5.3' : '5.1';
  return '';
}

/* ---------------- who is this document for (smart upload) ---------------- */
/**
 * Finds the customer of an AI answer: 1) chassis number of a known vehicle, 2) plate, 3) insured name against the
 * customer names and nicknames. Returns { cid, how, conf: 'high' | 'mid' | 'low' } or null.
 * `all` = every vehicle (records + legacy) as from allVehicles().
 */
export function findCustomer(v, customers, all) {
  const vin = vinKey(v.vin), pk = plateKey(v.plate);
  if (vin.length >= 6) {
    const ids = [...new Set(all.filter(x => vinKey(x.vin) === vin).map(x => x.customerId))];
    if (ids.length === 1) return { cid: ids[0], how: 'vin', conf: 'high' };
  }
  if (pk.length >= 3) {
    const ids = [...new Set(all.filter(x => plateKey(x.plate) === pk).map(x => x.customerId))];
    if (ids.length === 1) return { cid: ids[0], how: 'plate', conf: 'high' };
    if (ids.length > 1) return { cid: ids[0], how: 'plate', conf: 'low' };
  }
  for (const nm of [v.insuredName, v.name, v.nameEn]) {
    const k = nameKey(nm);
    if (k.length < 3) continue;
    const same = customers.filter(c => nameKey(c.name) === k || nameKey(c.nameEn) === k || (c.nick && nameKey(c.nick) === k));
    if (same.length === 1) return { cid: same[0].id, how: 'name', conf: 'mid' };
    if (k.length >= 5) {
      const part = customers.filter(c => { const a = nameKey(c.name); return a.length >= 5 && (a.includes(k) || k.includes(a)); });
      if (part.length === 1) return { cid: part[0].id, how: 'name', conf: 'low' };
    }
  }
  return null;
}
/** Records + legacy vehicles of all customers */
export const allVehicles = (customers, vehicles) => customers.flatMap(c => vehiclesOf(c, vehicles));

/**
 * The vehicle of the customer for this document. A dated policy (1, 2, 3) of a plate whose month is not there yet
 * is a renewal -> { add: true } (a new record in the new month). Returns { vid, conf, add?, ym? }.
 */
export function findVehicle(v, slot, list) {
  const vin = vinKey(v.vin), pk = plateKey(v.plate);
  const same = list.filter(x => (vin.length >= 6 && vinKey(x.vin) === vin) || (pk.length >= 3 && plateKey(x.plate) === pk));
  const ym = ymOf(v.contractDate, v.policyStart);
  if (!same.length) return pk.length >= 3 ? { vid: '', add: true, ym, conf: 'high' } : list.length === 1 ? { vid: list[0].id, conf: 'low' } : { vid: '', conf: 'none' };
  if (ym) {
    const exact = same.find(x => x.ym === ym);
    if (exact) return { vid: exact.id, conf: 'high' };
    if (['1', '2', '3'].includes(slot)) return { vid: '', add: true, ym, conf: 'high', renew: same[0].id };
  }
  return { vid: same.sort((a, b) => b.ym.localeCompare(a.ym))[0].id, conf: ym ? 'mid' : 'high' };
}

/**
 * Files dropped together usually belong to the same vehicle: rows the AI could not place get the customer and
 * vehicle that most other rows of the batch were sure about (marked conf 'hint').
 */
export function batchHint(rows) {
  const count = {};
  for (const r of rows) if (r.cid && r.vkey && ['high', 'mid', 'new'].includes(r.conf)) { const k = r.cid + '\n' + r.vkey; count[k] = (count[k] || 0) + 1; }
  const best = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
  if (!best) return rows;
  const [cid, vkey] = best[0].split('\n');
  for (const r of rows) {
    if (r.touched || r.ai === 'wait' || r.ai === 'busy') continue;   // the user chose, or the AI is still reading this one
    if (!r.cid) { r.cid = cid; r.vkey = vkey; r.conf = 'hint'; }
    else if (!r.vkey && r.cid === cid) { r.vkey = vkey; r.conf = 'hint'; }
  }
  return rows;
}

/* ---------------- search ---------------- */
const fold = s => latinDigits(String(s || '')).toLowerCase().replace(/\s+/g, ' ');
/** One result per vehicle: customer name, nickname, plate, chassis or month ("July 2026", "07/2026", "2026-07") */
export function searchVehicles(q, customers, vehicles) {
  const nq = fold(q).trim(), kq = nq.replace(/[\s.\-]/g, '');
  if (!nq) return [];
  const out = [];
  for (const c of customers) {
    const who = fold(`${c.name} ${c.nick || ''} ${c.nameEn || ''}`);
    for (const v of vehiclesOf(c, vehicles)) {
      const m = v.ym ? `${fold(ymText(v.ym))} ${v.ym} ${v.ym.slice(5, 7)}/${v.ym.slice(0, 4)} ${+v.ym.slice(5, 7)}/${v.ym.slice(0, 4)}` : '';
      const hit = who.includes(nq) || (kq.length >= 2 && (plateKey(v.plate).includes(kq) || (kq.length >= 4 && vinKey(v.vin).toLowerCase().includes(kq)))) || m.includes(nq);
      if (hit) out.push({ c, v });
    }
  }
  return out;
}

/* ---------------- move tool (old files -> new folders) ---------------- */
/**
 * Plan for one customer's old files (v2 loose files and v3 sub-folders). Every row: file, slot, plate, month, name.
 * plate '' = "please choose": such a row is not moved until the user picks a plate.
 * The name is kept when it already follows the pattern; otherwise a pattern name (never the nickname).
 */
export function movePlan(c, files, vehicles, invoices = [], today = new Date().toISOString().slice(0, 10)) {
  const list = vehiclesOf(c, vehicles);
  const plates = [...new Set(list.map(v => plateOnly(v.plate)).filter(Boolean))];
  const rows = [];
  for (const f of files) {
    if (f.customerId !== c.id || f.vslot) continue;   // already in the new folders
    const inv = f.invoice ? invoices.find(i => i.id === f.id) : null;
    let plate = plateFromName(f.name) || plateOnly(inv?.veh?.plate, inv?.veh?.province) || (plates.length === 1 ? plates[0] : '');
    const known = plate ? list.filter(v => plateKey(v.plate) === plateKey(plate)) : [];
    if (known.length) plate = plateOnly(known[0].plate);
    const L = list.find(v => v.legacy && plateKey(v.plate) === plateKey(plate));
    const ym = (L || known[0])?.ym || ymOf(c.contractDate, c.policyStart, f.at, f.createdAt);
    rows.push({ id: f.id, cid: c.id, old: f.name, from: f.folder || '', slot: slotForOld(f, today), plate, ym, keep: !!plateFromName(f.name) || !!f.invoice, on: true });
  }
  return rows;
}
/** The new name for a move-plan row: unchanged for names that follow the pattern and for invoices. */
export function moveName(row, c) {
  if (row.keep) return row.old;
  return vehicleFileName({ vehicle: { plate: row.plate, ym: row.ym }, customer: c, slot: row.slot, ext: extOf(row.old) });
}
export { safeName };
