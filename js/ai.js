// AI document reading: prepares files, cleans and checks what the AI (Claude, or Gemini as fallback) returned, and builds the
// "old value -> new value" list. The AI itself runs in the Apps Script backend (the key never reaches the browser).
import { MAX_AI_MB } from './config.js';
import { compressImage } from './util.js';
import { toIsoDate, thaiPhone, thaiId, money, latinDigits, beToCe } from './validate.js';
import { yearLooksWrong } from './dates.js';

/** Customer fields, grouped for the forms. */
export const FIELD_GROUPS = {
  customer: ['name', 'nick', 'nameEn', 'phone', 'idNo', 'dob', 'address'],
  vehicle: ['brand', 'model', 'year', 'color', 'plate', 'province', 'vin', 'engineNo'],
  policy: ['insurer', 'policyNo', 'policyType', 'coverage', 'premium', 'contractDate', 'policyStart', 'policyExpiry'],
};
export const ALL_FIELDS = [...FIELD_GROUPS.customer, ...FIELD_GROUPS.vehicle, ...FIELD_GROUPS.policy];
export const DATE_FIELDS = new Set(['dob', 'contractDate', 'policyStart', 'policyExpiry']);

/** Which customer fields a document type may change */
const UPDATES = {
  policy: ALL_FIELDS,
  registration: ['name', 'brand', 'model', 'year', 'color', 'plate', 'province', 'vin', 'engineNo'],
  id_card: ['name', 'nameEn', 'idNo', 'dob', 'address'],
  prev: ['name', 'nameEn', 'phone', 'idNo', 'address', 'brand', 'model', 'year', 'color', 'plate', 'province', 'vin', 'engineNo'],
  receipt: [],
  other: [],
  // v4.4.1: a พ.ร.บ. never changes a customer's name (its insured is often a company, not the customer)
  prb: ['brand', 'model', 'year', 'color', 'plate', 'province', 'vin', 'engineNo', 'insurer', 'policyNo', 'policyType', 'premium', 'contractDate', 'policyStart', 'policyExpiry'],
};

/* ---------- v4.4.1 helpers ---------- */
/** "99 0895" / "99-0895" -> "99-0895" (2 digits + 4 digits); anything else unchanged */
export function normPlate(s) {
  const v = latinDigits(s).trim();
  const m = v.match(/^(\d{1,2})\s*[- ]\s*(\d{4})$/);
  return m ? `${m[1]}-${m[2]}` : v;
}
const NOT_COVERED = /ไม่คุ้มครอง|none|not covered|^\s*-\s*$/i;
const covered = v => { if (v == null || String(v).trim() === '') return null; if (NOT_COVERED.test(String(v))) return false; const m = money(v); return m == null ? null : m > 0; };
/**
 * Policy class when the document does not print one: own damage covered -> ชั้น 1; only theft/fire -> ชั้น 2;
 * neither -> ชั้น 3. A printed class always wins; a พ.ร.บ. has no class. '' = cannot tell.
 */
export function policyClass({ policyType = '', odCover = '', tfCover = '', docType = '' } = {}) {
  const p = String(policyType || '').trim();
  if (p && /ชั้น|class|^[123]\s*\+?$|พ\s*\.?\s*ร\s*\.?\s*บ/i.test(p)) return p;
  if (docType === 'prb') return 'พ.ร.บ.';
  const od = covered(odCover), tf = covered(tfCover);
  if (od === true) return 'ชั้น 1';
  if (od === false && tf === true) return 'ชั้น 2';
  if (od === false && tf === false) return 'ชั้น 3';
  return '';
}
const satang = v => Math.round(v * 100);
/** พ.ร.บ. money check: (net + stamps) x 7% = VAT (±0.01) and net + stamps + VAT = total. ok null = something missing. */
export function prbCheck({ netPremium, stamps, vat, total } = {}) {
  if ([netPremium, stamps, vat, total].some(x => x == null || !isFinite(x))) return { ok: null, vatExpected: null, totalExpected: null };
  const base = satang(netPremium) + satang(stamps);
  const vatS = Math.round(base * 0.07), sum = base + satang(vat);
  return { ok: Math.abs(satang(vat) - vatS) <= 1 && Math.abs(sum - satang(total)) <= 1, vatExpected: vatS / 100, totalExpected: sum / 100 };
}
const PRB_TEXT = ['companyCode', 'receiptNo', 'vehicleCode', 'cc', 'seats', 'weight', 'periodTime', 'brokerName', 'brokerLicense'];
const PRB_DIGITS = ['prbNo', 'barcode', 'taxId'];
const PRB_MONEY = ['netPremium', 'discount', 'stamps', 'vat', 'total'];

const b64 = blob => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1] || '');
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});

/** Compresses photos and turns files into { mime, data } for the backend. Throws { key } on problems. */
export async function prepare(files) {
  const out = [];
  let total = 0;
  for (const f of files) {
    const isImg = /^image\/(jpeg|png|webp|heic|heif)$/i.test(f.type), isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
    if (!isImg && !isPdf) continue;
    // AI copy only (the saved file is compressed separately): long side 1600 px, JPEG 0.8, so 2 photos stay well under 1 MB
    const blob = isImg ? await compressImage(f, 1600, 0.8, 300 * 1024) : f;
    total += blob.size;
    if (total > MAX_AI_MB * 1048576) throw Object.assign(new Error('ai.tooBig'), { key: 'ai.tooBig' });
    out.push({ mime: isPdf ? 'application/pdf' : (blob.type || 'image/jpeg').toLowerCase(), data: await b64(blob) });
  }
  if (!out.length) throw Object.assign(new Error('ai.noReadable'), { key: 'ai.noReadable' });
  return out;
}

/**
 * Cleans the AI answer into customer fields. Values that fail a check are kept but marked with low confidence
 * so the review screen highlights them. Empty stays empty: nothing is filled in by the code.
 */
export function normalize(r) {
  const F = r?.fields || {}, values = {}, conf = {}, notes = {};
  const get = k => { const x = F[k]; const v = x && x.value != null ? String(x.value).trim() : ''; return [v, x ? +x.confidence || 0 : 0]; };
  const put = (k, v, c, bad) => { if (!v) return; values[k] = v; conf[k] = bad ? Math.min(c, 0.4) : c; if (bad) notes[k] = bad; };

  let [th, cth] = get('nameTh'), [en, cen] = get('nameEn');
  if (th) put('name', th, cth); else if (en) put('name', en, cen);
  if (th && en) put('nameEn', en, cen);
  let [v, c] = get('phone'); if (v) { const p = thaiPhone(v); put('phone', p || latinDigits(v), c, p ? '' : 'v.phone'); }
  [v, c] = get('idNo'); if (v) { const d = latinDigits(v).replace(/[\s-]/g, ''); const bad = /^\d{13}$/.test(d) ? (thaiId(d) ? '' : 'v.idSum') : ''; put('idNo', /^\d{13}$/.test(d) ? d : v, c, bad); }
  for (const k of ['address', 'brand', 'model', 'color', 'plate', 'province', 'vin', 'engineNo', 'insurer', 'policyNo', 'policyType']) { [v, c] = get(k); put(k, latinDigits(v), c); }
  // v4.4.1: plate as NN-NNNN; a two-line chassis cell = VIN + engine number; never the engine number as VIN
  if (values.plate) values.plate = normPlate(values.plate);
  if (values.vin) {
    const parts = values.vin.split(/\s+/).filter(Boolean);
    if (parts.length === 2 && parts.every(x => x.length >= 8) && !values.engineNo) { values.vin = parts[0]; put('engineNo', parts[1], conf.vin); notes.engineNo = 'v.split'; }
    const key = x => String(x || '').replace(/[\s.\-]/g, '').toUpperCase();
    if (values.engineNo && key(values.vin) === key(values.engineNo)) { delete values.vin; delete conf.vin; notes.vin = 'v.vinEngine'; }
  }
  [v, c] = get('year'); if (v) { const y = +(latinDigits(v).match(/\d{4}/) || [])[0]; put('year', y ? String(beToCe(y)) : v, c, y ? '' : 'v.year'); }
  for (const k of ['coverage', 'premium']) { [v, c] = get(k); if (v) { const m = money(v); put(k, m != null ? String(m) : v, c, m != null ? '' : 'v.money'); } }
  for (const k of ['dob', 'contractDate', 'policyStart', 'policyExpiry']) { [v, c] = get(k); if (v) { const d = toIsoDate(v); if (d) put(k, d, c); else notes[k] = 'v.date'; } }
  if (yearLooksWrong(values.policyStart, values.policyExpiry)) { conf.policyExpiry = Math.min(conf.policyExpiry, 0.4); notes.policyExpiry = 'v.order'; }

  // v4: who is insured (to find the customer) and the body type of the vehicle
  [v, c] = get('insuredName'); put('insuredName', v, c);
  [v, c] = get('bodyType'); put('body', v, c);

  // v4.4.1: vehicle value, policy class rule, พ.ร.บ. details
  [v, c] = get('carValue'); if (v) { const m = money(v); put('carValue', m != null ? String(m) : v, c, m != null ? '' : 'v.money'); }
  const docType = r?.docType || 'other';
  if (docType === 'prb') { values.policyType = 'พ.ร.บ.'; conf.policyType = Math.max(conf.policyType || 0, 0.9); }
  else if (!values.policyType) {
    const cls = policyClass({ odCover: get('odCover')[0], tfCover: get('tfCover')[0] });
    if (cls) { values.policyType = cls; conf.policyType = 0.7; notes.policyType = 'v.classRule'; }
  }
  const prb = {};
  for (const k of PRB_TEXT) { [v] = get(k); if (v) prb[k] = latinDigits(v); }
  for (const k of PRB_DIGITS) { [v] = get(k); const d = latinDigits(v).replace(/\D/g, ''); if (d) prb[k] = d; }
  for (const k of PRB_MONEY) { [v] = get(k); const m = v ? money(v) : null; if (m != null) prb[k] = m; }
  [v] = get('issueDate'); if (v) { const d = toIsoDate(v); if (d) prb.issueDate = d; }
  prb.check = prbCheck(prb);

  const receipt = {};
  [v, c] = get('receiptAmount'); if (v) receipt.amount = money(v);
  [v, c] = get('receiptDate'); if (v) receipt.date = toIsoDate(v);
  [v, c] = get('payer'); if (v) receipt.payer = v;
  return { docType, docName: String(r?.docName || '').trim(), slot: String(r?.slot || ''), values, conf, notes, receipt, prb };
}

/** Folder the AI suggests for this document (the user always confirms). null = no suggestion. */
export function suggestFolder(n, customer) {
  const today = new Date().toISOString().slice(0, 10);
  switch (n.docType) {
    case 'prb': return 'policy';
    case 'policy': {
      const end = n.values.policyExpiry;
      if (end && (end < today || (customer?.policyExpiry && end < customer.policyExpiry))) return 'prev';
      return 'policy';
    }
    case 'registration': case 'id_card': return 'docs';
    case 'receipt': return 'pay';
    default: return null;
  }
}

/** "old -> new" list for an existing customer. Only fields that the document type may change, and only real changes. */
export function diff(customer, n, folder) {
  const allowed = folder === 'prev' ? UPDATES.prev : folder === 'pay' ? UPDATES.receipt : UPDATES[n.docType] || [];
  const out = [];
  for (const k of allowed) {
    const nv = n.values[k];
    if (!nv) continue;
    const ov = String(customer?.[k] || '');
    if (ov.trim().toLowerCase() === nv.trim().toLowerCase()) continue;
    out.push({ key: k, old: ov, new: nv, conf: n.conf[k] ?? 0, note: n.notes[k] || '', on: !ov || (n.conf[k] ?? 0) >= 0.75 });
  }
  return out;
}

/** Short note saved with the file (e.g. receipt amount, previous policy dates) */
export function fileNote(n, folder) {
  if (folder === 'pay' && (n.receipt.amount || n.receipt.date || n.receipt.payer)) {
    return [n.receipt.amount != null ? `฿${n.receipt.amount}` : '', n.receipt.date || '', n.receipt.payer || ''].filter(Boolean).join(' · ');
  }
  if (folder === 'prev') {
    const v = n.values;
    return [v.insurer, v.policyNo, v.policyStart && v.policyExpiry ? `${v.policyStart} – ${v.policyExpiry}` : v.policyExpiry || ''].filter(Boolean).join(' · ');
  }
  return '';
}
