// Dashboard calculations only: never mutate or persist the supplied records.
import { parseDate, addDays, daysBetween, cmpIso, monthStart } from './dates.js';
import { latestOf, vehiclesOf } from './vehicles.js';
import { latinDigits } from './validate.js';
import { plateOnly } from './naming.js';

export function payDue(vehicle) {
  const raw = vehicle.payDays;
  const n = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : NaN;
  const days = Number.isInteger(n) && n >= 1 && n <= 365 ? n : 30;
  return { due: addDays(vehicle.policyStart, days), days, paid: vehicle.paid === '1' };
}

export function paymentItems(customers, vehicles, today) {
  const items = [];
  for (const c of customers) for (const v of latestOf(vehiclesOf(c, vehicles))) {
    const { due, paid } = payDue(v);
    if (paid || !due) continue;
    const d = daysBetween(today, due);
    if (!Number.isFinite(d) || d < -60) continue;
    items.push({ c, v, due, d, state: d < 0 ? 'overdue' : d === 0 ? 'today' : d === 1 ? 'tomorrow' : 'upcoming' });
  }
  return items.sort((a, b) => cmpIso(a.due, b.due));
}

export function paymentBuckets(items, today, weeks = 8) {
  const bucket = (offset, length) => {
    const start = addDays(today, offset), end = addDays(start, length - 1);
    const rows = items.filter(x => cmpIso(x.due, start) >= 0 && cmpIso(x.due, end) <= 0);
    return { start, end, n: rows.length, rows };
  };
  const overdueRows = items.filter(x => cmpIso(x.due, today) < 0);
  return { overdue: overdueRows.length, overdueRows,
    weeks: Array.from({ length: weeks }, (_, i) => bucket(i * 7, 7)),
    days: Array.from({ length: 14 }, (_, i) => bucket(i, 1)) };
}

export function prbExpiring(rows, today) {
  const newest = new Map();
  rows.forEach((row, i) => {
    const end = parseDate(row.end);
    if (!end) return;
    const vin = latinDigits(row.vin).replace(/\s+/g, '').toUpperCase();
    const plate = latinDigits(plateOnly(row.plate, row.province)).replace(/[\s.\-]/g, '').toLowerCase();
    const province = latinDigits(row.province).replace(/\s+/g, '').toLowerCase();
    const key = vin ? 'v:' + vin : plate ? 'p:' + plate + '|' + province : 'r:' + i;
    if (!newest.has(key) || cmpIso(end, newest.get(key).end) > 0)
      newest.set(key, { row, end, d: daysBetween(today, end) });
  });
  const items = [...newest.values()].sort((a, b) => cmpIso(a.end, b.end));
  const expired = items.filter(x => x.d < 0);
  const result = { expired, expiredRows: expired };
  for (const n of [7, 30, 60, 90]) result['d' + n] = items.filter(x => x.d >= 0 && x.d <= n).length;
  result.months = Array.from({ length: 6 }, (_, i) => {
    const ym = monthStart(today, i).slice(0, 7);
    const rows = items.filter(x => x.end.slice(0, 7) === ym);
    return { ym, n: rows.length, rows };
  });
  return result;
}
