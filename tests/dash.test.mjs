import { payDue, paymentItems, paymentBuckets, prbExpiring } from '../js/dash.js';
import { addDays } from '../js/dates.js';
import { LocalStore } from '../js/store-local.js';

let fail = 0, pass = 0;
const eq = (a, b, msg) => { if (JSON.stringify(a) === JSON.stringify(b)) pass++; else { fail++; console.error('FAIL', msg, a, '!=', b); } };
const today = '2026-11-23';
const c = { id: 'C1', name: 'Test Customer' };
const v = { id: 'V1', customerId: c.id, plate: '99-0001', ym: '2026-10', policyStart: '2026-10-25' };
eq(payDue(v), { due: '2026-11-24', days: 30, paid: false }, 'default term');
eq(payDue({ ...v, payDays: '45' }).due, '2026-12-09', '45 days');
for (const payDays of ['', undefined, null, 'bad', '0', '-1', '366', '1.5', true, []])
  eq(payDue({ ...v, payDays }).days, 30, 'invalid term defaults in code');
eq(payDue({ ...v, payDays: '1' }).days, 1, 'minimum term');
eq(payDue({ ...v, payDays: 365 }).days, 365, 'maximum term');
eq('payDays' in v, false, 'default does not mutate original');
eq(paymentItems([c], [v], today)[0].state, 'tomorrow', 'day 29 of 30');
eq(paymentItems([c], [{ ...v, policyStart: '2026-10-24' }], today)[0].state, 'today', 'due today');
eq(paymentItems([c], [{ ...v, paid: '1' }], today), [], 'paid skipped');
eq(paymentItems([c], [{ ...v, policyStart: '' }], today), [], 'missing start skipped');
eq(payDue({ ...v, policyStart: '25/10/2569' }).due, '2026-11-24', 'BE date');
const cutoffs = [-61, -60, -1, 0, 1, 2, 6, 7, 13, 14, 55, 56].map((d, i) => ({
  ...v, id: 'V' + i, plate: '99-' + String(i + 1).padStart(4, '0'), policyStart: addDays(today, d - 30) }));
const items = paymentItems([c], cutoffs.reverse(), today);
eq(items.map(x => x.d), [-60, -1, 0, 1, 2, 6, 7, 13, 14, 55, 56], 'cutoff inclusive and sorted oldest first');
eq(items[0].state, 'overdue', '60-day cutoff overdue');
eq(items.at(-1).state, 'upcoming', 'future included beyond chart');
const buckets = paymentBuckets(items, today);
eq(buckets.overdue, 2, 'overdue separate');
eq(buckets.weeks.map(x => x.n), [4, 2, 1, 0, 0, 0, 0, 1], 'eight weeks boundaries');
eq(buckets.days.map(x => x.n), [1, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 1], 'fourteen days boundaries');
eq(paymentBuckets(items, today, 2).weeks.length, 2, 'custom weeks');
eq(paymentItems([c], [v, { ...v, id: 'NEW', ym: '2026-11', paid: '1' }], today), [], 'only latest policy counts even when paid');
eq(paymentItems([c], [{ ...v, id: 'OLD', ym: '2026-09' }, v], today).map(x => x.v.id), ['V1'], 'latest month only');
const legacy = { ...c, plate: v.plate, policyStart: v.policyStart };
eq(paymentItems([legacy], [], today).map(x => x.v.id), ['L:C1'], 'legacy included');
eq(paymentItems([legacy], [{ ...v, ym: '2026-11', paid: '1' }], today), [], 'newer record supersedes legacy');

const rows = [-1, 0, 7, 8, 30, 31, 60, 61, 90, 91].map((d, i) => ({
  id: 'P' + i, plate: '99-' + String(i + 1).padStart(4, '0'), province: 'กรุงเทพมหานคร', end: addDays(today, d) }));
const result = prbExpiring(rows, today);
eq([result.expired.length, result.d7, result.d30, result.d60, result.d90], [1, 2, 4, 6, 8], 'expired and cumulative inclusive windows');
eq(result.expired[0].row === rows[0], true, 'original row reference');
eq(result.expiredRows, result.expired, 'expiredRows alias');
eq(result.months.map(m => m.ym), ['2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04'], 'six months across year');
eq(result.months.map(m => m.n), [3, 3, 2, 2, 0, 0], 'expiry month counts include expired this month');
const old = { plate: '99-0020', vin: 'TEST VIN', end: '2026-01-01' };
const newest = { plate: '99-0021', vin: 'testvin', end: '30/11/2569' };
eq(prbExpiring([old, newest], today).d7, 1, 'newest per normalized VIN and BE');
eq(prbExpiring([old, newest], today).expired.length, 0, 'superseded expired row excluded');
eq(prbExpiring([old, newest], today).months[0].rows[0].row === newest, true, 'newest row reference');
eq(prbExpiring([
  { plate: '๙๙-๐๐๒๒', province: 'Bangkok', end: '2026-01-01' },
  { plate: '99 0022', province: ' bangkok ', end: today },
  { plate: '99-0022', province: 'Phuket', end: today },
], today).d7, 2, 'plate normalization and distinct provinces');
eq(prbExpiring([{ end: today }, { end: today }, { end: 'bad' }], today).d7, 2, 'unkeyed rows independent; invalid dates ignored');
eq(prbExpiring([], today).months.map(m => m.n), [0, 0, 0, 0, 0, 0], 'empty chart');

// Exercise the real local-store merge with an asynchronous in-memory IDB request stub.
let localRecord = { ...v, unknownOld: 'keep' };
const request = result => { const r = { result }; queueMicrotask(() => r.onsuccess()); return r; };
const store = new LocalStore();
store.s = () => ({ getAll: () => request([localRecord]), put: value => { localRecord = value; return request(value.id); } });
await store.saveVehicle({ id: v.id, note: 'Test' });
eq(['payDays', 'paid', 'paidDate'].some(k => k in localRecord), false, 'local no defaults written');
await store.saveVehicle({ id: v.id, payDays: '45', paid: '1', paidDate: today });
eq([localRecord.payDays, localRecord.paid, localRecord.paidDate, localRecord.unknownOld], ['45', '1', today, 'keep'], 'local payment fields merge');
await store.saveVehicle({ id: v.id, paid: '' });
eq(['paid' in localRecord, localRecord.payDays, localRecord.paidDate], [false, '45', today], 'local uncheck clears paid only');
await store.saveVehicle({ id: v.id, payDays: '', paidDate: '' });
eq(['payDays', 'paid', 'paidDate'].some(k => k in localRecord), false, 'local empty removes keys');

console.log(`dash: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
