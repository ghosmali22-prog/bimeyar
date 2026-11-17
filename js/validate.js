// Checks and clean-up for data typed in or read by the AI.
// Dates are always stored as ISO (YYYY-MM-DD, Gregorian / CE).

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙', FA = '۰۱۲۳۴۵۶۷۸۹', AR = '٠١٢٣٤٥٦٧٨٩';
/** Thai, Persian and Arabic digits -> 0-9 */
export const latinDigits = s => String(s ?? '').replace(/[๐-๙۰-۹٠-٩]/g, d => {
  for (const set of [THAI_DIGITS, FA, AR]) { const i = set.indexOf(d); if (i >= 0) return String(i); }
  return d;
});

const pad = n => String(n).padStart(2, '0');

/** Buddhist Era -> Common Era. Years 2400+ are treated as BE (2569 BE = 2026 CE). */
export const beToCe = y => (y >= 2400 ? y - 543 : y);

/** true when y-m-d is a real calendar date */
export function realDate(y, m, d) {
  const x = new Date(Date.UTC(y, m - 1, d));
  return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d;
}

/**
 * Reads a date in many shapes and returns ISO (CE) or null:
 * 2026-03-01, 2569-03-01 (BE), 01/03/2569, 1.3.2026, 1-3-26 (2-digit years: <=50 -> 20xx CE, else 25xx BE).
 */
export function toIsoDate(v) {
  if (v == null) return null;
  const s = latinDigits(v).trim();
  if (!s) return null;
  let y, m, d, x;
  if ((x = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) [y, m, d] = [+x[1], +x[2], +x[3]];
  else if ((x = s.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2,4})$/))) {
    [d, m, y] = [+x[1], +x[2], +x[3]];
    if (x[3].length === 2) y = y <= 50 ? 2000 + y : 2500 + y;
  } else return null;
  y = beToCe(y);
  if (y < 1900 || y > 2200 || !realDate(y, m, d)) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Thai phone: returns 0XXXXXXXX(X) or null. Accepts +66 / 66 prefixes, spaces and dashes. */
export function thaiPhone(v) {
  let s = latinDigits(v).replace(/[\s\-().]/g, '');
  if (!s) return null;
  if (s.startsWith('+66')) s = '0' + s.slice(3);
  else if (/^66\d{8,9}$/.test(s)) s = '0' + s.slice(2);
  return /^0\d{8,9}$/.test(s) ? s : null;
}

/** Thai national ID: 13 digits with a valid checksum. Returns the 13 digits or null. */
export function thaiId(v) {
  const s = latinDigits(v).replace(/[\s-]/g, '');
  if (!/^\d{13}$/.test(s)) return null;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += +s[i] * (13 - i);
  return (11 - (sum % 11)) % 10 === +s[12] ? s : null;
}

/** Money text -> number with 2 decimals, or null. "1,234.5 บาท" -> 1234.5 */
export function money(v) {
  if (v == null || v === '') return null;
  const s = latinDigits(v).replace(/[,\s฿]|บาท|THB|baht/gi, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Math.round(parseFloat(s) * 100) / 100;
}

/**
 * Checks a customer record. Returns { errors: {field: key}, warnings: {field: key} }.
 * errors block saving; warnings are only shown.
 */
export function checkCustomer(c) {
  const errors = {}, warnings = {};
  if (!String(c.name || '').trim()) errors.name = 'v.required';
  if (c.phone && !thaiPhone(c.phone)) warnings.phone = 'v.phone';
  if (c.idNo) {
    const digits = latinDigits(c.idNo).replace(/[\s-]/g, '');
    if (/^\d{13}$/.test(digits) && !thaiId(digits)) errors.idNo = 'v.idSum';
  }
  for (const k of ['dob', 'policyStart', 'policyExpiry']) if (c[k] && !/^\d{4}-\d{2}-\d{2}$/.test(c[k])) errors[k] = 'v.date';
  if (c.policyStart && c.policyExpiry && c.policyExpiry <= c.policyStart) errors.policyExpiry = 'v.order';
  if (c.year && !/^\d{4}$/.test(c.year)) warnings.year = 'v.year';
  return { errors, warnings };
}

/** For duplicate checks */
export const normPlate = s => latinDigits(s).replace(/[\s\-.]/g, '').toLowerCase();
export const normPhone = s => thaiPhone(s) || latinDigits(s).replace(/\D/g, '');
export const normId = s => latinDigits(s).replace(/[\s-]/g, '');

/** Customers that share phone, ID number or plate with `c` (ignoring `c` itself) */
export function findDuplicates(c, customers) {
  const out = [];
  for (const x of customers) {
    if (c.id && x.id === c.id) continue;
    const why = [];
    if (c.phone && x.phone && normPhone(c.phone) === normPhone(x.phone) && normPhone(c.phone).length >= 9) why.push('phone');
    if (c.idNo && x.idNo && normId(c.idNo) === normId(x.idNo)) why.push('idNo');
    if (c.plate && x.plate && normPlate(c.plate) === normPlate(x.plate) && normPlate(c.plate).length >= 3 && (!c.province || !x.province || c.province === x.province)) why.push('plate');
    if (why.length) out.push({ customer: x, why });
  }
  return out;
}
