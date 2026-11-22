// A small in-memory fake of Google Drive + Apps Script services, and a loader for backend/Code.gs (tests only).
import { readFileSync } from 'node:fs';

export const FOLDER = 'application/vnd.google-apps.folder';
export function fakeDrive() {
  let n = 0;
  const files = {}, perms = {};
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
    perms,
    permPageSize: 0,
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
    Permissions: {
      list: (id, o = {}) => {
        const all = perms[id] || [], size = Drive.permPageSize || o.pageSize || 100;
        const start = +(o.pageToken || 0), end = start + size;
        return { permissions: all.slice(start, end).map(pick), nextPageToken: end < all.length ? String(end) : undefined };
      },
      create: (res, id) => { (perms[id] ||= []).push({ id: 'p' + (++n), ...res }); },
      update: (res, id, pid) => { Object.assign((perms[id] || []).find(p => p.id === pid) || {}, res); },
      remove: (id, pid) => { perms[id] = (perms[id] || []).filter(p => p.id !== pid); },
    },
    About: { get: () => ({ storageQuota: {} }) },
  };
  return Drive;
}
/** Loads backend/Code.gs against a fresh fake Drive. Returns { B (ACTIONS + helpers), Drive, props, cache, thumbs, root }. */
export function loadBackend(extra = 'ACTIONS, descSplit') {
  const props = {}, cache = {}, thumbs = {};
  const PropertiesService = { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; } }) };
  const CacheService = {
    getScriptCache: () => ({
      get: k => cache[k] ?? null,
      getAll: ks => Object.fromEntries((ks || []).filter(k => k in cache).map(k => [k, cache[k]])),
      put: (k, v) => { cache[k] = String(v); },
      remove: k => { delete cache[k]; },
    }),
  };
  const LockService = { getScriptLock: () => ({ waitLock() { }, releaseLock() { } }) };
  const Utilities = {
    base64Decode: s => [...Buffer.from(s, 'base64')],
    base64Encode: b => Buffer.from(b).toString('base64'),
    newBlob: (b, mime, name) => ({ b, mime, name, getBytes: () => b, getContentType: () => mime }),
    formatDate: (d, tz, f) => f === 'yyyy-MM' ? '2026-11' : '2026-11-21',
  };
  const Session = { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) };
  const Drive = fakeDrive();
  const DriveApp = {
    getFileById: id => ({
      getBlob: () => Utilities.newBlob([1, 2, 3], Drive.files[id]?.mimeType || 'application/pdf', Drive.files[id]?.name || ''),
      getThumbnail: () => (thumbs[id] === null ? null : Utilities.newBlob(thumbs[id] || [137, 80, 78, 71], 'image/png', 'thumb.png')),
    }),
  };
  const gs = readFileSync(new URL('../backend/Code.gs', import.meta.url), 'utf8');
  const B = new Function('Drive', 'PropertiesService', 'CacheService', 'DriveApp', 'LockService', 'Utilities', 'Session', `${gs}\nreturn { ${extra} };`)(Drive, PropertiesService, CacheService, DriveApp, LockService, Utilities, Session);
  const root = Drive.Files.create({ name: 'RICH INSURANSE', mimeType: FOLDER, appProperties: { bimeyar: 'root' } }).id;
  props.ROOT_ID = root;
  return { B, Drive, props, cache, thumbs, root };
}
