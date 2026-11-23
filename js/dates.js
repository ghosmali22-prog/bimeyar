// v4.4.1: the ONE date helper of the app (parse / compare / format, Buddhist Era <-> Common Era).
// Dates are stored as ISO YYYY-MM-DD in CE. Years 2400+ are Buddhist (2569 BE = 2026 CE).
// Pure module (no DOM, no imports) so the tests and every other module can use it.

const SETS = ['๐๑๒๓๔๕๖๗๘๙', '۰۱۲۳۴۵۶۷۸۹', '٠١٢٣٤٥٦٧٨٩'];
const latin = s => String(s ?? '').replace(/[๐-๙۰-۹٠-٩]/g, d => { for (const set of SETS) { const i = set.indexOf(d); if (i >= 0) return String(i); } return d; });
const pad = n => String(n).padStart(2, '0');

/** Buddhist Era -> Common Era. Years 2400+ are treated as BE. */
export const beToCe = y => (y >= 2400 ? y - 543 : y);
/** Common Era -> Buddhist Era (years already 2400+ stay). */
export const ceToBe = y => (y >= 2400 ? y : y + 543);

/** true when y-m-d is a real calendar date */
export function realDate(y, m, d) {
  const x = new Date(Date.UTC(y, m - 1, d));
  return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d;
}

/**
 * Reads a date in many shapes and returns ISO (CE) or null:
 * 2026-03-01, 2569-03-01 (BE), 01/03/2569, 1.3.2026, 1-3-26 (2-digit years: <=50 -> 20xx CE, else 25xx BE).
 * A time after the date ("16.30", "16:30 น.") is ignored.
 */
export function parseDate(v) {
  if (v == null) return null;
  let s = latin(v).trim();
  if (!s) return null;
  s = s.replace(/[\sT]+(?:เวลา\s*)?\d{1,2}[.:]\d{2}(?:[.:]\d{2})?(?:\s*(?:น\.?|นาฬิกา|hrs?\.?))?\s*$/i, '').trim();
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

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const noon = iso => new Date(String(iso).slice(0, 10) + 'T12:00:00');
/** today as local ISO */
export function isoToday() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
/** whole days from a to b (b - a), local noon so summer time never shifts a day. NaN if invalid. */
export function daysBetween(a, b) {
  if (!ISO.test(String(a).slice(0, 10)) || !ISO.test(String(b).slice(0, 10))) return NaN;
  return Math.round((noon(b) - noon(a)) / 864e5);
}
/** days from today to iso (negative = past) */
export function daysLeft(iso) {
  const t = new Date(); t.setHours(12, 0, 0, 0);
  const d = ISO.test(String(iso)) ? noon(iso) : new Date(iso);
  return Math.round((d - t) / 864e5);
}
export const cmpIso = (a, b) => String(a || '').slice(0, 10).localeCompare(String(b || '').slice(0, 10));
/** Calendar-day addition at local noon (including DST boundaries). */
export function addDays(iso, n) {
  const parsed = parseDate(iso);
  if (!parsed || !Number.isInteger(n)) return '';
  const d = noon(parsed);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** First day of the month, offset by whole calendar months. */
export function monthStart(iso, offset = 0) {
  const parsed = parseDate(iso);
  if (!parsed || !Number.isInteger(offset)) return '';
  const d = noon(parsed.slice(0, 7) + '-01');
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
}
export const isExpired = iso => !!iso && daysLeft(iso) < 0;

/** "19/10/2027" (era 'ce') or "19/10/2570" (era 'be'); '' when not an ISO date */
export function fmtDMY(iso, era = 'ce') {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${era === 'be' ? ceToBe(+y) : y}`;
}

/** A start/end pair that looks like a BE/CE mix-up: end not after start, or end more than 3 years later. */
export function yearLooksWrong(start, end) {
  if (!start || !end) return false;
  const n = daysBetween(start, end);
  return !isFinite(n) || n <= 0 || n > 3 * 366;
}
