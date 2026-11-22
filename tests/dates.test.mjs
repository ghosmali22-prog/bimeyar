// v4.4.1: the shared date helper (js/dates.js) and the AI clean-up rules for policies and พ.ร.บ. (js/ai.js).
// Only made-up values; no real customer data. Run: node tests/dates.test.mjs
import { parseDate, beToCe, ceToBe, fmtDMY, yearLooksWrong, daysBetween, cmpIso, daysLeft, isoToday } from '../js/dates.js';
import { toIsoDate } from '../js/validate.js';

globalThis.localStorage = { getItem: () => null, setItem: () => { }, removeItem: () => { } };
globalThis.navigator ||= { language: 'en' };
const { normPlate, policyClass, prbCheck, normalize } = await import('../js/ai.js');

let fail = 0, pass = 0;
const eq = (a, b, msg) => { if (JSON.stringify(a) === JSON.stringify(b)) pass++; else { fail++; console.error('FAIL', msg, a, '!=', b); } };

// dates
eq(parseDate('19/10/2569'), '2026-10-19', 'BE d/m/y');
eq(parseDate('19/10/2570'), '2027-10-19', 'BE end');
eq(parseDate('2570-10-19'), '2027-10-19', 'BE iso');
eq(parseDate('2027-10-19'), '2027-10-19', 'CE iso');
eq(parseDate('09/11/2569 16.30'), '2026-11-09', 'time ignored');
eq(parseDate('09/11/2569 16:30 น.'), '2026-11-09', 'time น. ignored');
eq(parseDate('๑๙/๑๐/๒๕๗๐'), '2027-10-19', 'Thai digits');
eq(parseDate('31/02/2569'), null, 'invalid day');
eq(parseDate('1-3-26'), '2026-03-01', '2-digit CE');
eq(parseDate('1-3-69'), '2026-03-01', '2-digit BE');
eq(parseDate(''), null, 'empty');
eq(toIsoDate('19/10/2570'), '2027-10-19', 'validate.js alias');
eq([beToCe(2569), beToCe(2026), ceToBe(2026), ceToBe(2569)], [2026, 2026, 2569, 2569], 'era');
eq(fmtDMY('2027-10-19', 'be'), '19/10/2570', 'fmt be');
eq(fmtDMY('2027-10-19', 'ce'), '19/10/2027', 'fmt ce');
eq(fmtDMY('x'), '', 'fmt invalid');
eq(yearLooksWrong('2026-10-19', '2027-10-19'), false, '1 year ok');
eq(yearLooksWrong('2026-10-19', '2026-10-19'), true, 'same day');
eq(yearLooksWrong('2026-10-19', '2570-10-19'), true, 'BE left in end');
eq(yearLooksWrong('', '2027-10-19'), false, 'no start');
eq(daysBetween('2026-10-19', '2027-10-19'), 365, 'days');
eq(cmpIso('2026-10-19', '2027-01-01') < 0, true, 'cmp');
eq(daysLeft(isoToday()), 0, 'today');
// 68-6184 style: 19/10/2569 - 19/10/2570 is NOT expired on 2026-11-22
eq(daysBetween('2026-11-22', parseDate('19/10/2570')) > 0, true, 'BE expiry still active');

// plates, class, พ.ร.บ. check
eq(normPlate('71 7895'), '71-7895', 'plate space');
eq(normPlate('71-7895'), '71-7895', 'plate dash');
eq(normPlate('กข 1234'), 'กข 1234', 'plate letters unchanged');
eq(policyClass({ odCover: 'ไม่คุ้มครอง', tfCover: 'ไม่คุ้มครอง' }), 'ชั้น 3', 'class 3');
eq(policyClass({ odCover: 'ไม่คุ้มครอง', tfCover: '500,000' }), 'ชั้น 2', 'class 2');
eq(policyClass({ odCover: '670000' }), 'ชั้น 1', 'class 1');
eq(policyClass({ policyType: 'ชั้น 2+', odCover: 'ไม่คุ้มครอง', tfCover: 'ไม่คุ้มครอง' }), 'ชั้น 2+', 'printed wins');
eq(policyClass({ docType: 'prb' }), 'พ.ร.บ.', 'prb');
eq(policyClass({}), '', 'unknown');
eq(prbCheck({ netPremium: 600, stamps: 3, vat: 42.21, total: 645.21 }).ok, true, 'vat ok');
eq(prbCheck({ netPremium: 600, stamps: 3, vat: 42, total: 645 }).ok, false, 'vat bad');
eq(prbCheck({ netPremium: 600 }).ok, null, 'vat missing');

// normalize: made-up พ.ร.บ. answer with the known AI mistakes
const F = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v, confidence: 0.9 }]));
const n = normalize({ docType: 'prb', slot: '3', fields: F({
  insuredName: 'ห้างหุ้นส่วนจำกัด ทดสอบ ทรานสปอร์ต', plate: '71 7895', vin: 'FG8JRTEST0001\nJ08ETEST0001',
  policyStart: '09/11/2569', policyExpiry: '09/11/2570', contractDate: '09/11/2569', prbNo: '9620656', barcode: '3710496206565',
  netPremium: '600.00', stamps: '3', vat: '42.21', total: '645.21', bodyType: 'ตู้บรรทุก', carValue: '670,000' }) });
eq(n.values.plate, '71-7895', 'n plate');
eq([n.values.vin, n.values.engineNo], ['FG8JRTEST0001', 'J08ETEST0001'], 'n vin/engine split');
eq(n.values.policyType, 'พ.ร.บ.', 'n prb class');
eq(n.values.insuredName, 'ห้างหุ้นส่วนจำกัด ทดสอบ ทรานสปอร์ต', 'n insured as printed');
eq([n.values.body, n.values.carValue], ['ตู้บรรทุก', '670000'], 'n body + value');
eq([n.prb.prbNo, n.prb.barcode, n.prb.check.ok], ['9620656', '3710496206565', true], 'n prb fields');
eq(n.values.policyExpiry, '2027-11-09', 'n expiry CE');
const n2 = normalize({ docType: 'policy', fields: F({ vin: 'ABC123456', engineNo: 'ABC-123456', odCover: 'ไม่คุ้มครอง', tfCover: 'ไม่คุ้มครอง', policyStart: '2026-10-19', policyExpiry: '2026-10-19' }) });
eq([n2.values.vin, n2.notes.vin], [undefined, 'v.vinEngine'], 'engine as vin dropped');
eq([n2.values.policyType, n2.notes.policyType], ['ชั้น 3', 'v.classRule'], 'class rule');
eq(n2.notes.policyExpiry, 'v.order', 'doubtful expiry flagged');

console.log(`dates + AI rules: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
