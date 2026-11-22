/**
 * Bimeyar backend: a Google Apps Script web app owned by the Drive owner.
 *
 * Deploy as:  Execute as = Me,  Who has access = Anyone.
 * Every request is a POST with Content-Type text/plain and a JSON body:
 *   { "token": "<Google ID token>", "action": "<name>", ...params }
 *   or (v3.3, device password) { "dev": { "sid": "<session id>", "key": "<session secret>" }, "action": ..., ... }
 * The ID token is verified on the server (tokeninfo endpoint): audience, verified email, expiry.
 * A device session is checked on every request (not cached): it must exist, not be expired, and the secret's
 * SHA-256 must match. 5 wrong secrets in a row (= 5 wrong device passwords) delete the session.
 * With either one, the role is read from the ACL on every request.
 * The caller's email comes only from the verified token or the stored session, never from the request body.
 *
 * All files live in the "Bimeyar" folder in the owner's My Drive and are owned by the owner.
 * Access list (Script Properties, key ACL): { "email": "admin" | "editor" | "viewer" }.
 * The script owner is always admin and cannot be removed.
 *
 * Script Properties used:
 *   ACL             access list (see above)
 *   ROOT_ID         id of the "Bimeyar" folder (set automatically)
 *   CLAUDE_API_KEY  Anthropic (Claude) API key for document reading, v4.4 (set by the owner, never in the repo).
 *                   Claude is tried first; without it (or when Claude fails) Gemini is used.
 *   GEMINI_API_KEY  Google AI Studio key for document reading, the automatic fallback (set by the owner, never in the repo)
 *   COMPANY         company info for invoices (set from the app, admin only)
 *   INV_SEQ         last invoice number per year (set automatically, under a lock)
 *   PRB_ROOT_ID     separate compulsory-insurance folder (created on first upload/import)
 *   PRB_SEQ         PRB invoice numbers per CE year, independent of INV_SEQ (under a lock)
 *   AI_LOG          last 200 AI calls: time, ms, size, tokens, result. No customer data.
 *   RENAME_LAST     id of the last batch of the "Rename files" tool, for "Undo last rename" (admin)
 *   MOVE_LAST       id of the last batch of the "Move to new folders" tool (v4), for "Undo last move" (admin)
 *   RESTORE_LAST    id of the last batch of "Restore original file names" (v4.2), for "Undo restore" (admin)
 *   AIEDIT_LOG      the last 5 "Edit with AI" batches (v4.3): [{ b, at, by, c: customer id, cn: name, n: files }]
 *
 * v4 folders (per vehicle), all found by their tags (appProperties), never by name:
 *   customer folder
 *   └── month   { bimeyar: 'month', year: '2026', month: '07' }            "07 July 2026" (month of the contract date)
 *       └── plate { bimeyar: 'vehicle', plate, year, month }               "70-5416"; the vehicle's data is JSON in its description
 *           ├── 1 … 4, 5   { bimeyar: 'slot', slot: '1' … '5' }            see VSLOTS
 *           └── 5 ─ 5.1 … 5.5 { bimeyar: 'slot', slot: '5.1' … '5.5' }    files go only into 1–4 and 5.1–5.5, never into 5
 * The v3 sub-folders (01_… 04_) and v2 files directly in the customer folder keep working as before.
 *   DEVICE_SESSIONS device sign-ins (v3.3): { sid: { h: SHA-256 of the secret, e: email, n: device name,
 *                   c: created, u: last used, x: expires (ms), f: wrong attempts } }. The secret itself is never stored.
 */

// Web OAuth Client ID used by the frontend's "Sign in with Google" (public, not a secret).
const CLIENT_ID = '519755009610-vqs6e182v4rv7p0gu25thalqefrps3lt.apps.googleusercontent.com';
const ROOT_NAME = 'Bimeyar';
const FOLDER = 'application/vnd.google-apps.folder';
const FIELDS = 'id,name,mimeType,size,createdTime,parents,appProperties,description';
const MAX_BYTES = 25 * 1024 * 1024;
const ROLES = ['admin', 'editor', 'viewer'];
const RANK = { viewer: 1, editor: 2, admin: 3 };
/** Device sessions (v3.3): 30 days, 5 devices per person, 5 wrong passwords, "last used" written at most every 10 min. */
const DS_KEY = 'DEVICE_SESSIONS';
const DS_DAYS = 30;
const DS_PER_USER = 5;
const DS_MAX_FAILS = 5;
const DS_TOUCH_MS = 10 * 60 * 1000;
const DS_MAX_BYTES = 8600;   // one Script Property holds at most 9 kB

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

/**
 * v4: the folders inside every plate folder. Found by `slot`, never by name; must match VSLOTS in js/vehicles.js.
 * `in` = the folder it sits in (5.1–5.5 are inside 5). Created in this order, so 5 exists before 5.1.
 */
const VSLOTS = [
  { slot: '1', name: '1. กรมธรรม์รถยนต์' },
  { slot: '2', name: '2. กรมธรรม์ขนส่งสินค้า' },
  { slot: '3', name: '3. พรบ.' },
  { slot: '4', name: '4. ใบวางบิล/ใบเสนอราคา' },
  { slot: '5', name: '5. เอกสารตัวรถยนต์' },
  { slot: '5.1', name: '5.1 สำเนาทะเบียนรถ', in: '5' },
  { slot: '5.2', name: '5.2 สำเนากรมธรรม์เดิม', in: '5' },
  { slot: '5.3', name: '5.3 รูปรถ', in: '5' },
  { slot: '5.4', name: '5.4 หลักฐานการโอนเงิน', in: '5' },
  { slot: '5.5', name: '5.5 หนังสือแต่งตั้ง/หนังสือรับรองบริษัท', in: '5' },
];
/** Folders that can hold files (never "5" itself) */
const VFILE_SLOTS = ['1', '2', '3', '4', '5.1', '5.2', '5.3', '5.4', '5.5'];
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** Vehicle fields (v4), stored as JSON in the description of the plate folder. All optional except the plate. */
const VFIELDS = {
  plate: 40, province: 60, brand: 40, model: 60, year: 4, color: 30, body: 60, vin: 40, engineNo: 40, carValue: 20,   // carValue: v4.4.1
  insurer: 80, policyNo: 60, policyType: 60, coverage: 20, premium: 20,
  contractDate: 'date', policyStart: 'date', policyExpiry: 'date', note: 500,
};

/**
 * v4.4: Claude reads the documents first (every AI feature goes through aiExtract). Change the model here only.
 * PDFs are sent as "document" blocks and photos as "image" blocks (base64), so Claude reads the files directly.
 * When CLAUDE_API_KEY is missing, or Claude fails (busy, bad key, no credit, refusal, ...), the Gemini models
 * below are used automatically, with the same retries, time budget and cache.
 */
const CLAUDE_MODEL = 'claude-haiku-5-5';
const CLAUDE_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_API_VERSION = '2023-06-01';
const CLAUDE_EFFORT = 'low';          // low thinking = faster extraction (the default for this model is medium)
const CLAUDE_MAX_TOKENS = 8000;       // the JSON answer is small; room for the model's thinking
/** File types Claude can read; anything else (e.g. a HEIC photo that could not be converted) goes to Gemini. */
const CLAUDE_MIMES = /^(image\/(jpeg|png|gif|webp)|application\/pdf)$/;

/**
 * Gemini models for reading documents (fallback after Claude), tried in this order (change here only).
 * think = generationConfig.thinkingConfig.thinkingLevel: the lowest level each model accepts
 * (gemini-3.8-flash has no 'minimal'; the Flash-Lite models do). Low thinking = faster extraction.
 */
const AI_MODELS = [
  { id: 'gemini-3.1-flash-lite', think: 'minimal' },   // first: fast and available when the bigger models are busy
  { id: 'gemini-3.8-flash', think: 'low' },
  { id: 'gemini-3.6-flash', think: 'minimal' },
];
const GEMINI_MODEL = AI_MODELS[0].id;   // kept for older code and the setup log
/** Retries per model on 429/500/503/504/timeout, and the wait before each retry (plus random jitter). */
const AI_TRIES_PER_MODEL = 3;
const AI_BACKOFF_MS = [2000, 5000, 10000];
/**
 * Time limits for one aiExtract call. The app waits 240 s; Apps Script allows 6 min.
 * UrlFetchApp has no per-request timeout and one busy request already took 175 s, so a new attempt only starts
 * while at least AI_MIN_LEFT_MS of AI_BUDGET_MS is left, i.e. in the first 45 s: even a 180 s request then ends
 * by ~225 s. A result that still arrives after the app gave up is kept in the cache (AI_CACHE_S), so "Try again"
 * returns it at once. An attempt that failed slowly (AI_SLOW_MS) switches to the next model.
 */
const AI_BUDGET_MS = 200000;
const AI_MIN_LEFT_MS = 155000;
const AI_SLOW_MS = 20000;
/** Successful results are kept 10 minutes in CacheService, keyed by a SHA-256 of the files (never logged). */
const AI_CACHE_S = 600;
/** While a request for the same files is still running, a second request waits for it (polls) up to this long. */
const AI_JOIN_MS = 200000;
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/';
const AI_MAX_BYTES = 18 * 1024 * 1024;

/** Optional customer fields, stored as JSON in the customer folder's description. All are optional. */
const CFIELDS = {
  phone: 40, plate: 40, car: 80,                                        // v2 fields
  nameEn: 120, idNo: 20, address: 300, dob: 'date',
  brand: 40, model: 60, year: 4, color: 30, province: 60, vin: 40, engineNo: 40,
  insurer: 80, policyNo: 60, policyType: 60, coverage: 20, premium: 20,
  policyStart: 'date', policyExpiry: 'date', note: 500,
  nick: 40, contractDate: 'date',                                       // v3.2: nickname for file names, contract date (วันทำสัญญาประกันภัย)
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
  try { user = req.dev ? sessionAuth(req.dev) : verify(req.token); }
  catch (err) { return fail(err.code || (req.dev ? 'server' : 'auth'), String(err.message || err), err.extra); }   // e.g. a lock timeout is not a sign-out

  const role = roleOf(user.email);
  if (!role) {
    if (user.sid) dsEdit(a => { delete a[user.sid]; });   // removed from the access list: this device session ends now
    return fail('forbidden', 'No access', { email: user.email });
  }

  const fn = ACTIONS[req.action];
  if (!fn) return fail('bad_request', 'Unknown action');
  if (RANK[role] < RANK[fn.need]) return fail('role', 'Not allowed for role ' + role);

  try {
    return json({ ok: true, data: fn.run(req, user, role) });
  } catch (err) {
    console.error(req.action, err && err.stack || err);
    return fail(err.code || 'server', String(err.message || err), err.extra);
  }
}

/* ============================ actions ============================ */

const ACTIONS = {
  /* ---------- separate compulsory insurance (v4.5) ---------- */
  prbList: { need: 'viewer', run: () => prbList() },
  prbUpload: { need: 'editor', run: (req, user) => prbUpload(req, user) },
  prbUpdate: { need: 'editor', run: req => withLock(() => {
    const f = prbAssertFile(req.id, 'prb');
    const row = Object.assign({}, parseObj(f.description), prbFields(req.row || {}));
    prbDuplicate(row, f.id);
    return prbToRow(Drive.Files.update({ description: JSON.stringify(row), appProperties: prbRowProps(row) }, f.id, null, { fields: FIELDS }));
  }) },
  prbGetFile: { need: 'viewer', run: req => {
    prbAssertFile(req.id);
    const blob = DriveApp.getFileById(req.id).getBlob();
    return { mime: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
  } },
  prbShare: { need: 'editor', run: req => prbSharing(req.id, true) },
  prbUnshare: { need: 'editor', run: req => prbSharing(req.id, false) },
  prbDelete: { need: 'editor', run: req => withLock(() => {
    prbAssertFile(req.id); Drive.Files.update({ trashed: true }, req.id); return true;
  }) },
  prbImportPlan: { need: 'admin', run: () => prbImportPlan() },
  prbImport: { need: 'admin', run: (req, user) => prbImport(req, user) },
  prbInvoice: { need: 'editor', run: (req, user) => prbInvoice(req, user) },

  me: { need: 'viewer', run: (req, user, role) => ({ email: user.email, name: user.name, role, owner: ownerEmail() === user.email, root: role === 'admin' ? rootId() : '', ai: !!(claudeKey() || aiKey()), v: 4, dev: !!user.sid }) },

  /* ---------- device sign-in (v3.3) ---------- */
  // Only with a Google ID token. Returns the secret once; only its SHA-256 is stored.
  // `replace` = this device's old session ("Forgot password"): removed if it belongs to the same person.
  createDeviceSession: {
    need: 'viewer',
    run: (req, user) => {
      if (user.sid) throw err('role', 'Sign in with Google to add a device');
      const name = clean(req.name, 40) || 'Device';
      const sid = dsRandom(16), key = dsRandom(32), now = Date.now(), x = now + DS_DAYS * 86400000;
      dsEdit(a => {
        const old = String(req.replace || '');
        if (old && a[old] && a[old].e === user.email) delete a[old];
        const mine = Object.keys(a).filter(k => a[k].e === user.email).sort((p, q) => (a[p].u || a[p].c) - (a[q].u || a[q].c));
        while (mine.length >= DS_PER_USER) delete a[mine.shift()];   // the device not used for the longest time
        a[sid] = { h: dsHash(key), e: user.email, n: name, c: now, u: now, x: x, f: 0 };
        if (Utilities.newBlob(JSON.stringify(a)).getBytes().length > DS_MAX_BYTES) throw err('sessions_full', 'Too many devices');
      });
      return { sid: sid, key: key, expires: new Date(x).toISOString() };
    },
  },
  listMySessions: { need: 'viewer', run: (req, user) => dsList(user, false) },
  revokeSession: {
    need: 'viewer',
    run: (req, user) => {
      const sid = String(req.sid || '');
      let found = false;
      dsEdit(a => { if (a[sid] && a[sid].e === user.email) { delete a[sid]; found = true; } });
      if (!found) throw err('not_found', 'Device not found');
      return dsList(user, false);
    },
  },
  listAllSessions: { need: 'admin', run: (req, user) => dsList(user, true) },
  revokeAny: {
    need: 'admin',
    run: (req, user) => {
      const sid = String(req.sid || '');
      let found = false;
      dsEdit(a => { if (a[sid]) { delete a[sid]; found = true; } });
      if (!found) throw err('not_found', 'Device not found');
      return dsList(user, true);
    },
  },

  list: {
    need: 'viewer',
    run: (req, user, role) => {
      const root = rootId();
      const all = listAll(tagQuery('item'));
      const subs = listAll(tagQuery('sub'));
      const customers = all.filter(f => f.mimeType === FOLDER && (f.parents || []).indexOf(root) >= 0).map(toCustomer);
      const ids = {};
      customers.forEach(c => { ids[c.id] = c; c.folders = {}; });
      const subOf = {};   // sub-folder id -> { customer, slot }
      subs.forEach(s => {
        const cid = (s.parents || [])[0], slot = (s.appProperties || {}).slot;
        if (ids[cid] && SLOTS.indexOf(slot) >= 0) { subOf[s.id] = { customer: cid, slot }; ids[cid].folders[slot] = s.id; }
      });
      const tree = vehicleTree(ids);   // v4: customer -> month -> plate -> 5 folders
      const files = [], invoices = [];
      all.forEach(f => {
        if (f.mimeType === FOLDER) return;
        const p = (f.parents || [])[0];
        let x = null;
        if (ids[p]) x = toFile(f, p, '');
        else if (subOf[p]) x = toFile(f, subOf[p].customer, subOf[p].slot);
        else if (tree.slotOf[p] && tree.slotOf[p].slot !== '5') x = toFile(f, tree.slotOf[p].v.customerId, '', tree.slotOf[p].v.id, tree.slotOf[p].slot);
        if (!x) return;
        files.push(x);
        if (x.invoice) invoices.push(toInvoice(f, x.customerId));
      });
      const out = { customers, files, invoices, vehicles: tree.vehicles, v: 4 };
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
      out.folders = {};   // v4: folders are made per vehicle (saveVehicle), not the 4 old v3 folders
      return out;
    },
  },

  /* ---------- vehicles (v4) ---------- */
  /**
   * Adds or changes a vehicle. Its data is JSON in the description of its plate folder and is MERGED:
   * fields not sent keep their old value. A new vehicle gets its month folder (contract date, else policy start,
   * else today; or `ym` when the user chose the month) and plate folder with the 5 folders + 5.1–5.5.
   * The same plate in the same month is the same vehicle: its data is merged, nothing is made twice.
   */
  saveVehicle: {
    need: 'editor',
    run: (req, user) => {
      const v = req.vehicle || {};
      const fields = vehicleFields(v);
      if (v.id) {
        const own = assertVehicle(v.id);
        const cur = Drive.Files.get(v.id, { fields: 'id,name,description' });
        const d = vehicleMerge(parseObj(cur.description), fields, user, true);
        const res = { description: JSON.stringify(d) };
        // the plate was corrected: the plate folder follows (only this folder's name and tag change)
        if (fileName(d.plate) !== cur.name) { res.name = fileName(d.plate); res.appProperties = { plate: tagVal(d.plate) }; }
        const f = Drive.Files.update(res, v.id, null, { fields: FIELDS });
        return toVehicle(f, own.customer, own.ym, vehicleSlots(v.id, true));
      }
      assertCustomer(v.customerId);
      const first = vehicleMerge({}, fields, user, false);   // checks the plate and the dates
      const ym = ymOk(v.ym) || ymOf(first);
      const hit = withLock(() => {
        const mid = monthFolder(v.customerId, ym, true);
        const same = childFolders(mid).filter(k => tagOf(k, 'bimeyar') === 'vehicle' && plateKey(tagOf(k, 'plate') || k.name) === plateKey(first.plate))[0];
        if (same) return { id: same.id, merge: true };
        return { id: Drive.Files.create({
          name: fileName(first.plate), mimeType: FOLDER, parents: [mid], description: JSON.stringify(first),
          appProperties: { bimeyar: 'vehicle', plate: tagVal(first.plate), year: ym.slice(0, 4), month: ym.slice(5, 7) },
        }, null, { fields: 'id' }).id };
      });
      if (hit.merge) {
        const cur = Drive.Files.get(hit.id, { fields: 'description' });
        Drive.Files.update({ description: JSON.stringify(vehicleMerge(parseObj(cur.description), fields, user, true)) }, hit.id);
      }
      const slots = vehicleSlots(hit.id, true);
      return toVehicle(Drive.Files.get(hit.id, { fields: FIELDS }), v.customerId, ym, slots);
    },
  },
  /** Removes a vehicle: its plate folder goes to the Drive trash (with its files, restorable for 30 days). */
  deleteVehicle: {
    need: 'editor',
    run: req => { assertVehicle(req.id); Drive.Files.update({ trashed: true }, req.id); return true; },
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
      const orig = clean(m.orig, 200);   // v3.2: the original file name, kept in the description
      let name = fileName(m.name) || fileName(orig) || 'file';
      if (!extOf(name) && extOf(orig)) name = fileName(name + extOf(orig));
      const mime = clean(m.mime, 120) || 'application/octet-stream';
      // v4: a vehicle + one of its folders (1–4, 5.1–5.5). v3: a sub-folder slot.
      // Without either (old clients) the file goes into the customer folder, as before.
      let parent = m.customerId, own = { customer: m.customerId, slot: m.folder || '' };
      if (m.vehicleId) {
        const v = assertVehicle(m.vehicleId);
        if (v.customer !== m.customerId) throw err('bad_request', 'This vehicle belongs to another customer');
        if (VFILE_SLOTS.indexOf(m.slot) < 0) throw err('bad_request', 'Unknown folder');
        parent = vehicleSlots(v.id, true)[m.slot];
        own = { customer: m.customerId, slot: '', vehicle: v.id, vslot: m.slot };
      } else if (m.folder) {
        if (SLOTS.indexOf(m.folder) < 0) throw err('bad_request', 'Unknown folder');
        parent = ensureSubs(m.customerId, false).folders[m.folder];
      }
      name = uniqueName(name, siblingNames(parent));   // never the same name twice in a folder: " (2)", " (3)"…
      const blob = Utilities.newBlob(bytes, mime, name);
      const f0 = Drive.Files.create({
        name, mimeType: mime, parents: [parent], description: descJoin(clean(m.note, 2000), orig ? [ORIG + orig] : []),
        appProperties: {
          bimeyar: 'item', kind: 'file', type: type(m.type), expiry: date(m.expiry),
          by: user.email.slice(0, 100), at: new Date().toISOString(),
        },
      }, blob, { fields: FIELDS });
      return toFileOf(settleName(f0, parent), own);
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
      // The original-name / rename lines of the description are kept (the app shows only the note).
      if (!(m.appProperties && m.appProperties.kind === 'invoice')) {
        res.description = descJoin(clean(f.note, 2000), descSplit(Drive.Files.get(f.id, { fields: 'description' }).description).meta);
      }
      return toFileOf(Drive.Files.update(res, f.id, null, { fields: FIELDS }), own);
    },
  },

  /**
   * Moves ONE file (the user confirmed it) into a folder of ITS OWN customer: a vehicle folder (v4: vehicleId + slot)
   * or one of the 4 v3 sub-folders (folder). Nothing else is changed.
   */
  moveFile: {
    need: 'editor',
    run: req => {
      const m = assertFile(req.id);
      const own = ownerOf(m);
      let target, to;
      if (req.vehicleId) {
        const v = assertVehicle(req.vehicleId);
        if (v.customer !== own.customer) throw err('bad_request', 'This vehicle belongs to another customer');
        if (VFILE_SLOTS.indexOf(req.slot) < 0) throw err('bad_request', 'Unknown folder');
        target = vehicleSlots(v.id, true)[req.slot];
        to = { customer: own.customer, slot: '', vehicle: v.id, vslot: req.slot };
      } else {
        if (SLOTS.indexOf(req.folder) < 0) throw err('bad_request', 'Unknown folder');
        target = ensureSubs(own.customer, false).folders[req.folder];
        to = { customer: own.customer, slot: req.folder };
      }
      const from = (m.parents || [])[0];
      if (from === target) return toFileOf(Drive.Files.get(req.id, { fields: FIELDS }), to);
      const f = Drive.Files.update({}, req.id, null, { addParents: target, removeParents: from, fields: FIELDS });
      return toFileOf(f, to);
    },
  },

  deleteFile: {
    need: 'editor',
    run: req => { assertFile(req.id); Drive.Files.update({ trashed: true }, req.id); return true; },
  },

  /* ---------- share ONE file by link (v3.2) ---------- */
  /**
   * Makes only this file "Anyone with the link: Viewer" and returns its link. assertFile refuses folders
   * (customer folders, sub-folders, the Bimeyar folder) and anything outside Bimeyar, so nothing else is ever shared.
   */
  shareFile: {
    need: 'editor',
    run: req => {
      const m = assertFile(req.id), own = ownerOf(m);
      const perms = Drive.Permissions.list(req.id, { fields: 'permissions(id,type,role)' }).permissions || [];
      const anyone = perms.filter(p => p.type === 'anyone');
      if (!anyone.length) Drive.Permissions.create({ type: 'anyone', role: 'reader', allowFileDiscovery: false }, req.id);
      anyone.forEach(p => { if (p.role !== 'reader') Drive.Permissions.update({ role: 'reader' }, req.id, p.id); });   // viewer only
      const f = Drive.Files.update({ appProperties: { link: '1' } }, req.id, null, { fields: FIELDS + ',webViewLink' });
      return { file: toFileOf(f, own), link: f.webViewLink || ('https://drive.google.com/file/d/' + req.id + '/view?usp=sharing') };
    },
  },
  /** Makes the file private again: removes only the "anyone with the link" permission. */
  unshareFile: {
    need: 'editor',
    run: req => {
      const m = assertFile(req.id), own = ownerOf(m);
      const perms = Drive.Permissions.list(req.id, { fields: 'permissions(id,type)' }).permissions || [];
      perms.filter(p => p.type === 'anyone').forEach(p => Drive.Permissions.remove(req.id, p.id));
      const f = Drive.Files.update({ appProperties: { link: null } }, req.id, null, { fields: FIELDS });
      return toFileOf(f, own);
    },
  },

  /* ---------- rename existing files (admin, v3.2) ---------- */
  /**
   * Renames the given files ONLY: no move, no delete, no content change. Invoices are never renamed.
   * The old name is written in the description ("Renamed: old ⇒ new") and the file is tagged with the batch id,
   * so "Undo last rename" can put the old names back. A name already used in the folder gets " (2)", " (3)"…
   */
  renameFiles: {
    need: 'admin',
    run: req => {
      const batch = String(req.batch || '');
      if (!/^[\w-]{6,40}$/.test(batch)) throw err('bad_request', 'Bad batch id');
      const t0 = Date.now();
      const rows = (Array.isArray(req.items) ? req.items : []).slice(0, 50).map(it => {
        const id = String((it && it.id) || '');
        if (Date.now() - t0 > 240000) return { id, status: 'later' };
        try { return renameOne(id, it.name, batch); } catch (e) { return { id, status: 'error', msg: String(e.message || e) }; }
      });
      // remembered for "Undo last rename" only when something was renamed, so an empty run never hides the previous undo
      if (rows.some(r => r.status === 'ok')) PropertiesService.getScriptProperties().setProperty('RENAME_LAST', batch);
      return { rows };
    },
  },
  /** Puts back the old names of the last rename batch. A file renamed again since then is left as it is. */
  renameUndo: {
    need: 'admin',
    run: () => {
      const batch = PropertiesService.getScriptProperties().getProperty('RENAME_LAST') || '';
      const out = { done: 0, skipped: 0, more: false };
      if (!/^[\w-]{6,40}$/.test(batch)) return out;
      const list = Drive.Files.list({ q: "appProperties has { key='rnb' and value='" + batch + "' } and trashed=false", fields: 'files(id)', pageSize: 200, spaces: 'drive' }).files || [];
      const t0 = Date.now();
      for (const x of list) {
        if (Date.now() - t0 > 240000) { out.more = true; break; }
        try { assertFile(x.id); } catch (e) { continue; }
        const f = Drive.Files.get(x.id, { fields: 'id,name,description,parents' });
        const d = descSplit(f.description);
        let i = d.meta.length - 1;
        while (i >= 0 && d.meta[i].indexOf(RENAMED) !== 0) i--;
        const s = i >= 0 ? d.meta[i].slice(RENAMED.length) : '', k = s.lastIndexOf(ARROW);
        const oldName = k > 0 ? s.slice(0, k) : '', newName = k > 0 ? s.slice(k + ARROW.length) : '';
        if (!oldName || newName !== f.name) {   // renamed again since: leave it as it is, only drop the batch tag
          Drive.Files.update({ appProperties: { rnb: null } }, x.id);
          out.skipped++;
          continue;
        }
        withLock(() => {
          d.meta.splice(i, 1);
          const name = uniqueName(oldName, siblingNames((f.parents || [])[0], x.id));
          Drive.Files.update({ name, description: descJoin(d.note, d.meta), appProperties: { rnb: null } }, x.id);
        });
        out.done++;
      }
      if (list.length >= 200) out.more = true;
      return out;
    },
  },

  /* ---------- move existing files into the v4 folders (admin, one-time tool, v4) ---------- */
  /**
   * The ONLY place where many files are moved (CLAUDE.md rule 7). Each file is MOVED into a folder of a vehicle of
   * ITS OWN customer: never deleted, never copied, its content never changed. A new name is given only when the
   * app sends one (files that do not follow the name pattern yet); invoices keep their name.
   * The old folder is written in the description ("Moved from: …") and kept in appProperties (mvf / mvt / mvb),
   * so "Undo last move" can put every file back. Small batches: at most 25 files and ~200 s per request.
   */
  moveNew: {
    need: 'admin',
    run: req => {
      const batch = String(req.batch || '');
      if (!/^[\w-]{6,40}$/.test(batch)) throw err('bad_request', 'Bad batch id');
      const t0 = Date.now();
      const rows = (Array.isArray(req.items) ? req.items : []).slice(0, 25).map(it => {
        const id = String((it && it.id) || '');
        if (Date.now() - t0 > 200000) return { id, status: 'later' };
        try { return moveOne(id, it, batch); } catch (e) { return { id, status: 'error', msg: String(e.message || e) }; }
      });
      if (rows.some(r => r.status === 'ok')) PropertiesService.getScriptProperties().setProperty('MOVE_LAST', batch);
      return { rows };
    },
  },
  /** Puts the files of the last move batch back into their old folder (and their old name). */
  moveUndo: {
    need: 'admin',
    run: () => {
      const batch = PropertiesService.getScriptProperties().getProperty('MOVE_LAST') || '';
      const out = { done: 0, skipped: 0, more: false };
      if (!/^[\w-]{6,40}$/.test(batch)) return out;
      const list = Drive.Files.list({ q: "appProperties has { key='mvb' and value='" + batch + "' } and trashed=false", fields: 'files(id)', pageSize: 200, spaces: 'drive' }).files || [];
      const t0 = Date.now();
      for (const x of list) {
        if (Date.now() - t0 > 200000) { out.more = true; break; }
        try { if (undoMoveOne(x.id)) out.done++; else out.skipped++; } catch (e) { out.skipped++; }
      }
      if (list.length >= 200) out.more = true;
      return out;
    },
  },
  /* ---------- "Edit with AI" (editor, v4.3) ---------- */
  /**
   * Applies what the user ticked in the "Edit with AI" preview: per file a new name and/or another folder of a vehicle
   * of ITS OWN customer; per vehicle the ticked data (MERGED). Never deletes, never changes a file's content, never an
   * invoice. The previous state is kept (file: "AI edit <batch>: old ⇒ new [from>to|type]" line + tag aib; vehicle:
   * `_ai` list in its JSON + tag aib), so aiEditUndo can put it back exactly. One batch = one customer; the last 5 are kept.
   * Small requests: at most 10 files and 20 vehicles, ~200 s.
   */
  aiEditApply: {
    need: 'editor',
    run: (req, user) => {
      const batch = String(req.batch || '');
      if (!/^ai[\w-]{6,38}$/.test(batch)) throw err('bad_request', 'Bad batch id');
      const cid = String(req.customerId || '');
      const c = assertCustomer(cid);
      const t0 = Date.now();
      const vrows = (Array.isArray(req.vehicles) ? req.vehicles : []).slice(0, 20).map(x => {
        const id = String((x && x.id) || '');
        try { return aiEditVehicle(id, (x && x.fields) || {}, batch, user, cid); } catch (e) { return { id, status: 'error', msg: String(e.message || e) }; }
      });
      const rows = (Array.isArray(req.items) ? req.items : []).slice(0, 10).map(it => {
        const id = String((it && it.id) || '');
        if (Date.now() - t0 > 200000) return { id, status: 'later' };
        try { return aiEditOne(id, it, batch, cid); } catch (e) { return { id, status: 'error', msg: String(e.message || e) }; }
      });
      const n = rows.filter(r => r.status === 'ok').length + vrows.filter(r => r.status === 'ok').length;
      if (n) aiLogBatch(batch, user, cid, Drive.Files.get(c.id, { fields: 'name' }).name, rows.filter(r => r.status === 'ok').length);
      return { rows, vehicles: vrows };
    },
  },
  /**
   * Puts an AI-edit batch back: names, folders, file types and vehicle data. id = only that one file.
   * A file or a vehicle field changed again since then is left as it is.
   */
  aiEditUndo: {
    need: 'editor',
    run: req => {
      const batch = String(req.batch || '');
      if (!/^ai[\w-]{6,38}$/.test(batch) || !aiLogGet().some(x => x.b === batch)) throw err('bad_request', 'Only the last 5 AI edits can be undone');
      const out = { done: 0, skipped: 0, more: false };
      const t0 = Date.now();
      const one = req.id ? [{ id: String(req.id) }] : Drive.Files.list({ q: "appProperties has { key='aib' and value='" + batch + "' } and trashed=false", fields: 'files(id,mimeType)', pageSize: 200, spaces: 'drive' }).files || [];
      for (const x of one) {
        if (Date.now() - t0 > 200000) { out.more = true; break; }
        try {
          const ok = x.mimeType === FOLDER ? undoAiVehicle(x.id, batch) : undoAiFile(x.id, batch);
          if (ok) out.done++; else out.skipped++;
        } catch (e) { out.skipped++; }
      }
      if (one.length >= 200) out.more = true;
      if (!req.id && !out.more) aiLogEdit(a => { const e = a.filter(x => x.b === batch)[0]; if (e) e.u = 1; });
      return out;
    },
  },
  /** The last 5 AI-edit batches (Settings, admin) */
  aiEditList: { need: 'admin', run: () => aiLogGet() },

  /* ---------- restore original file names (admin, v4.2) ---------- */
  /**
   * Read only: every file inside the root whose name was changed by the rename / move tools ("Renamed: old ⇒ new"
   * lines), with its oldest name (before the FIRST change) and, when the move tool moved it, its previous folder and
   * whether that folder still exists for the same customer. Names given at upload are not listed. Invoices never.
   */
  restorePlan: {
    need: 'admin',
    run: () => {
      const root = rootId();
      const all = listAll(tagQuery('item'));
      const ids = {};
      all.forEach(f => { if (f.mimeType === FOLDER && (f.parents || []).indexOf(root) >= 0) ids[f.id] = f.name; });
      const own = {};   // folder id -> customer id (customer folders, v3 sub-folders, v4 file folders)
      Object.keys(ids).forEach(id => { own[id] = id; });
      listAll(tagQuery('sub')).forEach(x => { const c = (x.parents || [])[0]; if (ids[c] && SLOTS.indexOf(tagOf(x, 'slot')) >= 0) own[x.id] = c; });
      const tree = vehicleTree(ids);
      Object.keys(tree.slotOf).forEach(id => { if (tree.slotOf[id].slot !== '5') own[id] = tree.slotOf[id].v.customerId; });
      const rows = [];
      all.forEach(f => {
        if (f.mimeType === FOLDER || tagOf(f, 'kind') === 'invoice') return;
        const p = (f.parents || [])[0], cid = own[p];
        if (!cid) return;
        const h = nameHistory(descSplit(f.description).meta);
        if (!h.oldest || h.oldest === f.name) return;
        const from = h.fromId && h.fromId !== p ? { id: h.fromId, name: h.fromName, ok: own[h.fromId] === cid } : null;
        rows.push({ id: f.id, customerId: cid, customer: ids[cid], name: f.name, old: h.oldest, from });
      });
      return rows.sort((a, b) => a.customer.localeCompare(b.customer) || a.name.localeCompare(b.name));
    },
  },
  /**
   * Gives the files back their old name (and, with back: true, puts them back into their previous folder when it
   * still exists for the same customer; otherwise only the name, note 'folder_gone'). Never deletes, never changes
   * the content. The history lines stay; a line "Restored: new ⇒ old" is added. Small batches (20 files, ~200 s).
   */
  restoreNames: {
    need: 'admin',
    run: req => {
      const batch = String(req.batch || '');
      if (!/^[\w-]{6,40}$/.test(batch)) throw err('bad_request', 'Bad batch id');
      const t0 = Date.now();
      const rows = (Array.isArray(req.items) ? req.items : []).slice(0, 20).map(it => {
        const id = String((it && it.id) || '');
        if (Date.now() - t0 > 200000) return { id, status: 'later' };
        try { return restoreOne(id, it, batch); } catch (e) { return { id, status: 'error', msg: String(e.message || e) }; }
      });
      if (rows.some(r => r.status === 'ok')) PropertiesService.getScriptProperties().setProperty('RESTORE_LAST', batch);
      return { rows };
    },
  },
  /** Puts the last restore batch back (name and folder). A file changed again since then is left as it is. */
  restoreUndo: {
    need: 'admin',
    run: () => {
      const batch = PropertiesService.getScriptProperties().getProperty('RESTORE_LAST') || '';
      const out = { done: 0, skipped: 0, more: false };
      if (!/^[\w-]{6,40}$/.test(batch)) return out;
      const list = Drive.Files.list({ q: "appProperties has { key='rsb' and value='" + batch + "' } and trashed=false", fields: 'files(id)', pageSize: 200, spaces: 'drive' }).files || [];
      const t0 = Date.now();
      for (const x of list) {
        if (Date.now() - t0 > 200000) { out.more = true; break; }
        try { if (undoRestoreOne(x.id)) out.done++; else out.skipped++; } catch (e) { out.skipped++; }
      }
      if (list.length >= 200) out.more = true;
      return out;
    },
  },

  /**
   * The v3 folders (01_… 04_) with the number of items still inside, so the owner can delete the empty ones
   * by hand in Drive. This action only reads: it never deletes anything.
   */
  oldFolders: {
    need: 'admin',
    run: () => {
      const root = rootId();
      const names = {};
      listAll("'" + root + "' in parents and mimeType='" + FOLDER + "' and trashed=false").forEach(c => { names[c.id] = c.name; });
      const subs = listAll(tagQuery('sub')).filter(s => names[(s.parents || [])[0]]);
      const used = {};
      for (let i = 0; i < subs.length; i += 40) {
        const q = '(' + subs.slice(i, i + 40).map(s => "'" + s.id + "' in parents").join(' or ') + ') and trashed=false';
        let page;
        do {
          const r = Drive.Files.list({ q, fields: 'nextPageToken,files(id,parents)', pageSize: 1000, pageToken: page, spaces: 'drive' });
          (r.files || []).forEach(f => (f.parents || []).forEach(p => { used[p] = (used[p] || 0) + 1; }));
          page = r.nextPageToken;
        } while (page);
      }
      return subs.map(s => ({ id: s.id, name: s.name, customerId: s.parents[0], customer: names[s.parents[0]], items: used[s.id] || 0 }))
        .sort((a, b) => String(a.customer).localeCompare(String(b.customer)) || a.name.localeCompare(b.name));
    },
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
      // v4: into "4. ใบวางบิล/ใบเสนอราคา" of the vehicle; without a vehicle (old clients) into the v3 payment folder
      let folder;
      if (inv.vehicleId) {
        const v = assertVehicle(inv.vehicleId);
        if (v.customer !== inv.customerId) throw err('bad_request', 'This vehicle belongs to another customer');
        folder = vehicleSlots(v.id, true)['4'];
      }
      const pdf = invoicePdf(inv, req.dateFmt);
      if (!folder) folder = ensureSubs(inv.customerId, false).folders.pay;
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

/* ---------- device sessions (v3.3) ---------- */

/** Checks { sid, key } against DEVICE_SESSIONS. Wrong key: counts the attempt; the 5th deletes the session. */
function sessionAuth(dev) {
  const sid = String((dev && dev.sid) || ''), key = String((dev && dev.key) || '');
  if (!/^[\w-]{16,64}$/.test(sid) || !/^[\w-]{32,128}$/.test(key)) throw sessionGone();
  const now = Date.now(), s = dsGet()[sid];
  if (!s) throw sessionGone();
  if (!(s.x > now)) { dsEdit(a => { delete a[sid]; }); throw sessionGone(); }
  if (dsHash(key) !== s.h) {
    let left = 0;
    dsEdit(a => {
      const t = a[sid]; if (!t) return;
      t.f = (t.f || 0) + 1;
      if (t.f >= DS_MAX_FAILS) delete a[sid]; else left = DS_MAX_FAILS - t.f;
    });
    if (!left) throw sessionGone();
    const e = new Error('Wrong password'); e.code = 'bad_pin'; e.extra = { left: left }; throw e;
  }
  if (s.f || now - (s.u || 0) > DS_TOUCH_MS) dsEdit(a => { const t = a[sid]; if (t) { t.u = now; t.f = 0; } });
  return { email: s.e, name: '', picture: '', sid: sid };
}
function sessionGone() { const e = new Error('Device session ended'); e.code = 'auth'; e.extra = { session: 'gone' }; return e; }
function dsGet() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(DS_KEY) || '{}') || {}; } catch (e) { return {}; } }
/** Changes DEVICE_SESSIONS under the script lock. Also removes expired sessions and sessions of people no longer in the ACL. */
function dsEdit(fn) {
  return withLock(() => {
    const a = dsGet();
    fn(a);
    const now = Date.now(), acl = aclGet(), owner = ownerEmail();
    Object.keys(a).forEach(k => { const t = a[k]; if (!t || !(t.x > now) || (t.e !== owner && !acl[t.e])) delete a[k]; });
    PropertiesService.getScriptProperties().setProperty(DS_KEY, JSON.stringify(a));
  });
}
function dsHash(key) { return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'bimeyar-device:' + key)).replace(/=+$/, ''); }
/** n random bytes (n <= 32), base64url: SHA-256 of 4 random UUIDs (4 x 122 random bits). */
function dsRandom(n) {
  let s = '';
  for (let i = 0; i < 4; i++) s += Utilities.getUuid();
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s).slice(0, n)).replace(/=+$/, '');
}
/** Sessions as the app shows them (never the hash). all = every person's (admin). */
function dsList(user, all) {
  const a = dsGet(), now = Date.now(), iso = ms => new Date(ms).toISOString();
  return Object.keys(a).filter(k => a[k] && a[k].x > now && (all || a[k].e === user.email))
    .map(k => ({ sid: k, email: a[k].e, name: a[k].n || '', created: iso(a[k].c), lastUsed: iso(a[k].u || a[k].c), expires: iso(a[k].x), current: k === user.sid }))
    .sort((p, q) => p.email.localeCompare(q.email) || q.lastUsed.localeCompare(p.lastUsed));
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
  // PRB folders are never customer records, even when directly inside the app root.
  if (/^prb/.test(tagOf(f, 'bimeyar'))) throw err('not_found', 'Customer not found');
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
/**
 * Returns { customer, slot, vehicle?, vslot? } for a file's parent, or throws if it is not inside a customer folder.
 * The parent may be: the customer folder (v2), a v3 sub-folder, or (v4) folder 1–4 of a plate folder or 5.1–5.5
 * inside its folder 5. Every step up must have the right tag and must not be in the trash, and the chain must end
 * at a customer folder inside the root folder; anything else is refused.
 */
function ownerOf(f) {
  const p = (f.parents || [])[0];
  const pm = meta(p);
  const kind = tagOf(pm, 'bimeyar');
  if (kind === 'sub') {
    const cid = (pm.parents || [])[0];
    assertCustomer(cid);
    if (pm.trashed) throw err('not_found', 'File not found');
    return { customer: cid, slot: pm.appProperties.slot || '' };
  }
  if (kind === 'slot') {
    const slot = tagOf(pm, 'slot');
    if (pm.trashed || pm.mimeType !== FOLDER) throw err('not_found', 'File not found');
    let up = meta((pm.parents || [])[0]);
    if (/^5\.[1-5]$/.test(slot)) {
      if (up.trashed || up.mimeType !== FOLDER || tagOf(up, 'bimeyar') !== 'slot' || tagOf(up, 'slot') !== '5') throw err('not_found', 'File not found');
      up = meta((up.parents || [])[0]);
    } else if (!/^[1-4]$/.test(slot)) throw err('not_found', 'File not found');   // never directly in folder 5
    const v = assertVehicle(up.id);
    return { customer: v.customer, slot: '', vehicle: v.id, vslot: slot };
  }
  assertCustomer(p);
  return { customer: p, slot: '' };
}

/* ============================ vehicles and their folders (v4) ============================ */

const tagOf = (f, k) => ((f && f.appProperties) || {})[k] || '';
function tagQuery(v) { return "appProperties has { key='bimeyar' and value='" + v + "' } and trashed=false"; }
function parseObj(s) { try { const o = JSON.parse(s || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch (e) { return {}; } }

/** A plate folder inside a month folder inside a customer folder (all not trashed). Returns { id, month, customer, ym }. */
function assertVehicle(id) {
  if (!id || !/^[\w-]{10,}$/.test(String(id))) throw err('bad_request', 'Missing vehicle');
  const v = meta(id);
  if (v.trashed || v.mimeType !== FOLDER || tagOf(v, 'bimeyar') !== 'vehicle') throw err('not_found', 'Vehicle not found');
  const mo = meta((v.parents || [])[0]);
  if (mo.trashed || mo.mimeType !== FOLDER || tagOf(mo, 'bimeyar') !== 'month') throw err('not_found', 'Vehicle not found');
  const cid = (mo.parents || [])[0];
  assertCustomer(cid);
  return { id: v.id, month: mo.id, customer: cid, ym: tagOf(mo, 'year') + '-' + tagOf(mo, 'month') };
}

/** "2026-07" when it is a real month, else '' */
function ymOk(ym) {
  const m = String(ym || '').match(/^(\d{4})-(\d{2})$/);
  return m && +m[1] >= 1990 && +m[1] <= 2200 && +m[2] >= 1 && +m[2] <= 12 ? m[0] : '';
}
/** Month of a vehicle's folder: contract date, else policy start, else this month (Bangkok). */
function ymOf(d) {
  const x = d.contractDate || d.policyStart;
  return x ? x.slice(0, 7) : Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM');
}
/** "07 July 2026": the number is only for sorting in Drive */
function monthLabel(ym) { return ym.slice(5, 7) + ' ' + MONTHS_EN[+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4); }
/** A Buddhist-year date (2400+) as CE, the same rule as beToCe in js/validate.js */
function ceDate(d) { if (!d) return ''; const y = +d.slice(0, 4); return y > 2400 ? date((y - 543) + d.slice(4)) : d; }
/** Plates compared without province, spaces, dots, dashes and case; Thai digits as 0-9 */
function plateKey(p) {
  return String(p || '').replace(/[๐-๙]/g, ch => String(ch.charCodeAt(0) - 0x0E50))
    .replace(/([0-9])[\s.,]*[฀-๿][฀-๿.\s]*$/, '$1')   // a province after the number ("70-5416 นศ")
    .replace(/[\s.\-]/g, '').toLowerCase();
}
/** appProperties allow at most 124 bytes for key + value: keep the value under 100 bytes (UTF-8) */
function tagVal(s) {
  s = String(s || '');
  const bytes = x => encodeURIComponent(x).replace(/%[0-9A-F]{2}/gi, 'x').length;
  while (s && bytes(s) > 100) s = s.slice(0, -1);
  return s;
}
function childFolders(pid) {
  return Drive.Files.list({ q: "'" + pid + "' in parents and mimeType='" + FOLDER + "' and trashed=false", fields: 'files(id,name,appProperties)', pageSize: 1000, spaces: 'drive' }).files || [];
}

/** Only the vehicle fields present in the request, cleaned ('' = clear that field). */
function vehicleFields(v) {
  const out = {};
  Object.keys(VFIELDS).forEach(k => {
    if (!Object.prototype.hasOwnProperty.call(v, k)) return;
    out[k] = VFIELDS[k] === 'date' ? ceDate(date(v[k])) : k === 'plate' ? fileName(clean(v[k], 40)) : clean(v[k], VFIELDS[k]);
  });
  return out;
}
/** MERGE: old keys stay (also unknown ones), sent fields replace them, an empty sent field is removed. */
function vehicleMerge(old, fields, user, update) {
  const d = Object.assign({}, old);
  Object.keys(fields).forEach(k => { if (fields[k]) d[k] = fields[k]; else delete d[k]; });
  if (!d.plate) throw err('bad_request', 'Plate is required');
  if (d.policyStart && d.policyExpiry && d.policyExpiry <= d.policyStart) throw err('bad_request', 'Expiry must be after start');
  d.by = old.by || user.email;
  if (update) d.updBy = user.email;
  return d;
}

/** The month folder of a customer (by its tags). create: make it when missing (call inside the lock). */
function monthFolder(customerId, ym, create) {
  const y = ym.slice(0, 4), m = ym.slice(5, 7);
  const hit = (Drive.Files.list({
    q: "'" + customerId + "' in parents and mimeType='" + FOLDER + "' and trashed=false and appProperties has { key='bimeyar' and value='month' } and appProperties has { key='year' and value='" + y + "' } and appProperties has { key='month' and value='" + m + "' }",
    fields: 'files(id)', spaces: 'drive',
  }).files || [])[0];
  if (hit || !create) return hit ? hit.id : '';
  return Drive.Files.create({ name: monthLabel(ym), mimeType: FOLDER, parents: [customerId], appProperties: { bimeyar: 'month', year: y, month: m } }, null, { fields: 'id' }).id;
}

/**
 * { '1': id, …, '5': id, '5.1': id, … } of a plate folder. create: the missing ones are made (inside the lock,
 * checked again there, so two uploads at once never make a folder twice). Only creates, never moves or deletes.
 */
function vehicleSlots(vid, create) {
  const read = () => {
    const out = {};
    childFolders(vid).forEach(k => { const s = tagOf(k, 'slot'); if (tagOf(k, 'bimeyar') === 'slot' && /^[1-5]$/.test(s) && !out[s]) out[s] = k.id; });
    if (out['5']) childFolders(out['5']).forEach(k => { const s = tagOf(k, 'slot'); if (tagOf(k, 'bimeyar') === 'slot' && /^5\.[1-5]$/.test(s) && !out[s]) out[s] = k.id; });
    return out;
  };
  let out = read();
  if (!create || VSLOTS.every(s => out[s.slot])) return out;
  return withLock(() => {
    out = read();
    VSLOTS.forEach(s => {
      if (out[s.slot]) return;
      out[s.slot] = Drive.Files.create({ name: s.name, mimeType: FOLDER, parents: [s.in ? out[s.in] : vid], appProperties: { bimeyar: 'slot', slot: s.slot } }, null, { fields: 'id' }).id;
    });
    return out;
  });
}

/** All vehicles of the given customers ({ id: customer }), and which folder belongs to which vehicle. */
function vehicleTree(ids) {
  const monthOf = {}, vehOf = {}, slotOf = {}, vehicles = [];
  listAll(tagQuery('month')).forEach(m => {
    const cid = (m.parents || [])[0];
    if (ids[cid] && m.mimeType === FOLDER) monthOf[m.id] = { customer: cid, ym: tagOf(m, 'year') + '-' + tagOf(m, 'month') };
  });
  listAll(tagQuery('vehicle')).forEach(f => {
    const mo = monthOf[(f.parents || [])[0]];
    if (!mo || f.mimeType !== FOLDER) return;
    const v = toVehicle(f, mo.customer, mo.ym, {});
    vehOf[f.id] = v; vehicles.push(v);
  });
  const slots = listAll(tagQuery('slot')).filter(s => s.mimeType === FOLDER);
  slots.forEach(s => {
    const k = tagOf(s, 'slot'), v = vehOf[(s.parents || [])[0]];
    if (v && /^[1-5]$/.test(k) && !v.folders[k]) { v.folders[k] = s.id; slotOf[s.id] = { v, slot: k }; }
  });
  slots.forEach(s => {
    const k = tagOf(s, 'slot'), up = slotOf[(s.parents || [])[0]];
    if (up && up.slot === '5' && /^5\.[1-5]$/.test(k) && !up.v.folders[k]) { up.v.folders[k] = s.id; slotOf[s.id] = { v: up.v, slot: k }; }
  });
  return { vehicles, slotOf };
}

function toVehicle(f, customerId, ym, folders) {
  const d = parseObj(f.description);
  const v = { id: f.id, customerId, ym, folderName: f.name, createdAt: f.createdTime || '', by: d.by || '', folders: folders || {} };
  Object.keys(VFIELDS).forEach(k => { v[k] = d[k] || ''; });
  if (!v.plate) v.plate = tagOf(f, 'plate') || f.name;
  return v;
}

/** Is this folder one of the customer's own folders (the customer folder, a v3 sub-folder or a v4 file folder)? */
function folderOfCustomer(id, customer) {
  try {
    const f = meta(id);
    if (f.trashed || f.mimeType !== FOLDER) return false;
    if (id === customer) return true;
    const kind = tagOf(f, 'bimeyar');
    if (kind === 'sub') { assertCustomer(customer); return (f.parents || [])[0] === customer; }
    if (kind === 'slot') return ownerOf({ parents: [id] }).customer === customer;
    return false;
  } catch (e) { return false; }
}

const MOVED = 'Moved from: ', RESTORED = 'Restored: ', AIED = 'AI edit ';
/** v4.3: the v2/v3 file type that matches a v4 folder (kept for old screens and filters) */
const SLOT_TYPE = { '1': 'policy', '2': 'policy', '3': 'policy', '5.2': 'policy', '4': 'payment', '5.4': 'payment', '5.1': 'car', '5.3': 'car', '5.5': 'id' };
const AIEDIT_KEEP = 5;
function aiLogGet() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('AIEDIT_LOG') || '[]') || []; } catch (e) { return []; } }
function aiLogEdit(fn) {
  withLock(() => {
    const a = aiLogGet();
    fn(a);
    PropertiesService.getScriptProperties().setProperty('AIEDIT_LOG', JSON.stringify(a.slice(-AIEDIT_KEEP)));
  });
}
/** Adds (or counts up) a batch in the log; only the last 5 batches are kept and can be undone */
function aiLogBatch(batch, user, cid, cname, n) {
  aiLogEdit(a => {
    let e = a.filter(x => x.b === batch)[0];
    if (!e) { e = { b: batch, at: new Date().toISOString(), by: user.email.slice(0, 100), c: cid, cn: clean(cname, 60), n: 0 }; a.push(e); }
    e.n += n;
  });
}
/** "AI edit <b>: old ⇒ new [from>to|type]" -> { b, old, name, from, to, type } */
function aiLine(l) {
  if (l.indexOf(AIED) !== 0) return null;
  const s = l.slice(AIED.length), c = s.indexOf(': '), k = s.lastIndexOf(' ['), a = s.lastIndexOf(ARROW, k);
  if (c < 0 || k < 0 || a < c) return null;
  const m = s.slice(k + 2).match(/^([\w-]*)>([\w-]*)\|(\w*)\]$/);
  if (!m) return null;
  return { b: s.slice(0, c), old: s.slice(c + 2, a), name: s.slice(a + ARROW.length, k), from: m[1], to: m[2], type: m[3] };
}
/** One file of aiEditApply */
function aiEditOne(id, it, batch, cid) {
  const m = assertFile(id);
  if (tagOf(m, 'kind') === 'invoice') return { id, status: 'invoice' };
  const own = ownerOf(m);
  if (own.customer !== cid) throw err('bad_request', 'This file belongs to another customer');
  const cur = Drive.Files.get(id, { fields: 'id,name,description,parents' });
  const from = (cur.parents || [])[0];
  let target = from, type = tagOf(m, 'type') || 'other';
  if (it.vehicleId) {
    const v = assertVehicle(String(it.vehicleId));
    if (v.customer !== own.customer) throw err('bad_request', 'This vehicle belongs to another customer');
    if (VFILE_SLOTS.indexOf(String(it.slot)) < 0) throw err('bad_request', 'Unknown folder');
    target = vehicleSlots(v.id, true)[String(it.slot)];
    type = SLOT_TYPE[String(it.slot)] || type;
  }
  let want = cur.name;
  if (it.name) {
    want = fileName(it.name);
    const e = extOf(cur.name);
    if (e && want.toLowerCase().slice(-e.length) !== e.toLowerCase()) want = fileName(want + e);   // the extension never changes
    if (!want || want === e) return { id, status: 'empty' };
  }
  return withLock(() => {
    const name = want === cur.name && target === from ? want : uniqueName(want, siblingNames(target, id));
    if (name === cur.name && target === from) return { id, status: 'same' };
    const d = descSplit(cur.description);
    const ai = d.meta.filter(l => l.indexOf(AIED) === 0);
    const meta = d.meta.filter(l => l.indexOf(AIED) !== 0).concat(ai.slice(-(AIEDIT_KEEP - 1)))
      .concat([AIED + batch + ': ' + cur.name + ARROW + name + ' [' + from + '>' + target + '|' + (tagOf(m, 'type') || '') + ']']);
    const res = { name, description: descJoin(d.note, meta), appProperties: { aib: batch, type: type } };
    if (target !== from) Drive.Files.update(res, id, null, { addParents: target, removeParents: from });
    else Drive.Files.update(res, id);
    return { id, status: 'ok', name, moved: target !== from };
  });
}
/** Undo of one file: only when the file is still exactly as this batch left it */
function undoAiFile(id, batch) {
  const m = assertFile(id), own = ownerOf(m);
  const f = Drive.Files.get(id, { fields: 'id,name,description,parents,appProperties' });
  const now = (f.parents || [])[0], d = descSplit(f.description);
  let i = d.meta.length - 1;
  while (i >= 0 && d.meta[i].indexOf(AIED) !== 0) i--;
  const L = i >= 0 ? aiLine(d.meta[i]) : null;
  if (!L || L.b !== batch || (f.appProperties || {}).aib !== batch || f.name !== L.name || now !== L.to) return false;
  withLock(() => {
    d.meta.splice(i, 1);
    const prev = d.meta.map(aiLine).filter(Boolean).pop();
    const target = L.from && L.from !== now && folderOfCustomer(L.from, own.customer) ? L.from : now;
    const res = { name: uniqueName(L.old, siblingNames(target, id)), description: descJoin(d.note, d.meta), appProperties: { aib: prev ? prev.b : null, type: L.type || null } };
    if (target !== now) Drive.Files.update(res, id, null, { addParents: target, removeParents: now });
    else Drive.Files.update(res, id);
  });
  return true;
}
/** The ticked vehicle data of an AI edit, MERGED; the old values are kept in `_ai` (last 5) for the undo */
function aiEditVehicle(id, fields, batch, user, cid) {
  const own = assertVehicle(id);
  if (own.customer !== cid) throw err('bad_request', 'This vehicle belongs to another customer');
  const f = vehicleFields(fields);
  delete f.plate;   // the plate (= folder name) is never changed by an AI edit
  const cur = Drive.Files.get(id, { fields: 'id,name,description' });
  const old = parseObj(cur.description);
  const o = {}, n = {};
  Object.keys(f).forEach(k => { if ((old[k] || '') !== (f[k] || '')) { o[k] = old[k] || ''; n[k] = f[k] || ''; } });
  if (!Object.keys(n).length) return { id, status: 'same' };
  const d = vehicleMerge(old, n, user, true);
  d._ai = (Array.isArray(old._ai) ? old._ai : []).slice(-(AIEDIT_KEEP - 1)).concat([{ b: batch, o: o, n: n, u: old.updBy || '' }]);
  Drive.Files.update({ description: JSON.stringify(d), appProperties: { aib: batch } }, id);
  return { id, status: 'ok', fields: Object.keys(n) };
}
/** Undo of a vehicle's data: each field only when it still has the value this batch gave it */
function undoAiVehicle(id, batch) {
  assertVehicle(id);
  const cur = Drive.Files.get(id, { fields: 'id,description' });
  const d = parseObj(cur.description);
  const list = Array.isArray(d._ai) ? d._ai : [];
  const e = list.filter(x => x && x.b === batch)[0];
  if (!e) return false;
  Object.keys(e.n || {}).forEach(k => { if ((d[k] || '') === (e.n[k] || '')) { if (e.o[k]) d[k] = e.o[k]; else delete d[k]; } });
  d._ai = list.filter(x => x !== e);
  if (e.u) d.updBy = e.u; else delete d.updBy;   // exactly as before: also who changed it last
  const prev = d._ai[d._ai.length - 1];
  if (!d._ai.length) delete d._ai;
  Drive.Files.update({ description: JSON.stringify(d), appProperties: { aib: prev ? prev.b : null } }, id);
  return true;
}
/**
 * From a file's description lines: its oldest name (the "old" of the FIRST "Renamed:" line, i.e. before the first
 * change by the app) and the folder it had before the first move by the move tool ("Moved from: name [id]").
 */
function nameHistory(meta) {
  const ren = meta.filter(l => l.indexOf(RENAMED) === 0)[0];
  const mv = meta.filter(l => l.indexOf(MOVED) === 0)[0];
  let oldest = '', fromId = '', fromName = '';
  if (ren) { const s = ren.slice(RENAMED.length), k = s.lastIndexOf(ARROW); if (k > 0) oldest = s.slice(0, k); }
  if (mv) { const m = mv.slice(MOVED.length).match(/^(.*) \[([\w-]{10,})\]$/); if (m) { fromName = m[1]; fromId = m[2]; } }
  return { oldest, fromId, fromName };
}
/** One file of restoreNames */
function restoreOne(id, it, batch) {
  const m = assertFile(id);
  if (tagOf(m, 'kind') === 'invoice') return { id, status: 'invoice' };   // an invoice keeps its number as name
  const own = ownerOf(m);
  const cur = Drive.Files.get(id, { fields: 'id,name,description,parents' });
  const d = descSplit(cur.description), h = nameHistory(d.meta);
  if (!h.oldest) return { id, status: 'nohistory' };
  let want = fileName((it && it.name) || h.oldest);
  const e = extOf(h.oldest) || extOf(cur.name);
  if (e && want.toLowerCase().slice(-e.length) !== e.toLowerCase()) want = fileName(want + e);   // never without its extension
  if (!want || want === e) return { id, status: 'empty' };
  const from = (cur.parents || [])[0];
  let target = from, note = '';
  if (it && it.back && h.fromId && h.fromId !== from) {
    if (folderOfCustomer(h.fromId, own.customer)) target = h.fromId; else note = 'folder_gone';   // never re-created
  }
  return withLock(() => {
    const name = uniqueName(want, siblingNames(target, id));
    if (name === cur.name && target === from) return { id, status: 'same', note };
    const res = { name, description: descJoin(d.note, d.meta.concat([RESTORED + cur.name + ARROW + name])), appProperties: { rsb: batch, rsf: from, rst: target } };
    if (target !== from) Drive.Files.update(res, id, null, { addParents: target, removeParents: from });
    else Drive.Files.update(res, id);
    return { id, status: 'ok', name, moved: target !== from, note };
  });
}
/** Undo of one restored file. false = left as it is (changed again since, or the folder it came from is gone). */
function undoRestoreOne(id) {
  const m = assertFile(id), own = ownerOf(m);
  const f = Drive.Files.get(id, { fields: 'id,name,description,parents,appProperties' });
  const a = f.appProperties || {}, now = (f.parents || [])[0];
  const clear = { rsb: null, rsf: null, rst: null };
  const d = descSplit(f.description);
  let i = d.meta.length - 1;
  while (i >= 0 && d.meta[i].indexOf(RESTORED) !== 0) i--;
  const s = i >= 0 ? d.meta[i].slice(RESTORED.length) : '', k = s.lastIndexOf(ARROW);
  const before = k > 0 ? s.slice(0, k) : '', after = k > 0 ? s.slice(k + ARROW.length) : '';
  if (!before || after !== f.name || now !== a.rst) { Drive.Files.update({ appProperties: clear }, id); return false; }
  withLock(() => {
    d.meta.splice(i, 1);
    const target = a.rsf && a.rsf !== now && folderOfCustomer(a.rsf, own.customer) ? a.rsf : now;
    const res = { name: uniqueName(before, siblingNames(target, id)), description: descJoin(d.note, d.meta), appProperties: clear };
    if (target !== now) Drive.Files.update(res, id, null, { addParents: target, removeParents: now });
    else Drive.Files.update(res, id);
  });
  return true;
}
/** One file of the move tool (see moveNew). */
function moveOne(id, it, batch) {
  const m = assertFile(id), own = ownerOf(m);
  const v = assertVehicle(String((it && it.vehicleId) || ''));
  if (v.customer !== own.customer) throw err('bad_request', 'This vehicle belongs to another customer');
  const slot = String((it && it.slot) || '');
  if (VFILE_SLOTS.indexOf(slot) < 0) throw err('bad_request', 'Unknown folder');
  const inv = tagOf(m, 'kind') === 'invoice';
  const target = vehicleSlots(v.id, true)[slot];
  const from = (m.parents || [])[0];
  if (from === target) return { id, status: 'same' };
  const cur = Drive.Files.get(id, { fields: 'id,name,description' });
  const fromName = Drive.Files.get(from, { fields: 'name' }).name;
  return withLock(() => {
    let name = cur.name;
    if (!inv && it.name) {
      let n = fileName(it.name);
      const e = extOf(cur.name);
      if (e && n.toLowerCase().slice(-e.length) !== e.toLowerCase()) n = fileName(n + e);   // the extension never changes
      if (n && n !== e) name = n;
    }
    if (!inv) name = uniqueName(name, siblingNames(target, id));   // never the same name twice in a folder
    const res = { appProperties: { mvb: batch, mvf: from, mvt: target, mvo: name !== cur.name ? '1' : null } };
    if (name !== cur.name) res.name = name;
    if (!inv) {   // an invoice's description is its JSON data: never add lines to it
      const d = descSplit(cur.description);
      const lines = d.meta.concat([MOVED + fromName + ' [' + from + ']']);
      if (name !== cur.name) lines.push(RENAMED + cur.name + ARROW + name);
      res.description = descJoin(d.note, lines);
    }
    Drive.Files.update(res, id, null, { addParents: target, removeParents: from });
    return { id, status: 'ok', old: cur.name, name };
  });
}
/** Undo of one moved file. false = left as it is (moved again by hand, or its old folder is gone). */
function undoMoveOne(id) {
  const m = assertFile(id), own = ownerOf(m);
  const f = Drive.Files.get(id, { fields: 'id,name,description,parents,appProperties' });
  const a = f.appProperties || {}, now = (f.parents || [])[0];
  const clear = { mvb: null, mvf: null, mvt: null, mvo: null };
  if (!a.mvf || now !== a.mvt || !folderOfCustomer(a.mvf, own.customer)) { Drive.Files.update({ appProperties: clear }, id); return false; }
  withLock(() => {
    const res = { appProperties: clear };
    if (a.kind !== 'invoice') {
      const d = descSplit(f.description);
      let i = d.meta.length - 1;
      while (i >= 0 && d.meta[i].indexOf(MOVED) !== 0) i--;
      let name = f.name;
      if (i >= 0) {
        const ren = a.mvo === '1' && d.meta[i + 1] && d.meta[i + 1].indexOf(RENAMED) === 0 ? d.meta[i + 1] : '';
        if (ren) {
          const s = ren.slice(RENAMED.length), k = s.lastIndexOf(ARROW);
          if (k > 0 && s.slice(k + ARROW.length) === f.name) name = s.slice(0, k);   // renamed again since: keep that name
        }
        d.meta.splice(i, ren ? 2 : 1);
      }
      name = uniqueName(name, siblingNames(a.mvf, id));
      if (name !== f.name) res.name = name;
      res.description = descJoin(d.note, d.meta);
    }
    Drive.Files.update(res, id, null, { addParents: a.mvf, removeParents: now });
  });
  return true;
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
function toFileOf(x, own) { return toFile(x, own.customer, own.slot, own.vehicle, own.vslot); }
/** slot = v3 sub-folder; vehicleId + vslot = v4 folder ('1'…'4', '5.1'…'5.5') */
function toFile(x, customerId, slot, vehicleId, vslot) {
  const ap = x.appProperties || {};
  const inv = ap.kind === 'invoice';
  const d = inv ? { note: '', meta: [] } : descSplit(x.description);
  const orig = d.meta.filter(l => l.indexOf(ORIG) === 0)[0];
  return {
    id: x.id, customerId: customerId || (x.parents || [])[0] || '', folder: slot || '', name: x.name, type: ap.type || 'other', expiry: ap.expiry || '',
    note: d.note, mime: x.mimeType, size: +x.size || 0, createdAt: x.createdTime, by: ap.by || '', at: ap.at || x.createdTime,
    invoice: inv ? (ap.invNo || x.name) : '',
    orig: orig ? orig.slice(ORIG.length) : '', shared: ap.link === '1',   // v3.2
    vehicleId: vehicleId || '', vslot: vslot || '',                       // v4
    aib: ap.aib || '',                                                    // v4.3: last "Edit with AI" batch
  };
}

/* ---------- file names and description lines (v3.2) ---------- */

/**
 * Lines the app adds to a file's description: the original file name, the rename history and (v4) the old folder.
 * The app shows the rest of the description as the file's note and never changes these lines.
 */
const ORIG = 'Original file name: ', RENAMED = 'Renamed: ', ARROW = ' ⇒ ';
function descSplit(desc) {
  const note = [], meta = [];
  String(desc || '').split('\n').forEach(l => (l.indexOf(ORIG) === 0 || l.indexOf(RENAMED) === 0 || l.indexOf(MOVED) === 0 || l.indexOf(RESTORED) === 0 || l.indexOf(AIED) === 0 ? meta : note).push(l));
  return { note: note.join('\n').trim(), meta };
}
function descJoin(note, meta) {
  meta = meta.slice();
  // keep the description short: the original name, the FIRST rename (v4.2: the oldest name is never lost) + the last 9
  for (;;) {
    const at = meta.map((l, i) => l.indexOf(RENAMED) === 0 ? i : -1).filter(i => i >= 0);
    if (at.length <= 10) break;
    meta.splice(at[1], 1);
  }
  return (note ? note + (meta.length ? '\n\n' : '') : '') + meta.join('\n');
}
/** File name without / \ : * ? " < > | (and control characters), at most 200 characters, extension kept. */
function fileName(s) {
  let n = String(s == null ? '' : s).replace(/[\/\\:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim();
  if (n.length > 200) { const e = extOf(n); n = n.slice(0, 200 - e.length).trim() + e; }
  return n;
}
function extOf(name) { const m = String(name || '').match(/\.([A-Za-z0-9]{1,8})$/); return m ? '.' + m[1] : ''; }
/** Names of everything else in a folder, as { name: 1 }. */
function siblingNames(parent, exceptId) {
  const names = {};
  let page;
  do {
    const r = Drive.Files.list({ q: "'" + parent + "' in parents and trashed=false", fields: 'nextPageToken,files(id,name)', pageSize: 1000, pageToken: page, spaces: 'drive' });
    (r.files || []).forEach(f => { if (f.id !== exceptId) names[f.name] = 1; });
    page = r.nextPageToken;
  } while (page);
  return names;
}
/** "name.pdf" -> "name (2).pdf", "name (3).pdf"… until it is free. Same rule as uniqueIn in js/naming.js. */
function uniqueName(name, taken) {
  if (!taken[name]) return name;
  const e = extOf(name), base = e ? name.slice(0, -e.length) : name;
  for (let i = 2; i < 1000; i++) { const n = base + ' (' + i + ')' + e; if (!taken[n]) return n; }
  return base + ' (' + Date.now() + ')' + e;
}
/**
 * Two uploads at the same moment can pick the same free name. After saving, the later one moves on to the next number.
 * Only the name changes. A busy lock never fails an upload that is already saved.
 */
function settleName(f, parent) {
  try {
    return withLock(() => {
      const taken = siblingNames(parent, f.id);
      return taken[f.name] ? Drive.Files.update({ name: uniqueName(f.name, taken) }, f.id, null, { fields: FIELDS }) : f;
    });
  } catch (e) { return f; }
}
/** One file of the rename tool. Only the name (and the description line + batch tag) change. */
function renameOne(id, newName, batch) {
  const m = assertFile(id);
  if (m.appProperties && m.appProperties.kind === 'invoice') return { id, status: 'invoice' };
  const cur = Drive.Files.get(id, { fields: 'id,name,description,parents' });
  let name = fileName(newName);
  const e = extOf(cur.name);
  if (e && name.toLowerCase().slice(-e.length) !== e.toLowerCase()) name = fileName(name + e);   // the extension never changes
  if (!name || name === e) return { id, status: 'empty' };
  if (name === cur.name) return { id, status: 'same', name };
  return withLock(() => {
    name = uniqueName(name, siblingNames((cur.parents || [])[0], id));
    if (name === cur.name) return { id, status: 'same', name };
    const d = descSplit(cur.description);
    Drive.Files.update({ name, description: descJoin(d.note, d.meta.concat([RENAMED + cur.name + ARROW + name])), appProperties: { rnb: batch } }, id);
    return { id, status: 'ok', old: cur.name, name };
  });
}

/* ============================ compulsory insurance (v4.5) ============================ */

const PRB_FIELDS = {
  prbNo: 20, barcode: 30, plate: 40, province: 60, brand: 40, model: 60, body: 60, vin: 40, engineNo: 40,
  vehicleCode: 20, cc: 20, seats: 20, weight: 20, companyCode: 20, insurer: 80, policyNo: 80, receiptNo: 40,
  contractDate: 'date', issueDate: 'date', start: 'date', end: 'date', periodTime: 20,
  netPremium: 'money', discount: 'money', stamps: 'money', vat: 'money', total: 'money',
  brokerName: 120, brokerLicense: 60, note: 500,
};

/** Only supplied fields: an absent total must remain absent so totals can be derived. */
function prbFields(x) {
  const out = {};
  Object.keys(PRB_FIELDS).forEach(k => {
    if (!Object.prototype.hasOwnProperty.call(x, k)) return;
    const v = x[k], t = PRB_FIELDS[k];
    if (t === 'date') out[k] = date(ceDate(String(v || '')));
    else if (t === 'money') out[k] = v == null || String(v).trim() === '' ? '' : prbSatang(v) / 100;
    else if (k === 'prbNo' || k === 'barcode') out[k] = String(v == null ? '' : v).replace(/\D/g, '').slice(0, t);
    else out[k] = clean(v, t);
  });
  return out;
}
function prbSatang(v) {
  const n = satang(v);
  if (!Number.isSafeInteger(n)) throw err('bad_request', 'Amount is too large');
  return n;
}
/** Same integer-satang algorithm as the PRB preview; a supplied zero total is authoritative. */
function prbTotals(rows) {
  const sums = { net: 0, stamps: 0, vat: 0, total: 0 };
  const lines = rows.map(r => {
    const net = prbSatang(r.netPremium), stamps = prbSatang(r.stamps), vat = prbSatang(r.vat);
    const total = r.total != null && String(r.total).trim() !== '' ? prbSatang(r.total) : net + stamps + vat;
    const line = { net, stamps, vat, total };
    Object.keys(sums).forEach(k => {
      sums[k] += line[k];
      if (!Number.isSafeInteger(sums[k])) throw err('bad_request', 'Amount is too large');
      line[k] /= 100;
    });
    return line;
  });
  Object.keys(sums).forEach(k => { sums[k] /= 100; });
  return Object.assign({ lines }, sums);
}

/** Read paths never call rootId(): listing must not create folders or write Script properties. */
function prbAppRoot() {
  const id = PropertiesService.getScriptProperties().getProperty('ROOT_ID');
  if (!id) return '';
  const f = meta(id);
  if (f.trashed || f.mimeType !== FOLDER || tagOf(f, 'bimeyar') !== 'root') throw err('not_found', 'App root not found');
  return id;
}
/** create=true is called only inside the upload/import script lock. Never adopts a differently tagged folder. */
function prbRoot(create) {
  const root = prbAppRoot();
  if (!root) {
    if (create) throw err('not_found', 'App root not configured');
    return '';
  }
  const props = PropertiesService.getScriptProperties(), cached = props.getProperty('PRB_ROOT_ID');
  const valid = f => !f.trashed && f.mimeType === FOLDER && tagOf(f, 'bimeyar') === 'prbroot' && (f.parents || []).length === 1 && f.parents[0] === root;
  if (cached) {
    try { if (valid(meta(cached))) return cached; } catch (e) { if (e.code !== 'not_found') throw e; }
  }
  const folders = listAll("'" + root + "' in parents and mimeType='" + FOLDER + "' and trashed=false");
  let f = folders.find(valid);
  if (!create) return f ? f.id : '';
  if (!f) {
    f = folders.find(x => x.name === 'พ.ร.บ.' && !tagOf(x, 'bimeyar'));
    f = f ? Drive.Files.update({ appProperties: { bimeyar: 'prbroot' } }, f.id, null, { fields: FIELDS }) :
      Drive.Files.create({ name: 'พ.ร.บ.', mimeType: FOLDER, parents: [root], appProperties: { bimeyar: 'prbroot' } }, null, { fields: FIELDS });
  }
  props.setProperty('PRB_ROOT_ID', f.id);
  return f.id;
}
function prbRead(id) {
  if (!id || !/^[\w-]+$/.test(String(id))) throw err('bad_request', 'Missing or invalid id');
  try { return Drive.Files.get(id, { fields: FIELDS + ',trashed' }); }
  catch (e) { throw err('not_found', 'PRB item not found'); }
}
function prbAssertInsured(id) {
  const f = prbRead(id), root = prbRoot(false);
  if (!root || f.trashed || f.mimeType !== FOLDER || tagOf(f, 'bimeyar') !== 'prbins' ||
      (f.parents || []).length !== 1 || f.parents[0] !== root) throw err('not_found', 'Insured folder not found');
  return f;
}
function prbAssertFile(id, kind) {
  const f = prbRead(id), k = tagOf(f, 'kind');
  if (f.trashed || f.mimeType === FOLDER || tagOf(f, 'bimeyar') !== 'prb' ||
      (kind ? k !== kind : k !== 'prb' && k !== 'prbinv') || (f.parents || []).length !== 1) throw err('not_found', 'PRB file not found');
  prbAssertInsured(f.parents[0]);
  return f;
}
function prbToInsured(f) {
  const d = parseObj(f.description);
  return { id: f.id, name: d.name || f.name, taxId: d.taxId || '', address: d.address || '', createdAt: f.createdTime || '' };
}
function prbToRow(f) {
  const row = prbFields(parseObj(f.description));
  Object.keys(PRB_FIELDS).forEach(k => { if (!Object.prototype.hasOwnProperty.call(row, k)) row[k] = ''; });
  return Object.assign(row, { id: f.id, insuredId: (f.parents || [])[0], name: f.name, mime: f.mimeType,
    size: +f.size || 0, createdAt: f.createdTime || '', by: tagOf(f, 'by'), shared: tagOf(f, 'link') === '1', src: tagOf(f, 'src') });
}
function prbToInvoice(f) {
  return Object.assign({}, parseObj(f.description), { id: f.id, fileName: f.name, createdTime: f.createdTime || '' });
}
function prbList() {
  const root = prbRoot(false), out = { root, insured: [], rows: [], invoices: [] };
  if (!root) return out;
  const ids = new Set();
  listAll("'" + root + "' in parents and " + tagQuery('prbins')).forEach(f => {
    if (f.mimeType !== FOLDER || (f.parents || []).length !== 1) return;
    ids.add(f.id); out.insured.push(prbToInsured(f));
  });
  listAll(tagQuery('prb')).forEach(f => {
    if (f.mimeType === FOLDER || (f.parents || []).length !== 1 || !ids.has(f.parents[0])) return;
    if (tagOf(f, 'kind') === 'prb') out.rows.push(prbToRow(f));
    else if (tagOf(f, 'kind') === 'prbinv') out.invoices.push(prbToInvoice(f));
  });
  return out;
}
function prbInsuredFields(x) {
  // Unlike fileName, no truncation: the insured's full printed name is the identity.
  const name = String(x.name == null ? '' : x.name).replace(/[\/\\:*?"<>|\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (!name) throw err('bad_request', 'Insured name is required');
  const d = { name };
  ['taxId', 'address'].forEach(k => { if (Object.prototype.hasOwnProperty.call(x, k)) d[k] = clean(x[k], k === 'taxId' ? 40 : 500); });
  return d;
}
function prbInsured(d, user) {
  const root = prbRoot(true);
  const ik = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, d.name, Utilities.Charset.UTF_8)
    .map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('').slice(0, 32);
  const found = listAll("'" + root + "' in parents and " + tagQuery('prbins') + " and appProperties has { key='ik' and value='" + ik + "' }")
    .find(f => f.mimeType === FOLDER && (f.parents || []).length === 1);
  const merged = Object.assign({ taxId: '', address: '', by: user.email, at: new Date().toISOString() }, found ? parseObj(found.description) : {}, d);
  const res = { description: JSON.stringify(merged) };
  return found ? Drive.Files.update(res, found.id, null, { fields: FIELDS }) : Drive.Files.create(Object.assign(res, {
    name: d.name, mimeType: FOLDER, parents: [root], appProperties: { bimeyar: 'prbins', ik },
  }), null, { fields: FIELDS });
}
/** Call under the script lock, including the subsequent create/update/copy. */
function prbDuplicate(row, exceptId) {
  if (!row.prbNo && !row.barcode) return;
  const files = listAll(tagQuery('prb') + " and appProperties has { key='kind' and value='prb' }");
  const dup = files.find(f => {
    if (f.id === exceptId || f.mimeType === FOLDER) return false;
    const d = parseObj(f.description);
    return (row.prbNo && row.prbNo === (d.prbNo || tagOf(f, 'prbNo'))) || (row.barcode && row.barcode === (d.barcode || tagOf(f, 'barcode')));
  });
  if (dup) throw err('duplicate', 'Already used by ' + dup.name);
}
function prbRowProps(row) {
  return { bimeyar: 'prb', kind: 'prb', prbNo: row.prbNo || '', barcode: row.barcode || '', plate: tagVal(row.plate), end: row.end || '' };
}
function prbUpload(req, user) {
  const insured = prbInsuredFields(req.insured || {}), row = prbFields(req.row || {}), m = req.meta || {};
  if (!req.data || typeof req.data !== 'string') throw err('bad_request', 'No file data');
  const bytes = Utilities.base64Decode(req.data);
  if (bytes.length > MAX_BYTES) throw err('too_big', 'File is larger than 25 MB');
  if (!bytes.length) throw err('bad_request', 'No file data');
  const mime = clean(m.mime, 120) || 'application/octet-stream';
  // พ.ร.บ. files are PDFs or photos only (never HTML or other types that a browser could run)
  if (!/^(application\/pdf|image\/(jpeg|png|webp|heic|heif))$/.test(mime)) throw err('bad_request', 'Upload a PDF or a photo');
  let name = fileName(m.name) || fileName(m.orig) || 'file';
  if (!extOf(name) && extOf(m.orig)) name = fileName(name + extOf(m.orig));
  return withLock(() => {
    prbDuplicate(row);
    const folder = prbInsured(insured, user);
    name = uniqueName(name, siblingNames(folder.id));
    const f = Drive.Files.create({ name, mimeType: mime, parents: [folder.id], description: JSON.stringify(row),
      appProperties: Object.assign(prbRowProps(row), { by: tagVal(user.email), at: new Date().toISOString() }),
    }, Utilities.newBlob(bytes, mime, name), { fields: FIELDS });
    return { insured: prbToInsured(folder), row: prbToRow(f) };
  });
}
function prbSharing(id, share) {
  return withLock(() => {
    prbAssertFile(id);
    // collect first (removing while paging would skip permissions)
    const anyone = [];
    let page;
    do {
      const r = Drive.Permissions.list(id, { fields: 'nextPageToken,permissions(id,type,role,allowFileDiscovery)', pageSize: 100, pageToken: page });
      (r.permissions || []).forEach(p => { if (p.type === 'anyone') anyone.push(p); });
      page = r.nextPageToken;
    } while (page);
    // share: one link-only viewer permission. A searchable "anyone" permission is removed and made again link-only
    // (allowFileDiscovery cannot be changed by update); the role is lowered to viewer, as in shareFile.
    let keep = share ? anyone.filter(p => p.allowFileDiscovery !== true)[0] : null;
    anyone.forEach(p => { if (p !== keep) Drive.Permissions.remove(id, p.id); });
    if (keep && keep.role !== 'reader') Drive.Permissions.update({ role: 'reader' }, id, keep.id);
    if (share && !keep) Drive.Permissions.create({ type: 'anyone', role: 'reader', allowFileDiscovery: false }, id);
    const f = Drive.Files.update({ appProperties: { link: share ? '1' : null } }, id, null, { fields: FIELDS + ',webViewLink' });
    const row = tagOf(f, 'kind') === 'prbinv' ? prbToInvoice(f) : prbToRow(f);
    return share ? { row, link: f.webViewLink || ('https://drive.google.com/file/d/' + id + '/view?usp=sharing') } : row;
  });
}
function prbImportSource(id) {
  const f = assertFile(id), own = ownerOf(f);
  if (!own.vehicle || own.vslot !== '3') throw err('bad_request', 'Source must be in vehicle folder 3');
  return { f: Drive.Files.get(id, { fields: FIELDS }), own, vehicle: assertVehicle(own.vehicle) };
}
function prbImportPlan() {
  const root = prbAppRoot();
  if (!root) return [];
  const copies = {};
  prbList().rows.forEach(r => { if (r.src) copies[r.src] = r.id; });
  const out = [], all = listAll(tagQuery('item')), customers = {};
  all.forEach(f => { if (f.mimeType === FOLDER && (f.parents || [])[0] === root) customers[f.id] = f; });
  const tree = vehicleTree(customers);
  all.forEach(f => {
    const slot = tree.slotOf[(f.parents || [])[0]];
    if (f.mimeType === FOLDER || !slot || slot.slot !== '3') return;
    // the vehicle tree already checked the chain (as list does); prbImport checks each chosen file again
    const v = slot.v, c = customers[v.customerId];
    if (!c) return;
    out.push({ id: f.id, name: f.name, mime: f.mimeType, size: +f.size || 0, customerId: c.id,
      customer: c.name, vehicleId: v.id, plate: v.plate || '', ym: v.ym || '', imported: copies[f.id] || '' });
  });
  return out;
}
function prbImport(req, user) {
  if (!Array.isArray(req.items) || req.items.length > 20) throw err('bad_request', 'Import at most 20 files');
  const out = { done: [], skipped: [] };
  req.items.forEach(item => {
    const id = item && item.id;
    try {
      const result = withLock(() => {
        const src = prbImportSource(id), row = prbFields(item.row || {}), insured = prbInsuredFields(item.insured || {});
        const existing = prbList().rows.find(r => r.src === id);
        if (existing) throw err('duplicate', 'Already imported as ' + existing.name);
        prbDuplicate(row);
        const folder = prbInsured(insured, user);
        let name = fileName(item.name) || fileName(src.f.name) || 'file';
        if (!extOf(name) && extOf(src.f.name)) name = fileName(name + extOf(src.f.name));
        name = uniqueName(name, siblingNames(folder.id));
        // Null out source tags: Drive copies appProperties unless explicitly replaced/removed.
        const ap = {};
        Object.keys(src.f.appProperties || {}).forEach(k => { ap[k] = null; });
        Object.assign(ap, prbRowProps(row), { src: id, by: tagVal(user.email), at: new Date().toISOString() });
        const f = Drive.Files.copy({ name, parents: [folder.id], description: JSON.stringify(row), appProperties: ap }, id, { fields: FIELDS });
        return { id, row: prbToRow(f) };
      });
      out.done.push(result);
    } catch (e) { out.skipped.push({ id: id || '', why: (e.code || 'server') + ': ' + String(e.message || e) }); }
  });
  return out;
}
/** Only called under the script lock; never wraps at 9999 and never touches INV_SEQ. */
function nextPrbInvoiceNo(issue) {
  const props = PropertiesService.getScriptProperties(), year = issue.slice(0, 4);
  const seq = parseObj(props.getProperty('PRB_SEQ')), used = new Set();
  listAll("appProperties has { key='bimeyar' and value='prb' } and appProperties has { key='kind' and value='prbinv' }")
    .forEach(f => { used.add(tagOf(f, 'invNo')); used.add(parseObj(f.description).no); });
  let n = Number(seq[year]) || 0, no;
  do {
    n++;
    if (!Number.isSafeInteger(n) || n < 1) throw err('bad_request', 'Invalid PRB sequence');
    no = 'PRB-' + year + '-' + String(n).padStart(4, '0');
  } while (used.has(no));
  seq[year] = n;
  props.setProperty('PRB_SEQ', JSON.stringify(seq));
  return no;
}
function prbInvoice(req, user) {
  const inv = withLock(() => {
    const folder = prbAssertInsured(req.insuredId), cust = prbToInsured(folder);
    if (!Array.isArray(req.rowIds) || !req.rowIds.length || new Set(req.rowIds).size !== req.rowIds.length) throw err('bad_request', 'Select distinct PRB rows');
    const rows = req.rowIds.map(id => {
      const f = prbAssertFile(id, 'prb');
      if (f.parents[0] !== folder.id) throw err('bad_request', 'Rows must belong to this insured');
      return prbToRow(f);
    });
    const issue = date(ceDate(String(req.issue || ''))) || Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
    const due = date(ceDate(String(req.due || '')));
    if ((req.issue && !date(ceDate(String(req.issue)))) || (req.due && !due)) throw err('bad_request', 'Invalid invoice date');
    if (due && due < issue) throw err('bad_request', 'Due date is before the issue date');
    const t = prbTotals(rows), lines = rows.map((r, i) => Object.assign({ rowId: r.id, prbNo: r.prbNo, plate: r.plate, model: r.model }, t.lines[i]));
    delete t.lines;
    return { v: 1, no: nextPrbInvoiceNo(issue), insuredId: folder.id, issue, due,
      lang: ['th', 'en', 'both'].indexOf(req.lang) >= 0 ? req.lang : 'both', notes: clean(req.notes, 500),
      cust: { name: cust.name, taxId: cust.taxId, address: cust.address }, lines, t, status: 'unpaid', createdBy: user.email, createdAt: new Date().toISOString() };
  });
  const pdf = prbInvoicePdf(inv, req.dateFmt);
  // Rendering is outside the lock; recheck the destination before saving the snapshot.
  prbAssertInsured(inv.insuredId);
  const f = Drive.Files.create({ name: inv.no + '.pdf', mimeType: 'application/pdf', parents: [inv.insuredId], description: JSON.stringify(inv),
    appProperties: { bimeyar: 'prb', kind: 'prbinv', invNo: inv.no, status: inv.status, total: String(inv.t.total), by: tagVal(user.email), at: inv.createdAt },
  }, pdf, { fields: FIELDS });
  return prbToInvoice(f);
}

/** Separate PRB layout: no changes to RI invoice rendering or calculation. */
function prbInvoicePdf(inv, dateFmt) {
  const co = companyGet(), A = DocumentApp.Attribute, H = DocumentApp.HorizontalAlignment;
  const text = (th, en) => inv.lang === 'th' ? th : inv.lang === 'en' ? en : th + ' / ' + en;
  const doc = DocumentApp.create('tmp-' + inv.no), id = doc.getId();
  try {
    const body = doc.getBody();
    body.setPageWidth(595.28).setPageHeight(841.89).setMarginTop(36).setMarginBottom(36).setMarginLeft(32).setMarginRight(32);
    const base = {};
    base[A.FONT_FAMILY] = 'Sarabun'; base[A.FONT_SIZE] = 9; base[A.FOREGROUND_COLOR] = '#1f2430';
    body.setAttributes(base);
    const style = (p, bold, size) => {
      const a = Object.assign({}, base); a[A.BOLD] = !!bold; a[A.FONT_SIZE] = size || 9; a[A.SPACING_AFTER] = 3;
      p.setAttributes(a); return p;
    };
    const para = (s, bold, size) => style(body.appendParagraph(String(s || '')), bold, size);
    if (co.logoId) {
      try {
        const img = para('').appendInlineImage(DriveApp.getFileById(co.logoId).getBlob());
        const k = Math.min(1, 150 / img.getWidth(), 55 / img.getHeight());
        img.setWidth(Math.round(img.getWidth() * k)).setHeight(Math.round(img.getHeight() * k));
      } catch (e) { /* Company text remains visible when the optional logo is unavailable. */ }
    }
    para(co.name || 'RICH INSURANS', true, 16);
    if (co.nameEn) para(co.nameEn);
    if (co.address) para(co.address);
    if (co.phone || co.email) para([co.phone, co.email].filter(String).join(' · '));
    if (co.taxId) para(lbl('tax', inv.lang) + ': ' + co.taxId);
    para(text('ใบแจ้งหนี้ พ.ร.บ.', 'PRB INVOICE'), true, 18);
    para(lbl('unpaid', inv.lang), true);
    para(lbl('no', inv.lang) + ': ' + inv.no, true);
    para(lbl('issue', inv.lang) + ': ' + dmy(inv.issue, dateFmt) + (inv.due ? '   ' + lbl('due', inv.lang) + ': ' + dmy(inv.due, dateFmt) : ''));
    para(lbl('billTo', inv.lang) + ': ' + inv.cust.name, true, 11);
    if (inv.cust.taxId) para(lbl('tax', inv.lang) + ': ' + inv.cust.taxId);
    if (inv.cust.address) para(inv.cust.address);
    para('');
    const rows = [[text('เลข พ.ร.บ.', 'PRB no.'), lbl('plate', inv.lang), text('รุ่น', 'Model'),
      text('เบี้ยสุทธิ', 'Net premium'), text('อากร', 'Stamps'), text('ภาษี', 'VAT'), lbl('total', inv.lang)]];
    inv.lines.forEach(l => rows.push([l.prbNo, l.plate, l.model, baht(l.net), baht(l.stamps), baht(l.vat), baht(l.total)]));
    rows.push([lbl('total', inv.lang), '', '', baht(inv.t.net), baht(inv.t.stamps), baht(inv.t.vat), baht(inv.t.total)]);
    const table = body.appendTable(rows);
    table.setBorderColor('#e5e7eb').setBorderWidth(0.5);
    [85, 75, 75, 78, 65, 65, 88].forEach((w, i) => table.setColumnWidth(i, w));
    for (let r = 0; r < table.getNumRows(); r++) {
      for (let c = 0; c < rows[r].length; c++) {
        const cell = table.getCell(r, c), bold = r === 0 || r === rows.length - 1;
        cell.setPaddingTop(5).setPaddingBottom(5).setPaddingLeft(4).setPaddingRight(4);
        if (bold) cell.setBackgroundColor('#f3f5f9');
        style(cell.getChild(0).asParagraph(), bold, 8).setAlignment(c >= 3 ? H.RIGHT : H.LEFT);
      }
    }
    if (inv.notes) { para(lbl('notes', inv.lang), true); para(inv.notes); }
    if (co.bank) { para(lbl('pay', inv.lang), true); para(co.bank); }
    if (co.footer) para(co.footer);
    doc.saveAndClose();
    return DriveApp.getFileById(id).getAs('application/pdf').setName(inv.no + '.pdf');
  } finally {
    try { Drive.Files.update({ trashed: true }, id); } catch (e) { }
  }
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
    v: 1, customerId: s(x.customerId, 80), vehicleId: s(x.vehicleId, 80), issue, due, lang: ['th', 'en', 'both'].indexOf(x.lang) >= 0 ? x.lang : 'both',
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

/* ============================ AI (Claude first, Gemini as fallback) ============================ */

/** Gemini key (fallback). */
function aiKey() { return PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || ''; }
/** Claude key (v4.4). Only read here; never logged, never sent to the app. */
function claudeKey() { return PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY') || ''; }

/** The models to try, in order: Claude (if its key is set and it can read every file), then the Gemini models. */
function aiChain(files) {
  const chain = [];
  if (claudeKey() && files.every(f => CLAUDE_MIMES.test(String(f.mime || '')))) chain.push({ prov: 'claude', id: CLAUDE_MODEL });
  if (aiKey()) AI_MODELS.forEach(m => chain.push(Object.assign({ prov: 'gemini' }, m)));
  return chain;
}

/**
 * Claude gets NO strict json_schema: a schema with this many fields gives "compiled grammar is too large" (400).
 * The JSON shape is written in the prompt instead (AI_PROMPT_CLAUDE), and the reply is parsed (claudeParse) and
 * normalized (claudeNormalize) into exactly the structure Gemini returns. A reply that cannot be parsed counts as
 * a Claude failure, so Gemini is used.
 */

/** The first complete {...} block of a reply (```json fences and text around it are ignored). null = none. */
function claudeParse(text) {
  const s = String(text || '').replace(/```(?:json)?/gi, '');
  const a = s.indexOf('{');
  if (a < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = a; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try { const o = JSON.parse(s.slice(a, i + 1)); return o && typeof o === 'object' && !Array.isArray(o) ? o : null; } catch (e) { return null; }
    }
  }
  return null;
}

/** Claude's parsed reply -> { docType, docName, slot, fields: { key: { value: string|null, confidence: 0-1 } } } */
function claudeNormalize(o) {
  const DOC_TYPES = ['policy', 'prb', 'registration', 'id_card', 'receipt', 'other'];
  const docType = DOC_TYPES.indexOf(String(o.docType || '')) >= 0 ? String(o.docType) : 'other';
  const slot = VFILE_SLOTS.indexOf(String(o.slot == null ? '' : o.slot)) >= 0 ? String(o.slot) : 'unknown';
  const src = o.fields && typeof o.fields === 'object' ? o.fields : {};
  const fields = {};
  Object.keys(AI_FIELDS).forEach(k => {
    const x = src[k];
    let v = x && typeof x === 'object' ? x.value : x;   // also accepts a bare value instead of { value, confidence }
    v = v == null || typeof v === 'object' ? '' : String(v).trim();
    let c = x && typeof x === 'object' ? Number(x.confidence) : 0;
    c = isFinite(c) ? Math.min(1, Math.max(0, c)) : 0;
    fields[k] = v ? { value: v, confidence: c } : { value: null, confidence: 0 };
  });
  return { docType: docType, docName: typeof o.docName === 'string' ? o.docName : '', slot: slot, fields: fields };
}

/** Request body for Claude: the files as document / image blocks, then the prompt. Effort low, no output format. */
function claudeBody(content) {
  return JSON.stringify({
    model: CLAUDE_MODEL,
    max_tokens: CLAUDE_MAX_TOKENS,
    output_config: { effort: CLAUDE_EFFORT },
    messages: [{ role: 'user', content: content }],
  });
}

const AI_FIELDS = {
  nameTh: 'Customer full name in Thai script, exactly as printed',
  nameEn: 'Customer full name in Latin letters, exactly as printed',
  phone: 'Customer phone number, digits only',
  idNo: 'Thai national ID (13 digits) or passport number',
  address: 'Customer address',
  dob: 'Date of birth, YYYY-MM-DD with the year exactly as printed (do not convert Buddhist years)',
  brand: 'Vehicle brand, e.g. Toyota', model: 'Vehicle model, e.g. Yaris', year: 'Vehicle model/registration year as printed',
  color: 'Vehicle colour', plate: 'Licence plate number without the province, written NN-NNNN when it is 2 + 4 digits', province: 'Province of the licence plate',
  vin: 'Chassis number / VIN (line 1 of เลขตัวถัง / Chassis No., never the engine number on line 2)', engineNo: 'Engine number (เลขเครื่องยนต์, or line 2 of the Chassis No. cell when two lines are printed)',
  insurer: 'Insurance company name exactly as printed, in Thai when printed in Thai (with บริษัท … จำกัด (มหาชน))', policyNo: 'Policy number', policyType: 'Policy class as printed (ชั้น 1, 2, 2+, 3, 3+), "พ.ร.บ." for compulsory insurance, or null if no class is printed',
  coverage: 'Sum insured / coverage amount, digits only', premium: 'Total premium, digits only, with decimals if printed',
  policyStart: 'Coverage start date, YYYY-MM-DD with the year exactly as printed', policyExpiry: 'Coverage end date, YYYY-MM-DD with the year exactly as printed',
  contractDate: 'Contract date of the insurance (วันทำสัญญาประกันภัย / วันที่ทำสัญญา, not coverage start), YYYY-MM-DD with the year exactly as printed',
  receiptAmount: 'For a payment receipt or slip: amount paid, digits only', receiptDate: 'For a payment receipt: payment date, YYYY-MM-DD with the year exactly as printed',
  payer: 'For a payment receipt: name of the payer',
  insuredName: 'Name of the insured person or company (ผู้เอาประกันภัย / ชื่อ : on พ.ร.บ.) or the vehicle owner, exactly as printed',   // v4
  bodyType: 'Vehicle body type (แบบตัวถัง) copied exactly as printed on THIS document; never a synonym or a more general word',                                    // v4
  carValue: 'Vehicle value (ราคารถยนต์ / ทุนประกันภัยรถยนต์), digits only',
  odCover: 'Own damage coverage (ความเสียหายต่อตัวรถยนต์): the amount, or "ไม่คุ้มครอง" when printed as not covered',
  tfCover: 'Theft / fire coverage (รถยนต์สูญหาย ไฟไหม้): the amount, or "ไม่คุ้มครอง" when printed as not covered',
  companyCode: 'For พ.ร.บ.: insurer short code printed with the number (3 capital letters)',
  prbNo: 'For พ.ร.บ.: the digits of the LAST segment of the policy number of THIS document (after the last /)',
  barcode: 'For พ.ร.บ.: the long number printed under/next to the barcode at the top right of THIS document, digits only',
  receiptNo: 'For พ.ร.บ.: เลขที่ of the receipt',
  vehicleCode: 'For พ.ร.บ.: รหัสรถ as printed',
  cc: 'For พ.ร.บ.: engine size in C.C. only (the FIRST number of the cell "C.C./No. of Seats/Weight", e.g. A/B/C -> A)',
  seats: 'For พ.ร.บ.: number of seats only (the SECOND number of that cell)',
  weight: 'For พ.ร.บ.: total weight only (the THIRD number of that cell, tons)',
  taxId: 'For พ.ร.บ.: insured tax ID, digits only',
  periodTime: 'For พ.ร.บ.: start/end time of the coverage period as printed (HH.MM)',
  issueDate: 'For พ.ร.บ.: วันที่ออกกรมธรรม์/วันทำ, YYYY-MM-DD with the year as printed',
  netPremium: 'For พ.ร.บ.: เบี้ยประกันภัยสุทธิ, digits only with decimals',
  discount: 'For พ.ร.บ.: ส่วนลด, digits only with decimals',
  stamps: 'For พ.ร.บ.: อากรแสตมป์, digits only with decimals',
  vat: 'For พ.ร.บ.: ภาษีมูลค่าเพิ่ม, digits only with decimals',
  total: 'For พ.ร.บ.: เบี้ยประกันภัยรวม, digits only with decimals',
  brokerName: 'For พ.ร.บ.: broker or agent name as printed',
  brokerLicense: 'For พ.ร.บ.: broker or agent licence number as printed',
};

/** v4: the folder of the vehicle file a document belongs to (see VSLOTS). */
const AI_SLOT_HELP = 'Folder for this document: 1 = voluntary car insurance policy or schedule (กรมธรรม์ประกันภัยรถยนต์, ชั้น 1/2/3); ' +
  '2 = goods-in-transit / cargo / carrier liability policy (กรมธรรม์ขนส่งสินค้า, ประกันภัยสินค้า); 3 = compulsory motor insurance (พ.ร.บ., ประกันภัยรถยนต์ภาคบังคับ); ' +
  '4 = bill, invoice or quotation (ใบวางบิล, ใบแจ้งหนี้, ใบเสนอราคา); 5.1 = vehicle registration book or its copy (สำเนาทะเบียนรถ, เล่มทะเบียน); ' +
  '5.2 = an old / previous policy (กรมธรรม์เดิม); 5.3 = photo of the car or of damage; 5.4 = bank transfer slip or payment receipt (หลักฐานการโอนเงิน, สลิป); ' +
  '5.5 = ID card, driving licence, passport, company certificate (หนังสือรับรองบริษัท) or letter of appointment / power of attorney (หนังสือแต่งตั้ง, หนังสือมอบอำนาจ); ' +
  'unknown = you cannot tell.';

/** Thai document names for file names (v3.2); the same names as DOC_NAMES in js/naming.js. */
const AI_DOC_NAMES = ['กรมธรรม์', 'บัตรประชาชน', 'ทะเบียนรถ', 'ใบขับขี่', 'หนังสือเดินทาง', 'หนังสือรับรองบริษัท', 'ภาพถ่ายรถ', 'สลิปโอนเงิน', 'ใบแจ้งหนี้', 'ใบเสร็จ'];

function aiSchema() {
  const field = { type: 'object', properties: { value: { type: ['string', 'null'] }, confidence: { type: 'number', minimum: 0, maximum: 1 } }, required: ['value', 'confidence'] };
  const props = {};
  Object.keys(AI_FIELDS).forEach(k => { props[k] = Object.assign({ description: AI_FIELDS[k] }, field); });
  return {
    type: 'object',
    properties: {
      docType: { type: 'string', enum: ['policy', 'prb', 'registration', 'id_card', 'receipt', 'other'], description: 'policy = insurance policy or schedule; prb = Thai compulsory motor insurance (พ.ร.บ.), recognised when the title is "ตารางกรมธรรม์ประกันภัยคุ้มครองผู้ประสบภัยจากรถ" (THE SCHEDULE / RECEIPT / TAX INVOICE); registration = vehicle registration book; id_card = ID card, passport or driving licence; receipt = payment receipt, transfer slip or invoice' },
      docName: { type: 'string', description: 'Short Thai name of this document. Use one of: ' + AI_DOC_NAMES.join(', ') + '. If none fits, a short Thai name of the document as it calls itself.' },
      slot: { type: 'string', enum: VFILE_SLOTS.concat(['unknown']), description: AI_SLOT_HELP },
      fields: { type: 'object', properties: props, required: Object.keys(AI_FIELDS) },
    },
    required: ['docType', 'docName', 'slot', 'fields'],
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
  '6. docName: the Thai name of what this document is (for example กรมธรรม์ for any insurance policy or schedule, ภาพถ่ายรถ for a photo of a car, สลิปโอนเงิน for a bank transfer slip).',
  '7. slot: the folder of this document (see its description). A พ.ร.บ. (compulsory insurance) is 3, not 1. Use unknown when you cannot tell.',
  '8. plate and vin: read them from the document itself (a photo may show the plate on the car). Never guess them.',
  '9. policyType: if a class is printed (ชั้น 1, 2, 2+, 3, 3+) return it exactly; if none is printed return null and fill odCover and tfCover from the coverage table (never guess the class). A พ.ร.บ. has no class: policyType = "พ.ร.บ.".',
  '10. Always fill bodyType (แบบตัวถัง) exactly as printed (never a synonym) and carValue when printed. insurer: the name as printed, in Thai when printed in Thai.',
  '11. The "เลขตัวถัง / Chassis No." cell often has TWO lines: line 1 = chassis/VIN, line 2 = ENGINE number. vin = line 1 only, engineNo = line 2. Never return an engine number as vin.',
  '12. plate: registration number only, written NN-NNNN when it is 2 + 4 digits; the province (or its short form) goes in province.',
  '13. On a พ.ร.บ. the insured (insuredName and nameTh) is exactly the text after "ชื่อ :" on THIS document. Never return a name that is not printed on THIS document; never the broker, agent or insurer.',
  '14. contractDate = วันทำสัญญาประกันภัย (not the coverage start). policyNo = the full number as printed. Every number (policyNo, prbNo, receiptNo, barcode) must be read from THIS document only: documents of one customer look alike and differ in single digits, so read each digit; never reuse a number from another document or from these rules.',
  '15. For a พ.ร.บ.: docType prb, slot 3, fill the พ.ร.บ. keys (companyCode … brokerLicense) and premium = total. The cell "ขนาดเครื่องยนต์/จำนวนที่นั่ง/น้ำหนักรวม (C.C./No. of Seats/Weight)" holds 3 numbers A/B/C: cc = A, seats = B, weight = C; never the whole text in one field.',
].join('\n');
/** Claude has no response schema (see claudeParse), so the JSON shape is in the prompt. Built from AI_FIELDS. */
const AI_PROMPT_CLAUDE = [
  AI_PROMPT,
  '',
  'ANSWER FORMAT: Reply with ONLY one JSON object, no markdown, no code fences, no text before or after it. Shape:',
  '{"docType": "...", "docName": "...", "slot": "...", "fields": {"<key>": {"value": "..." or null, "confidence": 0.0-1.0}, ...}}',
  '- docType: one of policy, prb, registration, id_card, receipt, other (policy = insurance policy or schedule; ' +
  'prb = Thai compulsory motor insurance (พ.ร.บ.), recognised when the title is "ตารางกรมธรรม์ประกันภัยคุ้มครองผู้ประสบภัยจากรถ" (THE SCHEDULE / RECEIPT / TAX INVOICE); ' +
  'registration = vehicle registration book; id_card = ID card, passport or driving licence; receipt = payment receipt, transfer slip or invoice).',
  '- docName: short Thai name of this document. Use one of: ' + AI_DOC_NAMES.join(', ') + '. If none fits, a short Thai name of the document as it calls itself.',
  '- slot: one of ' + VFILE_SLOTS.concat(['unknown']).join(', ') + '. ' + AI_SLOT_HELP,
  '- fields: include EVERY key below; value null when not clearly printed:',
].concat(Object.keys(AI_FIELDS).map(k => '  ' + k + ': ' + AI_FIELDS[k])).join('\n');

function aiExtract(req) {
  const files = (req.files || []).slice(0, 8);
  if (!files.length) throw err('bad_request', 'No file');
  if (!claudeKey() && !aiKey()) throw err('ai_nokey', 'CLAUDE_API_KEY / GEMINI_API_KEY is not set in Script Properties');
  let bytes = 0;
  const parts = files.map(f => {
    const mime = String(f.mime || '');
    if (!/^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/.test(mime)) throw err('bad_request', 'Only photos and PDF files can be read');
    bytes += String(f.data || '').length * 0.75;
    return { inline_data: { mime_type: mime, data: String(f.data || '') } };
  });
  if (bytes > AI_MAX_BYTES) throw err('too_big', 'Files are too large for reading');
  parts.push({ text: AI_PROMPT });
  const chain = aiChain(files);
  if (!chain.length) throw err('bad_request', 'This photo type cannot be read. Use JPEG or PNG.');   // only Claude is set up and a file is HEIC
  const keys = { claude: claudeKey(), gemini: aiKey() };
  const payloadFor = m => m.prov === 'claude' ? claudeBody(
    files.map(f => f.mime === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: String(f.data || '') } }
      : { type: 'image', source: { type: 'base64', media_type: String(f.mime), data: String(f.data || '') } })
      .concat([{ type: 'text', text: AI_PROMPT_CLAUDE }])
  ) : JSON.stringify({
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', responseJsonSchema: aiSchema(), thinkingConfig: { thinkingLevel: m.think } },
  });

  const t0 = Date.now(), attempts = [];
  const cache = CacheService.getScriptCache(), ck = aiCacheKey(files);
  let last = null;   // last error: { busy, code, msg }
  let mine = false;  // this request runs the Gemini calls (and must clear the "running" mark)
  try {
    // 1) same files read in the last 10 minutes (for example the app gave up waiting): answer at once
    const hit = aiCached(cache, ck);
    if (hit) { attempts.push({ prov: hit.prov || 'gemini', model: hit.model, status: 'cache', ms: 0 }); return Object.assign(hit, { cached: true }); }
    // 2) the same files are being read right now by an earlier request: wait for that result instead of asking Google again
    if (cache.get(ck + ':run')) {
      while (Date.now() - t0 < AI_JOIN_MS && cache.get(ck + ':run')) {
        Utilities.sleep(3000);
        const r = aiCached(cache, ck);
        if (r) { attempts.push({ prov: r.prov || 'gemini', model: r.model, status: 'joined', ms: Date.now() - t0 }); return Object.assign(r, { cached: true }); }
      }
      const r = aiCached(cache, ck);
      if (r) { attempts.push({ prov: r.prov || 'gemini', model: r.model, status: 'joined', ms: Date.now() - t0 }); return Object.assign(r, { cached: true }); }
      if (Date.now() - t0 >= AI_JOIN_MS - 5000) throw err('ai_busy', 'Google AI is busy right now');
    }
    // 3) ask Claude, then Gemini (aiChain); the clock for new attempts starts now
    cache.put(ck + ':run', '1', 360);
    mine = true;
    const t1 = Date.now();
    const left = () => AI_BUDGET_MS - (Date.now() - t1);
    let fatal = null;   // a bad key of one provider: remembered, the next provider is still tried
    let busy = false;   // any attempt was busy (429/5xx/timeout)
    for (const m of chain) {
      if (fatal && fatal.prov === m.prov) continue;   // same provider, same bad key
      const payload = payloadFor(m), key = keys[m.prov];
      for (let i = 0; i < AI_TRIES_PER_MODEL; i++) {
        if (i > 0) {
          const wait = Math.round(AI_BACKOFF_MS[Math.min(i - 1, AI_BACKOFF_MS.length - 1)] * (0.7 + Math.random() * 0.6));   // jitter
          if (left() - wait < AI_MIN_LEFT_MS) break;
          Utilities.sleep(wait);
        }
        if (left() < AI_MIN_LEFT_MS) break;
        const r = aiAttempt(m, payload, key);
        attempts.push({ prov: m.prov, model: m.id, status: r.status, ms: r.ms, tokens: r.tokens || 0 });
        if (r.out) {
          const slot = VFILE_SLOTS.indexOf(String(r.out.slot || '')) >= 0 ? String(r.out.slot) : '';
          const res = { docType: r.out.docType || 'other', docName: String(r.out.docName || '').slice(0, 60), slot: slot, fields: r.out.fields || {}, prov: m.prov, model: m.id, tries: attempts.length };
          try { cache.put(ck + ':res', JSON.stringify(res), AI_CACHE_S); } catch (e) { }   // kept even if the app stopped waiting
          return res;
        }
        last = r;
        if (r.busy) busy = true;
        if (r.fatal) { fatal = { prov: m.prov, code: r.fatal, msg: r.msg }; break; }   // bad key: skip this provider's other models
        if (!r.retry) break;                      // this model refused the request: try the next model
        if (r.ms > AI_SLOW_MS) break;             // overloaded and slow: switch model instead of waiting again
      }
      if (left() < AI_MIN_LEFT_MS) break;
    }
    if (busy) throw err('ai_busy', 'The AI is busy right now');
    if (fatal && last && last.fatal) throw err(fatal.code, fatal.msg);   // every provider tried had a bad key
    throw err('ai_error', (last && last.msg) || 'The AI could not read this document');
  } finally {
    if (mine) try { cache.remove(ck + ':run'); } catch (e) { }
    const base = { at: new Date().toISOString(), files: files.length, kb: Math.round(bytes / 1024) };
    aiLog(attempts.map((a, i) => Object.assign({}, base, a, { try: i + 1, of: attempts.length, totalMs: Date.now() - t0 })));
  }
}

/** Cache key for a set of files: SHA-256 of their types and contents (the hash is not logged). */
function aiCacheKey(files) {
  const d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, files.map(f => f.mime + ':' + f.data).join('|'));
  return 'ai5_' + Utilities.base64EncodeWebSafe(d).replace(/=+$/, '');   // ai5: v4.5.1 prompt (no example numbers); never mixed with older cached answers
}
function aiCached(cache, ck) {
  try { const v = cache.get(ck + ':res'); return v ? JSON.parse(v) : null; } catch (e) { return null; }
}

/**
 * One request to one model. Returns { out } on success, otherwise
 * { status, retry, busy, fatal?, msg }. retry/busy = 429, 500, 503, 504, timeout or network error.
 */
function aiAttempt(m, payload, key) {
  return m.prov === 'claude' ? claudeAttempt(m, payload, key) : geminiAttempt(m, payload, key);
}

/** One request to Claude (Messages API). Same return shape as geminiAttempt. */
function claudeAttempt(m, payload, key) {
  const t = Date.now();
  let res;
  try {
    res = UrlFetchApp.fetch(CLAUDE_URL, {
      method: 'post', contentType: 'application/json', payload: payload, muteHttpExceptions: true,
      headers: { 'x-api-key': key, 'anthropic-version': CLAUDE_API_VERSION },
    });
  } catch (e) {
    return { status: /time/i.test(String(e)) ? 'timeout' : 'neterr', ms: Date.now() - t, retry: true, busy: true, msg: 'AI service did not answer' };
  }
  const code = res.getResponseCode(), ms = Date.now() - t;
  if (code === 200) {
    let j, out;
    try { j = JSON.parse(res.getContentText()); } catch (e) { return { status: 'badjson', ms: ms, retry: false, msg: 'The AI answer was not valid' }; }
    const u = j.usage || {}, tokens = (u.input_tokens || 0) + (u.output_tokens || 0);
    if (j.stop_reason === 'refusal') return { status: 'refusal', ms: ms, tokens: tokens, retry: false, msg: 'The AI could not read this document' };
    if (j.stop_reason === 'max_tokens') return { status: 'maxtokens', ms: ms, tokens: tokens, retry: false, msg: 'The AI could not read this document' };
    const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text || '').join('');
    if (!text) return { status: 'empty', ms: ms, tokens: tokens, retry: false, msg: 'The AI could not read this document' };
    out = claudeParse(text);
    if (!out) return { status: 'badjson', ms: ms, tokens: tokens, retry: false, msg: 'The AI answer was not valid' };   // -> Gemini
    return { status: 'ok', ms: ms, tokens: tokens, out: claudeNormalize(out) };
  }
  const status = 'http' + code;
  // 529 = Anthropic overloaded
  if (code === 429 || code === 500 || code === 502 || code === 503 || code === 504 || code === 529) return { status: status, ms: ms, retry: true, busy: true, msg: 'AI service busy (' + code + ')' };
  // detail = Anthropic's error text, shown only by aiModelsCheck in the editor (never put in AI_LOG)
  const detail = String(res.getContentText()).slice(0, 300);
  if (code === 401 || code === 403) return { status: status, ms: ms, fatal: 'ai_nokey', msg: 'The Claude API key is not valid', detail: detail };
  return { status: status, ms: ms, retry: false, msg: 'AI request rejected (' + code + ')', detail: detail };   // e.g. 400 no credit / bad request -> Gemini
}

/** One request to one Gemini model. */
function geminiAttempt(m, payload, key) {
  const t = Date.now();
  let res;
  try {
    res = UrlFetchApp.fetch(GEMINI_URL + m.id + ':generateContent', {
      method: 'post', contentType: 'application/json', payload: payload, muteHttpExceptions: true,
      headers: { 'x-goog-api-key': key },
    });
  } catch (e) {   // timeout or network problem inside Google
    return { status: /time/i.test(String(e)) ? 'timeout' : 'neterr', ms: Date.now() - t, retry: true, busy: true, msg: 'AI service did not answer' };
  }
  const code = res.getResponseCode(), ms = Date.now() - t;
  if (code === 200) {
    let j, out, tokens = 0;
    try { j = JSON.parse(res.getContentText()); } catch (e) { return { status: 'badjson', ms: ms, retry: false, msg: 'The AI answer was not valid' }; }
    tokens = (j.usageMetadata && j.usageMetadata.totalTokenCount) || 0;
    const c = (j.candidates || [])[0];
    const text = c && c.content && (c.content.parts || []).map(p => p.text || '').join('');
    if (!text) return { status: 'empty', ms: ms, tokens: tokens, retry: false, msg: 'The AI could not read this document' };
    try { out = JSON.parse(text); } catch (e) { return { status: 'badjson', ms: ms, tokens: tokens, retry: false, msg: 'The AI answer was not valid' }; }
    return { status: 'ok', ms: ms, tokens: tokens, out: out };
  }
  const status = 'http' + code;
  if (code === 429 || code === 500 || code === 503 || code === 504) return { status: status, ms: ms, retry: true, busy: true, msg: 'AI service busy (' + code + ')' };
  const text = String(res.getContentText()).slice(0, 300);
  if ((code === 400 || code === 401 || code === 403) && /API key/i.test(text)) return { status: status, ms: ms, fatal: 'ai_nokey', msg: 'The Gemini API key is not valid' };
  return { status: status, ms: ms, retry: false, msg: 'AI request rejected (' + code + ')' };   // e.g. 404: model not available -> next model
}

/** Usage log without any customer data. Script properties hold max 9 KB, so the oldest entries are dropped to fit. */
function aiLog(entries) {
  entries = [].concat(entries || []);
  if (!entries.length) return;
  try {
    for (const e of entries) console.log('ai ' + JSON.stringify(e));
    withLock(() => {
      const p = PropertiesService.getScriptProperties();
      let log = [];
      try { log = JSON.parse(p.getProperty('AI_LOG') || '[]'); } catch (e) { }
      log = log.concat(entries).slice(-200);
      let s = JSON.stringify(log);
      while (s.length > 8500 && log.length > 1) { log = log.slice(Math.ceil(log.length / 10)); s = JSON.stringify(log); }
      p.setProperty('AI_LOG', s);
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
  // v4: one row per vehicle (its latest month), plus the old single plate of customers that have no vehicle with that plate yet
  const ids = {};
  customers.forEach(c => { ids[c.id] = c; });
  const latest = {};
  vehicleTree(ids).vehicles.forEach(v => { const k = v.customerId + '|' + plateKey(v.plate); if (!latest[k] || v.ym > latest[k].ym) latest[k] = v; });
  const items = Object.keys(latest).map(k => latest[k]).filter(v => v.policyExpiry).map(v => ({ c: { name: ids[v.customerId].name, phone: ids[v.customerId].phone, plate: v.plate, policyExpiry: v.policyExpiry } }));
  customers.forEach(c => { if (c.policyExpiry && !latest[c.id + '|' + plateKey(c.plate)]) items.push({ c }); });
  const rows = items.map(x => ({ c: x.c, d: day(x.c.policyExpiry) })).filter(x => x.d <= 30 && x.d >= -7).sort((a, b) => a.d - b.d);
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
  console.log('Claude key set: ' + (claudeKey() ? 'yes (model ' + CLAUDE_MODEL + ')' : 'NO - add CLAUDE_API_KEY in Project Settings > Script properties'));
  console.log('Gemini key set (fallback): ' + (aiKey() ? 'yes' : 'NO - add GEMINI_API_KEY in Project Settings > Script properties'));
  // touch the Docs service so the editor asks for the new permission
  try { DocumentApp.getActiveDocument(); } catch (e) { }
}

/**
 * Run from the editor: sends a one-line test sentence (no customer data) to every model in AI_MODELS
 * and prints status and time for each. Shows which models work and which are busy right now.
 */
function aiModelsCheck() {
  const ck = claudeKey();
  if (!ck) console.log('CLAUDE_API_KEY is not set (Gemini is used)');
  else {
    // the same request, prompt, parsing and normalizing as aiExtract, with no document attached (no customer data)
    const r = claudeAttempt({ prov: 'claude', id: CLAUDE_MODEL }, claudeBody([
      { type: 'text', text: 'TEST ONLY: no document is attached. Follow the answer format, with docType other, slot unknown and every value null.\n\n' + AI_PROMPT_CLAUDE },
    ]), ck);
    console.log(CLAUDE_MODEL + ' (Claude, effort ' + CLAUDE_EFFORT + '): ' + r.status + ' in ' + r.ms + ' ms' +
      (r.out ? ' | parsed: docType ' + r.out.docType + ', slot ' + r.out.slot + ', ' + Object.keys(r.out.fields).length + ' fields' : '') +
      (r.detail ? ' | ' + r.detail : ''));
  }
  const key = aiKey();
  if (!key) return console.log('GEMINI_API_KEY is not set');
  for (const m of AI_MODELS) {
    const payload = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'Reply with the JSON {"ok": true}.' }] }],
      generationConfig: { responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: m.think } },
    });
    const r = aiAttempt(m, payload, key);
    console.log(m.id + ' (thinking ' + m.think + '): ' + r.status + ' in ' + r.ms + ' ms');
  }
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
