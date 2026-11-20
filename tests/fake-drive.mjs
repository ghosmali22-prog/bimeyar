// A small in-memory fake of Google Drive + Apps Script services, and a loader for backend/Code.gs (tests only).
import { readFileSync } from 'node:fs';

export const FOLDER = 'application/vnd.google-apps.folder';
export function fakeDrive() {
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
/** Loads backend/Code.gs against a fresh fake Drive. Returns { B (ACTIONS + helpers), Drive, props, root }. */
export function loadBackend(extra = 'ACTIONS, descSplit') {
  const props = {};
  const PropertiesService = { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; } }) };
  const LockService = { getScriptLock: () => ({ waitLock() { }, releaseLock() { } }) };
  const Utilities = { base64Decode: s => [...Buffer.from(s, 'base64')], newBlob: (b, mime, name) => ({ b, mime, name }), formatDate: (d, tz, f) => f === 'yyyy-MM' ? '2026-11' : '2026-11-21' };
  const Session = { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) };
  const Drive = fakeDrive();
  const gs = readFileSync(new URL('../backend/Code.gs', import.meta.url), 'utf8');
  const B = new Function('Drive', 'PropertiesService', 'LockService', 'Utilities', 'Session', `${gs}\nreturn { ${extra} };`)(Drive, PropertiesService, LockService, Utilities, Session);
  const root = Drive.Files.create({ name: 'RICH INSURANSE', mimeType: FOLDER, appProperties: { bimeyar: 'root' } }).id;
  props.ROOT_ID = root;
  return { B, Drive, props, root };
}
