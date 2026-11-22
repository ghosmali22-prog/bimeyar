// PRB contract against synthetic Drive/Docs only: no network or customer data.
// Run: node tests/prb.test.mjs
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const gs = readFileSync(new URL('../backend/Code.gs', import.meta.url), 'utf8');
const FOLDER = 'application/vnd.google-apps.folder';
const clone = x => JSON.parse(JSON.stringify(x));
let checks = 0;
const eq = (a, b, message) => { assert.deepEqual(a, b, message); checks++; };
const rejects = (fn, code) => { assert.throws(fn, e => e.code === code); checks++; };

function fixture() {
  const files = {}, perms = {}, props = {}, writes = [], reads = [], docs = [];
  let seq = 0, locked = false, failPdf = false;
  const saveProps = (f, ap) => {
    f.appProperties ||= {};
    for (const [k, v] of Object.entries(ap || {})) {
      if (v === null) delete f.appProperties[k];
      else {
        assert.equal(typeof v, 'string');
        assert.ok(Buffer.byteLength(k + v, 'utf8') <= 124, 'Drive tag byte limit');
        f.appProperties[k] = v;
      }
    }
  };
  const match = (f, q) => {
    if (q.includes('trashed=false') && f.trashed) return false;
    for (const m of q.matchAll(/'([^']+)' in parents/g)) if (!(f.parents || []).includes(m[1])) return false;
    for (const m of q.matchAll(/appProperties has \{ key='(\w+)' and value='([^']*)' \}/g)) if (f.appProperties?.[m[1]] !== m[2]) return false;
    const m = q.match(/mimeType(!?=)'([^']+)'/);
    return !m || ((f.mimeType === m[2]) === (m[1] === '='));
  };
  const mutation = (op, id) => writes.push({ op, id, locked });
  const blob = (bytes, mime = 'application/pdf', name = '') => ({ getBytes: () => bytes, getContentType: () => mime,
    setName(n) { name = n; return this; }, getName: () => name });
  const Drive = { Files: {
    get(id) { if (!files[id]) throw Error('404'); return clone(files[id]); },
    list(o) {
      reads.push(o.q);
      // Small pages expose missing pagination without large test fixtures.
      const found = Object.values(files).filter(f => match(f, o.q)), start = +(o.pageToken || 0), end = start + 2;
      return { files: found.slice(start, end).map(clone), nextPageToken: end < found.length ? String(end) : undefined };
    },
    create(res, content) {
      const id = 'synthetic_' + (++seq);
      files[id] = { createdTime: '2026-11-22T00:00:00Z', size: String(content?.getBytes().length || 0),
        mimeType: 'application/pdf', ...clone(res), id, appProperties: {} };
      saveProps(files[id], res.appProperties); mutation('create', id); return clone(files[id]);
    },
    update(res, id) {
      assert.ok(files[id], 'update target exists');
      const { appProperties, ...rest } = res;
      Object.assign(files[id], clone(rest)); saveProps(files[id], appProperties);
      mutation('update', id); return clone(files[id]);
    },
    copy(res, id) {
      const src = clone(files[id]); delete src.id;
      const ap = { ...src.appProperties, ...res.appProperties };
      const f = Drive.Files.create({ ...src, ...res, appProperties: ap }, blob([1, 2, 3]));
      mutation('copy', id); return f;
    },
  }, Permissions: {
    list(id, o = {}) {
      const all = perms[id] || [], start = +(o.pageToken || 0), end = start + 2;
      return { permissions: all.slice(start, end).map(clone), nextPageToken: end < all.length ? String(end) : undefined };
    },
    create(res, id) { (perms[id] ||= []).push({ ...res, id: 'permission_' + (++seq) }); mutation('permission-create', id); },
    update(res, id, pid) { Object.assign(perms[id].find(p => p.id === pid), res); mutation('permission-update', id); },
    remove(id, pid) { perms[id] = perms[id].filter(p => p.id !== pid); mutation('permission-remove', id); },
  } };
  const PropertiesService = { getScriptProperties: () => ({ getProperty: k => props[k] ?? null,
    setProperty(k, v) { props[k] = v; mutation('property', k); } }) };
  const LockService = { getScriptLock: () => ({ waitLock() { assert.equal(locked, false, 'no nested lock'); locked = true; },
    releaseLock() { assert.equal(locked, true); locked = false; } }) };
  const Utilities = { DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (_, s) => [...createHash('sha256').update(s, 'utf8').digest()].map(b => b > 127 ? b - 256 : b),
    base64Decode: s => [...Buffer.from(s, 'base64')], base64Encode: b => Buffer.from(b).toString('base64'),
    newBlob: blob, formatDate: () => '2026-11-22' };
  const DriveApp = { getFileById: id => ({ getBlob() { reads.push('bytes:' + id); return blob([1, 2, 3]); },
    getAs() { if (failPdf) throw Error('PDF conversion failed'); return blob([37, 80, 68, 70]); } }) };
  const paragraph = (text, record) => ({
    setAttributes(a) { record.styles.push(a); return this; }, setAlignment() { return this; }, asParagraph() { return this; },
    appendInlineImage() { return { getWidth: () => 50, getHeight: () => 20, setWidth() { return this; }, setHeight() { return this; } }; },
  });
  const DocumentApp = { Attribute: { FONT_FAMILY: 'font', FONT_SIZE: 'size', FOREGROUND_COLOR: 'color', BOLD: 'bold', SPACING_AFTER: 'after' },
    HorizontalAlignment: { LEFT: 'left', RIGHT: 'right' },
    create(name) {
      const f = Drive.Files.create({ name, mimeType: 'application/vnd.google-apps.document' });
      const record = { id: f.id, paragraphs: [], tables: [], styles: [], closed: false }; docs.push(record);
      const body = {
        setPageWidth() { return this; }, setPageHeight() { return this; }, setMarginTop() { return this; }, setMarginBottom() { return this; },
        setMarginLeft() { return this; }, setMarginRight() { return this; }, setAttributes(a) { record.styles.push(a); return this; },
        appendParagraph(t) { record.paragraphs.push(t); return paragraph(t, record); },
        appendTable(rows) {
          record.tables.push(clone(rows));
          return { setBorderColor() { return this; }, setBorderWidth() { return this; }, setColumnWidth() { return this; },
            getNumRows: () => rows.length, getCell: (r, c) => ({ setPaddingTop() { return this; }, setPaddingBottom() { return this; },
              setPaddingLeft() { return this; }, setPaddingRight() { return this; }, setBackgroundColor() { return this; },
              getChild: () => paragraph(rows[r][c], record) }) };
        },
      };
      return { getId: () => f.id, getBody: () => body, saveAndClose() { record.closed = true; } };
    },
  };
  const ContentService = { MimeType: { JSON: 'json' }, createTextOutput: s => ({ setMimeType: () => s }) };
  // Authentication is stubbed at the boundary; the real doPost ACL/router checks still run.
  const B = new Function('Drive', 'PropertiesService', 'LockService', 'Utilities', 'DriveApp', 'DocumentApp', 'ContentService', 'console', `${gs}
    verify = token => ({ email: token, name: 'Synthetic test' });
    ownerEmail = () => 'owner@example.invalid';
    return { ACTIONS, doPost, prbTotals, prbFields, nextPrbInvoiceNo, withLock, assertFile, assertCustomer };
  `)(Drive, PropertiesService, LockService, Utilities, DriveApp, DocumentApp, ContentService, { error() {} });
  const user = { email: 'owner@example.invalid' };
  const run = (action, req = {}) => B.ACTIONS[action].run(req, user, 'admin');
  const folder = (name, parent, tags = {}) => Drive.Files.create({ name, mimeType: FOLDER, parents: parent ? [parent] : [], appProperties: tags }).id;
  const root = folder('Synthetic root', '', { bimeyar: 'root' }); props.ROOT_ID = root;
  const upload = (row = {}, insured = { name: 'บริษัท ทดสอบ จำกัด' }, meta = {}) => run('prbUpload', {
    insured, row, meta: { name: 'synthetic.pdf', mime: 'application/pdf', ...meta }, data: 'AQID',
  });
  return { B, run, upload, folder, root, Drive, files, props, perms, writes, reads, docs, setPdfFailure: v => { failPdf = v; } };
}

const x = fixture(), { B, run, upload, folder, root, Drive, files, props, perms, writes, reads, docs } = x;
const beforeEmpty = clone({ files, props, writes });
eq(run('prbList'), { root: '', insured: [], rows: [], invoices: [] }, 'empty list');
eq(run('prbImportPlan'), [], 'empty import plan');
eq({ files, props, writes }, beforeEmpty, 'read-only paths create nothing');
const untagged = folder('พ.ร.บ.', root), other = folder('พ.ร.บ.', root, { bimeyar: 'item' });
eq(run('prbList').root, '', 'list does not adopt');
const first = upload({ prbNo: '01-23', barcode: '004 56', start: '2567-02-29', end: '2570-11-22', netPremium: '600.005', stamps: 3, vat: 42.21,
  plate: 'ก'.repeat(40), note: 'synthetic', ignored: 'unsafe' }, { name: ' บริษัท  ทดสอบ / จำกัด ', taxId: 'TEST', address: 'Synthetic address' });
eq(props.PRB_ROOT_ID, untagged, 'adopts exact untagged folder');
eq(files[other].appProperties.bimeyar, 'item', 'existing customer with same name untouched');
eq(first.insured.name, 'บริษัท ทดสอบ จำกัด', 'full company name preserved');
eq(files[first.insured.id].appProperties.ik, createHash('sha256').update(first.insured.name).digest('hex').slice(0, 32), 'UTF-8 name hash');
eq([first.row.prbNo, first.row.barcode, first.row.start, first.row.end, first.row.netPremium], ['0123', '00456', '2024-02-29', '2027-11-22', 600.01], 'field normalization');
eq(first.row.plate.length, 40, 'full Thai plate in JSON despite tag byte limit');
eq(first.row.total, '', 'missing total remains missing');
eq(first.row.ignored, undefined, 'unknown request fields ignored');
eq(JSON.parse(files[first.row.id].description).note, 'synthetic', 'description remains JSON');
eq(writes.filter(w => w.id === first.row.id).every(w => w.locked), true, 'row saved under lock');
const state = clone({ files, props });
rejects(() => upload({ prbNo: '0123' }, { name: 'New synthetic insured' }), 'duplicate');
rejects(() => upload({ barcode: '00456' }), 'duplicate');
eq({ files, props }, state, 'duplicate creates/merges nothing');
assert.throws(() => upload({ prbNo: '0123' }), /synthetic\.pdf/); checks++;
files[first.insured.id].description = JSON.stringify({ ...JSON.parse(files[first.insured.id].description), custom: 'preserved' });
const second = upload({ prbNo: '77', total: 0 });
eq([second.insured.id, second.insured.taxId, second.insured.address], [first.insured.id, 'TEST', 'Synthetic address'], 'insured merge');
eq(JSON.parse(files[first.insured.id].description).custom, 'preserved', 'unknown insured metadata kept');
eq(second.row.name, 'synthetic (2).pdf', 'unique file name');
const third = upload({ netPremium: 0.1, stamps: 0.2 });
eq(third.row.name, 'synthetic (3).pdf', 'sibling pagination');
const patch = run('prbUpdate', { id: first.row.id, row: { note: 'changed', name: 'never.pdf', prbNo: '' } });
eq([patch.note, patch.prbNo, patch.barcode, patch.name], ['changed', '', '00456', 'synthetic.pdf'], 'merge and immutable file name');
rejects(() => run('prbUpdate', { id: first.row.id, row: { prbNo: '77' } }), 'duplicate');
eq(run('prbList').rows.length, 3, 'list pagination');
eq(run('list').files, [], 'main list excludes PRB');
eq(run('list').customers.map(c => c.id), [other], 'PRB root is not a customer');

// Normal and PRB actions must reject one another's IDs, all folders, and broken ancestry.
const customer = folder('Synthetic customer', root, { bimeyar: 'item' });
const month = folder('11 November 2026', customer, { bimeyar: 'month', year: '2026', month: '11' });
const vehicle = folder('TEST-1', month, { bimeyar: 'vehicle', plate: 'TEST-1' });
const slot3 = folder('3. พรบ.', vehicle, { bimeyar: 'slot', slot: '3' });
const slot1 = folder('1. policy', vehicle, { bimeyar: 'slot', slot: '1' });
const source = Drive.Files.create({ name: 'source.pdf', mimeType: 'application/pdf', parents: [slot3], description: 'Original note',
  appProperties: { bimeyar: 'item', kind: 'file', type: 'policy', link: '1', aib: 'old-batch' } });
const wrongSlot = Drive.Files.create({ ...source, id: undefined, parents: [slot1] });
for (const action of ['getFile', 'shareFile', 'unshareFile', 'deleteFile']) rejects(() => run(action, { id: first.row.id }), 'not_found');
rejects(() => B.assertCustomer(untagged), 'not_found');
rejects(() => run('deleteCustomer', { id: untagged }), 'not_found');
for (const id of [root, untagged, first.insured.id, customer, source.id]) {
  for (const action of ['prbGetFile', 'prbShare', 'prbUnshare', 'prbDelete', 'prbUpdate']) rejects(() => run(action, { id }), 'not_found');
}
for (const id of [root, untagged, first.insured.id, first.row.id]) {
  files[id].trashed = true;
  rejects(() => run('prbGetFile', { id: first.row.id }), 'not_found');
  delete files[id].trashed;
}
const outside = folder('Outside app', '', { bimeyar: 'root' });
const oldParents = files[untagged].parents;
files[untagged].parents = [outside];
rejects(() => run('prbShare', { id: first.row.id }), 'not_found');
files[untagged].parents = oldParents;
files[first.insured.id].appProperties.bimeyar = 'item';
rejects(() => run('prbGetFile', { id: first.row.id }), 'not_found');
files[first.insured.id].appProperties.bimeyar = 'prbins';
eq(run('prbGetFile', { id: first.row.id }), { mime: 'application/pdf', data: 'AQID' }, 'file bytes');
perms[first.row.id] = [{ id: 'u1', type: 'user', role: 'writer' }, { id: 'u2', type: 'user', role: 'reader' },
  { id: 'public', type: 'anyone', role: 'writer', allowFileDiscovery: true }];
eq(run('prbShare', { id: first.row.id }).row.shared, true, 'shared flag');
eq(perms[first.row.id].filter(p => p.type === 'anyone').map(({ id, ...p }) => p), [{ type: 'anyone', role: 'reader', allowFileDiscovery: false }], 'searchable public permission replaced by one link-only viewer');
eq(perms[first.row.id].some(p => p.id === 'public'), false, 'searchable permission removed');
run('prbShare', { id: first.row.id });
eq(perms[first.row.id].length, 3, 'share idempotent');
eq(run('prbUnshare', { id: first.row.id }).shared, false, 'unshared');
eq(perms[first.row.id].map(p => p.id), ['u1', 'u2'], 'specific-user permissions retained');
eq(Object.keys(perms), [first.row.id], 'only requested file permissions touched');

const beforePlan = clone({ files, props, writes });
const plan = run('prbImportPlan');
eq(plan.map(p => [p.id, p.customerId, p.vehicleId, p.plate, p.ym, p.imported]), [[source.id, customer, vehicle, 'TEST-1', '2026-11', '']], 'only slot 3 candidates');
eq({ files, props, writes }, beforePlan, 'import plan read-only');
const sourceBefore = clone(files[source.id]);
const imported = run('prbImport', { items: [{ id: source.id, insured: { name: first.insured.name }, row: { prbNo: '888' }, name: 'imported' }] });
eq(imported.skipped, [], 'copy imported');
const copy = imported.done[0].row;
eq([copy.src, copy.name, copy.shared, copy.insuredId], [source.id, 'imported.pdf', false, first.insured.id], 'copy metadata');
eq(files[source.id], sourceBefore, 'source byte-for-byte metadata unchanged');
eq([files[copy.id].appProperties.aib, files[copy.id].appProperties.type], [undefined, undefined], 'copy sheds source app tags');
eq(run('prbImportPlan')[0].imported, copy.id, 'plan identifies copy');
eq(run('prbImport', { items: [{ id: source.id, insured: { name: first.insured.name } }] }).skipped[0].why.startsWith('duplicate:'), true, 'repeat source skipped');
eq(run('prbImport', { items: [{ id: wrongSlot.id, insured: { name: 'Synthetic' } }] }).done, [], 'wrong source slot refused');
files[month].trashed = true;
eq(run('prbImportPlan'), [], 'trashed vehicle ancestor excluded from import plan');
eq(run('prbImport', { items: [{ id: source.id, insured: { name: 'Synthetic' } }] }).skipped[0].why.startsWith('not_found:'), true, 'import revalidates source ancestry');
delete files[month].trashed;
rejects(() => run('prbImport', { items: Array(21).fill({}) }), 'bad_request');
eq(run('prbDelete', { id: copy.id }), true, 'delete success');
eq(files[copy.id].trashed, true, 'delete is trash only');
eq(run('prbImportPlan')[0].imported, '', 'trashed copies excluded');
eq(run('prbImport', { items: [{ id: source.id, insured: { name: first.insured.name }, row: { barcode: '00456' } }] }).skipped[0].why.startsWith('duplicate:'), true, 'duplicate barcode on import');
eq(files[source.id], sourceBefore, 'failed import also preserves source');

// Integer money and explicit totals, including zero. Discount is not subtracted again.
eq(B.prbTotals([{ netPremium: 0.1, stamps: 0.2, vat: 0.3 }, { netPremium: 9, total: 0 }, { netPremium: 1, discount: 50, total: 2 }]),
  { lines: [{ net: 0.1, stamps: 0.2, vat: 0.3, total: 0.6 }, { net: 9, stamps: 0, vat: 0, total: 0 }, { net: 1, stamps: 0, vat: 0, total: 2 }], net: 10.1, stamps: 0.2, vat: 0.3, total: 2.6 }, 'totals contract');
eq(B.prbTotals([{}]), { lines: [{ net: 0, stamps: 0, vat: 0, total: 0 }], net: 0, stamps: 0, vat: 0, total: 0 }, 'missing amounts');
rejects(() => B.prbTotals([{ netPremium: -1 }]), 'bad_request');
rejects(() => B.prbTotals([{ vat: 'NaN' }]), 'bad_request');
rejects(() => B.prbTotals([{ total: 1e100 }]), 'bad_request');
eq(B.prbFields({ issueDate: '2569-02-29', contractDate: '2567-02-29', total: '', prbNo: '0001x', brokerName: 'x'.repeat(130) }),
  { prbNo: '0001', contractDate: '2024-02-29', issueDate: '', total: '', brokerName: 'x'.repeat(120) }, 'dates, blanks and field limits');

props.INV_SEQ = '{"2026":123}';
props.COMPANY = JSON.stringify({ name: 'Synthetic insurer', nameEn: 'TEST COMPANY', taxId: 'TEST-TAX', address: 'Test road', bank: 'Test bank', footer: 'Test footer' });
const different = upload({ prbNo: '999' }, { name: 'Other synthetic insured' });
rejects(() => run('prbInvoice', { insuredId: first.insured.id, rowIds: [different.row.id] }), 'bad_request');
rejects(() => run('prbInvoice', { insuredId: first.insured.id, rowIds: [first.row.id, first.row.id] }), 'bad_request');
rejects(() => run('prbInvoice', { insuredId: first.insured.id, rowIds: [] }), 'bad_request');
rejects(() => run('prbInvoice', { insuredId: first.insured.id, rowIds: [first.row.id], issue: '2026-11-22', due: '2026-01-01' }), 'bad_request');
const invoice = run('prbInvoice', { insuredId: first.insured.id, rowIds: [first.row.id, third.row.id], issue: '2569-11-22', due: '2569-12-01', lang: 'both', dateFmt: 'be',
  notes: 'Synthetic notes', lines: [{ total: 99999 }], t: { total: 99999 } });
eq([invoice.no, invoice.issue, invoice.due, invoice.status], ['PRB-2026-0001', '2026-11-22', '2026-12-01', 'unpaid'], 'invoice metadata');
eq(invoice.t, { net: 600.11, stamps: 3.2, vat: 42.21, total: 645.52 }, 'invoice derives amounts exclusively from saved rows');
eq(invoice.lines[0].rowId, first.row.id, 'invoice row snapshot');
eq(invoice.cust.taxId, 'TEST', 'insured tax ID on invoice');
eq(props.INV_SEQ, '{"2026":123}', 'RI sequence unchanged');
eq(JSON.parse(props.PRB_SEQ), { 2026: 1 }, 'separate sequence');
eq(writes.filter(w => w.id === 'PRB_SEQ').every(w => w.locked), true, 'sequence allocation locked');
eq(files[invoice.id].appProperties.kind, 'prbinv', 'invoice isolated');
eq(run('prbList').invoices.map(i => i.id), [invoice.id], 'invoice listing');
eq(run('prbGetFile', { id: invoice.id }).mime, 'application/pdf', 'invoice downloadable');
eq(run('prbShare', { id: invoice.id }).row.id, invoice.id, 'invoice shareable');
rejects(() => run('prbUpdate', { id: invoice.id, row: { total: 1 } }), 'not_found');
rejects(() => run('getFile', { id: invoice.id }), 'not_found');
eq(docs[0].paragraphs.includes('Synthetic insurer'), true, 'company settings on PDF');
eq(docs[0].paragraphs.some(s => s.includes('22/11/2569')), true, 'PDF BE display');
eq(docs[0].tables[0].at(-1).slice(3), ['฿600.11', '฿3.20', '฿42.21', '฿645.52'], 'PDF money columns');
eq(docs[0].styles.every(s => s.font === 'Sarabun'), true, 'Sarabun throughout');
eq([docs[0].closed, files[docs[0].id].trashed], [true, true], 'temporary Doc closed and trashed');
// Simulate a lost sequence property and >50 existing numbers; never wrap at 9999.
for (let i = 2; i <= 55; i++) Drive.Files.create({ name: 'historic.pdf', parents: [first.insured.id], appProperties: { bimeyar: 'prb', kind: 'prbinv', invNo: 'PRB-2026-' + String(i).padStart(4, '0') } });
props.PRB_SEQ = '{}';
eq(B.withLock(() => B.nextPrbInvoiceNo('2026-11-22')), 'PRB-2026-0056', 'skip all existing numbers');
props.PRB_SEQ = '{"2026":9999}';
eq(B.withLock(() => B.nextPrbInvoiceNo('2026-11-22')), 'PRB-2026-10000', 'sequence never wraps');
eq(B.withLock(() => B.nextPrbInvoiceNo('2027-01-01')), 'PRB-2027-0001', 'new CE year');
x.setPdfFailure(true);
assert.throws(() => run('prbInvoice', { insuredId: first.insured.id, rowIds: [first.row.id] }), /PDF conversion failed/); checks++;
eq(files[docs.at(-1).id].trashed, true, 'temporary Doc trashed on conversion error');

// Route/ACL regression: deny before invoking any Drive operations.
props.ACL = JSON.stringify({ 'viewer@example.invalid': 'viewer', 'editor@example.invalid': 'editor' });
const needs = { prbList: 'viewer', prbGetFile: 'viewer', prbUpload: 'editor', prbUpdate: 'editor', prbShare: 'editor', prbUnshare: 'editor', prbDelete: 'editor', prbInvoice: 'editor', prbImport: 'admin', prbImportPlan: 'admin' };
for (const [action, role] of Object.entries(needs)) {
  eq(B.ACTIONS[action].need, role, action + ' role');
  if (role === 'viewer') continue;
  const before = writes.length;
  const post = B.doPost({ postData: { contents: JSON.stringify({ action, token: (role === 'admin' ? 'editor' : 'viewer') + '@example.invalid' }) } });
  eq(JSON.parse(post).error, 'role', 'router role denied');
  eq(writes.length, before, 'denied action has no writes');
}
// Stale configured PRB root is never trusted or adopted outside the app.
const z = fixture();
const outsideRoot = z.folder('พ.ร.บ.', '', { bimeyar: 'prbroot' }); z.props.PRB_ROOT_ID = outsideRoot;
eq(z.run('prbList').root, '', 'outside cached root ignored');
const zUpload = z.upload();
eq(z.files[z.props.PRB_ROOT_ID].parents, [z.root], 'first upload creates root inside configured app');
eq(z.files[outsideRoot].parents, [], 'outside folder untouched');
eq(zUpload.row.insuredId, zUpload.insured.id, 'fresh root upload');
const longName = 'บริษัท ' + 'ทดสอบ '.repeat(40) + 'จำกัด';
const longInsured = z.upload({}, { name: longName });
eq(longInsured.insured.name, longName, 'insured identity is not truncated to file-name length');
const longFolder = z.files[longInsured.insured.id];
longFolder.name = 'Manually renamed folder';
eq(z.upload({}, { name: longName }).insured.id, longInsured.insured.id, 'insured found by hash and parent, not folder name');
z.files[zUpload.row.id].appProperties.link = '1';
z.files[zUpload.row.id].appProperties.src = 'synthetic_source';
const updated = z.run('prbUpdate', { id: zUpload.row.id, row: { total: 0, netPremium: 50 } });
eq([updated.shared, updated.src, updated.total], [true, 'synthetic_source', 0], 'update preserves sharing/source tags and explicit zero');
delete z.props.ROOT_ID;
const zBefore = clone({ files: z.files, props: z.props, writes: z.writes });
eq(z.run('prbImportPlan'), [], 'no configured app root: read-only plan');
eq({ files: z.files, props: z.props, writes: z.writes }, zBefore, 'no root bootstrap in plan');

// Frontend is developed separately; automatically enforce parity when its module is present.
const frontendUrl = new URL('../js/prb.js', import.meta.url);
if (existsSync(frontendUrl)) {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
  const { prbTotals } = await import(frontendUrl);
  for (const rows of [[], [{}], [{ total: '' }], [{ netPremium: '1,234.50', stamps: '฿2.00', vat: 0, total: 0 }],
    [{ netPremium: 600.005, stamps: 3, vat: 42.21 }], [{ netPremium: null, stamps: null, total: null }]]) {
    eq(prbTotals(rows), B.prbTotals(rows), 'frontend/backend fixed edge cases');
  }
  for (let i = 0; i < 1000; i++) {
    const rows = Array.from({ length: 1 + i % 7 }, (_, j) => ({ netPremium: (i * 37 + j) / 100, stamps: (i % 23) / 100,
      vat: (j * 17) / 100, ...(i % 3 === 0 ? { total: i % 2 ? 0 : i / 100 } : {}) }));
    eq(prbTotals(rows), B.prbTotals(rows), 'frontend/backend totals parity');
  }
} else console.log('PRB frontend parity pending: js/prb.js is not present.');
console.log(`All ${checks} PRB checks passed.`);
