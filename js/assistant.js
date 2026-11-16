// Smart assistant: guesses a file's category and owner on upload, and searches with plain sentences
// in English, Thai or Persian. Everything runs on the device; nothing is sent to any outside service.
import { t } from './i18n.js';
import { norm, typeLabel, daysLeft, isImage, isPdf } from './util.js';

const TYPE_WORDS = {
  policy: ['بیمه نامه', 'بیمهنامه', 'بیمه', 'ثالث', 'بدنه', 'الحاقیه', 'insurance policy', 'policy', 'policies', 'insurance', 'compulsory', 'bime', 'bimeh', 'กรมธรรม์', 'ประกัน', 'พรบ', 'พ ร บ'],
  car: ['کارت ماشین', 'کارت خودرو', 'برگ سبز', 'سند', 'معاینه فنی', 'معاینه', 'کارت سوخت', 'خودرو', 'ماشین', 'vehicle document', 'registration', 'vehicle', 'logbook', 'blue book', 'car', 'เล่มทะเบียน', 'ทะเบียนรถ', 'เอกสารรถ', 'รถ'],
  id: ['کارت ملی', 'ملی', 'شناسنامه', 'گواهینامه', 'گواهی نامه', 'هویتی', 'id card', 'id document', 'passport', 'license', 'licence', 'identity', 'บัตรประชาชน', 'ใบขับขี่', 'พาสปอร์ต', 'หนังสือเดินทาง'],
  claim: ['خسارت', 'کروکی', 'تصادف', 'حادثه', 'کارشناسی', 'claim', 'accident', 'damage', 'crash', 'เคลม', 'อุบัติเหตุ', 'ความเสียหาย'],
  payment: ['فیش', 'رسید', 'قسط', 'پرداخت', 'واریز', 'چک', 'receipt', 'payment', 'invoice', 'instalment', 'installment', 'slip', 'ใบเสร็จ', 'ชำระ', 'สลิป', 'งวด'],
};
// Order matters: the more specific categories are checked first
const TYPE_ORDER = ['claim', 'payment', 'id', 'policy', 'car'];
const EXPIRING = ['منقضی', 'انقضا', 'سررسید', 'تمدید', 'expiring', 'expired', 'expire', 'expiry', 'renewal', 'renew', 'due', 'ใกล้หมดอายุ', 'หมดอายุ', 'ต่ออายุ'];
const WHEN = [
  [1, ['امروز', 'today', 'วันนี้']], [2, ['دیروز', 'yesterday', 'เมื่อวาน']],
  [7, ['این هفته', 'هفته', 'this week', 'week', 'สัปดาห์นี้', 'อาทิตย์นี้']],
  [30, ['این ماه', 'ماه', 'this month', 'month', 'เดือนนี้']],
  [365, ['امسال', 'این سال', 'this year', 'year', 'ปีนี้']],
];
const IMAGE = ['عکس', 'تصویر', 'تصاویر', 'photo', 'image', 'picture', 'pic', 'รูปภาพ', 'รูป', 'ภาพ'];
const PDF = ['pdf', 'پی دی اف'];
const NEW_CUSTOMER = /^(?:مشتری جدید|افزودن مشتری|ثبت مشتری|new customer|add customer|ลูกค้าใหม่|เพิ่มลูกค้า)\s*(?:[:：]\s*)?/i;
const STOP = new Set(('برای از را رو فایل فایلهای فایلها های ها همه همهی پیدا کن بده نشان نشون مال آقای اقای خانم و در به که کجاست بیار مدارک مدرک لطفا من می خواهم میخوام هست چی کدام این با اخیر نامه کارت نزدیک شده ' +
  'driving scan copy for of the a an file files show find all me my in from this with docs documents document and to please mr mrs ms s last recent soon is are where get ' +
  'ของ คุณ ไฟล์ ทั้งหมด หา ขอ ดู เอกสาร ที่ และ').split(' '));

const THAI = /[฀-๿]/;
/** Finds the first of `words` in the padded text n; returns [word, text-without-it]. Thai has no spaces, so it matches as a substring. */
function take(n, words) {
  for (const w of words) {
    if (THAI.test(w)) { if (n.includes(w)) return [w, n.split(w).join(' ')]; continue; }
    const re = new RegExp(` ${w}(?:s|es| ها| های|ها|های)? `, 'g');
    if (re.test(n)) return [w, n.replace(new RegExp(` ${w}(?:s|es| ها| های|ها|های)? `, 'g'), '  ')];
  }
  return [null, n];
}
const pad = s => ' ' + norm(s).replace(/ /g, '  ') + ' ';

export function guessType(name) {
  const n = pad(name.replace(/\.[a-z0-9]{2,5}$/i, ''));
  for (const k of TYPE_ORDER) if (take(n, TYPE_WORDS[k])[0]) return k;
  return 'other';
}

const hay = c => norm(`${c.name} ${c.plate} ${c.phone} ${c.car}`);

/** If a customer's name, plate or phone appears in the file name, suggest that customer */
export function guessCustomer(name, customers) {
  const n = ' ' + norm(name) + ' ', tight = n.replace(/\s/g, '');
  let best = null, score = 0;
  for (const c of customers) {
    let s = 0;
    for (const tok of norm(c.name).split(' ')) if (tok.length > 2 && n.includes(tok)) s += 2;
    const plate = norm(c.plate).replace(/\s/g, '');
    if (plate.length > 4 && tight.includes(plate)) s += 5;
    const phone = norm(c.phone).replace(/\D/g, '');
    if (phone.length > 6 && tight.includes(phone)) s += 5;
    if (s > score) { score = s; best = c; }
  }
  return score >= 2 ? best : null;
}

/** Turns the user's sentence into a filter */
export function parseQuery(q, customers) {
  const out = { type: '', days: 0, expiring: false, kind: '', customers: [], words: [], newCustomer: '' };
  if (NEW_CUSTOMER.test(q.trim())) { out.newCustomer = q.trim().replace(NEW_CUSTOMER, '').replace(/…/g, '').trim(); if (out.newCustomer) return out; }

  let n = pad(q), hit;
  [hit, n] = take(n, EXPIRING); if (hit) out.expiring = true;
  for (const [d, words] of WHEN) { [hit, n] = take(n, words); if (hit) { out.days = d; break; } }
  [hit, n] = take(n, PDF); if (hit) out.kind = 'pdf';
  [hit, n] = take(n, IMAGE); if (hit) out.kind = 'image';
  for (const k of TYPE_ORDER) { [hit, n] = take(n, TYPE_WORDS[k]); if (hit) { out.type = k; while (hit) [hit, n] = take(n, TYPE_WORDS[k]); break; } }
  if (out.expiring && out.type === 'policy') out.type = '';

  const toks = n.split(' ').filter(x => x && !STOP.has(x));
  const scores = customers.map(c => { const h = hay(c); return toks.filter(x => x.length > 1 && h.includes(x)).length; });
  const max = Math.max(0, ...scores);
  if (max > 0) {
    out.customers = customers.filter((c, i) => scores[i] === max);
    const all = out.customers.map(hay).join(' ');
    out.words = toks.filter(x => !all.includes(x));
  } else out.words = toks;
  return out;
}

/** Returns an answer sentence plus the matching files and customers */
export function ask(q, { customers, files }) {
  if (!q.trim()) return { answer: '', files: [], customers: [], action: null };
  const p = parseQuery(q, customers);
  if (p.newCustomer) return { answer: t('as.newQ', { x: p.newCustomer }), files: [], customers: [], action: { type: 'new-customer', name: p.newCustomer } };

  const ids = new Set(p.customers.map(c => c.id));
  const since = p.days ? Date.now() - p.days * 864e5 : 0;
  const res = files.filter(f => {
    if (ids.size && !ids.has(f.customerId)) return false;
    if (p.type && f.type !== p.type) return false;
    if (p.kind === 'image' && !isImage(f)) return false;
    if (p.kind === 'pdf' && !isPdf(f)) return false;
    if (since && new Date(f.createdAt) < since) return false;
    if (p.expiring && !(f.expiry && daysLeft(f.expiry) <= 30)) return false;
    if (p.words.length) { const h = norm(`${f.name} ${f.note || ''}`); if (!p.words.every(w => h.includes(w))) return false; }
    return true;
  });
  res.sort((a, b) => p.expiring ? a.expiry.localeCompare(b.expiry) : b.createdAt.localeCompare(a.createdAt));

  const parts = [p.expiring ? t('as.expiring') : p.kind === 'image' ? t('as.photo') : p.kind === 'pdf' ? t('as.pdf') : p.type ? typeLabel(p.type) : t('as.files')];
  if (p.customers.length === 1) parts.push(p.customers[0].name);
  else if (p.customers.length > 1) parts.push(t('as.multi', { n: p.customers.length }));
  if (p.days) parts.push(t('when.' + p.days));
  const answer = `${res.length ? t('as.found', { n: res.length }) : t('as.none')}: ${parts.join(' · ')}`;
  const onlyCustomer = p.customers.length && !p.type && !p.kind && !p.days && !p.expiring && !p.words.length;
  return { answer, files: res.slice(0, 40), customers: onlyCustomer || !res.length ? p.customers.slice(0, 5) : [], action: null };
}
