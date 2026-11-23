// v4.5.2: reading accuracy of พ.ร.บ. documents. 8 SYNTHETIC cases of one Viriyah batch that reproduce the error
// patterns seen on real documents (กซ instead of กธ, first group dropped, barcode as policy no., vehicle code as cc,
// province from the address, insured name read differently). No real customer data (the repo is public).
// Run: node tests/prb-accuracy.test.mjs
globalThis.localStorage = { getItem: () => null, setItem: () => { }, removeItem: () => { } };
globalThis.navigator ||= { language: 'en' };
const { normalize } = await import('../js/ai.js');
const { rowFromAi, prbPost, fixPolicyNo, parsePolicyNo, policyConsensus, suggestPolicyNo, majorityName, isViriyah } = await import('../js/prb.js');

let fail = 0, pass = 0;
const eq = (a, b, msg) => { if (JSON.stringify(a) === JSON.stringify(b)) pass++; else { fail++; console.error('FAIL', msg, JSON.stringify(a), '!=', JSON.stringify(b)); } };

const INSURER = 'บริษัท วิริยะประกันภัย จำกัด (มหาชน)', NAME = 'หจก.เค ที ที เอส ทดสอบ';
const F = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v, confidence: 0.9 }]));
const base = i => ({
  insuredName: NAME, plate: `00-000${i}`, plateText: `00-000${i} กข`, prbNo: `100000${i}`, receiptNo: `100000${i}`,
  barcode: `37104100000${i}7`, companyCode: 'VIB', insurer: INSURER, vin: `TESTVIN0000${i}`, engineNo: `TESTENG0000${i}`,
  vehicleCode: '2.40D', cc: '0/3/21', policyStart: '2026-11-09', policyExpiry: '2027-11-09', contractDate: '2026-11-09',
  netPremium: '600', stamps: '3', vat: '42.21', total: '645.21',
});
// what the AI returned (with the real error patterns), and what must come out
const CASES = [
  { raw: { policyNo: '11111 22222/กธ/1000001' }, policy: '11111 22222/กธ/1000001' },                                   // 1 correct
  { raw: { policyNo: '11111 22222/กซ/1000002' }, policy: '11111 22222/กธ/1000002', auto: '11111 22222/กซ/1000002' },  // 2 กซ, full
  { raw: { policyNo: '22222/กซ/1000003' }, policy: '22222/กธ/1000003', auto: '22222/กซ/1000003', sug: ['prefix', '11111 22222/กธ/1000003'] },
  { raw: { policyNo: '22222/กษ/1000004', insuredName: 'หจก.เค พี ที เอส ทดสอบ' }, policy: '22222/กธ/1000004', auto: '22222/กษ/1000004', sug: ['prefix', '11111 22222/กธ/1000004'], name: NAME },
  { raw: { policyNo: '3710410000057' }, policy: '3710410000057', sug: ['barcode', '11111 22222/กธ/1000005'] },       // 5 barcode
  { raw: { policyNo: '22222/กช/1000006', cc: '2.40D' }, policy: '22222/กธ/1000006', auto: '22222/กช/1000006', sug: ['prefix', '11111 22222/กธ/1000006'], cc: '' },
  { raw: { policyNo: '22222/กธ/1000007', plateText: '00-0007', province: 'กรุงเทพมหานคร', insuredName: 'หจก.เอ ที ที เอส ทดสอบ' }, policy: '22222/กธ/1000007', sug: ['prefix', '11111 22222/กธ/1000007'], prov: '', name: NAME },
  { raw: { policyNo: '11111 22222/กฐ/1000099', province: 'กรุงเทพมหานคร' }, policy: '11111 22222/กธ/1000099', auto: '11111 22222/กฐ/1000099', sug: ['noPrb', '11111 22222/กธ/1000008'] },
];
const items = CASES.map((c, k) => {
  const n = normalize({ docType: 'prb', slot: '3', fields: F({ ...base(k + 1), ...c.raw }) });
  return rowFromAi(n);
});
const post = prbPost(items);
CASES.forEach((c, k) => {
  const it = items[k], p = post[k], tag = `case ${k + 1}`;
  eq(it.row.policyNo, c.policy, tag + ' policyNo after auto-fix');
  eq(p.auto.policyNo || '', c.auto || '', tag + ' auto-corrected (old value kept)');
  eq(p.suggest.policyNo ? [p.suggest.policyNo.why, p.suggest.policyNo.value] : null, c.sug || null, tag + ' policy suggestion');
  eq(p.suggest.insuredName || '', c.name || '', tag + ' majority name');
  eq(it.row.cc, 'cc' in c ? c.cc : '0', tag + ' cc from the C.C./Seats/Weight triple only');
  eq([it.row.seats, it.row.weight], 'cc' in c ? ['', ''] : ['3', '21'], tag + ' seats / weight (none when the triple was not read)');
  eq(it.row.province, 'prov' in c ? c.prov : 'กข', tag + ' province only from the plate cell');
  eq([it.row.plate, it.row.prbNo, it.row.vin], [`00-000${k + 1}`, k === 7 ? '1000008' : `100000${k + 1}`, `TESTVIN0000${k + 1}`], tag + ' own values');
});

// helpers on their own
eq(parsePolicyNo('11111 22222 / กธ / 1000001'), { a: '11111', b: '22222', code: 'กธ', no: '1000001' }, 'parse with spaces');
eq(parsePolicyNo('๑๑๑๑๑ ๒๒๒๒๒/กธ/๑๐๐๐๐๐๑')?.a, '11111', 'parse Thai digits');
eq(parsePolicyNo('3710410000057'), null, 'barcode is not a policy number');
eq(fixPolicyNo({ policyNo: '22222/กซ/1', companyCode: 'XYZ', insurer: 'บริษัท อื่น จำกัด' }).fixed, false, 'only Viriyah is auto-corrected');
eq(fixPolicyNo({ policyNo: '22222/ขซ/1', companyCode: 'VIB' }).fixed, false, 'only near-misses of กธ');
eq(isViriyah({ insurer: INSURER }), true, 'Viriyah by Thai name');
eq(policyConsensus([{ policyNo: '22222/กธ/1', companyCode: 'VIB' }]), '', 'no consensus without the first group');
eq(suggestPolicyNo({ policyNo: '22222/กธ/1000003', prbNo: '1000003', companyCode: 'VIB' }, []), null, 'no suggestion without peers');
eq(majorityName(['บริษัท ทดสอบ', 'บริษัททดสอบ', 'บริษัททดสอบ'], 0), 'บริษัททดสอบ', 'space after บริษัท: majority spelling');
eq(majorityName(['บริษัททดสอบ', 'บริษัททดสอบ', 'บริษัท ทดสอบ'], 0), '', 'majority rows get no suggestion');
eq(majorityName(['บริษัท ก', 'ห้างหุ้นส่วนจำกัด ข ค ง จ', 'ห้างหุ้นส่วนจำกัด ข ค ง จ'], 0), '', 'a really different name is not "corrected"');

// normalize: no plateText = old behaviour (province as read); plateText without province = no province
const n1 = normalize({ docType: 'prb', fields: F({ plate: '00-0001', province: 'กข' }) });
eq(n1.values.province, 'กข', 'without plateText the province stays as read');
const n2 = normalize({ docType: 'prb', fields: F({ plate: '00-0001', plateText: '00-0001', province: 'กรุงเทพมหานคร' }) });
eq([n2.values.province, n2.notes.province], [undefined, 'v.provNoPlate'], 'plate cell without province: never from the address');
const n3 = normalize({ docType: 'prb', fields: F({ cc: '1500', vehicleCode: '1.10' }) });
eq(n3.prb.cc, '1500', 'a real cc stays');

// ---------- v4.5.3 ----------
const { consensusName } = await import('../js/prb.js');
const VIB = { companyCode: 'VIB', insurer: INSURER };
// 1) branch prefix dropped in EVERY row: no consensus, but code part 69100 on VIB -> 00283; or the branch the AI read under VIB
eq(suggestPolicyNo({ ...VIB, policyNo: '69100/กธ/1000001', prbNo: '1000001' }, [{ ...VIB, policyNo: '69100/กธ/1000002' }]),
  { value: '00283 69100/กธ/1000001', why: 'prefix' }, '00283 suggested for 69100 when every row lost it');
eq(suggestPolicyNo({ ...VIB, policyNo: '12345/กธ/1000001', prbNo: '1000001' }, [], { branchCode: '54321' }),
  { value: '54321 12345/กธ/1000001', why: 'prefix' }, 'branch number read under VIB is used');
eq(suggestPolicyNo({ ...VIB, policyNo: '12345/กธ/1000001', prbNo: '1000001' }, []), null, 'unknown code part, no branch read: no guess');
eq(suggestPolicyNo({ ...VIB, policyNo: '00283 69100/กธ/1000001', prbNo: '1000001' }, []), null, 'full number: no suggestion');
eq(suggestPolicyNo({ companyCode: 'XYZ', insurer: 'บริษัท อื่น จำกัด', policyNo: '69100/กธ/1000001', prbNo: '1000001' }, []), null, '00283 only for Viriyah');
// 2) cc only from the raw C.C./Seats/Weight text
const csw = (raw, extra = {}) => normalize({ docType: 'prb', fields: F({ cswText: raw, ...extra }) }).prb;
eq(['cc', 'seats', 'weight'].map(k => csw('0/0/21', { cc: '2' })[k]), ['0', '0', '21'], '"0/0/21" -> 0 / 0 / 21 even when cc was read as 2');
eq(['cc', 'seats', 'weight'].map(k => csw('0/3/21')[k]), ['0', '3', '21'], '"0/3/21" -> 0 / 3 / 21 when cc was read empty');
eq(csw('๐ / ๓ / ๒๑').cc, '0', 'Thai digits and spaces');
eq([csw('unreadable', { cc: '2' }).cc, csw('unreadable', { cc: '2' }).notes?.cc], [undefined, 'v.ccBad'], 'raw text not a triple: no cc at all');
eq(rowFromAi(normalize({ docType: 'prb', fields: F({ cswText: '0/3/21', vehicleCode: '2.40D' }) })).row.cc, '0', 'row cc from the raw text');
// 3) sub-part consensus ("/", "(", "โดย") across the batch and the saved insured names
const PART = 'หจก.เค ที ที เอส ทดสอบขนส่ง';
const batchNames = [`บริษัท ทดสอบ เซอร์วิส จำกัด /${PART}`, `บริษัท ทดสอบ เซอร์วิส จำกัด /${PART}`, `ห้างหุ้นส่วนจำกัด อื่น โดย ${PART}`, 'บริษัท ทดสอบ เซอร์วิส จำกัด /หจก.เท'];
eq(consensusName(batchNames, 3), `บริษัท ทดสอบ เซอร์วิส จำกัด /${PART}`, 'cut sub-part "หจก.เท" gets the batch spelling');
eq(consensusName(batchNames, 0), '', 'majority rows get no suggestion');
eq(consensusName(['บริษัท ใหม่ (หจก.เค พี ที เอส ทดสอบขนส่ง)'], 0, [`บริษัท เก่า /${PART}`]), `บริษัท ใหม่ (${PART})`, 'sub-part corrected against a saved insured name');
eq(consensusName(['บริษัท ใหม่ โดย หจก.เค พี ที เอส ทดสอบขนส่ง'], 0, [`บริษัท เก่า /${PART}`]), `บริษัท ใหม่ โดย ${PART}`, 'split on โดย');
eq(consensusName(['บริษัท ไก่ทอด จำกัด', 'บริษัท ปลาทู จำกัด', 'บริษัท ปลาทู จำกัด'], 0), '', 'different companies are not merged');

// ---------- v4.5.4: Thai tone marks & spellingChoices ----------
const { stripMarks, markCount, spellingChoices } = await import('../js/prb.js');
const PLAIN = 'หจก. พี พี ขนส่ง', MARKED = 'หจก. พี่ พี่ ขนส่ง';
eq([stripMarks(MARKED), stripMarks(PLAIN), markCount(MARKED), markCount(PLAIN)], ['หจก. พี พี ขนสง', 'หจก. พี พี ขนสง', 3, 1], 'stripMarks and markCount U+0E47–U+0E4C');
// plain majority + one marked row -> suggestion is the plain majority, never the marked one
const toneBatch = [PLAIN, PLAIN, MARKED];
eq([majorityName(toneBatch, 0), majorityName(toneBatch, 1), majorityName(toneBatch, 2)], ['', '', PLAIN], 'majorityName: plain majority suggested for marked row only');
eq([consensusName(toneBatch, 0), consensusName(toneBatch, 1), consensusName(toneBatch, 2)], ['', '', PLAIN], 'consensusName: plain majority suggested for marked row only');
const tonePost = prbPost(toneBatch.map((n, i) => ({ row: { plate: `99-000${i + 1}` }, insured: { name: n } })));
eq(tonePost.map(p => p.suggest.insuredName || ''), ['', '', PLAIN], 'prbPost: plain majority suggested for marked row only');
// a saved marked name does not beat the batch majority (whole name and sub-part)
eq(consensusName(toneBatch, 0, [MARKED]), '', 'saved marked name never suggested for plain majority row');
eq(consensusName(toneBatch, 2, [MARKED]), PLAIN, 'saved marked name does not prevent marked row from getting plain majority');
eq(consensusName([PLAIN], 0, [MARKED]), '', 'single plain row is not replaced by a saved marked name');
const subBatch = [`บริษัท ทดสอบ จำกัด /${PLAIN}`, `บริษัท ทดสอบ จำกัด /${PLAIN}`, `บริษัท อื่น จำกัด /${MARKED}`];
eq(consensusName(subBatch, 0, [`บริษัท เก่า จำกัด /${MARKED}`]), '', 'saved marked sub-part never suggested over plain batch majority');
eq(consensusName(subBatch, 2, [`บริษัท เก่า จำกัด /${MARKED}`]), `บริษัท อื่น จำกัด /${PLAIN}`, 'marked sub-part still gets plain batch majority despite saved marked name');
// spellingChoices order: batch majority first, fewer marks on ties, extra-marked variants dropped, then other batch, then saved
eq(spellingChoices([MARKED, PLAIN, PLAIN], [MARKED]), [PLAIN], 'spellingChoices drops extra-marked variant and puts plain majority first');
eq(spellingChoices([MARKED, PLAIN], [MARKED]), [PLAIN], 'spellingChoices tie in batch count: fewer marks wins and extra-marked dropped');
eq(spellingChoices(['หจก. ทดสอบ ขนส่ง', PLAIN, PLAIN, MARKED], ['บริษัท พี พี ขนส่ง จำกัด', MARKED]),
  [PLAIN, 'หจก. ทดสอบ ขนส่ง', 'บริษัท พี พี ขนส่ง จำกัด'], 'spellingChoices order: majority first, other batch, then saved, extra marks dropped');

console.log(`prb-accuracy: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
