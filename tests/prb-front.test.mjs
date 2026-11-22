// v4.5.0: Frontend unit tests for js/prb.js and LocalStore พ.ร.บ. methods.
// Only made-up values; no real customer data. Run: node tests/prb-front.test.mjs
const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
};
globalThis.navigator ||= { language: 'en' };

const { normalize } = await import('../js/ai.js');
const {
  PRB_FIELDS, prbStatus, sortRows, prbTotals, vatCheck,
  prbMonth, prbFileName, rowFromAi, isPrbDoc, findDup,
} = await import('../js/prb.js');
const { LocalStore } = await import('../js/store-local.js');

let fail = 0, pass = 0;
const eq = (a, b, msg) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; console.error('FAIL', msg, a, '!=', b); }
};

// 1. PRB_FIELDS order and count
eq(PRB_FIELDS.length, 30, 'PRB_FIELDS count');
eq([PRB_FIELDS[0], PRB_FIELDS[1], PRB_FIELDS[20], PRB_FIELDS[26], PRB_FIELDS[29]], ['prbNo', 'barcode', 'end', 'total', 'note'], 'PRB_FIELDS order');

// 2. prbStatus (expired / soon / active / none with a fixed today)
const TODAY = '2026-11-22';
eq(prbStatus({ end: '2026-11-21' }, TODAY), 'expired', 'prbStatus expired');
eq(prbStatus({ end: '2026-11-22' }, TODAY), 'soon', 'prbStatus soon 0d');
eq(prbStatus({ end: '2026-12-22' }, TODAY), 'soon', 'prbStatus soon 30d');
eq(prbStatus({ end: '2026-12-23' }, TODAY), 'active', 'prbStatus active 31d');
eq(prbStatus({ end: '' }, TODAY), 'none', 'prbStatus empty');
eq(prbStatus({}, TODAY), 'none', 'prbStatus missing');

// 3. sortRows (9620656, 9620654, '', 9620655 -> 54,55,56,'')
const unsorted = [
  { id: 'a', prbNo: '9620656', plate: '71-0003' },
  { id: 'b', prbNo: '9620654', plate: '71-0001' },
  { id: 'c', prbNo: '', plate: '71-0004' },
  { id: 'd', prbNo: '9620655', plate: '71-0002' },
];
eq(sortRows(unsorted).map(r => r.prbNo), ['9620654', '9620655', '9620656', ''], 'sortRows numeric + empty last');
eq(unsorted[0].prbNo, '9620656', 'sortRows does not mutate input');
const tieRows = [
  { prbNo: '', plate: '71-2000', createdAt: '2026-11-02' },
  { prbNo: '', plate: '71-1000', createdAt: '2026-11-05' },
  { prbNo: '', plate: '71-1000', createdAt: '2026-11-01' },
];
eq(sortRows(tieRows).map(r => `${r.plate}:${r.createdAt}`), ['71-1000:2026-11-01', '71-1000:2026-11-05', '71-2000:2026-11-02'], 'sortRows tie-break plate then createdAt');

// 4. prbTotals (net 600 stamps 3 vat 42.21 -> total 645.21; two lines sum; total given wins)
const t1 = prbTotals([{ netPremium: 600, stamps: 3, vat: 42.21 }]);
eq(t1, { lines: [{ net: 600, stamps: 3, vat: 42.21, total: 645.21 }], net: 600, stamps: 3, vat: 42.21, total: 645.21 }, 'prbTotals 1 line computed total');

const t2 = prbTotals([
  { netPremium: '600.00', stamps: '3', vat: '42.21', total: '' },
  { netPremium: '1820', stamps: '8', vat: '127.96', total: '1955.96' },
]);
eq(t2, {
  lines: [
    { net: 600, stamps: 3, vat: 42.21, total: 645.21 },
    { net: 1820, stamps: 8, vat: 127.96, total: 1955.96 },
  ],
  net: 2420, stamps: 11, vat: 170.17, total: 2601.17,
}, 'prbTotals two lines sum');

const t3 = prbTotals([{ netPremium: 600, stamps: 3, vat: 42.21, total: 640 }]);
eq(t3.total, 640, 'prbTotals given total wins');
eq(t3.lines[0].total, 640, 'prbTotals line given total wins');

// 5. vatCheck & prbMonth & prbFileName
eq(vatCheck({ netPremium: '600', stamps: '3', vat: '42.21', total: '645.21' }).ok, true, 'vatCheck ok');
eq(vatCheck({ netPremium: '600', stamps: '3', vat: '40', total: '643' }).ok, false, 'vatCheck mismatch');
eq(vatCheck({ netPremium: '600' }).ok, null, 'vatCheck incomplete');
eq(prbMonth({ contractDate: '2026-11-09', issueDate: '2026-10-01', start: '2026-12-01' }), 11, 'prbMonth contractDate first');
eq(prbMonth({ issueDate: '2026-10-01', start: '2026-12-01' }), 10, 'prbMonth issueDate second');
eq(prbMonth({ start: '2026-12-01' }), 12, 'prbMonth start third');
eq(
  prbFileName({ plate: '71-5262', contractDate: '2026-11-09' }, 'ห้างหุ้นส่วนจำกัด พี พี เอส ทรานสปอร์ต', '.pdf'),
  '71-5262 - พี พี เอส ทรานสปอร์ต(11) - พ.ร.บ..pdf',
  'prbFileName exact contract example'
);

// 6. rowFromAi & isPrbDoc on a normalize() result of a made-up prb answer
const F = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v, confidence: 0.92 }]));
const aiNorm = normalize({
  docType: 'prb',
  slot: '3',
  fields: F({
    insuredName: 'ห้างหุ้นส่วนจำกัด สมมติ โลจิสติกส์',
    taxId: '0103555000999',
    address: '99/9 ถนนสมมติ กรุงเทพฯ 10900',
    prbNo: '9620656',
    barcode: '3710496206565',
    plate: '71 5262',
    province: 'นครปฐม',
    brand: 'HINO',
    model: 'FG8J',
    bodyType: 'ตู้บรรทุก',
    vin: 'FG8JFAKE00001\nJ08EFAKE00001',
    vehicleCode: '320',
    cc: '7684',
    seats: '3',
    weight: '15',
    companyCode: '37',
    insurer: 'บริษัท สมมติประกันภัย จำกัด (มหาชน)',
    policyNo: '37104-9620656-5',
    receiptNo: 'RC-001',
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
    brokerName: 'นายสมมติ ตัวแทน',
    brokerLicense: 'ว00001/2569',
  }),
});
eq(isPrbDoc(aiNorm), true, 'isPrbDoc true for prb docType');
eq(isPrbDoc({ docType: 'other', values: { policyType: 'พ.ร.บ.' }, prb: {} }), true, 'isPrbDoc true by policyType');
eq(isPrbDoc({ docType: 'other', slot: '3', values: {}, prb: { prbNo: '9620656' } }), true, 'isPrbDoc true by slot 3 + prbNo');
eq(isPrbDoc({ docType: 'policy', slot: '1', values: { policyType: 'ชั้น 1' }, prb: {} }), false, 'isPrbDoc false for class 1 policy');

const mapped = rowFromAi(aiNorm);
eq(mapped.insured, {
  name: 'ห้างหุ้นส่วนจำกัด สมมติ โลจิสติกส์',
  taxId: '0103555000999',
  address: '99/9 ถนนสมมติ กรุงเทพฯ 10900',
}, 'rowFromAi insured');
eq(mapped.row.prbNo, '9620656', 'rowFromAi prbNo');
eq(mapped.row.barcode, '3710496206565', 'rowFromAi barcode');
eq(mapped.row.plate, '71-5262', 'rowFromAi normalized plate');
eq([mapped.row.vin, mapped.row.engineNo], ['FG8JFAKE00001', 'J08EFAKE00001'], 'rowFromAi vin and engineNo');
eq([mapped.row.contractDate, mapped.row.issueDate, mapped.row.start, mapped.row.end], ['2026-11-09', '2026-11-09', '2026-11-09', '2027-11-09'], 'rowFromAi ISO CE dates');
eq([mapped.row.netPremium, mapped.row.discount, mapped.row.stamps, mapped.row.vat, mapped.row.total], ['600', '0', '3', '42.21', '645.21'], 'rowFromAi money strings');
eq([mapped.row.brokerName, mapped.row.brokerLicense], ['นายสมมติ ตัวแทน', 'ว00001/2569'], 'rowFromAi broker');

// 7. findDup
const existing = [
  { id: 'r1', prbNo: '9620654', barcode: '3710496206541', name: 'one.pdf' },
  { id: 'r2', prbNo: '9620655', barcode: '3710496206558', name: 'two.pdf' },
];
eq(findDup({ prbNo: '9620655', barcode: '' }, existing)?.id, 'r2', 'findDup by prbNo');
eq(findDup({ prbNo: '', barcode: '3710496206541' }, existing)?.id, 'r1', 'findDup by barcode');
eq(findDup({ prbNo: '9620655', barcode: '3710496206558' }, existing, 'r2'), null, 'findDup ignores exceptId');
eq(findDup({ prbNo: '', barcode: '' }, existing), null, 'findDup empty returns null');

// 8. LocalStore พ.ร.บ. methods (upload, duplicate check, update, invoice seq)
const store = new LocalStore();
const up1 = await store.prbUpload(new Blob(['pdf'], { type: 'application/pdf' }), mapped.insured, mapped.row, { name: 'test1.pdf' });
eq(up1.row.prbNo, '9620656', 'LocalStore prbUpload row');
let dupErr = '';
try {
  await store.prbUpload(new Blob(['pdf']), mapped.insured, { ...mapped.row }, { name: 'dup.pdf' });
} catch (e) { dupErr = e.code; }
eq(dupErr, 'duplicate', 'LocalStore prbUpload rejects duplicate');
const inv = await store.prbInvoice({ insuredId: up1.insured.id, rowIds: [up1.row.id], issue: '2026-11-22' });
eq([inv.no, inv.fileName, inv.t.total], ['PRB-2026-0001', 'PRB-2026-0001.pdf', 645.21], 'LocalStore prbInvoice');

console.log(`prb-front: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
