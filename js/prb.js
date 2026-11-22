// v4.5.0: พ.ร.บ. (compulsory motor insurance) pure helpers — fields, status, sorting, satang totals, naming, AI mapping, duplicates.
// Pure ES module (no DOM). Shared contract with backend/PRB.md.
import { isoToday, daysBetween, parseDate } from './dates.js';
import { monthOf, buildName, plateOnly } from './naming.js';
import { prbCheck } from './ai.js';
import { money, latinDigits } from './validate.js';

/** Row field names in the exact order of backend/PRB.md */
export const PRB_FIELDS = [
  'prbNo', 'barcode', 'plate', 'province', 'brand', 'model', 'body', 'vin', 'engineNo',
  'vehicleCode', 'cc', 'seats', 'weight', 'companyCode', 'insurer', 'policyNo', 'receiptNo',
  'contractDate', 'issueDate', 'start', 'end', 'periodTime',
  'netPremium', 'discount', 'stamps', 'vat', 'total',
  'brokerName', 'brokerLicense', 'note',
];

/** 'active' | 'soon' (<= 30 days) | 'expired' (< 0 days) | 'none' (no valid end date) */
export function prbStatus(row, today = isoToday()) {
  const end = row?.end;
  if (!end) return 'none';
  const d = daysBetween(today, end);
  if (!isFinite(d)) return 'none';
  return d < 0 ? 'expired' : d <= 30 ? 'soon' : 'active';
}

/** New array sorted by prbNo as a number ascending (rows without prbNo last, then by plate, then createdAt). */
export function sortRows(rows) {
  return [...(rows || [])].sort((a, b) => {
    const sA = String(a?.prbNo ?? '').trim(), sB = String(b?.prbNo ?? '').trim();
    const nA = sA && isFinite(+sA) ? +sA : Infinity;
    const nB = sB && isFinite(+sB) ? +sB : Infinity;
    if (nA !== nB) return nA - nB;
    if (sA !== sB) return sA.localeCompare(sB);
    const p = String(a?.plate || '').localeCompare(String(b?.plate || ''));
    if (p) return p;
    return String(a?.createdAt || '').localeCompare(String(b?.createdAt || ''));
  });
}

const toSatang = v => {
  if (v == null) return null;
  const s = String(v).replace(/[,\s฿]/g, '');
  if (!s) return null;
  const n = Number(s);
  return isFinite(n) ? Math.round(n * 100) : null;
};

/**
 * Exact mirror of backend prbTotals (integer satang):
 * per line net = netPremium, stamps, vat, total = total if given (non-empty, finite) else net + stamps + vat.
 * Returns { lines: [{ net, stamps, vat, total }], net, stamps, vat, total } in baht numbers.
 */
export function prbTotals(lines) {
  let sumNet = 0, sumStamps = 0, sumVat = 0, sumTotal = 0;
  const out = (lines || []).map(r => {
    const rawNet = r?.netPremium !== undefined && r?.netPremium !== '' ? r.netPremium : r?.net;
    const net = toSatang(rawNet) ?? 0;
    const stamps = toSatang(r?.stamps) ?? 0;
    const vat = toSatang(r?.vat) ?? 0;
    const given = toSatang(r?.total);
    const total = given != null ? given : net + stamps + vat;
    sumNet += net; sumStamps += stamps; sumVat += vat; sumTotal += total;
    return { net: net / 100, stamps: stamps / 100, vat: vat / 100, total: total / 100 };
  });
  return { lines: out, net: sumNet / 100, stamps: sumStamps / 100, vat: sumVat / 100, total: sumTotal / 100 };
}

/** Reuses prbCheck from js/ai.js mapping netPremium/stamps/vat/total to numbers. */
export function vatCheck(row) {
  return prbCheck({
    netPremium: money(row?.netPremium),
    stamps: money(row?.stamps),
    vat: money(row?.vat),
    total: money(row?.total),
  });
}

/** Month 1-12 of contractDate, else issueDate, else start, else current month. */
export const prbMonth = row => monthOf(row?.contractDate, row?.issueDate, row?.start);

/** Standard พ.ร.บ. file name via buildName from js/naming.js. */
export function prbFileName(row, insuredName, ext = '') {
  return buildName({
    plate: plateOnly(row?.plate, row?.province),
    customer: { name: insuredName },
    month: prbMonth(row),
    doc: 'พ.ร.บ.',
    ext,
  });
}

const str = v => (v == null ? '' : String(v).trim());
const moneyStr = v => { const m = money(v); return m != null ? String(m) : ''; };

/** Splits "0/3/15" (also with spaces, Thai digits, decimals like "2.5") into { cc, seats, weight }, else null. */
export function splitCSW(s) {
  if (s == null) return null;
  const p = latinDigits(s).trim().split(/\s*\/\s*/);
  return p.length === 3 && p.every(x => /^\d+(?:\.\d+)?$/.test(x)) ? { cc: p[0], seats: p[1], weight: p[2] } : null;
}

/** Maps the object returned by normalize() in js/ai.js into { insured, row } with string values. */
export function rowFromAi(n) {
  const v = n?.values || {}, p = n?.prb || {};
  const csw = str(p.cc).includes('/') ? splitCSW(p.cc) : null;
  return {
    insured: {
      name: str(v.insuredName || v.name),
      taxId: str(p.taxId),
      address: str(v.address),
    },
    row: {
      prbNo: str(p.prbNo),
      barcode: str(p.barcode),
      plate: str(v.plate),
      province: str(v.province),
      brand: str(v.brand),
      model: str(v.model),
      body: str(v.body),
      vin: str(v.vin),
      engineNo: str(v.engineNo),
      vehicleCode: str(p.vehicleCode),
      cc: csw ? csw.cc : str(p.cc),
      seats: csw ? csw.seats : str(p.seats),
      weight: csw ? csw.weight : str(p.weight),
      companyCode: str(p.companyCode),
      insurer: str(v.insurer),
      policyNo: str(v.policyNo),
      receiptNo: str(p.receiptNo),
      contractDate: str(v.contractDate),
      issueDate: str(p.issueDate),
      start: str(v.policyStart),
      end: str(v.policyExpiry),
      periodTime: str(p.periodTime),
      netPremium: moneyStr(p.netPremium),
      discount: moneyStr(p.discount),
      stamps: moneyStr(p.stamps),
      vat: moneyStr(p.vat),
      total: moneyStr(p.total ?? v.premium),
      brokerName: str(p.brokerName),
      brokerLicense: str(p.brokerLicense),
    },
  };
}

/** True when n is a พ.ร.บ. document. */
export function isPrbDoc(n) {
  if (!n) return false;
  return n.docType === 'prb' || /พ\.?ร\.?บ/.test(String(n.values?.policyType || '')) || (n.slot === '3' && !!n.prb?.prbNo);
}

/** Returns the existing row with the same non-empty prbNo or barcode (ignoring exceptId), else null. */
export function findDup(row, rows, exceptId) {
  if (!row || !rows) return null;
  const no = str(row.prbNo), bc = str(row.barcode);
  if (!no && !bc) return null;
  for (const r of rows) {
    if (!r || (exceptId && r.id === exceptId)) continue;
    if (no && str(r.prbNo) === no) return r;
    if (bc && str(r.barcode) === bc) return r;
  }
  return null;
}

const INSURED_WORDS = ['ห้างหุ้นส่วนจำกัด', '(มหาชน)', 'มหาชน', 'บริษัท', 'จำกัด', 'หจก', 'บจก'];

/** Normalised key for comparing insured names (company words, punctuation and spaces stripped). */
export function insuredKey(name) {
  let s = latinDigits(name).toLowerCase();
  for (const w of INSURED_WORDS) s = s.split(w).join(' ');
  s = s.replace(/\b(?:limited|ltd\.?|co\.?),?/g, ' ');
  return s.replace(/[\s.()[\]/\-]/g, '');
}

function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[n];
}

const insuredParts = s => String(s ?? '').split(/[\/()]/).map(insuredKey).filter(k => k.length >= 6);

function insuredScore(a, b) {
  const ka = insuredKey(a), kb = insuredKey(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 1;
  const ratio = 1 - lev(ka, kb) / Math.max(ka.length, kb.length);
  const pa = insuredParts(a), pb = insuredParts(b);
  return pa.some(x => pb.includes(x)) ? Math.max(ratio, 0.85) : ratio;
}

/** True when insuredKey equal, any '/'- or '()'-part key of length >= 6 matches, or Levenshtein ratio >= 0.8. */
export function sameInsured(a, b) {
  return insuredScore(a, b) >= 0.8;
}

const cleanInsName = s => str(s).replace(/\s+/g, ' ');

/** Existing insured [{id,name}] matching name via sameInsured, best first, as [{ id, name, exact }]. */
export function suggestInsured(name, insured) {
  const q = cleanInsName(name), qk = insuredKey(q);
  if (!qk) return [];
  return (insured || [])
    .filter(x => x && x.name && sameInsured(q, x.name))
    .map(x => {
      const exact = cleanInsName(x.name) === q;
      const score = exact ? 2 : insuredKey(x.name) === qk ? 1.5 : insuredScore(q, x.name);
      return { id: x.id, name: x.name, exact, score };
    })
    .sort((a, b) => b.score - a.score)
    .map(({ id, name: n, exact }) => ({ id, name: n, exact }));
}

/** Groups (arrays of indexes, size >= 2) of names that are sameInsured but not identical strings. */
export function groupInsured(names) {
  const list = (names || []).map(cleanInsName);
  const used = new Uint8Array(list.length);
  const groups = [];
  for (let i = 0; i < list.length; i++) {
    if (used[i] || !insuredKey(list[i])) continue;
    const g = [i];
    used[i] = 1;
    for (let k = 0; k < g.length; k++) {
      const u = g[k];
      for (let j = i + 1; j < list.length; j++) {
        if (!used[j] && insuredKey(list[j]) && sameInsured(list[u], list[j])) {
          used[j] = 1;
          g.push(j);
        }
      }
    }
    g.sort((a, b) => a - b);
    if (g.length >= 2 && new Set(g.map(idx => list[idx])).size >= 2) groups.push(g);
  }
  return groups;
}

const vinNorm = s => latinDigits(s).replace(/\s+/g, '').toUpperCase();
const plateNorm = (p, prov) => latinDigits(plateOnly(p, prov)).replace(/[\s.\-]/g, '').toLowerCase();

/**
 * Sanity check for a พ.ร.บ. row before saving.
 * Returns { errors: [{ field, key, x }], warns: [{ field, key, x }] }.
 */
export function prbSanity(row, ctx = {}) {
  const r = row || {}, errors = [], warns = [];
  if (!str(ctx.insuredName)) errors.push({ field: 'insuredName', key: 'prb.chk.name', x: '' });

  const exceptId = ctx.exceptId || r.id;
  const batchRows = [];
  (ctx.batch || []).forEach((b, i) => {
    if (ctx.selfIndex != null ? i === ctx.selfIndex : (b === r || b?.row === r)) return;
    const br = b?.row || b;
    if (br) batchRows.push({ ...br, name: str(br.name || b?.name || b?.file?.name || b?.source?.name) });
  });
  const dup = findDup(r, ctx.rows, exceptId) || findDup(r, batchRows);
  if (dup) {
    const field = str(r.prbNo) && str(dup.prbNo) === str(r.prbNo) ? 'prbNo' : 'barcode';
    errors.push({ field, key: 'prb.chk.dup', x: str(dup.name) || str(dup.plate) });
  }

  for (const k of ['contractDate', 'issueDate', 'start', 'end']) {
    if (str(r[k]) && !parseDate(r[k])) errors.push({ field: k, key: 'prb.chk.date', x: k });
  }

  const prbNo = latinDigits(r.prbNo).replace(/\D/g, '');
  const policyNo = latinDigits(r.policyNo).trim();
  if (prbNo && policyNo) {
    const lastDigits = (policyNo.split('/').pop() || '').replace(/\D/g, '');
    if (prbNo !== lastDigits) warns.push({ field: 'policyNo', key: 'prb.chk.policyNo', x: policyNo });
  }

  const isVib = str(r.companyCode).toUpperCase() === 'VIB' || /วิริยะ|viriyah/i.test(str(r.insurer));
  const recDigits = latinDigits(r.receiptNo).replace(/\D/g, '');
  if (isVib && prbNo && recDigits && recDigits !== prbNo) {
    warns.push({ field: 'receiptNo', key: 'prb.chk.receipt', x: str(r.receiptNo) });
  }

  const barcode = latinDigits(r.barcode).replace(/\D/g, '');
  if (barcode && prbNo && !barcode.includes(prbNo)) {
    warns.push({ field: 'barcode', key: 'prb.chk.barcode', x: barcode });
  }

  const vc = vatCheck(r);
  if (vc.ok === false) {
    // the total it SHOULD be: net + stamps + the expected VAT (integer satang)
    const sat = v => Math.round((money(v) || 0) * 100);
    warns.push({ field: 'vat', key: 'prb.chk.vat', x: { v: vc.vatExpected, t: (sat(r.netPremium) + sat(r.stamps) + Math.round(vc.vatExpected * 100)) / 100 } });
  }

  const myVin = vinNorm(r.vin), myPlate = plateNorm(r.plate, r.province);
  if (myVin || myPlate) {
    const others = [...(ctx.rows || []).filter(o => o && (!exceptId || o.id !== exceptId)), ...batchRows];
    for (const o of others) {
      const oVin = vinNorm(o.vin), oPlate = plateNorm(o.plate, o.province);
      if (myVin && oVin === myVin && myPlate !== oPlate) {
        warns.push({ field: 'vin', key: 'prb.chk.plateVin', x: str(o.plate) || str(o.vin) });
        break;
      }
      if (myPlate && oPlate === myPlate && myVin && oVin && myVin !== oVin) {
        warns.push({ field: 'plate', key: 'prb.chk.plateVin', x: str(o.vin) || str(o.plate) });
        break;
      }
    }
  }

  const startIso = parseDate(r.start), endIso = parseDate(r.end);
  if (startIso && endIso && endIso <= startIso) {
    warns.push({ field: 'end', key: 'prb.chk.period', x: endIso });
  }

  return { errors, warns };
}

/* ---------- v4.5.2: reading accuracy (code post-processing of the AI answer) ---------- */
/** Two-letter codes that are misreads of "กธ" on Viriyah policy numbers */
export const THAI_NEAR = new Set(['ซ', 'ษ', 'ช', 'ฐ', 'ร', 'ฮ', 'ท', 'ถ', 'ฒ'].map(x => 'ก' + x));
export const isViriyah = row => String(row?.companyCode || '').trim().toUpperCase() === 'VIB' || /วิริยะ|viriyah/i.test(String(row?.insurer || ''));
const digitsOf = s => latinDigits(String(s ?? '')).replace(/\D/g, '');
/** "AAAAA BBBBB/XX/NNNN" or "BBBBB/XX/NNNN" -> parts; null for any other shape */
export function parsePolicyNo(s) {
  const m = latinDigits(String(s ?? '')).trim().match(/^(?:(\d{5})\s*)?(\d{5})\s*\/\s*([ก-ฮ]{2})\s*\/\s*(\d+)$/);
  return m ? { a: m[1] || '', b: m[2], code: m[3], no: m[4] } : null;
}
const fmtPolicy = p => `${p.a ? p.a + ' ' : ''}${p.b}/${p.code}/${p.no}`;
/** Viriyah: a near-miss of กธ (กซ, กษ, กช, กฐ…) is corrected; { value, fixed, was } */
export function fixPolicyNo(row) {
  const was = String(row?.policyNo ?? ''), p = isViriyah(row) ? parsePolicyNo(was) : null;
  if (!p || !THAI_NEAR.has(p.code)) return { value: was, fixed: false, was };
  return { value: fmtPolicy({ ...p, code: 'กธ' }), fixed: true, was };
}
/** The most common full prefix "AAAAA BBBBB/กธ/" (both groups) among Viriyah rows; '' when none */
export function policyConsensus(rows) {
  const count = {};
  for (const r of rows || []) {
    if (!isViriyah(r)) continue;
    const p = parsePolicyNo(fixPolicyNo(r).value);
    if (p && p.a && p.code === 'กธ') { const k = `${p.a} ${p.b}/กธ/`; count[k] = (count[k] || 0) + 1; }
  }
  return Object.entries(count).sort((x, y) => y[1] - x[1])[0]?.[0] || '';
}
/** A full policy number to OFFER (never applied by itself): missing first group, a barcode, or not ending with the PRB number */
/** v4.5.3: Viriyah branch number of a policy code part, used when the AI dropped the first group */
export const VIB_BRANCH = { 69100: '00283' };
export function suggestPolicyNo(row, peers, hint = {}) {
  const no = digitsOf(row?.prbNo), cur = String(row?.policyNo ?? '').trim(), p = parsePolicyNo(cur);
  // prefix: batch consensus, else the branch number the AI read under VIB, else the known branch of this code part
  const branch = digitsOf(hint.branchCode).length === 5 ? digitsOf(hint.branchCode) : p && VIB_BRANCH[p.b] || '';
  const pre = policyConsensus(peers) || (p && !p.a && branch ? `${branch} ${p.b}/กธ/` : '');
  if (!no || !pre || !isViriyah(row)) return null;
  const value = pre + no;
  let why = '';
  if (/^\d{13}$/.test(digitsOf(cur)) && !/\//.test(cur)) why = 'barcode';
  else if (p && !p.a && pre.includes(' ' + p.b + '/')) why = 'prefix';
  else if (!digitsOf(cur).endsWith(no)) why = 'noPrb';
  return why && value !== cur ? { value, why } : null;
}
/** The majority spelling of a name in one batch when this one differs by 1-4 characters (or only in spacing) */
export function majorityName(names, i) {
  const me = String(names?.[i] ?? '').trim(); if (!me) return '';
  const count = {};
  for (const n of names) { const k = String(n ?? '').trim(); if (k) count[k] = (count[k] || 0) + 1; }
  const best = Object.entries(count).filter(([k, c]) => k !== me && c >= 2 && c > (count[me] || 0)).sort((a, b) => b[1] - a[1]);
  for (const [k] of best) {
    const d = lev(me, k);
    if ((d >= 1 && d <= 4) || me.replace(/\s+/g, '') === k.replace(/\s+/g, '')) return k;
  }
  return '';
}
/* v4.5.3: names are compared by their sub-parts too (split on "/", "(", ")" and "โดย"), across all rows of the batch
   and the insured names already saved, so a misread or cut part ("หจก.เพ") gets the spelling used elsewhere */
const SUB_SPLIT = /(\s*\/\s*|\s*\(\s*|\s*\)\s*|\s+โดย\s+)/;
const subParts = name => String(name ?? '').split(SUB_SPLIT);
const isSep = (x, k) => k % 2 === 1;
function subNear(p, q) {
  if (!p || !q || p === q) return false;
  if (p.replace(/\s+/g, '') === q.replace(/\s+/g, '')) return true;
  const d = lev(p, q);
  // a few misread letters, relative to the length ("หจก.เอ" ~ "หจก.เค"; never two short different names)
  if (d >= 1 && d <= Math.min(4, Math.max(1, Math.floor(Math.min(p.length, q.length) * 0.15))) && Math.min(p.length, q.length) >= 5) return true;
  // a cut or misread start of the same part: "หจก.เพ" ~ "หจก.เค พี พี เอส ..."
  return p.length >= 5 && p.length < q.length && lev(p, q.slice(0, p.length)) <= 1;
}
export function consensusName(names, i, existing = []) {
  const whole = majorityName(names, i);
  if (whole) return whole;
  const me = String(names?.[i] ?? '').trim(); if (!me) return '';
  const count = {};
  const add = (n, w) => subParts(n).forEach((x, k) => { const v = x.trim(); if (!isSep(x, k) && v) count[v] = (count[v] || 0) + w; });
  (names || []).forEach(n => add(n, 1));
  (existing || []).forEach(n => add(n, 2));   // a name already saved in Drive counts more
  const parts = subParts(me);
  let changed = false;
  const out = parts.map((x, k) => {
    const v = x.trim(); if (isSep(x, k) || !v) return x;
    const best = Object.entries(count).filter(([q, c]) => q !== v && c >= 2 && c > (count[v] || 0) && subNear(v, q)).sort((a, b) => b[1] - a[1])[0];
    if (!best) return x;
    changed = true; return x.replace(v, best[0]);
  });
  return changed ? out.join('') : '';
}
/**
 * One batch after the AI: fixes กธ IN PLACE (recorded in auto) and returns suggestions to accept with one click
 * (full policy number from the batch consensus, majority insured spelling). Nothing else is changed.
 * items = [{ row, insured }] -> [{ auto: { policyNo?: was }, suggest: { policyNo?: { value, why }, insuredName?: value } }]
 */
export function prbPost(items) {
  const out = (items || []).map(() => ({ auto: {}, suggest: {} }));
  (items || []).forEach((it, i) => {
    const f = fixPolicyNo(it.row || {});
    if (f.fixed) { it.row.policyNo = f.value; out[i].auto.policyNo = f.was; }
  });
  const rows = (items || []).map(it => it.row || {}), names = (items || []).map(it => it.insured?.name || '');
  (items || []).forEach((it, i) => {
    const s = suggestPolicyNo(it.row || {}, rows.filter((_, j) => j !== i));
    if (s) out[i].suggest.policyNo = s;
    const m = majorityName(names, i);
    if (m) out[i].suggest.insuredName = m;
  });
  return out;
}
