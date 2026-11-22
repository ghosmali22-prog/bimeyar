// v4.5.0: พ.ร.บ. (compulsory motor insurance) pure helpers — fields, status, sorting, satang totals, naming, AI mapping, duplicates.
// Pure ES module (no DOM). Shared contract with backend/PRB.md.
import { isoToday, daysBetween } from './dates.js';
import { monthOf, buildName, plateOnly } from './naming.js';
import { prbCheck } from './ai.js';
import { money } from './validate.js';

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

/** Maps the object returned by normalize() in js/ai.js into { insured, row } with string values. */
export function rowFromAi(n) {
  const v = n?.values || {}, p = n?.prb || {};
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
      cc: str(p.cc),
      seats: str(p.seats),
      weight: str(p.weight),
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
