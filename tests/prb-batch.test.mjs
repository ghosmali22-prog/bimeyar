// v4.5.1: Batch พ.ร.บ. extraction isolation, CSW split, prbSanity, insured matching, and security regressions.
// Synthetic fixtures only; no network, no real customer data. Run: node tests/prb-batch.test.mjs
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadBackend, FOLDER } from './fake-drive.mjs';

globalThis.localStorage = { getItem: () => null, setItem: () => { }, removeItem: () => { } };
globalThis.navigator ||= { language: 'en' };

const { normalize } = await import('../js/ai.js');
const {
  rowFromAi, insuredKey, sameInsured, suggestInsured, groupInsured, splitCSW, prbSanity,
} = await import('../js/prb.js');

let pass = 0, fail = 0;
const ok = (cond, msg, extra) => {
  if (cond) pass++;
  else { fail++; console.error('FAIL', msg, extra ?? ''); }
};
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), msg, { got: a, expected: b });

/* ================= Synthetic 8-file พ.ร.บ. batch fixtures ================= */
const INSURED_NAME = 'ห้างหุ้นส่วนจำกัด ทดสอบ ขนส่ง';
const INSURER = 'บริษัท ทดสอบประกันภัย จำกัด (มหาชน)';

function makeFixture(i) {
  const prbNo = String(1000000 + i);
  const plate = '00-000' + i;
  const barcode = '37104' + prbNo + String(i % 10);
  const policyNo = '00000 00000/กธ/' + prbNo;
  const vin = 'TESTVIN0000' + i;
  const engineNo = 'TESTENG0000' + i;
  const F = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v, confidence: 0.95 }]));
  return {
    i,
    prbNo,
    plate,
    barcode,
    policyNo,
    vin,
    engineNo,
    file: { mime: 'application/pdf', data: Buffer.from(`SYNTHETIC_PRB_PDF_${i}`).toString('base64') },
    aiReply: {
      docType: 'prb',
      docName: 'กรมธรรม์',
      slot: '3',
      fields: F({
        insuredName: INSURED_NAME,
        nameTh: INSURED_NAME,
        taxId: '0103555000999',
        address: '99/9 ถนนสมมติ กรุงเทพฯ 10900',
        prbNo,
        barcode,
        plate,
        province: 'นครปฐม',
        brand: 'HINO',
        model: 'TESTMODEL',
        bodyType: 'ตู้บรรทุก',
        vin,
        engineNo,
        vehicleCode: '320',
        cc: '0/3/15',
        seats: '',
        weight: '',
        companyCode: 'VIB',
        insurer: INSURER,
        policyNo,
        receiptNo: prbNo,
        contractDate: '09/11/2569',
        issueDate: '09/11/2569',
        policyStart: '09/11/2569',
        policyExpiry: '09/11/2570',
        periodTime: '16.30',
        netPremium: '600.00',
        discount: '0',
        stamps: '3.00',
        vat: '42.21',
        total: '645.21',
        premium: '645.21',
      }),
    },
  };
}

const FIXTURES = Array.from({ length: 8 }, (_, idx) => makeFixture(idx + 1));

/* ================= 1. Backend: aiExtract isolation & prompt hygiene ================= */
{
  const props = { CLAUDE_API_KEY: 'sk-synthetic-claude' };
  const store = {};
  const calls = [];
  const PropertiesService = {
    getScriptProperties: () => ({
      getProperty: k => props[k] ?? null,
      setProperty: (k, v) => { props[k] = v; },
      deleteProperty: k => { delete props[k]; },
    }),
  };
  const LockService = { getScriptLock: () => ({ waitLock() { }, releaseLock() { } }) };
  const CacheService = {
    getScriptCache: () => ({
      get: k => store[k] ?? null,
      put: (k, v) => { store[k] = v; },
      remove: k => { delete store[k]; },
    }),
  };
  const Utilities = {
    DigestAlgorithm: { SHA_256: 'sha256' },
    computeDigest: (alg, s) => [...createHash('sha256').update(s).digest()],
    base64EncodeWebSafe: b => Buffer.from(b).toString('base64url'),
    sleep() { },
  };
  const UrlFetchApp = {
    fetch(url, opt) {
      const body = JSON.parse(opt.payload);
      const b64 = body.messages[0].content[0].source.data;
      const decoded = Buffer.from(b64, 'base64').toString('utf8');
      const m = decoded.match(/^SYNTHETIC_PRB_PDF_(\d+)$/);
      if (!m) throw new Error('Unexpected file payload: ' + decoded);
      const idx = +m[1];
      const fx = FIXTURES[idx - 1];
      calls.push(idx);
      return {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({
          stop_reason: 'end_turn',
          usage: { input_tokens: 120, output_tokens: 40 },
          content: [{ type: 'text', text: JSON.stringify(fx.aiReply) }],
        }),
      };
    },
  };
  const Session = { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) };
  const gs = readFileSync(new URL('../backend/Code.gs', import.meta.url), 'utf8');
  const B = new Function(
    'PropertiesService', 'LockService', 'CacheService', 'Utilities', 'UrlFetchApp', 'console', 'Session',
    `${gs}\nreturn { aiExtract, aiCacheKey, AI_PROMPT, AI_PROMPT_CLAUDE };`
  )(PropertiesService, LockService, CacheService, Utilities, UrlFetchApp, { log() { } }, Session);

  // Interleaved execution order across the 8 files
  const order = [3, 1, 6, 4, 8, 2, 7, 5];
  for (const i of order) {
    const fx = FIXTURES[i - 1];
    const res = B.aiExtract({ files: [fx.file] });
    ok(!res.cached, `file ${i} first call is not cached`);
    eq(
      [res.fields.prbNo.value, res.fields.plate.value, res.fields.barcode.value, res.fields.vin.value],
      [fx.prbNo, fx.plate, fx.barcode, fx.vin],
      `file ${i} extraction matches its own fixture`
    );
  }
  eq(calls, order, 'Claude called once per file in interleaved order');

  // Re-run 2 files to verify cache hit and isolation
  for (const i of [4, 7]) {
    const fx = FIXTURES[i - 1];
    const res = B.aiExtract({ files: [fx.file] });
    ok(res.cached === true, `file ${i} second call hits cache`);
    eq(
      [res.fields.prbNo.value, res.fields.plate.value, res.fields.barcode.value, res.fields.vin.value],
      [fx.prbNo, fx.plate, fx.barcode, fx.vin],
      `file ${i} cached result belongs to its own file`
    );
  }
  eq(calls.length, 8, 'cache hits made no extra API calls');

  const cacheKeys = FIXTURES.map(fx => B.aiCacheKey([fx.file]));
  eq(new Set(cacheKeys).size, 8, 'all 8 cache keys are distinct');
  const storedResKeys = Object.keys(store).filter(k => k.endsWith(':res'));
  eq(storedResKeys.length, 8, '8 distinct cached result entries in CacheService');

  // Prompt hygiene: no >=7 digit sequences and no example chassis/plate
  ok(!/\d{7,}/.test(B.AI_PROMPT), 'AI_PROMPT has no digit sequence >= 7');
  ok(!/\d{7,}/.test(B.AI_PROMPT_CLAUDE), 'AI_PROMPT_CLAUDE has no digit sequence >= 7');
  ok(!/\d{2}[- ]\d{4}|(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{10,}/.test(B.AI_PROMPT), 'AI_PROMPT has no example chassis or plate');
  ok(!/\d{2}[- ]\d{4}|(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{10,}/.test(B.AI_PROMPT_CLAUDE), 'AI_PROMPT_CLAUDE has no example chassis or plate');
}

/* ================= 2. Frontend: normalize + rowFromAi + splitCSW ================= */
const batch = FIXTURES.map(fx => {
  const n = normalize(fx.aiReply);
  eq([n.prb.cc, n.prb.seats, n.prb.weight], ['0', '3', '15'], `file ${fx.i} normalize splits cc/seats/weight`);
  const mapped = rowFromAi(n);
  eq([mapped.row.cc, mapped.row.seats, mapped.row.weight], ['0', '3', '15'], `file ${fx.i} rowFromAi cc/seats/weight`);
  eq(
    [mapped.row.prbNo, mapped.row.plate, mapped.row.barcode, mapped.row.vin, mapped.row.engineNo, mapped.row.policyNo, mapped.row.receiptNo],
    [fx.prbNo, fx.plate, fx.barcode, fx.vin, fx.engineNo, fx.policyNo, fx.prbNo],
    `file ${fx.i} rowFromAi values isolated`
  );
  return mapped;
});

// Mutating one row object does not affect any other row object
batch[0].row.prbNo = '9999999';
batch[0].row.plate = '99-9999';
batch[0].insured.name = 'MUTATED';
for (let idx = 1; idx < 8; idx++) {
  const fx = FIXTURES[idx];
  eq(batch[idx].row.prbNo, fx.prbNo, `mutating row 0 does not change row ${idx} prbNo`);
  eq(batch[idx].row.plate, fx.plate, `mutating row 0 does not change row ${idx} plate`);
  eq(batch[idx].insured.name, INSURED_NAME, `mutating row 0 does not change row ${idx} insured.name`);
}
batch[0].row.prbNo = FIXTURES[0].prbNo;
batch[0].row.plate = FIXTURES[0].plate;
batch[0].insured.name = INSURED_NAME;

// Direct splitCSW and rowFromAi fallback tests
eq(splitCSW('0/3/15'), { cc: '0', seats: '3', weight: '15' }, 'splitCSW basic');
eq(splitCSW(' ๐ / ๓ / ๒.๕ '), { cc: '0', seats: '3', weight: '2.5' }, 'splitCSW spaces + Thai digits + decimals');
eq(splitCSW('0/3'), null, 'splitCSW 2 parts -> null');
eq(splitCSW('0/3/15/1'), null, 'splitCSW 4 parts -> null');
eq(splitCSW('0/x/15'), null, 'splitCSW non-numeric -> null');
const rawSplit = rowFromAi({ values: {}, prb: { cc: '2500/7/2.5' } });
eq([rawSplit.row.cc, rawSplit.row.seats, rawSplit.row.weight], ['2500', '7', '2.5'], 'rowFromAi direct splitCSW on cc');

/* ================= 3. prbSanity, insuredKey, sameInsured, suggestInsured, groupInsured ================= */
// Clean rows get no warns and no errors
for (let idx = 0; idx < 8; idx++) {
  const res = prbSanity(batch[idx].row, { insuredName: batch[idx].insured.name, rows: [], batch, selfIndex: idx });
  eq(res, { errors: [], warns: [] }, `clean row ${idx + 1} has no errors or warns`);
}

// Leaked row: file 5 (index 4) with prbNo/policyNo of file 4 (index 3) but its own receiptNo and barcode
const leakedRow = {
  ...batch[4].row,
  prbNo: batch[3].row.prbNo,
  policyNo: batch[3].row.policyNo,
};
const leakedCheck = prbSanity(leakedRow, { insuredName: batch[4].insured.name, rows: [], batch, selfIndex: 4 });
eq(leakedCheck.errors.map(e => e.key), ['prb.chk.dup'], 'leaked row gets prb.chk.dup error against batch');
eq(leakedCheck.errors[0].x, '00-0004', 'leaked row dup names file 4 plate');
ok(leakedCheck.warns.some(w => w.key === 'prb.chk.receipt'), 'leaked row gets prb.chk.receipt warn', leakedCheck.warns);
ok(leakedCheck.warns.some(w => w.key === 'prb.chk.barcode'), 'leaked row gets prb.chk.barcode warn', leakedCheck.warns);

// Additional prbSanity checks
const otherChecks = prbSanity(
  {
    ...batch[0].row,
    policyNo: '00000 00000/กธ/9999999',
    contractDate: '31/02/2569',
    start: '2026-11-09',
    end: '2026-11-09',
    vat: '40.00',
    total: '643.00',
  },
  {
    insuredName: '',
    rows: [{ id: 'saved1', plate: '00-0099', vin: batch[0].row.vin, prbNo: '8888888', barcode: '3710488888881' }],
    batch: [],
  }
);
eq(otherChecks.errors.map(e => e.key), ['prb.chk.name', 'prb.chk.date'], 'empty insuredName and bad date caught as errors');
eq(otherChecks.errors[1].x, 'contractDate', 'bad date x = field name');
eq(
  otherChecks.warns.map(w => w.key),
  ['prb.chk.policyNo', 'prb.chk.vat', 'prb.chk.plateVin', 'prb.chk.period'],
  'policyNo, vat, plateVin and period warns caught'
);
eq(otherChecks.warns[1].x, { v: 42.21, t: 645.21 }, 'vat warn x = { v, t }');
eq(otherChecks.warns[2].x, '00-0099', 'plateVin warn x = conflicting plate');

// Insured name matching & grouping (synthetic equivalents)
const nameA = 'บริษัททดสอบศิริ เซอร์วิส จำกัด /หจก.เอ บี ซี ขนส่ง';
const nameB = 'บริษัท ทดสอบภิรัฐ เซอร์วิส จำกัด (หจก.เอ บี ซี ขนส่ง)';
const nameDiff = 'บริษัท สมมติ โลจิสติกส์ จำกัด (มหาชน)';

eq(insuredKey('ห้างหุ้นส่วนจำกัด ทดสอบ ๑๒๓ Co., Ltd.'), 'ทดสอบ123', 'insuredKey strips company words, digits and punctuation');
ok(sameInsured(nameA, nameB) === true, 'sameInsured true for dual-part company spelling variant');
ok(sameInsured(nameA, nameDiff) === false, 'sameInsured false for clearly different companies');
ok(sameInsured('บริษัท ทดสอบขนส่ง จำกัด', 'หจก. ทดสอบขนส่ง') === true, 'sameInsured true when insuredKey equal');

const groups = groupInsured([nameA, nameA, nameB, nameDiff, nameDiff]);
eq(groups, [[0, 1, 2]], 'groupInsured groups sameInsured with different strings and ignores identical-only groups');

const suggestions = suggestInsured(nameB, [
  { id: 'i1', name: nameDiff },
  { id: 'i2', name: nameA },
  { id: 'i3', name: nameB },
]);
eq(suggestions, [
  { id: 'i3', name: nameB, exact: true },
  { id: 'i2', name: nameA, exact: false },
], 'suggestInsured returns matching insured sorted best first with exact flag');

/* ================= 4. Security regressions: thumbs & unshareFile ================= */
{
  const { B, Drive, cache } = loadBackend('ACTIONS');
  const user = { email: 'owner@example.com' };
  const c = B.ACTIONS.saveCustomer.run({ customer: { name: 'บริษัท ทดสอบ จำกัด' } }, user);
  const f1 = B.ACTIONS.upload.run({
    data: Buffer.from('pdf').toString('base64'),
    meta: { customerId: c.id, folder: 'policy', type: 'policy', name: 'doc1.pdf', mime: 'application/pdf' },
  }, user);

  // 1) thumbs: caches valid file, refuses cached thumbnail once file fails assertFile
  const th1 = B.ACTIONS.thumbs.run({ ids: [f1.id] });
  ok(Boolean(th1[f1.id]), 'thumbs returns thumbnail for valid file');
  ok(Boolean(cache['th:' + f1.id]), 'thumbnail is stored in cache');

  const outsideFile = Drive.Files.create({ name: 'secret.pdf', mimeType: 'application/pdf', parents: ['outside_folder'] });
  cache['th:' + outsideFile.id] = 'data:image/png;base64,LEAK';
  Drive.Files.update({ trashed: true }, f1.id);
  const th2 = B.ACTIONS.thumbs.run({ ids: [f1.id, outsideFile.id] });
  eq(th2, {}, 'cached thumbnails are skipped when assertFile fails (trashed or outside root)');
  Drive.Files.update({ trashed: false }, f1.id);

  // 2) unshareFile: collects all pages of Drive.Permissions.list before removing every 'anyone' permission
  B.ACTIONS.shareFile.run({ id: f1.id });
  Drive.permPageSize = 2;
  Drive.perms[f1.id] = [
    { id: 'u1', type: 'user', role: 'writer' },
    { id: 'a1', type: 'anyone', role: 'reader' },
    { id: 'a2', type: 'anyone', role: 'reader' },
    { id: 'u2', type: 'user', role: 'reader' },
    { id: 'a3', type: 'anyone', role: 'writer' },
  ];
  const unshared = B.ACTIONS.unshareFile.run({ id: f1.id });
  eq(unshared.shared, false, 'unshareFile clears shared flag');
  eq(Drive.files[f1.id].appProperties.link, undefined, 'unshareFile clears appProperties.link');
  eq(Drive.perms[f1.id].map(p => p.id), ['u1', 'u2'], 'unshareFile removes all anyone permissions across all pages');
}

console.log(`prb-batch: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
