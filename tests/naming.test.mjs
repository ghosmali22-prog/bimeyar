// File naming (v3.2): js/naming.js and the backend upload / rename / undo / share actions,
// run against a small in-memory fake of Google Drive (no network, no real data).
// Run: node tests/naming.test.mjs
import { readFileSync } from 'node:fs';
import { buildName, customerPart, plateOnly, monthOf, docNameFor, docNameFromOld, uniqueIn, safeName, withExt, extOf, plateFromName } from '../js/naming.js';

let fail = 0, pass = 0;
const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) { fail++; console.error('FAIL', msg, '\n   got     ', a, '\n   expected', b); } else pass++; };

/* ---------------- frontend naming ---------------- */
const company = { name: 'บริษัทสมมติชัย ทรานสปอร์ต จำกัด', plate: '99-0016 นศ', contractDate: '2569-11-04' };
const name = (c, folder = 'policy', ai = '', ext = '.pdf') => buildName({ plate: plateOnly(c.plate, c.province), customer: c, month: monthOf(c.contractDate, c.policyStart, '2026-01-15'), doc: docNameFor({ aiName: ai, folder }), ext });

eq(name(company, 'policy', 'กรมธรรม์'), '99-0016 - สมมติชัย ทรานสปอร์ต(11) - กรมธรรม์.pdf', 'company name, BE contract date 04/11/2569');
eq(name({ ...company, nick: 'สมมติชัย' }, 'policy', 'กรมธรรม์'), '99-0016 - สมมติชัย(11) - กรมธรรม์.pdf', 'nickname is used as typed');
eq(name({ ...company, contractDate: '2026-03-09' }), '99-0016 - สมมติชัย ทรานสปอร์ต(3) - กรมธรรม์.pdf', 'March -> (3), not (03)');
eq(name({ ...company, contractDate: '', policyStart: '2026-07-01' }), '99-0016 - สมมติชัย ทรานสปอร์ต(7) - กรมธรรม์.pdf', 'no contract date -> policy start month');
eq(monthOf('', '', '2026-02-20'), 2, 'no dates -> upload month');
eq(name({ ...company, plate: '' }, 'docs', 'บัตรประชาชน', '.jpg'), 'สมมติชัย ทรานสปอร์ต(11) - บัตรประชาชน.jpg', 'no plate -> name starts with the customer');

// duplicate name -> " (2)", " (3)"
const taken = new Set(['99-0016 - สมมติชัย(11) - กรมธรรม์.pdf']);
eq(uniqueIn('99-0016 - สมมติชัย(11) - กรมธรรม์.pdf', taken), '99-0016 - สมมติชัย(11) - กรมธรรม์ (2).pdf', 'duplicate -> (2)');
taken.add('99-0016 - สมมติชัย(11) - กรมธรรม์ (2).pdf');
eq(uniqueIn('99-0016 - สมมติชัย(11) - กรมธรรม์.pdf', taken), '99-0016 - สมมติชัย(11) - กรมธรรม์ (3).pdf', 'duplicate again -> (3)');

// customer name: only company words removed, spelling kept
eq(customerPart({ name: 'บริษัท เอบีซี จำกัด (มหาชน)' }), 'เอบีซี', 'บริษัท / จำกัด / (มหาชน) removed');
eq(customerPart({ name: 'หจก.สมชาย การช่าง' }), 'สมชาย การช่าง', 'หจก. removed');
eq(customerPart({ name: 'ห้างหุ้นส่วนจำกัด ศรีสุข' }), 'ศรีสุข', 'ห้างหุ้นส่วนจำกัด removed');
eq(customerPart({ name: 'นายสมชาย  ใจดี' }), 'นายสมชาย ใจดี', 'person name kept (only spaces squeezed)');
eq(customerPart({ name: 'X', nick: '  ทดสอบ  ' }), 'ทดสอบ', 'nickname trimmed');

// plates
eq(plateOnly('99-0016 นศ'), '99-0016', 'short province removed');
eq(plateOnly('1กข 1234 กรุงเทพมหานคร'), '1กข 1234', 'full province removed');
eq(plateOnly('1กข 1234', 'กรุงเทพมหานคร'), '1กข 1234', 'plate without province unchanged');
eq(plateOnly('กท 5678นครศรีธรรมราช', 'นครศรีธรรมราช'), 'กท 5678', 'province glued to the plate');
eq(plateFromName('99-0016 - สมมติชัย(11) - กรมธรรม์.pdf'), '99-0016', 'plate read back from a new-style name');
eq(plateFromName('scan 2024 - copy.pdf'), '', 'no plate from an old name');

// document names
eq(docNameFor({ aiName: '', folder: 'policy' }), 'กรมธรรม์', 'AI failed, folder 01');
eq(docNameFor({ aiName: '', folder: 'docs' }), 'เอกสาร', 'AI failed, folder 02');
eq(docNameFor({ aiName: '', folder: 'prev' }), 'กรมธรรม์เดิม', 'AI failed, folder 03');
eq(docNameFor({ aiName: '', folder: 'pay' }), 'หลักฐานการชำระเงิน', 'AI failed, folder 04');
eq(docNameFor({ aiName: 'กรมธรรม์', folder: 'prev' }), 'กรมธรรม์เดิม', 'policy saved in 03 -> กรมธรรม์เดิม');
eq(docNameFor({ aiName: '01_กรมธรรม์', folder: 'policy' }), 'กรมธรรม์', 'never a folder name');
eq(docNameFor({ aiName: 'Policy schedule', docType: 'policy', folder: 'docs' }), 'กรมธรรม์', 'English AI name -> Thai by type');
eq(docNameFor({ aiName: 'สลิป/โอน:เงิน', folder: 'pay' }), 'สลิปโอนเงิน', 'bad characters removed');
eq(docNameFromOld('IMG_2041.jpg', 'docs', 'id'), 'บัตรประชาชน', 'old ID card in 02');
eq(docNameFromOld('scan.pdf', '', 'payment'), 'หลักฐานการชำระเงิน', 'old v2 payment file');
eq(docNameFromOld('กรมธรรม์ปี68.pdf', 'prev', 'policy'), 'กรมธรรม์เดิม', 'Thai word in old name, in 03');
eq(docNameFromOld('99-0016 - X(11) - ใบขับขี่ (2).jpg', 'docs', 'car'), 'ใบขับขี่', 'already new pattern: keep its document name');

eq(safeName('a/b\\c:d*e?f"g<h>i|j'), 'abcdefghij', 'forbidden characters');
eq(withExt('ชื่อใหม่', '.pdf'), 'ชื่อใหม่.pdf', 'extension added back');
eq(withExt('x.PDF', '.pdf'), 'x.PDF', 'extension kept as written');
eq(extOf('photo.HEIC'), '.HEIC', 'extension read');

/* ---------------- backend with a fake Drive ---------------- */
const gs = readFileSync(new URL('../backend/Code.gs', import.meta.url), 'utf8');
function fakeDrive() {
  let n = 0;
  const files = {}, perms = {};
  const pick = f => JSON.parse(JSON.stringify(f));
  const match = (f, q) => {
    if (/trashed=false/.test(q) && f.trashed) return false;
    let m = q.match(/'([^']+)' in parents/); if (m && !(f.parents || []).includes(m[1])) return false;
    for (const x of q.matchAll(/appProperties has \{ key='(\w+)' and value='([^']*)' \}/g)) if ((f.appProperties || {})[x[1]] !== x[2]) return false;
    m = q.match(/mimeType(!?=)'([^']+)'/); if (m && ((f.mimeType === m[2]) !== (m[1] === '='))) return false;
    return true;
  };
  const setProps = (f, ap) => { f.appProperties ||= {}; for (const k in ap || {}) { if (ap[k] === null) delete f.appProperties[k]; else f.appProperties[k] = ap[k]; } };
  const Drive = {
    files,
    Files: {
      get: id => { if (!files[id]) throw new Error('404'); return { ...pick(files[id]), webViewLink: 'https://drive.google.com/file/d/' + id + '/view?usp=drivesdk' }; },
      list: o => ({ files: Object.values(files).filter(f => match(f, o.q)).map(pick) }),
      create: (res, blob) => { const id = 'id' + (++n) + 'xxxxxxxx'; files[id] = { id, createdTime: new Date(Date.now() + n).toISOString(), ...pick(res), appProperties: {} }; setProps(files[id], res.appProperties); return Drive.Files.get(id); },
      update: (res, id) => { const f = files[id]; for (const k of ['name', 'description', 'trashed']) if (k in res) f[k] = res[k]; if (res.appProperties) setProps(f, res.appProperties); return Drive.Files.get(id); },
    },
    Permissions: {
      list: id => ({ permissions: (perms[id] || []).map(pick) }),
      create: (res, id) => { (perms[id] ||= []).push({ id: 'p' + (++n), ...res }); },
      update: (res, id, pid) => { Object.assign(perms[id].find(p => p.id === pid), res); },
      remove: (id, pid) => { perms[id] = perms[id].filter(p => p.id !== pid); },
    },
    perms,
  };
  return Drive;
}
const props = {};
const PropertiesService = { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; } }) };
const LockService = { getScriptLock: () => ({ waitLock() { }, releaseLock() { } }) };
const Utilities = { base64Decode: s => [...Buffer.from(s, 'base64')], newBlob: (b, mime, name) => ({ b, mime, name }) };
const Session = { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) };
const Drive = fakeDrive();
const B = new Function('Drive', 'PropertiesService', 'LockService', 'Utilities', 'Session', `${gs}\nreturn { ACTIONS, fileName, uniqueName, descSplit };`)(Drive, PropertiesService, LockService, Utilities, Session);

// root + a customer with its 4 sub-folders
const root = Drive.Files.create({ name: 'Bimeyar', mimeType: 'application/vnd.google-apps.folder', appProperties: { bimeyar: 'root' } }).id;
props.ROOT_ID = root;
const user = { email: 'owner@example.com' };
const c = B.ACTIONS.saveCustomer.run({ customer: { name: 'บริษัทสมมติชัย ทรานสปอร์ต จำกัด', plate: '99-0016', province: 'นครศรีธรรมราช', nick: 'สมมติชัย', contractDate: '2026-11-04' } }, user);
eq(c.nick, 'สมมติชัย', 'backend saves the nickname');
eq(c.contractDate, '2026-11-04', 'backend saves the contract date');
const upload = (n, orig, note = '') => B.ACTIONS.upload.run({ data: Buffer.from('hello').toString('base64'), meta: { customerId: c.id, folder: 'policy', type: 'policy', name: n, orig, note } }, user);

const f1 = upload('99-0016 - สมมติชัย(11) - กรมธรรม์.pdf', 'scan0001.pdf', '฿18,500');
eq(f1.name, '99-0016 - สมมติชัย(11) - กรมธรรม์.pdf', 'upload keeps the given name');
eq(f1.note, '฿18,500', 'the note shows without the original-name line');
eq(f1.orig, 'scan0001.pdf', 'original file name kept');
eq(Drive.files[f1.id].description, '฿18,500\n\nOriginal file name: scan0001.pdf', 'original file name is in the Drive description');
const f2 = upload('99-0016 - สมมติชัย(11) - กรมธรรม์.pdf', 'scan0002.pdf');
eq(f2.name, '99-0016 - สมมติชัย(11) - กรมธรรม์ (2).pdf', 'same name in the folder -> (2)');
const f3 = upload('99-0016 - สมมติชัย(11) - กรมธรรม์.pdf', 'IMG_9.pdf');
eq(f3.name, '99-0016 - สมมติชัย(11) - กรมธรรม์ (3).pdf', 'third -> (3)');
eq(Drive.files[f1.id].name, '99-0016 - สมมติชัย(11) - กรมธรรม์.pdf', 'first file was not overwritten or renamed');
eq(upload('a/b:c*?.pdf', 'x.pdf').name, 'abc.pdf', 'forbidden characters removed by the backend');
eq(upload('ไม่มีนามสกุล', 'photo.jpg').name, 'ไม่มีนามสกุล.jpg', 'missing extension added from the original name');
eq(Object.keys(Drive.files).length, 1 + 1 + 4 + 5, 'nothing was deleted');

// updateFile keeps the original-name line
B.ACTIONS.updateFile.run({ file: { id: f1.id, name: f1.name, type: 'policy', expiry: '', note: 'จ่ายแล้ว' } });
eq(Drive.files[f1.id].description, 'จ่ายแล้ว\n\nOriginal file name: scan0001.pdf', 'editing the note keeps the original name');

// rename tool + undo
const r = B.ACTIONS.renameFiles.run({ batch: 'rnTEST123', items: [{ id: f2.id, name: 'ชื่อใหม่' }, { id: f3.id, name: '99-0016 - สมมติชัย(11) - กรมธรรม์.pdf' }] });
eq(r.rows.map(x => [x.status, x.name]), [['ok', 'ชื่อใหม่.pdf'], ['ok', '99-0016 - สมมติชัย(11) - กรมธรรม์ (2).pdf']], 'rename: extension kept, taken name -> next free number');
eq(Drive.files[f2.id].parents, Drive.files[f1.id].parents, 'rename does not move the file');
eq(B.descSplit(Drive.files[f2.id].description).meta.slice(-1)[0], 'Renamed: 99-0016 - สมมติชัย(11) - กรมธรรม์ (2).pdf ⇒ ชื่อใหม่.pdf', 'old name kept in the description');
// someone renames f3 again by hand: undo must leave it alone
B.ACTIONS.updateFile.run({ file: { id: f3.id, name: 'แก้เอง.pdf', type: 'policy', expiry: '', note: '' } });
const u = B.ACTIONS.renameUndo.run({});
eq([u.done, u.skipped], [1, 1], 'undo: one put back, one left (renamed again since)');
eq(Drive.files[f2.id].name, '99-0016 - สมมติชัย(11) - กรมธรรม์ (2).pdf', 'undo puts the old name back');
eq(Drive.files[f3.id].name, 'แก้เอง.pdf', 'undo does not touch a file renamed again');
eq(Drive.files[f2.id].description, 'Original file name: scan0002.pdf', 'undo removes its rename line, keeps the original name');
eq(B.ACTIONS.renameUndo.run({}).done, 0, 'second undo does nothing');
B.ACTIONS.renameFiles.run({ batch: 'rnEMPTY99', items: [{ id: f1.id, name: Drive.files[f1.id].name }] });
eq(props.RENAME_LAST, 'rnTEST123', 'a run that renames nothing keeps the previous undo');

// invoices are never renamed
const inv = Drive.Files.create({ name: 'RI-2026-0001.pdf', mimeType: 'application/pdf', parents: [c.folders.pay], description: '{"no":"RI-2026-0001"}', appProperties: { bimeyar: 'item', kind: 'invoice' } });
eq(B.ACTIONS.renameFiles.run({ batch: 'rnTEST124', items: [{ id: inv.id, name: 'x' }] }).rows[0].status, 'invoice', 'invoice refused');
eq(Drive.files[inv.id].name, 'RI-2026-0001.pdf', 'invoice name unchanged');

// share one file only
const s1 = B.ACTIONS.shareFile.run({ id: f1.id });
eq(Drive.perms[f1.id].map(p => [p.type, p.role]), [['anyone', 'reader']], 'file shared: anyone with link, viewer');
eq(s1.file.shared, true, 'file marked as shared');
eq(/\/file\/d\//.test(s1.link), true, 'a file link is returned');
B.ACTIONS.shareFile.run({ id: f1.id });
eq(Drive.perms[f1.id].length, 1, 'sharing twice does not add a second permission');
eq(Object.keys(Drive.perms), [f1.id], 'no folder and no other file got a permission');
let refused = false;
try { B.ACTIONS.shareFile.run({ id: c.id }); } catch (e) { refused = true; }
eq(refused, true, 'a customer folder can never be shared');
refused = false;
try { B.ACTIONS.shareFile.run({ id: root }); } catch (e) { refused = true; }
eq(refused, true, 'the Bimeyar folder can never be shared');
const s2 = B.ACTIONS.unshareFile.run({ id: f1.id });
eq([Drive.perms[f1.id].length, s2.shared], [0, false], 'stop sharing: private again');

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `All ${pass} naming tests passed.`);
process.exit(fail ? 1 : 0);
