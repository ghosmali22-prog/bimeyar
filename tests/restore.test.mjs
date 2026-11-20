// v4.2 "Restore original file names": the backend restorePlan / restoreNames / restoreUndo on a small in-memory
// fake of Google Drive (no network, no real data).  Run: node tests/restore.test.mjs
import { readFileSync } from 'node:fs';

let fail = 0, pass = 0;
const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) { fail++; console.error('FAIL', msg, '\n   got     ', a, '\n   expected', b); } else pass++; };

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
  const split = q => { const out = []; let cur = ''; for (const part of q.split(' and ')) { cur = cur ? cur + ' and ' + part : part; if ((cur.match(/[({]/g) || []).length === (cur.match(/[)}]/g) || []).length) { out.push(cur); cur = ''; } } return out; };
  const setProps = (f, ap) => { f.appProperties ||= {}; for (const k in ap || {}) { if (ap[k] === null) delete f.appProperties[k]; else f.appProperties[k] = ap[k]; } };
  const trashedUp = f => { for (let x = f; x; x = files[(x.parents || [])[0]]) if (x.trashed) return true; return false; };
  const Drive = {
    files,
    Files: {
      get: id => { if (!files[id]) throw new Error('404'); const f = pick(files[id]); f.trashed = trashedUp(files[id]); return f; },
      list: o => ({ files: Object.values(files).filter(f => split(o.q).every(x => one({ ...f, trashed: trashedUp(f) }, x))).map(pick) }),
      create: res => { const id = 'id' + String(++n).padStart(3, '0') + 'xxxxxxxx'; files[id] = { id, createdTime: new Date(Date.now() + n).toISOString(), ...pick(res), appProperties: {} }; setProps(files[id], res.appProperties); return Drive.Files.get(id); },
      update: (res, id, blob, opt = {}) => {
        const f = files[id]; if (!f) throw new Error('404');
        for (const k of ['name', 'description', 'trashed']) if (k in res) f[k] = res[k];
        if (res.appProperties) setProps(f, res.appProperties);
        if (opt && opt.addParents) f.parents = (f.parents || []).filter(p => p !== opt.removeParents).concat([opt.addParents]);
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
const B = new Function('Drive', 'PropertiesService', 'LockService', 'Utilities', 'Session', `${gs}\nreturn { ACTIONS, descSplit, descJoin };`)(Drive, PropertiesService, LockService, Utilities, Session);
const A = B.ACTIONS, user = { email: 'owner@example.com' };
const root = Drive.Files.create({ name: 'RICH INSURANSE', mimeType: FOLDER, appProperties: { bimeyar: 'root' } }).id;
props.ROOT_ID = root;
const snap = () => JSON.stringify(Drive.files);

const c = A.saveCustomer.run({ customer: { name: 'บริษัทโชควิไล ทรานสปอร์ต จำกัด', nick: 'k.beer' } }, user);
const up = (name, folder = 'policy') => A.upload.run({ data: 'eA==', meta: { customerId: c.id, folder, type: 'policy', name, orig: 'IMG_' + name } }, user);
const sub = slot => Object.values(Drive.files).find(f => f.appProperties?.bimeyar === 'sub' && f.appProperties.slot === slot && f.parents[0] === c.id).id;

// a) renamed twice by the rename tool
const f1 = up('ใบเดิมของฉัน.pdf');
A.renameFiles.run({ batch: 'rnA00001', items: [{ id: f1.id, name: 'ชื่อที่สอง' }] });
A.renameFiles.run({ batch: 'rnA00002', items: [{ id: f1.id, name: 'ชื่อที่สาม' }] });
eq(Drive.files[f1.id].name, 'ชื่อที่สาม.pdf', 'renamed twice');
// b) never renamed (only named at upload: "Original file name:") -> never in the list
const f2 = up('70-5416 - โชควิไล ทรานสปอร์ต(7) - กรมธรรม์.pdf');
// c) moved + renamed by "Move to new folders"
const f3 = up('168186.jpg', 'docs');
const v = A.saveVehicle.run({ vehicle: { customerId: c.id, plate: '70-5416', contractDate: '2026-07-04' } }, user);
A.moveNew.run({ batch: 'mvA00001', items: [{ id: f3.id, vehicleId: v.id, slot: '5.3', name: '70-5416 - โชควิไล ทรานสปอร์ต(7) - รูปรถ' }] });
eq(Drive.files[f3.id].parents[0], v.folders['5.3'], 'moved by the move tool');
// d) invoice: never
const inv = Drive.Files.create({ name: 'RI-2026-0001.pdf', mimeType: 'application/pdf', parents: [sub('pay')], description: '{"no":"RI-2026-0001"}', appProperties: { bimeyar: 'item', kind: 'invoice' } });
void inv;
// e) a file outside the root with the same history lines
const outside = Drive.Files.create({ name: 'x', mimeType: FOLDER });
const evil = Drive.Files.create({ name: 'b.pdf', mimeType: 'application/pdf', parents: [outside.id], description: 'Renamed: a.pdf ⇒ b.pdf', appProperties: { bimeyar: 'item' } });

// PREVIEW (read only): "Back" = nothing changed
const s0 = snap();
const plan = A.restorePlan.run({});
eq(snap(), s0, 'restorePlan changes nothing (Back = nothing changed)');
eq(plan.map(r => [r.name, r.old]).sort(), [['70-5416 - โชควิไล ทรานสปอร์ต(7) - รูปรถ.jpg', '168186.jpg'], ['ชื่อที่สาม.pdf', 'ใบเดิมของฉัน.pdf']].sort(), 'renamed twice -> the very first name; move-tool file listed');
eq(plan.some(r => r.id === f2.id), false, 'a file never renamed is not in the list');
eq(plan.some(r => r.id === evil.id), false, 'a file outside the root is not in the list');
eq(plan.find(r => r.id === f3.id).from, { id: sub('docs'), name: '02_เอกสาร', ok: true }, 'previous folder known and still there');
eq(plan.find(r => r.id === f1.id).from, null, 'a file only renamed has no previous folder');

// APPLY: f1 name only, f3 name + previous folder
const r1 = A.restoreNames.run({ batch: 'rsA00001', items: [{ id: f1.id, name: 'ใบเดิมของฉัน.pdf' }, { id: f3.id, name: '168186.jpg', back: true }] });
eq(r1.rows.map(r => [r.status, r.name, !!r.moved]), [['ok', 'ใบเดิมของฉัน.pdf', false], ['ok', '168186.jpg', true]], 'restored');
eq(Drive.files[f3.id].parents[0], sub('docs'), 'name + previous folder: back in 02_เอกสาร');
const meta1 = B.descSplit(Drive.files[f1.id].description).meta;
eq(meta1.filter(l => l.startsWith('Renamed: ')).length, 2, 'history lines kept');
eq(meta1.at(-1), 'Restored: ชื่อที่สาม.pdf ⇒ ใบเดิมของฉัน.pdf', '"Restored: new ⇒ old" added');
eq(props.RESTORE_LAST, 'rsA00001', 'last restore remembered');
eq(A.restorePlan.run({}).length, 0, 'after restore nothing is left in the list');
eq(Object.values(Drive.files).filter(f => f.trashed).length, 0, 'nothing deleted');
eq(A.restoreNames.run({ batch: 'rsEVIL001', items: [{ id: evil.id }] }).rows[0].status, 'error', 'a file outside the root is refused');
eq(A.restoreNames.run({ batch: 'rsINV0001', items: [{ id: inv.id, name: 'x.pdf' }] }).rows[0].status, 'invoice', 'an invoice is never renamed');
eq(props.RESTORE_LAST, 'rsA00001', 'a batch that restored nothing keeps the previous undo');

// UNDO restore
const u = A.restoreUndo.run({});
eq([u.done, u.skipped], [2, 0], 'undo restore: both put back');
eq([Drive.files[f1.id].name, Drive.files[f3.id].name, Drive.files[f3.id].parents[0]], ['ชื่อที่สาม.pdf', '70-5416 - โชควิไล ทรานสปอร์ต(7) - รูปรถ.jpg', v.folders['5.3']], 'undo: names and folder back');
eq(B.descSplit(Drive.files[f1.id].description).meta.some(l => l.startsWith('Restored: ')), false, 'undo removes its Restored line');
eq(Drive.files[f1.id].appProperties.rsb, undefined, 'undo removes the tags');
eq(A.restoreUndo.run({}).done, 0, 'second undo does nothing');

// name already taken -> " (2)"
const taken = up('ใบเดิมของฉัน.pdf');
eq(taken.name, 'ใบเดิมของฉัน.pdf', 'someone saved a new file with the old name');
eq(A.restoreNames.run({ batch: 'rsA00002', items: [{ id: f1.id }] }).rows[0].name, 'ใบเดิมของฉัน (2).pdf', 'old name taken in the folder -> " (2)"');

// previous folder no longer exists -> name only, the file stays, a message
Drive.Files.update({ trashed: true }, sub('docs'));
const p2 = A.restorePlan.run({}).find(r => r.id === f3.id);
eq(p2.from.ok, false, 'previous folder gone: shown in the preview');
const r3 = A.restoreNames.run({ batch: 'rsA00003', items: [{ id: f3.id, back: true }] }).rows[0];
eq([r3.status, r3.name, !!r3.moved, r3.note], ['ok', '168186.jpg', false, 'folder_gone'], 'folder gone -> only the name, with a message');
eq(Drive.files[f3.id].parents[0], v.folders['5.3'], 'the file stays where it is');
eq(Object.values(Drive.files).filter(f => f.name === '02_เอกสาร' && !f.trashed).length, 0, 'the old folder is NOT re-created');

// the oldest name is never lost, even after many renames
let d = 'Original file name: a.pdf';
for (let i = 1; i <= 14; i++) d = B.descJoin('', B.descSplit(d).meta.concat([`Renamed: n${i - 1}.pdf ⇒ n${i}.pdf`]));
const rl = B.descSplit(d).meta.filter(l => l.startsWith('Renamed: '));
eq([rl.length, rl[0], rl.at(-1)], [10, 'Renamed: n0.pdf ⇒ n1.pdf', 'Renamed: n13.pdf ⇒ n14.pdf'], 'description keeps the FIRST rename + the last 9');

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `All ${pass} restore tests passed.`);
process.exit(fail ? 1 : 0);
