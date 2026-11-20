// v4 vehicles: js/vehicles.js + the backend (folders per customer / month / plate, upload, security checks,
// move tool + undo, invoices) on a small in-memory fake of Google Drive. No network, no real data.
// Run: node tests/vehicles.test.mjs
import { readFileSync } from 'node:fs';
import { buildName, customerPart, followsPattern } from '../js/naming.js';
import { VSLOTS, FILE_SLOTS, ymOf, ymFolder, ymText, vehiclesOf, latestOf, vehicleFileName, slotFromAi, slotForOld, findCustomer, findVehicle, allVehicles, batchHint, searchVehicles, movePlan, moveName, plateKey, monthInName, ymNear, needsAiRead, detectVehicles } from '../js/vehicles.js';

let fail = 0, pass = 0;
const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) { fail++; console.error('FAIL', msg, '\n   got     ', a, '\n   expected', b); } else pass++; };
const throws = (fn, msg) => { let t = false; try { fn(); } catch (e) { t = true; } eq(t, true, msg); };

/* ================= frontend (pure) ================= */
const cust1 = { id: 'C1', name: 'บริษัทสมมติชัย ทรานสปอร์ต จำกัด', nick: 'k.aaa', createdAt: '2026-01-05T00:00:00Z' };
eq(customerPart(cust1), 'สมมติชัย ทรานสปอร์ต', 'nickname is never used in file names');
eq(customerPart({ name: 'นางสาวมาลี ทองดี', nick: 'k.ccc' }), 'นางสาวมาลี ทองดี', 'person keeps นางสาว, nickname ignored');
eq(vehicleFileName({ vehicle: { plate: '99-0016', ym: '2026-07' }, customer: cust1, slot: '1', ext: '.pdf' }), '99-0016 - สมมติชัย ทรานสปอร์ต(7) - กรมธรรม์รถยนต์.pdf', 'v4 file name');
eq(vehicleFileName({ vehicle: { plate: '99-0016', ym: '2026-07' }, customer: cust1, slot: '4', ext: '.pdf' }), '99-0016 - สมมติชัย ทรานสปอร์ต(7) - ใบวางบิล-ใบเสนอราคา.pdf', 'folder 4 name ("/" not allowed)');
eq(vehicleFileName({ vehicle: { plate: '99-0016 นศ', ym: '2027-11' }, customer: cust1, slot: '5.3', ext: '.jpg' }), '99-0016 - สมมติชัย ทรานสปอร์ต(11) - รูปรถ.jpg', 'plate without province, month without zero');
eq(followsPattern('99-0016 - สมมติชัย(11) - กรมธรรม์.pdf'), true, 'pattern name (also with an old nickname) is kept');
eq(followsPattern('168186.jpg'), false, '"168186.jpg" does not follow the pattern');
eq(ymOf('2569-07-04'), '2026-07', 'Buddhist year -> CE month');
eq(ymOf('', '2026-03-01'), '2026-03', 'no contract date -> policy start');
eq(ymFolder('2026-07'), '07 July 2026', 'month folder name');
eq(ymText('2026-07'), 'July 2026', 'month text');
eq(FILE_SLOTS, ['1', '2', '3', '4', '5.1', '5.2', '5.3', '5.4', '5.5'], 'files never go into folder 5');
eq(VSLOTS.filter(s => s.in === '5').length, 5, '5.1–5.5 inside 5');

// AI folder
const today = '2026-11-21';
eq(slotFromAi({ slot: '1', docType: 'policy', docName: 'กรมธรรม์', values: { policyType: 'ชั้น 1', policyExpiry: '2027-07-01' } }, today), '1', 'car policy -> 1');
eq(slotFromAi({ slot: '1', docType: 'policy', docName: 'กรมธรรม์', values: { policyType: 'พ.ร.บ.', policyExpiry: '2027-07-01' } }, today), '3', 'พ.ร.บ. -> 3 even when the AI said 1');
eq(slotFromAi({ slot: '3', docType: 'policy', values: { policyExpiry: '2027-07-01' } }, today), '3', 'พ.ร.บ. -> 3');
eq(slotFromAi({ slot: '1', docType: 'policy', values: { policyExpiry: '2025-07-01' } }, today), '5.2', 'expired policy -> previous policy 5.2');
eq(slotFromAi({ slot: '', docType: 'receipt', values: {} }, today), '5.4', 'transfer slip -> 5.4');
eq(slotFromAi({ slot: '', docType: 'other', values: {} }, today), '', 'unknown -> please choose');

// old folders -> new folders (move tool)
eq(slotForOld({ name: 'a.pdf', folder: 'policy', type: 'policy' }, today), '1', '01_กรมธรรม์ -> 1');
eq(slotForOld({ name: 'พ.ร.บ. 2569.pdf', folder: 'policy', type: 'policy' }, today), '3', '01_กรมธรรม์ พ.ร.บ. -> 3');
eq(slotForOld({ name: 'x.pdf', folder: 'prev', type: 'policy' }, today), '5.2', '03 -> 5.2');
eq(slotForOld({ name: 'x.jpg', folder: 'pay', type: 'payment', mime: 'image/jpeg' }, today), '5.4', '04 -> 5.4');
eq(slotForOld({ name: 'RI-2026-0001.pdf', folder: 'pay', invoice: 'RI-2026-0001' }, today), '4', 'invoice -> 4');
eq(slotForOld({ name: 'IMG_1.jpg', folder: 'docs', type: 'id', mime: 'image/jpeg' }, today), '5.5', 'ID card -> 5.5');
eq(slotForOld({ name: 'x - ทะเบียนรถ.jpg', folder: 'docs', type: 'car', mime: 'image/jpeg' }, today), '5.1', 'registration -> 5.1');
eq(slotForOld({ name: '168186.jpg', folder: 'docs', type: 'car', mime: 'image/jpeg' }, today), '5.3', 'car photo -> 5.3');
eq(slotForOld({ name: 'claim.jpg', folder: '', type: 'claim', mime: 'image/jpeg' }, today), '5.3', 'claim photo -> 5.3');
eq(slotForOld({ name: 'หนังสือรับรองบริษัท.pdf', folder: 'docs', type: 'car' }, today), '5.5', 'company certificate -> 5.5');
eq(slotForOld({ name: 'scan.pdf', folder: '', type: 'other' }, today), '', 'v2 unknown -> please choose');

// vehicles of a customer, legacy vehicle #1
const legacyC = { id: 'C2', name: 'นายสมชาย ใจดี', plate: '1กข 1234 กรุงเทพมหานคร', insurer: 'X', policyStart: '2026-02-01', policyExpiry: '2027-02-01', createdAt: '2025-01-01T00:00:00Z' };
let vs = vehiclesOf(legacyC, []);
eq([vs.length, vs[0].legacy, vs[0].plate, vs[0].ym], [1, true, '1กข 1234', '2026-02'], 'old customer: single plate becomes vehicle #1');
vs = vehiclesOf(legacyC, [{ id: 'V9', customerId: 'C2', plate: '1กข 1234', ym: '2026-02' }]);
eq(vs.map(v => v.id), ['V9'], 'legacy hidden once a record with the same plate and month exists');
vs = vehiclesOf(legacyC, [{ id: 'V9', customerId: 'C2', plate: '1กข 1234', ym: '2027-02' }]);
eq(vs.map(v => v.id), ['V9', 'L:C2'], 'renewal next year: the old period stays visible');
eq(latestOf(vs).map(v => v.id), ['V9'], 'renewals: one row per vehicle, latest month');

// 3 vehicles in 2 months
const V = [
  { id: 'VA', customerId: 'C1', plate: '99-0016', vin: 'MP1TFAKE000000111', ym: '2026-07' },
  { id: 'VB', customerId: 'C1', plate: '99-0017', ym: '2026-07' },
  { id: 'VC', customerId: 'C1', plate: '71-0001', ym: '2026-09' },
];
const customers = [cust1, legacyC, { id: 'C3', name: 'ห้างหุ้นส่วนจำกัด ศรีสุข', nick: 'k.ccc' }];
const all = allVehicles(customers, V);
eq(findCustomer({ vin: 'mp1tfake000000111' }, customers, all), { cid: 'C1', how: 'vin', conf: 'high' }, 'match by chassis first');
eq(findCustomer({ plate: '99-0017 นศ' }, customers, all), { cid: 'C1', how: 'plate', conf: 'high' }, 'then by plate (province ignored)');
eq(findCustomer({ insuredName: 'บริษัท สมมติชัย ทรานสปอร์ต จำกัด' }, customers, all)?.cid, 'C1', 'then by insured name');
eq(findCustomer({ insuredName: 'k.ccc' }, customers, all)?.cid, 'C3', 'or by nickname');
eq(findCustomer({ insuredName: 'บริษัท ใหม่ จำกัด' }, customers, all), null, 'unknown -> new customer');
const mine = vehiclesOf(cust1, V);
eq(findVehicle({ plate: '99-0016', contractDate: '2026-07-04' }, '1', mine), { vid: 'VA', conf: 'high' }, 'same plate + same month -> that vehicle');
eq(findVehicle({ plate: '99-0016', contractDate: '2027-07-04' }, '1', mine), { vid: '', add: true, ym: '2027-07', conf: 'high', renew: 'VA' }, 'same plate renewed next year -> new month');
eq(findVehicle({ plate: '80-1111' }, '5.1', mine), { vid: '', add: true, ym: '', conf: 'high' }, 'new plate -> add vehicle');
eq(findVehicle({}, '5.3', mine).conf, 'none', 'photo without plate -> please choose');
const rows = batchHint([{ cid: 'C1', vkey: 'VA', conf: 'high' }, { cid: 'C1', vkey: 'VA', conf: 'high' }, { cid: '', vkey: '', conf: 'none' }]);
eq([rows[2].cid, rows[2].vkey, rows[2].conf], ['C1', 'VA', 'hint'], 'photo without plate gets the vehicle of the other files in the batch');

// search: each vehicle is a result
eq(searchVehicles('สมมติชัย', customers, V).length, 3, 'customer name -> one result per vehicle');
eq(searchVehicles('99-0016', customers, V).map(x => x.v.id), ['VA'], 'plate');
eq(searchVehicles('July 2026', customers, V).map(x => x.v.id).sort(), ['VA', 'VB'], 'month');
eq(searchVehicles('k.aaa', customers, V).length, 3, 'nickname');
eq(searchVehicles('FAKE000000111', customers, V).map(x => x.v.id), ['VA'], 'chassis');

// move plan: correct names stay, others get a pattern name (never the nickname); unknown plate -> please choose
const files = [
  { id: 'F1', customerId: 'C1', name: '99-0016 - k.aaa(7) - กรมธรรม์.pdf', folder: 'policy', type: 'policy' },
  { id: 'F2', customerId: 'C1', name: '168186.jpg', folder: 'docs', type: 'car', mime: 'image/jpeg' },
];
const plan = movePlan(cust1, files, V);
eq([plan[0].slot, plan[0].plate, moveName(plan[0], cust1)], ['1', '99-0016', '99-0016 - k.aaa(7) - กรมธรรม์.pdf'], 'name that follows the pattern is not changed');
eq([plan[1].slot, plan[1].plate], ['5.3', ''], 'several plates, none in the name -> please choose');
plan[1].plate = '99-0017'; plan[1].ym = '2026-07';
eq(moveName(plan[1], cust1), '99-0017 - สมมติชัย ทรานสปอร์ต(7) - รูปรถ.jpg', 'pattern name with the customer name, not the nickname');
eq(movePlan(legacyC, [{ id: 'F3', customerId: 'C2', name: 'scan.pdf', folder: 'policy', type: 'policy' }], [])[0].plate, '1กข 1234', 'one plate -> that plate');
eq(plateKey('๙๙-๐๐๑๖'), '990016', 'Thai digits');

// v4.1 "Detect vehicles automatically"
eq(monthInName('99-0016 - สมมติชัย(11) - กรมธรรม์.pdf'), 11, 'month from a pattern name');
eq(ymNear(11, '2026-11-20T03:00:00Z'), '2026-11', 'month in the name, year from the file date');
eq(ymNear(12, '2026-01-05'), '2025-12', 'saved in January, named (12) -> December of the year before');
eq(ymNear(1, '2026-12-28'), '2027-01', 'saved in late December, named (1) -> January next year');
// a customer with 4 plates in 2 months, from file names only (no plate in the customer details)
const four = { id: 'C4', name: 'บริษัท สี่คัน จำกัด', nick: 'k.four' };
const fourFiles = [
  { id: 'a1', customerId: 'C4', name: '70-1111 - สี่คัน(7) - กรมธรรม์.pdf', folder: 'policy', type: 'policy', mime: 'application/pdf', at: '2026-07-03T00:00:00Z' },
  { id: 'a2', customerId: 'C4', name: '70-1111 - สี่คัน(7) - ทะเบียนรถ.jpg', folder: 'docs', type: 'car', mime: 'image/jpeg', at: '2026-07-03T00:00:00Z' },
  { id: 'a3', customerId: 'C4', name: '70-2222 - สี่คัน(7) - กรมธรรม์.pdf', folder: 'policy', type: 'policy', mime: 'application/pdf', at: '2026-07-04T00:00:00Z' },
  { id: 'a4', customerId: 'C4', name: '70-3333 - สี่คัน(9) - กรมธรรม์.pdf', folder: 'policy', type: 'policy', mime: 'application/pdf', at: '2026-09-01T00:00:00Z' },
  { id: 'a5', customerId: 'C4', name: '70-4444 - สี่คัน(9) - สลิปโอนเงิน.jpg', folder: 'pay', type: 'payment', mime: 'image/jpeg', at: '2026-09-02T00:00:00Z' },
  { id: 'a6', customerId: 'C4', name: 'หนังสือรับรองบริษัท.pdf', folder: 'docs', type: 'car', mime: 'application/pdf', at: '2026-07-01T00:00:00Z' },
];
const det = detectVehicles(four, fourFiles, []);
eq(det.vehicles.map(v => [v.plate, v.ym, v.src.join()]), [['70-1111', '2026-07', 'name'], ['70-2222', '2026-07', 'name'], ['70-3333', '2026-09', 'name'], ['70-4444', '2026-09', 'name']], '4 plates in 2 months from file names only');
eq([det.assign.a1, det.assign.a2, det.assign.a5], ['701111', '701111', '704444'], 'every named file assigned to its plate');
eq(det.assign.a6, undefined, 'company certificate without a plate anywhere -> please choose');
// a policy PDF without a plate in its name: the AI read it
const legacy4 = { id: 'C5', name: 'นายสมชาย ใจดี', plate: '1กข 1234 กรุงเทพมหานคร', policyStart: '2026-02-10', insurer: 'X' };
const pFiles = [
  { id: 'p1', customerId: 'C5', name: 'scan0001.pdf', folder: 'policy', type: 'policy', mime: 'application/pdf', at: '2026-03-01T00:00:00Z' },
  { id: 'p2', customerId: 'C5', name: 'IMG_7.jpg', folder: 'docs', type: 'car', mime: 'image/jpeg', at: '2026-03-01T00:00:00Z' },
];
eq([needsAiRead(pFiles[0], '1'), needsAiRead(pFiles[1], '5.3'), needsAiRead(fourFiles[0], '1')], [true, false, false], 'only policy PDFs without a plate in the name are read by the AI');
const det2 = detectVehicles(legacy4, pFiles, [], { p1: { plate: '2ขค 5678', vin: 'VIN555666', contractDate: '2026-04-05', policyStart: '2026-04-05', insurer: 'Viriyah' } });
eq(det2.vehicles.map(v => [v.plate, v.ym, v.src.join()]), [['1กข 1234', '2026-02', 'customer'], ['2ขค 5678', '2026-04', 'ai']], 'customer details + AI plate -> 2 vehicles, month = contract date');
eq([det2.assign.p1, det2.assign.p2, det2.vehicles[1].data.vin], ['2ขค5678', undefined, 'VIN555666'], 'policy PDF assigned by the AI; photo without plate -> please choose');
const det3 = detectVehicles(legacy4, [{ id: 'q', customerId: 'C5', name: '1กข 1234 - สมชาย(1) - กรมธรรม์.pdf', at: '2026-01-20' }], []);
eq(det3.vehicles.map(v => v.ym), ['2026-02'], 'policy start in the customer details wins over the month in a file name');
eq(detectVehicles(cust1, [], V).vehicles.map(v => [v.plate, v.src.join()]), [['99-0016', 'vehicle'], ['99-0017', 'vehicle'], ['71-0001', 'vehicle']], 'existing vehicles are reused, not made twice');

/* ================= backend with a fake Drive ================= */
const FOLDER = 'application/vnd.google-apps.folder';
function fakeDrive() {
  let n = 0;
  const files = {};
  const pick = f => JSON.parse(JSON.stringify(f));
  const one = (f, q) => {
    q = q.trim();
    let m;
    if (q === 'trashed=false') return !f.trashed;
    if ((m = q.match(/^'([^']+)' in parents$/))) return (f.parents || []).includes(m[1]);
    if ((m = q.match(/^appProperties has \{ key='(\w+)' and value='([^']*)' \}$/))) return (f.appProperties || {})[m[1]] === m[2];
    if ((m = q.match(/^mimeType(!?=)'([^']+)'$/))) return (f.mimeType === m[2]) === (m[1] === '=');
    if ((m = q.match(/^\((.+)\)$/))) return m[1].split(' or ').some(x => one(f, x));
    throw new Error('fake Drive cannot read: ' + q);
  };
  const split = q => { const out = []; let d = 0, cur = ''; for (const part of q.split(' and ')) { cur = cur ? cur + ' and ' + part : part; d = (cur.match(/[({]/g) || []).length - (cur.match(/[)}]/g) || []).length; if (!d) { out.push(cur); cur = ''; } } return out; };
  const match = (f, q) => split(q).every(x => one(f, x));
  const setProps = (f, ap) => { f.appProperties ||= {}; for (const k in ap || {}) { if (ap[k] === null) delete f.appProperties[k]; else f.appProperties[k] = ap[k]; } };
  const trashedUp = f => { for (let x = f; x; x = files[(x.parents || [])[0]]) if (x.trashed) return true; return false; };
  const Drive = {
    files,
    Files: {
      get: id => { if (!files[id]) throw new Error('404'); const f = pick(files[id]); f.trashed = trashedUp(files[id]); return f; },
      list: o => ({ files: Object.values(files).filter(f => match({ ...f, trashed: trashedUp(f) }, o.q)).map(pick) }),
      create: (res) => { const id = 'id' + String(++n).padStart(3, '0') + 'xxxxxxxx'; files[id] = { id, createdTime: new Date(Date.now() + n).toISOString(), ...pick(res), appProperties: {} }; setProps(files[id], res.appProperties); return Drive.Files.get(id); },
      update: (res, id, blob, opt = {}) => {
        const f = files[id]; if (!f) throw new Error('404');
        for (const k of ['name', 'description', 'trashed']) if (k in res) f[k] = res[k];
        if (res.appProperties) setProps(f, res.appProperties);
        if (opt.addParents) { f.parents = (f.parents || []).filter(p => p !== opt.removeParents).concat([opt.addParents]); }
        return Drive.Files.get(id);
      },
    },
    Permissions: { list: () => ({ permissions: [] }), create() { }, update() { }, remove() { } },
    About: { get: () => ({ storageQuota: {} }) },
  };
  return Drive;
}
const props = {};
const PropertiesService = { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; } }) };
const LockService = { getScriptLock: () => ({ waitLock() { }, releaseLock() { } }) };
const Utilities = { base64Decode: s => [...Buffer.from(s, 'base64')], newBlob: (b, mime, name) => ({ b, mime, name }), formatDate: (d, tz, f) => f === 'yyyy-MM' ? '2026-11' : '2026-11-21' };
const Session = { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) };
const Drive = fakeDrive();
const gs = readFileSync(new URL('../backend/Code.gs', import.meta.url), 'utf8');
const B = new Function('Drive', 'PropertiesService', 'LockService', 'Utilities', 'Session', `${gs}\nreturn { ACTIONS, assertFile, ownerOf, assertVehicle, VSLOTS };`)(Drive, PropertiesService, LockService, Utilities, Session);
eq(B.VSLOTS.map(s => s.slot + ' ' + s.name), VSLOTS.map(s => s.id + ' ' + s.th), 'backend VSLOTS = js/vehicles.js VSLOTS');

const root = Drive.Files.create({ name: 'RICH INSURANSE', mimeType: FOLDER, appProperties: { bimeyar: 'root' } }).id;
props.ROOT_ID = root;
const user = { email: 'owner@example.com' };
const A = B.ACTIONS;
const kids = (pid, extra = () => true) => Object.values(Drive.files).filter(f => (f.parents || [])[0] === pid && extra(f));

const c = A.saveCustomer.run({ customer: { name: 'บริษัทสมมติชัย ทรานสปอร์ต จำกัด', nick: 'k.aaa', plate: '99-0016', insurer: 'Old Insurer' } }, user);
eq(kids(c.id).length, 0, 'v4: a new customer gets no old 01_…04_ folders');
const before = JSON.parse(Drive.files[c.id].description);

// one customer, 3 vehicles in 2 months
const v1 = A.saveVehicle.run({ vehicle: { customerId: c.id, plate: '99-0016', vin: 'MP1TFAKE000000111', contractDate: '2569-07-04', policyExpiry: '2027-07-04' } }, user);
const v2 = A.saveVehicle.run({ vehicle: { customerId: c.id, plate: '99-0017', contractDate: '2026-07-20' } }, user);
const v3 = A.saveVehicle.run({ vehicle: { customerId: c.id, plate: '71-0001', policyStart: '2026-09-01' } }, user);
eq([v1.ym, v2.ym, v3.ym], ['2026-07', '2026-07', '2026-09'], 'month = contract date (BE -> CE), else policy start');
eq(kids(c.id).map(f => f.name).sort(), ['07 July 2026', '09 September 2026'], 'two month folders, "MM MonthName YYYY"');
const july = kids(c.id).find(f => f.name === '07 July 2026');
eq(july.appProperties, { bimeyar: 'month', year: '2026', month: '07' }, 'month folder tags');
eq(kids(july.id).map(f => f.name).sort(), ['99-0016', '99-0017'], 'plate folders: plate only');
eq(Drive.files[v1.id].appProperties, { bimeyar: 'vehicle', plate: '99-0016', year: '2026', month: '07' }, 'vehicle folder tags');
eq(kids(v1.id).map(f => f.name), ['1. กรมธรรม์รถยนต์', '2. กรมธรรม์ขนส่งสินค้า', '3. พรบ.', '4. ใบวางบิล/ใบเสนอราคา', '5. เอกสารตัวรถยนต์'], 'the 5 folders');
eq(kids(v1.folders['5']).map(f => f.appProperties.slot), ['5.1', '5.2', '5.3', '5.4', '5.5'], '5.1–5.5 inside 5');
eq(Object.keys(v1.folders).length, 10, 'all 10 folders known');
eq(JSON.parse(Drive.files[v1.id].description).vin, 'MP1TFAKE000000111', 'vehicle data in the plate folder description');
eq(JSON.parse(Drive.files[c.id].description), before, 'customer JSON untouched by vehicles');
const v4 = A.saveVehicle.run({ vehicle: { customerId: c.id, plate: '99-0016', contractDate: '2026-07-30', premium: '18500' } }, user);
eq([v4.id, v4.vin, v4.premium], [v1.id, 'MP1TFAKE000000111', '18500'], 'same plate + same month = same vehicle, data MERGED');
eq(kids(july.id).length, 2, 'no duplicate plate folder');
A.saveVehicle.run({ vehicle: { id: v1.id, insurer: 'Viriyah' } }, user);
eq(JSON.parse(Drive.files[v1.id].description).premium, '18500', 'edit merges: other fields kept');
throws(() => A.saveVehicle.run({ vehicle: { customerId: c.id, plate: '' } }, user), 'plate is required');
// same plate renewed next year
const r1 = A.saveVehicle.run({ vehicle: { customerId: c.id, plate: '99-0016', contractDate: '2027-07-04' } }, user);
eq([r1.ym, r1.id !== v1.id], ['2027-07', true], 'renewal next year: new month folder of the new year');
eq(kids(c.id).length, 3, 'month folders: 2026-07, 2026-09, 2027-07');
// no dates -> the month it was added
eq(A.saveVehicle.run({ vehicle: { customerId: c.id, plate: '99-9999' } }, user).ym, '2026-11', 'no date -> month the vehicle was added');

// upload into a vehicle folder
const up = (meta) => A.upload.run({ data: Buffer.from('x').toString('base64'), meta: { customerId: c.id, type: 'policy', ...meta } }, user);
const fa = up({ vehicleId: v1.id, slot: '1', name: '99-0016 - สมมติชัย ทรานสปอร์ต(7) - กรมธรรม์รถยนต์.pdf', orig: 'scan.pdf' });
eq([fa.vehicleId, fa.vslot, Drive.files[fa.id].parents[0]], [v1.id, '1', v1.folders['1']], 'upload goes into folder 1 of the vehicle');
const fb = up({ vehicleId: v1.id, slot: '5.3', name: 'photo.jpg', type: 'car' });
eq(Drive.files[fb.id].parents[0], v1.folders['5.3'], 'upload into 5.3 (inside 5)');
throws(() => up({ vehicleId: v1.id, slot: '5', name: 'x.pdf' }), 'never directly into folder 5');
const other = A.saveCustomer.run({ customer: { name: 'ลูกค้าอื่น' } }, user);
throws(() => A.upload.run({ data: 'eA==', meta: { customerId: other.id, vehicleId: v1.id, slot: '1', name: 'x.pdf' } }, user), 'vehicle of another customer refused');

// list: vehicles, files mapped to vehicle + folder
const L = A.list.run({}, user, 'admin');
eq(L.vehicles.length, 5, 'list returns all vehicles');
eq(L.files.filter(f => f.vehicleId === v1.id).map(f => f.vslot).sort(), ['1', '5.3'], 'list: files with vehicle + folder');
eq(L.vehicles.find(v => v.id === v1.id).folders['5.5'], v1.folders['5.5'], 'list: folder ids per vehicle');

/* ---- security: assertFile / ownerOf with month / plate / 5.x folders ---- */
eq(B.ownerOf(Drive.files[fb.id]), { customer: c.id, slot: '', vehicle: v1.id, vslot: '5.3' }, 'ownerOf walks 5.3 -> 5 -> plate -> month -> customer');
B.assertFile(fa.id);
pass++;
const outside = Drive.Files.create({ name: 'Other', mimeType: FOLDER });   // NOT in the root folder
const fakeCust = Drive.Files.create({ name: 'fake', mimeType: FOLDER, parents: [outside.id], appProperties: { bimeyar: 'item' } });
const fakeMonth = Drive.Files.create({ name: '07 July 2026', mimeType: FOLDER, parents: [fakeCust.id], appProperties: { bimeyar: 'month', year: '2026', month: '07' } });
const fakeVeh = Drive.Files.create({ name: '1', mimeType: FOLDER, parents: [fakeMonth.id], appProperties: { bimeyar: 'vehicle', plate: '1' } });
const fakeSlot = Drive.Files.create({ name: '1', mimeType: FOLDER, parents: [fakeVeh.id], appProperties: { bimeyar: 'slot', slot: '1' } });
const evil = Drive.Files.create({ name: 'evil.pdf', mimeType: 'application/pdf', parents: [fakeSlot.id], appProperties: { bimeyar: 'item' } });
throws(() => B.assertFile(evil.id), 'file in a tagged chain OUTSIDE the root is refused');
throws(() => A.getFile.run({ id: evil.id }), 'getFile refuses it');
throws(() => A.shareFile.run({ id: evil.id }), 'shareFile refuses it');
eq(A.moveNew.run({ batch: 'mvEVIL01', items: [{ id: evil.id, vehicleId: v1.id, slot: '1' }] }).rows[0].status, 'error', 'move tool refuses it');
throws(() => B.assertFile(v1.folders['1']), 'a slot folder is not a file');
throws(() => B.assertFile(v1.id), 'a plate folder is not a file');
throws(() => B.assertFile(july.id), 'a month folder is not a file');
throws(() => A.shareFile.run({ id: v1.folders['5'] }), 'a folder can never be shared');
throws(() => A.deleteFile.run({ id: root }), 'the root folder can never be deleted');
throws(() => B.assertVehicle(fakeVeh.id), 'a vehicle outside the root is refused');
throws(() => B.assertVehicle(july.id), 'a month folder is not a vehicle');
throws(() => A.saveVehicle.run({ vehicle: { id: fakeVeh.id, plate: 'X' } }, user), 'saveVehicle refuses a vehicle outside the root');
throws(() => A.upload.run({ data: 'eA==', meta: { customerId: c.id, vehicleId: fakeVeh.id, slot: '1', name: 'x' } }, user), 'upload refuses a vehicle outside the root');
// a file directly in folder 5, or in a 5.x folder that is not inside 5
const in5 = Drive.Files.create({ name: 'in5.pdf', mimeType: 'application/pdf', parents: [v1.folders['5']], appProperties: { bimeyar: 'item' } });
throws(() => B.assertFile(in5.id), 'a file directly in folder 5 is refused');
const stray = Drive.Files.create({ name: '5.1', mimeType: FOLDER, parents: [v1.id], appProperties: { bimeyar: 'slot', slot: '5.1' } });
const strayF = Drive.Files.create({ name: 's.pdf', mimeType: 'application/pdf', parents: [stray.id], appProperties: { bimeyar: 'item' } });
throws(() => B.assertFile(strayF.id), 'a 5.x folder outside folder 5 is refused');
const wrongSlot = Drive.Files.create({ name: '9', mimeType: FOLDER, parents: [v1.id], appProperties: { bimeyar: 'slot', slot: '9' } });
const wrongF = Drive.Files.create({ name: 'w.pdf', mimeType: 'application/pdf', parents: [wrongSlot.id], appProperties: { bimeyar: 'item' } });
throws(() => B.assertFile(wrongF.id), 'an unknown slot is refused');
const noTag = Drive.Files.create({ name: 'n.pdf', mimeType: 'application/pdf', parents: [v1.folders['1']] });
throws(() => B.assertFile(noTag.id), 'a file without the item tag is refused');
// a slot folder whose plate folder is in the trash
const vt = A.saveVehicle.run({ vehicle: { customerId: c.id, plate: '55-5555', contractDate: '2026-07-01' } }, user);
const ft = up({ vehicleId: vt.id, slot: '5.4', name: 'slip.jpg', type: 'payment' });
A.deleteVehicle.run({ id: vt.id });
eq(Drive.files[vt.id].trashed, true, 'remove vehicle = trash only');
eq(!!Drive.files[ft.id], true, 'its files still exist (in the trash with it)');
throws(() => B.assertFile(ft.id), 'a file of a trashed vehicle is refused');
throws(() => B.assertVehicle(vt.id), 'a trashed vehicle is refused');
// tags in the wrong order: a "vehicle" directly in the customer folder
const flat = Drive.Files.create({ name: 'flat', mimeType: FOLDER, parents: [c.id], appProperties: { bimeyar: 'vehicle', plate: 'x' } });
throws(() => B.assertVehicle(flat.id), 'a vehicle must be inside a month folder');

/* ---- invoices into folder 4 ---- */
const realPdf = { getAs() { return this; }, setName() { return this; } };
const B2 = new Function('Drive', 'PropertiesService', 'LockService', 'Utilities', 'Session', 'DocumentApp', 'DriveApp', `${gs}\ninvoicePdf = () => ({});\nreturn { ACTIONS };`)(Drive, PropertiesService, LockService, Utilities, Session, {}, {});
const inv = B2.ACTIONS.createInvoice.run({ invoice: { customerId: c.id, vehicleId: v1.id, cust: { name: 'x' }, items: [{ d: 'a', q: 1, p: 100 }] } }, user);
eq([Drive.files[inv.id].parents[0], Drive.files[inv.id].name], [v1.folders['4'], inv.no + '.pdf'], 'invoice into "4. ใบวางบิล/ใบเสนอราคา", name RI-YYYY-NNNN unchanged');
void realPdf;

/* ---- move tool + undo ---- */
// old v3 files: upload into the old sub-folders (old clients still work)
const o1 = A.upload.run({ data: 'eA==', meta: { customerId: c.id, folder: 'policy', type: 'policy', name: '99-0016 - k.aaa(7) - กรมธรรม์.pdf' } }, user);
const o2 = A.upload.run({ data: 'eA==', meta: { customerId: c.id, folder: 'docs', type: 'car', name: '168186.jpg', note: 'หน้ารถ' } }, user);
const o3 = Drive.Files.create({ name: 'v2.pdf', mimeType: 'application/pdf', parents: [c.id], appProperties: { bimeyar: 'item', type: 'policy' } });   // v2 loose file
eq([o1.folder, o2.folder], ['policy', 'docs'], 'old v3 upload still works');
const sub01 = Drive.files[o1.id].parents[0];
const nBefore = Object.keys(Drive.files).length;
const mv = A.moveNew.run({ batch: 'mvTEST001', items: [
  { id: o1.id, vehicleId: v1.id, slot: '1' },                                                  // name follows the pattern: kept
  { id: o2.id, vehicleId: v1.id, slot: '5.3', name: '99-0016 - สมมติชัย ทรานสปอร์ต(7) - รูปรถ' },  // gets a pattern name
  { id: o3.id, vehicleId: v1.id, slot: '1' },
  { id: inv.id, vehicleId: v2.id, slot: '4', name: 'never.pdf' },                               // invoice: name never changes
] });
eq(mv.rows.map(r => r.status), ['ok', 'ok', 'ok', 'ok'], 'move tool: all moved');
eq(Object.keys(Drive.files).length, nBefore, 'move tool: nothing created as a copy, nothing deleted');
eq([Drive.files[o1.id].name, Drive.files[o1.id].parents[0]], ['99-0016 - k.aaa(7) - กรมธรรม์.pdf', v1.folders['1']], 'correct old name not changed');
eq(Drive.files[o2.id].name, '99-0016 - สมมติชัย ทรานสปอร์ต(7) - รูปรถ.jpg', 'pattern name given, extension kept');
eq(Drive.files[o3.id].name, 'v2.pdf', 'no name sent -> name kept');
eq(Drive.files[o2.id].description.split('\n')[0], 'หน้ารถ', 'the note is kept');
eq(/Moved from: 02_เอกสาร \[/.test(Drive.files[o2.id].description), true, 'old folder written in the description');
eq([Drive.files[inv.id].name, Drive.files[inv.id].description.startsWith('{')], [inv.no + '.pdf', true], 'invoice: name and JSON description unchanged');
eq(props.MOVE_LAST, 'mvTEST001', 'last move remembered');
eq(Drive.files[sub01].trashed, undefined, 'old folders are NOT deleted');
const moved = A.list.run({}, user, 'admin').files.find(f => f.id === o2.id);
eq([moved.vehicleId, moved.vslot, moved.note], [v1.id, '5.3', 'หน้ารถ'], 'list after move: in 5.3, note shown without the move line');
eq(A.moveNew.run({ batch: 'mvTEST002', items: [{ id: o1.id, vehicleId: c.id, slot: '1' }] }).rows[0].status, 'error', 'a customer folder is not a vehicle');
eq(A.moveNew.run({ batch: 'mvTEST003', items: [{ id: o1.id, vehicleId: v1.id, slot: '5' }] }).rows[0].status, 'error', 'never into folder 5');
const oc = A.saveVehicle.run({ vehicle: { customerId: other.id, plate: '12-3456' } }, user);
eq(A.moveNew.run({ batch: 'mvTEST004', items: [{ id: o1.id, vehicleId: oc.id, slot: '1' }] }).rows[0].status, 'error', 'never into another customer');
eq(props.MOVE_LAST, 'mvTEST001', 'a run that moved nothing keeps the previous undo');
// empty old folders (read only)
const old = A.oldFolders.run({});
eq(old.map(x => [x.name, x.items]), [['01_กรมธรรม์', 0], ['02_เอกสาร', 0], ['03_กรมธรรม์เดิม', 0], ['04_หลักฐานการชำระเงิน', 0]], 'old folders listed with item counts');
eq(old.every(x => !Drive.files[x.id].trashed), true, 'oldFolders deletes nothing');
// undo
const un = A.moveUndo.run({});
eq([un.done, un.skipped], [4, 0], 'undo: all 4 put back');
eq([Drive.files[o1.id].parents[0], Drive.files[o2.id].name, Drive.files[o3.id].parents[0]], [sub01, '168186.jpg', c.id], 'undo: old folder and old name back');
eq(Drive.files[o2.id].description, 'หน้ารถ', 'undo: move lines removed, note kept');
eq(Drive.files[inv.id].parents[0], v1.folders['4'], 'undo: invoice back where it was');
eq(Drive.files[o2.id].appProperties.mvb, undefined, 'undo: tags removed');
eq(A.moveUndo.run({}).done, 0, 'second undo does nothing');
// a file moved again by hand after the move is left alone
A.moveNew.run({ batch: 'mvTEST005', items: [{ id: o3.id, vehicleId: v1.id, slot: '1' }] });
A.moveFile.run({ id: o3.id, vehicleId: v1.id, slot: '5.2' });
eq(A.moveUndo.run({}).skipped, 1, 'undo skips a file moved again since');
eq(Drive.files[o3.id].parents[0], v1.folders['5.2'], 'that file stays where the user put it');
// moveFile (one file, user confirmed) into a vehicle folder
eq(A.moveFile.run({ id: o1.id, vehicleId: v2.id, slot: '3' }).vslot, '3', 'moveFile into a vehicle folder');
eq(A.moveFile.run({ id: o1.id, folder: 'policy' }).folder, 'policy', 'moveFile back into a v3 folder still works');

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `All ${pass} vehicle tests passed.`);
process.exit(fail ? 1 : 0);
