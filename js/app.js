import { APP_VERSION, API_URL, MAX_UPLOAD_MB, FOLDERS } from './config.js';
import { t, num, lang, setLang, applyDir, LANGS } from './i18n.js';
import { $, $$, esc, digits, norm, fmtDay, dateFmt, setDateFmt, todayIso, addDays, monthKey, monthName, daysLeft, fmtSize, TYPES, typeLabel, isImage, isPdf, icon, hue, makeThumb, compressImage } from './util.js';
import { LocalStore } from './store-local.js';
import { ApiStore } from './store-remote.js';
import * as auth from './auth.js';
import { ask } from './assistant.js';
import { seedDemo } from './demo.js';
import { calcTotals, baht, lineAmount, invoiceHtml, INVOICE_CSS } from './invoice.js';
import { prepare, normalize, suggestFolder, diff, fileNote, FIELD_GROUPS, ALL_FIELDS, DATE_FIELDS } from './ai.js';
import { checkCustomer, findDuplicates, thaiPhone, money, latinDigits } from './validate.js';

/*
 * Layout = the v2 design (dashboard with stat cards, dark customer panel with the purple case file,
 * Files, Renewals). v3 features live inside it: policy status, 4 Drive folders, invoices, AI.
 */

const cloudReady = () => auth.configured() && !!API_URL;
let savedMode = null;
try { savedMode = localStorage.getItem('by_mode'); } catch { }

const S = {
  view: 'dash', customers: [], files: [], invoices: [], exp: {}, company: null, sel: null, store: null,
  gate: null,            // null | 'loading' | 'signin' | 'expired' | 'deny' | 'config' | 'gis'
  denied: '', role: 'admin', me: null,
  mode: savedMode === 'local' || !cloudReady() ? 'local' : 'cloud',
  filters: { customer: '', type: '', period: '', q: '', status: '', inv: '' },
  folderTab: '', mobileDetail: false,
};
const cust = id => S.customers.find(c => c.id === id);
const narrow = () => matchMedia('(max-width: 820px)').matches;
const sortCustomers = () => S.customers.sort((a, b) => a.name.localeCompare(b.name, lang));
const canEdit = () => S.role === 'admin' || S.role === 'editor';
const isAdmin = () => S.role === 'admin';
const setMode = m => { S.mode = m; try { localStorage.setItem('by_mode', m); } catch { } };
const aiOn = () => !!S.store?.aiReady && canEdit();
const initial = s => (String(s || '').trim()[0] || '?').toUpperCase();
const FOLDER = Object.fromEntries(FOLDERS.map(f => [f.slot, f]));
const dfmt = () => dateFmt() === 'be' ? 'be' : 'ce';

const PROVINCES = 'กรุงเทพมหานคร กระบี่ กาญจนบุรี กาฬสินธุ์ กำแพงเพชร ขอนแก่น จันทบุรี ฉะเชิงเทรา ชลบุรี ชัยนาท ชัยภูมิ ชุมพร เชียงราย เชียงใหม่ ตรัง ตราด ตาก นครนายก นครปฐม นครพนม นครราชสีมา นครศรีธรรมราช นครสวรรค์ นนทบุรี นราธิวาส น่าน บึงกาฬ บุรีรัมย์ ปทุมธานี ประจวบคีรีขันธ์ ปราจีนบุรี ปัตตานี พระนครศรีอยุธยา พะเยา พังงา พัทลุง พิจิตร พิษณุโลก เพชรบุรี เพชรบูรณ์ แพร่ ภูเก็ต มหาสารคาม มุกดาหาร แม่ฮ่องสอน ยโสธร ยะลา ร้อยเอ็ด ระนอง ระยอง ราชบุรี ลพบุรี ลำปาง ลำพูน เลย ศรีสะเกษ สกลนคร สงขลา สตูล สมุทรปราการ สมุทรสงคราม สมุทรสาคร สระแก้ว สระบุรี สิงห์บุรี สุโขทัย สุพรรณบุรี สุราษฎร์ธานี สุรินทร์ หนองคาย หนองบัวลำภู อ่างทอง อำนาจเจริญ อุดรธานี อุตรดิตถ์ อุทัยธานี อุบลราชธานี'.split(' ');
const POLICY_TYPES = ['ชั้น 1', 'ชั้น 2+', 'ชั้น 2', 'ชั้น 3+', 'ชั้น 3', 'พ.ร.บ.'];

/* ================= connect & load ================= */
async function connect() {
  S.store = null; S.gate = null;
  if (S.mode === 'local') {
    const l = new LocalStore();
    await l.init();
    S.store = l; S.role = 'admin'; S.me = null;
    applyRole();
    return reload(true);
  }
  if (!cloudReady()) return showGate('config');
  showGate('loading');
  let has;
  try { has = await auth.init(lang); }
  catch { return showGate('gis'); }
  if (has) return enterCloud();
  showGate('signin');
  auth.getToken().then(tok => { if (tok && S.gate === 'signin') enterCloud(); });   // One Tap / silent sign-in
}

let entering = false;
async function enterCloud() {
  if (entering) return;
  entering = true;
  try {
    showGate('loading');
    const st = new ApiStore();
    const me = await st.init();
    S.store = st; S.me = me; S.role = me.role; S.sel = null;
    applyRole();
    await reload(true);
  } catch (e) {
    handleError(e);
  } finally { entering = false; }
}

auth.onSignIn(() => { if (S.mode === 'cloud' && S.gate && S.gate !== 'loading') enterCloud(); });

function showGate(g, email = '') {
  S.gate = g; S.denied = email || S.denied;
  closeSheet(); mount();
}

async function reload(remount = false) {
  const { customers, files, invoices } = await S.store.loadAll();
  S.customers = customers; sortCustomers();
  S.files = files.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  S.invoices = (invoices || []).sort((a, b) => String(b.no).localeCompare(String(a.no)));
  S.gate = null;
  computeStatus();
  if (!cust(S.sel)) S.sel = S.customers[0]?.id || null;
  if (S.filters.customer && !cust(S.filters.customer)) S.filters.customer = '';
  S.quota = await S.store.quota().catch(() => null);
  if (!S.company) S.store.getSettings().then(c => { S.company = c; }).catch(() => { });
  if (remount) mount(); else drawAll(false);
}

function applyRole() {
  document.body.classList.toggle('ro', !canEdit());
  document.body.classList.toggle('adm', isAdmin() && S.mode === 'cloud');
}

const ERR = { network: 'err.network', offline: 'err.offline', timeout: 'err.timeout', role: 'err.role', not_found: 'err.not_found', server: 'err.server', too_big: 'err.tooBig' };
function handleError(e) {
  console.error(e);
  const code = e?.code;
  if (code === 'auth' || e?.auth) { auth.drop(); return showGate('expired'); }
  if (code === 'forbidden') { S.store = null; return showGate('deny', e.email || auth.user()?.email || ''); }
  toast(e?.key ? t(e.key) : ERR[code] ? t(ERR[code]) : e?.message || t('err.generic'), 'err');
  if (code === 'not_found' && S.store) reload().catch(() => { });
  if (!S.store && S.mode === 'cloud' && S.gate === 'loading') showGate('signin');
}

async function run(fn) {
  try { await fn(); } catch (e) { handleError(e); }
}

/* ================= policy status ================= */
/** Expiry = the customer's policyExpiry; for v2 customers without it, the latest expiry of a policy file. */
function computeStatus() {
  const legacy = {};
  for (const f of S.files) if (f.expiry && f.type === 'policy' && f.folder !== 'prev' && !f.invoice && (!legacy[f.customerId] || f.expiry > legacy[f.customerId])) legacy[f.customerId] = f.expiry;
  S.exp = {};
  for (const c of S.customers) {
    const exp = c.policyExpiry || legacy[c.id] || '';
    const d = exp ? daysLeft(exp) : null;
    S.exp[c.id] = { exp, legacy: !c.policyExpiry && !!exp, d, st: !exp ? 'none' : d < 0 ? 'expired' : d <= 30 ? 'soon' : 'active' };
  }
}
const ST_CLS = { expired: 'bad', soon: 'warn', active: 'ok', none: 'none' };
const INV_CLS = { unpaid: 'bad', partial: 'warn', paid: 'ok' };
const daysText = d => d < 0 ? t('e.past', { n: -d }) : d === 0 ? t('e.today') : t('e.left', { n: d });
const stPill = st => `<em class="pill st ${ST_CLS[st]}">${t('st.' + st)}</em>`;
const invPill = s => `<em class="pill st ${INV_CLS[s] || ''}">${t('is.' + s)}</em>`;

/* ================= filters ================= */
const FKEYS = { dash: ['customer', 'status', 'q'], files: ['customer', 'type', 'period', 'q'], exp: ['customer', 'q'], inv: ['customer', 'inv', 'q'] };
function matchFile(f, { skipCustomer = false, skipType = false } = {}) {
  const F = S.filters;
  if (!skipCustomer && F.customer && f.customerId !== F.customer) return false;
  if (!skipType && F.type && f.type !== F.type) return false;
  if (F.period && Date.now() - new Date(f.createdAt) > F.period * 864e5) return false;
  if (F.q) {
    const c = cust(f.customerId) || {};
    if (!norm(`${f.name} ${f.note || ''} ${c.name || ''} ${c.plate || ''} ${c.phone || ''} ${c.car || ''}`).includes(norm(F.q))) return false;
  }
  return true;
}
function custMatch(c, q) {
  if (!q) return true;
  const qd = latinDigits(q).replace(/[\s-]/g, '');
  const h = norm(`${c.name} ${c.nameEn || ''} ${c.plate || ''} ${c.province || ''} ${c.brand || ''} ${c.model || ''} ${c.car || ''} ${c.policyNo || ''} ${c.insurer || ''}`);
  if (h.includes(norm(q))) return true;
  if (qd.length >= 3 && /^\+?\d+$/.test(qd)) {
    const p = (c.phone || '').replace(/\D/g, ''), id = (c.idNo || '').replace(/\D/g, '');
    if (p.includes(qd.replace(/^\+?66/, '0')) || id.includes(qd)) return true;
  }
  return qd.length >= 2 && latinDigits(c.plate || '').replace(/[\s-]/g, '').toLowerCase().includes(qd.toLowerCase());
}
const activeFilters = () => (FKEYS[S.view] || []).filter(k => S.filters[k]).length;
const noFilters = () => ({ customer: '', type: '', period: '', q: '', status: '', inv: '' });

/* ================= views ================= */
const titleRow = (k, actions = '', sub = '') => `<section class="title-row"><div><h1>${t(k + '.title')}</h1><p>${sub || t(k + '.sub')}</p></div>${actions ? `<div class="title-actions" data-need="edit">${actions}</div>` : ''}</section>`;
const addBtn = () => `<button class="btn primary" data-act="upload">${icon('plus')}<span>${t('btn.addFile')}</span></button>`;
const VIEWS = {
  dash: () => `${titleRow('dash', `<button class="btn ghost" data-act="ai-new">${icon('wand')}<span>${t('add.ai')}</span></button><button class="btn ghost" data-act="new-customer">${icon('userplus')}<span>${t('btn.newCustomer')}</span></button>${addBtn()}`)}
    <section class="stats" id="stats"></section>
    <section class="filters" id="filters"></section>
    <section class="panel" id="panel"></section>`,
  files: () => `${titleRow('files', `<button class="btn ghost" data-act="camera">${icon('camera')}<span>${t('btn.camera')}</span></button>${addBtn()}`)}
    <section class="filters" id="filters"></section>
    <section class="grid" id="grid"></section>`,
  exp: () => `${titleRow('exp', '', t('ex.sub'))}
    <section class="filters" id="filters"></section>
    <section class="explist" id="explist"></section>`,
  inv: () => {
    const due = S.invoices.filter(i => i.status !== 'paid').reduce((a, i) => a + (i.t?.bal || 0), 0);
    return `<section class="title-row"><div><h1>${t('inv.title')}</h1><p>${S.invoices.length ? t('inv.outstanding', { x: `<b>${baht(due)}</b>` }) : t('inv.noneText')}</p></div>
      <div class="title-actions" data-need="edit"><button class="btn primary" data-act="new-invoice">${icon('plus')}<span>${t('inv.create')}</span></button></div></section>
    <section class="filters" id="filters"></section>
    <section class="explist" id="invlist"></section>`;
  },
};

let enterT;
function mount() {
  const v = $('#view');
  v.innerHTML = S.gate ? gateHtml() : VIEWS[S.view]();
  v.className = 'enter';
  document.body.classList.toggle('gated', !!S.gate);
  if (S.gate === 'signin' || S.gate === 'expired') auth.button($('#gbtn'), lang).catch(() => { });
  if (!S.gate) drawAll(true);
  syncChrome();
  clearTimeout(enterT);
  enterT = setTimeout(() => v.classList.remove('enter'), 1700);
}
function drawAll(anim) {
  if (S.gate || !S.store) return;
  drawStats(anim); drawFilters(true); drawResults(anim);
  syncChrome();
}
function drawResults(anim) {
  if (S.view === 'dash') drawPanel(anim);
  if (S.view === 'files') drawGrid();
  if (S.view === 'exp') drawExp();
  if (S.view === 'inv') drawInv();
  loadThumbs();
}

function applyStatic() {
  applyDir();
  document.title = t('brand');
  for (const el of $$('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of $$('[data-i18n-title]')) { el.title = t(el.dataset.i18nTitle); el.setAttribute('aria-label', el.title); }
  $('#langSel').value = lang;
}
function syncChrome() {
  for (const b of $$('[data-view]')) b.classList.toggle('on', b.dataset.view === S.view);
  const on = $('#nav button.on'), ind = $('#nav .nav-ind');
  if (on) { ind.style.width = on.offsetWidth + 'px'; ind.style.transform = `translateX(${on.offsetLeft}px)`; }
  const cloud = S.mode === 'cloud';
  $('#storeLbl').textContent = cloud ? (S.gate || !S.me ? t('store.off') : S.me.email.split('@')[0]) : t('store.local');
  $('#storeDot').className = 'dot ' + (cloud ? (S.gate ? 'warn' : 'ok') : '');
}

function gateHtml() {
  const g = S.gate;
  const demo = `<button class="btn ghost" data-act="mode-local">${t('gate.demo')}</button>`;
  if (g === 'loading') return `<section class="gate card"><div class="gate-ico">${icon('lock', 38)}</div><h1>${t('gate.loading')}</h1><div class="spin"></div></section>`;
  if (g === 'deny') return `<section class="gate card">
      <div class="gate-ico deny">${icon('lock', 38)}</div><h1>${t('deny.title')}</h1>
      <p>${t('deny.text', { x: `<b dir="ltr">${esc(S.denied)}</b>` })}</p>
      <div class="gate-actions"><button class="btn primary" data-act="retry">${t('deny.retry')}</button><button class="btn ghost" data-act="switch-account">${t('deny.switch')}</button></div>
      <div class="gate-foot">${demo}</div></section>`;
  if (g === 'config' || g === 'gis') return `<section class="gate card"><div class="gate-ico">${icon('cloud', 38)}</div><h1>${t('gate.title')}</h1><p>${t('gate.' + g)}</p>
      <div class="gate-actions">${g === 'gis' ? `<button class="btn primary" data-act="reload">${t('gate.retry')}</button>` : ''}${demo}</div></section>`;
  return `<section class="gate card">
      <div class="gate-ico">${icon('shield', 38)}</div>
      <h1>${t('gate.title')}</h1>
      <p>${t(g === 'expired' ? 'gate.expired' : 'gate.text')}</p>
      <div class="gbtn" id="gbtn"><div class="spin"></div></div>
      <div class="gate-foot">${demo}</div>
    </section>`;
}

/* ---------- stat cards ---------- */
function drawStats(anim) {
  const el = $('#stats'); if (!el) return;
  const withExp = S.customers.map(c => S.exp[c.id]).filter(m => m?.exp);
  const soon = withExp.filter(m => m.d <= 30).length;
  const expired = withExp.filter(m => m.d < 0).length;

  const k0 = monthKey(new Date());
  const months = Array.from({ length: 6 }, (_, i) => ({ k: k0 - 5 + i, n: 0 }));
  for (const f of S.files) { const k = monthKey(f.createdAt), b = months.find(x => x.k === k); if (b) b.n++; }
  const maxM = Math.max(1, ...months.map(m => m.n));
  const thisMonth = months[5].n;

  const now = Date.now();
  const pts = Array.from({ length: 8 }, (_, i) => S.customers.filter(c => new Date(c.createdAt) <= now - (7 - i) * 7 * 864e5).length);
  const maxP = Math.max(1, ...pts), minP = Math.min(...pts);
  const xy = pts.map((p, i) => [8 + i * (184 / 7), 60 - ((p - minP) / Math.max(1, maxP - minP)) * 46]);
  const line = xy.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const newC = S.customers.filter(c => now - new Date(c.createdAt) < 30 * 864e5).length;

  const bytes = S.files.reduce((a, f) => a + (f.size || 0), 0);
  const nPdf = S.files.filter(isPdf).length, nImg = S.files.filter(isImage).length, nOther = S.files.length - nPdf - nImg;
  const cloud = S.store.kind === 'cloud';
  const qLine = cloud && S.quota?.limit ? t('s4.quota', { a: fmtSize(S.quota.used), b: fmtSize(S.quota.limit) }) : t(cloud ? 's4.drive' : 's4.local');
  const big = n => `<b ${anim ? `data-count="${n}"` : ''}>${num(anim ? 0 : n)}</b>`;
  const root = S.me?.root;

  el.innerHTML = `
  <article class="card tilt c-exp" data-act="go" data-view="exp" style="--i:0">
    <header><span>${t('s1.title')}</span><i class="badge-ico ${soon ? 'warn' : 'ok'}">${icon(soon ? 'alert' : 'check', 15)}</i></header>
    <div class="big">${big(soon)}<small>${t('s1.unit')}</small></div>
    <p class="delta ${expired ? 'bad' : 'good'}">${expired ? t('s1.expired', { n: expired }) : t('s1.none')}</p>
    <div class="car-art" aria-hidden="true">
      <svg viewBox="0 0 204 96"><defs><linearGradient id="cg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a493ff"/><stop offset="1" stop-color="#5a3fe0"/></linearGradient><linearGradient id="wg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#d9d2ff" stop-opacity=".7"/></linearGradient></defs>
      <ellipse cx="102" cy="86" rx="86" ry="6" fill="#3a2a9a" opacity=".16"/>
      <path d="M10 62Q10 48 26 46L52 42Q70 20 96 20L128 20Q150 20 164 42L182 46Q194 49 194 62L194 66Q194 71 189 71L15 71Q10 71 10 66Z" fill="url(#cg)"/>
      <path d="M60 42Q74 27 96 27L107 27L107 42Z M114 27L128 27Q144 27 155 42L114 42Z" fill="url(#wg)"/>
      <path d="M14 56Q60 50 190 56" stroke="#fff" stroke-opacity=".35" stroke-width="2" fill="none"/>
      <g fill="#1b192c"><circle cx="54" cy="71" r="14"/><circle cx="150" cy="71" r="14"/></g><g fill="#cfc8ff"><circle cx="54" cy="71" r="6"/><circle cx="150" cy="71" r="6"/></g></svg>
    </div>
  </article>

  <article class="card tilt" data-act="go" data-view="files" style="--i:1">
    <header><span>${t('s2.title')}</span><i class="badge-ico">${icon('folder', 15)}</i></header>
    <div class="big">${big(S.files.length)}<small>${t('s2.unit')}</small></div>
    <p class="delta good">${thisMonth ? t('s2.month', { n: thisMonth, m: monthName(k0) }) : t('s2.none')}</p>
    <div class="bars">${months.map((m, i) => `<div><i class="${i === 5 ? 'now' : ''}" style="--h:${Math.max(7, (m.n / maxM) * 100)}%;--i:${i}" title="${num(m.n)}"></i><small>${monthName(m.k, true)}</small></div>`).join('')}</div>
  </article>

  <article class="card tilt" data-act="${canEdit() ? 'new-customer' : 'go'}" data-view="dash" style="--i:2">
    <header><span>${t('s3.title')}</span><i class="badge-ico">${icon('users', 15)}</i></header>
    <div class="big">${big(S.customers.length)}<small>${t('s3.unit')}</small></div>
    <p class="delta good">${newC ? t('s3.new', { n: newC }) : canEdit() ? t('s3.tap') : ''}</p>
    <svg class="spark" viewBox="0 0 200 70"><defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6a4df5" stop-opacity=".28"/><stop offset="1" stop-color="#6a4df5" stop-opacity="0"/></linearGradient></defs>
      <path class="area" d="${line} L192 70 L8 70 Z" fill="url(#sg)"/><path class="ln" d="${line}" pathLength="1"/>
      ${xy.map((p, i) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${i === 7 ? 4 : 2.6}" style="--i:${i}"/>`).join('')}</svg>
  </article>

  <article class="card tilt c-store" style="--i:3">
    <header><span>${t('s4.title')}</span>${root ? `<button class="mini-btn" data-act="open-root" title="${t('s4.openRoot')}">${icon('arrow', 16)}</button>` : `<button class="mini-btn" data-act="settings" title="${t('s4.storage')}">${icon('arrow', 16)}</button>`}</header>
    <div class="big"><b class="sz">${fmtSize(bytes)}</b></div>
    <p class="delta">${qLine}</p>
    <div class="kinds">
      <div><b>${num(nPdf)}</b><small>PDF</small></div>
      <div class="hi"><b>${num(nImg)}</b><small>${t('kind.photo')}</small></div>
      <div><b>${num(nOther)}</b><small>${t('kind.other')}</small></div>
      <button class="btn dark" data-act="add" data-need="edit">${t('btn.quick')}</button>
    </div>
  </article>`;
  if (anim) countUp(el);
}

function countUp(root) {
  const els = $$('[data-count]', root), t0 = performance.now(), D = 1100;
  const tick = now => {
    const p = Math.min(1, (now - t0) / D), e = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
    for (const el of els) el.textContent = num(Math.round(el.dataset.count * e));
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* ---------- filter row ---------- */
function drawFilters(force = false) {
  const el = $('#filters'); if (!el) return;
  if (!force && el.contains(document.activeElement) && document.activeElement.dataset.f === 'q') { $('.f-count', el).textContent = num(activeFilters()); return; }
  const F = S.filters, keys = FKEYS[S.view] || [], opt = (v, l, cur) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(l)}</option>`;
  el.innerHTML = `
    <div class="f-label">${t('f.active')} <b class="f-count">${num(activeFilters())}</b>${activeFilters() ? `<button class="link" data-act="clear-filters">${t('f.clear')}</button>` : ''}</div>
    <label class="f"><select data-f="customer" aria-label="${t('u.customer')}">${opt('', t('f.allCustomers'), F.customer)}${S.customers.map(c => opt(c.id, c.name, F.customer)).join('')}</select></label>
    ${keys.includes('status') ? `<label class="f"><select data-f="status" aria-label="${t('f.allStatus')}">${opt('', t('f.allStatus'), F.status)}${['active', 'soon', 'expired', 'none'].map(k => opt(k, t('st.' + k), F.status)).join('')}</select></label>` : ''}
    ${keys.includes('type') ? `<label class="f"><select data-f="type" aria-label="${t('fl.type')}">${opt('', t('f.allTypes'), F.type)}${Object.keys(TYPES).map(k => opt(k, typeLabel(k), F.type)).join('')}</select></label>` : ''}
    ${keys.includes('period') ? `<label class="f"><select data-f="period" aria-label="${t('f.allTime')}">${opt('', t('f.allTime'), F.period)}${[7, 30, 90, 365].map(d => opt(d, t('f.d' + d), F.period)).join('')}</select></label>` : ''}
    ${keys.includes('inv') ? `<label class="f"><select data-f="inv" aria-label="${t('is.all')}">${opt('', t('is.all'), F.inv)}${['unpaid', 'partial', 'paid'].map(k => opt(k, t('is.' + k), F.inv)).join('')}</select></label>` : ''}
    <label class="f grow search">${icon('search', 18)}<input data-f="q" type="search" enterkeyhint="search" placeholder="${S.view === 'inv' ? t('inv.search') : S.view === 'files' ? t('f.search') : t('c.search')}" value="${esc(F.q)}" autocomplete="off" autocorrect="off" spellcheck="false"></label>`;
}

/* ---------- dark panel: customers + case file ---------- */
function ftBadge(f, size = 26, cls = '') {
  if (f.invoice) return `<span class="ft inv ${cls}">${icon('invoice', size)}</span>`;
  return `<span class="ft ${cls} ${isPdf(f) ? 'pdf' : ''}">${isPdf(f) ? 'PDF' : icon(isImage(f) ? 'image' : (TYPES[f.type] || TYPES.other).icon, size)}</span>`;
}
const thumbImg = (src, ic) => `<img class="th" src="${esc(src)}" alt="" loading="lazy" decoding="async" data-ic="${ic}">`;
const folderName = f => FOLDER[f.folder] ? t('fo.' + f.folder) : t('fo.other');
function fileTile(f, i, light = false) {
  const ty = TYPES[f.type] || TYPES.other, c = light ? cust(f.customerId) : null;
  const left = f.expiry && !f.invoice ? daysLeft(f.expiry) : null;
  return `<button class="tile" data-act="open-file" data-id="${esc(f.id)}" style="--i:${Math.min(i, 14)}">
    <span class="thumb">${f.thumb ? thumbImg(f.thumb, ty.icon) : ftBadge(f)}
      ${left !== null && left <= 30 ? `<em class="flag ${left < 0 ? 'bad' : 'warn'}">${left < 0 ? t('flag.expired') : t('flag.days', { n: left })}</em>` : ''}${f.invoice ? `<em class="inv-flag">${t('q.invoice')}</em>` : ''}</span>
    <b>${esc(f.name)}</b>
    <small>${c ? esc(c.name) + ' · ' : ''}${light ? folderName(f) : typeLabel(f.type)} · ${fmtDay(f.createdAt)}</small>
  </button>`;
}

// Thumbnails come from the backend (files are private), a batch at a time for what's on screen
let thumbBusy = false;
async function loadThumbs() {
  if (thumbBusy || S.store?.kind !== 'cloud') return;
  const ids = $$('.tile[data-id]').map(el => el.dataset.id).filter(id => { const f = S.files.find(x => x.id === id); return f && !f.thumb && (isImage(f) || isPdf(f)) && !S.store.thumbCache.has(id); });
  if (!ids.length) return;
  thumbBusy = true;
  try {
    const got = await S.store.thumbs(ids);
    for (const [id, url] of Object.entries(got)) {
      const f = S.files.find(x => x.id === id); if (f) f.thumb = url;
      for (const tb of $$(`.tile[data-id="${CSS.escape(id)}"] .thumb`)) {
        const old = tb.querySelector('.ft'); if (!old) continue;
        old.outerHTML = thumbImg(url, (TYPES[f?.type] || TYPES.other).icon);
        tb.querySelector('img').classList.add('fadein');
      }
    }
  } catch (e) { if (e.code === 'auth' || e.code === 'forbidden') handleError(e); }
  finally { thumbBusy = false; }
  setTimeout(loadThumbs, 50);   // next batch, if any are left
}

function infoRows(c, keys) {
  return keys.map(k => {
    let v = c[k];
    if (!v) return '';
    if (DATE_FIELDS.has(k)) v = fmtDay(v);
    if (k === 'coverage' || k === 'premium') v = baht(+v);
    const val = k === 'phone' ? `<a href="tel:${esc(c.phone)}" dir="ltr">${esc(v)}</a>` : `<span${['idNo', 'vin', 'engineNo', 'policyNo'].includes(k) ? ' dir="ltr"' : ''}>${esc(v)}</span>`;
    return `<div class="irow"><small>${t('cf.' + k)}</small>${val}</div>`;
  }).join('');
}

function drawPanel(anim) {
  const el = $('#panel'); if (!el) return;
  if (!S.customers.length) {
    el.innerHTML = `<div class="empty dark">
      <div class="gate-ico">${icon('users', 34)}</div><h3>${t('p.empty.title')}</h3>
      <p>${canEdit() ? t('p.empty.text') : ''}</p>
      <div class="gate-actions" data-need="edit"><button class="btn white" data-act="new-customer">${icon('userplus')}<span>${t('p.empty.first')}</span></button>
      <button class="btn glassy" data-act="ai-new">${icon('wand')}<span>${t('add.ai')}</span></button>
      ${S.store.kind === 'local' ? `<button class="btn glassy" data-act="seed">${t('p.empty.demo')}</button>` : ''}</div></div>`;
    return;
  }
  const F = S.filters, q = F.q.trim();
  const list = S.customers.filter(c => (!F.status || S.exp[c.id]?.st === F.status)
    && (!q || custMatch(c, q) || S.files.some(f => f.customerId === c.id && matchFile(f, { skipCustomer: true, skipType: true }))));
  if (list.length && !list.some(c => c.id === S.sel)) S.sel = list[0].id;
  const c = list.length ? cust(S.sel) : null;
  const mine = c ? S.files.filter(f => f.customerId === c.id) : [];
  const counts = { '': mine.length, other: mine.filter(f => !FOLDER[f.folder]).length };
  for (const F2 of FOLDERS) counts[F2.slot] = mine.filter(f => f.folder === F2.slot).length;
  if (S.folderTab === 'other' && !counts.other) S.folderTab = '';
  const tabs = [['', t('p.all')], ...FOLDERS.map(F2 => [F2.slot, t('fo.' + F2.slot)]), ...(counts.other ? [['other', 'ไม่ระบุ']] : [])];

  el.innerHTML = `
  <header class="panel-head">
    <h3>${t('p.customers')} <span>${num(list.length)}</span></h3>
    <div class="tabs">${tabs.map(([k, l]) => `<button class="${S.folderTab === k ? 'on' : ''}" data-act="tab" data-folder="${k}">${l}<i>${num(counts[k] || 0)}</i></button>`).join('')}</div>
    <button class="icon-btn onDark" data-act="new-customer" data-need="edit" title="${t('btn.newCustomer')}">${icon('userplus', 18)}</button>
  </header>
  <div class="panel-body ${S.mobileDetail ? 'show-detail' : ''}">
    <ul class="clist">${list.map((x, i) => {
      const n = S.files.filter(f => f.customerId === x.id).length, m = S.exp[x.id] || { st: 'none' };
      const pill = m.st === 'expired' ? `<em class="pill bad">${t('st.expired')}</em>` : m.st === 'soon' ? `<em class="pill warn">${t('p.renew')}</em>` : m.st === 'active' ? `<em class="pill ok">${t('st.active')}</em>` : '';
      return `<li><button class="citem ${x.id === S.sel ? 'on' : ''}" data-act="select" data-id="${esc(x.id)}" style="--i:${Math.min(i, 12)}">
        <span class="ava" style="--h:${hue(x.id)}">${esc(initial(x.name))}</span>
        <span class="cmain"><b>${esc(x.name)}</b><small>${esc(x.plate || x.car || [x.brand, x.model].filter(Boolean).join(' ') || x.phone || t('p.noinfo'))}</small></span>
        ${pill}<em class="pill">${t('p.nfiles', { n })}</em></button></li>`;
    }).join('') || `<li class="none">${t('p.nomatch')}</li>`}</ul>
    <div class="detail ${anim ? 'anim' : ''}" id="detail">${c ? caseFile(c, mine) : `<div class="empty dark"><p>${t(list.length ? 'p.pick' : 'p.nomatch')}</p></div>`}
    </div>
  </div>`;
}

function caseFile(c, mine) {
  const m = S.exp[c.id] || { st: 'none' };
  const invs = S.invoices.filter(i => i.customerId === c.id);
  const tab = S.folderTab;
  const veh = [...FIELD_GROUPS.vehicle, 'car'].some(k => c[k]);
  const custRows = infoRows(c, FIELD_GROUPS.customer.filter(k => k !== 'name' && k !== 'phone'));
  const noFolders = S.store?.kind === 'cloud' && Object.keys(c.folders || {}).length < FOLDERS.length;
  const other = mine.filter(f => !FOLDER[f.folder]);
  const addTile = (slot, i) => `<button class="tile add" data-act="add-file" data-folder="${slot}" data-need="edit" style="--i:${Math.min(i, 14)}">${icon('plus', 22)}<b>${t('btn.addFile')}</b><small>${t('p.drop')}</small></button>`;
  const section = F => {
    const list = mine.filter(f => f.folder === F.slot);
    return `<section class="dsec" data-folder="${F.slot}">
      <header class="dsec-h"><span class="fico">${icon(F.icon, 16)}</span><div><b>${F.th}</b><small>${t('fo.' + F.slot)}</small></div><em class="cnt">${num(list.length)}</em>
        <button class="icon-btn glassy sm" data-act="add-file" data-folder="${F.slot}" data-need="edit" title="${t('btn.addFile')}">${icon('plus', 16)}</button></header>
      ${list.length ? `<div class="tiles">${list.map((f, i) => fileTile(f, i)).join('')}</div>` : ''}</section>`;
  };
  const otherSec = () => other.length ? `<section class="dsec">
      <header class="dsec-h"><span class="fico">${icon('folder', 16)}</span><div><b>ไม่ระบุ</b><small>${t('fo.other')}</small></div><em class="cnt">${num(other.length)}</em></header>
      <p class="dsec-hint">${t('fo.otherHint')}</p><div class="tiles">${other.map((f, i) => fileTile(f, i)).join('')}</div></section>` : '';
  let files;
  if (!tab) files = FOLDERS.map(section).join('') + otherSec();
  else if (tab === 'other') files = otherSec();
  else { const list = mine.filter(f => f.folder === tab); files = `<div class="tiles">${list.map((f, i) => fileTile(f, i)).join('')}${addTile(tab, list.length)}</div>`; }

  return `
      <div class="dcard" data-customer="${esc(c.id)}">
        <header>
          <button class="icon-btn glassy back" data-act="back" title="${t('btn.back')}">${icon('chev', 18)}</button>
          <div class="dname"><small>${t('p.file')}</small><h2>${esc(c.name)}</h2>${c.nameEn ? `<small>${esc(c.nameEn)}</small>` : ''}</div>
          <div class="dmeta"><span class="st-chip"><i class="dot ${m.st === 'expired' ? 'bad' : m.st === 'soon' ? 'warn' : m.st === 'active' ? 'ok' : ''}"></i>${t('st.' + m.st)}${m.exp ? ` · ${fmtDay(m.exp)}` : ''}</span>
            ${c.plate ? `<span>${icon('car', 15)}${esc(c.plate)}${c.province ? ' ' + esc(c.province) : ''}</span>` : ''}${c.car ? `<span>${esc(c.car)}</span>` : ''}${c.phone ? `<a href="tel:${esc(c.phone)}">${icon('phone', 15)}<bdi>${esc(digits(c.phone))}</bdi></a>` : ''}</div>
          <button class="icon-btn glassy" data-act="edit-customer" data-need="edit" title="${t('p.edit')}">${icon('edit', 17)}</button>
        </header>
        <div class="dinfo">
          <section><h4>${icon('users', 14)}${t('g.customer')}</h4>${custRows || `<p class="none">${t('g.notFilled')}</p>`}</section>
          <section><h4>${icon('car', 14)}${t('g.vehicle')}</h4>${veh ? infoRows(c, [...FIELD_GROUPS.vehicle, 'car']) : `<p class="none">${t('g.notFilled')}</p>`}</section>
          <section><h4>${icon('shield', 14)}${t('g.policy')}</h4>${infoRows(c, FIELD_GROUPS.policy.filter(k => k !== 'policyExpiry'))}
            <div class="irow"><small>${t('cf.policyExpiry')}</small><span>${m.exp ? `${fmtDay(m.exp)} · ${daysText(m.d)}` : t('st.notSet')}</span></div>
            ${m.legacy ? `<small class="src">${t('st.fromFile')}</small>` : ''}</section>
        </div>
        ${noFolders ? `<p class="dnote">${icon('info', 15)}<span>${t('fo.missing')}</span></p>` : ''}
        ${files}
        <section class="dsec">
          <header class="dsec-h"><span class="fico">${icon('invoice', 16)}</span><div><b>${t('inv.title')}</b></div><em class="cnt">${num(invs.length)}</em>
            <button class="icon-btn glassy sm" data-act="new-invoice" data-id="${esc(c.id)}" data-need="edit" title="${t('inv.create')}">${icon('plus', 16)}</button></header>
          <div class="dinv">${invs.length ? invs.map(inv => `<button class="dinv-row" data-act="open-invoice" data-id="${esc(inv.id)}">
            <span class="cmain"><b dir="ltr">${esc(inv.no)}</b><small>${fmtDay(inv.issue)}</small></span><b class="amt">${baht(inv.t?.total || 0)}</b>${invPillDark(inv.status)}</button>`).join('') : `<p class="none">${t('inv.noneHere')}</p>`}</div>
        </section>
        <footer>
          <div><small>${t('p.total')}</small><b>${num(mine.length)}</b></div>
          <div><small>${t('p.size')}</small><b>${fmtSize(mine.reduce((a, f) => a + (f.size || 0), 0))}</b></div>
          <div><small>${t('cf.policyExpiry')}</small><b>${m.exp ? fmtDay(m.exp) : '—'}</b></div>
          <span class="sp"></span>
          <button class="icon-btn glassy" data-act="camera" data-need="edit" title="${t('btn.camera')}">${icon('camera', 17)}</button>
          <button class="btn glassy" data-act="new-invoice" data-id="${esc(c.id)}" data-need="edit">${icon('invoice', 18)}<span>${t('q.invoice')}</span></button>
          <button class="btn white" data-act="upload" data-need="edit">${icon('plus', 18)}<span>${t('btn.upload')}</span></button>
        </footer>
      </div>`;
}
const invPillDark = s => `<em class="pill ${INV_CLS[s] === 'ok' ? 'ok' : INV_CLS[s] === 'bad' ? 'bad' : 'warn'}">${t('is.' + s)}</em>`;

/* ---------- all files ---------- */
function drawGrid() {
  const el = $('#grid'); if (!el) return;
  const list = S.files.filter(f => matchFile(f)), k = S.files.length ? 'g.none' : 'g.empty';
  el.innerHTML = list.length ? list.map((f, i) => fileTile(f, i, true)).join('')
    : `<div class="empty"><div class="gate-ico">${icon('folder', 34)}</div><h3>${t(k)}</h3><p>${t(k + '.text')}</p></div>`;
}

/* ---------- renewals: by customer, grouped ---------- */
function drawExp() {
  const el = $('#explist'); if (!el) return;
  const F = S.filters, q = F.q.trim();
  const rows = S.customers.filter(c => (!F.customer || c.id === F.customer) && custMatch(c, q))
    .map(c => ({ c, m: S.exp[c.id] })).filter(x => x.m?.exp && x.m.d <= 60).sort((a, b) => a.m.d - b.m.d);
  const groups = [['expired', x => x.m.d < 0], ['d7', x => x.m.d >= 0 && x.m.d <= 7], ['d30', x => x.m.d > 7 && x.m.d <= 30], ['d60', x => x.m.d > 30]];
  let i = 0;
  el.innerHTML = rows.length ? groups.map(([k, fn]) => {
    const g = rows.filter(fn); if (!g.length) return '';
    return `<h2 class="egroup g-${k}">${t('ex.' + k)}<span>${num(g.length)}</span></h2>${g.map(({ c, m }) => `
      <div class="erow card" style="--i:${Math.min(i++, 14)}">
        <span class="ava" style="--h:${hue(c.id)}">${esc(initial(c.name))}</span>
        <button class="emain" data-act="open-customer" data-id="${esc(c.id)}"><b>${esc(c.name)}</b><small>${esc([c.plate, c.insurer, c.policyNo].filter(Boolean).join(' · ') || c.phone || '')}</small></button>
        <span class="edate"><small>${t('e.expiry')}</small><b>${fmtDay(m.exp)}</b></span>
        <em class="pill st ${m.d < 0 || m.d === 0 ? 'bad' : m.d <= 30 ? 'warn' : 'ok'}">${daysText(m.d)}</em>
        ${c.phone ? `<a class="icon-btn" href="tel:${esc(c.phone)}" title="${esc(t('e.call', { x: c.name }))}">${icon('phone', 17)}</a>` : ''}
        <button class="icon-btn" data-act="open-customer" data-id="${esc(c.id)}" title="${t('a.open')}">${icon('chev', 17)}</button>
      </div>`).join('')}`;
  }).join('') : `<div class="empty"><div class="gate-ico">${icon('clock', 34)}</div><h3>${t('ex.empty')}</h3><p>${t('ex.emptyText')}</p></div>`;
}

/* ---------- invoices ---------- */
function drawInv() {
  const el = $('#invlist'); if (!el) return;
  const F = S.filters, q = norm(F.q);
  const list = S.invoices.filter(i => (!F.customer || i.customerId === F.customer) && (!F.inv || i.status === F.inv)
    && (!q || norm(`${i.no} ${i.cust?.name} ${cust(i.customerId)?.name || ''} ${i.veh?.plate}`).includes(q)));
  el.innerHTML = list.length ? list.map((inv, i) => {
    const c = cust(inv.customerId);
    return `<div class="erow card" style="--i:${Math.min(i, 14)}">
      <span class="ft">${icon('invoice', 20)}</span>
      <button class="emain" data-act="open-invoice" data-id="${esc(inv.id)}"><b dir="ltr">${esc(inv.no)}</b><small>${esc(c?.name || inv.cust?.name || '—')} · ${fmtDay(inv.issue)}</small></button>
      <span class="edate"><small>${t('inv.total')}</small><b class="amt">${baht(inv.t?.total || 0)}</b></span>
      ${invPill(inv.status)}
      <button class="icon-btn" data-act="open-invoice" data-id="${esc(inv.id)}" title="${t('inv.open')}">${icon('chev', 17)}</button>
    </div>`;
  }).join('') : `<div class="empty"><div class="gate-ico">${icon('invoice', 34)}</div><h3>${S.invoices.length ? t('inv.nomatch') : t('inv.none')}</h3><p>${S.invoices.length ? '' : t('inv.noneText')}</p></div>`;
}

/** Shows a customer's case file on the dashboard */
function openCustomer(id) {
  closeSheet();
  S.view = 'dash'; S.sel = id; S.mobileDetail = true;
  const st = S.exp[id]?.st;
  if (S.filters.status && S.filters.status !== st) S.filters.status = '';
  if (S.filters.customer && S.filters.customer !== id) S.filters.customer = '';
  if (S.filters.q && !custMatch(cust(id) || {}, S.filters.q.trim())) S.filters.q = '';
  mount();
  requestAnimationFrame(() => $(narrow() ? '#panel' : '#detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

/* ================= sheets ================= */
let urls = [], confirmRes = null, sheetClose = null;
const head = (title, sub = '') => `<header class="sh-head"><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div><button class="icon-btn" data-act="close-sheet" aria-label="${t('btn.close')}">${icon('x', 18)}</button></header>`;
/** v2 sheet. `foot` = action buttons that stay visible at the bottom. cls: '' | 'wide' | 'xwide' | 'small' */
function sheet({ title = '', sub = '', body = '', foot = '', cls = '', top = '' }) {
  const root = $('#sheet-root');
  const wasOpen = !!root.querySelector('.overlay.in');
  root.innerHTML = `<div class="overlay ${wasOpen ? 'in' : ''}" data-act="close-overlay"><div class="sheet ${cls}" role="dialog" aria-modal="true" aria-label="${esc(String(title).replace(/<[^>]+>/g, ''))}"><i class="grab"></i>${top || head(title, sub)}${body}${foot ? `<div class="sh-actions foot">${foot}</div>` : ''}</div></div>`;
  if (!wasOpen) requestAnimationFrame(() => requestAnimationFrame(() => root.firstElementChild?.classList.add('in')));
  else root.querySelector('.sheet').style.transition = 'none';
}
function closeSheet() {
  const o = $('#sheet-root .overlay');
  if (confirmRes) { confirmRes(false); confirmRes = null; }
  if (sheetClose) { const f = sheetClose; sheetClose = null; f(); }
  if (!o) return;
  o.classList.remove('in');
  setTimeout(() => { if (o.isConnected) o.remove(); }, 320);
  urls.forEach(u => URL.revokeObjectURL(u)); urls = [];
}
const objUrl = blob => { const u = URL.createObjectURL(blob); urls.push(u); return u; };

/** `text` is HTML: escape any user-supplied parts before passing it in */
function confirmBox(text, ok = t('btn.delete'), danger = true) {
  return new Promise(res => {
    sheet({ title: t('sure'), cls: 'small', body: `<p class="sh-text">${text}</p>`,
      foot: `<span class="sp"></span><button class="btn ghost" data-act="close-sheet">${t('btn.cancel')}</button><button class="btn ${danger ? 'danger' : 'primary'}" data-act="confirm-yes">${ok}</button>` });
    confirmRes = res;
  });
}

let toastT;
function toast(msg, kind = '') {
  const r = $('#toast-root');
  r.innerHTML = `<div class="toast ${kind}" role="status">${icon(kind === 'err' ? 'alert' : 'check', 17)}<span>${esc(msg)}</span></div>`;
  clearTimeout(toastT);
  toastT = setTimeout(() => r.firstElementChild?.classList.add('out'), kind === 'err' ? 5200 : 3400);
}

/** Opens the system picker. capture=true opens the camera directly. Must be called from a tap. */
function pickFiles({ capture = false, accept = '', multiple = true } = {}) {
  return new Promise(res => {
    const i = document.createElement('input');
    i.type = 'file'; i.hidden = true;
    if (accept) i.accept = accept;
    if (multiple) i.multiple = true;
    if (capture) i.setAttribute('capture', 'environment');
    i.addEventListener('change', () => { const f = [...i.files]; i.remove(); res(f); }, { once: true });
    i.addEventListener('cancel', () => { i.remove(); res([]); }, { once: true });
    document.body.append(i);
    i.click();
  });
}
const DOC_ACCEPT = 'image/*,application/pdf';

/* ---------- "+" sheet ---------- */
function addSheet() {
  const c = S.view === 'dash' ? cust(S.sel) : null;
  sheet({ title: t('add.title'), cls: 'small', body: `
    <div class="set-card"><div class="set-h">${icon('wand', 22)}<div><b>${t('add.ai')}</b><small>${aiOn() ? t('add.aiSub') : S.mode === 'local' ? t('ai.localOnly') : t('ai.off')}</small></div></div>
      <div class="two-btn"><button class="btn primary" data-act="ai-new" data-src="cam" ${aiOn() ? '' : 'disabled'}>${icon('camera', 18)}<span>${t('src.camera')}</span></button>
      <button class="btn ghost" data-act="ai-new" data-src="files" ${aiOn() ? '' : 'disabled'}>${icon('gallery', 18)}<span>${t('src.files')}</span></button></div></div>
    <div class="alist">
      <button class="as-row" data-act="new-customer"><span class="aico">${icon('userplus', 19)}</span><span><b>${t('add.manual')}</b><small>${t('add.manualSub')}</small></span>${icon('chev', 16)}</button>
      <button class="as-row" data-act="${c ? 'add-file' : 'pick-customer'}" data-next="file"><span class="aico">${icon('folder', 19)}</span><span><b>${t('add.file')}</b><small>${c ? esc(c.name) : t('add.fileSub')}</small></span>${icon('chev', 16)}</button>
      <button class="as-row" data-act="${c ? 'new-invoice' : 'pick-customer'}" data-next="invoice" ${c ? `data-id="${esc(c.id)}"` : ''}><span class="aico">${icon('invoice', 19)}</span><span><b>${t('inv.create')}</b><small>${c ? esc(c.name) : t('add.fileSub')}</small></span>${icon('chev', 16)}</button>
    </div>` });
}

/** Choose a customer, then continue with `next` ('file' | 'invoice') */
function pickCustomerSheet(next) {
  sheet({ title: t('pick.title'), cls: 'wide', body: `<label class="f grow search">${icon('search', 18)}<input id="pq" type="search" placeholder="${t('c.search')}" autocomplete="off"></label><div class="as-res" id="plist"></div>` });
  const draw = q => {
    const el = $('#plist'); if (!el) return;
    el.innerHTML = S.customers.filter(c => custMatch(c, q)).slice(0, 80).map(c => `<button class="as-row" data-act="picked" data-next="${next}" data-id="${esc(c.id)}"><span class="ava" style="--h:${hue(c.id)}">${esc(initial(c.name))}</span><span><b>${esc(c.name)}</b><small>${esc(c.plate || c.phone || '')}</small></span>${icon('chev', 16)}</button>`).join('') || `<p class="as-tip">${t('p.nomatch')}</p>`;
  };
  draw('');
  $('#pq').addEventListener('input', e => draw(e.target.value.trim()));
}

/** Camera or files? */
let srcCb = null;
function sourceSheet(onPick, { title = t('q.file'), accept = '' } = {}) {
  sheet({ title, cls: 'small', body: `<div class="two-btn">
    <button class="btn primary tall" data-act="src" data-src="cam">${icon('camera', 22)}<span>${t('src.camera')}</span></button>
    <button class="btn ghost tall" data-act="src" data-src="files">${icon('gallery', 22)}<span>${t('src.files')}</span></button></div>` });
  srcCb = { onPick, accept };
}

/* ---------- customer form (add / edit) ---------- */
const fieldInput = (k, v, { err = '', warn = '', conf = null, note = '' } = {}) => {
  const val = esc(v || '');
  const attrs = `name="${k}" data-r="${k}"`;
  let inp;
  if (DATE_FIELDS.has(k)) inp = `<input type="date" ${attrs} value="${val}">`;
  else if (k === 'address' || k === 'note') inp = `<textarea ${attrs} rows="2" maxlength="${k === 'note' ? 500 : 300}">${val}</textarea>`;
  else {
    const extra = { phone: 'inputmode="tel" dir="ltr" autocomplete="tel"', idNo: 'inputmode="numeric" dir="ltr"', year: 'inputmode="numeric" maxlength="4"', coverage: 'inputmode="decimal"', premium: 'inputmode="decimal"', vin: 'dir="ltr" autocapitalize="characters"', engineNo: 'dir="ltr" autocapitalize="characters"', policyNo: 'dir="ltr"', province: 'list="dl-prov"', policyType: 'list="dl-ptype"', name: 'required maxlength="120"' }[k] || '';
    inp = `<input ${attrs} ${extra} value="${val}" autocomplete="off">`;
  }
  const level = conf == null ? '' : conf >= 0.85 ? 'hi' : conf >= 0.6 ? 'mid' : 'lo';
  const chip = level ? `<em class="conf c-${level}" title="${t('ai.conf')}">${t('conf.' + level)}</em>` : '';
  return `<label class="fld ${err ? 'has-err' : ''} ${level ? 'ai-' + level : ''}"><span class="fl">${t('cf.' + k)}${k === 'name' ? ' *' : ''}${chip}</span>${inp}
    ${err ? `<small class="ferr">${t(err)}</small>` : warn ? `<small class="fwarn">${t(warn)}</small>` : note ? `<small class="fwarn">${t(note)}</small>` : ''}</label>`;
};
const datalists = () => `<datalist id="dl-prov">${PROVINCES.map(p => `<option value="${p}">`).join('')}</datalist><datalist id="dl-ptype">${POLICY_TYPES.map(p => `<option value="${p}">`).join('')}</datalist>`;
function fieldGroups(v, opts = {}) {
  const extra = opts.extraVehicle || [];
  return Object.entries({ customer: FIELD_GROUPS.customer, vehicle: [...FIELD_GROUPS.vehicle, ...extra], policy: FIELD_GROUPS.policy }).map(([g, keys]) =>
    `<fieldset class="fgroup"><legend>${t('g.' + g)}</legend><div class="fgrid">${keys.map(k => fieldInput(k, v[k], { err: opts.errors?.[k], warn: opts.warnings?.[k], conf: opts.conf?.[k] ?? null, note: opts.notes?.[k] })).join('')}</div></fieldset>`).join('');
}

let CF = null;   // customer form state
function customerSheet(c = {}) {
  CF = { id: c.id || '', v: { ...c } };
  drawCustomerSheet();
}
function drawCustomerSheet(errors = {}, warnings = {}) {
  const c = CF.v;
  sheet({ title: t(CF.id ? 'c.edit' : 'c.new'), sub: t('c.sub'), cls: 'wide',
    body: `<form class="form" data-form="customer" id="cform" novalidate>${fieldGroups(c, { errors, warnings, extraVehicle: c.car ? ['car'] : [] })}
      <fieldset class="fgroup">${fieldInput('note', c.note)}</fieldset>${datalists()}</form>`,
    foot: `${CF.id ? `<button type="button" class="btn danger-ghost" data-act="del-customer" data-id="${esc(CF.id)}">${icon('trash', 17)}<span>${t('c.delete')}</span></button>` : ''}<span class="sp"></span>
      <button type="button" class="btn ghost" data-act="close-sheet">${t('btn.cancel')}</button><button class="btn primary" type="submit" form="cform">${t('btn.save')}</button>` });
  if (!CF.id) setTimeout(() => $('#cform input[name=name]')?.focus(), 350);
}
const CUSTOMER_FORM_KEYS = [...ALL_FIELDS, 'note', 'car'];
function readForm(form, keys) {
  const out = {};
  for (const k of keys) { const el = form.elements[k]; if (el) out[k] = el.value.trim(); }
  return out;
}
function tidy(v) {
  const p = thaiPhone(v.phone); if (p) v.phone = p;
  if (v.idNo) v.idNo = latinDigits(v.idNo).replace(/[\s-]/g, '');
  for (const k of ['coverage', 'premium']) if (v[k]) { const m = money(v[k]); if (m != null) v[k] = String(m); }
  if (v.year) v.year = latinDigits(v.year);
  return v;
}
async function saveCustomerForm(form) {
  const v = tidy({ ...CF.v, ...readForm(form, CUSTOMER_FORM_KEYS) });
  const { errors, warnings } = checkCustomer(v);
  CF.v = v;
  if (Object.keys(errors).length) { drawCustomerSheet(errors, warnings); return toast(t('v.fix'), 'err'); }
  if (!CF.id) {
    const d = findDuplicates(v, S.customers);
    if (d.length) {
      const keep = CF;
      const ok = await confirmBox(t('dup.text', { x: d.map(x => `<b>${esc(x.customer.name)}</b> (${x.why.map(w => t('cf.' + w)).join(', ')})`).join(', ') }), t('dup.createAnyway'), false);
      CF = keep;
      if (!ok) { drawCustomerSheet(errors, warnings); return; }
    }
  }
  // only the fields the form shows are sent; the backend merges them into the saved details
  const payload = { id: CF.id || undefined, name: v.name };
  for (const k of CUSTOMER_FORM_KEYS) if (k in v) payload[k] = v[k];
  const isNew = !CF.id;
  const c = await S.store.saveCustomer(payload);
  CF = null; closeSheet(); await reload();
  toast(t(isNew ? 't.customerAdded' : 't.customerUpdated'));
  openCustomer(c.id);
}

/* ---------- folder picker ---------- */
function folderPicker(cur, aiSlot, name = 'folder', i = '') {
  return `<div class="fpick" role="radiogroup" aria-label="${t('fo.choose')}">${FOLDERS.map(F => `
    <button type="button" role="radio" aria-checked="${cur === F.slot}" class="${cur === F.slot ? 'on' : ''}" data-act="pick-folder" data-name="${name}" data-i="${i}" data-folder="${F.slot}">
      <span class="fp-ico">${icon(F.icon, 18)}</span><b>${F.th}</b><small>${t('fo.' + F.slot)}</small>${aiSlot === F.slot ? `<em class="ai-tag">${icon('wand', 11)} AI</em>` : ''}</button>`).join('')}</div>`;
}
const typeFor = (slot, docType) => slot === 'docs' ? (docType === 'id_card' ? 'id' : 'car') : FOLDER[slot]?.type || 'other';

/* ---------- upload to a customer (folder required, AI suggestions) ---------- */
let U = null;
const MAX = MAX_UPLOAD_MB * 1048576;
const compressible = f => /^image\/(jpeg|png|webp|heic|heif)$/i.test(f.type);
const readable = f => compressible(f) || f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
const newItem = (file, folder = '') => ({ file, name: file.name, folder, picked: !!folder, aiFolder: null, type: typeFor(folder), expiry: '', ai: aiOn() && readable(file) ? 'wait' : 'skip', n: null, url: isImage({ mime: file.type }) ? objUrl(file) : '', done: false, p: 0 });

function sizeFilter(files) {
  const ok = [];
  for (const f of files) {
    if (f.size > MAX && !compressible(f)) toast(t('u.tooBig', { x: f.name, n: MAX_UPLOAD_MB }), 'err');
    else if (f.size > 0) ok.push(f);
  }
  return ok;
}
function startUpload(fileList, cid, folder = '') {
  if (!canEdit()) return toast(t('err.role'), 'err');
  if (S.gate || !S.store) return toast(t('u.connect'), 'err');
  const files = sizeFilter([...fileList]);
  if (!files.length) return;
  const c = cust(cid); if (!c) return pickCustomerSheet('file');
  U = { cid, toggles: {}, busy: false, items: [] };
  U.items = files.map(f => newItem(f, folder));
  sheet({ title: t('u.title'), sub: esc(c.name), cls: 'wide',
    body: `<div class="up-list" id="upList"></div><div id="upDiff"></div>`,
    foot: `<button class="btn ghost" data-act="up-more">${icon('plus', 17)}<span>${t('u.more')}</span></button><span class="sp"></span>
      <button class="btn ghost" data-act="close-sheet">${t('btn.cancel')}</button><button class="btn primary" data-act="do-upload" id="upGo"></button>` });
  sheetClose = () => { U = null; };
  drawUpload();
  aiQueue();
}
async function aiQueue() {
  const u = U;
  for (const it of u?.items || []) {
    if (U !== u) return;
    if (it.ai !== 'wait') continue;
    it.ai = 'busy'; drawUpload();
    try {
      const r = await S.store.aiExtract(await prepare([it.file]));
      if (U !== u) return;
      it.n = normalize(r);
      it.aiFolder = suggestFolder(it.n, cust(u.cid));
      if (!it.picked && it.aiFolder) { it.folder = it.aiFolder; it.type = typeFor(it.folder, it.n.docType); }
      if (it.n.values.policyExpiry && it.folder === 'policy' && !it.expiry) it.expiry = it.n.values.policyExpiry;
      it.ai = 'done';
    } catch (e) { it.ai = 'err'; it.err = aiErr(e); }
    drawUpload();
  }
}
function aiErr(e) {
  if (e?.key) return t(e.key);
  return t({ offline: 'ai.offline', timeout: 'ai.timeout', network: 'ai.offline', ai_nokey: 'ai.nokey', ai_quota: 'ai.quota', too_big: 'ai.tooBig', role: 'err.role' }[e?.code] || 'ai.failed');
}
function uploadDiff() {
  const c = cust(U.cid), best = {};
  for (const it of U.items) {
    if (!it.n || !it.folder) continue;
    for (const d of diff(c, it.n, it.folder)) if (!best[d.key] || d.conf > best[d.key].conf) best[d.key] = d;
  }
  return Object.values(best).map(d => ({ ...d, on: U.toggles[d.key] ?? d.on }));
}
function aiLine(it) {
  if (it.ai === 'skip') return '';
  if (it.ai === 'wait' || it.ai === 'busy') return `<p class="ai-line busy"><span class="spin sm"></span>${t('ai.reading')}</p>`;
  if (it.ai === 'err') return `<p class="ai-line err">${icon('alert', 14)}${esc(it.err)} · ${t('ai.manual')}</p>`;
  const dt = it.n?.docType || 'other';
  return `<p class="hint">${icon('sparkle', 13)} ${t('ai.found', { x: t('dt.' + dt) })}${it.aiFolder ? ` · ${t('ai.suggests', { x: FOLDER[it.aiFolder].th })}` : ''}</p>`;
}
const fmtVal = (k, v) => !v ? '' : DATE_FIELDS.has(k) ? fmtDay(v) : v;
function diffRows(list, attr) {
  return list.map(x => `<label class="drow ${x.conf < 0.6 ? 'lo' : x.conf < 0.85 ? 'mid' : ''}"><input type="checkbox" ${attr}="${x.key}" ${x.on ? 'checked' : ''}>
    <span class="d-k">${t('cf.' + x.key)}${x.note ? ` <em class="conf c-lo">${t(x.note)}</em>` : x.conf < 0.85 ? ` <em class="conf c-${x.conf < 0.6 ? 'lo' : 'mid'}">${t(x.conf < 0.6 ? 'conf.lo' : 'conf.mid')}</em>` : ''}</span>
    <span class="d-v"><s>${esc(fmtVal(x.key, x.old)) || '—'}</s>${icon('chev', 14)}<b>${esc(fmtVal(x.key, x.new))}</b></span></label>`).join('');
}
function drawUpload() {
  const el = $('#upList'); if (!el || !U) return;
  el.innerHTML = U.items.map((it, i) => `
    <div class="up-row ${it.done ? 'done' : ''}" data-i="${i}" style="--i:${Math.min(i, 8)}">
      <span class="up-th">${it.url ? `<img src="${it.url}" alt="">` : ftBadge({ mime: it.file.type, name: it.name, type: it.type }, 22)}</span>
      <div class="up-main">
        <div class="up-top"><input data-u="name" maxlength="200" value="${esc(it.name)}" aria-label="${t('u.fileName')}"><small>${fmtSize(it.file.size)}</small>
          <button class="icon-btn sm" data-act="up-remove" aria-label="${t('u.remove')}">${icon('x', 15)}</button></div>
        ${aiLine(it)}
        <p class="fpick-label">${t('fo.choose')}${it.folder ? '' : ` <em class="req">${t('fo.required')}</em>`}</p>
        ${folderPicker(it.folder, it.aiFolder, 'up', i)}
        ${it.folder === 'docs' || it.folder === 'policy' ? `<div class="up-extra">
          ${it.folder === 'docs' ? `<label>${t('fl.type')}<select data-u="type">${['car', 'id', 'other'].map(k => `<option value="${k}" ${it.type === k ? 'selected' : ''}>${typeLabel(k)}</option>`).join('')}</select></label>` : ''}
          ${it.folder === 'policy' ? `<label>${t('fl.expiry')}<input type="date" data-u="expiry" value="${esc(it.expiry)}"></label>` : ''}</div>` : ''}
        ${it.done ? `<p class="ai-line ok">${icon('check', 14)}${t('u.saved')}</p>` : ''}
        <div class="prog"><i style="width:${it.done ? 100 : it.p * 100}%"></i></div>
      </div>
    </div>`).join('');
  const d = uploadDiff(), de = $('#upDiff');
  de.innerHTML = d.length ? `<section class="diff"><h3>${icon('wand', 16)}${t('diff.title')}</h3><p class="muted">${t('diff.sub')}</p>${diffRows(d, 'data-diff')}</section>` : '';
  const go = $('#upGo');
  if (go) { const n = U.items.filter(x => !x.done).length; go.textContent = d.some(x => x.on) ? t('u.saveApply', { n }) : t('u.save', { n }); go.disabled = U.busy; }
}

async function doUpload(btn) {
  if (!U || U.busy) return;
  const missing = U.items.find(it => !it.done && !it.folder);
  if (missing) { toast(t('fo.pickAll'), 'err'); $(`.up-row[data-i="${U.items.indexOf(missing)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
  const u = U, c = cust(u.cid);
  for (const it of u.items) if (it.ai === 'wait') it.ai = 'skip';   // save now; files not read yet are saved without AI
  u.busy = true; drawUpload();
  let done = 0, failed = null;
  try {
    for (const [i, it] of u.items.entries()) {
      if (it.done) continue;
      let blob = it.file;
      if (compressible(blob)) { btn.textContent = t('u.compressing'); blob = await compressImage(blob); }
      if (blob.size > MAX) { toast(t('u.tooBig', { x: it.name, n: MAX_UPLOAD_MB }), 'err'); continue; }
      btn.textContent = t('u.saving');
      let name = it.name.trim() || it.file.name;
      if (blob !== it.file && blob.type === 'image/jpeg') name = name.replace(/\.(png|webp|heic|heif|jpe?g)$/i, '') + '.jpg';
      const meta = { name, customerId: u.cid, folder: it.folder, type: it.type || typeFor(it.folder), expiry: it.folder === 'policy' ? it.expiry || '' : '', note: it.n ? fileNote(it.n, it.folder) : '' };
      const thumb = await makeThumb(blob);
      if (S.store.kind === 'local') meta.thumb = thumb;
      const bar = $(`.up-row[data-i="${i}"] .prog i`);
      const f = await S.store.addFile(blob, meta, p => { if (bar) bar.style.width = p * 100 + '%'; });
      if (thumb && S.store.thumbCache) S.store.thumbCache.set(f.id, thumb);
      it.done = true; done++;
      if (U === u) drawUpload();
    }
    const ch = uploadDiff().filter(x => x.on);
    if (ch.length) {
      const upd = { id: c.id, name: c.name };
      for (const x of ch) upd[x.key] = x.new;
      const chk = checkCustomer({ ...c, ...upd });
      if (Object.keys(chk.errors).length) toast(t('diff.invalid'), 'err');
      else await S.store.saveCustomer(upd);   // merged into the saved details by the backend
    }
  } catch (e) { failed = e; }
  finally {
    u.busy = false;
    if (done || !failed) { S.sel = u.cid; await reload().catch(() => { }); }
    if (U === u) drawUpload();
  }
  if (failed) throw failed;
  closeSheet();
  toast(t('u.done', { n: done }));
  if (S.view === 'dash' && narrow()) { S.mobileDetail = true; drawPanel(true); loadThumbs(); }
}

/* ---------- "Add customer with AI" ---------- */
let R = null;   // review state
async function aiNew(src) {
  if (!aiOn()) return toast(S.mode === 'local' ? t('ai.localOnly') : t('ai.off'), 'err');
  const files = await pickFiles({ capture: src === 'cam', accept: src === 'cam' ? 'image/*' : DOC_ACCEPT, multiple: src !== 'cam' });
  if (files.length) aiNewFiles(files);
}
function aiNewFiles(files) {
  if (!aiOn()) return toast(S.mode === 'local' ? t('ai.localOnly') : t('ai.off'), 'err');
  const ok = sizeFilter(files).filter(readable);
  if (!ok.length) { if (files.length) toast(t('ai.noReadable'), 'err'); return; }
  R = { files: ok, previews: ok.map(f => isImage({ mime: f.type }) ? objUrl(f) : ''), n: null, v: {}, folder: '', aiFolder: null, errors: {}, warnings: {} };
  readingSheet();
  const r0 = R;
  run(async () => {
    try {
      const r = await S.store.aiExtract(await prepare(ok));
      if (R !== r0) return;
      R.n = normalize(r); R.v = { ...R.n.values }; R.aiFolder = suggestFolder(R.n, null); R.folder = R.aiFolder || '';
      reviewSheet();
    } catch (e) {
      if (R !== r0) return;
      sheet({ title: t('ai.failTitle'), cls: 'small', body: `<p class="sh-text">${esc(aiErr(e))}</p>`,
        foot: `<span class="sp"></span><button class="btn ghost" data-act="ai-retry">${t('ai.retry')}</button><button class="btn primary" data-act="ai-manual">${t('ai.manualBtn')}</button>` });
      sheetClose = () => { R = null; };
    }
  });
}
const pvFile = (f, i, act) => `<button class="pv-file" data-act="${act}" data-i="${i}">${ftBadge({ mime: f.type, name: f.name }, 24, 'sm')}<small>${esc(f.name)}</small></button>`;
function readingSheet() {
  sheet({ title: t('ai.readingTitle'), cls: 'wide', body: `<div class="reading">
    <div class="pv-strip">${R.files.map((f, i) => R.previews[i] ? `<img src="${R.previews[i]}" alt="">` : pvFile(f, i, 'pv-open')).join('')}</div>
    <div class="scan"><span class="spin"></span><b>${t('ai.reading')}</b><small>${t('ai.readingSub')}</small></div></div>` });
  sheetClose = () => { R = null; };
}
function reviewSheet() {
  const lowCount = Object.values(R.n?.conf || {}).filter(c => c < 0.85).length;
  sheet({ title: t('rv.title'), sub: R.n ? t('rv.sub', { x: t('dt.' + R.n.docType) }) : t('rv.subManual'), cls: 'xwide',
    body: `<div class="rv">
      <aside class="rv-pv">${R.files.map((f, i) => R.previews[i] ? `<button data-act="pv-zoom" data-i="${i}"><img src="${R.previews[i]}" alt=""></button>` : pvFile(f, i, 'pv-open')).join('')}</aside>
      <form class="form" data-form="review" id="rvform" novalidate>
        ${R.n ? `<p class="note ${lowCount ? 'warn' : ''}">${icon(lowCount ? 'alert' : 'check', 15)}<span>${lowCount ? t('rv.check', { n: lowCount }) : t('rv.allGood')} ${t('rv.never')}</span></p>` : ''}
        ${fieldGroups(R.v, { errors: R.errors, warnings: R.warnings, conf: R.n?.conf, notes: R.n?.notes })}
        <fieldset class="fgroup"><legend>${t('rv.saveTo')}</legend>${folderPicker(R.folder, R.aiFolder, 'rv')}</fieldset>${datalists()}
      </form></div>`,
    foot: `<span class="sp"></span><button type="button" class="btn ghost" data-act="close-sheet">${t('btn.cancel')}</button><button class="btn primary" type="submit" form="rvform">${icon('check', 18)}<span>${t('rv.confirm')}</span></button>` });
  sheetClose = () => { R = null; };
}
async function confirmReview(form) {
  R.v = tidy({ ...R.v, ...readForm(form, ALL_FIELDS) });
  const { errors, warnings } = checkCustomer(R.v);
  R.errors = errors; R.warnings = warnings;
  if (Object.keys(errors).length) { reviewSheet(); return toast(t('v.fix'), 'err'); }
  if (!R.folder) { reviewSheet(); return toast(t('fo.pickAll'), 'err'); }
  const d = findDuplicates(R.v, S.customers);
  if (d.length) return dupSheet(d);
  await createFromReview();
}
function dupSheet(d) {
  sheet({ title: t('dup.title'), cls: 'small', body: `<p class="sh-text">${t('dup.sub')}</p>${d.map(x => `
    <div class="dup"><span class="ava" style="--h:${hue(x.customer.id)}">${esc(initial(x.customer.name))}</span><span><b>${esc(x.customer.name)}</b><small>${t('dup.same')}: ${x.why.map(w => t('cf.' + w)).join(', ')}</small></span>
    <button class="btn primary sm" data-act="dup-update" data-id="${esc(x.customer.id)}">${t('dup.update')}</button></div>`).join('')}`,
    foot: `<button class="btn ghost" data-act="dup-back">${t('btn.back')}</button><span class="sp"></span><button class="btn ghost" data-act="dup-create">${t('dup.createAnyway')}</button>` });
  sheetClose = () => { R = null; };
}
async function createFromReview() {
  const v = R.v, r = R;
  if (!v.car && (v.brand || v.model)) v.car = [v.brand, v.model, v.color].filter(Boolean).join(' ');
  for (const b of $$('.sh-actions .btn')) b.disabled = true;
  const c = await S.store.saveCustomer({ ...v });
  await uploadSources(r, c.id);
  sheetClose = null; R = null; closeSheet();
  await reload();
  toast(t('t.customerAdded'));
  openCustomer(c.id);
}
async function uploadSources(r, cid) {
  for (const f of r.files) {
    const blob = compressible(f) ? await compressImage(f) : f;
    if (blob.size > MAX) { toast(t('u.tooBig', { x: f.name, n: MAX_UPLOAD_MB }), 'err'); continue; }
    let name = f.name;
    if (blob !== f && blob.type === 'image/jpeg') name = name.replace(/\.(png|webp|heic|heif|jpe?g)$/i, '') + '.jpg';
    const meta = { name, customerId: cid, folder: r.folder, type: typeFor(r.folder, r.n?.docType), expiry: r.folder === 'policy' ? r.v.policyExpiry || '' : '', note: r.n ? fileNote({ ...r.n, values: r.v }, r.folder) : '' };
    const thumb = await makeThumb(blob);
    if (S.store.kind === 'local') meta.thumb = thumb;
    const x = await S.store.addFile(blob, meta);
    if (thumb && S.store.thumbCache) S.store.thumbCache.set(x.id, thumb);
  }
}
/** Duplicate found: show "old -> new" for that customer, then update it and add the files there */
function dupUpdate(id) {
  const c = cust(id), r = R;
  const n = { docType: 'policy', values: r.v, conf: r.n?.conf || {}, notes: r.n?.notes || {} };
  const list = diff(c, n, r.folder === 'prev' ? 'prev' : 'policy');
  sheet({ title: t('dup.updTitle', { x: esc(c.name) }), sub: t('diff.sub'), cls: 'wide',
    body: list.length ? `<section class="diff">${diffRows(list, 'data-dupdiff')}</section>` : `<p class="sh-text">${t('diff.none')}</p>`,
    foot: `<button class="btn ghost" data-act="dup-back">${t('btn.back')}</button><span class="sp"></span><button class="btn primary" data-act="dup-apply" data-id="${esc(id)}">${t('dup.apply')}</button>` });
  r.dupDiff = list;
  sheetClose = () => { R = null; };
}
async function dupApply(id, btn) {
  const c = cust(id), r = R;
  btn.disabled = true;
  const upd = { id: c.id, name: c.name };
  for (const el of $$('[data-dupdiff]')) if (el.checked) upd[el.dataset.dupdiff] = r.v[el.dataset.dupdiff];
  const chk = checkCustomer({ ...c, ...upd });
  if (Object.keys(chk.errors).length) { btn.disabled = false; return toast(t('diff.invalid'), 'err'); }
  if (Object.keys(upd).length > 2) await S.store.saveCustomer(upd);
  await uploadSources(r, c.id);
  sheetClose = null; R = null; closeSheet();
  await reload(); toast(t('t.customerUpdated'));
  openCustomer(c.id);
}

/* ---------- file preview, edit & move ---------- */
let cur = null;
async function openFile(id) {
  const f = S.files.find(x => x.id === id); if (!f) return;
  const c = cust(f.customerId) || { name: '—' };
  const ro = !canEdit(), dis = ro ? 'disabled' : '';
  cur = { f, blob: null, url: '' };
  const by = f.by ? ` · ${t('up.by', { x: esc(f.by) })}` : '';
  const inv = f.invoice ? S.invoices.find(i => i.id === f.id) : null;
  sheet({ title: esc(f.name), sub: `${esc(c.name)} · ${fmtSize(f.size)} · ${fmtDay(f.createdAt)}${by}`, cls: 'wide',
    body: `<div class="preview" id="preview"><div class="spin"></div></div>
    <p class="in-folder">${t('fo.in')}: <b>${FOLDER[f.folder] ? FOLDER[f.folder].th : 'ไม่ระบุ · ' + t('fo.other')}</b></p>
    ${canEdit() && !inv ? `<details class="move" ${FOLDER[f.folder] ? '' : 'open'}><summary>${icon('move', 16)}${t('fo.move')}</summary>${folderPicker(f.folder, null, 'move')}<p class="muted">${t('fo.moveNote')}</p></details>` : ''}
    ${inv ? `<button class="btn ghost block" data-act="open-invoice" data-id="${esc(inv.id)}">${icon('invoice', 18)}<span>${t('inv.open')}</span></button>` : `
    <form class="form" data-form="file" id="fform" data-id="${esc(f.id)}">
      <label>${t('u.fileName')}<input name="name" value="${esc(f.name)}" maxlength="200" required ${dis}></label>
      <div class="two">
        <label>${t('fl.type')}<select name="type" ${dis}>${Object.keys(TYPES).map(k => `<option value="${k}" ${k === f.type ? 'selected' : ''}>${typeLabel(k)}</option>`).join('')}</select></label>
        <label>${t('fl.expiry')}<input type="date" name="expiry" value="${esc(f.expiry || '')}" ${dis}></label>
      </div>
      <label>${t('fl.note')}<input name="note" value="${esc(f.note || '')}" maxlength="2000" placeholder="${ro ? '' : t('fl.note.ph')}" ${dis}></label>
    </form>`}`,
    foot: `<button type="button" class="icon-btn danger" data-act="del-file" data-need="edit" data-id="${esc(f.id)}" title="${t('btn.delete')}">${icon('trash', 17)}</button>
      <button type="button" class="icon-btn" data-act="dl-file" title="${t('fl.download')}">${icon('download', 17)}</button>
      ${navigator.share ? `<button type="button" class="icon-btn" data-act="share-file" title="${t('fl.share')}">${icon('share', 17)}</button>` : ''}
      <span class="sp"></span>${inv ? '' : `<button class="btn primary" type="submit" form="fform" data-need="edit">${t('fl.saveChanges')}</button>`}` });
  let blob;
  try { blob = await S.store.getBlob(id); }
  catch (e) { const pv = $('#preview'); if (pv && cur?.f.id === id) pv.innerHTML = `<p class="sh-text">${t('fl.noContent')}</p>`; throw e; }
  if (cur?.f.id !== id) return;
  const pv = $('#preview'); if (!pv) return;
  if (!blob) { pv.innerHTML = `<p class="sh-text">${t('fl.noContent')}</p>`; return; }
  cur.blob = blob; cur.url = objUrl(blob);
  pv.innerHTML = isImage(f) ? `<img src="${cur.url}" alt="${esc(f.name)}">`
    : isPdf(f) ? `<iframe src="${cur.url}#toolbar=0" title="${esc(f.name)}"></iframe><button class="btn dark open-full" data-act="open-link" data-url="${cur.url}">${icon('external', 16)}<span>${t('fl.full')}</span></button>`
      : `<div class="nopv">${ftBadge(f, 30)}<p>${t('fl.noPreview')}</p></div>`;
}
async function moveCur(slot) {
  const f = cur?.f; if (!f || f.folder === slot) return;
  if (!await confirmBox(t('fo.moveQ', { x: esc(f.name), y: FOLDER[slot].th }), t('fo.move'), false)) return;
  await S.store.moveFile(f.id, slot);
  await reload(); toast(t('fo.moved', { x: FOLDER[slot].th }));
}
function download(blob, name) {
  const a = document.createElement('a'); a.href = objUrl(blob); a.download = name; document.body.append(a); a.click(); a.remove();
}
async function shareBlob(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  try {
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: name });
    else download(blob, name);
  } catch (e) { if (e.name !== 'AbortError') download(blob, name); }
}

/* ---------- invoices ---------- */
let I = null;   // invoice editor state
const invItemDefault = l => l === 'th' ? 'เบี้ยประกันภัยรถยนต์' : l === 'en' ? 'Car insurance premium' : 'เบี้ยประกันภัยรถยนต์ / Car insurance premium';
function newInvoice(cid) {
  const c = cust(cid); if (!c) return pickCustomerSheet('invoice');
  const m = S.exp[c.id] || {};
  let l = 'both'; try { l = localStorage.getItem('by_invlang') || 'both'; } catch { }
  I = { id: '', tab: 'edit', d: {
    customerId: c.id, issue: todayIso(), due: addDays(todayIso(), 7), lang: l,
    cust: { name: c.name, phone: c.phone || '', address: c.address || '' },
    veh: { brand: c.brand || '', model: c.model || (!c.brand ? c.car || '' : ''), plate: c.plate || '', province: c.province || '' },
    pol: { type: c.policyType || '', insurer: c.insurer || '', no: c.policyNo || '', start: c.policyStart || '', end: c.policyExpiry || m.exp || '' },
    items: [{ d: invItemDefault(l), q: 1, p: c.premium || '' }], discount: '', vat: false, paid: '', notes: '',
  } };
  invoiceEditor();
}
function editInvoice(id) {
  const inv = S.invoices.find(i => i.id === id); if (!inv) return;
  I = { id, tab: 'edit', no: inv.no, d: JSON.parse(JSON.stringify({ customerId: inv.customerId, issue: inv.issue, due: inv.due, lang: inv.lang, cust: inv.cust, veh: inv.veh, pol: inv.pol, items: inv.items, discount: inv.discount || '', vat: !!inv.vat, paid: inv.paid || '', notes: inv.notes || '' })) };
  invoiceEditor();
}
function invTotals() {
  try { return { t: calcTotals(I.d.items.map(it => ({ q: +latinDigits(it.q) || 0, p: it.p || 0 })), I.d.discount || 0, I.d.vat, I.d.paid || 0) }; }
  catch (e) { return { err: e.key || 'inv.badAmount' }; }
}
function invoiceEditor() {
  const d = I.d;
  const f = (label, path, v, attrs = '') => `<label class="fld"><span class="fl">${label}</span><input data-i="${path}" value="${esc(v ?? '')}" ${attrs}></label>`;
  const seg = ['th', 'en', 'both'].map(k => `<button type="button" class="${d.lang === k ? 'on' : ''}" data-act="inv-lang" data-v="${k}">${t('il.' + k)}</button>`).join('');
  sheet({ title: I.id ? t('inv.edit', { x: esc(I.no) }) : t('inv.new'), sub: esc(d.cust.name), cls: 'wide',
    body: `<div class="seg" role="tablist"><button class="${I.tab === 'edit' ? 'on' : ''}" data-act="inv-tab" data-v="edit">${t('inv.tabEdit')}</button><button class="${I.tab === 'pv' ? 'on' : ''}" data-act="inv-tab" data-v="pv">${t('inv.tabPreview')}</button></div>
    ${I.tab === 'pv' ? `<div class="inv-pv-wrap"><div class="inv-pv" id="invPv">${invPreviewHtml()}</div></div>` : `
    <form class="form" data-form="invoice" id="iform" novalidate>
      <fieldset class="fgroup"><legend>${t('inv.lang')}</legend><div class="seg">${seg}</div>
        <div class="fgrid">${f(t('inv.issue'), 'issue', d.issue, 'type="date"')}${f(t('inv.due'), 'due', d.due, 'type="date"')}</div></fieldset>
      <fieldset class="fgroup"><legend>${t('g.customer')}</legend><div class="fgrid">${f(t('cf.name') + ' *', 'cust.name', d.cust.name, 'required')}${f(t('cf.phone'), 'cust.phone', d.cust.phone, 'inputmode="tel" dir="ltr"')}</div>
        <label class="fld"><span class="fl">${t('cf.address')}</span><textarea data-i="cust.address" rows="2">${esc(d.cust.address)}</textarea></label></fieldset>
      <fieldset class="fgroup"><legend>${t('g.vehicle')}</legend><div class="fgrid">${f(t('cf.brand'), 'veh.brand', d.veh.brand)}${f(t('cf.model'), 'veh.model', d.veh.model)}${f(t('cf.plate'), 'veh.plate', d.veh.plate)}${f(t('cf.province'), 'veh.province', d.veh.province, 'list="dl-prov"')}</div></fieldset>
      <fieldset class="fgroup"><legend>${t('g.policy')}</legend><div class="fgrid">${f(t('cf.policyType'), 'pol.type', d.pol.type, 'list="dl-ptype"')}${f(t('cf.insurer'), 'pol.insurer', d.pol.insurer)}${f(t('cf.policyNo'), 'pol.no', d.pol.no, 'dir="ltr"')}${f(t('cf.policyStart'), 'pol.start', d.pol.start, 'type="date"')}${f(t('cf.policyExpiry'), 'pol.end', d.pol.end, 'type="date"')}</div></fieldset>
      <fieldset class="fgroup"><legend>${t('inv.items')}</legend><div id="invItems">${invItemsHtml()}</div>
        <button type="button" class="btn ghost block" data-act="inv-add-line">${icon('plus', 17)}<span>${t('inv.addLine')}</span></button></fieldset>
      <fieldset class="fgroup"><legend>${t('inv.payment')}</legend><div class="fgrid">
        ${f(t('inv.discount'), 'discount', d.discount, 'inputmode="decimal" placeholder="0.00"')}${f(t('inv.paid'), 'paid', d.paid, 'inputmode="decimal" placeholder="0.00"')}</div>
        <label class="check"><input type="checkbox" data-i="vat" ${d.vat ? 'checked' : ''}><span>${t('inv.vat')}</span></label>
        <label class="fld"><span class="fl">${t('inv.notes')}</span><textarea data-i="notes" rows="2" maxlength="500">${esc(d.notes)}</textarea></label></fieldset>
      ${datalists()}
    </form>`}
    <div class="totals" id="invTot">${invTotalsHtml()}</div>`,
    foot: `<span class="sp"></span><button type="button" class="btn ghost" data-act="close-sheet">${t('btn.cancel')}</button><button class="btn primary" data-act="inv-save" id="invGo">${icon('invoice', 18)}<span>${I.id ? t('inv.regen') : t('inv.createPdf')}</span></button>` });
  sheetClose = () => { I = null; };
}
function invItemsHtml() {
  return I.d.items.map((it, i) => `<div class="line" data-line="${i}">
    <input class="l-d" data-i="items.${i}.d" value="${esc(it.d)}" placeholder="${t('inv.desc')}" aria-label="${t('inv.desc')}">
    <input class="l-q" data-i="items.${i}.q" value="${esc(it.q)}" inputmode="decimal" aria-label="${t('inv.qty')}">
    <input class="l-p" data-i="items.${i}.p" value="${esc(it.p)}" inputmode="decimal" placeholder="0.00" aria-label="${t('inv.price')}">
    <b class="l-a" id="la${i}">${baht(lineAmount({ q: +latinDigits(it.q) || 0, p: it.p }))}</b>
    <button type="button" class="icon-btn sm" data-act="inv-del-line" data-i="${i}" aria-label="${t('u.remove')}" ${I.d.items.length < 2 ? 'disabled' : ''}>${icon('x', 15)}</button></div>`).join('');
}
function invTotalsHtml() {
  const r = invTotals();
  if (r.err) return `<p class="ferr">${icon('alert', 15)} ${t(r.err)}</p>`;
  const T = r.t;
  return `<div><span>${t('inv.sub')}</span><b>${baht(T.sub)}</b></div>${T.disc ? `<div><span>${t('inv.discount')}</span><b>-${baht(T.disc)}</b></div>` : ''}
    ${I.d.vat ? `<div><span>VAT 7%</span><b>${baht(T.vat)}</b></div>` : ''}<div class="tot"><span>${t('inv.total')}</span><b>${baht(T.total)}</b></div>
    ${T.paid ? `<div><span>${t('inv.paid')}</span><b>${baht(T.paid)}</b></div><div class="tot2"><span>${t('inv.bal')}</span><b>${baht(T.bal)}</b></div>` : ''}
    <div class="st-line">${invPill(T.status)}</div>`;
}
function invPreviewHtml() {
  const r = invTotals();
  return invoiceHtml({ ...I.d, no: I.no || t('inv.auto'), t: r.t, status: r.t?.status || 'unpaid' }, S.company || {}, dfmt());
}
function setPath(obj, path, val) {
  const ks = path.split('.'); let o = obj;
  for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
  o[ks.at(-1)] = val;
}
function invValidate() {
  const d = I.d;
  if (!d.cust.name.trim()) return 'inv.needName';
  d.items = d.items.filter(it => String(it.d).trim() || String(it.p).trim());
  if (!d.items.length) { d.items = [{ d: '', q: 1, p: '' }]; return 'inv.needLine'; }
  for (const it of d.items) {
    const q = Number(latinDigits(it.q)); if (!isFinite(q) || q <= 0) return 'inv.badQty';
    if (it.p !== '' && money(it.p) == null) return 'inv.badAmount';
    it.q = q; it.p = it.p === '' ? 0 : money(it.p);
  }
  for (const k of ['discount', 'paid']) if (d[k] !== '' && d[k] != null && money(d[k]) == null) return 'inv.badAmount';
  if (d.due && d.issue && d.due < d.issue) return 'inv.badDue';
  const r = invTotals(); if (r.err) return r.err;
  return '';
}
async function invSave(btn) {
  const e = invValidate();
  if (e) { if (I.tab === 'edit' && $('#invItems')) $('#invItems').innerHTML = invItemsHtml(); $('#invTot').innerHTML = invTotalsHtml(); return toast(t(e), 'err'); }
  btn.disabled = true; btn.innerHTML = `<span class="spin sm"></span><span>${t('inv.making')}</span>`;
  try { localStorage.setItem('by_invlang', I.d.lang); } catch { }
  const data = { ...I.d, discount: money(I.d.discount) || 0, paid: money(I.d.paid) || 0 };
  try {
    const inv = I.id ? await S.store.updateInvoice(I.id, data, dfmt()) : await S.store.createInvoice(data, dfmt());
    sheetClose = null; I = null;
    await reload();
    toast(t('inv.saved', { x: inv.no }));
    invoiceSheet(inv.id);
  } catch (err) { btn.disabled = false; btn.innerHTML = `${icon('invoice', 18)}<span>${t('inv.retry')}</span>`; throw err; }
}
let curInv = null;
function invoiceSheet(id) {
  const inv = S.invoices.find(i => i.id === id); if (!inv) return;
  const c = cust(inv.customerId);
  const local = S.store.kind === 'local';
  curInv = { id, blob: null };
  sheet({ title: `<span dir="ltr">${esc(inv.no)}</span>`, sub: `${esc(c?.name || inv.cust?.name || '')} · ${fmtDay(inv.issue)}`, cls: 'wide',
    body: `<section class="inv-sum">
      <div><small>${t('inv.total')}</small><b class="amt">${baht(inv.t?.total || 0)}</b></div>
      <div class="r">${invPill(inv.status)}${inv.status !== 'paid' ? `<small>${t('inv.bal')} ${baht(inv.t?.bal || 0)}</small>` : ''}</div></section>
      <div class="inv-pv-wrap"><div class="inv-pv">${invoiceHtml(inv, S.company || {}, dfmt())}</div></div>
      ${local ? `<p class="note">${icon('info', 15)}<span>${t('inv.localNote')}</span></p>` : `<p class="muted">${t('inv.savedIn', { x: FOLDER.pay.th })}</p>`}`,
    foot: `${c ? `<button class="icon-btn" data-act="open-customer" data-id="${esc(c.id)}" title="${t('inv.openCustomer')}">${icon('users', 17)}</button>` : ''}
      <button class="icon-btn" data-act="inv-edit" data-need="edit" data-id="${esc(id)}" title="${t('inv.editBtn')}">${icon('edit', 17)}</button>
      ${inv.status !== 'paid' ? `<button class="btn ghost" data-act="inv-paid" data-need="edit" data-id="${esc(id)}">${icon('check', 17)}<span>${t('inv.markPaid')}</span></button>` : ''}
      <span class="sp"></span>
      ${local ? `<button class="btn primary" data-act="inv-print" data-id="${esc(id)}">${icon('download', 18)}<span>${t('inv.print')}</span></button>`
        : `<button class="btn primary" data-act="inv-share" id="invShare" disabled>${icon(navigator.share ? 'share' : 'download', 18)}<span>${t(navigator.share ? 'inv.share' : 'inv.download')}</span></button>`}` });
  if (!local) S.store.getBlob(id).then(b => { if (curInv?.id !== id) return; curInv.blob = b; const sb = $('#invShare'); if (sb) sb.disabled = false; }).catch(handleError);
}
function printInvoice(inv) {
  const root = $('#print-root');
  root.innerHTML = `<style>${INVOICE_CSS}</style>${invoiceHtml(inv, S.company || {}, dfmt())}`;
  document.body.classList.add('printing');
  setTimeout(() => { window.print(); setTimeout(() => { document.body.classList.remove('printing'); root.innerHTML = ''; }, 500); }, 300);
}

/* ---------- company details (admin) ---------- */
let CO = null;
async function companySheet() {
  CO = { logo: null, remove: false };
  const co = S.company || await S.store.getSettings();
  S.company = co;
  const ro = !isAdmin(), dis = ro ? 'disabled' : '';
  const f = (k, label, attrs = '') => `<label class="fld"><span class="fl">${label}</span><input name="${k}" value="${esc(co[k] || '')}" ${attrs} ${dis}></label>`;
  const ta = (k, label) => `<label class="fld"><span class="fl">${label}</span><textarea name="${k}" rows="3" ${dis}>${esc(co[k] || '')}</textarea></label>`;
  sheet({ title: t('co.title'), sub: ro ? t('co.subRo') : t('co.sub'), cls: 'wide',
    body: `<form class="form" data-form="company" id="coform">
      <div class="logo-row"><span class="logo-box" id="logoBox">${co.logo ? `<img src="${esc(co.logo)}" alt="">` : icon('image', 28)}</span>
        ${ro ? '' : `<div><button type="button" class="btn ghost" data-act="co-logo">${icon('gallery', 17)}<span>${t('co.logo')}</span></button>${co.logo ? `<button type="button" class="btn danger-ghost" data-act="co-logo-rm">${t('co.logoRm')}</button>` : ''}</div>`}</div>
      <div class="fgrid">${f('name', t('co.name'), 'maxlength="160"')}${f('nameEn', t('co.nameEn'), 'maxlength="160"')}${f('phone', t('co.phone'), 'inputmode="tel"')}${f('email', t('co.email'), 'type="email"')}${f('taxId', t('co.tax'), 'inputmode="numeric"')}${f('prefix', t('co.prefix'), 'maxlength="8" autocapitalize="characters"')}</div>
      ${ta('address', t('co.address'))}${ta('bank', t('co.bank'))}${ta('footer', t('co.footer'))}
    </form>`,
    foot: ro ? `<span class="sp"></span><button class="btn ghost" data-act="close-sheet">${t('btn.close')}</button>` : `<span class="sp"></span><button type="button" class="btn ghost" data-act="close-sheet">${t('btn.cancel')}</button><button class="btn primary" type="submit" form="coform">${t('btn.save')}</button>` });
}
async function pickLogo() {
  const [file] = await pickFiles({ accept: 'image/png,image/jpeg,image/webp', multiple: false });
  if (!file) return;
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 600 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  const png = file.type === 'image/png';
  const url = cv.toDataURL(png ? 'image/png' : 'image/jpeg', 0.9);
  CO.logo = { mime: png ? 'image/png' : 'image/jpeg', data: url.split(',')[1] };
  CO.remove = false;
  $('#logoBox').innerHTML = `<img src="${url}" alt="">`;
}

/* ---------- Drive folders for existing customers (admin): check first, then create ---------- */
function migrateSheet() {
  sheet({ title: t('mig.title'), sub: t('mig.sub'), cls: 'wide', body: `<p class="note">${icon('info', 15)}<span>${t('mig.explain')}</span></p>
    <ul class="mig-names">${FOLDERS.map(F => `<li><b>${F.th}</b><small>${t('fo.' + F.slot)}</small></li>`).join('')}</ul><div id="migOut"></div>`,
    foot: `<span class="sp"></span><button class="btn primary" data-act="mig-run" data-dry="1" id="migGo">${t('mig.dry')}</button>` });
}
async function migRun(dry, btn) {
  btn.disabled = true;
  const out = $('#migOut');
  const rows = [];
  let from = 0, total = 0;
  try {
    do {
      out.innerHTML = `<p class="as-tip"><span class="spin sm"></span>${t('mig.working', { a: from, b: total || '…' })}</p>`;
      const r = await S.store.migrate(dry, from);
      total = r.total; rows.push(...r.rows); from = r.next;
    } while (from !== null && document.contains(out));
  } finally { btn.disabled = false; }
  const need = rows.filter(r => r.create.length || r.adopt.length);
  const nCreate = rows.reduce((a, r) => a + r.create.length, 0), nAdopt = rows.reduce((a, r) => a + r.adopt.length, 0), nLoose = rows.reduce((a, r) => a + r.loose, 0);
  out.innerHTML = `<section class="mig-rep">
    <h3>${dry ? t('mig.repDry') : t('mig.repDone')}</h3>
    <div class="mig-k"><div><b>${num(rows.length)}</b><small>${t('mig.kCust')}</small></div><div><b>${num(nCreate)}</b><small>${dry ? t('mig.kCreate') : t('mig.kCreated')}</small></div><div><b>${num(nAdopt)}</b><small>${t('mig.kAdopt')}</small></div><div><b>${num(nLoose)}</b><small>${t('mig.kLoose')}</small></div></div>
    <p class="muted">${t('mig.safe')}</p>
    ${need.length ? `<details ${need.length < 15 ? 'open' : ''}><summary>${t('mig.list', { n: need.length })}</summary><ul class="mig-list">${need.map(r => `<li><b>${esc(r.name)}</b><small>${r.create.length ? t('mig.willCreate', { n: r.create.length }) : ''}${r.adopt.length ? ' · ' + t('mig.willAdopt', { n: r.adopt.length }) : ''}${r.loose ? ' · ' + t('mig.loose', { n: r.loose }) : ''}</small></li>`).join('')}</ul></details>` : `<p>${t('mig.nothing')}</p>`}
  </section>`;
  if (dry && need.length) { btn.dataset.dry = ''; btn.textContent = t('mig.run'); btn.classList.replace('primary', 'danger-solid'); }
  else { btn.dataset.dry = '1'; btn.textContent = t('mig.dry'); btn.classList.replace('danger-solid', 'primary'); }
  if (!dry) reload().catch(() => { });
}

/* ---------- assistant ---------- */
function assistantSheet() {
  const first = S.customers[0]?.name;
  const chips = [t('a.c1'), t('a.c2'), t('a.c3'), first ? t('a.c4', { x: first }) : '', t('a.c5'), canEdit() ? t('a.c6') : ''].filter(Boolean);
  sheet({ cls: 'wide assistant', top: `<div class="as-box">${icon('sparkle', 22)}<input id="asq" type="search" placeholder="${esc(t('a.ph'))}" autocomplete="off"><button class="icon-btn" data-act="close-sheet" aria-label="${t('btn.close')}">${icon('x', 18)}</button></div>`,
    body: `<div class="chips">${chips.map(c => `<button data-act="as-chip">${esc(c)}</button>`).join('')}</div>
    <div class="as-res" id="asRes"><p class="as-tip">${t('a.tip')}</p></div>` });
  setTimeout(() => $('#asq')?.focus(), 350);
}
function drawAsk(q) {
  const el = $('#asRes'); if (!el) return;
  if (!q.trim()) { el.innerHTML = `<p class="as-tip">${t('a.tip')}</p>`; return; }
  const r = ask(q, S);
  el.innerHTML = `<p class="as-ans">${icon('sparkle', 16)}<span>${esc(r.answer)}</span></p>
    ${r.action && canEdit() ? `<button class="btn primary" data-act="as-new" data-name="${esc(r.action.name)}">${icon('userplus', 18)}<span>${t('a.create', { x: esc(r.action.name) })}</span></button>` : ''}
    ${r.customers.map(c => `<button class="as-row" data-act="open-customer" data-id="${esc(c.id)}"><span class="ava" style="--h:${hue(c.id)}">${esc(initial(c.name))}</span><span><b>${esc(c.name)}</b><small>${t('a.open')}${c.plate ? ' · ' + esc(c.plate) : ''}</small></span>${icon('chev', 16)}</button>`).join('')}
    ${r.files.map(f => { const c = cust(f.customerId) || { name: '—' }; return `<button class="as-row" data-act="open-file" data-id="${esc(f.id)}">${ftBadge(f, 18, 'sm')}<span><b>${esc(f.name)}</b><small>${esc(c.name)} · ${typeLabel(f.type)} · ${f.expiry ? t('e.expiry') + ' ' + fmtDay(f.expiry) : fmtDay(f.createdAt)}</small></span>${icon('chev', 16)}</button>`; }).join('')}`;
}

/* ---------- settings ---------- */
function settingsSheet() {
  const cloud = S.mode === 'cloud', signedIn = cloud && S.me && !S.gate;
  const dfs = [['ce', t('df.ce')], ['be', t('df.be')], ...(lang === 'fa' ? [['fa', t('df.fa')]] : [])];
  const card = (ic, title, sub, actions) => `<div class="set-card"><div class="set-h">${icon(ic, 22)}<div><b>${title}</b><small>${sub}</small></div></div>${actions ? `<div class="sh-actions">${actions}</div>` : ''}</div>`;
  sheet({ title: t('settings'), sub: t('set.sub'), cls: 'wide', body: `
    <div class="set">
      <div class="seg" role="group" aria-label="${t('set.lang')}">${Object.entries(LANGS).map(([k, l]) => `<button class="${k === lang ? 'on' : ''}" data-act="lang" data-l="${k}">${l}</button>`).join('')}</div>
      <div class="set-card"><span class="lbl">${t('set.datefmt')}</span>
        <div class="seg" role="group">${dfs.map(([k, l]) => `<button class="${k === dateFmt() ? 'on' : ''}" data-act="datefmt" data-v="${k}">${l}</button>`).join('')}</div>
        <span class="set-note">${t('set.dateNote', { x: fmtDay(todayIso()) })}</span></div>
      ${cloudReady() ? `<div class="set-card ${cloud ? 'on' : ''}">
        <div class="set-h">${icon('cloud', 22)}<div><b>${t('set.cloud')}</b><small>${signedIn ? `${t('set.cloud.on', { x: `<bdi>${esc(S.me.email)}</bdi>` })} · <em class="role-chip r-${S.role}">${t('role.' + S.role)}</em>` : t('set.cloud.off')}</small></div></div>
        <div class="sh-actions">${signedIn
          ? `${isAdmin() ? `<button class="btn primary" data-act="team">${icon('team', 18)}<span>${t('set.team')}</span></button>` : ''}${S.me.root ? `<button class="btn ghost" data-act="open-root">${icon('external', 17)}<span>${t('set.folder')}</span></button>` : ''}<span class="sp"></span><button class="btn danger-ghost" data-act="sign-out">${icon('logout', 17)}<span>${t('set.signout')}</span></button>`
          : `<span class="sp"></span><button class="btn primary" data-act="mode-cloud">${icon('cloud', 18)}<span>${t('set.signin')}</span></button>`}</div>
      </div>` : ''}
      ${S.store ? card('invoice', t('co.title'), isAdmin() ? t('co.sub') : t('co.subRo'), `<span class="sp"></span><button class="btn ghost" data-act="company">${icon('edit', 17)}<span>${t('co.title')}</span></button>`) : ''}
      ${signedIn && isAdmin() ? card('folder', t('mig.title'), t('mig.sub'), `<span class="sp"></span><button class="btn ghost" data-act="migrate">${icon('folder', 17)}<span>${t('mig.dry')}</span></button>`) : ''}
      ${cloud ? `<div class="set-card"><div class="set-h">${icon('wand', 22)}<div><b>${t('ai.status')}</b><small>${S.store?.aiReady ? t('ai.on') : t('ai.off')}</small></div><span class="sp"></span><em class="st-badge ${S.store?.aiReady ? 'ok' : 'off'}">${S.store?.aiReady ? t('ai.ready') : t('ai.notSet')}</em></div></div>` : ''}
      <div class="set-card ${!cloud ? 'on' : ''}">
        <div class="set-h">${icon('folder', 22)}<div><b>${t('set.demo')}</b><small>${t('set.local.text')}</small></div></div>
        <div class="sh-actions">${!cloud ? `<button class="btn ghost" data-act="seed">${t('set.seed')}</button><button class="btn danger-ghost" data-act="wipe">${t('set.wipe')}</button>` : `<span class="sp"></span><button class="btn ghost" data-act="mode-local">${t('set.use')}</button>`}</div>
      </div>
      <p class="ver">${t('set.ver', { v: digits(APP_VERSION) })}</p>
    </div>` });
}

/* ---------- team & access (admin) ---------- */
const roleOpts = sel => ['admin', 'editor', 'viewer'].map(r => `<option value="${r}" ${r === sel ? 'selected' : ''}>${t('role.' + r)}</option>`).join('');
function teamSheet() {
  sheet({ title: t('team.title'), sub: t('team.sub'), cls: 'wide', body: `
    <form class="team-add" data-form="team-add">
      <input name="email" type="email" required dir="ltr" placeholder="name@gmail.com" aria-label="${t('team.email')}" autocomplete="off">
      <select name="role" aria-label="${t('fl.type')}">${roleOpts('editor')}</select>
      <button class="btn primary">${icon('userplus', 18)}<span>${t('team.add')}</span></button>
    </form>
    <div class="roles">${['admin', 'editor', 'viewer'].map(r => `<span><em class="role-chip r-${r}">${t('role.' + r)}</em>${t('role.' + r + '.d')}</span>`).join('')}</div>
    <div class="team-list" id="teamList"><p class="as-tip"><span class="spin sm"></span>${t('team.loading')}</p></div>` });
  run(async () => drawTeam(await S.store.aclList()));
}
function drawTeam(list) {
  const el = $('#teamList'); if (!el) return;
  const me = S.me?.email;
  el.innerHTML = list.map((p, i) => `
    <div class="team-row" style="--i:${Math.min(i, 10)}">
      <span class="ava" style="--h:${hue(p.email)}">${esc(p.email[0].toUpperCase())}</span>
      <span class="tmain"><b dir="ltr">${esc(p.email)}</b><small>${p.owner ? t('role.owner') : t('role.' + p.role + '.d')}${p.email === me ? ` · ${t('team.you')}` : ''}</small></span>
      ${p.owner ? `<em class="role-chip r-admin">${t('role.owner')}</em>` : `<select data-team-role="${esc(p.email)}" aria-label="${esc(p.email)}">${roleOpts(p.role)}</select>
      <button class="icon-btn sm danger" data-act="team-remove" data-email="${esc(p.email)}" title="${t('team.remove')}">${icon('trash', 15)}</button>`}
    </div>`).join('');
}

function changeLang(l) {
  setLang(l); applyStatic(); sortCustomers(); closeSheet(); mount();
}

/** Upload target: the open case file on the dashboard, else the customer filter; otherwise ask */
const uploadTarget = () => S.view === 'dash' ? S.sel : S.filters.customer || '';

/* ================= actions ================= */
const EDIT_ACTS = new Set(['upload', 'camera', 'add-file', 'do-upload', 'up-more', 'new-customer', 'edit-customer', 'del-file', 'del-customer', 'as-new', 'ai-new', 'new-invoice', 'inv-save', 'inv-paid', 'inv-edit', 'dup-update', 'dup-apply', 'dup-create', 'pick-customer', 'add']);
const ACT = {
  go(el) { S.view = el.dataset.view; S.mobileDetail = false; closeSheet(); mount(); scrollTo({ top: 0, behavior: 'smooth' }); },
  'close-sheet': closeSheet,
  'close-overlay'(el, e) { if (e.target === el) closeSheet(); },
  'confirm-yes'() { const r = confirmRes; confirmRes = null; closeSheet(); r?.(true); },
  settings: settingsSheet,
  assistant: assistantSheet,
  team: teamSheet,
  company: companySheet,
  migrate: migrateSheet,
  async 'mig-run'(el) {
    if (el.dataset.dry) return migRun(true, el);
    if (!await confirmBox(t('mig.confirm'), t('mig.run'), false)) return migrateSheet();
    migrateSheet();
    return migRun(false, $('#migGo'));
  },
  lang(el) { changeLang(el.dataset.l); },
  datefmt(el) { setDateFmt(el.dataset.v); settingsSheet(); drawAll(false); },
  reload() { location.reload(); },
  add: addSheet,
  upload() {
    const cid = uploadTarget();
    if (!cust(cid)) return pickCustomerSheet('file');
    const folder = S.view === 'dash' && FOLDER[S.folderTab] ? S.folderTab : '';
    pickFiles().then(files => files.length && run(() => startUpload(files, cid, folder)));
  },
  camera() {
    const cid = uploadTarget();
    if (!cust(cid)) return pickCustomerSheet('file');
    const folder = S.view === 'dash' && FOLDER[S.folderTab] ? S.folderTab : '';
    pickFiles({ capture: true, accept: 'image/*', multiple: false }).then(files => files.length && run(() => startUpload(files, cid, folder)));
  },
  'add-file'(el) {
    const cid = S.sel, folder = el.dataset.folder || '';
    if (!cust(cid)) return pickCustomerSheet('file');
    sourceSheet(files => startUpload(files, cid, folder));
  },
  'new-customer'() { customerSheet(); },
  'edit-customer'() { customerSheet(cust(S.sel)); },
  'pick-customer'(el) { pickCustomerSheet(el.dataset.next || 'file'); },
  picked(el) {
    const id = el.dataset.id;
    if (el.dataset.next === 'invoice') return newInvoice(id);
    S.sel = id;
    sourceSheet(files => startUpload(files, id));
  },
  async src(el) {
    const cb = srcCb; if (!cb) return;
    const cam = el.dataset.src === 'cam';
    const files = await pickFiles({ capture: cam, accept: cam ? 'image/*' : cb.accept, multiple: !cam });
    if (files.length) { srcCb = null; cb.onPick(files); }
  },
  select(el) { S.sel = el.dataset.id; S.mobileDetail = true; drawPanel(true); loadThumbs(); if (narrow()) $('#panel').scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  back() { S.mobileDetail = false; drawPanel(false); },
  tab(el) { S.folderTab = el.dataset.folder; drawPanel(true); loadThumbs(); },
  'clear-filters'() { S.filters = noFilters(); drawFilters(true); drawResults(true); },
  'open-customer'(el) { openCustomer(el.dataset.id); },
  'open-file'(el) { return openFile(el.dataset.id); },
  'open-link'(el) { window.open(el.dataset.url, '_blank', 'noopener'); },
  'open-root'() { if (S.me?.root) window.open('https://drive.google.com/drive/folders/' + encodeURIComponent(S.me.root), '_blank', 'noopener'); },
  async 'up-more'() {
    const files = sizeFilter(await pickFiles());
    if (!U) return;
    for (const file of files) U.items.push(newItem(file));
    drawUpload(); aiQueue();
  },
  'up-remove'(el) { if (!U) return; U.items.splice(+el.closest('.up-row').dataset.i, 1); U.items.length ? drawUpload() : closeSheet(); },
  'do-upload': doUpload,
  'pick-folder'(el) {
    const slot = el.dataset.folder, name = el.dataset.name;
    if (name === 'up' && U) { const it = U.items[+el.dataset.i]; it.folder = slot; it.picked = true; it.type = typeFor(slot, it.n?.docType); if (slot === 'policy' && !it.expiry && it.n?.values.policyExpiry) it.expiry = it.n.values.policyExpiry; drawUpload(); }
    else if (name === 'rv' && R) { R.v = { ...R.v, ...readForm($('#rvform'), ALL_FIELDS) }; R.folder = slot; for (const b of $$('[data-name="rv"]')) { b.classList.toggle('on', b.dataset.folder === slot); b.setAttribute('aria-checked', b.dataset.folder === slot); } }
    else if (name === 'move') return moveCur(slot);
  },
  'ai-new'(el) {
    if (!el.dataset.src) { if (!aiOn()) return toast(S.mode === 'local' ? t('ai.localOnly') : t('ai.off'), 'err'); return sourceSheet(files => aiNewFiles(files), { title: t('add.ai'), accept: DOC_ACCEPT }); }
    return aiNew(el.dataset.src);
  },
  'ai-retry'() { if (R) aiNewFiles(R.files); },
  'ai-manual'() { if (!R) return; R.n = null; R.v = {}; reviewSheet(); },
  'pv-zoom'(el) { if (R) window.open(R.previews[+el.dataset.i], '_blank', 'noopener'); },
  'pv-open'(el) { if (R) window.open(objUrl(R.files[+el.dataset.i]), '_blank', 'noopener'); },
  'dup-back'() { if (R) reviewSheet(); },
  'dup-create'() { if (R) return createFromReview(); },
  'dup-update'(el) { if (R) dupUpdate(el.dataset.id); },
  'dup-apply'(el) { if (R) return dupApply(el.dataset.id, el); },
  'dl-file'() { if (cur?.blob) download(cur.blob, cur.f.name); },
  'share-file'() { if (cur?.blob) return shareBlob(cur.blob, cur.f.name); },
  async 'del-file'(el) {
    const f = S.files.find(x => x.id === el.dataset.id);
    if (!await confirmBox(t('del.file', { x: esc(f.name) }) + t(S.store.kind === 'cloud' ? 'del.drive' : 'del.local'))) return;
    await S.store.deleteFile(f.id); await reload(); toast(t('t.fileDeleted'));
  },
  async 'del-customer'(el) {
    const c = cust(el.dataset.id), n = S.files.filter(f => f.customerId === c.id).length;
    if (!await confirmBox((n ? t('del.customerN', { x: esc(c.name), n }) : t('del.customer', { x: esc(c.name) })) + t(S.store.kind === 'cloud' ? 'del.drive' : 'del.local'))) return;
    await S.store.deleteCustomer(c.id); S.mobileDetail = false; await reload(); toast(t('t.customerDeleted'));
  },
  'new-invoice'(el) { const id = el.dataset.id || (S.view === 'dash' ? S.sel : S.filters.customer); if (!cust(id)) return pickCustomerSheet('invoice'); newInvoice(id); },
  'inv-tab'(el) { I.tab = el.dataset.v; invoiceEditor(); },
  'inv-lang'(el) {
    const old = I.d.lang, l = el.dataset.v; I.d.lang = l;
    for (const it of I.d.items) if (it.d === invItemDefault(old)) it.d = invItemDefault(l);
    for (const b of $$('[data-act="inv-lang"]')) b.classList.toggle('on', b.dataset.v === l);
    $('#invItems').innerHTML = invItemsHtml();
  },
  'inv-add-line'() { I.d.items.push({ d: '', q: 1, p: '' }); $('#invItems').innerHTML = invItemsHtml(); $(`[data-i="items.${I.d.items.length - 1}.d"]`)?.focus(); },
  'inv-del-line'(el) { I.d.items.splice(+el.dataset.i, 1); $('#invItems').innerHTML = invItemsHtml(); $('#invTot').innerHTML = invTotalsHtml(); },
  'inv-save'(el) { return invSave(el); },
  'open-invoice'(el) { invoiceSheet(el.dataset.id); },
  'inv-edit'(el) { editInvoice(el.dataset.id); },
  async 'inv-paid'(el) {
    const inv = S.invoices.find(i => i.id === el.dataset.id);
    if (!await confirmBox(t('inv.paidQ', { x: esc(inv.no), y: baht(inv.t?.total || 0) }), t('inv.markPaid'), false)) return;
    toast(t('inv.making'));
    const x = await S.store.updateInvoice(inv.id, { paid: inv.t.total }, dfmt());
    await reload(); toast(t('inv.paidDone')); invoiceSheet(x.id);
  },
  'inv-share'() { if (curInv?.blob) return shareBlob(curInv.blob, (S.invoices.find(i => i.id === curInv.id)?.no || 'invoice') + '.pdf'); },
  'inv-print'(el) { const inv = S.invoices.find(i => i.id === el.dataset.id); if (inv) printInvoice(inv); },
  'co-logo'() { return pickLogo(); },
  'co-logo-rm'() { CO.remove = true; CO.logo = null; $('#logoBox').innerHTML = icon('image', 28); },
  'as-chip'(el) { const i = $('#asq'), more = el.textContent.includes('…'); i.value = el.textContent.replace('…', '').trim() + (more ? ' ' : ''); i.focus(); drawAsk(more ? '' : i.value); },
  'as-new'(el) { customerSheet({ name: el.dataset.name }); },
  async seed() { if (S.store?.kind !== 'local') return; closeSheet(); await seedDemo(S.store, lang); await reload(true); toast(t('t.seeded')); },
  async wipe() {
    if (S.store?.kind !== 'local') return;
    if (!await confirmBox(t('wipe.q'), t('wipe.ok'))) return;
    for (const c of S.customers) await S.store.deleteCustomer(c.id);
    await reload(true); toast(t('t.wiped'));
  },
  async 'mode-local'() { setMode('local'); closeSheet(); S.company = null; await connect(); },
  async 'mode-cloud'() { setMode('cloud'); closeSheet(); S.company = null; await connect(); },
  async 'sign-out'() { auth.signOut(); S.me = null; S.store = null; S.customers = []; S.files = []; S.invoices = []; S.company = null; applyRole(); closeSheet(); showGate('signin'); },
  async retry() { auth.drop(); const tok = await auth.getToken(); if (tok) enterCloud(); else showGate('signin'); },
  async 'switch-account'() { auth.signOut(); showGate('signin'); },
  async 'team-remove'(el) {
    const email = el.dataset.email;
    if (!await confirmBox(t('team.removeQ', { x: `<b dir="ltr">${esc(email)}</b>` }), t('team.remove'))) return;
    const list = await S.store.aclRemove(email);
    teamSheet(); drawTeam(list); toast(t('team.removed', { x: email }));
  },
};

/* ================= events ================= */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  if (el.tagName === 'A') e.preventDefault();
  const act = el.dataset.act, fn = ACT[act];
  if (!fn) return;
  if (EDIT_ACTS.has(act) && !canEdit()) return toast(t('err.role'), 'err');
  run(() => fn(el, e));
});

document.addEventListener('submit', e => {
  const form = e.target.closest('[data-form]'); if (!form) return;
  e.preventDefault();
  const kind = form.dataset.form;
  const btn = $(`[form="${form.id}"]`) || form.querySelector('.btn.primary');
  run(async () => {
    if (kind === 'team-add') {
      const d = Object.fromEntries(new FormData(form));
      const email = d.email.trim().toLowerCase();
      const b = form.querySelector('button'); b.disabled = true;
      try { drawTeam(await S.store.aclSet(email, d.role)); form.reset(); toast(t('team.added', { x: email })); }
      finally { b.disabled = false; }
      return;
    }
    if (kind === 'company') {
      if (!isAdmin()) return toast(t('err.role'), 'err');
      const s = Object.fromEntries(new FormData(form));
      if (CO.logo) s.logo = CO.logo;
      if (CO.remove) s.removeLogo = true;
      if (btn) btn.disabled = true;
      try { S.company = await S.store.saveSettings(s); closeSheet(); toast(t('co.saved')); }
      finally { if (btn?.isConnected) btn.disabled = false; }
      return;
    }
    if (kind === 'invoice') return;
    if (!canEdit()) return toast(t('err.role'), 'err');
    if (btn) btn.disabled = true;
    try {
      if (kind === 'customer') await saveCustomerForm(form);
      else if (kind === 'review') await confirmReview(form);
      else if (kind === 'file') {
        const d = Object.fromEntries(new FormData(form));
        const f = S.files.find(x => x.id === form.dataset.id);
        await S.store.updateFile({ ...f, name: d.name.trim() || f.name, type: d.type, expiry: d.expiry || '', note: d.note.trim() });
        closeSheet(); await reload(); toast(t('t.saved'));
      }
    } finally { if (btn?.isConnected) btn.disabled = false; }
  });
});

let qT;
document.addEventListener('input', e => {
  const el = e.target;
  if (el.id === 'langSel') changeLang(el.value);
  else if (el.dataset.teamRole) run(async () => { drawTeam(await S.store.aclSet(el.dataset.teamRole, el.value)); toast(t('team.changed')); });
  else if (el.dataset.f) {
    S.filters[el.dataset.f] = el.value;
    if (el.dataset.f === 'customer' && el.value && S.view === 'dash') { S.sel = el.value; S.mobileDetail = true; }
    if (el.dataset.f === 'q') { clearTimeout(qT); qT = setTimeout(() => { drawFilters(); drawResults(false); }, 120); }
    else { drawFilters(true); drawResults(true); }
  }
  else if (el.dataset.u && U) { const it = U.items[+el.closest('.up-row').dataset.i]; it[el.dataset.u] = el.value; }
  else if (el.dataset.diff && U) { U.toggles[el.dataset.diff] = el.checked; drawUpload(); }
  else if (el.dataset.r && R && el.closest('#rvform')) { R.v[el.dataset.r] = el.value; el.closest('.fld')?.classList.remove('ai-lo', 'ai-mid', 'has-err'); }
  else if (el.dataset.i && I) {
    const p = el.dataset.i;
    setPath(I.d, p, el.type === 'checkbox' ? el.checked : el.value);
    const m = p.match(/^items\.(\d+)\./);
    if (m) { const it = I.d.items[+m[1]]; const la = $('#la' + m[1]); if (la) la.textContent = baht(lineAmount({ q: +latinDigits(it.q) || 0, p: it.p })); }
    $('#invTot').innerHTML = invTotalsHtml();
  }
  else if (el.id === 'asq') drawAsk(el.value);
});
// checkboxes fire "change" (not always "input") in older Safari
document.addEventListener('change', e => {
  const el = e.target;
  if (el.type !== 'checkbox') return;
  if (el.dataset.diff && U) { U.toggles[el.dataset.diff] = el.checked; drawUpload(); }
  if (el.dataset.i === 'vat' && I) { I.d.vat = el.checked; $('#invTot').innerHTML = invTotalsHtml(); }
});

// drag & drop, and paste from the clipboard (editors only): files go to the open case file
let dragN = 0;
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files') && canEdit() && !S.gate;
addEventListener('dragenter', e => { if (hasFiles(e)) { dragN++; $('#drop').classList.add('on'); } });
addEventListener('dragleave', e => { if (hasFiles(e) && --dragN <= 0) { dragN = 0; $('#drop').classList.remove('on'); } });
addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragN = 0; $('#drop').classList.remove('on');
  const dc = e.target.closest?.('[data-customer]'); if (dc) S.sel = dc.dataset.customer;
  const sec = e.target.closest?.('[data-folder]');
  const cid = dc ? S.sel : uploadTarget();
  if (!cust(cid)) return toast(t('add.fileSub'), 'err');
  run(() => startUpload(e.dataTransfer.files, cid, FOLDER[sec?.dataset.folder] ? sec.dataset.folder : ''));
});
addEventListener('paste', e => {
  const f = e.clipboardData?.files;
  if (!f?.length || !canEdit() || S.gate || e.target.closest('input,textarea') || $('#sheet-root .overlay')) return;
  const cid = uploadTarget(); if (!cust(cid)) return;
  e.preventDefault(); run(() => startUpload(f, cid));
});

addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !S.gate) { e.preventDefault(); assistantSheet(); }
  if (e.key === 'Escape') closeSheet();
});
addEventListener('resize', syncChrome);
document.addEventListener('error', e => { const img = e.target; if (img.matches?.('img.th')) img.outerHTML = `<span class="ft">${icon(img.dataset.ic || 'file', 26)}</span>`; }, true);

// 3D card tilt following the mouse
let tiltEl = null;
const untilt = el => { el.classList.remove('tilting'); el.style.removeProperty('--rx'); el.style.removeProperty('--ry'); };
document.addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse') return;
  const el = e.target.closest?.('.tilt');
  if (tiltEl && tiltEl !== el) untilt(tiltEl);
  tiltEl = el; if (!el) return;
  const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
  el.classList.add('tilting');
  el.style.setProperty('--ry', ((x - .5) * 9).toFixed(2) + 'deg');
  el.style.setProperty('--rx', ((.5 - y) * 9).toFixed(2) + 'deg');
  el.style.setProperty('--mx', (x * 100).toFixed(1) + '%');
  el.style.setProperty('--my', (y * 100).toFixed(1) + '%');
});
document.documentElement.addEventListener('pointerleave', () => { if (tiltEl) untilt(tiltEl); tiltEl = null; });

// Swipe a sheet down by its handle to close it (phone)
let drag = null;
document.addEventListener('pointerdown', e => {
  const g = e.target.closest('.grab, .sh-head'); if (!g || e.pointerType === 'mouse' || e.target.closest('button,input,select')) return;
  const sh = g.closest('.sheet'); if (!sh) return;
  drag = { sh, y: e.clientY, dy: 0 };
  sh.style.transition = 'none';
});
document.addEventListener('pointermove', e => { if (!drag) return; drag.dy = Math.max(0, e.clientY - drag.y); drag.sh.style.transform = `translateY(${drag.dy}px)`; });
const endDrag = () => { if (!drag) return; const { sh, dy } = drag; drag = null; sh.style.transition = ''; sh.style.transform = ''; if (dy > 110) closeSheet(); };
document.addEventListener('pointerup', endDrag); document.addEventListener('pointercancel', endDrag);

addEventListener('offline', () => toast(t('err.offline'), 'err'));

/* ================= start ================= */
{ const st = document.createElement('style'); st.textContent = INVOICE_CSS; document.head.append(st); }
for (const el of $$('[data-ico]')) el.outerHTML = icon(el.dataset.ico, el.closest('.tabbar') ? 22 : 18);
$('#langSel').innerHTML = Object.entries(LANGS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
applyStatic();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  // When a new version takes over right after the app opened, reload once so the new files are used.
  // Not later in the session, so nothing the user is typing is lost.
  const hadController = !!navigator.serviceWorker.controller, openedAt = Date.now();
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded && Date.now() - openedAt < 20000) { reloaded = true; location.reload(); }
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => { });
}
if (location.hash) history.replaceState(null, '', location.pathname + location.search);   // old v3 links like #/customers
document.fonts?.ready.then(syncChrome);
run(connect);
