import { lang, t, num, LOCALE } from './i18n.js';
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const FA = '۰۱۲۳۴۵۶۷۸۹', AR = '٠١٢٣٤٥٦٧٨٩';
export const faDigits = s => String(s).replace(/\d/g, d => FA[d]);
export const enDigits = s => String(s).replace(/[۰-۹]/g, d => FA.indexOf(d)).replace(/[٠-٩]/g, d => AR.indexOf(d));
export const digits = s => lang === 'fa' ? faDigits(s) : String(s);

/** یکسان‌سازی متن فارسی برای جستجو */
export function norm(s) {
  return enDigits(String(s || '').toLowerCase())
    .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه')
    .replace(/[‌‎‏_\-.,،؛:()\[\]\/\\]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/* ---------- تاریخ شمسی ---------- */
export const J_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const pf = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', { year: 'numeric', month: 'numeric', day: 'numeric' });

/** میلادی → [سال، ماه، روز] شمسی */
export function toJ(d) {
  const p = {};
  for (const x of pf.formatToParts(new Date(d))) p[x.type] = x.value;
  return [parseInt(p.year), parseInt(p.month), parseInt(p.day)];
}

/** شمسی → [سال، ماه، روز] میلادی */
export function j2g(jy, jm, jd) {
  jy += 1595;
  let days = -355668 + 365 * jy + Math.floor(jy / 33) * 8 + Math.floor(((jy % 33) + 3) / 4) + jd + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gy = 400 * Math.floor(days / 146097);
  days %= 146097;
  if (days > 36524) {
    gy += 100 * Math.floor(--days / 36524);
    days %= 36524;
    if (days >= 365) days++;
  }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    gy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  let gd = days + 1;
  const leap = (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0;
  const ml = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 1;
  for (; gm <= 12 && gd > ml[gm]; gm++) gd -= ml[gm];
  return [gy, gm, gd];
}

const pad = n => String(n).padStart(2, '0');
export const isoDay = d => { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/** «۱۴۰۶/۸/۲۵» → «2027-11-16» ؛ ورودی نامعتبر → null */
export function parseJ(text) {
  const m = enDigits(text || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return null;
  const [jy, jm, jd] = [+m[1], +m[2], +m[3]];
  if (jy < 1300 || jy > 1500 || jm < 1 || jm > 12 || jd < 1 || jd > 31) return null;
  const [gy, gm, gd] = j2g(jy, jm, jd);
  return `${gy}-${pad(gm)}-${pad(gd)}`;
}
const localDate = iso => /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + 'T12:00:00') : new Date(iso);

/** «۱۴۰۶/۰۸/۲۵» */
export function fmtJ(iso) {
  if (!iso) return '';
  const [y, m, d] = toJ(localDate(iso));
  return faDigits(`${y}/${pad(m)}/${pad(d)}`);
}
/** «۲۵ آبان ۱۴۰۶» */
export function jDate(iso, withYear = true) {
  if (!iso) return '';
  const [y, m, d] = toJ(localDate(iso));
  return faDigits(`${d} ${J_MONTHS[m - 1]}${withYear ? ' ' + y : ''}`);
}
export function daysLeft(iso) {
  const t = new Date(); t.setHours(12, 0, 0, 0);
  return Math.round((localDate(iso) - t) / 864e5);
}
/** یک سال شمسی بعد از امروز، به‌صورت متن قابل ویرایش */
export function nextYearJ() {
  const [y, m, d] = toJ(new Date());
  return faDigits(`${y + 1}/${pad(m)}/${pad(Math.min(d, m === 12 ? 29 : d))}`);
}

export function fmtSize(b) {
  b = +b || 0;
  const f = (v, d) => v.toLocaleString(lang === 'fa' ? 'fa-IR' : 'en-US', { maximumFractionDigits: d });
  if (b < 1024) return f(b, 0) + ' ' + t('sz.b');
  if (b < 1048576) return f(Math.round(b / 1024), 0) + ' ' + t('sz.kb');
  if (b < 1073741824) return f(b / 1048576, 1) + ' ' + t('sz.mb');
  return f(b / 1073741824, 2) + ' ' + t('sz.gb');
}

/* ---------- language-aware dates ---------- */
/** "16 Nov 2026" / Thai Buddhist date / Jalali date, depending on language */
export function fmtDate(iso, withYear = true) {
  if (!iso) return '';
  if (lang === 'fa') return jDate(iso, withYear);
  return new Intl.DateTimeFormat(LOCALE[lang], { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) }).format(localDate(iso));
}
/* ---------- DD/MM/YYYY display, chosen in Settings: 'ce' (2026), 'be' (2569) or 'fa' (Jalali) ---------- */
let dfmt = null;
try { dfmt = localStorage.getItem('by_datefmt'); } catch { }
export const dateFmt = () => (['ce', 'be', 'fa'].includes(dfmt) ? dfmt : lang === 'fa' ? 'fa' : 'ce');
export const setDateFmt = f => { dfmt = f; try { localStorage.setItem('by_datefmt', f); } catch { } };
/** "17/11/2026", "17/11/2569" or "۱۴۰۵/۰۸/۲۶" */
export function fmtDay(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '';
  const f = dateFmt();
  if (f === 'fa') return fmtJ(iso.slice(0, 10));
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${f === 'be' ? +y + 543 : y}`;
}
export const todayIso = () => isoDay(new Date());
export const addDays = (iso, n) => { const d = localDate(iso); d.setDate(d.getDate() + n); return isoDay(d); };

/** month bucket index for the bar chart (Jalali months in Persian, Gregorian otherwise) */
export function monthKey(d) {
  if (lang === 'fa') { const [y, m] = toJ(d); return y * 12 + m - 1; }
  d = new Date(d); return d.getFullYear() * 12 + d.getMonth();
}
export function monthName(k, short = false) {
  const m = ((k % 12) + 12) % 12;
  if (lang === 'fa') return short ? J_MONTHS[m].slice(0, 3) : J_MONTHS[m];
  return new Intl.DateTimeFormat(LOCALE[lang], { month: short ? 'short' : 'long' }).format(new Date(2001, m, 15));
}
/* Expiry field: Jalali text in Persian, native date picker otherwise. Stored value is always ISO (yyyy-mm-dd). */
export const expAttrs = () => lang === 'fa' ? 'type="text" inputmode="numeric" dir="ltr"' : 'type="date"';
export const expValue = iso => !iso ? '' : lang === 'fa' ? fmtJ(iso) : iso;
export const parseExp = v => lang === 'fa' ? parseJ(v) : (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
export function defaultExp() {
  if (lang === 'fa') return nextYearJ();
  const d = new Date(); d.setFullYear(d.getFullYear() + 1); return isoDay(d);
}

/* ---------- دسته‌بندی فایل‌ها ---------- */
export const TYPES = {
  policy: { icon: 'shield' },
  car: { icon: 'car' },
  id: { icon: 'idcard' },
  claim: { icon: 'alert' },
  payment: { icon: 'receipt' },
  other: { icon: 'file' },
};
export const typeLabel = k => t('type.' + (TYPES[k] ? k : 'other'));
export const isImage = f => (f.mime || '').startsWith('image/');
export const isPdf = f => (f.mime || '') === 'application/pdf' || /\.pdf$/i.test(f.name || '');

/* ---------- آیکون‌ها ---------- */
const I = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z"/>',
  car: '<path d="M4 16v-4l2.5-5.5h11L20 12v4M4 16h16M6.5 16v2.5M17.5 16v2.5M4.5 12h15"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 16l-5-5L6 19"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  idcard: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="9" cy="11" r="2"/><path d="M14 10h4M14 14h4M6 16c.6-1.6 5.4-1.6 6 0"/>',
  userplus: '<circle cx="10" cy="8" r="4"/><path d="M3 20c0-3.5 3-6 7-6s7 2.5 7 6M19 7v6M16 10h6"/>',
  sparkle: '<path d="M11 3l1.9 5.1L18 10l-5.1 1.9L11 17l-1.9-5.1L4 10l5.1-1.9z"/><path d="M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
  sliders: '<path d="M4 7h9M19 7h1M4 17h3M13 17h7"/><circle cx="16" cy="7" r="2.5"/><circle cx="10" cy="17" r="2.5"/>',
  cloud: '<path d="M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9.5 4.3 4.3 0 0 1 17.5 18z"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  share: '<path d="M12 15V4M8 8l4-4 4 4M5 13v6h14v-6"/>',
  phone: '<path d="M6 3h4l1.5 5-2.5 1.5a12 12 0 0 0 5.5 5.5L16 12.5l5 1.5v4a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2z"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  arrow: '<path d="M17 17L7 7M7 16V7h9"/>',
  team: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5"/><path d="M17 11l1.5 1.5L22 9"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 8v4l3 2"/>',
  invoice: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  wand: '<path d="M15 4V2M15 10V8M11 6h2M17 6h2M4 20L14 10M18 13v2M17 14h2"/>',
  move: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M10 13h6M13 10l3 3-3 3"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.5"/>',
  gallery: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.3 2.9-5.5 6.500-5.500s6.500 2.200 6.500 5.500M16 4.800a3.500 3.500 0 0 1 0 6.400M18 14.800c2.100.700 3.500 2.500 3.500 5.200"/>',
};
export const icon = (n, s = 20) => `<svg class="ico" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n] || I.file}</svg>`;

export const hue = id => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

/** Small thumbnail for photos */
export async function makeThumb(blob, max = 360) {
  if (!blob.type.startsWith('image/')) return '';
  try {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.72);
  } catch { return ''; }
}

/**
 * Shrinks big photos before upload: longest side at most 2560 px, JPEG quality 0.82.
 * Returns the original file when it is not a photo, can't be decoded, or would not get smaller.
 */
export async function compressImage(file, maxSide = 2560, quality = 0.82, keepBelow = 1.2 * 1048576) {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type)) return file;
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { return file; }
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  if (k === 1 && file.size < keepBelow) return file;
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0, c.width, c.height);
  const out = await new Promise(r => c.toBlob(r, 'image/jpeg', quality));
  if (!out || out.size >= file.size) return file;
  return new File([out], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: Date.now() });
}
