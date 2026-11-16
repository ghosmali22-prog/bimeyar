/**
 * Bimeyar backend: a Google Apps Script web app owned by the Drive owner.
 *
 * Deploy as:  Execute as = Me,  Who has access = Anyone.
 * Every request is a POST with Content-Type text/plain and a JSON body:
 *   { "token": "<Google ID token>", "action": "<name>", ...params }
 * The ID token is verified on the server (tokeninfo endpoint): audience, verified email, expiry.
 * The caller's email comes only from the verified token, never from the request body.
 *
 * All files live in the "Bimeyar" folder in the owner's My Drive and are owned by the owner.
 * Access list (Script Properties, key ACL): { "email": "admin" | "editor" | "viewer" }.
 * The script owner is always admin and cannot be removed.
 */

// Web OAuth Client ID used by the frontend's "Sign in with Google" (public, not a secret).
const CLIENT_ID = '519755009610-vqs6e182v4rv7p0gu25thalqefrps3lt.apps.googleusercontent.com';
const ROOT_NAME = 'Bimeyar';
const FOLDER = 'application/vnd.google-apps.folder';
const FIELDS = 'id,name,mimeType,size,createdTime,parents,appProperties,description';
const MAX_BYTES = 25 * 1024 * 1024;
const ROLES = ['admin', 'editor', 'viewer'];
const RANK = { viewer: 1, editor: 2, admin: 3 };

/* ============================ entry points ============================ */

function doGet() {
  return json({ ok: true, app: 'bimeyar', hint: 'POST only' });
}

function doPost(e) {
  let req;
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return fail('bad_request', 'Invalid JSON'); }

  let user;
  try { user = verify(req.token); }
  catch (err) { return fail('auth', String(err.message || err)); }

  const role = roleOf(user.email);
  if (!role) return fail('forbidden', 'No access', { email: user.email });

  const fn = ACTIONS[req.action];
  if (!fn) return fail('bad_request', 'Unknown action');
  if (RANK[role] < RANK[fn.need]) return fail('role', 'Not allowed for role ' + role);

  try {
    return json({ ok: true, data: fn.run(req, user, role) });
  } catch (err) {
    console.error(req.action, err && err.stack || err);
    return fail(err.code || 'server', String(err.message || err));
  }
}

/* ============================ actions ============================ */

const ACTIONS = {
  me: { need: 'viewer', run: (req, user, role) => ({ email: user.email, name: user.name, role, owner: ownerEmail() === user.email, root: role === 'admin' ? rootId() : '' }) },

  list: {
    need: 'viewer',
    run: (req, user, role) => {
      const root = rootId();
      const all = [];
      let page;
      do {
        const r = Drive.Files.list({
          q: "appProperties has { key='bimeyar' and value='item' } and trashed=false",
          fields: 'nextPageToken,files(' + FIELDS + ')', pageSize: 1000, pageToken: page, spaces: 'drive',
        });
        (r.files || []).forEach(f => all.push(f));
        page = r.nextPageToken;
      } while (page);
      const customers = all.filter(f => f.mimeType === FOLDER && (f.parents || []).indexOf(root) >= 0).map(toCustomer);
      const ids = {};
      customers.forEach(c => { ids[c.id] = 1; });
      const files = all.filter(f => f.mimeType !== FOLDER && ids[(f.parents || [])[0]]).map(toFile);
      const out = { customers, files };
      if (role === 'admin') {
        try { const q = Drive.About.get({ fields: 'storageQuota' }).storageQuota; out.quota = { used: +q.usage || 0, limit: +q.limit || 0 }; } catch (err) { }
      }
      return out;
    },
  },

  saveCustomer: {
    need: 'editor',
    run: (req, user) => {
      const c = req.customer || {};
      const name = clean(c.name, 120);
      if (!name) throw err('bad_request', 'Name is required');
      const description = JSON.stringify({ phone: clean(c.phone, 40), plate: clean(c.plate, 40), car: clean(c.car, 80), by: user.email });
      if (c.id) {
        assertCustomer(c.id);
        return toCustomer(Drive.Files.update({ name, description }, c.id, null, { fields: FIELDS }));
      }
      return toCustomer(Drive.Files.create({
        name, description, mimeType: FOLDER, parents: [rootId()],
        appProperties: { bimeyar: 'item', kind: 'customer', by: user.email.slice(0, 100) },
      }, null, { fields: FIELDS }));
    },
  },

  deleteCustomer: {
    need: 'editor',
    run: req => { assertCustomer(req.id); Drive.Files.update({ trashed: true }, req.id); return true; },
  },

  upload: {
    need: 'editor',
    run: (req, user) => {
      const m = req.meta || {};
      assertCustomer(m.customerId);
      if (!req.data) throw err('bad_request', 'No file data');
      const bytes = Utilities.base64Decode(req.data);
      if (bytes.length > MAX_BYTES) throw err('too_big', 'File is larger than 25 MB');
      const name = clean(m.name, 200) || 'file';
      const mime = clean(m.mime, 120) || 'application/octet-stream';
      const blob = Utilities.newBlob(bytes, mime, name);
      const f = Drive.Files.create({
        name, mimeType: mime, parents: [m.customerId], description: clean(m.note, 2000),
        appProperties: {
          bimeyar: 'item', kind: 'file', type: type(m.type), expiry: date(m.expiry),
          by: user.email.slice(0, 100), at: new Date().toISOString(),
        },
      }, blob, { fields: FIELDS });
      return toFile(f);
    },
  },

  updateFile: {
    need: 'editor',
    run: req => {
      const f = req.file || {};
      assertFile(f.id);
      return toFile(Drive.Files.update({
        name: clean(f.name, 200) || undefined, description: clean(f.note, 2000),
        appProperties: { type: type(f.type), expiry: date(f.expiry) },
      }, f.id, null, { fields: FIELDS }));
    },
  },

  deleteFile: {
    need: 'editor',
    run: req => { assertFile(req.id); Drive.Files.update({ trashed: true }, req.id); return true; },
  },

  // File content as base64 (files are private, so the browser can't load them from Drive directly)
  getFile: {
    need: 'viewer',
    run: req => {
      assertFile(req.id);
      const blob = DriveApp.getFileById(req.id).getBlob();
      return { mime: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
    },
  },

  // Small thumbnails as data: URLs, cached for 6 hours
  thumbs: {
    need: 'viewer',
    run: req => {
      const cache = CacheService.getScriptCache();
      const ids = (req.ids || []).slice(0, 24).filter(id => /^[\w-]{10,}$/.test(id));
      const hit = cache.getAll(ids.map(id => 'th:' + id));
      const out = {};
      ids.forEach(id => {
        const k = 'th:' + id;
        if (hit[k] !== undefined) { if (hit[k]) out[id] = hit[k]; return; }
        let url = '';
        try {
          assertFile(id);
          const tb = DriveApp.getFileById(id).getThumbnail();
          if (tb) url = 'data:' + (tb.getContentType() || 'image/png') + ';base64,' + Utilities.base64Encode(tb.getBytes());
        } catch (e2) { }
        if (url.length < 95000) { try { cache.put(k, url, url ? 21600 : 600); } catch (e3) { } }
        if (url) out[id] = url;
      });
      return out;
    },
  },

  /* ---------- team / access (admin only) ---------- */
  aclList: { need: 'admin', run: () => aclView() },
  aclSet: {
    need: 'admin',
    run: req => {
      const email = String(req.email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw err('bad_request', 'Invalid email');
      if (ROLES.indexOf(req.role) < 0) throw err('bad_request', 'Invalid role');
      if (email === ownerEmail()) throw err('bad_request', 'The owner is always admin');
      withLock(() => { const acl = aclGet(); acl[email] = req.role; aclPut(acl); });
      return aclView();
    },
  },
  aclRemove: {
    need: 'admin',
    run: req => {
      const email = String(req.email || '').trim().toLowerCase();
      if (email === ownerEmail()) throw err('bad_request', 'The owner cannot be removed');
      withLock(() => { const acl = aclGet(); delete acl[email]; aclPut(acl); });
      return aclView();
    },
  },
};

/* ============================ auth ============================ */

function verify(token) {
  if (!token || typeof token !== 'string' || token.length > 4096) throw new Error('missing token');
  const cache = CacheService.getScriptCache();
  const key = 'tok:' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  const now = Math.floor(Date.now() / 1000);
  const cached = cache.get(key);
  if (cached) {
    const u = JSON.parse(cached);
    if (u.exp > now) return u;
  }
  const r = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('invalid token');
  const t = JSON.parse(r.getContentText());
  if (t.aud !== CLIENT_ID) throw new Error('wrong audience');
  if (t.iss !== 'accounts.google.com' && t.iss !== 'https://accounts.google.com') throw new Error('wrong issuer');
  if (String(t.email_verified) !== 'true') throw new Error('email not verified');
  const exp = parseInt(t.exp, 10);
  if (!(exp > now)) throw new Error('token expired');
  const u = { email: String(t.email).toLowerCase(), name: t.name || '', picture: t.picture || '', exp };
  const ttl = Math.min(exp - now, 3600);
  if (ttl > 30) cache.put(key, JSON.stringify(u), ttl);
  return u;
}

function ownerEmail() {
  return String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
}

function roleOf(email) {
  if (!email) return null;
  if (email === ownerEmail()) return 'admin';
  return aclGet()[email] || null;
}

function aclGet() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('ACL') || '{}'); } catch (e) { return {}; }
}
function aclPut(acl) { PropertiesService.getScriptProperties().setProperty('ACL', JSON.stringify(acl)); }
function aclView() {
  const acl = aclGet();
  const list = Object.keys(acl).sort().map(email => ({ email, role: acl[email] }));
  return [{ email: ownerEmail(), role: 'admin', owner: true }].concat(list);
}

/* ============================ drive helpers ============================ */

function rootId() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('ROOT_ID');
  if (id && alive(id)) return id;
  return withLock(() => {
    id = props.getProperty('ROOT_ID');
    if (id && alive(id)) return id;
    const found = Drive.Files.list({ q: "appProperties has { key='bimeyar' and value='root' } and trashed=false", fields: 'files(id)', spaces: 'drive' }).files || [];
    id = found.length ? found[0].id : Drive.Files.create({ name: ROOT_NAME, mimeType: FOLDER, appProperties: { bimeyar: 'root' } }, null, { fields: 'id' }).id;
    props.setProperty('ROOT_ID', id);
    return id;
  });
}
function alive(id) {
  try { return !Drive.Files.get(id, { fields: 'trashed' }).trashed; } catch (e) { return false; }
}
function meta(id) {
  try { return Drive.Files.get(id, { fields: 'id,mimeType,parents,trashed,appProperties' }); } catch (e) { throw err('not_found', 'Not found'); }
}
// Only items inside the Bimeyar folder can be touched; any other Drive id is refused.
function assertCustomer(id) {
  if (!id) throw err('bad_request', 'Missing id');
  const f = meta(id);
  if (f.trashed || f.mimeType !== FOLDER || (f.parents || []).indexOf(rootId()) < 0) throw err('not_found', 'Customer not found');
  return f;
}
function assertFile(id) {
  if (!id) throw err('bad_request', 'Missing id');
  const f = meta(id);
  if (f.trashed || f.mimeType === FOLDER || !(f.appProperties && f.appProperties.bimeyar === 'item')) throw err('not_found', 'File not found');
  assertCustomer((f.parents || [])[0]);
  return f;
}

function toCustomer(x) {
  let d = {};
  try { d = JSON.parse(x.description || '{}'); } catch (e) { }
  return { id: x.id, name: x.name, phone: d.phone || '', plate: d.plate || '', car: d.car || '', createdAt: x.createdTime, by: d.by || '' };
}
function toFile(x) {
  const ap = x.appProperties || {};
  return {
    id: x.id, customerId: (x.parents || [])[0] || '', name: x.name, type: ap.type || 'other', expiry: ap.expiry || '',
    note: x.description || '', mime: x.mimeType, size: +x.size || 0, createdAt: x.createdTime, by: ap.by || '', at: ap.at || x.createdTime,
  };
}

/* ============================ misc ============================ */

function clean(s, max) { return String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max); }
function type(t) { return ['policy', 'car', 'id', 'claim', 'payment', 'other'].indexOf(t) >= 0 ? t : 'other'; }
function date(d) { return /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : ''; }
function err(code, msg) { const e = new Error(msg); e.code = code; return e; }
function withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function fail(code, message, extra) { return json(Object.assign({ ok: false, error: code, message }, extra || {})); }

/** Run once from the editor to grant Drive access and create the Bimeyar folder. */
function setup() {
  const id = rootId();
  console.log('Owner: ' + ownerEmail() + ' | Bimeyar folder: https://drive.google.com/drive/folders/' + id);
}
