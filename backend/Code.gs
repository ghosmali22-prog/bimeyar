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
 *
 * Script Properties used:
 *   ACL             access list (see above)
 *   ROOT_ID         id of the "Bimeyar" folder (set automatically)
 *   GEMINI_API_KEY  Google AI Studio key for document reading (set by the owner, never in the repo)
 *   COMPANY         company info for invoices (set from the app, admin only)
 *   INV_SEQ         last invoice number per year (set automatically, under a lock)
 *   AI_LOG          last 200 AI calls: time, ms, size, tokens, result. No customer data.
 */

// Web OAuth Client ID used by the frontend's "Sign in with Google" (public, not a secret).
const CLIENT_ID = '519755009610-vqs6e182v4rv7p0gu25thalqefrps3lt.apps.googleusercontent.com';
const ROOT_NAME = 'Bimeyar';
const FOLDER = 'application/vnd.google-apps.folder';
const FIELDS = 'id,name,mimeType,size,createdTime,parents,appProperties,description';
const MAX_BYTES = 25 * 1024 * 1024;
const ROLES = ['admin', 'editor', 'viewer'];
const RANK = { viewer: 1, editor: 2, admin: 3 };

/**
 * The 4 sub-folders inside every customer folder. Folders are found by their `slot`
 * (stored in appProperties), not by name, so a name can be changed here later.
 * Renaming here only affects NEW folders; existing folders keep their name in Drive.
 */
const SUBFOLDERS = [
  { slot: 'policy', name: '01_กรมธรรม์' },             // insurance policy
  { slot: 'docs', name: '02_เอกสาร' },                 // vehicle book, ID card, ...
  { slot: 'prev', name: '03_กรมธรรม์เดิม' },           // previous policy
  { slot: 'pay', name: '04_หลักฐานการชำระเงิน' },      // payment receipts + invoices
];
const SLOTS = SUBFOLDERS.map(s => s.slot);

/** Gemini model used for reading documents. Change here only. */
const GEMINI_MODEL = 'gemini-3.8-flash';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/';
const AI_MAX_BYTES = 18 * 1024 * 1024;

/** Optional customer fields, stored as JSON in the customer folder's description. All are optional. */
const CFIELDS = {
  phone: 40, plate: 40, car: 80,                                        // v2 fields
  nameEn: 120, idNo: 20, address: 300, dob: 'date',
  brand: 40, model: 60, year: 4, color: 30, province: 60, vin: 40, engineNo: 40,
  insurer: 80, policyNo: 60, policyType: 60, coverage: 20, premium: 20,
  policyStart: 'date', policyExpiry: 'date', note: 500,
};

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
  me: { need: 'viewer', run: (req, user, role) => ({ email: user.email, name: user.name, role, owner: ownerEmail() === user.email, root: role === 'admin' ? rootId() : '', ai: !!aiKey(), v: 3 }) },

  list: {
    need: 'viewer',
    run: (req, user, role) => {
      const root = rootId();
      const all = listAll("appProperties has { key='bimeyar' and value='item' } and trashed=false");
      const subs = listAll("appProperties has { key='bimeyar' and value='sub' } and trashed=false");
      const customers = all.filter(f => f.mimeType === FOLDER && (f.parents || []).indexOf(root) >= 0).map(toCustomer);
      const ids = {};
      customers.forEach(c => { ids[c.id] = c; c.folders = {}; });
      const subOf = {};   // sub-folder id -> { customer, slot }
      subs.forEach(s => {
        const cid = (s.parents || [])[0], slot = (s.appProperties || {}).slot;
        if (ids[cid] && SLOTS.indexOf(slot) >= 0) { subOf[s.id] = { customer: cid, slot }; ids[cid].folders[slot] = s.id; }
      });
      const files = [], invoices = [];
      all.forEach(f => {
        if (f.mimeType === FOLDER) return;
        const p = (f.parents || [])[0];
        let cid = '', slot = '';
        if (ids[p]) cid = p; else if (subOf[p]) { cid = subOf[p].customer; slot = subOf[p].slot; }
        if (!cid) return;
        const x = toFile(f, cid, slot);
        files.push(x);
        if (x.invoice) invoices.push(toInvoice(f, cid));
      });
      const out = { customers, files, invoices };
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
      let old = {};
      if (c.id) {
        const m = assertCustomer(c.id);
        try { old = JSON.parse(Drive.Files.get(c.id, { fields: 'description' }).description || '{}'); } catch (e) { old = {}; }
      }
      // Merge: fields not sent by the client keep their old value; unknown old keys are kept as they are.
      const d = Object.assign({}, old);
      Object.keys(CFIELDS).forEach(k => {
        if (!Object.prototype.hasOwnProperty.call(c, k)) return;
        const v = CFIELDS[k] === 'date' ? date(c[k]) : clean(c[k], CFIELDS[k]);
        if (v) d[k] = v; else delete d[k];
      });
      if (d.policyStart && d.policyExpiry && d.policyExpiry <= d.policyStart) throw err('bad_request', 'Expiry must be after start');
      d.by = old.by || user.email;
      if (c.id) d.updBy = user.email;
      const description = JSON.stringify(d);
      if (c.id) return toCustomer(Drive.Files.update({ name, description }, c.id, null, { fields: FIELDS }));
      const f = Drive.Files.create({
        name, description, mimeType: FOLDER, parents: [rootId()],
        appProperties: { bimeyar: 'item', kind: 'customer', by: user.email.slice(0, 100) },
      }, null, { fields: FIELDS });
      const out = toCustomer(f);
      out.folders = ensureSubs(f.id, false).folders;
      return out;
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
      // New in v3: a sub-folder slot. Without one (old clients) the file goes into the customer folder, as before.
      let parent = m.customerId;
      if (m.folder) {
        if (SLOTS.indexOf(m.folder) < 0) throw err('bad_request', 'Unknown folder');
        parent = ensureSubs(m.customerId, false).folders[m.folder];
      }
      const blob = Utilities.newBlob(bytes, mime, name);
      const f = Drive.Files.create({
        name, mimeType: mime, parents: [parent], description: clean(m.note, 2000),
        appProperties: {
          bimeyar: 'item', kind: 'file', type: type(m.type), expiry: date(m.expiry),
          by: user.email.slice(0, 100), at: new Date().toISOString(),
        },
      }, blob, { fields: FIELDS });
      return toFile(f, m.customerId, m.folder || '');
    },
  },

  updateFile: {
    need: 'editor',
    run: req => {
      const f = req.file || {};
      const m = assertFile(f.id);
      const own = ownerOf(m);
      const res = { name: clean(f.name, 200) || undefined, appProperties: { type: type(f.type), expiry: date(f.expiry) } };
      // An invoice keeps its data in the description; never overwrite it with a note.
      if (!(m.appProperties && m.appProperties.kind === 'invoice')) res.description = clean(f.note, 2000);
      return toFile(Drive.Files.update(res, f.id, null, { fields: FIELDS }), own.customer, own.slot);
    },
  },

  /** Moves a file into one of the 4 sub-folders of ITS OWN customer. Nothing else is changed. */
  moveFile: {
    need: 'editor',
    run: req => {
      const m = assertFile(req.id);
      if (SLOTS.indexOf(req.folder) < 0) throw err('bad_request', 'Unknown folder');
      const own = ownerOf(m);
      const target = ensureSubs(own.customer, false).folders[req.folder];
      const from = (m.parents || [])[0];
      if (from === target) return toFile(Drive.Files.get(req.id, { fields: FIELDS }), own.customer, req.folder);
      const f = Drive.Files.update({}, req.id, null, { addParents: target, removeParents: from, fields: FIELDS });
      return toFile(f, own.customer, req.folder);
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

  /* ---------- sub-folder migration (admin only) ---------- */
  /**
   * Creates the missing sub-folders for existing customers. It only CREATES folders:
   * it never moves, renames or deletes any file or folder. An existing untagged folder with exactly
   * the right name is adopted (a tag is added to it, nothing else changes).
   * dryRun: true -> only reports. Works in batches (`from`, `limit`) to stay inside the 6 minute limit.
   */
  migrateFolders: {
    need: 'admin',
    run: req => {
      const root = rootId();
      const customers = listAll("'" + root + "' in parents and mimeType='" + FOLDER + "' and trashed=false and appProperties has { key='bimeyar' and value='item' }")
        .sort((a, b) => a.id < b.id ? -1 : 1);
      const from = Math.max(0, +req.from || 0), limit = Math.min(80, Math.max(1, +req.limit || 40));
      const rows = [];
      const t0 = Date.now();
      let i = from;
      for (; i < customers.length && i < from + limit && Date.now() - t0 < 240000; i++) {
        const c = customers[i];
        const r = ensureSubs(c.id, !!req.dryRun);
        const loose = Drive.Files.list({ q: "'" + c.id + "' in parents and trashed=false and mimeType!='" + FOLDER + "'", fields: 'files(id)', pageSize: 1000 }).files || [];
        rows.push({ id: c.id, name: c.name, create: r.create, adopt: r.adopt, have: r.have, loose: loose.length });
      }
      return { dryRun: !!req.dryRun, total: customers.length, from, next: i < customers.length ? i : null, rows };
    },
  },

  /* ---------- company settings (read: everyone, write: admin) ---------- */
  getSettings: { need: 'viewer', run: () => settingsView(true) },
  saveSettings: {
    need: 'admin',
    run: req => {
      const s = req.settings || {};
      return withLock(() => {
        const cur = companyGet();
        ['name', 'nameEn', 'address', 'phone', 'email', 'taxId', 'bank', 'footer'].forEach(k => {
          if (Object.prototype.hasOwnProperty.call(s, k)) cur[k] = clean(s[k], k === 'address' || k === 'bank' || k === 'footer' ? 600 : 160);
        });
        if (Object.prototype.hasOwnProperty.call(s, 'prefix')) cur.prefix = (clean(s.prefix, 8).toUpperCase().replace(/[^A-Z0-9]/g, '')) || 'RI';
        if (s.logo && s.logo.data) {
          const bytes = Utilities.base64Decode(s.logo.data);
          if (bytes.length > 2 * 1024 * 1024) throw err('too_big', 'Logo must be under 2 MB');
          const mime = /^image\/(png|jpeg|webp)$/.test(s.logo.mime) ? s.logo.mime : 'image/png';
          const f = Drive.Files.create({ name: 'company-logo', mimeType: mime, parents: [rootId()], appProperties: { bimeyar: 'logo' } },
            Utilities.newBlob(bytes, mime, 'company-logo'), { fields: 'id' });
          cur.logoId = f.id;   // the old logo file stays in Drive; nothing is deleted
        }
        if (s.removeLogo) cur.logoId = '';
        companyPut(cur);
        return settingsView(true);
      });
    },
  },

  /* ---------- invoices ---------- */
  createInvoice: {
    need: 'editor',
    run: (req, user) => {
      const inv = invoiceClean(req.invoice || {});
      assertCustomer(inv.customerId);
      // Number is taken under a lock, so two people can never get the same number.
      inv.no = withLock(() => nextInvoiceNo(inv.issue));
      inv.createdBy = user.email; inv.createdAt = new Date().toISOString();
      const pdf = invoicePdf(inv, req.dateFmt);
      const folder = ensureSubs(inv.customerId, false).folders.pay;
      const f = Drive.Files.create({
        name: inv.no + '.pdf', mimeType: 'application/pdf', parents: [folder], description: JSON.stringify(inv),
        appProperties: invoiceProps(inv, user),
      }, pdf, { fields: FIELDS });
      return toInvoice(f, inv.customerId);
    },
  },
  /** Changes an invoice (e.g. mark as paid) and re-generates its PDF. The number never changes.
   *  The PDF content is replaced as a new revision of the same Drive file, so Drive keeps the old version. */
  updateInvoice: {
    need: 'editor',
    run: (req, user) => {
      const m = assertFile(req.id);
      if (!(m.appProperties && m.appProperties.kind === 'invoice')) throw err('not_found', 'Invoice not found');
      let old = {};
      try { old = JSON.parse(Drive.Files.get(req.id, { fields: 'description' }).description || '{}'); } catch (e) { }
      const inv = invoiceClean(Object.assign({}, old, req.invoice || {}, { customerId: old.customerId || ownerOf(m).customer }));
      inv.no = old.no; inv.createdBy = old.createdBy; inv.createdAt = old.createdAt; inv.updatedAt = new Date().toISOString(); inv.updatedBy = user.email;
      const pdf = invoicePdf(inv, req.dateFmt);
      const f = Drive.Files.update({ description: JSON.stringify(inv), appProperties: invoiceProps(inv, user) }, req.id, pdf, { fields: FIELDS });
      return toInvoice(f, ownerOf(m).customer);
    },
  },

  /* ---------- AI document reading (Gemini) ---------- */
  aiExtract: {
    need: 'editor',
    run: req => aiExtract(req),
  },
  aiUsage: {
    need: 'admin',
    run: () => { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('AI_LOG') || '[]'); } catch (e) { return []; } },
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

function listAll(q) {
  const out = [];
  let page;
  do {
    const r = Drive.Files.list({ q, fields: 'nextPageToken,files(' + FIELDS + ')', pageSize: 1000, pageToken: page, spaces: 'drive' });
    (r.files || []).forEach(f => out.push(f));
    page = r.nextPageToken;
  } while (page);
  return out;
}

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
/** A file may sit directly in a customer folder (v2) or in one of its sub-folders (v3). */
function assertFile(id) {
  if (!id) throw err('bad_request', 'Missing id');
  const f = meta(id);
  if (f.trashed || f.mimeType === FOLDER || !(f.appProperties && f.appProperties.bimeyar === 'item')) throw err('not_found', 'File not found');
  ownerOf(f);
  return f;
}
/** Returns { customer, slot } for a file's parent, or throws if it is not inside a customer folder. */
function ownerOf(f) {
  const p = (f.parents || [])[0];
  const pm = meta(p);
  if (pm.appProperties && pm.appProperties.bimeyar === 'sub') {
    const cid = (pm.parents || [])[0];
    assertCustomer(cid);
    if (pm.trashed) throw err('not_found', 'File not found');
    return { customer: cid, slot: pm.appProperties.slot || '' };
  }
  assertCustomer(p);
  return { customer: p, slot: '' };
}

/**
 * Makes sure a customer folder has the 4 sub-folders. Only creates (or tags an exact-name match).
 * With dryRun nothing is written. Returns { folders: {slot: id}, create: [names], adopt: [names], have: n }.
 */
function ensureSubs(customerId, dryRun) {
  const kids = Drive.Files.list({ q: "'" + customerId + "' in parents and mimeType='" + FOLDER + "' and trashed=false", fields: 'files(id,name,appProperties)', pageSize: 200 }).files || [];
  const out = { folders: {}, create: [], adopt: [], have: 0 };
  SUBFOLDERS.forEach(s => {
    let hit = kids.filter(k => k.appProperties && k.appProperties.bimeyar === 'sub' && k.appProperties.slot === s.slot)[0];
    if (hit) { out.folders[s.slot] = hit.id; out.have++; return; }
    hit = kids.filter(k => k.name === s.name && !(k.appProperties && k.appProperties.bimeyar))[0];
    if (hit) {
      out.adopt.push(s.name);
      if (!dryRun) Drive.Files.update({ appProperties: { bimeyar: 'sub', slot: s.slot } }, hit.id);
      out.folders[s.slot] = hit.id;
      return;
    }
    out.create.push(s.name);
    if (!dryRun) {
      out.folders[s.slot] = withLock(() => {
        // check again inside the lock so two uploads at once never make duplicate folders
        const again = Drive.Files.list({ q: "'" + customerId + "' in parents and mimeType='" + FOLDER + "' and trashed=false and appProperties has { key='slot' and value='" + s.slot + "' }", fields: 'files(id)' }).files || [];
        if (again.length) return again[0].id;
        return Drive.Files.create({ name: s.name, mimeType: FOLDER, parents: [customerId], appProperties: { bimeyar: 'sub', slot: s.slot } }, null, { fields: 'id' }).id;
      });
    }
  });
  return out;
}

function toCustomer(x) {
  let d = {};
  try { d = JSON.parse(x.description || '{}'); } catch (e) { }
  const c = { id: x.id, name: x.name, createdAt: x.createdTime, by: d.by || '' };
  Object.keys(CFIELDS).forEach(k => { c[k] = d[k] || ''; });
  return c;
}
function toFile(x, customerId, slot) {
  const ap = x.appProperties || {};
  const inv = ap.kind === 'invoice';
  return {
    id: x.id, customerId: customerId || (x.parents || [])[0] || '', folder: slot || '', name: x.name, type: ap.type || 'other', expiry: ap.expiry || '',
    note: inv ? '' : (x.description || ''), mime: x.mimeType, size: +x.size || 0, createdAt: x.createdTime, by: ap.by || '', at: ap.at || x.createdTime,
    invoice: inv ? (ap.invNo || x.name) : '',
  };
}

/* ============================ company settings ============================ */

function companyGet() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('COMPANY') || '{}'); } catch (e) { return {}; }
}
function companyPut(c) { PropertiesService.getScriptProperties().setProperty('COMPANY', JSON.stringify(c)); }
function settingsView(withLogo) {
  const c = companyGet();
  const out = { name: c.name || 'RICH INSURANS', nameEn: c.nameEn || '', address: c.address || '', phone: c.phone || '', email: c.email || '', taxId: c.taxId || '', bank: c.bank || '', footer: c.footer || '', prefix: c.prefix || 'RI', logo: '' };
  if (withLogo && c.logoId) {
    try {
      const tb = DriveApp.getFileById(c.logoId).getBlob();
      if (tb.getBytes().length < 600000) out.logo = 'data:' + tb.getContentType() + ';base64,' + Utilities.base64Encode(tb.getBytes());
    } catch (e) { }
  }
  return out;
}

/* ============================ invoices ============================ */

const INV_STATUS = ['unpaid', 'partial', 'paid'];

/** Money is handled in satang (integer) so totals never get rounding errors. */
function satang(v) {
  const n = Number(String(v == null ? '' : v).replace(/[,\s฿]/g, ''));
  if (!isFinite(n)) throw err('bad_request', 'Invalid amount');
  if (n < 0) throw err('bad_request', 'Amounts cannot be negative');
  return Math.round(n * 100);
}
/**
 * THE invoice calculation. js/invoice.js `calcTotals` is an exact copy for the live preview only;
 * the numbers saved and printed always come from here.
 */
function invoiceTotals(items, discount, vat, paid) {
  let sub = 0;
  items.forEach(it => { sub += Math.round(it.q * satang(it.p)); });
  const disc = satang(discount);
  if (disc > sub) throw err('bad_request', 'Discount is larger than the subtotal');
  const net = sub - disc;
  const v = vat ? Math.round(net * 7 / 100) : 0;
  const total = net + v;
  const pd = satang(paid);
  if (pd > total) throw err('bad_request', 'Amount paid is larger than the total');
  const status = pd === 0 ? (total === 0 ? 'paid' : 'unpaid') : pd >= total ? 'paid' : 'partial';
  const b = n => n / 100;
  return { sub: b(sub), disc: b(disc), net: b(net), vat: b(v), total: b(total), paid: b(pd), bal: b(total - pd), status };
}

function invoiceClean(x) {
  const s = (v, n) => clean(v, n);
  const items = (Array.isArray(x.items) ? x.items : []).slice(0, 60).map(it => {
    const q = Number(it.q);
    if (!isFinite(q) || q <= 0) throw err('bad_request', 'Quantity must be more than 0');
    return { d: s(it.d, 200), q: Math.round(q * 1000) / 1000, p: satang(it.p) / 100 };
  }).filter(it => it.d || it.p);
  if (!items.length) throw err('bad_request', 'Add at least one line item');
  const issue = date(x.issue) || Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
  const due = date(x.due);
  if (due && due < issue) throw err('bad_request', 'Due date is before the issue date');
  const inv = {
    v: 1, customerId: s(x.customerId, 80), issue, due, lang: ['th', 'en', 'both'].indexOf(x.lang) >= 0 ? x.lang : 'both',
    cust: { name: s(x.cust && x.cust.name, 160), phone: s(x.cust && x.cust.phone, 40), address: s(x.cust && x.cust.address, 300) },
    veh: { brand: s(x.veh && x.veh.brand, 40), model: s(x.veh && x.veh.model, 60), plate: s(x.veh && x.veh.plate, 40), province: s(x.veh && x.veh.province, 60) },
    pol: { type: s(x.pol && x.pol.type, 60), insurer: s(x.pol && x.pol.insurer, 80), no: s(x.pol && x.pol.no, 60), start: date(x.pol && x.pol.start), end: date(x.pol && x.pol.end) },
    items, discount: satang(x.discount) / 100, vat: !!x.vat, paid: satang(x.paid) / 100, notes: s(x.notes, 500),
  };
  if (!inv.cust.name) throw err('bad_request', 'Customer name is required');
  inv.t = invoiceTotals(inv.items, inv.discount, inv.vat, inv.paid);
  inv.status = inv.t.status;
  return inv;
}

function nextInvoiceNo(issue) {
  const props = PropertiesService.getScriptProperties();
  const year = (issue || '').slice(0, 4) || Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy');
  let seq = {};
  try { seq = JSON.parse(props.getProperty('INV_SEQ') || '{}'); } catch (e) { }
  const prefix = companyGet().prefix || 'RI';
  let n = (seq[year] || 0) + 1, no;
  // Extra safety: skip any number that already exists in Drive
  for (let i = 0; i < 50; i++) {
    no = prefix + '-' + year + '-' + ('000' + n).slice(-4);
    const dup = Drive.Files.list({ q: "appProperties has { key='invNo' and value='" + no + "' } and trashed=false", fields: 'files(id)' }).files || [];
    if (!dup.length) break;
    n++;
  }
  seq[year] = n;
  props.setProperty('INV_SEQ', JSON.stringify(seq));
  return no;
}

function invoiceProps(inv, user) {
  return {
    bimeyar: 'item', kind: 'invoice', type: 'payment', invNo: inv.no, status: inv.status,
    total: String(inv.t.total), by: user.email.slice(0, 100), at: new Date().toISOString(), expiry: '',
  };
}
function toInvoice(f, customerId) {
  let d = {};
  try { d = JSON.parse(f.description || '{}'); } catch (e) { }
  d.id = f.id; d.customerId = customerId; d.fileName = f.name; d.createdTime = f.createdTime;
  d.no = d.no || (f.appProperties || {}).invNo || f.name;
  d.status = d.status || (f.appProperties || {}).status || 'unpaid';
  return d;
}

/* ---------- invoice PDF (Google Docs -> PDF, Sarabun font, so Thai always renders correctly) ---------- */

const L = {
  title: ['ใบแจ้งหนี้', 'INVOICE'], no: ['เลขที่', 'Invoice no.'], issue: ['วันที่ออก', 'Issue date'], due: ['ครบกำหนด', 'Due date'],
  billTo: ['ลูกค้า', 'Bill to'], vehicle: ['รถยนต์', 'Vehicle'], policy: ['กรมธรรม์', 'Policy'], insurer: ['บริษัทประกัน', 'Insurer'],
  period: ['ระยะเวลาคุ้มครอง', 'Coverage period'], plate: ['ทะเบียน', 'Plate'], ptype: ['ประเภท', 'Type'], pno: ['เลขกรมธรรม์', 'Policy no.'],
  desc: ['รายการ', 'Description'], qty: ['จำนวน', 'Qty'], price: ['ราคาต่อหน่วย', 'Unit price'], amount: ['จำนวนเงิน', 'Amount'],
  sub: ['รวม', 'Subtotal'], disc: ['ส่วนลด', 'Discount'], vat: ['ภาษีมูลค่าเพิ่ม 7%', 'VAT 7%'], total: ['ยอดรวมทั้งสิ้น', 'Total'],
  paid: ['ชำระแล้ว', 'Amount paid'], bal: ['ยอดคงเหลือ', 'Balance due'], pay: ['ช่องทางการชำระเงิน', 'Payment details'],
  tax: ['เลขประจำตัวผู้เสียภาษี', 'Tax ID'], tel: ['โทร', 'Tel'], notes: ['หมายเหตุ', 'Notes'],
  unpaid: ['ยังไม่ชำระ', 'UNPAID'], partial: ['ชำระบางส่วน', 'PARTIALLY PAID'], paidS: ['ชำระแล้ว', 'PAID'],
};
function lbl(k, lang) { const x = L[k]; return lang === 'th' ? x[0] : lang === 'en' ? x[1] : x[0] + ' / ' + x[1]; }
function baht(n) {
  const neg = n < 0, s = Math.abs(Math.round(n * 100) / 100).toFixed(2).split('.');
  return (neg ? '-' : '') + '฿' + s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + s[1];
}
function dmy(iso, fmt) {
  if (!iso) return '—';
  const p = iso.split('-');
  return p[2] + '/' + p[1] + '/' + (fmt === 'be' ? (+p[0] + 543) : p[0]);
}

function invoicePdf(inv, dateFmt) {
  const co = companyGet(), lang = inv.lang, A = DocumentApp.Attribute, H = DocumentApp.HorizontalAlignment;
  const INK = '#1f2430', MUTED = '#6b7280', ACCENT = '#2f5bea', LINE = '#e5e7eb', SOFT = '#f3f5f9';
  const doc = DocumentApp.create('tmp-' + inv.no);
  const docId = doc.getId();
  try {
    const body = doc.getBody();
    body.setPageWidth(595.28).setPageHeight(841.89).setMarginTop(40).setMarginBottom(40).setMarginLeft(46).setMarginRight(46);
    const base = {}; base[A.FONT_FAMILY] = 'Sarabun'; base[A.FONT_SIZE] = 10; base[A.FOREGROUND_COLOR] = INK; base[A.LINE_SPACING] = 1.1;
    body.setAttributes(base);

    const style = (p, o, defSize, defColor, after) => {
      const a = {};
      a[A.FONT_FAMILY] = 'Sarabun'; a[A.FONT_SIZE] = o.size || defSize; a[A.BOLD] = !!o.bold;
      a[A.FOREGROUND_COLOR] = o.color || defColor; a[A.SPACING_AFTER] = after; a[A.SPACING_BEFORE] = 0;
      p.setAttributes(a);
      if (o.align) p.setAlignment(o.align);
      return p;
    };
    const para = (el, text, o) => { o = o || {}; return style(el.appendParagraph(text), o, 10, INK, o.after == null ? 1 : o.after); };
    const cellText = (cell, text, o) => {
      o = o || {};
      const p = cell.getChild(0).asParagraph();
      p.setText(text || '');
      style(p, o, 10, INK, 0);
      cell.setPaddingTop(o.pad == null ? 5 : o.pad).setPaddingBottom(o.pad == null ? 5 : o.pad).setPaddingLeft(6).setPaddingRight(6);
      if (o.bg) cell.setBackgroundColor(o.bg);
      return p;
    };
    const cellMore = (cell, text, o) => { if (!text) return; o = o || {}; style(cell.appendParagraph(text), o, 9, MUTED, 0); };

    // ---- header: logo left, company right
    const head = body.appendTable([['', '']]);
    head.setBorderWidth(0);
    head.setColumnWidth(0, 230);
    const hl = head.getCell(0, 0), hr = head.getCell(0, 1);
    cellText(hl, '', { pad: 0 });
    if (co.logoId) {
      try {
        const img = hl.getChild(0).asParagraph().appendInlineImage(DriveApp.getFileById(co.logoId).getBlob());
        const k = Math.min(1, 150 / img.getWidth(), 60 / img.getHeight());
        img.setWidth(Math.round(img.getWidth() * k)).setHeight(Math.round(img.getHeight() * k));
      } catch (e) { cellText(hl, co.name || 'RICH INSURANS', { bold: true, size: 16, pad: 0 }); }
    } else cellText(hl, co.name || 'RICH INSURANS', { bold: true, size: 16, color: ACCENT, pad: 0 });
    cellText(hr, co.name || 'RICH INSURANS', { bold: true, size: 12, align: H.RIGHT, pad: 0 });
    if (co.nameEn) cellMore(hr, co.nameEn, { align: H.RIGHT });
    if (co.address) co.address.split(/\n/).forEach(l => cellMore(hr, l, { align: H.RIGHT }));
    if (co.phone || co.email) cellMore(hr, [co.phone ? lbl('tel', lang === 'both' ? 'en' : lang) + ' ' + co.phone : '', co.email].filter(String).join('  ·  '), { align: H.RIGHT });
    if (co.taxId) cellMore(hr, lbl('tax', lang) + ' ' + co.taxId, { align: H.RIGHT });

    // ---- title + status
    para(body, '', { after: 6 });
    const tp = para(body, lbl('title', lang), { size: 20, bold: true, color: ACCENT, after: 2 });
    const stKey = inv.status === 'paid' ? 'paidS' : inv.status;
    para(body, lbl(stKey, lang), { size: 9, bold: true, color: inv.status === 'paid' ? '#15803d' : inv.status === 'partial' ? '#b45309' : '#b91c1c', after: 8 });

    // ---- info block: bill to (left) / invoice meta (right)
    const info = body.appendTable([['', '']]);
    info.setBorderWidth(0);
    info.setColumnWidth(0, 270);
    const il = info.getCell(0, 0), ir = info.getCell(0, 1);
    cellText(il, lbl('billTo', lang), { size: 8, bold: true, color: MUTED, pad: 2 });
    cellMore(il, inv.cust.name, { size: 11, bold: true, color: INK });
    cellMore(il, inv.cust.phone);
    if (inv.cust.address) inv.cust.address.split(/\n/).forEach(l => cellMore(il, l));
    cellText(ir, lbl('no', lang) + ':  ' + inv.no, { bold: true, align: H.RIGHT, pad: 2 });
    cellMore(ir, lbl('issue', lang) + ':  ' + dmy(inv.issue, dateFmt), { align: H.RIGHT, color: INK });
    if (inv.due) cellMore(ir, lbl('due', lang) + ':  ' + dmy(inv.due, dateFmt), { align: H.RIGHT, color: INK });

    // ---- vehicle & policy
    const v = inv.veh, p = inv.pol;
    const vehLine = [v.brand, v.model].filter(String).join(' ') + (v.plate ? '  ·  ' + lbl('plate', lang) + ' ' + v.plate + (v.province ? ' ' + v.province : '') : '');
    const polLine = [p.type ? lbl('ptype', lang) + ' ' + p.type : '', p.insurer ? lbl('insurer', lang) + ' ' + p.insurer : '', p.no ? lbl('pno', lang) + ' ' + p.no : ''].filter(String).join('  ·  ');
    const perLine = p.start || p.end ? lbl('period', lang) + ':  ' + dmy(p.start, dateFmt) + ' – ' + dmy(p.end, dateFmt) : '';
    if (vehLine.trim() || polLine || perLine) {
      para(body, '', { after: 4 });
      const vp = body.appendTable([['']]);
      vp.setBorderWidth(0);
      const c = vp.getCell(0, 0);
      cellText(c, '', { bg: SOFT, pad: 8 });
      let first = true;
      const line = (k, t) => { if (!t.trim()) return; if (first) { cellText(c, lbl(k, lang) + ':  ' + t, { bg: SOFT, pad: 8 }); first = false; } else cellMore(c, lbl(k, lang) + ':  ' + t, { size: 10, color: INK }); };
      line('vehicle', vehLine); line('policy', polLine);
      if (perLine) { if (first) cellText(c, perLine, { bg: SOFT, pad: 8 }); else cellMore(c, perLine, { size: 10, color: INK }); }
    }

    // ---- line items
    para(body, '', { after: 6 });
    const rows = [['#', lbl('desc', lang), lbl('qty', lang), lbl('price', lang), lbl('amount', lang)]];
    inv.items.forEach((it, i) => rows.push([String(i + 1), it.d, String(it.q), baht(it.p), baht(Math.round(it.q * Math.round(it.p * 100)) / 100)]));
    const tb = body.appendTable(rows);
    tb.setBorderColor(LINE).setBorderWidth(0.5);
    [24, 251, 50, 88, 90].forEach((w, i) => tb.setColumnWidth(i, w));
    for (let r = 0; r < tb.getNumRows(); r++) {
      const row = tb.getRow(r);
      for (let ci = 0; ci < row.getNumCells(); ci++) {
        const cell = row.getCell(ci);
        cellText(cell, cell.getText(), { bold: r === 0, size: r === 0 ? 8.5 : 10, color: r === 0 ? MUTED : INK, bg: r === 0 ? SOFT : null, align: ci >= 2 ? H.RIGHT : (ci === 0 ? H.CENTER : H.LEFT) });
      }
    }

    // ---- totals (right-aligned block)
    para(body, '', { after: 4 });
    const T = inv.t, trows = [['', lbl('sub', lang), baht(T.sub)]];
    if (T.disc) trows.push(['', lbl('disc', lang), '-' + baht(T.disc)]);
    if (inv.vat) trows.push(['', lbl('vat', lang), baht(T.vat)]);
    trows.push(['', lbl('total', lang), baht(T.total)]);
    if (T.paid) { trows.push(['', lbl('paid', lang), baht(T.paid)]); trows.push(['', lbl('bal', lang), baht(T.bal)]); }
    const tt = body.appendTable(trows);
    tt.setBorderWidth(0);
    [250, 163, 90].forEach((w, i) => tt.setColumnWidth(i, w));
    for (let r = 0; r < tt.getNumRows(); r++) {
      const isTotal = trows[r][1] === lbl('total', lang), isBal = trows[r][1] === lbl('bal', lang);
      cellText(tt.getCell(r, 0), '', { pad: 3 });
      cellText(tt.getCell(r, 1), trows[r][1], { align: H.RIGHT, bold: isTotal || isBal, size: isTotal ? 11 : 10, color: isTotal || isBal ? INK : MUTED, bg: isTotal ? SOFT : null, pad: isTotal ? 7 : 3 });
      cellText(tt.getCell(r, 2), trows[r][2], { align: H.RIGHT, bold: isTotal || isBal, size: isTotal ? 12 : 10, color: isTotal ? ACCENT : INK, bg: isTotal ? SOFT : null, pad: isTotal ? 7 : 3 });
    }

    // ---- notes, payment details, footer
    if (inv.notes) { para(body, '', { after: 4 }); para(body, lbl('notes', lang), { size: 8.5, bold: true, color: MUTED }); inv.notes.split(/\n/).forEach(l => para(body, l)); }
    if (co.bank) { para(body, '', { after: 6 }); para(body, lbl('pay', lang), { size: 8.5, bold: true, color: MUTED }); co.bank.split(/\n/).forEach(l => para(body, l)); }
    if (co.footer) { para(body, '', { after: 12 }); co.footer.split(/\n/).forEach(l => para(body, l, { size: 8.5, color: MUTED, align: H.CENTER })); }

    // the empty first paragraph Docs always adds
    try { const first = body.getChild(0); if (first.getType() === DocumentApp.ElementType.PARAGRAPH && !first.asParagraph().getText()) first.removeFromParent(); } catch (e) { }
    doc.saveAndClose();
    return DriveApp.getFileById(docId).getAs('application/pdf').setName(inv.no + '.pdf');
  } finally {
    // the temporary Google Doc goes to the trash (never a permanent delete)
    try { Drive.Files.update({ trashed: true }, docId); } catch (e) { }
  }
}

/* ============================ AI (Gemini) ============================ */

function aiKey() { return PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || ''; }

const AI_FIELDS = {
  nameTh: 'Customer full name in Thai script, exactly as printed',
  nameEn: 'Customer full name in Latin letters, exactly as printed',
  phone: 'Customer phone number, digits only',
  idNo: 'Thai national ID (13 digits) or passport number',
  address: 'Customer address',
  dob: 'Date of birth, YYYY-MM-DD with the year exactly as printed (do not convert Buddhist years)',
  brand: 'Vehicle brand, e.g. Toyota', model: 'Vehicle model, e.g. Yaris', year: 'Vehicle model/registration year as printed',
  color: 'Vehicle colour', plate: 'Licence plate number without the province', province: 'Province of the licence plate',
  vin: 'Chassis number / VIN', engineNo: 'Engine number',
  insurer: 'Insurance company name', policyNo: 'Policy number', policyType: 'Policy type or class, e.g. ชั้น 1, 2+, 3, พ.ร.บ.',
  coverage: 'Sum insured / coverage amount, digits only', premium: 'Total premium, digits only, with decimals if printed',
  policyStart: 'Coverage start date, YYYY-MM-DD with the year exactly as printed', policyExpiry: 'Coverage end date, YYYY-MM-DD with the year exactly as printed',
  receiptAmount: 'For a payment receipt or slip: amount paid, digits only', receiptDate: 'For a payment receipt: payment date, YYYY-MM-DD with the year exactly as printed',
  payer: 'For a payment receipt: name of the payer',
};

function aiSchema() {
  const field = { type: 'object', properties: { value: { type: ['string', 'null'] }, confidence: { type: 'number', minimum: 0, maximum: 1 } }, required: ['value', 'confidence'] };
  const props = {};
  Object.keys(AI_FIELDS).forEach(k => { props[k] = Object.assign({ description: AI_FIELDS[k] }, field); });
  return {
    type: 'object',
    properties: {
      docType: { type: 'string', enum: ['policy', 'registration', 'id_card', 'receipt', 'other'], description: 'policy = insurance policy or schedule; registration = vehicle registration book; id_card = ID card, passport or driving licence; receipt = payment receipt, transfer slip or invoice' },
      fields: { type: 'object', properties: props, required: Object.keys(AI_FIELDS) },
    },
    required: ['docType', 'fields'],
  };
}

const AI_PROMPT = [
  'You read Thai car-insurance documents for an insurance agency (policies, vehicle registration books, ID cards, payment receipts). Text may be Thai or English.',
  'Extract the fields of the JSON schema from the attached pages (all pages belong to ONE document).',
  'STRICT RULES:',
  '1. Only return a value when it is clearly printed in the document. If a field is missing, unreadable or you are unsure what it is, return value null. NEVER guess, infer or invent data.',
  '2. Copy names, numbers and plates exactly as printed. Convert Thai digits (๐-๙) to 0-9.',
  '3. Dates: return YYYY-MM-DD but keep the YEAR NUMBER EXACTLY AS PRINTED (for example a Buddhist year 2569 stays 2569). Do not convert eras.',
  '4. confidence is 0-1: 0.9+ only when the text is sharp and unambiguous; below 0.6 when partly blurred or the label is unclear.',
  '5. The customer is the insured person / owner, never the insurance company or the agent.',
].join('\n');

function aiExtract(req) {
  const key = aiKey();
  if (!key) throw err('ai_nokey', 'GEMINI_API_KEY is not set in Script Properties');
  const files = (req.files || []).slice(0, 8);
  if (!files.length) throw err('bad_request', 'No file');
  let bytes = 0;
  const parts = files.map(f => {
    const mime = String(f.mime || '');
    if (!/^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/.test(mime)) throw err('bad_request', 'Only photos and PDF files can be read');
    bytes += String(f.data || '').length * 0.75;
    return { inline_data: { mime_type: mime, data: String(f.data || '') } };
  });
  if (bytes > AI_MAX_BYTES) throw err('too_big', 'Files are too large for reading');
  parts.push({ text: AI_PROMPT });
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', responseJsonSchema: aiSchema() },
  };
  const t0 = Date.now();
  let code = 0, usage = 0, result = 'ok';
  try {
    const r = UrlFetchApp.fetch(GEMINI_URL + GEMINI_MODEL + ':generateContent', {
      method: 'post', contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true,
      headers: { 'x-goog-api-key': key },
    });
    code = r.getResponseCode();
    if (code === 429) { result = 'quota'; throw err('ai_quota', 'AI quota reached, try again later'); }
    if (code === 400 || code === 401 || code === 403) {
      const m = String(r.getContentText()).slice(0, 300);
      result = 'http' + code;
      if (/API key/i.test(m)) throw err('ai_nokey', 'The Gemini API key is not valid');
      throw err('ai_error', 'AI request rejected (' + code + ')');
    }
    if (code !== 200) { result = 'http' + code; throw err('ai_error', 'AI service error (' + code + ')'); }
    const j = JSON.parse(r.getContentText());
    usage = (j.usageMetadata && j.usageMetadata.totalTokenCount) || 0;
    const c = (j.candidates || [])[0];
    const text = c && c.content && (c.content.parts || []).map(p => p.text || '').join('');
    if (!text) { result = 'empty'; throw err('ai_error', 'The AI could not read this document'); }
    let out;
    try { out = JSON.parse(text); } catch (e) { result = 'badjson'; throw err('ai_error', 'The AI answer was not valid'); }
    return { docType: out.docType || 'other', fields: out.fields || {}, model: GEMINI_MODEL };
  } catch (e) {
    if (result === 'ok') result = e.code || 'fail';
    throw e;
  } finally {
    aiLog({ at: new Date().toISOString(), ms: Date.now() - t0, files: files.length, kb: Math.round(bytes / 1024), tokens: usage, model: GEMINI_MODEL, result });
  }
}

/** Usage log without any customer data */
function aiLog(entry) {
  try {
    console.log('ai ' + JSON.stringify(entry));
    withLock(() => {
      const p = PropertiesService.getScriptProperties();
      let log = [];
      try { log = JSON.parse(p.getProperty('AI_LOG') || '[]'); } catch (e) { }
      log.push(entry);
      p.setProperty('AI_LOG', JSON.stringify(log.slice(-200)));
    });
  } catch (e) { }
}

/* ============================ daily expiry e-mail (optional) ============================ */

/** Run once from the editor to turn ON the daily e-mail (08:00 Bangkok time). */
function enableDailyDigest() {
  disableDailyDigest();
  ScriptApp.newTrigger('dailyExpiryDigest').timeBased().everyDays(1).atHour(8).inTimezone('Asia/Bangkok').create();
  console.log('Daily expiry e-mail is ON. It goes to ' + ownerEmail());
}
/** Run once from the editor to turn the daily e-mail OFF. */
function disableDailyDigest() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'dailyExpiryDigest').forEach(t => ScriptApp.deleteTrigger(t));
}
/** Sends the owner a list of policies that expire in the next 30 days (and ones expired in the last 7). */
function dailyExpiryDigest() {
  const root = rootId();
  const customers = listAll("'" + root + "' in parents and mimeType='" + FOLDER + "' and trashed=false and appProperties has { key='bimeyar' and value='item' }").map(toCustomer);
  const today = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
  const day = iso => Math.round((new Date(iso + 'T12:00:00Z') - new Date(today + 'T12:00:00Z')) / 864e5);
  const rows = customers.filter(c => c.policyExpiry).map(c => ({ c, d: day(c.policyExpiry) })).filter(x => x.d <= 30 && x.d >= -7).sort((a, b) => a.d - b.d);
  if (!rows.length) return;
  const esc = s => String(s || '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const html = '<p>Policies expiring in the next 30 days (' + rows.length + '):</p><table cellpadding="6" style="border-collapse:collapse;font-family:sans-serif;font-size:14px">' +
    rows.map(x => '<tr style="border-bottom:1px solid #eee"><td><b>' + esc(x.c.name) + '</b></td><td>' + esc(x.c.plate) + '</td><td>' + esc(x.c.phone) + '</td><td>' + dmy(x.c.policyExpiry) + '</td><td>' +
      (x.d < 0 ? 'expired ' + (-x.d) + ' d ago' : x.d === 0 ? 'today' : 'in ' + x.d + ' d') + '</td></tr>').join('') + '</table><p><a href="https://ghosmali22-prog.github.io/bimeyar/">Open Bimeyar</a></p>';
  MailApp.sendEmail({ to: ownerEmail(), subject: 'Bimeyar: ' + rows.length + ' policies expiring soon', htmlBody: html });
}

/* ============================ misc ============================ */

/** Trims and limits text. Line breaks are kept only for multi-line fields (address, bank, notes...). */
const MULTI = { 300: 1, 500: 1, 600: 1, 2000: 1 };
function clean(s, max) {
  const re = MULTI[max] ? /[\u0000-\u0009\u000b-\u001f]/g : /[\u0000-\u001f]/g;
  return String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(re, ' ').trim().slice(0, max);
}
function type(t) { return ['policy', 'car', 'id', 'claim', 'payment', 'other'].indexOf(t) >= 0 ? t : 'other'; }
function date(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) return '';
  const x = new Date(d + 'T12:00:00Z');
  return isNaN(x) || x.toISOString().slice(0, 10) !== d ? '' : d;
}
function err(code, msg) { const e = new Error(msg); e.code = code; return e; }
function withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function fail(code, message, extra) { return json(Object.assign({ ok: false, error: code, message }, extra || {})); }

/** Run once from the editor to grant access (Drive, Docs, e-mail, triggers) and create the Bimeyar folder. */
function setup() {
  const id = rootId();
  console.log('Owner: ' + ownerEmail() + ' | Bimeyar folder: https://drive.google.com/drive/folders/' + id);
  console.log('Gemini key set: ' + (aiKey() ? 'yes' : 'NO - add GEMINI_API_KEY in Project Settings > Script properties'));
  // touch the Docs service so the editor asks for the new permission
  try { DocumentApp.getActiveDocument(); } catch (e) { }
}

/** Run from the editor: dry-run report of the sub-folder migration (writes nothing). */
function migrationDryRun() {
  let from = 0, tot = { customers: 0, create: 0, adopt: 0, loose: 0 };
  do {
    const r = ACTIONS.migrateFolders.run({ dryRun: true, from, limit: 80 });
    r.rows.forEach(x => { tot.customers++; tot.create += x.create.length; tot.adopt += x.adopt.length; tot.loose += x.loose; if (x.create.length || x.adopt.length) console.log(x.name + ': create ' + x.create.join(', ') + (x.adopt.length ? ' | adopt ' + x.adopt.join(', ') : '') + ' | loose files ' + x.loose); });
    from = r.next;
  } while (from !== null);
  console.log('DRY RUN. Customers: ' + tot.customers + ', folders to create: ' + tot.create + ', to adopt: ' + tot.adopt + ', loose files (will stay where they are): ' + tot.loose);
}
