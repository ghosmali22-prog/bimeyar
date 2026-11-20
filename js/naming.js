// Automatic file names (v3.2):  {PLATE} - {CUSTOMER}({M}) - {DOCNAME}.{ext}
// e.g. "99-0016 - สมมติชัย ทรานสปอร์ต(7) - กรมธรรม์รถยนต์.pdf". No plate -> "สมมติชัย(11) - บัตรประชาชน.jpg".
// Pure functions (no DOM), also used by tests/naming.test.mjs. The backend only cleans the name
// and adds " (2)", " (3)"… when the name is taken (see uniqueName in backend/Code.gs).

/** Standard Thai document names. Longest first, so "กรมธรรม์เดิม" wins over "กรมธรรม์" when found in a name. */
export const DOC_NAMES = ['หนังสือรับรองบริษัท', 'หลักฐานการชำระเงิน', 'กรมธรรม์เดิม', 'หนังสือเดินทาง', 'บัตรประชาชน', 'สลิปโอนเงิน',
  'ภาพถ่ายรถ', 'ใบแจ้งหนี้', 'กรมธรรม์', 'ทะเบียนรถ', 'ใบขับขี่', 'ใบเสร็จ', 'เอกสาร'];

/** Name used when the AI gives none: by the folder chosen (never the folder number). */
const BY_FOLDER = { policy: 'กรมธรรม์', docs: 'เอกสาร', prev: 'กรมธรรม์เดิม', pay: 'หลักฐานการชำระเงิน' };
/** AI document types, when the AI gave a type but no name */
const BY_DOCTYPE = { policy: 'กรมธรรม์', registration: 'ทะเบียนรถ', id_card: 'บัตรประชาชน' };
/** Old files (rename tool) that sit outside the 4 folders: by the file type chosen in v2 */
const BY_TYPE = { policy: 'กรมธรรม์', id: 'บัตรประชาชน', payment: 'หลักฐานการชำระเงิน' };

const BAD = /[\/\\:*?"<>|\u0000-\u001f]/g;
/** Removes / \ : * ? " < > | and control characters, squeezes spaces. */
export const safeName = s => String(s == null ? '' : s).replace(BAD, '').replace(/\s+/g, ' ').trim();

/** ".pdf" from "scan.PDF" (kept as written); '' when there is none. */
export const extOf = name => { const m = String(name || '').match(/\.([A-Za-z0-9]{1,8})$/); return m ? '.' + m[1] : ''; };
/** Adds the extension again when the edited name lost it. */
export const withExt = (name, ext) => !ext || name.toLowerCase().endsWith(ext.toLowerCase()) ? name : name + ext;

/** Plate number only: "99-0016 นศ" -> "99-0016", "1กข 1234 กรุงเทพมหานคร" -> "1กข 1234". */
export function plateOnly(plate, province = '') {
  let p = String(plate || '').trim();
  const pr = String(province || '').trim();
  if (pr && p.endsWith(pr) && p.length > pr.length) p = p.slice(0, -pr.length);
  // Thai letters (a province name or its short form) after the last digit
  p = p.replace(/([0-9๐-๙])[\s.,]*[฀-๿][฀-๿.\s]*$/, '$1');
  return safeName(p);
}

/** Company words removed from the customer name. Everything else stays exactly as written. */
const COMPANY = ['ห้างหุ้นส่วนจำกัด', '(มหาชน)', 'บริษัท', 'จำกัด', 'หจก.', 'หจก', 'บจก.'];
/**
 * The customer part of a file name: the customer NAME exactly as written, without the company words
 * (นาย / นาง / นางสาว stay). Never the nickname (v4): the nickname is the contact person, for display and search only.
 */
export function customerPart(c) {
  let n = String(c?.name || '');
  for (const w of COMPANY) n = n.split(w).join(' ');
  return safeName(n);
}

/** Month 1-12 (no leading zero) of the first ISO date (YYYY-MM-DD, CE or BE: the month is the same). */
export function monthOf(...dates) {
  for (const d of dates) {
    const m = String(d || '').match(/^\d{4}-(\d{2})/);
    if (m && +m[1] >= 1 && +m[1] <= 12) return +m[1];
  }
  return new Date().getMonth() + 1;
}

/** Thai document name from the AI answer, else from the AI type, else from the folder. */
export function docNameFor({ aiName = '', docType = '', folder = '', type = '' } = {}) {
  let d = safeName(aiName).slice(0, 40);
  if (d && !/[฀-๿]/.test(d)) d = '';            // Thai names only
  if (/^0[1-4]/.test(d) || /_/.test(d)) d = '';            // never a folder name or number
  if (!d) d = BY_DOCTYPE[docType] || '';
  if (!d) d = (folder === 'docs' && BY_TYPE[type]) || BY_FOLDER[folder] || BY_TYPE[type] || 'เอกสาร';
  if (folder === 'prev' && d === 'กรมธรรม์') d = 'กรมธรรม์เดิม';
  return d;
}

/** Document name guessed from an old file name (rename tool), else from folder/type. */
export function docNameFromOld(oldName, folder, type) {
  const base = String(oldName || '').replace(/\.[A-Za-z0-9]{1,8}$/, '');
  const pat = base.match(/\(\d{1,2}\) - (.+?)(?: \(\d+\))?$/);   // already in the new pattern
  let d = pat ? pat[1] : DOC_NAMES.find(w => base.includes(w)) || '';
  if (!d) {
    if (/slip/i.test(base)) d = 'สลิปโอนเงิน';
    else if (/receipt/i.test(base)) d = 'ใบเสร็จ';
    else if (/policy/i.test(base)) d = 'กรมธรรม์';
    else if (/id[\s_-]?card/i.test(base)) d = 'บัตรประชาชน';
  }
  return docNameFor({ aiName: d, folder, type });
}

/** True when a name already follows the pattern "{plate} - {customer}({month}) - {document}": such names are never changed (v4). */
export const followsPattern = name => !!plateFromName(name);

/** Plate at the start of a name that already follows the pattern ("99-0016 - X(11) - …"). */
export function plateFromName(name) {
  const m = String(name || '').match(/^(.+?) - .+\(\d{1,2}\) - /);
  return m && /[0-9๐-๙]/.test(m[1]) ? m[1] : '';
}

/** The full file name. */
export function buildName({ plate = '', customer, month, doc, ext = '' }) {
  const p = safeName(plate), cu = customerPart(customer) || 'ลูกค้า';
  return safeName(`${p ? p + ' - ' : ''}${cu}(${month}) - ${doc}`) + ext;
}

/** "name.pdf" -> "name (2).pdf", "name (3).pdf"… until it is not in `taken` (a Set of names). Same rule as the backend. */
export function uniqueIn(name, taken) {
  if (!taken.has(name)) return name;
  const ext = extOf(name), base = ext ? name.slice(0, -ext.length) : name;
  for (let i = 2; i < 1000; i++) { const n = `${base} (${i})${ext}`; if (!taken.has(n)) return n; }
  return `${base} (${Date.now()})${ext}`;
}
