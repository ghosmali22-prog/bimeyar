import { APP_VERSION, API_URL, MAX_UPLOAD_MB, FOLDERS } from './config.js';
import { t, num, lang, setLang, applyDir, LANGS } from './i18n.js';
import { $, $$, esc, digits, norm, fmtDay, dateFmt, setDateFmt, todayIso, addDays, monthKey, monthName, daysLeft, fmtSize, TYPES, typeLabel, isImage, isPdf, icon, hue, makeThumb, compressImage } from './util.js';
import { LocalStore } from './store-local.js';
import { ApiStore } from './store-remote.js';
import * as auth from './auth.js';
import * as device from './device.js';
import { ask } from './assistant.js';
import { seedDemo } from './demo.js';
import { calcTotals, baht, lineAmount, invoiceHtml, INVOICE_CSS } from './invoice.js';
import { prepare, normalize, diff, fileNote, FIELD_GROUPS, DATE_FIELDS } from './ai.js';
import { checkCustomer, findDuplicates, thaiPhone, money, latinDigits } from './validate.js';
import { buildName, docNameFromOld, plateOnly, plateFromName, followsPattern, monthOf, extOf, withExt, safeName, uniqueIn } from './naming.js';
import { VSLOTS, VSLOT, FILE_SLOTS, VFIELDS, VGROUPS, vehiclesOf, latestOf, byMonth, ymText, ymFolder, ymForVehicle, vehicleFileName, slotFromAi, findCustomer, findVehicle, allVehicles, batchHint, searchVehicles, movePlan, moveName, plateKey, nameKey, needsAiRead, detectVehicles, aiEditSuggest } from './vehicles.js';
import { PRB_FIELDS, prbStatus, sortRows, prbTotals, vatCheck, prbFileName, rowFromAi, isPrbDoc, findDup, prbSanity, suggestInsured, groupInsured, prbPost, suggestPolicyNo, majorityName, consensusName, spellingChoices } from './prb.js';
import { parseDate } from './dates.js';

/*
 * Layout = the v2 design (dashboard with stat cards, dark customer panel with the purple case file,
 * Files, Renewals). v3 features live inside it: policy status, 4 Drive folders, invoices, AI.
 */

const cloudReady = () => auth.configured() && !!API_URL;
let savedMode = null;
try { savedMode = localStorage.getItem('by_mode'); } catch { }

const S = {
  view: 'dash', customers: [], files: [], invoices: [], vehicles: [], exp: {}, vexp: {}, renew: [], company: null, sel: null, store: null,
  openVeh: '', openSlot: '',   // v4: the open vehicle card and folder in the case file
  gate: null,            // null | 'loading' | 'signin' | 'expired' | 'deny' | 'config' | 'gis' | 'unlock' | 'setpin' (v3.3)
  pinLeft: null, pinMsg: '',   // unlock screen: wrong attempts left / message
  denied: '', role: 'admin', me: null,
  mode: savedMode === 'local' || !cloudReady() ? 'local' : 'cloud',
  filters: { customer: '', type: '', period: '', q: '', status: '', inv: '' },
  folderTab: '', mobileDetail: false,
};
const cust = id => S.customers.find(c => c.id === id);
/** v4: vehicles of a customer (records + the legacy "vehicle #1" from the customer details), newest month first */
const vehOf = c => vehiclesOf(typeof c === 'string' ? cust(c) : c, S.vehicles);
const vehById = id => !id ? null : S.vehicles.find(v => v.id === id) || (String(id).startsWith('L:') ? vehOf(String(id).slice(2)).find(v => v.id === id) || null : null);
const vehLabel = v => v ? `${v.plate || t('vh.noPlate')} · ${ymText(v.ym)}` : '';
const slotName = id => VSLOT[id] ? iso(VSLOT[id].th) : '';
const narrow = () => matchMedia('(max-width: 820px)').matches;
const sortCustomers = () => S.customers.sort((a, b) => a.name.localeCompare(b.name, lang));
const canEdit = () => S.role === 'admin' || S.role === 'editor';
const isAdmin = () => S.role === 'admin';
const setMode = m => { S.mode = m; try { localStorage.setItem('by_mode', m); } catch { } };
const aiOn = () => !!S.store?.aiReady && canEdit();
const initial = s => (String(s || '').trim()[0] || '?').toUpperCase();
const FOLDER = Object.fromEntries(FOLDERS.map(f => [f.slot, f]));
// keep folder and file names in their own direction inside Persian (RTL) text: "01_กรมธรรม์" must not flip
const iso = s => '⁨' + s + '⁩';
const dfmt = () => dateFmt() === 'be' ? 'be' : 'ce';

const PROVINCES = 'กรุงเทพมหานคร กระบี่ กาญจนบุรี กาฬสินธุ์ กำแพงเพชร ขอนแก่น จันทบุรี ฉะเชิงเทรา ชลบุรี ชัยนาท ชัยภูมิ ชุมพร เชียงราย เชียงใหม่ ตรัง ตราด ตาก นครนายก นครปฐม นครพนม นครราชสีมา นครศรีธรรมราช นครสวรรค์ นนทบุรี นราธิวาส น่าน บึงกาฬ บุรีรัมย์ ปทุมธานี ประจวบคีรีขันธ์ ปราจีนบุรี ปัตตานี พระนครศรีอยุธยา พะเยา พังงา พัทลุง พิจิตร พิษณุโลก เพชรบุรี เพชรบูรณ์ แพร่ ภูเก็ต มหาสารคาม มุกดาหาร แม่ฮ่องสอน ยโสธร ยะลา ร้อยเอ็ด ระนอง ระยอง ราชบุรี ลพบุรี ลำปาง ลำพูน เลย ศรีสะเกษ สกลนคร สงขลา สตูล สมุทรปราการ สมุทรสงคราม สมุทรสาคร สระแก้ว สระบุรี สิงห์บุรี สุโขทัย สุพรรณบุรี สุราษฎร์ธานี สุรินทร์ หนองคาย หนองบัวลำภู อ่างทอง อำนาจเจริญ อุดรธานี อุตรดิตถ์ อุทัยธานี อุบลราชธานี'.split(' ');
const POLICY_TYPES = ['ชั้น 1', 'ชั้น 2+', 'ชั้น 2', 'ชั้น 3+', 'ชั้น 3', 'พ.ร.บ.'];

/* ================= connect & load ================= */
async function connect() {
  resetPrb();
  S.store = null; S.gate = null;
  if (S.mode === 'local') {
    const l = new LocalStore();
    await l.init();
    S.store = l; S.role = 'admin'; S.me = null;
    applyRole();
    return reload(true);
  }
  if (!cloudReady()) return showGate('config');
  // Device password (v3.3): this device signed in with Google before -> only the password, no Google
  if (device.has()) return device.unlocked() ? enterCloud() : showGate('unlock');
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
    S.pinLeft = null; S.pinMsg = '';
    // Right after "Sign in with Google": offer a device password (once; "Skip" keeps the old behaviour)
    if (!me.dev && !device.has() && !device.skipped()) return showGate('setpin');
    await reload(true);
  } catch (e) {
    handleError(e);
  } finally { entering = false; }
}

auth.onSignIn(() => { if (S.mode === 'cloud' && S.gate && S.gate !== 'loading' && S.gate !== 'unlock' && S.gate !== 'setpin') enterCloud(); });

/** Google sign-in screen. Sets up Google sign-in first (not loaded when the device was opened with its password). */
async function googleGate(kind = 'signin') {
  showGate('loading');
  try { await auth.init(lang); } catch { return showGate('gis'); }
  showGate(kind);
}

/** Auto-lock (15 min without use) and the device locking for any other reason: data leaves the screen and memory. */
function lockNow() {
  device.lock();
  closeSheet();
  S.store = null; S.me = null; S.customers = []; S.files = []; S.invoices = []; S.company = null; S.pinLeft = null; S.pinMsg = '';
  showGate('unlock');
}
device.watchIdle(() => { if (S.mode === 'cloud' && device.has()) lockNow(); });

function showGate(g, email = '') {
  S.gate = g; S.denied = email || S.denied;
  closeSheet(); mount();
}

async function reload(remount = false) {
  const { customers, files, invoices, vehicles } = await S.store.loadAll();
  S.customers = customers; sortCustomers();
  S.vehicles = vehicles || [];
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
const MSG_ERR = { 'Insured folder is not empty': 'prb.notEmpty', 'PRB invoices exist': 'prb.invExist' };
function handleError(e) {
  const code = e?.code;
  if (code !== 'bad_pin' && code !== 'locked') console.error(e);   // a wrong device password is not an app error
  if (S.gate === 'deny' && (code === 'auth' || e?.auth)) return;   // a second request after "No access": keep that screen
  if (code === 'locked') { if (S.gate !== 'unlock') lockNow(); return; }
  if (code === 'bad_pin') { S.store = null; S.pinLeft = e.left ?? null; S.pinMsg = ''; return showGate('unlock'); }
  if ((code === 'auth' || e?.auth) && e?.session === 'gone') {
    // the device session ended: 5 wrong passwords, signed out from another device, or 30 days passed
    S.store = null; S.pinMsg = S.pinLeft === 1 ? 'dv.tooMany' : 'dv.gone'; S.pinLeft = null;
    auth.drop(); return googleGate('expired');
  }
  if (code === 'auth' || e?.auth) { auth.drop(); return showGate('expired'); }
  if (code === 'forbidden') { S.store = null; return showGate('deny', e.email || auth.user()?.email || ''); }
  if (code === 'sessions_full') return toast(t('dv.full'), 'err');
  const msgKey = e?.key || MSG_ERR[e?.message] || ERR[code];
  toast(msgKey ? t(msgKey) : e?.message || t('err.generic'), 'err');
  if (code === 'not_found' && S.store) reload().catch(() => { });
  if (!S.store && S.mode === 'cloud' && S.gate === 'loading') {
    if (device.has()) { device.lock(); showGate('unlock'); } else showGate('signin');
  }
}

async function run(fn) {
  try { await fn(); } catch (e) { handleError(e); }
}

/* ================= policy status ================= */
/**
 * v4: every vehicle has its own expiry (the latest month of each plate counts). The customer's status is the vehicle
 * that needs attention first. Customers without any vehicle expiry: the latest expiry of a policy file (v2).
 * S.renew = one row per vehicle (Renewals page, stat card).
 */
const stOf = d => d == null ? 'none' : d < 0 ? 'expired' : d <= 30 ? 'soon' : 'active';
function computeStatus() {
  const legacy = {};
  for (const f of S.files) if (f.expiry && f.type === 'policy' && f.folder !== 'prev' && f.vslot !== '5.2' && !f.invoice && (!legacy[f.customerId] || f.expiry > legacy[f.customerId])) legacy[f.customerId] = f.expiry;
  S.exp = {}; S.vexp = {}; S.renew = [];
  for (const c of S.customers) {
    const all = vehOf(c), latest = latestOf(all);
    for (const v of all) {
      const d = v.policyExpiry ? daysLeft(v.policyExpiry) : null;
      S.vexp[v.id] = { exp: v.policyExpiry || '', d, st: latest.includes(v) ? stOf(d) : 'old' };
    }
    let best = null;
    for (const v of latest) if (v.policyExpiry) { const x = { c, v, exp: v.policyExpiry, d: daysLeft(v.policyExpiry) }; S.renew.push(x); if (!best || x.d < best.d) best = x; }
    if (best) { S.exp[c.id] = { exp: best.exp, legacy: false, d: best.d, st: stOf(best.d), plate: best.v.plate }; continue; }
    const exp = legacy[c.id] || '';
    const d = exp ? daysLeft(exp) : null;
    if (exp) S.renew.push({ c, v: null, exp, d });
    S.exp[c.id] = { exp, legacy: !!exp, d, st: stOf(d) };
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
  const vs = vehOf(c);
  const h = norm(`${c.name} ${c.nick || ''} ${c.nameEn || ''} ${c.plate || ''} ${c.province || ''} ${c.brand || ''} ${c.model || ''} ${c.car || ''} ${c.policyNo || ''} ${c.insurer || ''} ${vs.map(v => `${v.plate} ${v.vin} ${v.brand} ${v.model} ${v.policyNo} ${ymText(v.ym)}`).join(' ')}`);
  if (h.includes(norm(q))) return true;
  if (searchVehicles(q, [c], S.vehicles).length) return true;
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
  prb: () => `${titleRow('prb', `<button class="btn ghost" data-act="prb-camera">${icon('camera')} ${t('btn.camera')}</button><button class="btn primary" data-act="prb-upload">${icon('plus')} ${t('btn.addFile')}</button>${isAdmin() ? `<button class="btn ghost" data-act="prb-import">${t('prb.import')}</button>` : ''}`)}<section id="prbView" aria-live="polite"></section>`,
  dash: () => `${titleRow('dash', `<button class="btn ghost" data-act="smart">${icon('wand')}<span>${t('su.btn')}</span></button><button class="btn ghost" data-act="new-customer">${icon('userplus')}<span>${t('btn.newCustomer')}</span></button>${addBtn()}`)}
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
  if (S.gate === 'unlock' || S.gate === 'setpin') setTimeout(() => $('.gate-form input[type=password]')?.focus({ preventScroll: true }), 60);
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
  if (S.view === 'prb') drawPrb();
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
  // v4.5.4: no "Try the demo on this device" on the sign-in / unlock screens (private company app); demo code stays
  if (g === 'loading') return `<section class="gate card"><div class="gate-ico">${icon('lock', 38)}</div><h1>${t('gate.loading')}</h1><div class="spin"></div></section>`;
  if (g === 'deny') return `<section class="gate card">
      <div class="gate-ico deny">${icon('lock', 38)}</div><h1>${t('deny.title')}</h1>
      <p>${t('deny.text', { x: `<b dir="ltr">${esc(S.denied)}</b>` })}</p>
      <div class="gate-actions"><button class="btn primary" data-act="retry">${t('deny.retry')}</button><button class="btn ghost" data-act="switch-account">${t('deny.switch')}</button></div></section>`;
  if (g === 'config' || g === 'gis') return `<section class="gate card"><div class="gate-ico">${icon('cloud', 38)}</div><h1>${t('gate.title')}</h1><p>${t('gate.' + g)}</p>
      <div class="gate-actions">${g === 'gis' ? `<button class="btn primary" data-act="reload">${t('gate.retry')}</button>` : ''}</div></section>`;
  if (g === 'unlock') {
    const b = device.info() || {};
    const msg = S.pinLeft != null ? t('dv.wrong', { n: S.pinLeft }) : '';
    return `<section class="gate card">
      <div class="gate-ico">${icon('lock', 38)}</div>
      <h1>${t('dv.unlockTitle')}</h1>
      <p>${t('dv.unlockText', { x: `<b dir="ltr">${esc(b.email || '')}</b>` })}</p>
      <form class="form gate-form" data-form="unlock" id="ulform" novalidate>
        <input type="email" name="username" autocomplete="username" value="${esc(b.email || '')}" hidden>
        <label>${t('dv.pin')}<input type="password" name="pin" autocomplete="current-password" dir="ltr" required aria-describedby="pinMsg" enterkeyhint="go"></label>
        <p class="gate-err" id="pinMsg" role="alert">${msg}</p>
        <button class="btn primary block" id="ulbtn">${icon('lock', 18)}<span>${t('dv.unlock')}</span></button>
      </form>
      <div class="gate-actions"><button class="btn ghost" data-act="dv-forgot">${t('dv.forgot')}</button></div>
    </section>`;
  }
  if (g === 'setpin') return `<section class="gate card">
      <div class="gate-ico">${icon('shield', 38)}</div>
      <h1>${t('dv.setTitle')}</h1>
      <p>${t('dv.setText')}</p>
      <form class="form gate-form" data-form="setpin" id="spform" novalidate>
        <input type="email" name="username" autocomplete="username" value="${esc(S.me?.email || '')}" hidden>
        <label>${t('dv.newPin')}<input type="password" name="pin" autocomplete="new-password" dir="ltr" required minlength="6" maxlength="128"></label>
        <label>${t('dv.pin2')}<input type="password" name="pin2" autocomplete="new-password" dir="ltr" required></label>
        <label>${t('dv.name')}<input name="name" maxlength="40" value="${esc(device.guessName())}" autocomplete="off"></label>
        <p class="gate-err" id="spMsg" role="alert"></p>
        <button class="btn primary block" id="spbtn">${icon('check', 18)}<span>${t('dv.save')}</span></button>
      </form>
      <p class="gate-note">${t('dv.setNote')}</p>
      <div class="gate-actions"><button class="btn ghost" data-act="dv-skip">${t('dv.skip')}</button></div>
    </section>`;
  return `<section class="gate card">
      <div class="gate-ico">${icon('shield', 38)}</div>
      <h1>${t('gate.title')}</h1>
      <p>${S.pinMsg && g === 'expired' ? t(S.pinMsg) : t(g === 'expired' ? 'gate.expired' : 'gate.text')}</p>
      <div class="gbtn" id="gbtn"><div class="spin"></div></div>
    </section>`;
}

/* ---------- stat cards ---------- */
function drawStats(anim) {
  const el = $('#stats'); if (!el) return;
  const soon = S.renew.filter(m => m.d <= 30).length;   // v4: counted per vehicle
  const expired = S.renew.filter(m => m.d < 0).length;

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
const linkFlag = () => `<em class="link-flag" title="${t('sh.on')}">${icon('link', 12)}</em>`;
const thumbImg = (src, ic) => `<img class="th" src="${esc(src)}" alt="" loading="lazy" decoding="async" data-ic="${ic}">`;
const folderName = f => VSLOT[f.vslot] ? `${esc(vehById(f.vehicleId)?.plate || '')} · ${slotName(f.vslot)}` : FOLDER[f.folder] ? t('fo.' + f.folder) : t('fo.other');
function fileTile(f, i, light = false) {
  const ty = TYPES[f.type] || TYPES.other, c = light ? cust(f.customerId) : null;
  const left = f.expiry && !f.invoice ? daysLeft(f.expiry) : null;
  return `<button class="tile" data-act="open-file" data-id="${esc(f.id)}" style="--i:${Math.min(i, 14)}">
    <span class="thumb">${f.thumb ? thumbImg(f.thumb, ty.icon) : ftBadge(f)}
      ${left !== null && left <= 30 ? `<em class="flag ${left < 0 ? 'bad' : 'warn'}">${left < 0 ? t('flag.expired') : t('flag.days', { n: left })}</em>` : ''}${f.invoice ? `<em class="inv-flag">${t('q.invoice')}</em>` : ''}${f.shared ? linkFlag() : ''}</span>
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
      <button class="btn glassy" data-act="smart">${icon('wand')}<span>${t('su.btn')}</span></button>
      ${S.store.kind === 'local' ? `<button class="btn glassy" data-act="seed">${t('p.empty.demo')}</button>` : ''}</div></div>`;
    return;
  }
  const F = S.filters, q = F.q.trim();
  const list = S.customers.filter(c => (!F.status || S.exp[c.id]?.st === F.status)
    && (!q || custMatch(c, q) || S.files.some(f => f.customerId === c.id && matchFile(f, { skipCustomer: true, skipType: true }))));
  if (list.length && !list.some(c => c.id === S.sel)) S.sel = list[0].id;
  const c = list.length ? cust(S.sel) : null;
  const mine = c ? S.files.filter(f => f.customerId === c.id) : [];
  // tabs: all, one per month of this customer, and the old (v2/v3) folders when files are still there
  const months = c ? [...byMonth(vehOf(c)).keys()] : [];
  const old = mine.filter(f => !f.vslot);
  const counts = { '': mine.length, old: old.length };
  for (const ym of months) counts['m:' + ym] = mine.filter(f => f.vslot && vehById(f.vehicleId)?.ym === ym).length;
  if (S.folderTab && !(S.folderTab in counts && (S.folderTab !== 'old' || old.length))) S.folderTab = '';
  const tabs = [['', t('p.all')], ...months.map(ym => ['m:' + ym, ymText(ym)]), ...(old.length ? [['old', t('vh.oldFolders')]] : [])];
  // v4 search: one row per vehicle ("customer · plate · July 2026")
  const hits = q ? searchVehicles(q, list, S.vehicles) : [];
  const hitIds = new Set(hits.map(h => h.c.id));
  const rowsHtml = (q && hits.length ? [...hits.map(h => ({ x: h.c, v: h.v })), ...list.filter(x => !hitIds.has(x.id)).map(x => ({ x }))] : list.map(x => ({ x }))).map(({ x, v }, i) => {
    const n = S.files.filter(f => f.customerId === x.id && (!v || f.vehicleId === v.id)).length;
    const m = v ? S.vexp[v.id] || { st: 'none' } : S.exp[x.id] || { st: 'none' };
    const pill = m.st === 'expired' ? `<em class="pill bad">${t('st.expired')}</em>` : m.st === 'soon' ? `<em class="pill warn">${t('p.renew')}</em>` : m.st === 'active' ? `<em class="pill ok">${t('st.active')}</em>` : '';
    const nv = vehOf(x).length;
    const sub = v ? `<bdi dir="ltr">${esc(v.plate || '—')}</bdi> · ${ymText(v.ym)}` : esc([x.nick, nv > 1 ? t('vh.count', { n: nv }) : vehOf(x)[0]?.plate || x.car || x.phone].filter(Boolean).join(' · ') || t('p.noinfo'));
    const on = x.id === S.sel && (!v || v.id === S.openVeh);
    return `<li><button class="citem ${on ? 'on' : ''}" data-act="select" data-id="${esc(x.id)}" ${v ? `data-veh="${esc(v.id)}"` : ''} style="--i:${Math.min(i, 12)}">
        <span class="ava" style="--h:${hue(x.id)}">${esc(initial(x.name))}</span>
        <span class="cmain"><b>${esc(x.name)}</b><small>${sub}</small></span>
        ${pill}<em class="pill">${t('p.nfiles', { n })}</em></button></li>`;
  }).join('');

  el.innerHTML = `
  <header class="panel-head">
    <h3>${t('p.customers')} <span>${num(list.length)}</span></h3>
    <div class="tabs">${tabs.map(([k, l]) => `<button class="${S.folderTab === k ? 'on' : ''}" data-act="tab" data-folder="${k}">${l}<i>${num(counts[k] || 0)}</i></button>`).join('')}</div>
    <button class="icon-btn onDark" data-act="new-customer" data-need="edit" title="${t('btn.newCustomer')}">${icon('userplus', 18)}</button>
  </header>
  <div class="panel-body ${S.mobileDetail ? 'show-detail' : ''}">
    <ul class="clist">${rowsHtml || `<li class="none">${t('p.nomatch')}</li>`}</ul>
    <div class="detail ${anim ? 'anim' : ''}" id="detail">${c ? caseFile(c, mine) : `<div class="empty dark"><p>${t(list.length ? 'p.pick' : 'p.nomatch')}</p></div>`}
    </div>
  </div>`;
}

/** One folder button of a vehicle card (1–4, 5, 5.1–5.5) with its file count */
function slotBtn(v, s, files, open) {
  const n = s.group ? files.filter(f => VSLOT[f.vslot]?.in === '5').length : files.filter(f => f.vslot === s.id).length;
  return `<button class="vslot ${open ? 'on' : ''} ${s.in ? 'sub' : ''}" data-act="veh-slot" data-veh="${esc(v.id)}" data-slot="${s.id}" aria-expanded="${open}">
    <span class="fico">${icon(s.icon, 15)}</span><b>${iso(s.th)}</b><em class="cnt">${num(n)}</em></button>`;
}
/** A vehicle (one plate in one month) inside the case file: details, the 5 folders, the open folder's files */
function vehicleCard(c, v, mine, i) {
  const files = mine.filter(f => f.vehicleId === v.id && f.vslot);
  const open = S.openVeh === v.id;
  const m = S.vexp[v.id] || { st: 'none' };
  const pill = m.st === 'old' ? `<em class="pill">${t('vh.renewed')}</em>` : m.st === 'expired' ? `<em class="pill bad">${t('st.expired')}</em>` : m.st === 'soon' ? `<em class="pill warn">${t('p.renew')}</em>` : m.st === 'active' ? `<em class="pill ok">${t('st.active')}</em>` : '';
  const what = [[v.brand, v.model].filter(Boolean).join(' '), v.insurer, v.policyExpiry ? `${t('e.expiry')} ${fmtDay(v.policyExpiry)}` : ''].filter(Boolean).join(' · ');
  let body = '';
  if (open) {
    const slot = S.openSlot;
    const tiles = slot && slot !== '5' ? files.filter(f => f.vslot === slot) : [];
    body = `<div class="vbody">
      <div class="vinfo">${infoRows(v, ['vin', 'engineNo', 'year', 'color', 'body', 'province', 'policyNo', 'policyType', 'premium', 'contractDate', 'policyStart', 'policyExpiry'])}</div>
      ${v.legacy ? `<p class="dnote">${icon('info', 15)}<span>${t('vh.legacyNote')}</span></p>` : ''}
      <div class="vslots">${VSLOTS.filter(s => !s.in).map(s => slotBtn(v, s, files, slot === s.id || (s.id === '5' && VSLOT[slot]?.in === '5'))).join('')}</div>
      ${slot === '5' || VSLOT[slot]?.in === '5' ? `<div class="vslots sub">${VSLOTS.filter(s => s.in === '5').map(s => slotBtn(v, s, files, slot === s.id)).join('')}</div>` : ''}
      ${slot && slot !== '5' ? `<div class="tiles" data-veh="${esc(v.id)}" data-slot="${slot}">${tiles.map((f, j) => fileTile(f, j)).join('')}
        <button class="tile add" data-act="add-file" data-veh="${esc(v.id)}" data-slot="${slot}" data-need="edit">${icon('plus', 22)}<b>${t('btn.addFile')}</b><small>${t('p.drop')}</small></button></div>` : ''}
      <div class="vactions" data-need="edit">
        <button class="btn glassy sm" data-act="veh-edit" data-id="${esc(v.id)}">${icon('edit', 15)}<span>${t('vh.edit')}</span></button>
        <button class="btn glassy sm" data-act="new-invoice" data-id="${esc(c.id)}" data-veh="${esc(v.id)}">${icon('invoice', 15)}<span>${t('q.invoice')}</span></button>
        <button class="btn white sm" data-act="add-file" data-veh="${esc(v.id)}" data-slot="${FILE_SLOTS.includes(slot) ? slot : ''}">${icon('plus', 15)}<span>${t('btn.upload')}</span></button></div>
    </div>`;
  }
  return `<article class="vcard ${open ? 'open' : ''}" data-veh="${esc(v.id)}" style="--i:${Math.min(i, 12)}">
    <button class="vcard-h" data-act="veh-open" data-id="${esc(v.id)}" aria-expanded="${open}">
      <span class="fico">${icon('car', 17)}</span>
      <span class="cmain"><b dir="ltr">${esc(v.plate || t('vh.noPlate'))}</b><small>${esc(what) || t('g.notFilled')}</small></span>
      ${pill}<em class="cnt">${num(files.length)}</em>${icon('chev', 16)}</button>${body}</article>`;
}

function caseFile(c, mine) {
  const m = S.exp[c.id] || { st: 'none' };
  const invs = S.invoices.filter(i => i.customerId === c.id);
  const tab = S.folderTab;
  const custRows = infoRows(c, FIELD_GROUPS.customer.filter(k => k !== 'name' && k !== 'phone'));
  const all = vehOf(c), months = byMonth(all);
  // v4 tree: month cards -> vehicle (plate) cards -> the 5 folders -> 5.1–5.5 inside folder 5
  const monthHtml = [...months].filter(([ym]) => !tab || tab === 'm:' + ym).map(([ym, list]) => `
    <section class="dsec vmonth">
      <header class="dsec-h"><span class="fico">${icon('calendar', 16)}</span><div><b>${iso(ymFolder(ym))}</b><small>${t('vh.count', { n: list.length })}</small></div>
        <em class="cnt">${num(mine.filter(f => f.vslot && list.some(v => v.id === f.vehicleId)).length)}</em></header>
      <div class="vcards">${list.map((v, i) => vehicleCard(c, v, mine, i)).join('')}</div></section>`).join('');
  // files that are still in the old v3 folders / directly in the customer folder (v2)
  const oldSec = F => {
    const list = mine.filter(f => !f.vslot && f.folder === F.slot);
    return list.length ? `<section class="dsec" data-folder="${F.slot}">
      <header class="dsec-h"><span class="fico">${icon(F.icon, 16)}</span><div><b>${iso(F.th)}</b><small>${t('fo.' + F.slot)}</small></div><em class="cnt">${num(list.length)}</em></header>
      <div class="tiles">${list.map((f, i) => fileTile(f, i)).join('')}</div></section>` : '';
  };
  const loose = mine.filter(f => !f.vslot && !FOLDER[f.folder]);
  const oldHtml = mine.some(f => !f.vslot) ? `<div class="vold"><p class="dsec-hint">${icon('info', 13)} ${t('vh.oldHint')}</p>${FOLDERS.map(oldSec).join('')}
    ${loose.length ? `<section class="dsec"><header class="dsec-h"><span class="fico">${icon('folder', 16)}</span><div><b>ไม่ระบุ</b><small>${t('fo.other')}</small></div><em class="cnt">${num(loose.length)}</em></header>
      <div class="tiles">${loose.map((f, i) => fileTile(f, i)).join('')}</div></section>` : ''}</div>` : '';
  const files = tab === 'old' ? oldHtml : monthHtml + (tab ? '' : oldHtml);

  return `
      <div class="dcard" data-customer="${esc(c.id)}">
        <header>
          <button class="icon-btn glassy back" data-act="back" title="${t('btn.back')}">${icon('chev', 18)}</button>
          <div class="dname"><small>${t('p.file')}</small><h2>${esc(c.name)}</h2>${c.nameEn ? `<small>${esc(c.nameEn)}</small>` : ''}</div>
          <div class="dmeta"><span class="st-chip"><i class="dot ${m.st === 'expired' ? 'bad' : m.st === 'soon' ? 'warn' : m.st === 'active' ? 'ok' : ''}"></i>${t('st.' + m.st)}${m.exp ? ` · ${fmtDay(m.exp)}` : ''}${m.plate ? ` · <bdi dir="ltr">${esc(m.plate)}</bdi>` : ''}</span>
            ${c.nick ? `<span>${icon('users', 15)}${esc(c.nick)}</span>` : ''}${c.phone ? `<a href="tel:${esc(c.phone)}">${icon('phone', 15)}<bdi>${esc(digits(c.phone))}</bdi></a>` : ''}</div>
          <button class="icon-btn glassy" data-act="edit-customer" data-need="edit" title="${t('p.edit')}">${icon('edit', 17)}</button>
        </header>
        <div class="dinfo two">
          <section><h4>${icon('users', 14)}${t('g.customer')}</h4>${custRows || `<p class="none">${t('g.notFilled')}</p>`}</section>
          <section><h4>${icon('car', 14)}${t('vh.title')}</h4>
            <div class="irow"><small>${t('vh.vehicles')}</small><span>${num(latestOf(all).length)}</span></div>
            <div class="irow"><small>${t('vh.months')}</small><span>${num(months.size)}</span></div>
            <div class="irow"><small>${t('cf.policyExpiry')}</small><span>${m.exp ? `${fmtDay(m.exp)} · ${daysText(m.d)}` : t('st.notSet')}</span></div>
            ${m.legacy ? `<small class="src">${t('st.fromFile')}</small>` : ''}</section>
        </div>
        <div class="vadd" data-need="edit">
          ${lastAib(c.id) ? `<button class="btn glassy sm" data-act="ae-undo" data-b="${esc(lastAib(c.id))}">${icon('history', 15)}<span>${t('ae.undo')}</span></button>` : ''}
          ${mine.some(aeReadable) ? `<button class="btn glassy sm" data-act="ae-cust" data-id="${esc(c.id)}">${icon('wand', 15)}<span>${t('ae.cust')}</span></button>` : ''}
          <button class="btn glassy sm" data-act="veh-add" data-id="${esc(c.id)}">${icon('plus', 15)}<span>${t('vh.add')}</span></button></div>
        ${all.length ? '' : `<p class="dnote">${icon('info', 15)}<span>${t('vh.none')}</span></p>`}
        ${files}
        <section class="dsec">
          <header class="dsec-h"><span class="fico">${icon('invoice', 16)}</span><div><b>${t('inv.title')}</b></div><em class="cnt">${num(invs.length)}</em>
            <button class="icon-btn glassy sm" data-act="new-invoice" data-id="${esc(c.id)}" data-need="edit" title="${t('inv.create')}">${icon('plus', 16)}</button></header>
          <div class="dinv">${invs.length ? invs.map(inv => `<button class="dinv-row" data-act="open-invoice" data-id="${esc(inv.id)}">
            <span class="cmain"><b dir="ltr">${esc(inv.no)}</b><small>${fmtDay(inv.issue)}${inv.veh?.plate ? ` · <bdi dir="ltr">${esc(inv.veh.plate)}</bdi>` : ''}</small></span><b class="amt">${baht(inv.t?.total || 0)}</b>${invPillDark(inv.status)}</button>`).join('') : `<p class="none">${t('inv.noneHere')}</p>`}</div>
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

/* ---------- renewals: one row per vehicle (v4), grouped ---------- */
function drawExp() {
  const el = $('#explist'); if (!el) return;
  const F = S.filters, q = F.q.trim();
  // a search that names vehicles (plate, chassis, month) shows only those; a customer name shows all of their vehicles
  const hit = x => {
    if (!q) return true;
    const vs = searchVehicles(q, [x.c], S.vehicles);
    return x.v && vs.length ? vs.some(h => h.v.id === x.v.id) || vs.every(h => h.c.id === x.c.id) && vs.length === vehOf(x.c).length : custMatch(x.c, q);
  };
  const rows = S.renew.filter(x => (!F.customer || x.c.id === F.customer) && hit(x) && x.d <= 60).sort((a, b) => a.d - b.d);
  const groups = [['expired', x => x.d < 0], ['d7', x => x.d >= 0 && x.d <= 7], ['d30', x => x.d > 7 && x.d <= 30], ['d60', x => x.d > 30]];
  let i = 0;
  el.innerHTML = rows.length ? groups.map(([k, fn]) => {
    const g = rows.filter(fn); if (!g.length) return '';
    return `<h2 class="egroup g-${k}">${t('ex.' + k)}<span>${num(g.length)}</span></h2>${g.map(({ c, v, exp, d }) => `
      <div class="erow card" style="--i:${Math.min(i++, 14)}">
        <span class="ava" style="--h:${hue(c.id)}">${esc(initial(c.name))}</span>
        <button class="emain" data-act="open-customer" data-id="${esc(c.id)}" ${v ? `data-veh="${esc(v.id)}"` : ''}><b>${esc(c.name)}${v?.plate ? ` · <bdi dir="ltr">${esc(v.plate)}</bdi>` : ''}</b><small>${esc([v ? ymText(v.ym) : '', v?.insurer, v?.policyNo].filter(Boolean).join(' · ') || c.phone || '')}</small></button>
        <span class="edate"><small>${t('e.expiry')}</small><b>${fmtDay(exp)}</b></span>
        <em class="pill st ${d <= 0 ? 'bad' : d <= 30 ? 'warn' : 'ok'}">${daysText(d)}</em>
        ${c.phone ? `<a class="icon-btn" href="tel:${esc(c.phone)}" title="${esc(t('e.call', { x: c.name }))}">${icon('phone', 17)}</a>` : ''}
        <button class="icon-btn" data-act="open-customer" data-id="${esc(c.id)}" ${v ? `data-veh="${esc(v.id)}"` : ''} title="${t('a.open')}">${icon('chev', 17)}</button>
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
function openCustomer(id, vid = '') {
  closeSheet();
  if (S.sel !== id || vid) { S.openVeh = vid || ''; S.openSlot = ''; S.folderTab = ''; }
  S.view = 'dash'; S.sel = id; S.mobileDetail = true;
  const st = S.exp[id]?.st;
  if (S.filters.status && S.filters.status !== st) S.filters.status = '';
  if (S.filters.customer && S.filters.customer !== id) S.filters.customer = '';
  if (S.filters.q && !custMatch(cust(id) || {}, S.filters.q.trim())) S.filters.q = '';
  mount();
  requestAnimationFrame(() => (vid && $(`.vcard[data-veh="${CSS.escape(vid)}"]`) || $(narrow() ? '#panel' : '#detail'))?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
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
  if (S.view === 'prb') return run(() => prbPick(false));
  const c = S.view === 'dash' ? cust(S.sel) : null;
  sheet({ title: t('add.title'), cls: 'small', body: `
    <div class="set-card"><div class="set-h">${icon('wand', 22)}<div><b>${t('su.btn')}</b><small>${aiOn() ? t('su.addSub') : (S.mode === 'local' ? t('ai.localOnly') : t('ai.off')) + ' ' + t('su.byHand')}</small></div></div>
      <div class="two-btn"><button class="btn primary" data-act="smart" data-src="cam">${icon('camera', 18)}<span>${t('src.camera')}</span></button>
      <button class="btn ghost" data-act="smart" data-src="files">${icon('gallery', 18)}<span>${t('src.files')}</span></button></div></div>
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
const fieldInput = (k, v, { err = '', warn = '', conf = null, note = '', req = false } = {}) => {
  const val = esc(v || '');
  const attrs = `name="${k}" data-r="${k}"`;
  let inp;
  if (DATE_FIELDS.has(k)) inp = `<input type="date" ${attrs} value="${val}">`;
  else if (k === 'address' || k === 'note') inp = `<textarea ${attrs} rows="2" maxlength="${k === 'note' ? 500 : 300}">${val}</textarea>`;
  else {
    const extra = { phone: 'inputmode="tel" dir="ltr" autocomplete="tel"', idNo: 'inputmode="numeric" dir="ltr"', year: 'inputmode="numeric" maxlength="4"', coverage: 'inputmode="decimal"', carValue: 'inputmode="decimal"', premium: 'inputmode="decimal"', vin: 'dir="ltr" autocapitalize="characters"', engineNo: 'dir="ltr" autocapitalize="characters"', policyNo: 'dir="ltr"', province: 'list="dl-prov"', policyType: 'list="dl-ptype"', name: 'required maxlength="120"', plate: 'maxlength="40"' }[k] || '';
    inp = `<input ${attrs} ${extra} value="${val}" autocomplete="off">`;
  }
  const level = conf == null ? '' : conf >= 0.85 ? 'hi' : conf >= 0.6 ? 'mid' : 'lo';
  const chip = level ? `<em class="conf c-${level}" title="${t('ai.conf')}">${t('conf.' + level)}</em>` : '';
  return `<label class="fld ${err ? 'has-err' : ''} ${level ? 'ai-' + level : ''}"><span class="fl">${t('cf.' + k)}${k === 'name' || req ? ' *' : ''}${chip}</span>${inp}
    ${err ? `<small class="ferr">${t(err)}</small>` : warn ? `<small class="fwarn">${t(warn)}</small>` : note ? `<small class="fwarn">${t(note)}</small>` : ''}</label>`;
};
const datalists = () => `<datalist id="dl-prov">${PROVINCES.map(p => `<option value="${p}">`).join('')}</datalist><datalist id="dl-ptype">${POLICY_TYPES.map(p => `<option value="${p}">`).join('')}</datalist>`;
const fieldset = (legend, keys, v, opts = {}) => `<fieldset class="fgroup"><legend>${legend}</legend><div class="fgrid">${keys.map(k => fieldInput(k, v[k], { err: opts.errors?.[k], warn: opts.warnings?.[k], conf: opts.conf?.[k] ?? null, note: opts.notes?.[k], req: k === 'plate' && opts.plateReq })).join('')}</div></fieldset>`;

let CF = null;   // customer form state
function customerSheet(c = {}) {
  CF = { id: c.id || '', v: { ...c } };
  drawCustomerSheet();
}
/** v4: the customer form has only the customer's own details; vehicles and policies are on the vehicles. */
function drawCustomerSheet(errors = {}, warnings = {}) {
  const c = CF.v;
  sheet({ title: t(CF.id ? 'c.edit' : 'c.new'), sub: t('c.sub'), cls: 'wide',
    body: `<form class="form" data-form="customer" id="cform" novalidate>${fieldset(t('g.customer'), FIELD_GROUPS.customer, c, { errors, warnings })}
      <fieldset class="fgroup">${fieldInput('note', c.note)}</fieldset>
      ${CF.id ? '' : `<p class="note">${icon('car', 15)}<span>${t('vh.afterCustomer')}</span></p>`}</form>`,
    foot: `${CF.id ? `<button type="button" class="btn danger-ghost" data-act="del-customer" data-id="${esc(CF.id)}">${icon('trash', 17)}<span>${t('c.delete')}</span></button>` : ''}<span class="sp"></span>
      <button type="button" class="btn ghost" data-act="close-sheet">${t('btn.cancel')}</button><button class="btn primary" type="submit" form="cform">${t('btn.save')}</button>` });
  if (!CF.id) setTimeout(() => $('#cform input[name=name]')?.focus(), 350);
}
const CUSTOMER_FORM_KEYS = [...FIELD_GROUPS.customer, 'note'];
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
  // only the fields the form shows are sent; the backend merges them into the saved details (old vehicle fields stay)
  const payload = { id: CF.id || undefined, name: v.name };
  for (const k of CUSTOMER_FORM_KEYS) if (k in v) payload[k] = v[k];
  const isNew = !CF.id;
  const c = await S.store.saveCustomer(payload);
  CF = null; closeSheet(); await reload();
  toast(t(isNew ? 't.customerAdded' : 't.customerUpdated'));
  openCustomer(c.id);
  if (isNew && canEdit()) vehicleSheet(c.id);   // the first vehicle right away
}

/* ---------- vehicle form (v4): add / edit / remove ---------- */
let VF = null;
/** v = a vehicle record, a legacy vehicle ("L:…": saving makes a real record, the customer details stay) or nothing (new) */
function vehicleSheet(cid, v = null) {
  VF = { cid, id: v && !v.legacy ? v.id : '', legacy: !!v?.legacy, v: { ...(v || {}) } };
  drawVehicleSheet();
}
function drawVehicleSheet(errors = {}) {
  const v = VF.v, c = cust(VF.cid);
  const ym = VF.id ? v.ym : v.ym || ymForVehicle(v, todayIso());
  sheet({ title: t(VF.id ? 'vh.edit' : 'vh.new'), sub: esc(c?.name || ''), cls: 'wide',
    body: `<form class="form" data-form="vehicle" id="vform" novalidate>
      ${VF.legacy ? `<p class="note">${icon('info', 15)}<span>${t('vh.legacyEdit')}</span></p>` : ''}
      ${fieldset(t('g.vehicle'), VGROUPS.vehicle, v, { errors, plateReq: true })}
      ${fieldset(t('g.policy'), VGROUPS.policy, v, { errors })}
      <fieldset class="fgroup"><legend>${t('vh.month')}</legend>
        ${VF.id ? `<p class="sh-text"><b>${iso(ymFolder(v.ym))}</b></p><p class="muted">${t('vh.monthFixed')}</p>`
          : `<label class="fld"><span class="fl">${t('vh.monthFolder')}</span><input type="month" name="ym" value="${esc(ym)}" data-vf-ym></label><p class="muted">${t('vh.monthHint')}</p>`}</fieldset>
      <fieldset class="fgroup">${fieldInput('note', v.note)}</fieldset>${datalists()}</form>`,
    foot: `${VF.id ? `<button type="button" class="btn danger-ghost" data-act="del-vehicle" data-id="${esc(VF.id)}">${icon('trash', 17)}<span>${t('vh.remove')}</span></button>` : ''}<span class="sp"></span>
      <button type="button" class="btn ghost" data-act="close-sheet">${t('btn.cancel')}</button><button class="btn primary" type="submit" form="vform">${t('btn.save')}</button>` });
  sheetClose = () => { VF = null; };
  if (!VF.id) setTimeout(() => $('#vform input[name=plate]')?.focus(), 350);
}
async function saveVehicleForm(form) {
  const v = tidy({ ...VF.v, ...readForm(form, VFIELDS) });
  v.plate = plateOnly(v.plate, v.province);
  const errors = {};
  if (!v.plate) errors.plate = 'vh.needPlate';
  if (v.policyStart && v.policyExpiry && v.policyExpiry <= v.policyStart) errors.policyExpiry = 'v.order';
  VF.v = v;
  if (form.ym?.value) VF.v.ym = form.ym.value;
  if (Object.keys(errors).length) { drawVehicleSheet(errors); return toast(t('v.fix'), 'err'); }
  const payload = { id: VF.id || undefined, customerId: VF.cid };
  for (const k of VFIELDS) payload[k] = v[k] || '';
  if (!VF.id) payload.ym = form.ym?.value || ymForVehicle(v, todayIso());
  const cid = VF.cid, x = await S.store.saveVehicle(payload);
  sheetClose = null; VF = null; closeSheet();
  await reload();
  toast(t('vh.saved'));
  openCustomer(cid, x.id);
}
async function deleteVehicle(id) {
  const v = vehById(id); if (!v || v.legacy) return;
  const n = S.files.filter(f => f.vehicleId === id).length;
  if (!await confirmBox(t('vh.removeQ', { x: `<b dir="ltr">${esc(v.plate)}</b> · ${ymText(v.ym)}`, n }) + t(S.store.kind === 'cloud' ? 'del.drive' : 'del.local'))) return;
  await S.store.deleteVehicle(id);
  if (S.openVeh === id) S.openVeh = '';
  await reload(); toast(t('vh.removed'));
}
/** A legacy vehicle becomes a real record (plate folder in its month) the first time something is saved into it */
async function realVehicle(v, cid) {
  if (!v.legacy) return v;
  const data = { customerId: cid, ym: v.ym };
  for (const k of VFIELDS) if (v[k]) data[k] = v[k];
  if (!data.plate) throw Object.assign(new Error('vh.needPlate'), { key: 'vh.needPlate' });
  return S.store.saveVehicle(data);
}

/* ---------- upload: normal (inside a customer) and Smart upload (v4) ---------- */
/*
 * One review list for both. Every row: file -> customer -> vehicle (plate + month) -> folder -> new name.
 * Smart upload: no customer chosen; the AI reads every file and the app finds customer, vehicle, month and folder.
 * Nothing is saved before "Save". New customers and new vehicles are only made when their box is ticked.
 */
let U = null;
const MAX = MAX_UPLOAD_MB * 1048576;
const compressible = f => /^image\/(jpeg|png|webp|heic|heif)$/i.test(f.type);
const readable = f => compressible(f) || f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
/** Name to save: cleaned, original extension kept (a compressed photo becomes .jpg as before) */
function saveName(name, file, blob) {
  let n = withExt(safeName(name) || file.name, extOf(file.name));
  if (blob !== file && blob.type === 'image/jpeg') n = n.replace(/\.(png|webp|heic|heif|jpe?g)$/i, '') + '.jpg';
  return n;
}
function sizeFilter(files) {
  const ok = [];
  for (const f of files) {
    if (f.size > MAX && !compressible(f)) toast(t('u.tooBig', { x: f.name, n: MAX_UPLOAD_MB }), 'err');
    else if (f.size > 0) ok.push(f);
  }
  return ok;
}
const CONF_RANK = { none: 0, hint: 1, low: 1, new: 2, mid: 2, high: 3 };
/** Customer of a row: an existing id or "C:<key>" (a new customer the user still has to confirm) */
const rowCust = it => it.cid?.startsWith('C:') ? { id: it.cid, name: U.newCust[it.cid.slice(2)]?.data.name || '', nick: '', isNew: true } : cust(it.cid);
/** Vehicle choices for a customer: records + legacy + new ones of this upload ("N:<key>") */
function vehChoices(cid) {
  if (!cid) return [];
  const list = cid.startsWith('C:') ? [] : vehOf(cid).map(v => ({ ...v }));
  for (const nv of Object.values(U.newVeh)) if (nv.cid === cid) list.push({ ...nv.data, id: 'N:' + nv.key, ym: nv.ym, isNew: true });
  return list;
}
const rowVeh = it => it.vkey ? vehChoices(it.cid).find(v => v.id === it.vkey) || null : null;
function newRow(file, { cid = '', vid = '', slot = '' } = {}) {
  return { file, name: file.name, cid, vkey: vid, slot, touched: !!vid, picked: { cid: !!cid, veh: !!vid, slot: !!slot },
    cconf: cid ? 'high' : 'none', vconf: vid ? 'high' : 'none', sconf: slot ? 'high' : 'none', conf: 'none',
    ai: aiOn() && readable(file) ? 'wait' : 'skip', n: null, url: isImage({ mime: file.type }) ? objUrl(file) : '', done: false, p: 0 };
}
/** The suggested name (kept as it is once the user typed in the name box) */
function autoName(it) {
  if (it.nameEdited) return;
  const c = rowCust(it), v = rowVeh(it);
  it.name = c && v && it.slot ? vehicleFileName({ vehicle: v, customer: c, slot: it.slot, ext: extOf(it.file.name) }) : it.file.name;
}
function rowConf(it) {
  if (it.conf === 'hint' && !it.picked.cid && !it.picked.veh) return 'hint';
  const r = Math.min(CONF_RANK[it.picked.cid ? 'high' : it.cconf] ?? 0, CONF_RANK[it.picked.veh ? 'high' : it.vconf] ?? 0, CONF_RANK[it.picked.slot ? 'high' : it.sconf] ?? 0);
  return ['none', 'low', 'mid', 'high'][r];
}
/** A new customer suggested from what the AI read (made only when the user ticks it) */
function newCustFor(v) {
  const name = v.name || v.insuredName || '';
  const key = nameKey(name) || 'x' + Object.keys(U.newCust).length;
  U.newCust[key] ||= { key, ok: false, data: { name, nameEn: v.nameEn || '', phone: v.phone || '', idNo: v.idNo || '', address: v.address || '' } };
  return 'C:' + key;
}
/** A new vehicle (or a renewal in a new month) suggested from the document */
function newVehFor(cid, v, ym) {
  const plate = plateOnly(v.plate, v.province);
  const key = cid + '|' + (plateKey(plate) || 'np' + Object.keys(U.newVeh).length) + '|' + ym;
  if (!U.newVeh[key]) {
    const data = {};
    for (const k of VFIELDS) if (v[k]) data[k] = v[k];
    data.plate = plate;
    U.newVeh[key] = { key, cid, ym, ok: false, data };
  }
  return 'N:' + key;
}
/** Customer, vehicle and folder of a row from the AI answer (only what the user did not choose) */
function placeRow(it) {
  if (U.smart && isPrbDoc(it.n) && it.prbRoute === undefined) it.prbRoute = true;
  if (it.prbRoute) return;
  const v = it.n?.values || {};
  if (!it.picked.slot) { const s = slotFromAi(it.n); if (s) { it.slot = s; it.sconf = FILE_SLOTS.includes(it.n?.slot) ? 'high' : 'mid'; } }
  if (!it.picked.cid && !U.fixedCid) {
    const m = findCustomer(v, S.customers, allVehicles(S.customers, S.vehicles));
    if (m) { it.cid = m.cid; it.cconf = m.conf; it.how = m.how; }
    else if (v.name || v.insuredName) { it.cid = newCustFor(v); it.cconf = 'new'; it.how = 'new'; }
    // v4.4.1: found by plate / chassis, but the document names someone else (e.g. a พ.ร.บ. of a company): never silently
    it.nameDiff = '';
    const dn = v.insuredName || v.name || '', mc = m && cust(m.cid);
    if (mc && m.how !== 'name' && nameKey(dn).length >= 3 && ![mc.name, mc.nameEn, mc.nick].some(x => x && nameKey(x) === nameKey(dn))) { it.cconf = 'low'; it.nameDiff = dn; }
  } else if (U.fixedCid && !it.picked.cid) {
    // uploading from inside a customer: the files go to that customer, but a different printed name is still shown
    const dn = v.insuredName || v.name || '', fc = cust(U.fixedCid);
    it.nameDiff = fc && nameKey(dn).length >= 3 && ![fc.name, fc.nameEn, fc.nick].some(x => x && nameKey(x) === nameKey(dn)) ? dn : '';
  }
  if (!it.picked.veh && it.cid) {
    const f = findVehicle(v, it.slot, vehChoices(it.cid));
    if (f.vid) { it.vkey = f.vid; it.vconf = f.conf; }
    else if (f.add) { it.vkey = newVehFor(it.cid, v, f.ym || ymForVehicle(v, todayIso())); it.vconf = 'new'; it.renew = f.renew || ''; }
  }
  it.conf = rowConf(it);
  autoName(it);
}
/** Files dropped together usually belong to the same vehicle */
function hintRows() {
  if (!U) return;
  batchHint(U.items.filter(it => !it.prbRoute).map(it => { it.conf = rowConf(it); return it; }));
  for (const it of U.items) if (it.conf === 'hint') autoName(it);
}

function startUpload(fileList, { cid = '', vid = '', slot = '', smart = false } = {}) {
  if (!canEdit()) return toast(t('err.role'), 'err');
  if (S.gate || !S.store) return toast(t('u.connect'), 'err');
  const files = sizeFilter([...fileList]);
  if (!files.length) return;
  if (!smart && !cust(cid)) return startUpload(fileList, { smart: true });
  if (vid && !vehOf(cid).some(v => v.id === vid)) vid = '';
  U = { smart, fixedCid: smart ? '' : cid, busy: false, items: [], newCust: {}, newVeh: {}, toggles: {} };
  U.items = files.map(f => newRow(f, { cid: smart ? '' : cid, vid, slot }));
  if (!smart) for (const it of U.items) { const list = vehOf(cid); if (!it.vkey && list.length === 1) { it.vkey = list[0].id; it.vconf = 'high'; } it.conf = rowConf(it); autoName(it); }
  sheet({ title: smart ? t('su.title') : t('u.title'), sub: smart ? t('su.sub') : esc(cust(cid).name), cls: 'xwide',
    body: `${smart && !aiOn() ? `<p class="note warn">${icon('alert', 15)}<span>${S.mode === 'local' ? t('ai.localOnly') : t('ai.off')} ${t('su.byHand')}</span></p>` : ''}
      <div id="upNew"></div><div class="up-list" id="upList"></div><div id="upDiff"></div>`,
    foot: `<button class="btn ghost" data-act="up-more">${icon('plus', 17)}<span>${t('u.more')}</span></button><span class="sp"></span>
      <button class="btn ghost" data-act="close-sheet">${t('btn.cancel')}</button><button class="btn primary" data-act="do-upload" id="upGo"></button>` });
  sheetClose = () => { U = null; };
  drawUpload();
  aiQueue();
}
/** The AI reads the files, two at a time. A failed or busy AI never blocks: the row is filled in by hand. */
async function aiQueue() {
  const u = U;
  const worker = async () => {
    for (;;) {
      if (U !== u) return;
      const it = u.items.find(x => x.ai === 'wait');
      if (!it) return;
      it.ai = 'busy'; it.since = Date.now(); drawUpload();
      try {
        it.prepared ||= await prepare([it.file]);   // kept: "Try again" sends the same bytes, so a late result comes from the cache
        const r = await S.store.aiExtract(it.prepared);
        if (U !== u) return;
        it.n = normalize(r);
        it.ai = 'done';
        placeRow(it);
      } catch (e) { it.ai = 'err'; it.err = aiErr(e); }
      if (U !== u) return;
      hintRows();
      drawUpload();
    }
  };
  await Promise.all([worker(), worker()]);
}
function aiErr(e) {
  if (e?.key) return t(e.key);
  return t({ offline: 'ai.offline', timeout: 'ai.stillWorking', network: 'ai.offline', ai_nokey: 'ai.nokey', ai_quota: 'ai.busy', ai_busy: 'ai.busy', too_big: 'ai.tooBig', role: 'err.role' }[e?.code] || 'ai.failed');
}
/** "old -> new" for existing vehicles and customers, from what the AI read (each change can be unticked) */
function uploadDiff() {
  const best = {};
  for (const it of U.items) {
    if (!it.n || !it.slot || it.done || it.prbRoute) continue;
    const folder = it.slot === '5.2' ? 'prev' : it.slot === '5.4' ? 'pay' : 'policy';
    const v = rowVeh(it);
    if (v && !v.isNew) for (const d of diff(v, it.n, folder)) if (VFIELDS.includes(d.key) && d.key !== 'plate') {
      const k = 'V|' + v.id + '|' + d.key;
      if (!best[k] || d.conf > best[k].conf) best[k] = { ...d, k, label: `${v.plate} · ${ymText(v.ym)}` };
    }
    const c = rowCust(it);
    if (c && !c.isNew) for (const d of diff(c, it.n, folder)) if (FIELD_GROUPS.customer.includes(d.key) && d.key !== 'name') {
      const k = 'C|' + c.id + '|' + d.key;
      if (!best[k] || d.conf > best[k].conf) best[k] = { ...d, k, label: c.name };
    }
  }
  return Object.values(best).map(d => ({ ...d, on: U.toggles[d.k] ?? d.on }));
}
function aiLine(it) {
  if (it.ai === 'skip') return '';
  if (it.ai === 'wait' || it.ai === 'busy') return `<p class="ai-line busy"><span class="spin sm"></span>${t('ai.reading')} <span class="elapsed" data-since="${it.since || ''}"></span><span class="slow-hint">${t('ai.slowHint')}</span></p>`;
  if (it.ai === 'err') return `<p class="ai-line err">${icon('alert', 14)}${esc(it.err)} · ${t('su.manual')} <button type="button" class="link" data-act="up-ai-retry">${t('ai.retry')}</button></p>`;
  const why = it.how ? ` · ${t('su.by.' + it.how)}` : '';
  const nd = it.nameDiff && !it.picked.cid ? `<p class="ai-line err">${icon('alert', 14)}${esc(t('su.nameDiff', { x: it.nameDiff }))}</p>` : '';
  const pc = it.n?.prb?.check, pb = pc && pc.ok === false ? `<p class="ai-line err">${icon('alert', 14)}${esc(t('su.prbBad', { v: pc.vatExpected.toFixed(2), t: pc.totalExpected.toFixed(2) }))}</p>` : '';
  return `<p class="hint">${icon('sparkle', 13)} ${t('ai.found', { x: t('dt.' + (it.n?.docType || 'other')) })}${why}</p>${nd}${pb}`;
}
const confChip = c => `<em class="conf ${{ high: 'c-hi', mid: 'c-mid', low: 'c-lo', hint: 'c-mid', none: 'c-lo' }[c] || 'c-lo'}">${t('su.conf.' + c)}</em>`;
const fmtVal = (k, v) => !v ? '' : DATE_FIELDS.has(k) ? fmtDay(v) : v;
function diffRows(list, attr) {
  return list.map(x => `<label class="drow ${x.conf < 0.6 ? 'lo' : x.conf < 0.85 ? 'mid' : ''}"><input type="checkbox" ${attr}="${esc(x.k || x.key)}" ${x.on ? 'checked' : ''}>
    <span class="d-k">${x.label ? `<bdi>${esc(x.label)}</bdi> · ` : ''}${t('cf.' + x.key)}${x.note ? ` <em class="conf c-lo">${t(x.note)}</em>` : x.conf < 0.85 ? ` <em class="conf c-${x.conf < 0.6 ? 'lo' : 'mid'}">${t(x.conf < 0.6 ? 'conf.lo' : 'conf.mid')}</em>` : ''}</span>
    <span class="d-v"><s>${esc(fmtVal(x.key, x.old)) || '—'}</s>${icon('chev', 14)}<b>${esc(fmtVal(x.key, x.new))}</b></span></label>`).join('');
}
const opt = (v, l, cur, extra = '') => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''} ${extra}>${esc(l)}</option>`;
/** New customers / vehicles this upload would make: shown on top, each with its own "make it" box */
function drawPending() {
  const el = $('#upNew'); if (!el) return;
  const used = new Set(U.items.filter(x => !x.done && !x.prbRoute).flatMap(x => [x.cid, x.vkey]));
  const cs = Object.values(U.newCust).filter(n => used.has('C:' + n.key));
  const vs = Object.values(U.newVeh).filter(n => used.has('N:' + n.key));
  el.innerHTML = cs.length || vs.length ? `<section class="su-new">
    ${cs.map(n => `<div class="su-card ${n.ok ? 'ok' : ''}" data-nc="${esc(n.key)}">
      <label class="su-ok"><input type="checkbox" data-nc-ok ${n.ok ? 'checked' : ''}><b>${icon('userplus', 15)} ${t('su.newCust')}</b></label>
      <div class="su-f"><label>${t('cf.name')} *<input data-nc-f="name" value="${esc(n.data.name)}" maxlength="120"></label>
        <label>${t('cf.phone')}<input data-nc-f="phone" value="${esc(n.data.phone)}" inputmode="tel" dir="ltr"></label>
        <label>${t('cf.idNo')}<input data-nc-f="idNo" value="${esc(n.data.idNo)}" dir="ltr"></label></div></div>`).join('')}
    ${vs.map(n => { const c = n.cid.startsWith('C:') ? U.newCust[n.cid.slice(2)]?.data.name : cust(n.cid)?.name; return `<div class="su-card ${n.ok ? 'ok' : ''}" data-nv="${esc(n.key)}">
      <label class="su-ok"><input type="checkbox" data-nv-ok ${n.ok ? 'checked' : ''}><b>${icon('car', 15)} ${t(vehOf(n.cid).some(v => plateKey(v.plate) === plateKey(n.data.plate)) ? 'su.renew' : 'su.newVeh')}</b><small>${esc(c || '')}</small></label>
      <div class="su-f"><label>${t('cf.plate')} *<input data-nv-f="plate" value="${esc(n.data.plate || '')}" maxlength="40"></label>
        <label>${t('vh.monthFolder')}<input type="month" data-nv-f="ym" value="${esc(n.ym)}"></label>
        <label>${t('cf.brand')} / ${t('cf.model')}<input data-nv-f="model" value="${esc([n.data.brand, n.data.model].filter(Boolean).join(' '))}"></label>
        <label>${t('cf.vin')}<input data-nv-f="vin" value="${esc(n.data.vin || '')}" dir="ltr"></label></div></div>`; }).join('')}</section>` : '';
}
function drawUpload() {
  const el = $('#upList'); if (!el || !U) return;
  drawPending();
  el.innerHTML = U.items.map((it, i) => {
    const route = U.smart && isPrbDoc(it.n) ? `<label class="prb-route"><input type="checkbox" data-prb-route="${i}" ${it.prbRoute ? 'checked' : ''}>${t('prb.route')}</label>` : '';
    if (it.prbRoute) return `<div class="up-row" data-i="${i}"><div class="up-main"><b>${esc(it.file.name)}</b>${route}<p>${t('prb.routeHint')}</p><p>${esc(rowFromAi(it.n).insured.name)}</p></div><button class="icon-btn" data-act="up-remove" aria-label="${t('u.remove')}">${icon('x')}</button></div>`;
    const c = rowCust(it), v = rowVeh(it), list = vehChoices(it.cid);
    const missing = !it.cid || !it.vkey || !it.slot;
    return `
    <div class="up-row su-row ${it.done ? 'done' : ''} ${missing && !it.done ? 'need' : ''}" data-i="${i}" style="--i:${Math.min(i, 8)}">
      <span class="up-th">${it.url ? `<img src="${it.url}" alt="">` : ftBadge({ mime: it.file.type, name: it.file.name }, 22)}</span>
      <div class="up-main">
        <div class="up-top"><small class="su-file" title="${esc(it.file.name)}">${esc(it.file.name)} · ${fmtSize(it.file.size)}</small>${it.ai === 'done' || it.ai === 'err' || it.ai === 'skip' ? confChip(missing ? 'none' : it.conf) : ''}
          <button class="icon-btn sm" data-act="up-remove" aria-label="${t('u.remove')}">${icon('x', 15)}</button></div>
        ${aiLine(it)}
        ${route}
        <div class="su-grid">
          ${U.fixedCid ? '' : `<label>${t('u.customer')}<select data-u="cid">${opt('', t('su.choose'), it.cid)}${S.customers.map(x => opt(x.id, x.name + (x.nick ? ` (${x.nick})` : ''), it.cid)).join('')}
            ${Object.values(U.newCust).map(n => opt('C:' + n.key, `${t('su.newCust')}: ${n.data.name}`, it.cid)).join('')}${opt('__new', '+ ' + t('su.newCust') + '…', '')}</select></label>`}
          <label>${t('vh.vehicle')}<select data-u="vkey" ${it.cid ? '' : 'disabled'}>${opt('', t('su.choose'), it.vkey)}${list.map(x => opt(x.id, (x.isNew ? t('su.newVeh') + ': ' : '') + vehLabel(x), it.vkey)).join('')}${it.cid ? opt('__new', '+ ' + t('vh.add') + '…', '') : ''}</select></label>
          <label>${t('vh.month')}<input value="${v ? esc(ymText(v.ym)) : '—'}" readonly tabindex="-1"></label>
          <label>${t('fo.choose')}<select data-u="slot">${opt('', t('su.choose'), it.slot)}${FILE_SLOTS.map(s => opt(s, VSLOT[s].th, it.slot)).join('')}</select></label>
        </div>
        <label class="su-name">${t('u.fileName')}<input data-u="name" maxlength="200" value="${esc(it.name)}" aria-label="${t('u.fileName')}"></label>
        ${it.done ? `<p class="ai-line ok">${icon('check', 14)}${t('u.saved')}</p>` : missing ? `<p class="ai-line err">${icon('alert', 14)}${t('su.pick')}</p>` : ''}
        <div class="prog"><i style="width:${it.done ? 100 : it.p * 100}%"></i></div>
      </div>
    </div>`;
  }).join('');
  const d = uploadDiff(), de = $('#upDiff');
  de.innerHTML = d.length ? `<section class="diff"><h3>${icon('wand', 16)}${t('diff.title')}</h3><p class="muted">${t('su.diffSub')}</p>${diffRows(d, 'data-diff')}</section>` : '';
  const go = $('#upGo');
  if (go) { const n = U.items.filter(x => !x.done).length; go.textContent = d.some(x => x.on) ? t('u.saveApply', { n }) : t('u.save', { n }); go.disabled = U.busy; }
}
/** A choice in a row changed (customer, vehicle, folder) */
function rowPick(it, k, val) {
  if (k === 'cid') {
    if (val === '__new') { it.cid = newCustFor({ name: '' }); }
    else it.cid = val;
    it.picked.cid = true; it.touched = true; it.cconf = 'high';
    it.vkey = ''; it.picked.veh = false; it.vconf = 'none';
    const list = vehChoices(it.cid);
    if (it.n) { const f = findVehicle(it.n.values, it.slot, list); if (f.vid) { it.vkey = f.vid; it.vconf = f.conf; } else if (f.add) { it.vkey = newVehFor(it.cid, it.n.values, f.ym || ymForVehicle(it.n.values, todayIso())); it.vconf = 'new'; } }
    if (!it.vkey && list.length === 1) { it.vkey = list[0].id; it.vconf = 'high'; }
  } else if (k === 'vkey') {
    if (val === '__new') it.vkey = newVehFor(it.cid, it.n?.values?.plate ? it.n.values : {}, ymForVehicle(it.n?.values || {}, todayIso()));
    else it.vkey = val;
    it.picked.veh = true; it.touched = true; it.vconf = 'high';
  } else if (k === 'slot') { it.slot = val; it.picked.slot = true; it.sconf = 'high'; }
  it.conf = rowConf(it);
  for (const x of U.items) autoName(x);
  drawUpload();
}

async function doUpload(btn) {
  if (!U || U.busy) return;
  if (U.items.some(it => it.ai === 'busy' || it.ai === 'wait')) return toast(t('ai.reading'));
  const prbItems = U.items.filter(it => !it.done && it.prbRoute).map(it => ({ file: it.file, n: it.n, ...rowFromAi(it.n) }));
  const todo = U.items.filter(it => !it.done && !it.prbRoute);
  const missing = todo.find(it => !it.cid || !it.vkey || !it.slot);
  if (missing) { toast(t('su.pickAll'), 'err'); $(`.up-row[data-i="${U.items.indexOf(missing)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
  const nc = [...new Set(todo.map(it => it.cid).filter(x => x.startsWith('C:')))].map(k => U.newCust[k.slice(2)]);
  const nv = [...new Set(todo.map(it => it.vkey).filter(x => x.startsWith('N:')))].map(k => U.newVeh[k.slice(2)]);
  const notOk = [...nc, ...nv].find(n => !n.ok);
  if (notOk) { toast(t('su.confirmNew'), 'err'); $('#upNew')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  if (nc.some(n => !n.data.name.trim())) return toast(t('su.needName'), 'err');
  if (nv.some(n => !plateOnly(n.data.plate))) return toast(t('vh.needPlate'), 'err');
  const u = U;
  for (const it of u.items) if (it.ai === 'wait') it.ai = 'skip';   // save now; files not read yet are saved without AI
  u.busy = true; drawUpload();
  u.made ||= {};   // key -> real id, so "Save" again after an error never makes anything twice
  let done = 0, failed = null, firstCid = '', firstVid = '';
  try {
    for (const n of nc) if (!u.made['C:' + n.key]) {
      btn.textContent = t('su.making');
      const c = await S.store.saveCustomer({ ...tidy({ ...n.data }) });
      u.made['C:' + n.key] = c.id;
      S.customers.push({ ...c });
    }
    const realCid = id => u.made[id] || id;
    const vehOfRow = async it => {
      if (u.made[it.vkey]) return u.made[it.vkey];
      const cid = realCid(it.cid);
      let v;
      if (it.vkey.startsWith('N:')) {
        const n = u.newVeh[it.vkey.slice(2)];
        v = await S.store.saveVehicle({ customerId: cid, ym: n.ym, ...n.data, plate: plateOnly(n.data.plate) });
      } else if (it.vkey.startsWith('L:')) v = await realVehicle(vehById(it.vkey), cid);
      else v = vehById(it.vkey);
      u.made[it.vkey] = v.id;
      if (!S.vehicles.some(x => x.id === v.id)) S.vehicles.push(v);
      return v.id;
    };
    for (const [i, it] of u.items.entries()) {
      if (it.done || it.prbRoute) continue;
      btn.textContent = t('su.making');
      const vid = await vehOfRow(it), cid = realCid(it.cid);
      let blob = it.file;
      if (compressible(blob)) { btn.textContent = t('u.compressing'); blob = await compressImage(blob); }
      if (blob.size > MAX) { toast(t('u.tooBig', { x: it.file.name, n: MAX_UPLOAD_MB }), 'err'); continue; }
      btn.textContent = t('u.saving');
      const vals = it.n?.values || {};
      // v4.4.1: the file's expiry is the date the user saw and corrected on the review card (same as the vehicle header);
      // a doubtful AI date (end not after start, or years later: BE/CE mix-up) is not used for the file
      const nv = it.vkey.startsWith('N:') ? u.newVeh[it.vkey.slice(2)] : null;
      let exp = it.n?.notes?.policyExpiry ? '' : vals.policyExpiry || '';
      if (nv && nv.data.policyExpiry && (!vals.policyStart || nv.data.policyStart === vals.policyStart || !exp)) exp = nv.data.policyExpiry;
      const meta = { name: saveName(it.name, it.file, blob), orig: it.file.name, customerId: cid, vehicleId: vid, slot: it.slot, type: VSLOT[it.slot].type,
        expiry: ['1', '2', '3'].includes(it.slot) ? exp : '', note: it.n ? fileNote(it.n, it.slot === '5.4' ? 'pay' : it.slot === '5.2' ? 'prev' : 'policy') : '' };
      const thumb = await makeThumb(blob);
      if (S.store.kind === 'local') meta.thumb = thumb;
      const bar = $(`.up-row[data-i="${i}"] .prog i`);
      const f = await S.store.addFile(blob, meta, p => { if (bar) bar.style.width = p * 100 + '%'; });
      if (thumb && S.store.thumbCache) S.store.thumbCache.set(f.id, thumb);
      it.done = true; done++;
      firstCid ||= cid; firstVid ||= vid;
      if (U === u) drawUpload();
    }
    // the ticked "old -> new" changes: merged into the vehicle / customer by the backend
    const ch = uploadDiff().filter(x => x.on), upd = {};
    for (const x of ch) { const [kind, id, key] = x.k.split('|'); (upd[kind + '|' + id] ||= { kind, id, v: {} }).v[key] = x.new; }
    for (const g of Object.values(upd)) {
      if (g.kind === 'V') { const id = u.made[g.id] || g.id; if (!id.startsWith('L:')) await S.store.saveVehicle({ id, ...g.v }); }
      else { const c = cust(g.id); const chk = checkCustomer({ ...c, ...g.v }); if (!Object.keys(chk.errors).length) await S.store.saveCustomer({ id: c.id, name: c.name, ...g.v }); else toast(t('diff.invalid'), 'err'); }
    }
  } catch (e) { failed = e; }
  finally {
    u.busy = false;
    if (done || !failed) await reload().catch(() => { });
    if (U === u) drawUpload();
  }
  if (failed) throw failed;
  closeSheet();
  if (prbItems.length) { S.view = 'prb'; mount(); return prbStart(prbItems); }
  toast(t('u.done', { n: done }));
  if (firstCid) openCustomer(firstCid, firstVid);
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
  const vs = vehOf(f.customerId);
  const where = f.vslot ? `${esc(vehLabel(vehById(f.vehicleId)))} · ${slotName(f.vslot)}` : FOLDER[f.folder] ? iso(FOLDER[f.folder].th) : 'ไม่ระบุ · ' + t('fo.other');
  sheet({ title: esc(f.name), sub: `${esc(c.name)} · ${fmtSize(f.size)} · ${fmtDay(f.createdAt)}${by}`, cls: 'wide',
    body: `<div class="preview" id="preview"><div class="spin"></div></div>
    <p class="in-folder">${t('fo.in')}: <b>${where}</b><span id="shState" ${f.shared ? '' : 'style="display:none"'}> · ${icon('link', 13)} ${t('sh.on')}</span></p>
    ${canEdit() && !inv && vs.length ? `<details class="move" ${f.vslot ? '' : 'open'}><summary>${icon('move', 16)}${t('fo.move')}</summary>
      <label class="fld mv-veh"><span class="fl">${t('vh.vehicle')}</span><select id="mvVeh">${vs.map(v => opt(v.id, vehLabel(v), f.vehicleId || vs[0].id)).join('')}</select></label>
      ${slotPicker(f.vslot)}<p class="muted">${t('fo.moveNote')}</p></details>` : ''}
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
      ${canEdit() && !inv && aeReadable(f) ? `<button type="button" class="btn ghost sm" data-act="ae-file" data-id="${esc(f.id)}" title="${t('ae.file')}">${icon('wand', 16)}<span>${t('ae.file')}</span></button>` : ''}
      ${canEdit() && f.aib ? `<button type="button" class="btn danger-ghost sm" data-act="ae-undo" data-b="${esc(f.aib)}" data-id="${esc(f.id)}">${icon('history', 16)}<span>${t('ae.undo')}</span></button>` : ''}
      ${S.store.kind === 'cloud' && canEdit() ? `<button type="button" class="btn ghost sm sh-btn" data-act="share-link" title="${t('sh.copy')}" aria-label="${t('sh.copy')}">${icon('link', 16)}<span>${t('sh.copy')}</span></button>
      <button type="button" class="btn ghost sm sh-btn" data-act="share-stop" id="shStop" title="${t('sh.stop')}" aria-label="${t('sh.stop')}" ${f.shared ? '' : 'style="display:none"'}>${icon('unlink', 16)}<span>${t('sh.stop')}</span></button>` : ''}
      ${navigator.share ? `<button type="button" class="icon-btn" data-act="share-file" title="${t('fl.share')}">${icon('share', 17)}</button>` : ''}
      <span class="sp"></span>${inv ? '' : `<button class="btn primary" type="submit" form="fform" data-need="edit">${t('fl.saveChanges')}</button>`}` });
  let blob;
  try { blob = await S.store.getBlob(id); }
  catch (e) { const pv = $('#preview'); if (pv && cur?.f.id === id) pv.innerHTML = `<p class="sh-text">${t('fl.noContent')}</p>`; throw e; }
  if (cur?.f.id !== id) return;
  const pv = $('#preview'); if (!pv) return;
  if (!blob) { pv.innerHTML = `<p class="sh-text">${t('fl.noContent')}</p>`; return; }
  // v4.5.1 security: a "PDF" is always shown from a blob typed as PDF, so a file of another type renamed to .pdf
  // (e.g. HTML) can never run inside the app; download / share still use the original blob
  cur.blob = blob; cur.url = objUrl(isPdf(f) && !isImage(f) ? new Blob([blob], { type: 'application/pdf' }) : blob);
  pv.innerHTML = isImage(f) ? `<img src="${cur.url}" alt="${esc(f.name)}">`
    : isPdf(f) ? `<iframe src="${cur.url}#toolbar=0" title="${esc(f.name)}"></iframe><button class="btn dark open-full" data-act="open-link" data-url="${cur.url}">${icon('external', 16)}<span>${t('fl.full')}</span></button>`
      : `<div class="nopv">${ftBadge(f, 30)}<p>${t('fl.noPreview')}</p></div>`;
}
/** v4: the 9 folders a file can go into */
function slotPicker(cur) {
  return `<div class="fpick">${FILE_SLOTS.map(s => `<button type="button" role="radio" aria-checked="${cur === s}" class="${cur === s ? 'on' : ''}" data-act="mv-slot" data-slot="${s}">
    <span class="fp-ico">${icon(VSLOT[s].icon, 18)}</span><b>${iso(VSLOT[s].th)}</b><small>${t('vs.' + s)}</small></button>`).join('')}</div>`;
}
/** Moves the open file (the user confirms) into a folder of one of its customer's vehicles */
async function moveCur(slot) {
  const f = cur?.f; if (!f) return;
  let v = vehById($('#mvVeh')?.value || f.vehicleId);
  if (!v) return toast(t('su.pick'), 'err');
  if (f.vehicleId === v.id && f.vslot === slot) return;
  if (!await confirmBox(t('fo.moveQ', { x: esc(f.name), y: `${esc(vehLabel(v))} · ${slotName(slot)}` }), t('fo.move'), false)) return;
  v = await realVehicle(v, f.customerId);
  await S.store.moveFile(f.id, { vehicleId: v.id, slot });
  await reload(); toast(t('fo.moved', { x: slotName(slot) }));
}
function download(blob, name) {
  const a = document.createElement('a'); a.href = objUrl(blob); a.download = name; document.body.append(a); a.click(); a.remove();
}
/* ---------- share ONE file by link (v3.2) ---------- */
/**
 * The backend makes only this file "anyone with the link: viewer". The copy is started inside the tap
 * (ClipboardItem with a promise), so it also works on iPhone; the link is only copied once sharing worked.
 */
async function shareLink(f) {
  const p = S.store.shareFile(f.id).then(r => r.link);
  let copied = false;
  if (window.ClipboardItem && navigator.clipboard?.write) {
    try { await navigator.clipboard.write([new ClipboardItem({ 'text/plain': p.then(l => new Blob([l], { type: 'text/plain' })) })]); copied = true; } catch { }
  }
  const link = await p;   // a failed share throws here (the error is shown); nothing that does not work was copied
  if (!copied) try { await navigator.clipboard.writeText(link); copied = true; } catch { }
  markShared(f.id, true);
  if (copied) toast(t('sh.copied'));
  else linkSheet(link);
}
function linkSheet(link) {
  sheet({ title: t('sh.title'), cls: 'small', body: `<p class="sh-text">${t('sh.manual')}</p><div class="form"><label class="fld"><input id="shLink" value="${esc(link)}" readonly dir="ltr"></label></div><p class="muted">${t('sh.note')}</p>`,
    foot: `<span class="sp"></span><button class="btn ghost" data-act="close-sheet">${t('btn.close')}</button><button class="btn primary" data-act="copy-link">${icon('link', 17)}<span>${t('sh.copyBtn')}</span></button>` });
}
async function copyLink() {
  const el = $('#shLink'); if (!el) return;
  try { await navigator.clipboard.writeText(el.value); }
  catch { el.select(); document.execCommand?.('copy'); }
  toast(t('sh.copied'));
}
async function stopShare(f) {
  const x = await S.store.unshareFile(f.id);
  markShared(f.id, !!x?.shared);
  toast(t('sh.stopped'));
}
/** Updates the file window and the tiles without loading everything again */
function markShared(id, on) {
  const f = S.files.find(x => x.id === id); if (f) f.shared = on;
  if (cur?.f.id === id) { const a = $('#shStop'), b = $('#shState'); if (a) a.style.display = on ? '' : 'none'; if (b) b.style.display = on ? '' : 'none'; }
  for (const tb of $$(`.tile[data-id="${CSS.escape(id)}"] .thumb`)) {
    tb.querySelector('.link-flag')?.remove();
    if (on) tb.insertAdjacentHTML('beforeend', linkFlag());
  }
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
/** Vehicle and policy lines of an invoice, from a vehicle (v4) or the old customer details */
const invVeh = (v, c) => ({ brand: v?.brand || c.brand || '', model: v?.model || c.model || (!c.brand ? c.car || '' : ''), plate: v?.plate || plateOnly(c.plate, c.province) || '', province: v?.province || c.province || '' });
const invPol = (v, c) => v ? { type: v.policyType || '', insurer: v.insurer || '', no: v.policyNo || '', start: v.policyStart || '', end: v.policyExpiry || '' }
  : { type: c.policyType || '', insurer: c.insurer || '', no: c.policyNo || '', start: c.policyStart || '', end: c.policyExpiry || S.exp[c.id]?.exp || '' };
function newInvoice(cid, vid = '') {
  const c = cust(cid); if (!c) return pickCustomerSheet('invoice');
  const vs = vehOf(c);
  const v = vehById(vid) || (S.sel === cid ? vehById(S.openVeh) : null) || latestOf(vs)[0] || null;
  let l = 'both'; try { l = localStorage.getItem('by_invlang') || 'both'; } catch { }
  I = { id: '', tab: 'edit', d: {
    customerId: c.id, vehicleId: v?.id || '', issue: todayIso(), due: addDays(todayIso(), 7), lang: l,
    cust: { name: c.name, phone: c.phone || '', address: c.address || '' },
    veh: invVeh(v, c), pol: invPol(v, c),
    items: [{ d: invItemDefault(l), q: 1, p: v?.premium || c.premium || '' }], discount: '', vat: false, paid: '', notes: '',
  } };
  invoiceEditor();
}
/** v4: the vehicle of a new invoice (its PDF is saved in folder 4 of that vehicle) */
function invPickVehicle(vid) {
  const c = cust(I.d.customerId), v = vehById(vid);
  I.d.vehicleId = v?.id || '';
  I.d.veh = invVeh(v, c); I.d.pol = invPol(v, c);
  if (v?.premium && I.d.items.length === 1 && !String(I.d.items[0].p).trim()) I.d.items[0].p = v.premium;
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
      <fieldset class="fgroup"><legend>${t('g.vehicle')}</legend>
        ${!I.id && vehOf(d.customerId).length ? `<label class="fld"><span class="fl">${t('vh.invVehicle')}</span><select data-inv-veh>${opt('', '—', d.vehicleId)}${vehOf(d.customerId).map(v => opt(v.id, vehLabel(v), d.vehicleId)).join('')}</select></label>` : ''}
        <div class="fgrid">${f(t('cf.brand'), 'veh.brand', d.veh.brand)}${f(t('cf.model'), 'veh.model', d.veh.model)}${f(t('cf.plate'), 'veh.plate', d.veh.plate)}${f(t('cf.province'), 'veh.province', d.veh.province, 'list="dl-prov"')}</div></fieldset>
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
  try {
    if (!I.id && I.d.vehicleId?.startsWith('L:')) I.d.vehicleId = (await realVehicle(vehById(I.d.vehicleId), I.d.customerId)).id;   // the PDF goes into that vehicle's folder 4
    const data = { ...I.d, discount: money(I.d.discount) || 0, paid: money(I.d.paid) || 0 };
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
      ${local ? `<p class="note">${icon('info', 15)}<span>${t('inv.localNote')}</span></p>` : `<p class="muted">${t('inv.savedIn', { x: inv.vehicleId ? `${esc(vehById(inv.vehicleId)?.plate || '')} · ${slotName('4')}` : iso(FOLDER.pay.th) })}</p>`}`,
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
    <ul class="mig-names">${FOLDERS.map(F => `<li><b>${iso(F.th)}</b><small>${t('fo.' + F.slot)}</small></li>`).join('')}</ul><div id="migOut"></div>`,
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

/* ---------- rename existing files (admin, v3.2): list first, then Apply; Undo puts the old names back ---------- */
let RN = null;
function renamePlan() {
  const key = f => f.customerId + '|' + (f.folder || '') + '|' + (f.vehicleId || '') + '|' + (f.vslot || '');
  const taken = {};
  for (const f of S.files) (taken[key(f)] ||= new Set()).add(f.name);
  const rows = [];
  // oldest first: the first file keeps the plain name, later ones get " (2)", " (3)"…
  for (const f of [...S.files].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))) {
    if (f.invoice) continue;   // invoices keep their number as name
    if (followsPattern(f.name)) continue;   // v4: names that already follow the pattern are never changed
    const c = cust(f.customerId); if (!c) continue;
    const want = f.vslot ? vehicleFileName({ vehicle: vehById(f.vehicleId), customer: c, slot: f.vslot, ext: extOf(f.name) }) : buildName({ plate: plateFromName(f.name) || plateOnly(c.plate, c.province), customer: c,
      month: monthOf(c.contractDate, c.policyStart, String(f.at || f.createdAt || '').slice(0, 10)), doc: docNameFromOld(f.name, f.folder, f.type), ext: extOf(f.name) });
    const set = taken[key(f)];
    set.delete(f.name);
    const name = uniqueIn(want, set);   // preview only; the backend checks again
    set.add(name);
    if (name !== f.name) rows.push({ id: f.id, cid: c.id, old: f.name, name, on: true });
  }
  return rows;
}
function renameSheet() {
  RN ||= { rows: renamePlan() };
  const rows = RN.rows, n = rows.filter(r => r.on).length;
  const groups = [];
  for (const [i, r] of rows.entries()) { let g = groups.find(x => x.cid === r.cid); if (!g) groups.push(g = { cid: r.cid, items: [] }); g.items.push(i); }
  sheet({ title: t('rn.title'), sub: t('rn.sub'), cls: 'wide', body: `<p class="note">${icon('info', 15)}<span>${t('rn.explain')}</span></p>
    ${rows.length ? `<div class="rn-bar"><b>${t('rn.count', { n: rows.length })}</b><span class="sp"></span><button type="button" class="link" data-act="rn-all" data-on="1">${t('rn.all')}</button><button type="button" class="link" data-act="rn-all" data-on="">${t('rn.none')}</button></div>
    <div class="rn-list">${groups.map(g => `<details ${groups.length <= 15 ? 'open' : ''}><summary>${esc(cust(g.cid)?.name || '—')} <em class="cnt">${num(g.items.length)}</em></summary>
      ${g.items.map(i => `<div class="rn-row"><input type="checkbox" data-rn-on="${i}" ${rows[i].on ? 'checked' : ''} aria-label="${esc(rows[i].old)}">
        <div class="rn-main"><s>${esc(rows[i].old)}</s><input data-rn-name="${i}" value="${esc(rows[i].name)}" maxlength="200" autocomplete="off" aria-label="${t('u.fileName')}"></div></div>`).join('')}</details>`).join('')}</div>`
    : `<p class="sh-text">${t('rn.nothing')}</p>`}`,
    foot: `<button type="button" class="btn danger-ghost" data-act="rn-undo">${icon('history', 17)}<span>${t('rn.undo')}</span></button><span class="sp"></span>
      <button type="button" class="btn ghost" data-act="close-sheet">${t('btn.cancel')}</button>${rows.length ? `<button type="button" class="btn primary" data-act="rn-apply" id="rnGo">${t('rn.apply', { n })}</button>` : ''}` });
  sheetClose = () => { RN = null; };
}
const rnCount = () => { const b = $('#rnGo'); if (b && RN) b.textContent = t('rn.apply', { n: RN.rows.filter(r => r.on).length }); };
function rnReport(lines) {
  sheet({ title: t('rn.title'), sub: t('rn.report'), cls: 'small', body: lines.filter(Boolean).map(l => `<p class="sh-text">${l}</p>`).join('') + `<p class="muted">${t('rn.safe')}</p>`,
    foot: `<button type="button" class="btn danger-ghost" data-act="rn-undo">${icon('history', 17)}<span>${t('rn.undo')}</span></button><span class="sp"></span><button class="btn primary" data-act="close-sheet">${t('btn.close')}</button>` });
}
async function renameApply() {
  const rows = RN?.rows.filter(r => r.on && r.name.trim() && r.name !== r.old) || [];
  if (!rows.length) return toast(t('rn.pick'), 'err');
  const keep = RN;
  if (!await confirmBox(t('rn.confirm', { n: rows.length }), t('rn.apply', { n: rows.length }), false)) { RN = keep; return renameSheet(); }
  RN = null;
  const batch = 'rn' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const queue = rows.map(r => ({ id: r.id, name: r.name.trim() }));
  let ok = 0, same = 0, bad = 0, sent = 0, tries = 0, failed = null;
  sheet({ title: t('rn.title'), cls: 'small', body: `<p class="as-tip" id="rnProg"><span class="spin sm"></span>${t('rn.working', { a: 0, b: rows.length })}</p>` });
  try {
    while (queue.length && tries++ < rows.length + 20) {
      const chunk = queue.splice(0, 40);
      const r = await S.store.renameFiles(batch, chunk);
      for (const x of r.rows) {
        if (x.status === 'later') { queue.push(chunk.find(c => c.id === x.id)); continue; }
        sent++;
        if (x.status === 'ok') ok++; else if (x.status === 'same') same++; else bad++;
      }
      const pg = $('#rnProg'); if (pg) pg.innerHTML = `<span class="spin sm"></span>${t('rn.working', { a: sent, b: rows.length })}`;
    }
  } catch (e) { failed = e; }
  await reload().catch(() => { });
  rnReport([t('rn.done', { n: ok }), same ? t('rn.same', { n: same }) : '', bad + queue.length ? t('rn.err', { n: bad + queue.length }) : '']);
  if (failed) throw failed;
}
async function renameUndo() {
  if (!await confirmBox(t('rn.undoQ'), t('rn.undo'), false)) return;
  RN = null;
  sheet({ title: t('rn.undo'), cls: 'small', body: `<p class="as-tip"><span class="spin sm"></span>${t('rn.undoing')}</p>` });
  let done = 0, skipped = 0, r, guard = 0;
  try {
    do { r = await S.store.renameUndo(); done += r.done; skipped += r.skipped; } while (r.more && (r.done || r.skipped) && guard++ < 50);
  } finally {
    await reload().catch(() => { });
    sheet({ title: t('rn.undo'), sub: t('rn.report'), cls: 'small', body: `<p class="sh-text">${done || skipped ? t('rn.undone', { n: done }) : t('rn.undoNone')}</p>${skipped ? `<p class="sh-text">${t('rn.undoSkip', { n: skipped })}</p>` : ''}`,
      foot: `<span class="sp"></span><button class="btn primary" data-act="close-sheet">${t('btn.close')}</button>` });
  }
}

/* ---------- move existing files into the new folders (admin, one-time tool, v4) ---------- */
/*
 * Preview first: file -> from -> to plate / month / folder, editable, with tick boxes. "Apply" per customer, in small
 * batches. Only MOVES (never deletes or changes a file). Names that follow the pattern stay; others get a pattern name.
 * A row without a plate is NOT moved until a plate is chosen. "Undo last move" puts the last batch back.
 */
let MV = null;
const fromLabel = r => r.from ? iso(FOLDER[r.from].th) : 'ไม่ระบุ';
function movePlanAll() {
  return S.customers.map(c => ({ cid: c.id, rows: movePlan(c, S.files, S.vehicles, S.invoices) })).filter(g => g.rows.length);
}
function mvRowName(r) { if (!r.nameEdited) r.name = r.plate && r.slot ? moveName(r, cust(r.cid)) : r.old; return r.name; }
function moveSheet() {
  MV ||= { groups: movePlanAll() };
  const total = MV.groups.reduce((a, g) => a + g.rows.length, 0);
  sheet({ title: t('mv.title'), sub: t('mv.sub'), cls: 'xwide', body: `<p class="note">${icon('info', 15)}<span>${t('mv.explain')}</span></p>
    ${total ? `<div class="rn-bar"><b>${t('mv.count', { n: total })}</b></div>
    <div class="rn-list mv-list">${MV.groups.map((g, gi) => {
      const c = cust(g.cid), plates = [...new Set(vehOf(c).map(v => v.plate).filter(Boolean))];
      const ok = g.rows.filter(r => r.on && !r.done && r.plate && r.slot && r.ym).length;
      for (const v of g.det?.vehicles || []) if (!plates.includes(v.plate)) plates.push(v.plate);
      const dv = g.det?.vehicles || [];
      return `<details ${MV.groups.length <= 8 || g.det || g.detecting ? 'open' : ''} data-g="${gi}"><summary>${esc(c?.name || '—')} <em class="cnt">${num(g.rows.length)}</em></summary>
        <datalist id="mvp${gi}">${plates.map(p => `<option value="${esc(p)}">`).join('')}</datalist>
        <div class="mv-det">
          ${g.detecting ? `<p class="as-tip" id="mvDet${gi}"><span class="spin sm"></span>${t('mv.detecting', { a: g.detecting.a, b: g.detecting.b })}</p>`
            : `<button type="button" class="btn ghost sm" data-act="mv-detect" data-g="${gi}">${icon('wand', 15)}<span>${t(g.det ? 'mv.detectAgain' : 'mv.detect')}</span></button>${aiOn() ? '' : `<small class="muted">${t('mv.noAi')}</small>`}`}
          ${g.det ? `<p class="note">${icon('car', 15)}<span>${t('mv.detected', { n: dv.length })} ${t('mv.detNote')}</span></p>
            ${dv.map(v => { const n = g.rows.filter(r => r.det === v.key).length; return `<label class="mv-dv ${v.on ? '' : 'off'}" data-g="${gi}" data-k="${esc(v.key)}">
              <input type="checkbox" data-mvd-on ${v.on ? 'checked' : ''} aria-label="${esc(v.plate)}">
              <b dir="ltr">${esc(v.plate)}</b><input type="month" data-mvd-ym value="${esc(v.ym)}" aria-label="${t('vh.month')}">
              <small>${t('mv.srcFrom')}: ${v.src.map(s => t('mv.src.' + s)).join(', ')}${v.data.vin ? ` · <bdi dir="ltr">${esc(v.data.vin)}</bdi>` : ''}</small><em class="cnt">${t('mv.files', { n })}</em></label>`; }).join('')}` : ''}
        </div>
        ${g.rows.map((r, ri) => `<div class="rn-row mv-row ${r.done ? 'done' : ''} ${!r.plate || !r.slot ? 'need' : ''}" data-g="${gi}" data-r="${ri}">
          <input type="checkbox" data-mv-on ${r.on ? 'checked' : ''} ${r.done ? 'disabled' : ''} aria-label="${esc(r.old)}">
          <div class="rn-main">
            <s>${esc(r.old)}</s><small class="mv-from">${t('mv.from')}: ${fromLabel(r)}${r.src ? ` · ${t('mv.plateBy.' + r.src)}` : ''}</small>
            <div class="mv-to">
              <label>${t('cf.plate')}<input data-mv="plate" list="mvp${gi}" value="${esc(r.plate)}" placeholder="${esc(t('su.choose'))}" maxlength="40"></label>
              <label>${t('vh.month')}<input type="month" data-mv="ym" value="${esc(r.ym)}"></label>
              <label>${t('fo.choose')}<select data-mv="slot">${opt('', t('su.choose'), r.slot)}${FILE_SLOTS.map(s => opt(s, VSLOT[s].th, r.slot)).join('')}</select></label>
            </div>
            <input data-mv="name" value="${esc(mvRowName(r))}" maxlength="200" ${r.keep ? 'readonly' : ''} aria-label="${t('u.fileName')}">
            ${r.done ? `<p class="ai-line ok">${icon('check', 14)}${t('mv.moved')}</p>` : !r.plate || !r.slot ? `<p class="ai-line err">${icon('alert', 14)}${t('mv.choose')}</p>` : r.keep ? `<small class="muted">${t('mv.keepName')}</small>` : ''}
          </div></div>`).join('')}
        <div class="sh-actions"><span class="sp"></span><button type="button" class="btn primary sm" data-act="mv-apply" data-g="${gi}" ${ok ? '' : 'disabled'}>${t('mv.apply', { n: ok })}</button></div>
      </details>`;
    }).join('')}</div>` : `<p class="sh-text">${t('mv.nothing')}</p>`}`,
    foot: `<button type="button" class="btn danger-ghost" data-act="mv-undo">${icon('history', 17)}<span>${t('mv.undo')}</span></button>
      <button type="button" class="btn ghost" data-act="mv-old">${icon('folder', 17)}<span>${t('mv.old')}</span></button><span class="sp"></span>
      <button type="button" class="btn ghost" data-act="close-sheet">${t('btn.close')}</button>` });
  sheetClose = () => { MV = null; };
}
/**
 * v4.1 "Detect vehicles automatically" for one customer: plates and months from pattern file names, the customer's
 * details, existing vehicles and (AI on) the policy PDFs that have no plate in their name. Only a preview: nothing is
 * created or moved before Apply. A file with no plate anywhere stays "please choose".
 */
async function detectFor(gi) {
  const g = MV?.groups[gi]; if (!g || g.detecting) return;
  const c = cust(g.cid);
  const files = S.files.filter(f => g.rows.some(r => r.id === f.id));
  const ai = g.ai ||= {};
  const toRead = aiOn() ? files.filter(f => !ai[f.id] && needsAiRead(f, g.rows.find(r => r.id === f.id)?.slot)) : [];
  g.detecting = { a: 0, b: toRead.length };
  moveSheet();
  for (const f of toRead) {
    if (MV?.groups[gi] !== g) return;   // the sheet was closed
    try {
      const blob = await S.store.getBlob(f.id);
      const file = new File([blob], f.name, { type: blob.type || f.mime || 'application/pdf' });
      const n = normalize(await S.store.aiExtract(await prepare([file])));
      ai[f.id] = { ...n.values };
    } catch (e) { ai[f.id] = { failed: true }; }   // the AI failed or is busy: this file stays "please choose"
    g.detecting.a++;
    const p = $(`#mvDet${gi}`); if (p) p.innerHTML = `<span class="spin sm"></span>${t('mv.detecting', { a: g.detecting.a, b: g.detecting.b })}`;
  }
  if (MV?.groups[gi] !== g) return;
  g.detecting = null;
  g.det = detectVehicles(c, files, S.vehicles, ai);
  for (const r of g.rows) {
    if (r.done || r.touched) continue;
    const k = g.det.assign[r.id], v = g.det.vehicles.find(x => x.key === k);
    r.det = k || ''; r.src = !k ? '' : plateFromName(r.old) ? 'name' : 'ai';
    r.plate = v ? v.plate : ''; if (v) r.ym = v.ym;
    r.on = true; r.nameEdited = false;
  }
  moveSheet();
}
/** After a detected vehicle was ticked / its month changed: its rows follow, without drawing the list again */
function mvSyncRows(gi) {
  const g = MV?.groups[gi]; if (!g) return;
  for (const el of $$(`.mv-row[data-g="${gi}"]`)) {
    const r = g.rows[+el.dataset.r];
    el.querySelector('[data-mv-on]').checked = r.on;
    el.querySelector('[data-mv="ym"]').value = r.ym;
    const n = el.querySelector('[data-mv="name"]'); if (n && !r.nameEdited) n.value = mvRowName(r);
  }
  const b = $(`[data-act="mv-apply"][data-g="${gi}"]`), ok = g.rows.filter(x => x.on && !x.done && x.plate && x.slot && x.ym).length;
  if (b) { b.disabled = !ok; b.textContent = t('mv.apply', { n: ok }); }
}
async function moveApply(gi) {
  const g = MV?.groups[gi]; if (!g) return;
  const c = cust(g.cid);
  const rows = g.rows.filter(r => r.on && !r.done && r.plate && r.slot && r.ym);
  if (!rows.length) return toast(t('mv.choose'), 'err');
  const skipped = g.rows.filter(r => r.on && !r.done).length - rows.length;
  if (!await confirmBox(t('mv.confirm', { n: rows.length, x: esc(c.name) }) + (skipped ? ' ' + t('mv.skipped', { n: skipped }) : ''), t('mv.apply', { n: rows.length }), false)) return moveSheet();
  const keep = MV;
  sheet({ title: t('mv.title'), cls: 'small', body: `<p class="as-tip" id="mvProg"><span class="spin sm"></span>${t('mv.working', { a: 0, b: rows.length })}</p>` });
  sheetClose = () => { MV = null; };
  MV = keep;
  let ok = 0, bad = 0, failed = null;
  try {
    // 1) the vehicles (plate + month): an existing one, else made now (the old single plate brings its data along)
    const vid = {};
    for (const r of rows) {
      const k = plateKey(r.plate) + '|' + r.ym;
      if (vid[k]) continue;
      const have = vehOf(c).find(v => !v.legacy && plateKey(v.plate) === plateKey(r.plate) && v.ym === r.ym);
      if (have) { vid[k] = have.id; continue; }
      const L = vehOf(c).find(v => v.legacy && plateKey(v.plate) === plateKey(r.plate));
      const data = { customerId: c.id, ym: r.ym, plate: plateOnly(r.plate) };
      if (L && L.ym === r.ym) for (const f of VFIELDS) if (L[f] && f !== 'plate') data[f] = L[f];
      // v4.1: what "Detect vehicles" read (chassis no., dates, insurer… from the policy PDFs)
      const D = g.det?.vehicles.find(x => x.key === plateKey(r.plate));
      if (D) for (const f of VFIELDS) if (D.data[f] && !data[f] && f !== 'plate') data[f] = D.data[f];
      const v = await S.store.saveVehicle(data);
      S.vehicles.push(v);
      vid[k] = v.id;
    }
    // 2) move, a few files per request (the backend has a 6-minute limit)
    const batch = 'mv' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const queue = rows.map(r => ({ r, item: { id: r.id, vehicleId: vid[plateKey(r.plate) + '|' + r.ym], slot: r.slot, name: r.keep ? '' : (r.name || '').trim() } }));
    let tries = 0;
    while (queue.length && tries++ < rows.length + 20) {
      const chunk = queue.splice(0, 10);
      const res = await S.store.moveNew(batch, chunk.map(x => x.item));
      for (const x of res.rows) {
        const q = chunk.find(y => y.item.id === x.id);
        if (x.status === 'later') { queue.push(q); continue; }
        if (x.status === 'ok' || x.status === 'same') { ok++; q.r.done = true; } else bad++;
      }
      const pg = $('#mvProg'); if (pg) pg.innerHTML = `<span class="spin sm"></span>${t('mv.working', { a: ok + bad, b: rows.length })}`;
    }
  } catch (e) { failed = e; }
  await reload().catch(() => { });
  MV = { groups: movePlanAll() };
  sheet({ title: t('mv.title'), sub: t('rn.report'), cls: 'small', body: `<p class="sh-text">${t('mv.done', { n: ok })}</p>${bad ? `<p class="sh-text">${t('mv.err', { n: bad })}</p>` : ''}<p class="muted">${t('mv.safe')}</p>`,
    foot: `<button type="button" class="btn danger-ghost" data-act="mv-undo">${icon('history', 17)}<span>${t('mv.undo')}</span></button><span class="sp"></span><button class="btn primary" data-act="move-tool">${t('mv.back')}</button>` });
  if (failed) throw failed;
}
async function moveUndo() {
  if (!await confirmBox(t('mv.undoQ'), t('mv.undo'), false)) return moveSheet();
  MV = null;
  sheet({ title: t('mv.undo'), cls: 'small', body: `<p class="as-tip"><span class="spin sm"></span>${t('mv.undoing')}</p>` });
  let done = 0, skipped = 0, r, guard = 0;
  try {
    do { r = await S.store.moveUndo(); done += r.done; skipped += r.skipped; } while (r.more && (r.done || r.skipped) && guard++ < 50);
  } finally {
    await reload().catch(() => { });
    sheet({ title: t('mv.undo'), sub: t('rn.report'), cls: 'small', body: `<p class="sh-text">${done || skipped ? t('mv.undone', { n: done }) : t('rn.undoNone')}</p>${skipped ? `<p class="sh-text">${t('mv.undoSkip', { n: skipped })}</p>` : ''}`,
      foot: `<span class="sp"></span><button class="btn primary" data-act="move-tool">${t('mv.back')}</button>` });
  }
}
/** The old 01_… 04_ folders: the empty ones can be deleted by the owner in Drive (the app never deletes them) */
async function oldFoldersSheet() {
  sheet({ title: t('mv.old'), cls: 'wide', body: `<p class="as-tip"><span class="spin sm"></span>${t('team.loading')}</p>` });
  const list = await S.store.oldFolders();
  const empty = list.filter(x => !x.items), full = list.length - empty.length;
  const cloud = S.store.kind === 'cloud';
  sheet({ title: t('mv.old'), sub: t('mv.oldSub', { n: empty.length }), cls: 'wide', body: `<p class="note">${icon('info', 15)}<span>${t('mv.oldExplain')}</span></p>
    ${empty.length ? `<div class="team-list">${empty.map((x, i) => `<div class="team-row" style="--i:${Math.min(i, 10)}"><span class="ava dv-ava">${icon('folder', 17)}</span>
      <span class="tmain"><b>${iso(x.name)}</b><small>${esc(x.customer || '')}</small></span>
      ${cloud ? `<a class="icon-btn sm" href="https://drive.google.com/drive/folders/${encodeURIComponent(x.id)}" target="_blank" rel="noopener" title="${t('set.folder')}">${icon('external', 15)}</a>` : ''}</div>`).join('')}</div>` : `<p class="sh-text">${t('mv.oldNone')}</p>`}
    ${full ? `<p class="muted">${t('mv.oldFull', { n: full })}</p>` : ''}`,
    foot: `<span class="sp"></span><button class="btn primary" data-act="move-tool">${t('mv.back')}</button>` });
}

/* ---------- restore original file names (admin, v4.2) ---------- */
/*
 * Preview first: per customer, current name -> old name (the name before the FIRST change by the rename / move tools),
 * editable, tick boxes, "name only" or "name + previous folder". Back = nothing changes. Apply in small batches with a
 * progress bar; a previous folder that no longer exists is never re-created (name only + a message). Undo restore.
 */
let RS = null;
async function restoreSheet() {
  RS = null;
  sheet({ title: t('rs.title'), sub: t('rs.sub'), cls: 'wide', body: `<p class="as-tip"><span class="spin sm"></span>${t('rs.loading')}</p>` });
  const rows = await S.store.restorePlan();
  RS = { rows: rows.map(r => ({ ...r, on: true, back: false, want: r.old })) };
  drawRestore();
}
const rsCount = () => RS ? RS.rows.filter(r => r.on && r.want.trim()).length : 0;
function drawRestore() {
  const rows = RS.rows, groups = [];
  for (const [i, r] of rows.entries()) { let g = groups.find(x => x.cid === r.customerId); if (!g) groups.push(g = { cid: r.customerId, name: cust(r.customerId)?.name || r.customer || '—', items: [] }); g.items.push(i); }
  sheet({ title: t('rs.title'), sub: t('rs.sub'), cls: 'wide', body: `<p class="note">${icon('info', 15)}<span>${t('rs.explain')}</span></p>
    ${rows.length ? `<div class="rn-bar"><b>${t('rs.count', { n: rows.length })}</b><span class="sp"></span><button type="button" class="link" data-act="rs-all" data-on="1">${t('rn.all')}</button><button type="button" class="link" data-act="rs-all" data-on="">${t('rn.none')}</button></div>
    <div class="rn-list">${groups.map(g => `<details ${groups.length <= 15 ? 'open' : ''}><summary>${esc(g.name)} <em class="cnt">${num(g.items.length)}</em></summary>
      ${g.items.map(i => { const r = rows[i]; return `<div class="rn-row rs-row" data-rs="${i}"><input type="checkbox" data-rs-on ${r.on ? 'checked' : ''} aria-label="${esc(r.name)}">
        <div class="rn-main"><s>${esc(r.name)}</s><input data-rs-name value="${esc(r.want)}" maxlength="200" autocomplete="off" aria-label="${t('u.fileName')}">
          <label class="rs-opt">${t('rs.what')}<select data-rs-back>${opt('', t('rs.nameOnly'), r.back ? '1' : '')}${opt('1', t('rs.nameFolder'), r.back ? '1' : '', r.from?.ok ? '' : 'disabled')}</select></label>
          ${r.from ? (r.from.ok ? `<small class="muted">${t('rs.prevFolder', { x: iso(r.from.name) })}</small>` : `<small class="fwarn">${t('rs.folderGone', { x: iso(r.from.name) })}</small>`) : ''}
        </div></div>`; }).join('')}</details>`).join('')}</div>` : `<p class="sh-text">${t('rs.nothing')}</p>`}`,
    foot: `<button type="button" class="btn danger-ghost" data-act="rs-undo">${icon('history', 17)}<span>${t('rs.undo')}</span></button><span class="sp"></span>
      <button type="button" class="btn ghost" data-act="close-sheet">${t('btn.back')}</button>${rows.length ? `<button type="button" class="btn primary" data-act="rs-apply" id="rsGo">${t('rs.apply', { n: rsCount() })}</button>` : ''}` });
  sheetClose = () => { RS = null; };
}
const rsBtn = () => { const b = $('#rsGo'); if (b && RS) { const n = rsCount(); b.textContent = t('rs.apply', { n }); b.disabled = !n; } };
async function restoreApply() {
  const rows = RS?.rows.filter(r => r.on && r.want.trim()) || [];
  if (!rows.length) return toast(t('rn.pick'), 'err');
  const keep = RS;
  if (!await confirmBox(t('rs.confirm', { n: rows.length }), t('rs.apply', { n: rows.length }), false)) { RS = keep; return drawRestore(); }
  RS = null;
  const batch = 'rs' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const queue = rows.map(r => ({ id: r.id, name: r.want.trim(), back: !!r.back }));
  const total = rows.length, byId = Object.fromEntries(rows.map(r => [r.id, r]));
  let ok = 0, moved = 0, same = 0, bad = 0, sent = 0, tries = 0, failed = null;
  const gone = [];
  sheet({ title: t('rs.title'), cls: 'small', body: `<p class="as-tip" id="rsProg"><span class="spin sm"></span>${t('rs.working', { a: 0, b: total })}</p><div class="prog rs-bar"><i id="rsBar" style="width:0%"></i></div>` });
  try {
    while (queue.length && tries++ < total + 20) {
      const chunk = queue.splice(0, 15);
      const r = await S.store.restoreNames(batch, chunk);
      for (const x of r.rows) {
        if (x.status === 'later') { queue.push(chunk.find(c => c.id === x.id)); continue; }
        sent++;
        if (x.status === 'ok') { ok++; if (x.moved) moved++; } else if (x.status === 'same') same++; else bad++;
        if (x.note === 'folder_gone') gone.push(x.name || byId[x.id]?.want);
      }
      const pg = $('#rsProg'); if (pg) pg.innerHTML = `<span class="spin sm"></span>${t('rs.working', { a: sent, b: total })}`;
      const bar = $('#rsBar'); if (bar) bar.style.width = Math.round(sent / total * 100) + '%';
    }
  } catch (e) { failed = e; }
  await reload().catch(() => { });
  sheet({ title: t('rs.title'), sub: t('rn.report'), cls: 'small', body: `<p class="sh-text">${t('rs.done', { n: ok })}</p>
    ${moved ? `<p class="sh-text">${t('rs.moved', { n: moved })}</p>` : ''}${same ? `<p class="sh-text">${t('rn.same', { n: same })}</p>` : ''}
    ${bad + queue.length ? `<p class="sh-text">${t('rn.err', { n: bad + queue.length })}</p>` : ''}
    ${gone.length ? `<p class="note warn">${icon('alert', 15)}<span>${t('rs.goneReport', { n: gone.length })}<br>${gone.map(n => `<bdi>${esc(n)}</bdi>`).join('<br>')}</span></p>` : ''}
    <p class="muted">${t('rs.safe')}</p>`,
    foot: `<button type="button" class="btn danger-ghost" data-act="rs-undo">${icon('history', 17)}<span>${t('rs.undo')}</span></button><span class="sp"></span><button class="btn primary" data-act="close-sheet">${t('btn.close')}</button>` });
  if (failed) throw failed;
}
async function restoreUndo() {
  const keep = RS;
  if (!await confirmBox(t('rs.undoQ'), t('rs.undo'), false)) { RS = keep; return keep ? drawRestore() : undefined; }
  RS = null;
  sheet({ title: t('rs.undo'), cls: 'small', body: `<p class="as-tip"><span class="spin sm"></span>${t('rs.undoing')}</p>` });
  let done = 0, skipped = 0, r, guard = 0;
  try {
    do { r = await S.store.restoreUndo(); done += r.done; skipped += r.skipped; } while (r.more && (r.done || r.skipped) && guard++ < 50);
  } finally {
    await reload().catch(() => { });
    sheet({ title: t('rs.undo'), sub: t('rn.report'), cls: 'small', body: `<p class="sh-text">${done || skipped ? t('rs.undone', { n: done }) : t('rn.undoNone')}</p>${skipped ? `<p class="sh-text">${t('rs.undoSkip', { n: skipped })}</p>` : ''}`,
      foot: `<span class="sp"></span><button class="btn primary" data-act="close-sheet">${t('btn.close')}</button>` });
  }
}

/* ---------- "Edit with AI" (editor, v4.3) ---------- */
/*
 * The AI reads one file (file window) or all files of a customer (case file) again. The app then works out the right
 * folder, vehicle, month and name (always the customer's real name, never the nickname) and, for policies, the
 * vehicle data. PREVIEW: before -> after for every file, everything editable, rows can be unticked; already correct =
 * "OK, no change"; low confidence or AI error = "please choose" (unchanged unless chosen). Back = nothing changes.
 * Only images and PDFs are read, two at a time, with a progress bar and Stop. Save sends small batches; "Undo AI edit"
 * puts back the exact previous state (last 5 batches).
 */
let AE = null;
const aeReadable = f => !f.invoice && (isImage(f) || isPdf(f));
const aeLoc = f => f.vslot ? `${esc(vehLabel(vehById(f.vehicleId)))} · ${slotName(f.vslot)}` : FOLDER[f.folder] ? iso(FOLDER[f.folder].th) : 'ไม่ระบุ · ' + t('fo.other');
/** the customer's vehicles + the new ones this edit would add */
function aeList() {
  const list = vehOf(AE.cid).map(v => ({ ...v }));
  for (const n of Object.values(AE.newVeh)) list.push({ ...n.data, id: 'N:' + n.key, ym: n.ym, isNew: true });
  return list;
}
const aeVeh = id => aeList().find(v => v.id === id) || null;
function aiEditStart(cid, ids) {
  if (!canEdit()) return toast(t('err.role'), 'err');
  if (!aiOn()) return toast(S.mode === 'local' ? t('ai.localOnly') : t('ai.off'), 'err');
  const files = S.files.filter(f => ids.includes(f.id) && f.customerId === cid);
  if (!files.length) return toast(t('ae.noFiles'), 'err');
  AE = { cid, rows: files.map(f => ({ f, ai: aeReadable(f) ? 'wait' : 'skip', st: f.invoice ? 'invoice' : aeReadable(f) ? 'wait' : 'skip', on: false, pick: { vkey: f.vehicleId || '', slot: f.vslot || '', name: f.name } })), newVeh: {}, vd: {}, stop: false };
  sheet({ title: t('ae.title'), sub: esc(cust(cid)?.name || ''), cls: 'xwide', body: `<div id="aeHead"></div><div id="aeNew"></div><div class="up-list" id="aeList"></div><div id="aeDiff"></div>`,
    foot: `<span class="sp"></span><button type="button" class="btn ghost" data-act="close-sheet">${t('btn.back')}</button><button type="button" class="btn primary" data-act="ae-save" id="aeGo"></button>` });
  sheetClose = () => { if (AE) AE.stop = true; AE = null; };
  drawAiEdit();
  aeQueue();
}
async function aeQueue() {
  const ae = AE;
  const worker = async () => {
    for (;;) {
      if (AE !== ae || ae.stop) return;
      const r = ae.rows.find(x => x.ai === 'wait');
      if (!r) return;
      r.ai = 'busy'; r.since = Date.now(); drawAiEdit();
      try {
        const blob = await S.store.getBlob(r.f.id);
        const file = new File([blob], r.f.name, { type: blob.type || r.f.mime || '' });
        r.n = normalize(await S.store.aiExtract(await prepare([file])));
        r.ai = 'done';
      } catch (e) { r.ai = 'err'; r.err = aiErr(e); }
      if (AE !== ae) return;
      aePlace(r);
      drawAiEdit();
    }
  };
  await Promise.all([worker(), worker()]);
  if (AE === ae && ae.stop) { for (const r of ae.rows) if (r.ai === 'wait') { r.ai = 'stopped'; r.st = 'skip'; } drawAiEdit(); }
}
/** The AI's suggestion for a row (low confidence / error -> "please choose", the row stays as it is) */
function aePlace(r) {
  if (r.ai !== 'done') { r.st = 'choose'; r.on = false; return; }
  const c = cust(AE.cid), s = aiEditSuggest(r.f, c, aeList(), r.n);
  r.sug = s;
  if (s.conf === 'low' || s.conf === 'none') { r.st = 'choose'; r.on = false; return; }
  let vkey = s.vid;
  if (s.add) {
    const key = AE.cid + '|' + plateKey(s.add.plate) + '|' + s.add.ym;
    if (!AE.newVeh[key]) { const data = {}; for (const k of VFIELDS) if (r.n.values[k]) data[k] = r.n.values[k]; data.plate = s.add.plate; AE.newVeh[key] = { key, ym: s.add.ym, ok: false, data }; }
    vkey = 'N:' + key;
  }
  r.pick = { vkey, slot: s.slot, name: s.name };
  aeStatus(r);
}
/** 'ok' when the file is already right, else 'change' (ticked) */
function aeStatus(r) {
  const p = r.pick, f = r.f;
  if (!p.vkey || !p.slot) { r.st = 'choose'; r.on = false; return; }
  const same = p.vkey === (f.vehicleId || '') && p.slot === (f.vslot || '') && p.name === f.name;
  r.st = same ? 'ok' : 'change';
  r.on = !same;
}
/** "old -> new" vehicle data from the policies the AI read (existing vehicle records only; the plate never changes) */
function aeDiff() {
  const best = {};
  for (const r of AE.rows) {
    if (!r.n || r.st === 'choose' || r.st === 'skip' || !['1', '2', '3'].includes(r.pick.slot)) continue;
    const v = S.vehicles.find(x => x.id === r.pick.vkey);
    if (!v) continue;
    for (const d of diff(v, r.n, 'policy')) {
      if (!VFIELDS.includes(d.key) || d.key === 'plate') continue;
      const k = v.id + '|' + d.key;
      if (!best[k] || d.conf > best[k].conf) best[k] = { ...d, k, label: vehLabel(v) };
    }
  }
  return Object.values(best).map(d => ({ ...d, on: AE.vd[d.k] ?? d.on }));
}
const aeChip = st => `<em class="conf ${{ ok: 'c-hi', change: 'c-mid', choose: 'c-lo', wait: '', skip: '', invoice: '' }[st] || ''}">${t('ae.st.' + st)}</em>`;
function drawAiEdit() {
  if (!AE || !$('#aeList')) return;
  const rows = AE.rows, read = rows.filter(r => !['wait', 'busy'].includes(r.ai)).length, total = rows.length;
  const busy = rows.some(r => r.ai === 'wait' || r.ai === 'busy');
  $('#aeHead').innerHTML = `<p class="note">${icon('wand', 15)}<span>${t('ae.explain')}</span></p>
    ${busy ? `<div class="ae-prog"><p class="as-tip"><span class="spin sm"></span>${t('ae.reading', { a: read, b: total })} <span class="slow-hint">${t('ai.slowHint')}</span></p>
      <div class="prog"><i style="width:${Math.round(read / total * 100)}%"></i></div><button type="button" class="btn ghost sm" data-act="ae-stop" ${AE.stop ? 'disabled' : ''}>${icon('x', 15)}<span>${t('ae.stop')}</span></button></div>` : ''}`;
  // new vehicles (renewal month / new plate): only made when ticked
  const used = new Set(rows.filter(r => r.on).map(r => r.pick.vkey));
  const nv = Object.values(AE.newVeh).filter(n => used.has('N:' + n.key));
  $('#aeNew').innerHTML = nv.length ? `<section class="su-new">${nv.map(n => `<div class="su-card ${n.ok ? 'ok' : ''}" data-aenv="${esc(n.key)}">
    <label class="su-ok"><input type="checkbox" data-aenv-ok ${n.ok ? 'checked' : ''}><b>${icon('car', 15)} ${t(vehOf(AE.cid).some(v => plateKey(v.plate) === plateKey(n.data.plate)) ? 'su.renew' : 'su.newVeh')}</b></label>
    <div class="su-f"><label>${t('cf.plate')}<input value="${esc(n.data.plate || '')}" readonly></label><label>${t('vh.monthFolder')}<input value="${esc(ymText(n.ym))}" readonly></label></div></div>`).join('')}</section>` : '';
  const list = aeList();
  $('#aeList').innerHTML = rows.map((r, i) => {
    const f = r.f, p = r.pick, v = aeVeh(p.vkey);
    const editable = r.st !== 'invoice' && r.st !== 'skip' && r.ai !== 'wait' && r.ai !== 'busy';
    const chgName = p.name !== f.name, chgLoc = p.vkey !== (f.vehicleId || '') || p.slot !== (f.vslot || '');
    return `<div class="up-row ae-row ${r.st}" data-aei="${i}" style="--i:${Math.min(i, 8)}">
      <label class="ae-on"><input type="checkbox" data-ae-on ${r.on ? 'checked' : ''} ${editable ? '' : 'disabled'} aria-label="${esc(f.name)}"></label>
      <div class="up-main">
        <div class="up-top"><small class="su-file">${ftBadge(f, 14, 'sm')} ${esc(f.name)}</small>${r.ai === 'wait' || r.ai === 'busy' ? '' : aeChip(r.st)}</div>
        ${r.ai === 'busy' ? `<p class="ai-line busy"><span class="spin sm"></span>${t('ai.reading')} <span class="elapsed" data-since="${r.since}"></span></p>` : ''}
        ${r.ai === 'err' ? `<p class="ai-line err">${icon('alert', 14)}${esc(r.err)} · ${t('ae.unchanged')}</p>` : ''}
        ${r.ai === 'skip' ? `<p class="hint">${t(f.invoice ? 'ae.invoice' : 'ae.notReadable')}</p>` : ''}${r.ai === 'stopped' ? `<p class="hint">${t('ae.stopped')}</p>` : ''}
        ${r.st === 'choose' && r.ai === 'done' ? `<p class="ai-line err">${icon('alert', 14)}${t('ae.lowConf')}</p>` : ''}
        ${editable ? `<div class="ae-ba">
          <div class="ae-b"><small>${t('ae.before')}</small><b>${esc(f.name)}</b><span>${aeLoc(f)}</span></div>
          <div class="ae-a"><small>${t('ae.after')}</small>
            <input data-ae="name" class="${chgName ? 'chg' : ''}" value="${esc(p.name)}" maxlength="200" aria-label="${t('u.fileName')}">
            <div class="su-grid ae-grid">
              <label>${t('vh.vehicle')}<select data-ae="vkey" class="${chgLoc && p.vkey !== (f.vehicleId || '') ? 'chg' : ''}">${opt('', t('su.choose'), p.vkey)}${list.map(x => opt(x.id, (x.isNew ? t('su.newVeh') + ': ' : '') + vehLabel(x), p.vkey)).join('')}</select></label>
              <label>${t('vh.month')}<input value="${v ? esc(ymText(v.ym)) : '—'}" readonly tabindex="-1"></label>
              <label>${t('fo.choose')}<select data-ae="slot" class="${p.slot !== (f.vslot || '') ? 'chg' : ''}">${opt('', t('su.choose'), p.slot)}${FILE_SLOTS.map(s => opt(s, VSLOT[s].th, p.slot)).join('')}</select></label>
            </div></div></div>` : ''}
      </div></div>`;
  }).join('');
  const d = aeDiff();
  $('#aeDiff').innerHTML = d.length ? `<section class="diff"><h3>${icon('car', 16)}${t('ae.vehData')}</h3><p class="muted">${t('su.diffSub')}</p>${diffRows(d, 'data-aevd')}</section>` : '';
  const go = $('#aeGo');
  if (go) { const n = rows.filter(r => r.on).length + d.filter(x => x.on).length; go.textContent = t('ae.save', { n }); go.disabled = !n || AE.busy; }
}
/** a choice in a row changed */
function aePick(r, k, val) {
  r.pick[k] = val;
  if (k === 'name') { r.nameEdited = true; return; }
  if (!r.nameEdited) { const v = aeVeh(r.pick.vkey); r.pick.name = v && r.pick.slot ? vehicleFileName({ vehicle: v, customer: cust(AE.cid), slot: r.pick.slot, ext: extOf(r.f.name) }) : r.f.name; }
  aeStatus(r);
  drawAiEdit();
}
async function aiEditSave(btn) {
  if (!AE || AE.busy) return;
  const ae = AE, c = cust(ae.cid);
  const rows = ae.rows.filter(r => r.on && r.pick.vkey && r.pick.slot);
  const vd = aeDiff().filter(x => x.on);
  if (!rows.length && !vd.length) return toast(t('ae.nothing'), 'err');
  const nv = [...new Set(rows.map(r => r.pick.vkey).filter(k => k.startsWith('N:')))].map(k => ae.newVeh[k.slice(2)]);
  if (nv.some(n => !n.ok)) { toast(t('su.confirmNew'), 'err'); $('#aeNew')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  ae.busy = true; ae.stop = true; drawAiEdit();
  const total = rows.length + (vd.length ? 1 : 0);
  sheet({ title: t('ae.title'), cls: 'small', body: `<p class="as-tip" id="aeProg"><span class="spin sm"></span>${t('ae.saving', { a: 0, b: total })}</p><div class="prog rs-bar"><i id="aeBar" style="width:0%"></i></div>` });
  sheetClose = null;
  const batch = 'ai' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  let ok = 0, same = 0, bad = 0, sent = 0, failed = null;
  const prog = () => { const p = $('#aeProg'); if (p) p.innerHTML = `<span class="spin sm"></span>${t('ae.saving', { a: sent, b: total })}`; const b = $('#aeBar'); if (b) b.style.width = Math.round(sent / Math.max(1, total) * 100) + '%'; };
  try {
    // 1) the vehicles this edit needs: a new month / new plate (ticked) or the old single plate becomes a record
    const real = {};
    for (const k of new Set(rows.map(r => r.pick.vkey))) {
      if (k.startsWith('N:')) { const n = ae.newVeh[k.slice(2)]; real[k] = (await S.store.saveVehicle({ customerId: c.id, ym: n.ym, ...n.data })).id; }
      else if (k.startsWith('L:')) real[k] = (await realVehicle(vehById(k), c.id)).id;
      else real[k] = k;
    }
    // 2) files (10 per request) and vehicle data (with the first request)
    const items = rows.map(r => {
      const moved = r.pick.vkey !== (r.f.vehicleId || '') || r.pick.slot !== (r.f.vslot || '');
      return { id: r.f.id, name: r.pick.name !== r.f.name ? r.pick.name.trim() : '', vehicleId: moved ? real[r.pick.vkey] : '', slot: moved ? r.pick.slot : '' };
    });
    const byV = {};
    for (const x of vd) { const [vid, key] = x.k.split('|'); (byV[vid] ||= {})[key] = x.new; }
    let vehicles = Object.entries(byV).map(([id, fields]) => ({ id, fields }));
    const queue = items.slice();
    let tries = 0;
    do {
      const chunk = queue.splice(0, 10);
      const res = await S.store.aiEditApply(batch, c.id, chunk, vehicles);
      if (vehicles.length) { sent++; if (res.vehicles.some(x => x.status === 'ok')) ok++; }
      vehicles = [];
      for (const x of res.rows) {
        if (x.status === 'later') { queue.push(chunk.find(y => y.id === x.id)); continue; }
        sent++;
        if (x.status === 'ok') ok++; else if (x.status === 'same') same++; else bad++;
      }
      prog();
    } while (queue.length && tries++ < items.length + 20);
  } catch (e) { failed = e; }
  AE = null;
  await reload().catch(() => { });
  sheet({ title: t('ae.title'), sub: t('rn.report'), cls: 'small', body: `<p class="sh-text">${t('ae.done', { n: ok })}</p>${same ? `<p class="sh-text">${t('rn.same', { n: same })}</p>` : ''}${bad ? `<p class="sh-text">${t('rn.err', { n: bad })}</p>` : ''}<p class="muted">${t('ae.safe')}</p>`,
    foot: `<button type="button" class="btn danger-ghost" data-act="ae-undo" data-b="${esc(batch)}">${icon('history', 17)}<span>${t('ae.undo')}</span></button><span class="sp"></span><button class="btn primary" data-act="close-sheet">${t('btn.close')}</button>` });
  if (failed) throw failed;
}
/** Undo an AI-edit batch (id = only that file) */
async function aiEditUndo(batch, id = '') {
  if (!batch) return;
  if (!await confirmBox(t(id ? 'ae.undoFileQ' : 'ae.undoQ'), t('ae.undo'), false)) return;
  sheet({ title: t('ae.undo'), cls: 'small', body: `<p class="as-tip"><span class="spin sm"></span>${t('rn.undoing')}</p>` });
  let done = 0, skipped = 0, r, guard = 0;
  try {
    do { r = await S.store.aiEditUndo(batch, id); done += r.done; skipped += r.skipped; } while (r.more && (r.done || r.skipped) && guard++ < 50);
  } finally {
    await reload().catch(() => { });
    sheet({ title: t('ae.undo'), sub: t('rn.report'), cls: 'small', body: `<p class="sh-text">${done || skipped ? t('ae.undone', { n: done }) : t('rn.undoNone')}</p>${skipped ? `<p class="sh-text">${t('ae.undoSkip', { n: skipped })}</p>` : ''}`,
      foot: `<span class="sp"></span><button class="btn primary" data-act="close-sheet">${t('btn.close')}</button>` });
  }
}
/** Settings (admin): the last 5 AI edits, each can be undone */
async function aiEditsSheet() {
  sheet({ title: t('ae.list'), cls: 'wide', body: `<p class="as-tip"><span class="spin sm"></span>${t('team.loading')}</p>` });
  const list = (await S.store.aiEditList()).slice().reverse();
  sheet({ title: t('ae.list'), sub: t('ae.listSub'), cls: 'wide', body: list.length ? `<div class="team-list">${list.map((x, i) => `<div class="team-row" style="--i:${i}"><span class="ava dv-ava">${icon('wand', 17)}</span>
    <span class="tmain"><b>${esc(x.cn || cust(x.c)?.name || '—')}</b><small>${when(x.at)} · ${t('ae.nFiles', { n: x.n })} · <bdi dir="ltr">${esc(x.by)}</bdi>${x.u ? ' · ' + t('ae.wasUndone') : ''}</small></span>
    ${x.u ? '' : `<button class="btn ghost sm" data-act="ae-undo" data-b="${esc(x.b)}">${icon('history', 15)}<span>${t('ae.undo')}</span></button>`}</div>`).join('')}</div>` : `<p class="sh-text">${t('ae.none')}</p>` });
}
/** The newest AI-edit batch of a customer's files (for "Undo AI edit" on the customer screen) */
const lastAib = cid => S.files.filter(f => f.customerId === cid && f.aib).map(f => f.aib).sort().pop() || '';

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
      ${signedIn ? card('lock', t('dv.title'), device.unlocked() ? t('dv.subOn') : t('dv.subOff'), `<span class="sp"></span>${!device.has() ? `<button class="btn primary" data-act="dv-set">${icon('lock', 17)}<span>${t('dv.setBtn')}</span></button>` : ''}<button class="btn ghost" data-act="devices">${icon('phone', 17)}<span>${t('dv.open')}</span></button>`) : ''}
      ${S.store ? card('invoice', t('co.title'), isAdmin() ? t('co.sub') : t('co.subRo'), `<span class="sp"></span><button class="btn ghost" data-act="company">${icon('edit', 17)}<span>${t('co.title')}</span></button>`) : ''}
      ${S.store && isAdmin() && (signedIn || !cloud) ? card('move', t('mv.title'), t('mv.sub'), `<span class="sp"></span><button class="btn ghost" data-act="move-tool">${icon('move', 17)}<span>${t('mv.open')}</span></button>`) : ''}
      ${S.store && isAdmin() && (signedIn || !cloud) ? card('wand', t('ae.list'), t('ae.listSub'), `<span class="sp"></span><button class="btn ghost" data-act="ae-list">${icon('history', 17)}<span>${t('rn.open')}</span></button>`) : ''}
      ${S.store && isAdmin() && (signedIn || !cloud) ? card('history', t('rs.title'), t('rs.sub'), `<span class="sp"></span><button class="btn ghost" data-act="restore">${icon('history', 17)}<span>${t('rn.open')}</span></button>`) : ''}
      ${S.store && isAdmin() && (signedIn || !cloud) ? card('edit', t('rn.title'), t('rn.sub'), `<span class="sp"></span><button class="btn ghost" data-act="rename">${icon('edit', 17)}<span>${t('rn.open')}</span></button>`) : ''}
      ${cloud ? `<div class="set-card"><div class="set-h">${icon('wand', 22)}<div><b>${t('ai.status')}</b><small>${S.store?.aiReady ? t('ai.on') : t('ai.off')}</small></div><span class="sp"></span><em class="st-badge ${S.store?.aiReady ? 'ok' : 'off'}">${S.store?.aiReady ? t('ai.ready') : t('ai.notSet')}</em></div></div>` : ''}
      <div class="set-card ${!cloud ? 'on' : ''}">
        <div class="set-h">${icon('folder', 22)}<div><b>${t('set.demo')}</b><small>${t('set.local.text')}</small></div></div>
        <div class="sh-actions">${!cloud ? `<button class="btn ghost" data-act="seed">${t('set.seed')}</button><button class="btn danger-ghost" data-act="wipe">${t('set.wipe')}</button>` : `<span class="sp"></span><button class="btn ghost" data-act="mode-local">${t('set.use')}</button>`}</div>
      </div>
      <p class="ver">${t('set.ver', { v: digits(APP_VERSION) })}</p>
    </div>` });
}

/* ---------- my devices (v3.3) ---------- */
const pad2 = n => String(n).padStart(2, '0');
const when = iso => { const d = new Date(iso); return isNaN(d) ? '' : `${fmtDay(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`)} ${digits(`${pad2(d.getHours())}:${pad2(d.getMinutes())}`)}`; };
function devicesSheet() {
  sheet({ title: t('dv.title'), sub: t('dv.sub'), cls: 'wide', body: `
    <div class="team-list" id="devMine"><p class="as-tip"><span class="spin sm"></span>${t('team.loading')}</p></div>
    ${isAdmin() ? `<h3 class="dv-h">${t('dv.all')}</h3><div class="team-list" id="devAll"><p class="as-tip"><span class="spin sm"></span>${t('team.loading')}</p></div>` : ''}` });
  run(async () => drawDevices('#devMine', await S.store.listMySessions(), false));
  if (isAdmin()) run(async () => drawDevices('#devAll', await S.store.listAllSessions(), true));
}
function drawDevices(sel, list, all) {
  const el = $(sel); if (!el) return;
  el.innerHTML = list.length ? list.map((d, i) => `
    <div class="team-row" style="--i:${Math.min(i, 10)}">
      <span class="ava dv-ava">${icon('phone', 17)}</span>
      <span class="tmain"><b>${esc(d.name)}</b><small>${all ? `<bdi dir="ltr">${esc(d.email)}</bdi> · ` : ''}${t('dv.last', { x: when(d.lastUsed) })} · ${t('dv.exp', { x: fmtDay(d.expires) })}</small></span>
      ${d.current ? `<em class="role-chip">${t('dv.this')}</em>` : ''}
      <button class="icon-btn sm danger" data-act="dv-revoke" data-sid="${esc(d.sid)}" data-name="${esc(d.name)}" ${all ? 'data-all="1"' : ''} title="${t('dv.signout')}" aria-label="${t('dv.signout')}">${icon('logout', 15)}</button>
    </div>`).join('') : `<p class="as-tip">${t('dv.none')}</p>`;
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
/** Upload into the open vehicle / folder of the case file, if one is open */
const uploadSpot = cid => {
  const v = S.view === 'dash' && S.sel === cid ? vehById(S.openVeh) : null;
  return { cid, vid: v ? v.id : '', slot: v && FILE_SLOTS.includes(S.openSlot) ? S.openSlot : '' };
};

/* ================= compulsory motor insurance ================= */
let P = null, PR = null;
function resetPrb() {
  P = { store: null, data: null, loading: false, error: false, insured: '', q: '', status: '', selected: new Set() };
  PR = null;
}
resetPrb();
async function loadPrb() {
  const state = P, store = S.store;
  if (!store) return;
  if (state.loading) return state.pending;
  state.loading = true; state.error = false;
  state.pending = (async () => {
    try {
      const data = await store.prbList();
      if (state !== P || store !== S.store) return;
      state.data = data; state.store = store;
      if (!data.insured.some(i => i.id === state.insured)) state.insured = data.insured[0]?.id || '';
      state.selected = new Set([...state.selected].filter(id => data.rows.some(r => r.id === id && r.insuredId === state.insured)));
    } catch (e) { if (state === P) { state.error = true; handleError(e); } }
    finally { state.loading = false; if (state === P && S.view === 'prb' && !S.gate) drawPrb(); }
  })();
  return state.pending;
}
const prbButton = (act, label, id = '', cls = 'ghost') => `<button type="button" class="btn ${cls}" data-act="${act}" data-id="${esc(id)}">${esc(t(label))}</button>`;
function prbRows() {
  return sortRows((P.data?.rows || []).filter(r => r.insuredId === P.insured && (!P.status || prbStatus(r) === P.status) &&
    (!P.q || norm([r.name, ...PRB_FIELDS.map(k => r[k])].join(' ')).includes(norm(P.q)))));
}
function prbTable(rows, selectable = false) {
  const totals = prbTotals(rows), cols = ['prbNo', 'plate', 'model', 'vin', 'start', 'end', 'netPremium', 'stamps', 'vat', 'total'];
  return `<div class="prb-wrap" tabindex="0" role="region" aria-label="${esc(t('prb.records'))}"><table class="prb-table"><thead><tr>${selectable ? `<th><input type="checkbox" data-prb-all aria-label="${esc(t('prb.selectAll'))}" ${rows.length && rows.every(r => P.selected.has(r.id)) ? 'checked' : ''} ${rows.length ? '' : 'disabled'}></th>` : ''}${cols.map(k => `<th scope="col">${esc(t('prb.' + k))}</th>`).join('')}<th scope="col">${t('prb.status')}</th></tr></thead><tbody>${rows.map((r, i) => `<tr>${selectable ? `<td><input type="checkbox" data-prb-select="${esc(r.id)}" aria-label="${esc(t('prb.select') + ' ' + (r.prbNo || r.plate || r.name))}" ${P.selected.has(r.id) ? 'checked' : ''}></td>` : ''}<td>${r.id ? `<button class="link prb-open" data-act="prb-open" data-id="${esc(r.id)}">${esc(r.prbNo || '—')}</button>` : esc(r.prbNo || '—')}</td><td>${esc(r.plate || '—')}</td><td>${esc(r.model || r.brand || '—')}</td><td><bdi dir="ltr">${esc(r.vin || '—')}</bdi></td><td>${esc(fmtDay(r.start))}</td><td>${esc(fmtDay(r.end))}</td>${['net', 'stamps', 'vat', 'total'].map(k => `<td class="r">${baht(totals.lines[i][k])}</td>`).join('')}<td>${stPill(prbStatus(r))}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="${selectable ? 7 : 6}">${t('prb.total')} (${num(rows.length)})</td>${['net', 'stamps', 'vat', 'total'].map(k => `<td class="r">${baht(totals[k])}</td>`).join('')}<td></td></tr></tfoot></table></div>`;
}
function drawPrb() {
  const el = $('#prbView'); if (!el) return;
  if (P.store && P.store !== S.store) resetPrb();
  if (!P.data) {
    el.innerHTML = `<div class="set-card">${P.error ? `${t('prb.loadError')} ${prbButton('prb-refresh', 'prb.retry')}` : `<span class="spin sm"></span> ${t('team.loading')}`}</div>`;
    if (!P.loading && !P.error) loadPrb();
    return;
  }
  const d = P.data, ins = d.insured.find(i => i.id === P.insured), rows = prbRows();
  const insRows = d.rows.filter(r => r.insuredId === P.insured), invoices = d.invoices.filter(i => i.insuredId === P.insured);
  const trashIns = ins && canEdit() && !insRows.length && !invoices.length ? prbButton('prb-trash-insured', 'prb.trashInsured', ins.id, 'danger-ghost sm') : '';
  const rstSeq = isAdmin() && !d.invoices.length ? prbButton('prb-seq-reset', 'prb.seqReset') : '';
  el.innerHTML = `<div class="prb-layout"><aside class="panel prb-insured"><h2>${t('prb.insured')}</h2>${d.insured.map(i => `<button class="prb-ins ${P.insured === i.id ? 'on' : ''}" data-act="prb-insured" data-id="${esc(i.id)}" aria-pressed="${P.insured === i.id}"><span>${esc(i.name)}</span><small>${num(d.rows.filter(r => r.insuredId === i.id).length)}</small></button>`).join('') || `<p>${t('prb.empty')}</p>`}</aside><section class="prb-detail"><div class="prb-toolbar"><div><h2>${esc(ins?.name || t('prb.title'))}</h2><p>${esc([ins?.taxId, ins?.address].filter(Boolean).join(' · '))}</p></div>${trashIns}${prbButton('prb-refresh', 'prb.refresh')}</div><div class="prb-toolbar"><label class="f grow"><span class="sr-only">${t('prb.search')}</span><input type="search" id="prbSearch" value="${esc(P.q)}" placeholder="${esc(t('prb.search'))}"></label><label class="f"><span class="sr-only">${t('prb.status')}</span><select id="prbStatus"><option value="">${t('f.allStatus')}</option>${['active', 'soon', 'expired', 'none'].map(st => `<option value="${st}" ${P.status === st ? 'selected' : ''}>${t('st.' + st)}</option>`).join('')}</select></label></div><div id="prbRows">${prbTable(rows, canEdit())}</div><div class="prb-toolbar" id="prbSelection">${prbSelection()}</div>${!rows.length ? `<p class="set-card">${t(d.rows.length ? 'prb.noMatch' : 'prb.empty')}</p>` : ''}<h3>${t('nav.invoices')}</h3><div class="prb-invoices">${invoices.map(i => `<button class="btn ghost" data-act="prb-invoice-open" data-id="${esc(i.id)}">${esc(i.no)} · ${baht(i.t?.total || 0)}</button>`).join('') || `<p>${t('prb.noInvoices')}</p>`}${rstSeq}</div></section></div>`;
}
function prbSelection() {
  return canEdit() ? `<span>${t('prb.selected', { n: P.selected.size })}</span><button class="btn primary" data-act="prb-invoice" ${P.selected.size ? '' : 'disabled'}>${t('inv.create')}</button>${prbButton('prb-clear', 'f.clear')}` : '';
}
async function prbPick(camera) {
  if (!canEdit() || !S.store) return;
  const files = await pickFiles({ capture: camera, accept: DOC_ACCEPT, multiple: !camera });
  if (files.length) await prbStart(files.map(file => ({ file })));
}
async function prbStart(items) {
  if (!canEdit() || !S.store || !items.length) return;
  if (!P.data) await loadPrb();
  if (!P.data) return;
  PR = { items, index: 0, store: S.store, busy: false, batch: items.length > 1 && !items.some(x => x.existing) };
  if (!PR.batch) return prbReview();
  // v4.5.1: one table for many files. Every file is read by the AI on its own (prepare([file]) per file).
  for (const it of items) {
    it.insured ||= { name: '', taxId: '', address: '' }; it.row ||= {};
    it.ai = it.n || Object.values(it.row).some(Boolean) ? 'done' : aiOn() ? 'wait' : 'skip';
    it.state = ''; it.err = ''; it.skip = false;
  }
  prbAutoFix(PR);
  prbBatch();
  prbAiQueue(PR);
}
/** v4.5.2: code corrections after the AI (e.g. กซ -> กธ on Viriyah); the old value is kept to show "auto-corrected" */
function prbAutoFix(session) {
  const res = prbPost(session.items.map(x => x.state === 'saved' ? { row: {}, insured: {} } : x));
  session.items.forEach((it, i) => { if (res[i].auto.policyNo && !it.auto?.policyNo) it.auto = { ...it.auto, policyNo: res[i].auto.policyNo }; });
}
function prbCurrent() { return PR?.items[PR.index]; }
const PRB_DATES = new Set(['contractDate', 'issueDate', 'start', 'end']);
const PRB_MONEY = new Set(['netPremium', 'discount', 'stamps', 'vat', 'total']);
function prbReview() {
  const it = prbCurrent(); if (!it) { PR = null; closeSheet(); drawPrb(); return; }
  it.insured ||= { name: '', taxId: '', address: '' };
  it.row ||= {};
  const source = it.file || it.source;
  sheet({ title: t('prb.review'), sub: `${PR.index + 1} / ${PR.items.length} · ${esc(source?.name || it.existing?.name || '')}`, cls: 'xwide',
    body: `<form id="prbForm" class="form" data-form="prb"><div class="prb-toolbar">${!it.existing && aiOn() ? prbButton('prb-ai', 'prb.readAi') : ''}${!it.existing ? `<p>${t('prb.reviewHint')}</p>` : ''}${source || it.existing ? prbButton('prb-source', 'prb.preview') : ''}</div><p id="prbMessage" role="status">${esc(it.message || '')}</p><div class="prb-form">${['name', 'taxId', 'address'].map(k => `<label class="field"><span>${t('prb.ins.' + k)}</span><input name="ins_${k}" value="${esc(it.insured[k] || '')}" ${k === 'name' ? 'required' : ''} ${it.existing ? 'readonly' : ''}></label>`).join('')}${PRB_FIELDS.map(k => `<label class="field"><span>${t('prb.' + k)}</span><input name="${k}" value="${esc(it.row[k] ?? '')}" ${PRB_DATES.has(k) ? `placeholder="${esc(t('prb.dateHint'))}"` : ''} ${PRB_MONEY.has(k) ? 'inputmode="decimal"' : ['prbNo', 'barcode'].includes(k) ? 'inputmode="numeric"' : ''}></label>`).join('')}</div><div id="prbSuggest"></div><p id="prbWarning" class="prb-warn" hidden></p><p id="prbFilename" class="prb-filename"></p><div id="prbPreview"></div></form>`,
    foot: PR.batch ? `${prbButton('prb-prev', 'prb.prev')}${prbButton('prb-next', 'prb.next')}<span class="sp"></span>${prbButton('prb-table', 'prb.backTable', '', 'primary')}`
      : `${prbButton('prb-skip', PR.items.length > 1 ? 'prb.skip' : 'btn.cancel')}<span class="sp"></span><button class="btn primary" type="submit" form="prbForm">${t('btn.save')}</button>` });
  sheetClose = () => { PR = null; };
  prbReviewHint();
}
/** Errors (block saving) and warnings (red, do not block) of one review item; the other items of the batch count for duplicates */
function prbChecks(it, i = PR?.items.indexOf(it)) {
  const batch = PR?.batch ? PR.items.map(x => x.skip || x.state === 'saved' ? {} : x) : [];
  return prbSanity(it.row, { insuredName: it.insured.name, rows: P.data?.rows || [], batch, selfIndex: i, exceptId: it.existing?.id });
}
const prbChkText = c => t(c.key, c.key === 'prb.chk.vat' ? { v: baht(c.x?.v || 0), t: baht(c.x?.t || 0) } : { x: c.x && typeof c.x === 'object' ? '' : String(c.x ?? '') });
/** "use existing: ..." buttons for an insured name (fuzzy: spaces, company words, brackets and "/" ignored) */
function prbSuggestHtml(it, i) {
  const s = suggestInsured(it.insured.name, P.data?.insured || []).filter(x => x.name !== it.insured.name).slice(0, 3);
  return s.map(x => `<button type="button" class="link prb-sug" data-act="prb-use-name" data-i="${i}" data-name="${esc(x.name)}">${esc(t('prb.useExisting', { x: x.name }))}</button>`).join('');
}
function prbReadForm() {
  const it = prbCurrent(), form = $('#prbForm'); if (!it || !form) return;
  const fields = new FormData(form);
  for (const k of ['name', 'taxId', 'address']) it.insured[k] = String(fields.get('ins_' + k) || '').trim();
  for (const k of PRB_FIELDS) it.row[k] = String(fields.get(k) || '').trim();
  return it;
}
function prbReviewHint() {
  const it = prbReadForm(); if (!it) return;
  const warning = $('#prbWarning'), chk = prbChecks(it), all = [...chk.errors, ...chk.warns];
  warning.hidden = !all.length;
  warning.textContent = all.map(prbChkText).join(' · ');
  const sug = $('#prbSuggest'), idx = PR.items.indexOf(it);
  if (sug && !it.existing) {
    const sp = suggestPolicyNo(it.row, PR.items.filter(x => x !== it).map(x => x.row), { branchCode: it.n?.prb?.branchCode });
    const mn = consensusName(PR.items.map(x => x.insured?.name || ''), idx, (P.data?.insured || []).map(x => x.name));
    sug.innerHTML = prbSuggestHtml(it, idx)
      + (sp ? `<button type="button" class="link prb-sug" data-act="prb-accept" data-i="${idx}" data-k="policyNo" data-v="${esc(sp.value)}">${esc(t('prb.sugPolicy', { x: sp.value }))}</button>` : '')
      + (mn ? `<button type="button" class="link prb-sug" data-act="prb-use-name" data-i="${idx}" data-name="${esc(mn)}">${esc(t('prb.sugName', { x: mn }))}</button>` : '');
  }
  $('#prbFilename').textContent = it.existing?.name || prbFileName(it.row, it.insured.name, extOf((it.file || it.source)?.name || 'document.pdf'));
}
function prbBusy(on) {
  if (PR) PR.busy = on;
  for (const el of $$('#sheet-root button, #prbForm input')) el.disabled = on;
}
async function prbReadAi() {
  const session = PR, it = prbReadForm(); if (!it || session.busy || !aiOn()) return;
  prbBusy(true); $('#prbMessage').textContent = t('team.loading');
  try {
    const blob = it.file || await session.store.getBlob(it.source.id);
    const file = it.file || new File([blob], it.source.name, { type: it.source.mime || blob.type });
    const n = normalize(await session.store.aiExtract(await prepare([file])));
    if (PR !== session || S.store !== session.store) return;
    const mapped = rowFromAi(n);
    for (const [k, v] of Object.entries(mapped.insured)) if (v) it.insured[k] = v;
    for (const [k, v] of Object.entries(mapped.row)) if (v) it.row[k] = v;
    it.n = n;
    const fx = prbPost([it])[0]; if (fx.auto.policyNo) it.auto = { ...it.auto, policyNo: fx.auto.policyNo };
    it.message = t(isPrbDoc(n) ? 'prb.aiReview' : 'prb.notPrb');
  } catch (e) { if (PR === session) it.message = t('prb.aiFailed'); handleError(e); }
  finally { if (PR === session) { session.busy = false; prbReview(); } }
}
function prbValidate(it) {
  if (!it.insured.name.trim()) throw new Error(t('prb.needName'));
  for (const k of PRB_DATES) if (it.row[k]) {
    const value = parseDate(it.row[k]); if (!value) throw new Error(t('prb.badField', { x: t('prb.' + k) }));
    it.row[k] = value;
  }
  if (it.row.start && it.row.end && it.row.end <= it.row.start) throw new Error(t('prb.badPeriod'));
  for (const k of PRB_MONEY) if (it.row[k]) {
    const value = money(it.row[k]);
    if (value == null || !Number.isFinite(value) || value < 0) throw new Error(t('prb.badField', { x: t('prb.' + k) }));
    it.row[k] = String(value);
  }
  for (const k of ['prbNo', 'barcode']) if (it.row[k]) {
    const value = latinDigits(it.row[k]).replace(/\s/g, '');
    if (!/^\d+$/.test(value)) throw new Error(t('prb.badField', { x: t('prb.' + k) }));
    it.row[k] = value;
  }
  const dup = findDup(it.row, P.data.rows, it.existing?.id);
  if (dup) throw new Error(t('prb.duplicate', { x: dup.name }));
}
async function prbSave() {
  const session = PR, it = prbReadForm();
  if (!it || session.busy || !canEdit() || session.store !== S.store) return;
  if (session.batch) return;   // in a batch the table's "Save all" saves
  const c = prbChecks(it); if (c.errors.length) throw new Error(prbChkText(c.errors[0]));
  prbBusy(true);
  try {
    const result = await prbSaveOne(it, session);
    if (session.store !== S.store) return;
    // Advance before refreshing: a failed refresh must never upload the same file twice.
    session.index++; P.insured = result.row.insuredId; P.selected.clear();
    await loadPrb();
    toast(t('t.saved')); if (PR === session) prbReview();
  } finally { if (PR === session) prbBusy(false); }
}
/* ---------- v4.5.1: many files in one review table ---------- */
const PRB_COLS = ['prbNo', 'policyNo', 'receiptNo', 'barcode', 'plate', 'province', 'model', 'body', 'vin', 'engineNo', 'cc', 'seats', 'weight', 'start', 'end', 'netPremium', 'stamps', 'vat', 'total'];
function prbBatch() {
  const ok = PR.items.filter(x => x.state === 'saved').length, bad = PR.items.filter(x => x.state === 'failed').length;
  sheet({ title: t('prb.review'), sub: `${num(PR.items.length)} · ${esc(t('prb.batchHint'))}`, cls: 'xwide',
    body: `<datalist id="prbInsList">${(P.data?.insured || []).map(x => `<option value="${esc(x.name)}">`).join('')}</datalist>
      <div id="prbGroups"></div>
      <div class="prb-wrap prb-batch"><table class="prb-table"><thead><tr><th>#</th><th>${t('prb.skipRow')}</th><th>${t('prb.file')}</th><th>${t('prb.ins.name')}</th>${PRB_COLS.map(k => `<th>${esc(t('prb.' + k))}</th>`).join('')}<th>${t('prb.status')}</th><th></th></tr></thead>
      <tbody>${PR.items.map((it, i) => prbBatchRow(it, i)).join('')}</tbody></table></div>
      <p id="prbBatchSum" class="sh-text">${ok || bad ? esc(t('prb.saveSummary', { ok, bad })) : ''}</p>`,
    foot: `<button class="btn ghost" data-act="close-sheet">${t('btn.close')}</button><span class="sp"></span><button class="btn primary" data-act="prb-save-all" ${PR.busy ? 'disabled' : ''}>${t('prb.saveAll')}</button>` });
  sheetClose = () => { PR = null; };
  prbBatchChecks();
}
function prbBatchRow(it, i) {
  const ro = it.state === 'saved' || it.ai === 'busy' || it.ai === 'wait' ? 'readonly' : '';
  const cell = k => `<td><input class="prb-cell${it.auto?.[k] && it.auto[k] !== it.row[k] ? ' prb-auto' : ''}" ${it.auto?.[k] && it.auto[k] !== it.row[k] ? `title="${esc(t('prb.autoFixed', { x: it.auto[k] }))}"` : ''} data-pi="${i}" data-pk="${k}" value="${esc(it.row[k] ?? '')}" ${PRB_DATES.has(k) ? 'type="date"' : PRB_MONEY.has(k) ? 'inputmode="decimal"' : ['prbNo', 'barcode', 'receiptNo'].includes(k) ? 'inputmode="numeric"' : ''} ${['plate', 'vin', 'engineNo', 'prbNo', 'barcode', 'policyNo', 'receiptNo'].includes(k) ? 'dir="ltr"' : ''} ${ro} aria-label="${esc(t('prb.' + k))}"></td>`;
  const aiTxt = it.ai === 'busy' || it.ai === 'wait' ? `<span class="spin sm"></span> ${t('prb.reading')}` : it.ai === 'err' ? esc(t('prb.aiFailed')) : '';
  return `<tr data-row="${i}" class="${it.state ? 'st-' + it.state : ''} ${it.skip ? 'skip' : ''}">
    <td>${i + 1}</td><td><input type="checkbox" data-pskip="${i}" ${it.skip ? 'checked' : ''} ${it.state === 'saved' ? 'disabled' : ''} aria-label="${esc(t('prb.skipRow'))}"></td>
    <td class="prb-fname"><small>${esc((it.file || it.source)?.name || '')}</small><small class="prb-ai">${aiTxt}</small></td>
    <td><input class="prb-cell wide" list="prbInsList" data-pi="${i}" data-pk="ins_name" value="${esc(it.insured.name || '')}" ${ro} aria-label="${esc(t('prb.ins.name'))}"><span class="prb-sugs" data-sug="${i}"></span></td>
    ${PRB_COLS.map(cell).join('')}
    <td class="prb-chk" data-chk="${i}"></td>
    <td><button type="button" class="btn ghost sm" data-act="prb-more" data-i="${i}">${t('prb.more')}</button></td></tr>`;
}
/** Re-checks every row (duplicates and plate/chassis depend on the other rows) without redrawing the inputs, so focus stays */
function prbBatchChecks() {
  if (!PR?.batch) return;
  PR.items.forEach((it, i) => {
    const el = $(`[data-chk="${i}"]`), sg = $(`[data-sug="${i}"]`); if (!el) return;
    if (it.state === 'saved') { el.innerHTML = `<span class="prb-st ok">✓ ${esc(t('prb.savedRow'))}</span>`; if (sg) sg.innerHTML = ''; return; }
    const c = it.skip ? { errors: [], warns: [] } : prbChecks(it, i);
    el.innerHTML = (it.state === 'failed' ? `<div class="prb-bad">${esc(t('prb.failedRow', { x: it.err }))}</div>` : '')
      + c.errors.map(x => `<div class="prb-bad">✕ ${esc(prbChkText(x))}</div>`).join('')
      + c.warns.map(x => `<div class="prb-bad warn">! ${esc(prbChkText(x))}</div>`).join('')
      + (!c.errors.length && !c.warns.length && it.state !== 'failed' && it.ai !== 'busy' && it.ai !== 'wait' ? '<span class="prb-st ok">OK</span>' : '');
    // v4.5.2: one-click suggestions: full policy number from the batch consensus, majority spelling of the insured
    const others = PR.items.filter((x, j) => j !== i && !x.skip).map(x => x.row);
    const sp = suggestPolicyNo(it.row, others, { branchCode: it.n?.prb?.branchCode }), mn = consensusName(PR.items.map(x => x.skip ? '' : x.insured.name), i, (P.data?.insured || []).map(x => x.name));
    el.innerHTML += (it.auto?.policyNo && it.auto.policyNo !== it.row.policyNo ? `<div class="prb-autonote">${esc(t('prb.autoFixed', { x: it.auto.policyNo }))}</div>` : '')
      + (sp ? `<button type="button" class="link prb-sug" data-act="prb-accept" data-i="${i}" data-k="policyNo" data-v="${esc(sp.value)}">${esc(t('prb.sugPolicy', { x: sp.value }))}</button>` : '')
      + (mn ? `<button type="button" class="link prb-sug" data-act="prb-use-name" data-i="${i}" data-name="${esc(mn)}">${esc(t('prb.sugName', { x: mn }))}</button>` : '');
    $(`[data-pi="${i}"][data-pk="ins_name"]`)?.classList.toggle('prb-diff', !!mn);
    if (sg) sg.innerHTML = prbSuggestHtml(it, i);
  });
  // rows of this batch that look like the same insured but are spelled differently: pick one spelling for all of them
  const live = PR.items.map((x, i) => ({ x, i })).filter(o => !o.x.skip && o.x.state !== 'saved' && o.x.insured.name);
  const groups = groupInsured(live.map(o => o.x.insured.name)).map(g => g.map(j => live[j].i));
  const gEl = $('#prbGroups');
  if (gEl) gEl.innerHTML = groups.map(g => {
    const names = spellingChoices(g.map(i => PR.items[i].insured.name), suggestInsured(PR.items[g[0]].insured.name, P.data?.insured || []).map(x => x.name));
    return `<div class="prb-warn prb-group"><b>${esc(t('prb.sameInsured', { x: g.map(i => '#' + (i + 1)).join(', ') }))}</b> ${esc(t('prb.pickSpelling'))}
      ${names.map(n => `<button type="button" class="btn ghost sm" data-act="prb-spell" data-g="${g.join(',')}" data-name="${esc(n)}">${esc(n)}</button>`).join('')}</div>`;
  }).join('');
}
function prbBatchRedrawRow(i) {
  const tr = $(`tr[data-row="${i}"]`); if (!tr || !PR) return;
  tr.outerHTML = prbBatchRow(PR.items[i], i);
  prbBatchChecks();
}
/** The AI reads the files two at a time, each file on its own; a failed read leaves the row editable */
async function prbAiQueue(session) {
  const worker = async () => {
    for (;;) {
      if (PR !== session) return;
      const it = session.items.find(x => x.ai === 'wait'); if (!it) return;
      it.ai = 'busy'; const i = session.items.indexOf(it);
      if (!session.cardOpen) prbBatchRedrawRow(i);
      try {
        const blob = it.file || await session.store.getBlob(it.source.id);
        const file = it.file || new File([blob], it.source.name, { type: it.source.mime || blob.type });
        const n = normalize(await session.store.aiExtract(await prepare([file])));
        if (PR !== session) return;
        const m = rowFromAi(n);   // a new object for this file only; values typed meanwhile are kept
        for (const [k, v] of Object.entries(m.insured)) if (v && !it.insured[k]) it.insured[k] = v;
        for (const [k, v] of Object.entries(m.row)) if (v && !it.row[k]) it.row[k] = v;
        it.n = n; it.ai = 'done';
        prbAutoFix(session);
      } catch (e) { it.ai = 'err'; }
      if (PR === session && !session.cardOpen) prbBatchRedrawRow(i);
    }
  };
  await Promise.all([worker(), worker()]);
}
/** Saves one item (upload, import copy or update of an existing row). Throws with the reason. */
async function prbSaveOne(it, session) {
  prbValidate(it);
  const source = it.file || it.source;
  if (it.file && it.file.size > MAX_UPLOAD_MB * 1048576) throw new Error(t('err.tooBig'));
  const name = source && prbFileName(it.row, it.insured.name, extOf(source.name));
  let result;
  if (it.existing) result = { row: await session.store.prbUpdate(it.existing.id, it.row) };
  else if (it.source) {
    if (!isAdmin()) throw new Error(t('err.role'));
    const imported = await session.store.prbImport([{ id: it.source.id, insured: it.insured, row: it.row, name }]);
    if (!imported.done.length) throw new Error(t('prb.importSkipped', { x: imported.skipped[0]?.why || '' }));
    result = imported.done[0];
  } else {
    // photos compressed like normal uploads; a PDF without a browser type is still sent as a PDF
    const blob = compressible(it.file) ? await compressImage(it.file) : it.file;
    const mime = blob.type || (/\.pdf$/i.test(it.file.name) ? 'application/pdf' : '');
    result = await session.store.prbUpload(blob, it.insured, it.row, { name: saveName(name, it.file, blob), orig: it.file.name, mime });
  }
  const previous = P.data.rows.findIndex(r => r.id === result.row.id);
  if (previous >= 0) P.data.rows[previous] = result.row; else P.data.rows.push(result.row);
  if (!P.data.insured.some(i => i.id === result.row.insuredId)) P.data.insured.push(result.insured || { ...it.insured, id: result.row.insuredId });
  return result;
}
/** "Save all": only rows without errors, one by one; one failure never stops the others; saved rows are never sent again */
async function prbSaveAll() {
  const session = PR; if (!session?.batch || session.busy || !canEdit()) return;
  if (session.items.some(x => x.ai === 'busy' || x.ai === 'wait')) return toast(t('ai.reading'));
  session.busy = true; $('[data-act="prb-save-all"]')?.setAttribute('disabled', '');
  let ok = 0, bad = 0, last = '';
  for (const [i, it] of session.items.entries()) {
    if (PR !== session) return;
    if (it.skip || it.state === 'saved') continue;
    const c = prbChecks(it, i);
    if (c.errors.length) { it.state = 'failed'; it.err = prbChkText(c.errors[0]); bad++; prbBatchRedrawRow(i); continue; }
    try { const r = await prbSaveOne(it, session); it.state = 'saved'; it.err = ''; ok++; last = r.row.insuredId; }
    catch (e) { it.state = 'failed'; it.err = e?.message || String(e); bad++; }
    if (PR === session) prbBatchRedrawRow(i);
  }
  session.busy = false;
  if (last) { P.insured = last; P.selected.clear(); }
  await loadPrb();
  if (PR !== session) return;
  toast(t('prb.saveSummary', { ok, bad }), bad ? 'err' : '');
  if (!bad && session.items.every(x => x.skip || x.state === 'saved')) { PR = null; closeSheet(); drawPrb(); return; }
  prbBatch();
}
async function prbPreviewSource() {
  const session = PR, it = prbReadForm(); if (!it) return;
  const blob = it.file || (it.source ? await session.store.getBlob(it.source.id) : await session.store.prbGetBlob(it.existing.id));
  if (PR !== session || !$('#prbPreview')) return;
  prbPreviewHtml(blob, $('#prbPreview'));
}
function prbPreviewHtml(blob, el) {
  if (!blob) { el.textContent = t('fl.noContent'); return; }
  const url = objUrl(blob);
  el.innerHTML = blob.type === 'application/pdf' ? `<iframe class="prb-preview" title="${esc(t('prb.preview'))}" src="${url}"></iframe>` : /^image\/(png|jpeg|webp|gif|avif|bmp)$/.test(blob.type) ? `<img class="prb-preview" alt="${esc(t('prb.preview'))}" src="${url}">` : `<p>${t('fl.noPreview')}</p>`;
}
async function prbOpen(id) {
  const row = P.data.rows.find(r => r.id === id); if (!row) return;
  const ins = P.data.insured.find(i => i.id === row.insuredId);
  sheet({ title: esc(row.name), sub: esc(ins?.name || ''), cls: 'xwide', body: `${prbTable([row])}<dl class="prb-facts">${PRB_FIELDS.filter(k => row[k]).map(k => `<div><dt>${t('prb.' + k)}</dt><dd>${esc(PRB_DATES.has(k) ? fmtDay(row[k]) : row[k])}</dd></div>`).join('')}</dl><div id="prbFilePreview"><span class="spin sm"></span></div>`, foot: `${prbButton('prb-download', 'fl.download', id)}${prbButton('prb-send', 'fl.share', id)}${canEdit() ? `${prbButton('prb-edit', 'prb.edit', id)}${S.mode === 'cloud' ? prbButton(row.shared ? 'prb-unshare' : 'prb-share', row.shared ? 'prb.unshare' : 'prb.share', id) : ''}${prbButton('prb-delete', 'btn.delete', id, 'danger')}` : ''}` });
  const target = $('#prbFilePreview'), store = S.store;
  const blob = await store.prbGetBlob(id);
  if (target.isConnected && store === S.store) prbPreviewHtml(blob, target);
}
async function prbImportSheet() {
  if (!isAdmin()) return toast(t('err.role'), 'err');
  const store = S.store;
  sheet({ title: t('prb.import'), body: `<p id="prbImportLoading">${t('team.loading')}</p>` });
  const marker = $('#prbImportLoading'), list = await store.prbImportPlan();
  if (!marker.isConnected || store !== S.store) return;
  sheet({ title: t('prb.import'), sub: t('prb.importHint'), cls: 'wide', body: `<div class="prb-import-list">${list.map((r, i) => `<label class="prb-import-row"><input type="checkbox" data-prb-import="${i}" ${r.imported ? 'disabled' : ''}><span><b>${esc(r.name)}</b><small>${esc(r.customer)} · ${esc(r.plate)} ${r.imported ? '· ' + t('prb.imported') : ''}</small></span></label>`).join('') || `<p>${t('prb.noImport')}</p>`}</div>`, foot: prbButton('prb-import-review', 'prb.review') });
  P.importPlan = list;
}
function prbInvoiceSheet() {
  const rows = sortRows(P.data.rows.filter(r => r.insuredId === P.insured && P.selected.has(r.id)));
  if (!canEdit() || !rows.length) return;
  sheet({ title: t('inv.create'), sub: esc(P.data.insured.find(i => i.id === P.insured)?.name || ''), cls: 'xwide', body: `<form id="prbInvoiceForm" class="form" data-form="prb-invoice">${prbTable(rows)}<div class="prb-form"><label class="field"><span>${t('prb.issueDate')}</span><input name="issue" type="date" value="${todayIso()}" required></label><label class="field"><span>${t('prb.due')}</span><input name="due" type="date"></label><label class="field"><span>${t('set.lang')}</span><select name="lang"><option value="both">ไทย / English</option><option value="th">ไทย</option><option value="en">English</option></select></label><label class="field"><span>${t('prb.note')}</span><input name="notes" maxlength="500"></label></div></form>`, foot: `<button class="btn primary" type="submit" form="prbInvoiceForm">${t('inv.create')}</button>` });
}
async function prbCreateInvoice(form) {
  if (!canEdit() || form.dataset.busy) return;
  const req = Object.fromEntries(new FormData(form));
  req.issue = parseDate(req.issue); req.due = req.due ? parseDate(req.due) : '';
  if (!req.issue || (req.due && req.due < req.issue)) throw new Error(t('prb.badPeriod'));
  const state = P, store = S.store;
  req.insuredId = state.insured; req.rowIds = sortRows(state.data.rows.filter(r => r.insuredId === state.insured && state.selected.has(r.id))).map(r => r.id); req.dateFmt = dfmt();
  if (!req.rowIds.length) return;
  form.dataset.busy = '1'; const btn = $('[form="prbInvoiceForm"]'); btn.disabled = true;
  try {
    const inv = await store.prbInvoice(req);
    if (state !== P || store !== S.store) return;
    state.selected.clear(); state.data.invoices.push(inv);
    closeSheet(); await loadPrb(); prbInvoiceOpen(inv.id);
  } finally { delete form.dataset.busy; if (btn.isConnected) btn.disabled = false; }
}
/** Invoice lines only: PRB no., plate, model, net premium, stamps, VAT, total + grand total (saved invoice values) */
function prbInvTable(inv) {
  const m = ['net', 'stamps', 'vat', 'total'], hd = ['prbNo', 'plate', 'model', 'netPremium', 'stamps', 'vat', 'total'];
  return `<div class="prb-wrap"><table class="prb-table"><thead><tr>${hd.map((k, i) => `<th scope="col" ${i > 2 ? 'class="r"' : ''}>${esc(t('prb.' + k))}</th>`).join('')}</tr></thead><tbody>${(inv.lines || []).map(l => `<tr><td>${esc(l.prbNo || '—')}</td><td><bdi dir="ltr">${esc(l.plate || '—')}</bdi></td><td>${esc(l.model || '—')}</td>${m.map(k => `<td class="r">${baht(l[k] || 0)}</td>`).join('')}</tr>`).join('')}</tbody><tfoot><tr><td colspan="3">${t('prb.total')} (${num((inv.lines || []).length)})</td>${m.map(k => `<td class="r">${baht(inv.t?.[k] || 0)}</td>`).join('')}</tr></tfoot></table></div>`;
}
function prbInvoiceOpen(id) {
  const inv = P.data.invoices.find(i => i.id === id); if (!inv) return;
  const body = `<div id="prbInvoicePrint"><h2>${esc(S.company?.name || 'RICH INSURANS')}</h2><h3>${esc(inv.no)}</h3><p>${esc(inv.cust.name)}<br>${esc(inv.cust.taxId || '')}<br>${esc(inv.cust.address || '')}</p><p>${t('prb.issueDate')}: ${esc(fmtDay(inv.issue))}${inv.due ? ' · ' + t('prb.due') + ': ' + esc(fmtDay(inv.due)) : ''}</p>${prbInvTable(inv)}<p>${esc(inv.notes || '')}</p></div>`;
  const act = S.mode === 'cloud' ? `${prbButton('prb-download', 'fl.download', id)}${prbButton('prb-send', 'fl.share', id)}` : prbButton('prb-print', 'prb.print');
  sheet({ title: esc(inv.no), cls: 'xwide', body, foot: `${act}${canEdit() ? prbButton('prb-delete', 'btn.delete', id, 'danger') : ''}` });
}
async function prbDownload(id, share = false) {
  const row = P.data.rows.find(r => r.id === id) || P.data.invoices.find(r => r.id === id); if (!row) return;
  const blob = await S.store.prbGetBlob(id);
  if (!blob) throw new Error(t('fl.noContent'));
  if (share) await shareBlob(blob, row.fileName || row.name); else download(blob, row.fileName || row.name);
}

/* ================= actions ================= */
const EDIT_ACTS = new Set(['ae-file', 'ae-cust', 'ae-save', 'ae-undo', 'smart', 'veh-add', 'veh-edit', 'del-vehicle', 'mv-slot', 'share-link', 'share-stop', 'upload', 'camera', 'add-file', 'do-upload', 'up-more', 'new-customer', 'edit-customer', 'del-file', 'del-customer', 'as-new', 'ai-new', 'up-ai-retry', 'new-invoice', 'inv-save', 'inv-paid', 'inv-edit', 'dup-update', 'dup-apply', 'dup-create', 'pick-customer', 'add']);
const ACT = {
  'prb-save-all': () => prbSaveAll(),
  'prb-accept'(el) {
    if (!PR) return;
    const it = PR.items[+el.dataset.i]; if (!it || it.state === 'saved') return;
    it.row[el.dataset.k] = el.dataset.v;
    const inp = $(`[data-pi="${el.dataset.i}"][data-pk="${el.dataset.k}"]`) || $(`#prbForm [name="${el.dataset.k}"]`); if (inp) inp.value = el.dataset.v;
    if (PR.batch && !PR.cardOpen) prbBatchChecks(); else prbReviewHint();
  },
  'prb-more'(el) { if (!PR) return; PR.index = +el.dataset.i; PR.cardOpen = true; prbReview(); },
  'prb-prev'() { if (!PR) return; prbReadForm(); PR.index = (PR.index - 1 + PR.items.length) % PR.items.length; prbReview(); },
  'prb-next'() { if (!PR) return; prbReadForm(); PR.index = (PR.index + 1) % PR.items.length; prbReview(); },
  'prb-table'() { if (!PR) return; prbReadForm(); PR.cardOpen = false; prbBatch(); },
  'prb-use-name'(el) {
    if (!PR) return;
    const it = PR.items[+el.dataset.i]; if (!it) return;
    it.insured.name = el.dataset.name;
    if (PR.batch && !PR.cardOpen) { const inp = $(`[data-pi="${el.dataset.i}"][data-pk="ins_name"]`); if (inp) inp.value = it.insured.name; prbBatchChecks(); }
    else { const inp = $('#prbForm [name="ins_name"]'); if (inp) inp.value = it.insured.name; prbReviewHint(); }
  },
  'prb-spell'(el) {
    if (!PR) return;
    for (const i of el.dataset.g.split(',').map(Number)) {
      const it = PR.items[i]; if (!it || it.state === 'saved') continue;
      it.insured.name = el.dataset.name;
      const inp = $(`[data-pi="${i}"][data-pk="ins_name"]`); if (inp) inp.value = el.dataset.name;
    }
    prbBatchChecks();
  },
  'prb-refresh': async () => { await loadPrb(); },
  'prb-insured'(el) { P.insured = el.dataset.id; P.selected.clear(); drawPrb(); },
  'prb-clear'() { P.selected.clear(); drawPrb(); },
  'prb-upload': () => prbPick(false),
  'prb-camera': () => prbPick(true),
  'prb-ai': prbReadAi,
  'prb-source': prbPreviewSource,
  'prb-skip'() { if (PR && !PR.busy) { PR.index++; prbReview(); } },
  'prb-open': el => prbOpen(el.dataset.id),
  'prb-download': el => prbDownload(el.dataset.id),
  'prb-send': el => prbDownload(el.dataset.id, true),
  'prb-edit'(el) {
    if (!canEdit()) return;
    const row = P.data.rows.find(r => r.id === el.dataset.id); if (!row) return;
    return prbStart([{ existing: row, row: { ...row }, insured: { ...P.data.insured.find(i => i.id === row.insuredId) } }]);
  },
  async 'prb-delete'(el) {
    if (!canEdit()) return;
    const state = P, store = S.store, row = state.data.rows.find(r => r.id === el.dataset.id), inv = !row && state.data.invoices.find(i => i.id === el.dataset.id);
    const item = row || inv; if (!item) return;
    const q = row ? t('del.file', { x: row.name }) : t('prb.trashInvoiceQ', { x: inv.no || inv.fileName });
    if (!await confirmBox(esc(q + t(S.mode === 'cloud' ? 'del.drive' : 'del.local')))) return;
    if (store !== S.store || !canEdit()) return;
    await store.prbDelete(item.id); if (state !== P) return;
    state.selected.delete(item.id); await loadPrb();
  },
  async 'prb-trash-insured'(el) {
    if (!canEdit()) return;
    const state = P, store = S.store, ins = state.data?.insured.find(i => i.id === (el.dataset.id || state.insured)); if (!ins) return;
    if (state.data.rows.some(r => r.insuredId === ins.id) || state.data.invoices.some(i => i.insuredId === ins.id)) return toast(t('prb.notEmpty'), 'err');
    if (!await confirmBox(esc(t('prb.trashInsuredQ', { x: ins.name }) + t(S.mode === 'cloud' ? 'del.drive' : 'del.local')))) return;
    if (store !== S.store || !canEdit()) return;
    await store.prbDeleteInsured(ins.id); if (state !== P) return;
    state.insured = ''; state.selected.clear(); await loadPrb();
  },
  async 'prb-seq-reset'() {
    if (!isAdmin()) return toast(t('err.role'), 'err');
    const state = P, store = S.store;
    if (state.data?.invoices?.length) return toast(t('prb.invExist'), 'err');
    if (!await confirmBox(esc(t('prb.seqResetQ')), t('prb.seqReset'), false)) return;
    if (store !== S.store || !isAdmin()) return;
    await store.prbSeqReset();
    toast(t('prb.seqResetDone'));
  },
  async 'prb-share'(el) {
    if (!canEdit() || S.mode !== 'cloud') return;
    const store = S.store, id = el.dataset.id;
    if (!await confirmBox(esc(t('prb.shareHint')), t('prb.share'), false)) return;
    if (store !== S.store || !canEdit()) return;
    const result = await store.prbShare(id); await loadPrb();
    sheet({ title: t('prb.share'), body: `<div class="form"><label><span>${t('prb.shareHint')}</span><input id="prbShareLink" readonly value="${esc(result.link)}" dir="ltr"></label></div>`, foot: prbButton('prb-copy-link', 'prb.copy') });
  },
  async 'prb-copy-link'() {
    const input = $('#prbShareLink'); if (!input) return;
    input.select(); input.setSelectionRange(0, input.value.length);
    try { await navigator.clipboard.writeText(input.value); toast(t('prb.copied')); }
    catch { toast(t('prb.copyManual')); }
  },
  async 'prb-unshare'(el) { if (!canEdit()) return; await S.store.prbUnshare(el.dataset.id); await loadPrb(); await prbOpen(el.dataset.id); },
  'prb-import': prbImportSheet,
  'prb-import-review'() {
    if (!isAdmin()) return;
    const items = $$('[data-prb-import]:checked').map(el => ({ source: P.importPlan[+el.dataset.prbImport] }));
    if (items.length) return prbStart(items);
    toast(t('prb.pickImport'));
  },
  'prb-invoice': prbInvoiceSheet,
  'prb-invoice-open': el => prbInvoiceOpen(el.dataset.id),
  'prb-print'() {
    const source = $('#prbInvoicePrint'); if (!source) return;
    const root = $('#print-root'); root.innerHTML = source.outerHTML;
    document.body.classList.add('printing');
    window.print(); document.body.classList.remove('printing'); root.innerHTML = '';
  },
  go(el) { S.view = el.dataset.view; S.mobileDetail = false; closeSheet(); mount(); scrollTo({ top: 0, behavior: 'smooth' }); },
  'close-sheet': closeSheet,
  'close-overlay'(el, e) { if (e.target === el) closeSheet(); },
  'confirm-yes'() { const r = confirmRes; confirmRes = null; closeSheet(); r?.(true); },
  settings: settingsSheet,
  assistant: assistantSheet,
  team: teamSheet,
  company: companySheet,
  migrate: migrateSheet,
  'move-tool'() { if (!isAdmin()) return toast(t('err.role'), 'err'); MV = null; moveSheet(); },
  'mv-apply'(el) { if (!isAdmin()) return toast(t('err.role'), 'err'); return moveApply(+el.dataset.g); },
  'mv-undo'() { if (!isAdmin()) return toast(t('err.role'), 'err'); return moveUndo(); },
  'mv-old'() { if (!isAdmin()) return toast(t('err.role'), 'err'); return oldFoldersSheet(); },
  'mv-slot'(el) { return moveCur(el.dataset.slot); },
  restore() { if (!isAdmin()) return toast(t('err.role'), 'err'); return restoreSheet(); },
  /* v4.3: Edit with AI */
  'ae-file'(el) { const f = S.files.find(x => x.id === el.dataset.id); if (f) aiEditStart(f.customerId, [f.id]); },
  'ae-cust'(el) { const cid = el.dataset.id || S.sel; aiEditStart(cid, S.files.filter(f => f.customerId === cid && aeReadable(f)).map(f => f.id)); },
  'ae-stop'() { if (AE) { AE.stop = true; drawAiEdit(); } },
  'ae-save'(el) { return aiEditSave(el); },
  'ae-undo'(el) { return aiEditUndo(el.dataset.b, el.dataset.id || ''); },
  'ae-list'() { if (!isAdmin()) return toast(t('err.role'), 'err'); return aiEditsSheet(); },
  'rs-all'(el) { if (!RS) return; for (const r of RS.rows) r.on = !!el.dataset.on; for (const c of $$('[data-rs-on]')) c.checked = !!el.dataset.on; rsBtn(); },
  'rs-apply'() { if (!isAdmin()) return toast(t('err.role'), 'err'); return restoreApply(); },
  'rs-undo'() { if (!isAdmin()) return toast(t('err.role'), 'err'); return restoreUndo(); },
  'mv-detect'(el) { if (!isAdmin()) return toast(t('err.role'), 'err'); return detectFor(+el.dataset.g); },
  /* v4: vehicles */
  'veh-open'(el) { const id = el.dataset.id; S.openVeh = S.openVeh === id ? '' : id; S.openSlot = ''; drawPanel(false); loadThumbs(); },
  'veh-slot'(el) {
    const s = el.dataset.slot, open = S.openSlot;
    S.openVeh = el.dataset.veh;
    S.openSlot = open === s ? (VSLOT[s]?.in || '') : s;   // a second tap closes it (5.x goes back to 5)
    drawPanel(false); loadThumbs();
  },
  'veh-add'(el) { vehicleSheet(el.dataset.id || S.sel); },
  'veh-edit'(el) { const v = vehById(el.dataset.id); if (v) vehicleSheet(v.customerId, v); },
  'del-vehicle'(el) { const id = el.dataset.id; closeSheet(); return deleteVehicle(id); },
  /* v4: Smart upload: no customer chosen, the AI finds customer, vehicle, month and folder */
  smart(el) {
    const go = files => files.length && run(() => startUpload(files, { smart: true }));
    if (el?.dataset.src) return pickFiles({ capture: el.dataset.src === 'cam', accept: el.dataset.src === 'cam' ? 'image/*' : '', multiple: el.dataset.src !== 'cam' }).then(go);
    return pickFiles().then(go);
  },
  rename() { if (!isAdmin()) return toast(t('err.role'), 'err'); RN = null; renameSheet(); },
  'rn-all'(el) { if (!RN) return; for (const r of RN.rows) r.on = !!el.dataset.on; for (const c of $$('[data-rn-on]')) c.checked = !!el.dataset.on; rnCount(); },
  'rn-apply'() { if (!isAdmin()) return toast(t('err.role'), 'err'); return renameApply(); },
  'rn-undo'() { if (!isAdmin()) return toast(t('err.role'), 'err'); return renameUndo(); },
  'share-link'() { if (cur?.f && S.store.kind === 'cloud') return shareLink(cur.f); },
  'share-stop'() { if (cur?.f && S.store.kind === 'cloud') return stopShare(cur.f); },
  'copy-link': copyLink,
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
    pickFiles().then(files => files.length && run(() => startUpload(files, uploadSpot(cid))));
  },
  camera() {
    const cid = uploadTarget();
    if (!cust(cid)) return pickCustomerSheet('file');
    pickFiles({ capture: true, accept: 'image/*', multiple: false }).then(files => files.length && run(() => startUpload(files, uploadSpot(cid))));
  },
  'add-file'(el) {
    const cid = S.sel;
    if (!cust(cid)) return pickCustomerSheet('file');
    const vid = el.dataset.veh || '', slot = FILE_SLOTS.includes(el.dataset.slot) ? el.dataset.slot : '';
    sourceSheet(files => startUpload(files, { cid, vid, slot }));
  },
  'new-customer'() { customerSheet(); },
  'edit-customer'() { customerSheet(cust(S.sel)); },
  'pick-customer'(el) { pickCustomerSheet(el.dataset.next || 'file'); },
  picked(el) {
    const id = el.dataset.id;
    if (el.dataset.next === 'invoice') return newInvoice(id);
    S.sel = id;
    sourceSheet(files => startUpload(files, { cid: id }));
  },
  async src(el) {
    const cb = srcCb; if (!cb) return;
    const cam = el.dataset.src === 'cam';
    const files = await pickFiles({ capture: cam, accept: cam ? 'image/*' : cb.accept, multiple: !cam });
    if (files.length) { srcCb = null; cb.onPick(files); }
  },
  select(el) {
    if (S.sel !== el.dataset.id || el.dataset.veh) { S.openVeh = el.dataset.veh || ''; S.openSlot = ''; S.folderTab = ''; }
    S.sel = el.dataset.id; S.mobileDetail = true; drawPanel(true); loadThumbs(); if (narrow()) $('#panel').scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  back() { S.mobileDetail = false; drawPanel(false); },
  tab(el) { S.folderTab = el.dataset.folder; drawPanel(true); loadThumbs(); },
  'clear-filters'() { S.filters = noFilters(); drawFilters(true); drawResults(true); },
  'open-customer'(el) { openCustomer(el.dataset.id, el.dataset.veh || ''); },
  'open-file'(el) { return openFile(el.dataset.id); },
  'open-link'(el) { window.open(el.dataset.url, '_blank', 'noopener'); },
  'open-root'() { if (S.me?.root) window.open('https://drive.google.com/drive/folders/' + encodeURIComponent(S.me.root), '_blank', 'noopener'); },
  async 'up-more'() {
    const files = sizeFilter(await pickFiles());
    if (!U) return;
    for (const file of files) {
      const it = newRow(file, { cid: U.fixedCid });
      const list = U.fixedCid ? vehOf(U.fixedCid) : [];
      if (list.length === 1) { it.vkey = list[0].id; it.vconf = 'high'; }
      it.conf = rowConf(it); autoName(it);
      U.items.push(it);
    }
    drawUpload(); aiQueue();
  },
  'up-remove'(el) { if (!U) return; U.items.splice(+el.closest('.up-row').dataset.i, 1); U.items.length ? drawUpload() : closeSheet(); },
  'do-upload': doUpload,
  'ai-new'(el) { return ACT.smart(el); },   // v3 "Add customer with AI" is now Smart upload
  'up-ai-retry'(el) { const it = U?.items[+el.closest('.up-row').dataset.i]; if (!it) return; it.ai = 'wait'; it.err = ''; drawUpload(); aiQueue(); },
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
  'new-invoice'(el) { const id = el.dataset.id || (S.view === 'dash' ? S.sel : S.filters.customer); if (!cust(id)) return pickCustomerSheet('invoice'); newInvoice(id, el.dataset.veh || ''); },
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
  async 'sign-out'() {
    // device password: end this device's session on the server too, then remove the blob
    const c = device.current();
    if (c && S.store) await S.store.revokeSession(c.sid).catch(() => { });
    device.forget();
    auth.signOut(); S.me = null; S.store = null; S.customers = []; S.files = []; S.invoices = []; S.company = null; applyRole(); closeSheet(); googleGate('signin');
  },
  async retry() {
    auth.drop();
    try { await auth.init(lang); } catch { return showGate('gis'); }
    const tok = await auth.getToken(); if (tok) enterCloud(); else showGate('signin');
  },
  async 'switch-account'() { device.forget(); auth.signOut(); googleGate('signin'); },
  devices: devicesSheet,
  'dv-set'() { closeSheet(); showGate('setpin'); },
  async 'dv-skip'() { device.skip(); if (S.store) await reload(true); else googleGate('signin'); },
  async 'dv-forgot'() {
    if (!await confirmBox(t('dv.forgotQ'), t('dv.forgotOk'), false)) return;
    device.forgetForReset(); S.pinLeft = null; S.pinMsg = '';
    auth.signOut();   // a real Google sign-in is needed, not a silent one
    googleGate('signin');
  },
  async 'dv-revoke'(el) {
    const sid = el.dataset.sid, all = !!el.dataset.all;
    if (device.current()?.sid === sid) {
      if (!await confirmBox(t('dv.revokeSelfQ'), t('dv.signout'))) return;
      return ACT['sign-out']();
    }
    if (!await confirmBox(t('dv.revokeQ', { x: `<b>${esc(el.dataset.name)}</b>` }), t('dv.signout'))) return;
    await (all ? S.store.revokeAny(sid) : S.store.revokeSession(sid));
    devicesSheet(); toast(t('dv.revoked'));
  },
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
    if (kind === 'prb') return prbSave();
    if (kind === 'prb-invoice') return prbCreateInvoice(form);
    if (kind === 'unlock') {
      const pin = form.pin.value;
      if (!pin) return;
      const b = $('#ulbtn'); b.disabled = true; b.querySelector('span').textContent = t('dv.checking');
      try { await device.open(pin); } catch { b.disabled = false; return; }
      return enterCloud();
    }
    if (kind === 'setpin') {
      const pin = form.pin.value, msg = $('#spMsg');
      if (!device.okPin(pin)) { msg.textContent = t('dv.short'); return form.pin.focus(); }
      if (pin !== form.pin2.value) { msg.textContent = t('dv.mismatch'); return form.pin2.focus(); }
      const b = $('#spbtn'); b.disabled = true;
      try {
        const name = form.name.value.trim() || device.guessName();
        const sess = await S.store.createDeviceSession(name, device.oldSid());
        await device.seal(sess, pin, { email: S.me.email, name });
        auth.drop();   // from now on this device uses its own session; the Google token is not kept
        toast(t('dv.saved'));
        await reload(true);
      } finally { if (b.isConnected) b.disabled = false; }
      return;
    }
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
      else if (kind === 'vehicle') await saveVehicleForm(form);
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
  if (el.closest('#prbForm')) { prbReviewHint(); return; }
  if (el.dataset.pi !== undefined && PR?.batch) {
    const it = PR.items[+el.dataset.pi]; if (!it || it.state === 'saved') return;
    if (el.dataset.pk === 'ins_name') it.insured.name = el.value.trim(); else it.row[el.dataset.pk] = el.value.trim();
    if (it.state === 'failed') it.state = '';
    prbBatchChecks(); return;
  }
  if (el.id === 'prbSearch') {
    P.q = el.value; $('#prbRows').innerHTML = prbTable(prbRows(), canEdit()); return;
  }
  if (el.id === 'prbStatus') { P.status = el.value; drawPrb(); return; }
  if (el.id === 'langSel') changeLang(el.value);
  else if (el.dataset.teamRole) run(async () => { drawTeam(await S.store.aclSet(el.dataset.teamRole, el.value)); toast(t('team.changed')); });
  else if (el.dataset.f) {
    S.filters[el.dataset.f] = el.value;
    if (el.dataset.f === 'customer' && el.value && S.view === 'dash') { S.sel = el.value; S.mobileDetail = true; }
    if (el.dataset.f === 'q') { clearTimeout(qT); qT = setTimeout(() => { drawFilters(); drawResults(false); }, 120); }
    else { drawFilters(true); drawResults(true); }
  }
  else if (el.dataset.u && U) {
    const it = U.items[+el.closest('.up-row').dataset.i];
    if (el.dataset.u === 'name') { it.name = el.value; it.nameEdited = true; }
    else rowPick(it, el.dataset.u, el.value);
  }
  else if ((el.dataset.ncF || el.dataset.nvF) && U) {
    const card = el.closest('[data-nc],[data-nv]');
    if (el.dataset.ncF) U.newCust[card.dataset.nc].data[el.dataset.ncF] = el.value;
    else { const n = U.newVeh[card.dataset.nv], k = el.dataset.nvF; if (k === 'ym') n.ym = el.value; else if (k === 'model') { n.data.model = el.value; delete n.data.brand; } else n.data[k] = el.value; }
    for (const x of U.items) autoName(x);
    for (const x of $$('.up-row')) { const it = U.items[+x.dataset.i], inp = x.querySelector('[data-u="name"]'); if (it && inp && document.activeElement !== inp) inp.value = it.name; }
  }
  else if (el.dataset.mv && MV) {
    const row = el.closest('.mv-row'), r = MV.groups[+row.dataset.g].rows[+row.dataset.r], k = el.dataset.mv;
    if (k === 'name') { r.name = el.value; r.nameEdited = true; }
    else { r[k] = k === 'plate' ? el.value.trim() : el.value; if (k !== 'slot') r.touched = true; const n = row.querySelector('[data-mv="name"]'); if (n && !r.nameEdited) n.value = mvRowName(r); }
    row.classList.toggle('need', !r.plate || !r.slot);
    const g = MV.groups[+row.dataset.g], b = $(`[data-act="mv-apply"][data-g="${row.dataset.g}"]`), ok = g.rows.filter(x => x.on && !x.done && x.plate && x.slot && x.ym).length;
    if (b) { b.disabled = !ok; b.textContent = t('mv.apply', { n: ok }); }
  }
  else if (el.dataset.invVeh !== undefined && I) invPickVehicle(el.value);
  else if (el.dataset.ae && AE) { const r = AE.rows[+el.closest('.ae-row').dataset.aei]; if (el.dataset.ae === 'name') aePick(r, 'name', el.value); else aePick(r, el.dataset.ae, el.value); }
  else if (el.dataset.rsName !== undefined && RS) { RS.rows[+el.closest('.rs-row').dataset.rs].want = el.value; rsBtn(); }
  else if (el.dataset.rsBack !== undefined && RS) RS.rows[+el.closest('.rs-row').dataset.rs].back = el.value === '1';
  else if (el.dataset.mvdYm !== undefined && MV) {   // a detected vehicle's month: its rows follow (unless changed by hand)
    const box = el.closest('.mv-dv'), gi = +box.dataset.g, g = MV.groups[gi], v = g.det.vehicles.find(x => x.key === box.dataset.k);
    v.ym = el.value;
    for (const r of g.rows) if (r.det === v.key && !r.touched && !r.done) r.ym = el.value;
    mvSyncRows(gi);
  }
  else if (el.dataset.rnName && RN) { RN.rows[+el.dataset.rnName].name = el.value; }
  else if (el.dataset.diff && U) { U.toggles[el.dataset.diff] = el.checked; drawUpload(); }
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
  if (e.target.hasAttribute('data-pskip') && PR?.batch) {
    const it = PR.items[+e.target.dataset.pskip];
    if (it && it.state !== 'saved') { it.skip = e.target.checked; e.target.closest('tr')?.classList.toggle('skip', it.skip); prbBatchChecks(); }
    return;
  }
  if (e.target.hasAttribute('data-prb-route') && U && !U.busy) {
    const it = U.items[+e.target.dataset.prbRoute];
    it.prbRoute = e.target.checked; if (!it.prbRoute) placeRow(it);
    hintRows(); drawUpload(); return;
  }
  if (e.target.matches('[data-prb-select], [data-prb-all]')) {
    if (!canEdit()) return;
    const ids = e.target.hasAttribute('data-prb-all') ? prbRows().map(r => r.id) : [e.target.dataset.prbSelect];
    for (const id of ids) { if (e.target.checked) P.selected.add(id); else P.selected.delete(id); }
    $('#prbRows').innerHTML = prbTable(prbRows(), true);
    $('#prbSelection').innerHTML = prbSelection(); return;
  }
  const el = e.target;
  if (el.dataset.nvF && U) { drawUpload(); return; }   // a new vehicle's plate or month: month column and names
  if (el.type !== 'checkbox') return;
  if (el.dataset.diff && U) { U.toggles[el.dataset.diff] = el.checked; drawUpload(); }
  if (el.dataset.rnOn && RN) { RN.rows[+el.dataset.rnOn].on = el.checked; rnCount(); }
  if (el.dataset.aeOn !== undefined && AE) { AE.rows[+el.closest('.ae-row').dataset.aei].on = el.checked; drawAiEdit(); }
  if (el.dataset.aenvOk !== undefined && AE) { AE.newVeh[el.closest('[data-aenv]').dataset.aenv].ok = el.checked; drawAiEdit(); }
  if (el.dataset.aevd && AE) { AE.vd[el.dataset.aevd] = el.checked; drawAiEdit(); }
  if (el.dataset.rsOn !== undefined && RS) { RS.rows[+el.closest('.rs-row').dataset.rs].on = el.checked; rsBtn(); }
  if (el.dataset.mvdOn !== undefined && MV) {   // untick a detected vehicle: its files are not moved
    const box = el.closest('.mv-dv'), gi = +box.dataset.g, g = MV.groups[gi], v = g.det.vehicles.find(x => x.key === box.dataset.k);
    v.on = el.checked; box.classList.toggle('off', !el.checked);
    for (const r of g.rows) if (r.det === v.key && !r.done) r.on = el.checked;
    mvSyncRows(gi);
  }
  if (el.dataset.mvOn !== undefined && MV) {
    const row = el.closest('.mv-row'), g = MV.groups[+row.dataset.g]; g.rows[+row.dataset.r].on = el.checked;
    const b = $(`[data-act="mv-apply"][data-g="${row.dataset.g}"]`), ok = g.rows.filter(x => x.on && !x.done && x.plate && x.slot && x.ym).length;
    if (b) { b.disabled = !ok; b.textContent = t('mv.apply', { n: ok }); }
  }
  if ((el.dataset.ncOk !== undefined || el.dataset.nvOk !== undefined) && U) {
    const card = el.closest('[data-nc],[data-nv]');
    (card.dataset.nc ? U.newCust[card.dataset.nc] : U.newVeh[card.dataset.nv]).ok = el.checked;
    card.classList.toggle('ok', el.checked);
  }
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
  if (U || $('#sheet-root .overlay')) return;
  if (S.view === 'prb') return run(() => prbStart([...e.dataTransfer.files].map(file => ({ file }))));
  const dc = e.target.closest?.('[data-customer]');
  // dropped on a case file: that customer (and the vehicle / folder it was dropped on); anywhere else: Smart upload
  if (!dc) return run(() => startUpload(e.dataTransfer.files, { smart: true }));
  S.sel = dc.dataset.customer;
  const vc = e.target.closest?.('[data-veh]'), sl = e.target.closest?.('[data-slot]');
  run(() => startUpload(e.dataTransfer.files, { cid: S.sel, vid: vc?.dataset.veh || '', slot: FILE_SLOTS.includes(sl?.dataset.slot) ? sl.dataset.slot : '' }));
});
addEventListener('paste', e => {
  const f = e.clipboardData?.files;
  if (!f?.length || !canEdit() || S.gate || e.target.closest('input,textarea') || $('#sheet-root .overlay')) return;
  if (S.view === 'prb') { e.preventDefault(); return run(() => prbStart([...f].map(file => ({ file })))); }
  const cid = uploadTarget();
  e.preventDefault(); run(() => startUpload(f, cust(cid) ? uploadSpot(cid) : { smart: true }));
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

// "Reading… 1:25": time since the AI request started (Google can take minutes when busy)
setInterval(() => {
  for (const el of $$('[data-since]')) {
    const s0 = +el.dataset.since; if (!s0) continue;
    const sec = Math.floor((Date.now() - s0) / 1000);
    el.textContent = sec < 5 ? '' : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    el.closest('.scan, .ai-line')?.classList.toggle('slow', sec >= 20);
  }
}, 1000);

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
