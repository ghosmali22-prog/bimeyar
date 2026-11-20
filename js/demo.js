// Fictional sample data for previewing the app in "this device" mode
import { isoDay } from './util.js';
import { vehicleFileName } from './vehicles.js';

const ago = d => new Date(Date.now() - d * 864e5).toISOString();
const inDays = d => isoDay(Date.now() + d * 864e5);

function tinyPdf(title) {
  const stream = `BT /F1 22 Tf 40 520 Td (${title}) Tj ET\nBT /F1 12 Tf 40 492 Td (Sample document - BimehYar demo data) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 595] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offs = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const x = out.length;
  out += `xref\n0 6\n0000000000 65535 f \n${offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return new Blob([out], { type: 'application/pdf' });
}

function picture(label, h) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 320"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h} 80% 78%)"/><stop offset="1" stop-color="hsl(${(h + 50) % 360} 70% 56%)"/></linearGradient></defs><rect width="480" height="320" fill="url(#g)"/><rect x="40" y="48" width="400" height="224" rx="22" fill="#fff" fill-opacity=".86"/><circle cx="110" cy="130" r="38" fill="hsl(${h} 60% 70%)"/><rect x="170" y="104" width="220" height="16" rx="8" fill="#1b192c" fill-opacity=".75"/><rect x="170" y="136" width="160" height="12" rx="6" fill="#1b192c" fill-opacity=".3"/><rect x="72" y="200" width="336" height="12" rx="6" fill="#1b192c" fill-opacity=".18"/><rect x="72" y="226" width="250" height="12" rx="6" fill="#1b192c" fill-opacity=".18"/><text x="240" y="300" font-family="sans-serif" font-size="15" text-anchor="middle" fill="#fff">${label}</text></svg>`;
  return { blob: new Blob([svg], { type: 'image/svg+xml' }), thumb: 'data:image/svg+xml;utf8,' + encodeURIComponent(svg) };
}

const PEOPLE = {
  fa: [
    { name: 'علی رضایی', phone: '09120000001', plate: '۱۲ ب ۳۴۵ - ۶۷', car: 'پژو ۲۰۶ سفید' },
    { name: 'مریم احمدی', phone: '09120000002', plate: '۴۵ ج ۶۷۸ - ۱۱', car: 'دنا پلاس مشکی' },
    { name: 'حسین کریمی', phone: '09120000003', plate: '۷۸ د ۱۲۳ - ۲۲', car: 'سمند نقره‌ای' },
    { name: 'زهرا موسوی', phone: '09120000004', plate: '۳۳ س ۹۰۱ - ۴۴', car: 'کوییک R' },
    { name: 'رضا نادری', phone: '09120000005', plate: '۶۱ ط ۵۵۲ - ۱۰', car: 'تارا اتوماتیک' },
  ],
  th: [
    { name: 'สมชาย ใจดี', phone: '0810000001', plate: '1กข 2345', car: 'Toyota Yaris สีขาว' },
    { name: 'สุดา แก้วใส', phone: '0810000002', plate: '2ขค 6781', car: 'Honda City สีดำ' },
    { name: 'อนันต์ ศรีสุข', phone: '0810000003', plate: '3คง 1232', car: 'Isuzu D-Max สีเงิน' },
    { name: 'มาลี ทองดี', phone: '0810000004', plate: '4งจ 9014', car: 'Mazda 2 สีแดง' },
    { name: 'วิชัย บุญมา', phone: '0810000005', plate: '5จฉ 5520', car: 'Toyota Fortuner' },
  ],
  en: [
    { name: 'Alex Morgan', phone: '0810000001', plate: '1AB 2345', car: 'White Toyota Yaris' },
    { name: 'Dana Whitfield', phone: '0810000002', plate: '2CD 6781', car: 'Black Honda City' },
    { name: 'Jordan Ellis', phone: '0810000003', plate: '3EF 1232', car: 'Silver Isuzu D-Max' },
    { name: 'Priya Nair', phone: '0810000004', plate: '4GH 9014', car: 'Red Mazda 2' },
    { name: 'Sam Carter', phone: '0810000005', plate: '5JK 5520', car: 'Toyota Fortuner' },
  ],
};
const FILES = {
  fa: { policy: 'بیمه‌نامه ثالث', card: 'کارت ماشین', lic: 'گواهینامه', pay: 'فیش قسط اول', claim: 'کروکی خسارت', body: 'بیمه‌نامه بدنه' },
  th: { policy: 'กรมธรรม์ พ.ร.บ.', card: 'เล่มทะเบียนรถ', lic: 'ใบขับขี่', pay: 'ใบเสร็จงวดแรก', claim: 'รูปเคลมอุบัติเหตุ', body: 'กรมธรรม์ประกันชั้น 1' },
  en: { policy: 'Compulsory insurance policy', card: 'Vehicle registration', lic: 'Driving licence', pay: 'First instalment receipt', claim: 'Accident claim sketch', body: 'Comprehensive policy' },
};
const PLAN = [{ d: 150, exp: 12 }, { d: 110, exp: -6 }, { d: 70, exp: 210 }, { d: 26, exp: 27 }, { d: 9, exp: 330 }];

/**
 * Fictional sample data, in the app's current language (v4): customer 1 has 3 vehicles in 2 months, customers 3-5
 * have one vehicle each; customer 2 is a customer from before v4 (single plate in the customer details, files in the
 * old folders) to try "Move to new folders".
 */
export async function seedDemo(store, lang = 'en') {
  const N = FILES[lang] || FILES.en;
  for (const [i, person] of (PEOPLE[lang] || PEOPLE.en).entries()) {
    const p = { ...person, ...PLAN[i] };
    if (i === 1) { await seedOld(store, p, N, i); continue; }
    const c = await store.saveCustomer({ name: p.name, phone: p.phone, nick: i === 0 ? 'k.demo' : '', createdAt: ago(p.d), demo: true });
    const start = inDays(p.exp - 365);
    const v = await store.saveVehicle({ customerId: c.id, plate: p.plate, model: p.car, insurer: 'Demo Insurance', policyNo: `DEMO-${1000 + i}`, policyType: 'ชั้น 1', contractDate: start, policyStart: start, policyExpiry: inDays(p.exp), premium: String(15000 + i * 1200) });
    const nm = (veh, slot, ext) => vehicleFileName({ vehicle: veh, customer: c, slot, ext });
    const put = (veh, slot, blob, meta) => store.addFile(blob, { customerId: c.id, vehicleId: veh.id, slot, note: '', expiry: '', demo: true, name: nm(veh, slot, meta.ext), ...meta, ext: undefined });
    await put(v, '1', tinyPdf('Car insurance policy'), { ext: '.pdf', type: 'policy', expiry: inDays(p.exp), createdAt: ago(p.d - 1) });
    await put(v, '3', tinyPdf('Compulsory insurance'), { ext: '.pdf', type: 'policy', expiry: inDays(p.exp), createdAt: ago(p.d - 1) });
    const card = picture('Vehicle registration', 250 + i * 22);
    await put(v, '5.1', card.blob, { ext: '.svg', type: 'car', thumb: card.thumb, createdAt: ago(p.d - 2) });
    const photo = picture('Car photo', 190 + i * 30);
    await put(v, '5.3', photo.blob, { ext: '.svg', type: 'car', thumb: photo.thumb, createdAt: ago(Math.max(0, p.d - 20)) });
    if (i % 2 === 0) await put(v, '5.4', tinyPdf('Transfer slip'), { ext: '.pdf', type: 'payment', createdAt: ago(Math.max(0, p.d - 45)) });
    if (i === 0) {
      // two more vehicles: one in the same month, one in another month
      const v2 = await store.saveVehicle({ customerId: c.id, ym: v.ym, plate: p.plate.replace(/\d$/, d => String((+d + 1) % 10)), model: p.car, insurer: 'Demo Insurance', policyStart: start, policyExpiry: inDays(p.exp) });
      await put(v2, '1', tinyPdf('Car insurance policy'), { ext: '.pdf', type: 'policy', expiry: inDays(p.exp), createdAt: ago(5) });
      const start3 = inDays(140 - 365);
      const v3 = await store.saveVehicle({ customerId: c.id, plate: p.plate.replace(/\d$/, d => String((+d + 2) % 10)), model: 'Isuzu D-Max', insurer: 'Demo Insurance', contractDate: start3, policyStart: start3, policyExpiry: inDays(140) });
      await put(v3, '1', tinyPdf('Car insurance policy'), { ext: '.pdf', type: 'policy', expiry: inDays(140), createdAt: ago(3) });
      const ph = picture('Car photo', 30);
      await put(v3, '5.3', ph.blob, { ext: '.svg', type: 'car', thumb: ph.thumb, createdAt: ago(3) });
    }
  }
}
/** A customer as saved before v4: plate and policy in the customer details, files in the old 4 folders / loose */
async function seedOld(store, p, N, i) {
  const c = await store.saveCustomer({ name: p.name, phone: p.phone, plate: p.plate, car: p.car, insurer: 'Demo Insurance', policyStart: inDays(p.exp - 365), policyExpiry: inDays(p.exp), createdAt: ago(p.d), demo: true });
  const add = (blob, meta) => store.addFile(blob, { customerId: c.id, note: '', expiry: '', demo: true, ...meta });
  await add(tinyPdf('Compulsory insurance policy'), { name: `${N.policy} ${p.name}.pdf`, folder: 'policy', type: 'policy', expiry: inDays(p.exp), createdAt: ago(p.d - 1) });
  const card = picture('Vehicle registration', 250 + i * 22);
  await add(card.blob, { name: `${N.card}.svg`, folder: 'docs', type: 'car', thumb: card.thumb, createdAt: ago(p.d - 2) });
  const lic = picture('Driving licence', 190 + i * 30);
  await add(lic.blob, { name: `${N.lic}.svg`, type: 'id', thumb: lic.thumb, createdAt: ago(Math.max(0, p.d - 20)) });
  await add(tinyPdf('Payment receipt'), { name: `${N.pay}.pdf`, folder: 'pay', type: 'payment', createdAt: ago(Math.max(0, p.d - 45)) });
}
