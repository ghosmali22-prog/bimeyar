// v4.3 "Edit with AI": the suggestion (js/vehicles.js) for the real cases, and the backend aiEditApply / aiEditUndo /
// aiEditList on a fake Drive (no network, no real data).  Run: node tests/aiedit.test.mjs
import { aiEditSuggest, vehiclesOf } from '../js/vehicles.js';
import { normalize } from '../js/ai.js';
import { loadBackend, FOLDER } from './fake-drive.mjs';

let fail = 0, pass = 0;
const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) { fail++; console.error('FAIL', msg, '\n   got     ', a, '\n   expected', b); } else pass++; };
const today = '2026-11-21';
/** An AI answer as the backend returns it */
const ai = (f, slot = '1') => normalize({ docType: 'policy', docName: 'กรมธรรม์', slot, fields: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, { value: v, confidence: 0.95 }])) });

/* ================= the suggestion (pure) ================= */
const choke = { id: 'C1', name: 'บริษัทโชควิไล ทรานสปอร์ต จำกัด', nick: 'k.beer' };
const june = { id: 'C2', name: 'สุวิทย์ ศรีมงคล', nick: 'k.june' };
const V = ['70-4663', '70-4662', '70-5417', '70-5416'].map((p, i) => ({ id: 'V' + i, customerId: 'C1', plate: p, ym: '2025-11' })).concat([{ id: 'V9', customerId: 'C2', plate: '70-8077', ym: '2025-11' }]);
const pol = p => ({ plate: p, policyType: 'ชั้น 1', contractDate: '2568-11-05', policyStart: '2025-11-05', policyExpiry: '2026-12-05' });
for (const p of ['70-4663', '70-4662', '70-5417', '70-5416']) {
  const f = { id: 'f' + p, name: `${p} -โชควไล ทรานสปอร์ต(11) - กรมธรรม์.jpg`, folder: 'policy' };
  const s = aiEditSuggest(f, choke, vehiclesOf(choke, V), ai(pol(p)), today);
  eq([s.name, s.slot, s.conf], [`${p} - โชควิไล ทรานสปอร์ต(11) - กรมธรรม์รถยนต์.jpg`, '1', 'high'], `"${p} -โชควไล…" -> misspelling and spacing fixed`);
}
const sj = aiEditSuggest({ id: 'fj', name: '70-8077 - k.june(11) - กรมธรรม์.jpg', vehicleId: 'V9', vslot: '1' }, june, vehiclesOf(june, V), ai(pol('70-8077')), today);
eq([sj.name, sj.vid], ['70-8077 - สุวิทย์ ศรีมงคล(11) - กรมธรรม์รถยนต์.jpg', 'V9'], 'nickname in the name -> the real customer name');
eq(aiEditSuggest({ name: 'x.jpg' }, choke, vehiclesOf(choke, V), null, today).conf, 'none', 'AI failed -> please choose (no change)');
const blur = normalize({ docType: 'policy', slot: '1', fields: { plate: { value: '70-4663', confidence: 0.4 }, policyExpiry: { value: '2026-12-05', confidence: 0.9 } } });
eq(aiEditSuggest({ name: 'x.jpg' }, choke, vehiclesOf(choke, V), blur, today).conf, 'low', 'blurred plate -> please choose');
const photo = normalize({ docType: 'other', slot: '5.3', fields: {} });
eq(aiEditSuggest({ name: 'IMG.jpg', vehicleId: 'V0', vslot: '1' }, choke, vehiclesOf(choke, V), photo, today), { slot: '5.3', vid: 'V0', add: null, name: '70-4663 - โชควิไล ทรานสปอร์ต(11) - รูปรถ.jpg', conf: 'mid' }, 'photo without plate: keeps its vehicle, folder 5.3');
const renew = aiEditSuggest({ name: 'p.pdf', vehicleId: 'V0', vslot: '1' }, choke, vehiclesOf(choke, V), ai({ ...pol('70-4663'), contractDate: '2026-11-05', policyExpiry: '2027-11-05' }), today);
eq([renew.vid, renew.add], ['', { plate: '70-4663', ym: '2026-11' }], 'policy of the next year -> "Add vehicle" in the new month');

/* ================= backend ================= */
const { B, Drive, props } = loadBackend('ACTIONS, descSplit');
const A = B.ACTIONS, user = { email: 'owner@example.com' }, other = { email: 'editor@example.com' };
const snap = () => JSON.stringify(Drive.files);
const c1 = A.saveCustomer.run({ customer: { name: 'บริษัทโชควิไล ทรานสปอร์ต จำกัด', nick: 'k.beer' } }, user);
const veh = {};
for (const p of ['70-4663', '70-4662', '70-5417', '70-5416']) veh[p] = A.saveVehicle.run({ vehicle: { customerId: c1.id, plate: p, contractDate: '2025-11-05', insurer: 'Old Ins' } }, user);
const files = {};
for (const p of ['70-4663', '70-4662']) files[p] = A.upload.run({ data: 'eA==', meta: { customerId: c1.id, vehicleId: veh[p].id, slot: '1', type: 'policy', name: `${p} -โชควไล ทรานสปอร์ต(11) - กรมธรรม์.jpg`, orig: 'IMG_1.jpg' } }, user);
for (const p of ['70-5417', '70-5416']) files[p] = A.upload.run({ data: 'eA==', meta: { customerId: c1.id, folder: 'policy', type: 'policy', name: `${p} -โชควไล ทรานสปอร์ต(11) - กรมธรรม์.jpg`, orig: 'IMG_2.jpg' } }, user);
const c2 = A.saveCustomer.run({ customer: { name: 'สุวิทย์ ศรีมงคล', nick: 'k.june' } }, user);
const v9 = A.saveVehicle.run({ vehicle: { customerId: c2.id, plate: '70-8077', contractDate: '2025-11-01' } }, user);
const fj = A.upload.run({ data: 'eA==', meta: { customerId: c2.id, vehicleId: v9.id, slot: '3', type: 'policy', name: '70-8077 - k.june(11) - กรมธรรม์.jpg' } }, user);
eq(files['70-4663'].name, '70-4663 -โชควไล ทรานสปอร์ต(11) - กรมธรรม์.jpg', 'the real wrong names are in Drive');

// "Back" = the app sends nothing: Drive unchanged (the preview never calls the backend to change anything)
const s0 = snap();
eq(snap(), s0, 'Back -> nothing changed');

// Save: names fixed, two files moved from the old folder into their vehicle, one vehicle's data changed
const items = ['70-4663', '70-4662', '70-5417', '70-5416'].map(p => ({ id: files[p].id, name: `${p} - โชควิไล ทรานสปอร์ต(11) - กรมธรรม์รถยนต์.jpg`, vehicleId: veh[p].id, slot: '1' }));
const r = A.aiEditApply.run({ batch: 'aiTEST0001', customerId: c1.id, items, vehicles: [{ id: veh['70-4663'].id, fields: { insurer: 'Viriyah', premium: '18500', plate: 'HACK' } }] }, other);
eq(r.rows.map(x => x.status), ['ok', 'ok', 'ok', 'ok'], 'Save -> all changed');
eq(['70-4663', '70-4662', '70-5417', '70-5416'].map(p => Drive.files[files[p].id].name), ['70-4663', '70-4662', '70-5417', '70-5416'].map(p => `${p} - โชควิไล ทรานสปอร์ต(11) - กรมธรรม์รถยนต์.jpg`), 'the 4 real names are correct now');
eq(Drive.files[files['70-5417'].id].parents[0], veh['70-5417'].folders['1'], 'moved from the old folder into folder 1 of its vehicle');
const vd = JSON.parse(Drive.files[veh['70-4663'].id].description);
eq([vd.insurer, vd.premium, vd.plate], ['Viriyah', '18500', '70-4663'], 'vehicle data merged; the plate is never changed by an AI edit');
eq(r.vehicles[0].fields, ['insurer', 'premium'], 'only real changes');
eq(JSON.parse(props.AIEDIT_LOG).map(x => [x.b, x.c, x.n, x.cn]), [['aiTEST0001', c1.id, 4, 'บริษัทโชควิไล ทรานสปอร์ต จำกัด']], 'batch in the log');
eq(Object.values(Drive.files).filter(f => f.trashed).length, 0, 'nothing deleted');

// the nickname case, in another batch
const rj = A.aiEditApply.run({ batch: 'aiTEST0002', customerId: c2.id, items: [{ id: fj.id, name: '70-8077 - สุวิทย์ ศรีมงคล(11) - กรมธรรม์รถยนต์.jpg', vehicleId: v9.id, slot: '1' }] }, user);
eq([rj.rows[0].status, Drive.files[fj.id].name, Drive.files[fj.id].parents[0], Drive.files[fj.id].appProperties.type], ['ok', '70-8077 - สุวิทย์ ศรีมงคล(11) - กรมธรรม์รถยนต์.jpg', v9.folders['1'], 'policy'], 'k.june -> real name, folder 3 -> 1');

// security
eq(A.aiEditApply.run({ batch: 'aiTEST0003', customerId: c1.id, items: [{ id: fj.id, name: 'x' }] }, user).rows[0].status, 'error', 'a file of another customer is refused');
eq(A.aiEditApply.run({ batch: 'aiTEST0004', customerId: c1.id, items: [{ id: files['70-4663'].id, vehicleId: v9.id, slot: '1' }] }, user).rows[0].status, 'error', 'a vehicle of another customer is refused');
const outside = Drive.Files.create({ name: 'x', mimeType: FOLDER });
const evil = Drive.Files.create({ name: 'e.pdf', mimeType: 'application/pdf', parents: [outside.id], appProperties: { bimeyar: 'item' } });
eq(A.aiEditApply.run({ batch: 'aiTEST0005', customerId: c1.id, items: [{ id: evil.id, name: 'y' }] }, user).rows[0].status, 'error', 'a file outside the root is refused');
eq(A.aiEditApply.run({ batch: 'aiTEST0006', customerId: c1.id, items: [{ id: files['70-4663'].id, vehicleId: veh['70-4663'].id, slot: '5' }] }, user).rows[0].status, 'error', 'never into folder 5');
let threw = false; try { A.aiEditApply.run({ batch: 'aiTEST0007', customerId: outside.id, items: [] }, user); } catch (e) { threw = true; }
eq(threw, true, 'a folder outside the root is not a customer');
eq(JSON.parse(props.AIEDIT_LOG).length, 2, 'batches that changed nothing are not logged');

// Undo: exactly as before (names, folders, types, vehicle data, tags)
const u2 = A.aiEditUndo.run({ batch: 'aiTEST0002' }, user);
const u1 = A.aiEditUndo.run({ batch: 'aiTEST0001' }, user);
eq([u1.done, u2.done], [5, 1], 'undo: 4 files + 1 vehicle, and the nickname file');
{ const a0 = JSON.parse(s0), a1 = JSON.parse(snap()), d = [];
  for (const k of new Set([...Object.keys(a0), ...Object.keys(a1)].filter(k => k !== outside.id && k !== evil.id)))   // the test's own two files outside the root for (const f of new Set([...Object.keys(a0[k] || {}), ...Object.keys(a1[k] || {})])) if (JSON.stringify(a0[k]?.[f]) !== JSON.stringify(a1[k]?.[f])) d.push((a0[k]?.name || a1[k]?.name) + ' ' + f + ': ' + JSON.stringify(a0[k]?.[f]) + ' -> ' + JSON.stringify(a1[k]?.[f]));
  eq(d, [], 'Undo AI edit -> Drive exactly as before'); }
eq(JSON.parse(props.AIEDIT_LOG).map(x => x.u), [1, 1], 'batches marked as undone');
eq(A.aiEditUndo.run({ batch: 'aiTEST0001' }, user).done, 0, 'second undo does nothing');

// undo of ONE file (file window) and a file changed again since -> left alone
A.aiEditApply.run({ batch: 'aiTEST0008', customerId: c1.id, items: items.slice(0, 2) }, user);
eq(A.aiEditUndo.run({ batch: 'aiTEST0008', id: files['70-4663'].id }, user).done, 1, 'undo one file only');
eq([Drive.files[files['70-4663'].id].name.includes('โชควไล'), Drive.files[files['70-4662'].id].name.includes('โชควิไล')], [true, true], 'only that file went back');
A.updateFile.run({ file: { id: files['70-4662'].id, name: 'แก้เอง.jpg', type: 'policy', expiry: '', note: '' } });
eq(A.aiEditUndo.run({ batch: 'aiTEST0008' }, user).skipped, 1, 'a file renamed by hand since is skipped');
eq(Drive.files[files['70-4662'].id].name, 'แก้เอง.jpg', 'and keeps the name the user gave');

// only the last 5 batches can be undone
for (let i = 10; i < 15; i++) A.aiEditApply.run({ batch: 'aiTEST00' + i, customerId: c1.id, items: [{ id: files['70-5416'].id, name: 'n' + i + '.jpg' }] }, user);
eq(JSON.parse(props.AIEDIT_LOG).map(x => x.b), ['aiTEST0010', 'aiTEST0011', 'aiTEST0012', 'aiTEST0013', 'aiTEST0014'], 'the log keeps the last 5');
threw = false; try { A.aiEditUndo.run({ batch: 'aiTEST0008' }, user); } catch (e) { threw = true; }
eq(threw, true, 'an older batch can no longer be undone');
eq(A.aiEditUndo.run({ batch: 'aiTEST0014' }, user).done, 1, 'newest first: 14');
eq(A.aiEditUndo.run({ batch: 'aiTEST0013' }, user).done, 1, 'then 13 (the file is as 13 left it again)');
eq(Drive.files[files['70-5416'].id].name, 'n12.jpg', 'back to the name of batch 12');
eq(A.aiEditList.run({}).length, 5, 'aiEditList (admin) returns the log');

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `All ${pass} AI-edit tests passed.`);
process.exit(fail ? 1 : 0);
