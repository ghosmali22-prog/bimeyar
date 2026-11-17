// Checks that the frontend preview maths (js/invoice.js) and the backend maths (backend/Code.gs)
// give exactly the same totals, and that the validation rules hold.
// Run: node tests/invoice-totals.test.mjs
import { readFileSync } from 'node:fs';
import { calcTotals, baht } from '../js/invoice.js';
import { thaiId, thaiPhone, toIsoDate, money } from '../js/validate.js';

const gs = readFileSync(new URL('../backend/Code.gs', import.meta.url), 'utf8');
const grab = name => gs.match(new RegExp(`function ${name}\\([^]*?\\n}`))[0];
const backend = new Function(`${grab('err')}\n${grab('satang')}\n${grab('invoiceTotals')}\nreturn invoiceTotals;`)();

let fail = 0;
const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) { fail++; console.error('FAIL', msg, a, b); } };
const throws = (fn, msg) => { try { fn(); fail++; console.error('FAIL (no throw)', msg); } catch { } };

// random agreement test
for (let i = 0; i < 5000; i++) {
  const items = Array.from({ length: 1 + (i % 6) }, () => ({ q: [1, 2, 3, 0.5, 1.25][Math.floor(Math.random() * 5)], p: (Math.random() * 50000).toFixed(Math.random() < .5 ? 0 : 2) }));
  const vat = Math.random() < .5;
  let f;
  try { f = calcTotals(items, 0, vat, 0); } catch { continue; }
  const disc = (Math.random() * f.sub * .3).toFixed(2);
  const g = calcTotals(items, disc, vat, 0);
  const paid = [0, g.total, (g.total / 3).toFixed(2)][i % 3];
  eq(calcTotals(items, disc, vat, paid), backend(items, disc, vat, paid), 'agree ' + i);
}

// fixed cases
eq(calcTotals([{ q: 1, p: 18500 }], 500, true, 0), { sub: 18500, disc: 500, net: 18000, vat: 1260, total: 19260, paid: 0, bal: 19260, status: 'unpaid' }, 'vat case');
eq(calcTotals([{ q: 3, p: '0.10' }], 0, false, '0.30').status, 'paid', 'float-safe');
eq(calcTotals([{ q: 1, p: 1000 }], 0, false, 400).status, 'partial', 'partial');
throws(() => calcTotals([{ q: 1, p: -5 }], 0, false, 0), 'negative price');
throws(() => calcTotals([{ q: 1, p: 100 }], 200, false, 0), 'discount > subtotal');
throws(() => calcTotals([{ q: 1, p: 100 }], 0, false, 101), 'paid > total');
throws(() => backend([{ q: 1, p: -5 }], 0, false, 0), 'backend negative');

eq(baht(1234), '฿1,234.00', 'baht');
eq(baht(1234567.891), '฿1,234,567.89', 'baht big');

// validation
eq(thaiId('1101700230708'), '1101700230708', 'valid Thai ID');
eq(thaiId('1101700230706'), null, 'bad checksum');
eq(thaiPhone('+66 81 234 5678'), '0812345678', 'phone +66');
eq(thaiPhone('02-123-4567'), '021234567', 'landline');
eq(thaiPhone('12345'), null, 'bad phone');
eq(toIsoDate('2569-03-01'), '2026-03-01', 'BE iso');
eq(toIsoDate('01/03/2569'), '2026-03-01', 'BE dmy');
eq(toIsoDate('๐๑/๐๓/๒๕๖๙'), '2026-03-01', 'Thai digits');
eq(toIsoDate('31/02/2026'), null, 'impossible date');
eq(toIsoDate('2026-11-17'), '2026-11-17', 'CE iso');
eq(money('1,234.50 บาท'), 1234.5, 'money');

console.log(fail ? `${fail} FAILED` : 'all tests passed');
process.exit(fail ? 1 : 0);
