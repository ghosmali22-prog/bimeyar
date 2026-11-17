// Invoice maths and the on-screen / print layout.
// calcTotals is an exact copy of invoiceTotals() in backend/Code.gs (tests/invoice-totals.test.mjs checks both).
// The backend recomputes everything; the saved and printed numbers always come from the backend.
import { VAT_RATE } from './config.js';
import { money } from './validate.js';

/** Satang (integer) maths: no floating point errors. Throws on negative or invalid numbers. */
function satang(v) {
  const n = Number(String(v == null ? '' : v).replace(/[,\s฿]/g, ''));
  if (!isFinite(n)) throw Object.assign(new Error('inv.badAmount'), { key: 'inv.badAmount' });
  if (n < 0) throw Object.assign(new Error('inv.negative'), { key: 'inv.negative' });
  return Math.round(n * 100);
}

/** items: [{ q, p }]; returns numbers in baht (2 decimals) and the payment status */
export function calcTotals(items, discount, vat, paid) {
  let sub = 0;
  items.forEach(it => { sub += Math.round(it.q * satang(it.p)); });
  const disc = satang(discount);
  if (disc > sub) throw Object.assign(new Error('inv.discTooBig'), { key: 'inv.discTooBig' });
  const net = sub - disc;
  const v = vat ? Math.round(net * VAT_RATE / 100) : 0;
  const total = net + v;
  const pd = satang(paid);
  if (pd > total) throw Object.assign(new Error('inv.paidTooBig'), { key: 'inv.paidTooBig' });
  const status = pd === 0 ? (total === 0 ? 'paid' : 'unpaid') : pd >= total ? 'paid' : 'partial';
  const b = n => n / 100;
  return { sub: b(sub), disc: b(disc), net: b(net), vat: b(v), total: b(total), paid: b(pd), bal: b(total - pd), status };
}

export const lineAmount = it => Math.round(it.q * Math.round((money(it.p) || 0) * 100)) / 100;

/** ฿1,234.00 */
export function baht(n) {
  const neg = n < 0, s = Math.abs(Math.round((+n || 0) * 100) / 100).toFixed(2).split('.');
  return (neg ? '-' : '') + '฿' + s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + s[1];
}

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
const lbl = (k, lang) => lang === 'th' ? L[k][0] : lang === 'en' ? L[k][1] : L[k][0] + ' / ' + L[k][1];
const e = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dmy = (iso, fmt) => { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return `${d}/${m}/${fmt === 'be' ? +y + 543 : y}`; };
const lines = s => e(s).replace(/\n/g, '<br>');

/**
 * A4 invoice as HTML. Used for the live preview and, in "this device" mode, for printing to PDF.
 * In cloud mode the real PDF is built by the backend (Google Docs, Sarabun font) with the same layout.
 */
export function invoiceHtml(inv, co, dateFmt = 'ce') {
  const lang = inv.lang || 'both', T = inv.t, v = inv.veh || {}, p = inv.pol || {};
  const st = inv.status === 'paid' ? 'paidS' : inv.status;
  const veh = [[v.brand, v.model].filter(Boolean).join(' '), v.plate ? `${lbl('plate', lang)} ${v.plate}${v.province ? ' ' + v.province : ''}` : ''].filter(Boolean).join(' · ');
  const pol = [p.type ? `${lbl('ptype', lang)} ${p.type}` : '', p.insurer ? `${lbl('insurer', lang)} ${p.insurer}` : '', p.no ? `${lbl('pno', lang)} ${p.no}` : ''].filter(Boolean).join(' · ');
  const per = p.start || p.end ? `${dmy(p.start, dateFmt)} – ${dmy(p.end, dateFmt)}` : '';
  return `<div class="inv-page">
    <div class="inv-head">
      <div class="inv-logo">${co.logo ? `<img src="${e(co.logo)}" alt="">` : `<b>${e(co.name || 'RICH INSURANS')}</b>`}</div>
      <div class="inv-co"><b>${e(co.name || 'RICH INSURANS')}</b>${co.nameEn ? `<span>${e(co.nameEn)}</span>` : ''}${co.address ? `<span>${lines(co.address)}</span>` : ''}
        ${co.phone || co.email ? `<span>${[co.phone ? `${lbl('tel', lang === 'both' ? 'en' : lang)} ${e(co.phone)}` : '', e(co.email)].filter(Boolean).join(' · ')}</span>` : ''}
        ${co.taxId ? `<span>${lbl('tax', lang)} ${e(co.taxId)}</span>` : ''}</div>
    </div>
    <h1 class="inv-title">${lbl('title', lang)}</h1>
    <div class="inv-status inv-st-${e(inv.status)}">${lbl(st, lang)}</div>
    <div class="inv-info">
      <div><small>${lbl('billTo', lang)}</small><b>${e(inv.cust?.name)}</b>${inv.cust?.phone ? `<span>${e(inv.cust.phone)}</span>` : ''}${inv.cust?.address ? `<span>${lines(inv.cust.address)}</span>` : ''}</div>
      <div class="r"><b>${lbl('no', lang)}: ${e(inv.no || '—')}</b><span>${lbl('issue', lang)}: ${dmy(inv.issue, dateFmt)}</span>${inv.due ? `<span>${lbl('due', lang)}: ${dmy(inv.due, dateFmt)}</span>` : ''}</div>
    </div>
    ${veh || pol || per ? `<div class="inv-box">${veh ? `<div>${lbl('vehicle', lang)}: ${e(veh)}</div>` : ''}${pol ? `<div>${lbl('policy', lang)}: ${e(pol)}</div>` : ''}${per ? `<div>${lbl('period', lang)}: ${per}</div>` : ''}</div>` : ''}
    <table class="inv-items"><thead><tr><th>#</th><th>${lbl('desc', lang)}</th><th class="n">${lbl('qty', lang)}</th><th class="n">${lbl('price', lang)}</th><th class="n">${lbl('amount', lang)}</th></tr></thead>
      <tbody>${inv.items.map((it, i) => `<tr><td>${i + 1}</td><td>${e(it.d)}</td><td class="n">${e(it.q)}</td><td class="n">${baht(money(it.p) || 0)}</td><td class="n">${baht(lineAmount(it))}</td></tr>`).join('')}</tbody></table>
    ${T ? `<table class="inv-tot">
      <tr><td>${lbl('sub', lang)}</td><td>${baht(T.sub)}</td></tr>
      ${T.disc ? `<tr><td>${lbl('disc', lang)}</td><td>-${baht(T.disc)}</td></tr>` : ''}
      ${inv.vat ? `<tr><td>${lbl('vat', lang)}</td><td>${baht(T.vat)}</td></tr>` : ''}
      <tr class="total"><td>${lbl('total', lang)}</td><td>${baht(T.total)}</td></tr>
      ${T.paid ? `<tr><td>${lbl('paid', lang)}</td><td>${baht(T.paid)}</td></tr><tr class="bal"><td>${lbl('bal', lang)}</td><td>${baht(T.bal)}</td></tr>` : ''}
    </table>` : ''}
    ${inv.notes ? `<div class="inv-sec"><small>${lbl('notes', lang)}</small><p>${lines(inv.notes)}</p></div>` : ''}
    ${co.bank ? `<div class="inv-sec"><small>${lbl('pay', lang)}</small><p>${lines(co.bank)}</p></div>` : ''}
    ${co.footer ? `<p class="inv-foot">${lines(co.footer)}</p>` : ''}
  </div>`;
}

/** Print styles for "this device" mode (browser Print -> Save as PDF) */
export const INVOICE_CSS = `
@page { size: A4; margin: 14mm 16mm; }
.inv-page { font-family: Sarabun, "Noto Sans Thai", sans-serif; color: #1f2430; font-size: 10pt; line-height: 1.45; background: #fff; }
.inv-head { display: flex; justify-content: space-between; gap: 16px; }
.inv-logo img { max-width: 150px; max-height: 60px; object-fit: contain; }
.inv-logo b { font-size: 16pt; color: #2f5bea; }
.inv-co { text-align: right; display: flex; flex-direction: column; font-size: 9pt; color: #6b7280; }
.inv-co b { font-size: 12pt; color: #1f2430; }
.inv-title { font-size: 20pt; color: #2f5bea; margin: 18px 0 0; }
.inv-status { font-size: 9pt; font-weight: 700; margin-bottom: 10px; }
.inv-st-paid { color: #15803d; } .inv-st-partial { color: #b45309; } .inv-st-unpaid { color: #b91c1c; }
.inv-info { display: flex; justify-content: space-between; gap: 16px; }
.inv-info > div { display: flex; flex-direction: column; } .inv-info .r { text-align: right; }
.inv-info small, .inv-sec small { font-size: 8pt; font-weight: 700; color: #6b7280; }
.inv-box { background: #f3f5f9; border-radius: 6px; padding: 8px 10px; margin: 12px 0; }
.inv-items { width: 100%; border-collapse: collapse; margin-top: 10px; }
.inv-items th { background: #f3f5f9; color: #6b7280; font-size: 8.5pt; text-align: left; }
.inv-items th, .inv-items td { border: .5pt solid #e5e7eb; padding: 5px 6px; vertical-align: top; }
.inv-items tr { page-break-inside: avoid; }
.inv-items thead { display: table-header-group; }
.inv-items .n { text-align: right; white-space: nowrap; }
.inv-tot { margin: 8px 0 0 auto; border-collapse: collapse; min-width: 260px; page-break-inside: avoid; }
.inv-tot td { padding: 3px 6px; text-align: right; color: #6b7280; } .inv-tot td:last-child { color: #1f2430; white-space: nowrap; }
.inv-tot .total td { background: #f3f5f9; font-weight: 700; font-size: 11pt; color: #1f2430; padding: 7px 6px; } .inv-tot .total td:last-child { color: #2f5bea; font-size: 12pt; }
.inv-tot .bal td { font-weight: 700; color: #1f2430; }
.inv-sec { margin-top: 12px; page-break-inside: avoid; } .inv-sec p { margin: 0; }
.inv-foot { margin-top: 20px; text-align: center; font-size: 8.5pt; color: #6b7280; }
`;
