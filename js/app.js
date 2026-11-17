import { APP_VERSION, API_URL, MAX_UPLOAD_MB, FOLDERS } from './config.js';
import { t, num, lang, setLang, applyDir, LANGS } from './i18n.js';
import { $, $$, esc, digits, norm, fmtDate, fmtDay, dateFmt, setDateFmt, todayIso, addDays, daysLeft, fmtSize, TYPES, typeLabel, isImage, isPdf, icon, hue, makeThumb, compressImage } from './util.js';
import { LocalStore } from './store-local.js';
import { ApiStore } from './store-remote.js';
import * as auth from './auth.js';
import { ask } from './assistant.js';
import { seedDemo } from './demo.js';
import { calcTotals, baht, lineAmount, invoiceHtml, INVOICE_CSS } from './invoice.js';
import { prepare, normalize, suggestFolder, diff, fileNote, FIELD_GROUPS, ALL_FIELDS, DATE_FIELDS } from './ai.js';
import { checkCustomer, findDuplicates, thaiPhone, money, latinDigits } from './validate.js';

const cloudReady = () => auth.configured() && !!API_URL;
let savedMode = null;
try { savedMode = localStorage.getItem('by_mode'); } catch { }

const S = {
  view: 'customers', cid: null, pushed: false,
  customers: [], files: [], invoices: [], exp: {}, company: null, store: null, loading: true,
  gate: null,            // null | 'loading' | 'signin' | 'expired' | 'deny' | 'config' | 'gis'
  denied: '', role: 'admin', me: null,
  mode: savedMode === 'local' || !cloudReady() ? 'local' : 'cloud',
  q: '', filter: 'all', invFilter: 'all', invQ: '',
};
const cust = id => S.customers.find(c => c.id === id);
const sortCustomers = () => S.customers.sort((a, b) => a.name.localeCompare(b.name, lang));
const canEdit = () => S.role === 'admin' || S.role === 'editor';
const isAdmin = () => S.role === 'admin';
const setMode = m => { S.mode = m; try { localStorage.setItem('by_mode', m); } catch { } };
const aiOn = () => !!S.store?.aiReady && canEdit();
const initial = s => (String(s || '').trim()[0] || '?').toUpperCase();
const FOLDER = Object.fromEntries(FOLDERS.map(f => [f.slot, f]));
const wide = () => matchMedia('(min-width: 900px)').matches;

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
    S.store = st; S.me = me; S.role = me.role; S.gate = null;
    applyRole();
    S.loading = true; mount('fade');
    await reload(true);
  } catch (e) {
    handleError(e);
  } finally { entering = false; }
}

auth.onSignIn(() => { if (S.mode === 'cloud' && S.gate && S.gate !== 'loading') enterCloud(); });

function showGate(g, email = '') {
  S.gate = g; S.denied = email || S.denied;
  closeSheet(); mount('fade');
}

async function reload(remount = false) {
  const { customers, files, invoices } = await S.store.loadAll();
  S.customers = customers; sortCustomers();
  S.files = files.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  S.invoices = (invoices || []).sort((a, b) => String(b.no).localeCompare(String(a.no)));
  S.loading = false;
  computeStatus();
  S.quota = await S.store.quota().catch(() => null);
  if (!S.company) S.store.getSettings().then(c => { S.company = c; }).catch(() => { });
  if (remount) mount('fade'); else redraw();
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
/** Expiry = customer's policyExpiry; for v2 customers without it, the latest expiry of a policy file. */
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
const badge = st => `<em class="badge b-${st}">${t('st.' + st)}</em>`;
const daysText = d => d < 0 ? t('e.past', { n: -d }) : d === 0 ? t('e.today') : t('e.left', { n: d });

/* ================= routing ================= */
const DEPTH = { customers: 0, expiring: 0, invoices: 0, settings: 0, customer: 1 };
function parseHash() {
  const [a, b] = location.hash.replace(/^#\/?/, '').split('/');
  if (a === 'c' && b) return { view: 'customer', cid: decodeURIComponent(b) };
  return { view: ['expiring', 'invoices', 'settings'].includes(a) ? a : 'customers', cid: null };
}
function go(path) { if (location.hash === '#/' + path) route(); else location.hash = '/' + path; }
function openCustomer(id) { S.pushed = true; go('c/' + encodeURIComponent(id)); }
function route() {
  const r = parseHash();
  const dir = DEPTH[r.view] > DEPTH[S.view] ? 'push' : DEPTH[r.view] < DEPTH[S.view] ? 'pop' : 'fade';
  if (r.view !== 'customer') S.pushed = false;
  S.view = r.view; S.cid = r.cid;
  closeSheet(); mount(dir);
  window.scrollTo(0, 0);
}
addEventListener('hashchange', route);

/* ================= mount ================= */
const VIEWS = { customers: vCustomers, customer: vCustomer, expiring: vExpiring, invoices: vInvoices, settings: vSettings };
let animT;
function mount(dir = 'fade') {
  const v = $('#view');
  v.innerHTML = S.gate ? gateHtml() : VIEWS[S.view]();
  v.className = 'view v-' + dir;
  clearTimeout(animT); animT = setTimeout(() => { v.className = 'view'; }, 450);
  document.body.classList.toggle('gated', !!S.gate);
  if (S.gate === 'signin' || S.gate === 'expired') auth.button($('#gbtn'), lang).catch(() => { });
  if (!S.gate) afterDraw();
  syncChrome();
}
/** Redraw current view without the slide animation (after data changes) */
function redraw() {
  if (S.gate) return;
  const y = scrollY;
  $('#view').innerHTML = VIEWS[S.view]();
  afterDraw(); syncChrome();
  scrollTo(0, y);
}
function afterDraw() {
  if (S.view === 'customers') drawList();
  if (S.view === 'invoices') drawInvList();
  loadThumbs();
}
function applyStatic() {
  applyDir();
  document.title = t('brand');
  for (const el of $$('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of $$('[data-i18n-title]')) { el.title = t(el.dataset.i18nTitle); el.setAttribute('aria-label', el.title); }
}
function syncChrome() {
  const tab = S.view === 'customer' ? 'customers' : S.view;
  for (const b of $$('[data-tab]')) { b.classList.toggle('on', b.dataset.tab === tab); b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'); }
  const cloud = S.mode === 'cloud';
  const who = $('#sideWho');
  if (who) who.innerHTML = cloud ? (S.me && !S.gate ? `<i class="dot ok"></i><span>${esc(S.me.email)}</span>` : `<i class="dot warn"></i><span>${t('store.off')}</span>`) : `<i class="dot"></i><span>${t('store.local')}</span>`;
}

/* ================= shared bits ================= */
function vhead(title, { back = false, sub = '', actions = '' } = {}) {
  return `<header class="vhead">
    ${back ? `<button class="hbtn back" data-act="back" aria-label="${t('btn.back')}">${icon('chev', 22)}</button>` : ''}
    <div class="vh-t"><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div>
    <div class="vh-a">${actions}</div>
  </header>`;
}
const skel = n => Array.from({ length: n }, (_, i) => `<div class="sk-card" style="--i:${i}"><i class="sk sk-ava"></i><span><i class="sk sk-l"></i><i class="sk sk-s"></i></span></div>`).join('');
const emptyBox = (ic, title, text = '', action = '') => `<div class="empty"><div class="empty-ico">${icon(ic, 30)}</div><h3>${title}</h3>${text ? `<p>${text}</p>` : ''}${action}</div>`;

/* ================= Customers ================= */
function vCustomers() {
  const now = new Date(), ym = todayIso().slice(0, 7);
  let total = S.customers.length, month = 0, expired = 0;
  for (const c of S.customers) { const m = S.exp[c.id]; if (!m?.exp) continue; if (m.d < 0) expired++; else if (m.exp.slice(0, 7) === ym) month++; }
  const chip = (k, n) => `<button class="chip ${S.filter === k ? 'on' : ''}" data-act="filter" data-f="${k}">${t('fl.' + k)}${n != null ? `<i>${num(n)}</i>` : ''}</button>`;
  const cnt = k => S.customers.filter(c => S.exp[c.id]?.st === k).length;
  return `${vhead(t('nav.customers'), { sub: S.loading ? '' : t('c.count', { n: total }), actions: `<button class="hbtn" data-act="assistant" aria-label="${t('assistant')}">${icon('sparkle', 20)}</button><button class="hbtn primary" data-act="new-customer" data-need="edit" aria-label="${t('btn.newCustomer')}">${icon('userplus', 20)}</button>` })}
  <section class="counters">
    <button class="counter" data-act="filter" data-f="all"><small>${t('k.total')}</small><b>${S.loading ? '–' : num(total)}</b></button>
    <button class="counter c-soon" data-act="go" data-to="expiring"><small>${t('k.month')}</small><b>${S.loading ? '–' : num(month)}</b></button>
    <button class="counter c-expired" data-act="filter" data-f="expired"><small>${t('k.expired')}</small><b>${S.loading ? '–' : num(expired)}</b></button>
  </section>
  <label class="search">${icon('search', 19)}<input id="cq" type="search" enterkeyhint="search" placeholder="${t('c.search')}" value="${esc(S.q)}" autocomplete="off" autocorrect="off" spellcheck="false"></label>
  <div class="chips" role="group">${chip('all')}${chip('active', cnt('active'))}${chip('soon', cnt('soon'))}${chip('expired', cnt('expired'))}${chip('none', cnt('none'))}</div>
  <section class="clist" id="clist">${S.loading ? skel(6) : ''}</section>`;
}
function custMatch(c, q) {
  if (!q) return true;
  const qd = latinDigits(q).replace(/[\s-]/g, '');
  const h = norm(`${c.name} ${c.nameEn} ${c.plate} ${c.province} ${c.brand} ${c.model} ${c.car} ${c.policyNo} ${c.insurer}`);
  if (h.includes(norm(q))) return true;
  if (qd.length >= 3 && /^\+?\d+$/.test(qd)) {
    const p = (c.phone || '').replace(/\D/g, ''), id = (c.idNo || '').replace(/\D/g, '');
    if (p.includes(qd.replace(/^\+?66/, '0')) || id.includes(qd)) return true;
  }
  return latinDigits(c.plate || '').replace(/[\s-]/g, '').toLowerCase().includes(qd.toLowerCase()) && qd.length >= 2;
}
function drawList() {
  const el = $('#clist'); if (!el || S.loading) return;
  if (!S.customers.length) {
    el.innerHTML = emptyBox('users', t('p.empty.title'), canEdit() ? t('p.empty.text') : '',
      `<div class="row-actions" data-need="edit"><button class="btn primary" data-act="ai-new">${icon('wand', 18)}<span>${t('add.ai')}</span></button><button class="btn" data-act="new-customer">${t('add.manual')}</button>${S.store?.kind === 'local' ? `<button class="btn ghost" data-act="seed">${t('p.empty.demo')}</button>` : ''}</div>`);
    return;
  }
  const list = S.customers.filter(c => (S.filter === 'all' || S.exp[c.id]?.st === S.filter) && custMatch(c, S.q.trim()));
  el.innerHTML = list.length ? list.map(custCard).join('') : emptyBox('search', t('p.nomatch'));
}
function custCard(c, i) {
  const m = S.exp[c.id] || { st: 'none' };
  const veh = [c.brand, c.model].filter(Boolean).join(' ') || c.car;
  const sub = [c.plate ? c.plate + (c.province ? ' ' + c.province : '') : '', veh].filter(Boolean).join(' · ') || c.phone || t('p.noinfo');
  return `<button class="ccard" data-act="open-customer" data-id="${esc(c.id)}" style="--i:${Math.min(i, 14)}">
    <span class="ava" style="--h:${hue(c.id)}">${esc(initial(c.name))}</span>
    <span class="cc-main"><b>${esc(c.name)}</b><small>${esc(sub)}</small></span>
    <span class="cc-side">${badge(m.st)}<small>${m.exp ? fmtDay(m.exp) : t('st.notSet')}</small></span>
  </button>`;
}

/* ================= Customer page ================= */
function infoRows(c, keys) {
  return keys.map(k => {
    let v = c[k];
    if (!v) return '';
    if (DATE_FIELDS.has(k)) v = fmtDay(v);
    if (k === 'coverage' || k === 'premium') v = baht(+v);
    const val = k === 'phone' ? `<a href="tel:${esc(v)}" dir="ltr">${esc(v)}</a>` : `<span${['idNo', 'vin', 'engineNo', 'policyNo'].includes(k) ? ' dir="ltr"' : ''}>${esc(v)}</span>`;
    return `<div class="irow"><small>${t('cf.' + k)}</small>${val}</div>`;
  }).join('');
}
function vCustomer() {
  const c = cust(S.cid);
  if (!c) return `${vhead('', { back: true })}${S.loading ? skel(3) : emptyBox('users', t('err.not_found'))}`;
  const m = S.exp[c.id] || { st: 'none' };
  const files = S.files.filter(f => f.customerId === c.id);
  const invs = S.invoices.filter(i => i.customerId === c.id);
  const noFolders = S.store?.kind === 'cloud' && Object.keys(c.folders || {}).length < FOLDERS.length;
  const other = files.filter(f => !FOLDER[f.folder]);
  const veh = c.brand || c.model || c.year || c.color || c.plate || c.vin || c.engineNo || c.car;
  return `${vhead(esc(c.name), { back: true, actions: `<button class="hbtn" data-act="edit-customer" data-need="edit" aria-label="${t('p.edit')}">${icon('edit', 20)}</button>` })}
  <section class="hero card">
    <span class="ava lg" style="--h:${hue(c.id)}">${esc(initial(c.name))}</span>
    <div class="hero-t"><h2>${esc(c.name)}</h2>${c.nameEn ? `<p>${esc(c.nameEn)}</p>` : ''}
      <div class="hero-st">${badge(m.st)}<span>${m.exp ? `${t('cf.policyExpiry')} ${fmtDay(m.exp)} · ${daysText(m.d)}` : t('st.notSetLong')}</span></div>
      ${m.legacy ? `<small class="muted">${t('st.fromFile')}</small>` : ''}</div>
    <div class="quick">
      ${c.phone ? `<a class="qbtn" href="tel:${esc(c.phone)}">${icon('phone', 20)}<span>${t('q.call')}</span></a>` : ''}
      <button class="qbtn" data-act="add-file" data-need="edit">${icon('plus', 20)}<span>${t('q.file')}</span></button>
      <button class="qbtn" data-act="new-invoice" data-need="edit">${icon('invoice', 20)}<span>${t('q.invoice')}</span></button>
    </div>
  </section>
  <section class="card info"><h3>${icon('users', 17)}${t('g.customer')}</h3>${infoRows(c, FIELD_GROUPS.customer.filter(k => k !== 'name' && k !== 'nameEn')) || `<p class="muted">${t('g.none')}</p>`}</section>
  <section class="card info"><h3>${icon('car', 17)}${t('g.vehicle')}</h3>${veh ? infoRows(c, [...FIELD_GROUPS.vehicle, 'car']) : `<p class="muted">${t('g.none')}</p>`}</section>
  <section class="card info"><h3>${icon('shield', 17)}${t('g.policy')}</h3>${infoRows(c, FIELD_GROUPS.policy.filter(k => k !== 'policyExpiry'))}
    <div class="irow"><small>${t('cf.policyExpiry')}</small><span>${c.policyExpiry ? fmtDay(c.policyExpiry) : `<i class="muted">${t('st.notSet')}</i>`}</span></div></section>

  <h2 class="sec-t">${t('fo.title')}<span>${num(files.length)}</span></h2>
  ${noFolders ? `<p class="note">${icon('info', 16)}<span>${t('fo.missing')}</span></p>` : ''}
  ${FOLDERS.map(F => folderSection(F, files.filter(f => f.folder === F.slot))).join('')}
  ${other.length ? `<section class="fsec other"><header><span class="fico">${icon('folder', 18)}</span><div><b>ไม่ระบุ</b><small>${t('fo.other')}</small></div><em>${num(other.length)}</em></header>
    <p class="fnote">${t('fo.otherHint')}</p><div class="tiles">${other.map(fileTile).join('')}</div></section>` : ''}

  <h2 class="sec-t">${t('inv.title')}<span>${num(invs.length)}</span><button class="btn sm" data-act="new-invoice" data-need="edit">${icon('plus', 16)}<span>${t('inv.create')}</span></button></h2>
  <section class="ilist">${invs.length ? invs.map(invRow).join('') : `<p class="muted pad">${t('inv.noneHere')}</p>`}</section>`;
}
function folderSection(F, list) {
  return `<section class="fsec" data-folder="${F.slot}"><header><span class="fico">${icon(F.icon, 18)}</span><div><b>${F.th}</b><small>${t('fo.' + F.slot)}</small></div><em>${num(list.length)}</em>
    <button class="hbtn sm" data-act="add-file" data-folder="${F.slot}" data-need="edit" aria-label="${t('q.file')}">${icon('plus', 18)}</button></header>
    ${list.length ? `<div class="tiles">${list.map(fileTile).join('')}</div>` : ''}</section>`;
}
function ftIcon(f, s = 26) {
  if (f.invoice) return `<span class="ft inv">${icon('invoice', s)}</span>`;
  return `<span class="ft ${isPdf(f) ? 'pdf' : ''}">${isPdf(f) ? 'PDF' : icon(isImage(f) ? 'image' : (TYPES[f.type] || TYPES.other).icon, s)}</span>`;
}
const thumbImg = (src, ic) => `<img class="th" src="${esc(src)}" alt="" loading="lazy" decoding="async" data-ic="${ic}">`;
function fileTile(f, i = 0) {
  const ty = TYPES[f.type] || TYPES.other;
  return `<button class="tile" data-act="open-file" data-id="${esc(f.id)}" style="--i:${Math.min(i, 14)}">
    <span class="thumb">${f.thumb ? thumbImg(f.thumb, ty.icon) : ftIcon(f)}</span>
    <b>${esc(f.name)}</b><small>${fmtDay(f.createdAt)}</small></button>`;
}

// Thumbnails come from the backend (files are private), a batch at a time
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
  setTimeout(loadThumbs, 50);
}

/* ================= Expiring ================= */
function vExpiring() {
  const rows = S.customers.map(c => ({ c, m: S.exp[c.id] })).filter(x => x.m?.exp && x.m.d <= 60).sort((a, b) => a.m.d - b.m.d);
  const groups = [['expired', x => x.m.d < 0], ['d7', x => x.m.d >= 0 && x.m.d <= 7], ['d30', x => x.m.d > 7 && x.m.d <= 30], ['d60', x => x.m.d > 30]];
  const body = S.loading ? skel(5) : rows.length ? groups.map(([k, fn]) => {
    const g = rows.filter(fn); if (!g.length) return '';
    return `<h2 class="sec-t g-${k}">${t('ex.' + k)}<span>${num(g.length)}</span></h2><div class="elist">${g.map(({ c, m }, i) => `
      <div class="erow" style="--i:${Math.min(i, 14)}">
        <button class="e-main" data-act="open-customer" data-id="${esc(c.id)}"><span class="ava" style="--h:${hue(c.id)}">${esc(initial(c.name))}</span>
          <span><b>${esc(c.name)}</b><small>${esc([c.plate, c.insurer].filter(Boolean).join(' · ') || c.phone || '')}</small></span></button>
        <span class="e-date"><b>${fmtDay(m.exp)}</b><em class="badge b-${m.st}">${daysText(m.d)}</em></span>
        ${c.phone ? `<a class="hbtn call" href="tel:${esc(c.phone)}" aria-label="${esc(t('e.call', { x: c.name }))}">${icon('phone', 19)}</a>` : '<span class="hbtn ghost-space"></span>'}
      </div>`).join('')}</div>`;
  }).join('') : emptyBox('clock', t('ex.empty'), t('ex.emptyText'));
  return `${vhead(t('nav.expiring'), { sub: t('ex.sub') })}${body}`;
}

/* ================= Invoices tab ================= */
function vInvoices() {
  const seg = ['all', 'unpaid', 'partial', 'paid'].map(k => `<button class="${S.invFilter === k ? 'on' : ''}" data-act="inv-filter" data-f="${k}">${t('is.' + k)}</button>`).join('');
  const due = S.invoices.filter(i => i.status !== 'paid').reduce((a, i) => a + (i.t?.bal || 0), 0);
  return `${vhead(t('nav.invoices'), { sub: S.invoices.length ? t('inv.outstanding', { x: baht(due) }) : '' })}
  <div class="seg wide-seg" role="group">${seg}</div>
  <label class="search">${icon('search', 19)}<input id="iq" type="search" placeholder="${t('inv.search')}" value="${esc(S.invQ)}" autocomplete="off"></label>
  <section class="ilist" id="ilist">${S.loading ? skel(4) : ''}</section>`;
}
function invRow(inv, i = 0) {
  const c = cust(inv.customerId);
  return `<button class="irow-btn" data-act="open-invoice" data-id="${esc(inv.id)}" style="--i:${Math.min(i, 14)}">
    <span class="ft inv">${icon('invoice', 20)}</span>
    <span class="i-main"><b dir="ltr">${esc(inv.no)}</b><small>${esc(c?.name || inv.cust?.name || '—')} · ${fmtDay(inv.issue)}</small></span>
    <span class="i-side"><b>${baht(inv.t?.total || 0)}</b><em class="badge s-${esc(inv.status)}">${t('is.' + inv.status)}</em></span></button>`;
}
function drawInvList() {
  const el = $('#ilist'); if (!el || S.loading) return;
  const q = norm(S.invQ);
  const list = S.invoices.filter(i => (S.invFilter === 'all' || i.status === S.invFilter) && (!q || norm(`${i.no} ${i.cust?.name} ${cust(i.customerId)?.name || ''} ${i.veh?.plate}`).includes(q)));
  el.innerHTML = list.length ? list.map(invRow).join('') : emptyBox('invoice', S.invoices.length ? t('inv.nomatch') : t('inv.none'), S.invoices.length ? '' : t('inv.noneText'));
}

/* ================= Settings ================= */
function vSettings() {
  const cloud = S.mode === 'cloud', signedIn = cloud && S.me && !S.gate;
  const seg = (items, cur, act) => `<div class="seg" role="group">${items.map(([k, l]) => `<button class="${k === cur ? 'on' : ''}" data-act="${act}" data-v="${k}">${l}</button>`).join('')}</div>`;
  const dfs = [['ce', t('df.ce')], ['be', t('df.be')], ...(lang === 'fa' ? [['fa', t('df.fa')]] : [])];
  const item = (act, ic, title, sub = '', need = '') => `<button class="sitem" data-act="${act}" ${need ? `data-need="${need}"` : ''}><span class="sico">${icon(ic, 19)}</span><span><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</span>${icon('chev', 18)}</button>`;
  return `${vhead(t('nav.settings'))}
  <section class="sgroup"><h3>${t('set.account')}</h3>
    ${cloudReady() ? `<div class="card scard ${cloud ? 'on' : ''}"><div class="set-h">${icon('cloud', 22)}<div><b>${t('set.cloud')}</b><small>${signedIn ? `${t('set.cloud.on', { x: `<bdi>${esc(S.me.email)}</bdi>` })} · <em class="role-chip r-${S.role}">${t('role.' + S.role)}</em>` : t('set.cloud.off')}</small></div></div>
      <div class="row-actions">${signedIn ? `${S.me.root ? `<button class="btn ghost" data-act="open-root">${icon('external', 17)}<span>${t('set.folder')}</span></button>` : ''}<button class="btn danger-ghost" data-act="sign-out">${icon('logout', 17)}<span>${t('set.signout')}</span></button>`
        : `<button class="btn primary" data-act="mode-cloud">${icon('cloud', 18)}<span>${t('set.signin')}</span></button>`}</div></div>` : ''}
    <div class="card scard ${!cloud ? 'on' : ''}"><div class="set-h">${icon('folder', 22)}<div><b>${t('set.demo')}</b><small>${t('set.local.text')}</small></div></div>
      <div class="row-actions">${!cloud ? `<button class="btn ghost" data-act="seed">${t('set.seed')}</button><button class="btn danger-ghost" data-act="wipe">${t('set.wipe')}</button>` : `<button class="btn ghost" data-act="mode-local">${t('set.use')}</button>`}</div></div>
  </section>
  <section class="sgroup"><h3>${t('set.display')}</h3>
    <div class="card scard"><small class="lbl">${t('set.lang')}</small>${seg(Object.entries(LANGS), lang, 'lang')}
      <small class="lbl">${t('set.datefmt')}</small>${seg(dfs, dateFmt(), 'datefmt')}
      <small class="muted">${t('set.dateNote', { x: fmtDay(todayIso()) })} ${t('set.theme')}</small></div>
  </section>
  <section class="sgroup"><h3>${t('set.business')}</h3><div class="card slist">
    ${item('company', 'invoice', t('co.title'), isAdmin() ? t('co.sub') : t('co.subRo'))}
    ${S.mode === 'cloud' && isAdmin() ? item('team', 'team', t('set.team'), t('team.sub')) : ''}
    ${S.mode === 'cloud' && isAdmin() ? item('migrate', 'folder', t('mig.title'), t('mig.sub')) : ''}
    ${S.mode === 'cloud' ? `<div class="sitem static"><span class="sico">${icon('wand', 19)}</span><span><b>${t('ai.status')}</b><small>${S.store?.aiReady ? t('ai.on') : t('ai.off')}</small></span>${S.store?.aiReady ? `<em class="badge b-active">${t('ai.ready')}</em>` : `<em class="badge b-none">${t('ai.notSet')}</em>`}</div>` : ''}
  </div></section>
  <section class="sgroup"><h3>${t('set.app')}</h3><div class="card slist">
    <div class="sitem static"><span class="sico">${icon('download', 19)}</span><span><b>${t('set.install')}</b><small>${t('set.installText')}</small></span></div>
  </div><p class="ver">${t('set.ver', { v: digits(APP_VERSION) })}</p></section>`;
}

function gateHtml() {
  const g = S.gate;
  const demo = `<button class="btn ghost" data-act="mode-local">${t('gate.demo')}</button>`;
  const brand = `<div class="gate-logo">${icon('shield', 34)}</div>`;
  if (g === 'loading') return `<section class="gate">${brand}<h1>${t('gate.loading')}</h1><div class="spin"></div></section>`;
  if (g === 'deny') return `<section class="gate">${brand}<h1>${t('deny.title')}</h1>
      <p>${t('deny.text', { x: `<b dir="ltr">${esc(S.denied)}</b>` })}</p>
      <div class="row-actions center"><button class="btn primary" data-act="retry">${t('deny.retry')}</button><button class="btn ghost" data-act="switch-account">${t('deny.switch')}</button></div>
      <div class="gate-foot">${demo}</div></section>`;
  if (g === 'config' || g === 'gis') return `<section class="gate">${brand}<h1>${t('gate.title')}</h1><p>${t('gate.' + g)}</p>
      <div class="row-actions center">${g === 'gis' ? `<button class="btn primary" data-act="reload">${t('gate.retry')}</button>` : ''}${demo}</div></section>`;
  return `<section class="gate">${brand}<h1>${t('gate.title')}</h1>
      <p>${t(g === 'expired' ? 'gate.expired' : 'gate.text')}</p>
      <div class="gbtn" id="gbtn"><div class="spin"></div></div>
      <div class="gate-foot">${demo}</div></section>`;
}

/* ================= sheets ================= */
let urls = [], confirmRes = null, sheetClose = null;
/**
 * Bottom sheet (phone) / dialog (desktop). Head stays on top, foot (actions) stays at the bottom,
 * body scrolls. cls: 'small' | 'full'.
 */
function sheet({ title = '', sub = '', body = '', foot = '', cls = '', head = '' }) {
  const root = $('#sheet-root');
  const wasOpen = !!root.querySelector('.overlay.in');
  root.innerHTML = `<div class="overlay ${wasOpen ? 'in quick' : ''}" data-act="close-overlay"><div class="sheet ${cls}" role="dialog" aria-modal="true" aria-label="${esc(String(title).replace(/<[^>]+>/g, ''))}">
    <div class="sh-grab"><i></i></div>
    ${head || `<header class="sh-head"><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div><button class="hbtn" data-act="close-sheet" aria-label="${t('btn.close')}">${icon('x', 20)}</button></header>`}
    <div class="sh-body">${body}</div>${foot ? `<footer class="sh-foot">${foot}</footer>` : ''}</div></div>`;
  document.body.classList.add('sheet-open');
  if (!wasOpen) requestAnimationFrame(() => requestAnimationFrame(() => root.firstElementChild?.classList.add('in')));
}
function closeSheet() {
  const o = $('#sheet-root .overlay');
  if (confirmRes) { confirmRes(false); confirmRes = null; }
  document.body.classList.remove('sheet-open');
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
    sheet({ title: t('sure'), body: `<p class="sh-text">${text}</p>`, cls: 'small',
      foot: `<button class="btn ghost" data-act="close-sheet">${t('btn.cancel')}</button><button class="btn ${danger ? 'danger' : 'primary'}" data-act="confirm-yes">${ok}</button>` });
    confirmRes = res;
  });
}

let toastT;
function toast(msg, kind = '') {
  const r = $('#toast-root');
  r.innerHTML = `<div class="toast ${kind}" role="status">${icon(kind === 'err' ? 'alert' : 'check', 18)}<span>${esc(msg)}</span></div>`;
  clearTimeout(toastT);
  toastT = setTimeout(() => r.firstElementChild?.classList.add('out'), kind === 'err' ? 5200 : 3200);
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

/* ---------- "+" (Add) sheet ---------- */
function addSheet() {
  const c = S.view === 'customer' ? cust(S.cid) : null;
  sheet({ title: t('add.title'), cls: 'small', body: `<div class="alist">
    <div class="abig"><span class="aico ai">${icon('wand', 24)}</span><div><b>${t('add.ai')}</b><small>${aiOn() ? t('add.aiSub') : S.mode === 'local' ? t('ai.localOnly') : t('ai.off')}</small></div></div>
    <div class="two-btn"><button class="btn primary" data-act="ai-new" data-src="cam" ${aiOn() ? '' : 'disabled'}>${icon('camera', 19)}<span>${t('src.camera')}</span></button>
      <button class="btn" data-act="ai-new" data-src="files" ${aiOn() ? '' : 'disabled'}>${icon('gallery', 19)}<span>${t('src.files')}</span></button></div>
    <button class="aitem" data-act="new-customer"><span class="aico">${icon('userplus', 21)}</span><span><b>${t('add.manual')}</b><small>${t('add.manualSub')}</small></span>${icon('chev', 18)}</button>
    <button class="aitem" data-act="${c ? 'add-file' : 'pick-customer'}"><span class="aico">${icon('folder', 21)}</span><span><b>${t('add.file')}</b><small>${c ? esc(c.name) : t('add.fileSub')}</small></span>${icon('chev', 18)}</button>
    <button class="aitem" data-act="${c ? 'new-invoice' : 'pick-customer'}" data-next="invoice"><span class="aico">${icon('invoice', 21)}</span><span><b>${t('inv.create')}</b><small>${c ? esc(c.name) : t('add.fileSub')}</small></span>${icon('chev', 18)}</button>
  </div>` });
}

/** Lets the user choose a customer, then continues with `next` ('file' | 'invoice') */
function pickCustomerSheet(next) {
  sheet({ title: t('pick.title'), cls: 'full', body: `<label class="search">${icon('search', 19)}<input id="pq" type="search" placeholder="${t('c.search')}" autocomplete="off"></label><div class="clist" id="plist"></div>` });
  const draw = q => { const el = $('#plist'); if (el) el.innerHTML = S.customers.filter(c => custMatch(c, q)).slice(0, 80).map((c, i) => custCard(c, i).replace('data-act="open-customer"', `data-act="picked" data-next="${next}"`)).join('') || emptyBox('search', t('p.nomatch')); };
  draw('');
  $('#pq').addEventListener('input', e => draw(e.target.value.trim()));
}

/** Camera or files? (both are big, clear buttons) */
function sourceSheet(onPick, { title = t('q.file'), accept = '' } = {}) {
  sheet({ title, cls: 'small', body: `<div class="two-btn tall">
    <button class="btn primary" data-act="src" data-src="cam">${icon('camera', 24)}<span>${t('src.camera')}</span></button>
    <button class="btn" data-act="src" data-src="files">${icon('gallery', 24)}<span>${t('src.files')}</span></button></div>` });
  srcCb = { onPick, accept };
}
let srcCb = null;

/* ---------- customer form (manual add / edit) ---------- */
const fieldInput = (k, v, { err = '', warn = '', conf = null, note = '', ro = false } = {}) => {
  const val = esc(v || '');
  const attrs = `name="${k}" data-r="${k}" ${ro ? 'disabled' : ''}`;
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
  sheet({ title: t(CF.id ? 'c.edit' : 'c.new'), sub: t('c.sub'), cls: 'full',
    body: `<form class="form" data-form="customer" id="cform" novalidate>${fieldGroups(c, { errors, warnings, extraVehicle: c.car ? ['car'] : [] })}
      <fieldset class="fgroup"><div class="fgrid">${fieldInput('note', c.note)}</div></fieldset>${datalists()}
      ${CF.id ? `<button type="button" class="btn danger-ghost block" data-act="del-customer" data-id="${esc(CF.id)}">${icon('trash', 17)}<span>${t('c.delete')}</span></button>` : ''}</form>`,
    foot: `<button type="button" class="btn ghost" data-act="close-sheet">${t('btn.cancel')}</button><button class="btn primary" type="submit" form="cform">${t('btn.save')}</button>` });
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
      const ok = await confirmBox(t('dup.text', { x: d.map(x => `<b>${esc(x.customer.name)}</b> (${x.why.map(w => t('cf.' + w)).join(', ')})`).join(', ') }), t('dup.createAnyway'), false);
      if (!ok) { drawCustomerSheet(errors, warnings); return; }
    }
  }
  const payload = { id: CF.id || undefined, name: v.name };
  for (const k of CUSTOMER_FORM_KEYS) if (k in v) payload[k] = v[k];
  const c = await S.store.saveCustomer(payload);
  closeSheet(); await reload();
  toast(t(CF.id ? 't.customerUpdated' : 't.customerAdded'));
  if (!CF.id) openCustomer(c.id);
}

/* ---------- folder picker ---------- */
function folderPicker(cur, aiSlot, name = 'folder', i = '') {
  return `<div class="fpick" role="radiogroup" aria-label="${t('fo.choose')}">${FOLDERS.map(F => `
    <button type="button" role="radio" aria-checked="${cur === F.slot}" class="${cur === F.slot ? 'on' : ''}" data-act="pick-folder" data-name="${name}" data-i="${i}" data-folder="${F.slot}">
      <span class="fp-ico">${icon(F.icon, 20)}</span><b>${F.th}</b><small>${t('fo.' + F.slot)}</small>${aiSlot === F.slot ? `<em class="ai-tag">${icon('wand', 12)} AI</em>` : ''}</button>`).join('')}</div>`;
}
const typeFor = (slot, docType) => slot === 'docs' ? (docType === 'id_card' ? 'id' : 'car') : FOLDER[slot]?.type || 'other';

/* ---------- upload to an existing customer (with AI suggestions) ---------- */
let U = null;
const MAX = MAX_UPLOAD_MB * 1048576;
const compressible = f => /^image\/(jpeg|png|webp|heic|heif)$/i.test(f.type);
const readable = f => compressible(f) || f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

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
  const files = sizeFilter([...fileList]);
  if (!files.length) return;
  const c = cust(cid); if (!c) return;
  U = {
    cid, toggles: {}, busy: false,
    items: files.map(file => ({ file, name: file.name, folder, picked: !!folder, aiFolder: null, type: typeFor(folder), expiry: '', ai: aiOn() && readable(file) ? 'wait' : 'skip', n: null, url: isImage({ mime: file.type }) ? objUrl(file) : '', done: false })),
  };
  drawUploadSheet();
  sheetClose = () => { U = null; };
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
      if (it.n.values.policyExpiry && (it.folder === 'policy') && !it.expiry) it.expiry = it.n.values.policyExpiry;
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
function drawUploadSheet() {
  const c = cust(U.cid);
  sheet({ title: t('u.title'), sub: esc(c.name), cls: 'full',
    body: `<div id="upList" class="up-list"></div><div id="upDiff"></div>`,
    foot: `<button class="btn ghost" data-act="up-more">${icon('plus', 17)}<span>${t('u.more')}</span></button><span class="sp"></span><button class="btn primary" data-act="do-upload" id="upGo"></button>` });
  drawUpload();
}
function aiLine(it) {
  if (it.ai === 'skip') return '';
  if (it.ai === 'wait' || it.ai === 'busy') return `<p class="ai-line busy"><span class="spin sm"></span>${t('ai.reading')}</p>`;
  if (it.ai === 'err') return `<p class="ai-line err">${icon('alert', 15)}${esc(it.err)} · ${t('ai.manual')}</p>`;
  const dt = it.n?.docType || 'other';
  return `<p class="ai-line ok">${icon('wand', 15)}${t('ai.found', { x: t('dt.' + dt) })}${it.aiFolder ? ` · ${t('ai.suggests', { x: FOLDER[it.aiFolder].th })}` : ''}</p>`;
}
function drawUpload() {
  const el = $('#upList'); if (!el || !U) return;
  el.innerHTML = U.items.map((it, i) => `
    <div class="up-row ${it.done ? 'done' : ''}" data-i="${i}">
      <div class="up-top">
        <span class="up-th">${it.url ? `<img src="${it.url}" alt="">` : ftIcon({ mime: it.file.type, name: it.name, type: it.type }, 24)}</span>
        <input data-u="name" maxlength="200" value="${esc(it.name)}" aria-label="${t('u.fileName')}">
        <button class="hbtn sm" data-act="up-remove" aria-label="${t('u.remove')}">${icon('x', 16)}</button>
      </div>
      ${aiLine(it)}
      <p class="fpick-label">${t('fo.choose')}${it.folder ? '' : ` <em class="req">${t('fo.required')}</em>`}</p>
      ${folderPicker(it.folder, it.aiFolder, 'up', i)}
      ${it.folder === 'docs' ? `<label class="fld inline"><span class="fl">${t('fl.type')}</span><select data-u="type"><option value="car" ${it.type === 'car' ? 'selected' : ''}>${typeLabel('car')}</option><option value="id" ${it.type === 'id' ? 'selected' : ''}>${typeLabel('id')}</option><option value="other" ${it.type === 'other' ? 'selected' : ''}>${typeLabel('other')}</option></select></label>` : ''}
      ${it.folder === 'policy' ? `<label class="fld inline"><span class="fl">${t('fl.expiry')}</span><input type="date" data-u="expiry" value="${esc(it.expiry)}"></label>` : ''}
      ${it.done ? `<p class="ai-line ok">${icon('check', 15)}${t('u.saved')}</p>` : ''}
    </div>`).join('');
  const d = uploadDiff(), de = $('#upDiff');
  de.innerHTML = d.length ? `<section class="diff"><h3>${icon('wand', 17)}${t('diff.title')}</h3><p class="muted">${t('diff.sub')}</p>
    ${d.map(x => `<label class="drow ${x.conf < 0.6 ? 'lo' : x.conf < 0.85 ? 'mid' : ''}"><input type="checkbox" data-diff="${x.key}" ${x.on ? 'checked' : ''}>
      <span class="d-k">${t('cf.' + x.key)}${x.note ? ` <em class="conf c-lo">${t(x.note)}</em>` : x.conf < 0.85 ? ` <em class="conf c-${x.conf < 0.6 ? 'lo' : 'mid'}">${t(x.conf < 0.6 ? 'conf.lo' : 'conf.mid')}</em>` : ''}</span>
      <span class="d-v"><s>${esc(fmtVal(x.key, x.old)) || '—'}</s>${icon('chev', 14)}<b>${esc(fmtVal(x.key, x.new))}</b></span></label>`).join('')}</section>` : '';
  const go = $('#upGo');
  if (go) { const n = U.items.filter(x => !x.done).length; go.textContent = d.some(x => x.on) ? t('u.saveApply', { n }) : t('u.save', { n }); go.disabled = U.busy; }
}
const fmtVal = (k, v) => !v ? '' : DATE_FIELDS.has(k) ? fmtDay(v) : v;

async function doUpload(btn) {
  if (U.busy) return;
  const missing = U.items.find(it => !it.done && !it.folder);
  if (missing) { toast(t('fo.pickAll'), 'err'); $(`.up-row[data-i="${U.items.indexOf(missing)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
  const u = U, c = cust(u.cid);
  for (const it of u.items) if (it.ai === 'wait') it.ai = 'skip';   // save now; files not read yet are saved without AI
  u.busy = true; drawUpload();
  let done = 0, failed = null;
  try {
    for (const it of u.items) {
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
      const f = await S.store.addFile(blob, meta);
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
      else await S.store.saveCustomer(upd);
    }
  } catch (e) { failed = e; }
  finally {
    u.busy = false;
    if (done || !failed) await reload().catch(() => { });
    if (U === u) drawUpload();
  }
  if (failed) throw failed;
  closeSheet();
  toast(t('u.done', { n: done }));
}

/* ---------- "Add customer with AI" ---------- */
let R = null;   // review state
async function aiNew(src) {
  if (!aiOn()) return toast(S.mode === 'local' ? t('ai.localOnly') : t('ai.off'), 'err');
  const files = await pickFiles({ capture: src === 'cam', accept: src === 'cam' ? 'image/*' : DOC_ACCEPT, multiple: src !== 'cam' });
  if (files.length) aiNewFiles(files);
}
function readingSheet() {
  sheet({ title: t('ai.readingTitle'), cls: 'full', body: `<div class="reading">
    <div class="pv-strip">${R.files.map((f, i) => R.previews[i] ? `<img src="${R.previews[i]}" alt="">` : `<span class="pv-file">${ftIcon({ mime: f.type, name: f.name }, 28)}<small>${esc(f.name)}</small></span>`).join('')}</div>
    <div class="scan"><span class="spin"></span><p>${t('ai.reading')}</p><small>${t('ai.readingSub')}</small></div>
    ${Array.from({ length: 6 }, () => `<div class="sk-field"><i class="sk sk-s"></i><i class="sk sk-in"></i></div>`).join('')}</div>` });
  sheetClose = () => { R = null; };
}
function reviewSheet() {
  const lowCount = Object.values(R.n?.conf || {}).filter(c => c < 0.85).length;
  sheet({ title: t('rv.title'), sub: R.n ? t('rv.sub', { x: t('dt.' + R.n.docType) }) : t('rv.subManual'), cls: 'full review',
    body: `<div class="rv">
      <aside class="rv-pv">${R.files.map((f, i) => R.previews[i] ? `<button class="pv-img" data-act="pv-zoom" data-i="${i}"><img src="${R.previews[i]}" alt=""></button>` : `<button class="pv-file" data-act="pv-open" data-i="${i}">${ftIcon({ mime: f.type, name: f.name }, 28)}<small>${esc(f.name)}</small></button>`).join('')}</aside>
      <form class="form rv-form" data-form="review" id="rvform" novalidate>
        ${R.n ? `<p class="note ${lowCount ? 'warn' : ''}">${icon(lowCount ? 'alert' : 'check', 16)}<span>${lowCount ? t('rv.check', { n: lowCount }) : t('rv.allGood')} ${t('rv.never')}</span></p>` : ''}
        ${fieldGroups(R.v, { errors: R.errors, warnings: R.warnings, conf: R.n?.conf, notes: R.n?.notes })}
        <fieldset class="fgroup"><legend>${t('rv.saveTo')}</legend>${folderPicker(R.folder, R.aiFolder, 'rv')}</fieldset>${datalists()}
      </form></div>`,
    foot: `<button type="button" class="btn ghost" data-act="close-sheet">${t('btn.cancel')}</button><button class="btn primary" type="submit" form="rvform">${icon('check', 18)}<span>${t('rv.confirm')}</span></button>` });
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
    foot: `<button class="btn ghost" data-act="dup-back">${t('btn.back')}</button><button class="btn" data-act="dup-create">${t('dup.createAnyway')}</button>` });
  sheetClose = () => { R = null; };
}
async function createFromReview() {
  const v = R.v, r = R;
  if (!v.car && (v.brand || v.model)) v.car = [v.brand, v.model, v.color].filter(Boolean).join(' ');
  const btn = $('.sh-foot .btn.primary'); if (btn) btn.disabled = true;
  const c = await S.store.saveCustomer({ ...v });
  await uploadSources(r, c.id);
  sheetClose = null; R = null; closeSheet();
  await reload();
  toast(t('t.customerAdded'));
  openCustomer(c.id);
}
async function uploadSources(r, cid) {
  for (const f of r.files) {
    let blob = compressible(f) ? await compressImage(f) : f;
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
  // every field on the review screen may update the customer (except policy fields from a previous policy)
  const n = { docType: 'policy', values: r.v, conf: r.n?.conf || {}, notes: r.n?.notes || {} };
  const d = diff(c, n, r.folder === 'prev' ? 'prev' : 'policy');
  const list = d.length ? d : [];
  sheet({ title: t('dup.updTitle', { x: esc(c.name) }), sub: t('diff.sub'), cls: 'full',
    body: list.length ? `<section class="diff">${list.map(x => `<label class="drow ${x.conf < 0.6 ? 'lo' : x.conf < 0.85 ? 'mid' : ''}"><input type="checkbox" data-dupdiff="${x.key}" ${x.on ? 'checked' : ''}>
      <span class="d-k">${t('cf.' + x.key)}</span><span class="d-v"><s>${esc(fmtVal(x.key, x.old)) || '—'}</s>${icon('chev', 14)}<b>${esc(fmtVal(x.key, x.new))}</b></span></label>`).join('')}</section>`
      : `<p class="sh-text">${t('diff.none')}</p>`,
    foot: `<button class="btn ghost" data-act="dup-back">${t('btn.back')}</button><button class="btn primary" data-act="dup-apply" data-id="${esc(id)}">${t('dup.apply')}</button>` });
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
  sheet({ title: esc(f.name), sub: `${esc(c.name)} · ${fmtSize(f.size)} · ${fmtDay(f.createdAt)}${by}`, cls: 'full',
    body: `<div class="preview" id="preview"><div class="spin"></div></div>
    <p class="fpick-label">${t('fo.in')}: <b>${FOLDER[f.folder] ? FOLDER[f.folder].th : 'ไม่ระบุ · ' + t('fo.other')}</b></p>
    ${canEdit() ? `<details class="move" ${FOLDER[f.folder] ? '' : 'open'}><summary>${icon('move', 17)}${t('fo.move')}</summary>${folderPicker(f.folder, null, 'move')}<p class="muted">${t('fo.moveNote')}</p></details>` : ''}
    ${inv ? `<button class="btn block" data-act="open-invoice" data-id="${esc(inv.id)}">${icon('invoice', 18)}<span>${t('inv.open')}</span></button>` : `
    <form class="form" data-form="file" id="fform" data-id="${esc(f.id)}">
      <label class="fld"><span class="fl">${t('u.fileName')}</span><input name="name" value="${esc(f.name)}" maxlength="200" required ${dis}></label>
      <div class="fgrid">
        <label class="fld"><span class="fl">${t('fl.cat')}</span><select name="type" ${dis}>${Object.keys(TYPES).map(k => `<option value="${k}" ${k === f.type ? 'selected' : ''}>${typeLabel(k)}</option>`).join('')}</select></label>
        <label class="fld"><span class="fl">${t('fl.expiry')}</span><input type="date" name="expiry" value="${esc(f.expiry || '')}" ${dis}></label>
      </div>
      <label class="fld"><span class="fl">${t('fl.note')}</span><input name="note" value="${esc(f.note || '')}" maxlength="2000" placeholder="${ro ? '' : t('fl.note.ph')}" ${dis}></label>
    </form>`}`,
    foot: `<button type="button" class="hbtn danger" data-act="del-file" data-need="edit" data-id="${esc(f.id)}" aria-label="${t('btn.delete')}">${icon('trash', 19)}</button>
      <button type="button" class="hbtn" data-act="dl-file" aria-label="${t('fl.download')}">${icon('download', 19)}</button>
      ${navigator.share ? `<button type="button" class="hbtn" data-act="share-file" aria-label="${t('fl.share')}">${icon('share', 19)}</button>` : ''}
      <span class="sp"></span>${inv ? '' : `<button class="btn primary" type="submit" form="fform" data-need="edit">${t('fl.saveChanges')}</button>`}` });
  let blob;
  try { blob = await S.store.getBlob(id); }
  catch (e) { const pv = $('#preview'); if (pv && cur?.f.id === id) pv.innerHTML = `<p class="sh-text">${t('fl.noContent')}</p>`; throw e; }
  if (cur?.f.id !== id) return;
  const pv = $('#preview'); if (!pv) return;
  if (!blob) { pv.innerHTML = `<p class="sh-text">${t('fl.noContent')}</p>`; return; }
  cur.blob = blob; cur.url = objUrl(blob);
  pv.innerHTML = isImage(f) ? `<img src="${cur.url}" alt="${esc(f.name)}">`
    : isPdf(f) ? `<iframe src="${cur.url}#toolbar=0" title="${esc(f.name)}"></iframe><button class="btn sm open-full" data-act="open-link" data-url="${cur.url}">${icon('external', 16)}<span>${t('fl.full')}</span></button>`
      : `<div class="nopv">${ftIcon(f, 30)}<p>${t('fl.noPreview')}</p></div>`;
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
  const c = cust(cid); if (!c) return;
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
  try { return { t: calcTotals(I.d.items.map(it => ({ q: +it.q || 0, p: it.p || 0 })), I.d.discount || 0, I.d.vat, I.d.paid || 0) }; }
  catch (e) { return { err: e.key || 'inv.badAmount' }; }
}
function invoiceEditor() {
  const d = I.d;
  const inp = (path, v, attrs = '') => `<input data-i="${path}" value="${esc(v ?? '')}" ${attrs}>`;
  const f = (label, path, v, attrs = '') => `<label class="fld"><span class="fl">${label}</span>${inp(path, v, attrs)}</label>`;
  const seg = ['th', 'en', 'both'].map(k => `<button type="button" class="${d.lang === k ? 'on' : ''}" data-act="inv-lang" data-v="${k}">${t('il.' + k)}</button>`).join('');
  sheet({ title: I.id ? t('inv.edit', { x: esc(I.no) }) : t('inv.new'), sub: esc(d.cust.name), cls: 'full',
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
        <label class="switch"><input type="checkbox" data-i="vat" ${d.vat ? 'checked' : ''}><span class="sw"></span><span>${t('inv.vat')}</span></label>
        <label class="fld"><span class="fl">${t('inv.notes')}</span><textarea data-i="notes" rows="2" maxlength="500">${esc(d.notes)}</textarea></label></fieldset>
      ${datalists()}
    </form>`}
    <div class="totals" id="invTot">${invTotalsHtml()}</div>`,
    foot: `<button type="button" class="btn ghost" data-act="close-sheet">${t('btn.cancel')}</button><button class="btn primary" data-act="inv-save" id="invGo">${icon('invoice', 18)}<span>${I.id ? t('inv.regen') : t('inv.createPdf')}</span></button>` });
  sheetClose = () => { I = null; };
}
function invItemsHtml() {
  return I.d.items.map((it, i) => `<div class="line" data-line="${i}">
    <input class="l-d" data-i="items.${i}.d" value="${esc(it.d)}" placeholder="${t('inv.desc')}" aria-label="${t('inv.desc')}">
    <input class="l-q" data-i="items.${i}.q" value="${esc(it.q)}" inputmode="decimal" aria-label="${t('inv.qty')}">
    <input class="l-p" data-i="items.${i}.p" value="${esc(it.p)}" inputmode="decimal" placeholder="0.00" aria-label="${t('inv.price')}">
    <b class="l-a" id="la${i}">${baht(lineAmount({ q: +it.q || 0, p: it.p }))}</b>
    <button type="button" class="hbtn sm" data-act="inv-del-line" data-i="${i}" aria-label="${t('u.remove')}" ${I.d.items.length < 2 ? 'disabled' : ''}>${icon('x', 15)}</button></div>`).join('');
}
function invTotalsHtml() {
  const r = invTotals();
  if (r.err) return `<p class="ferr">${icon('alert', 15)} ${t(r.err)}</p>`;
  const T = r.t;
  return `<div><span>${t('inv.sub')}</span><b>${baht(T.sub)}</b></div>${T.disc ? `<div><span>${t('inv.discount')}</span><b>-${baht(T.disc)}</b></div>` : ''}
    ${I.d.vat ? `<div><span>VAT 7%</span><b>${baht(T.vat)}</b></div>` : ''}<div class="tot"><span>${t('inv.total')}</span><b>${baht(T.total)}</b></div>
    ${T.paid ? `<div><span>${t('inv.paid')}</span><b>${baht(T.paid)}</b></div><div class="tot2"><span>${t('inv.bal')}</span><b>${baht(T.bal)}</b></div>` : ''}
    <div class="st-line"><em class="badge s-${T.status}">${t('is.' + T.status)}</em></div>`;
}
function invPreviewHtml() {
  const r = invTotals();
  return invoiceHtml({ ...I.d, no: I.no || t('inv.auto'), t: r.t, status: r.t?.status || 'unpaid' }, S.company || {}, dateFmt() === 'be' ? 'be' : 'ce');
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
  if (e) { if (I.tab === 'edit') { $('#invItems').innerHTML = invItemsHtml(); } $('#invTot').innerHTML = invTotalsHtml(); return toast(t(e), 'err'); }
  btn.disabled = true; btn.innerHTML = `<span class="spin sm"></span><span>${t('inv.making')}</span>`;
  try { localStorage.setItem('by_invlang', I.d.lang); } catch { }
  const df = dateFmt() === 'be' ? 'be' : 'ce';
  const data = { ...I.d, discount: money(I.d.discount) || 0, paid: money(I.d.paid) || 0 };
  try {
    const inv = I.id ? await S.store.updateInvoice(I.id, data, df) : await S.store.createInvoice(data, df);
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
  sheet({ title: `<span dir="ltr">${esc(inv.no)}</span>`, sub: `${esc(c?.name || inv.cust?.name || '')} · ${fmtDay(inv.issue)}`, cls: 'full',
    body: `<section class="inv-sum card">
      <div><small>${t('inv.total')}</small><b class="big">${baht(inv.t?.total || 0)}</b></div>
      <div class="r"><em class="badge s-${esc(inv.status)}">${t('is.' + inv.status)}</em>${inv.status !== 'paid' ? `<small>${t('inv.bal')} ${baht(inv.t?.bal || 0)}</small>` : ''}</div></section>
      <div class="inv-pv-wrap"><div class="inv-pv">${invoiceHtml(inv, S.company || {}, dateFmt() === 'be' ? 'be' : 'ce')}</div></div>
      ${local ? `<p class="note">${icon('info', 16)}<span>${t('inv.localNote')}</span></p>` : `<p class="muted pad">${t('inv.savedIn', { x: FOLDER.pay.th })}</p>`}`,
    foot: `${c ? `<button class="hbtn" data-act="open-customer" data-id="${esc(c.id)}" aria-label="${t('inv.openCustomer')}">${icon('users', 19)}</button>` : ''}
      <button class="hbtn" data-act="inv-edit" data-need="edit" data-id="${esc(id)}" aria-label="${t('inv.editBtn')}">${icon('edit', 19)}</button>
      ${inv.status !== 'paid' ? `<button class="btn" data-act="inv-paid" data-need="edit" data-id="${esc(id)}">${icon('check', 17)}<span>${t('inv.markPaid')}</span></button>` : ''}
      <span class="sp"></span>
      ${local ? `<button class="btn primary" data-act="inv-print" data-id="${esc(id)}">${icon('download', 18)}<span>${t('inv.print')}</span></button>`
        : `<button class="btn primary" data-act="inv-share" id="invShare" disabled>${icon(navigator.share ? 'share' : 'download', 18)}<span>${t(navigator.share ? 'inv.share' : 'inv.download')}</span></button>`}` });
  if (!local) S.store.getBlob(id).then(b => { if (curInv?.id !== id) return; curInv.blob = b; const sb = $('#invShare'); if (sb) sb.disabled = false; }).catch(handleError);
}
function printInvoice(inv) {
  const root = $('#print-root');
  root.innerHTML = `<style>${INVOICE_CSS}</style>${invoiceHtml(inv, S.company || {}, dateFmt() === 'be' ? 'be' : 'ce')}`;
  document.body.classList.add('printing');
  setTimeout(() => { window.print(); setTimeout(() => { document.body.classList.remove('printing'); root.innerHTML = ''; }, 500); }, 300);
}

/* ---------- company settings ---------- */
let CO = null;
async function companySheet() {
  CO = { logo: null, remove: false };
  const co = S.company || await S.store.getSettings();
  S.company = co;
  const ro = !isAdmin(), dis = ro ? 'disabled' : '';
  const f = (k, label, attrs = '') => `<label class="fld"><span class="fl">${label}</span><input name="${k}" value="${esc(co[k] || '')}" ${attrs} ${dis}></label>`;
  const ta = (k, label) => `<label class="fld"><span class="fl">${label}</span><textarea name="${k}" rows="3" ${dis}>${esc(co[k] || '')}</textarea></label>`;
  sheet({ title: t('co.title'), sub: ro ? t('co.subRo') : t('co.sub'), cls: 'full',
    body: `<form class="form" data-form="company" id="coform">
      <div class="logo-row"><span class="logo-box" id="logoBox">${co.logo ? `<img src="${esc(co.logo)}" alt="">` : icon('image', 28)}</span>
        ${ro ? '' : `<div><button type="button" class="btn" data-act="co-logo">${icon('gallery', 17)}<span>${t('co.logo')}</span></button>${co.logo ? `<button type="button" class="btn danger-ghost sm" data-act="co-logo-rm">${t('co.logoRm')}</button>` : ''}</div>`}</div>
      <div class="fgrid">${f('name', t('co.name'), 'maxlength="160"')}${f('nameEn', t('co.nameEn'), 'maxlength="160"')}${f('phone', t('co.phone'), 'inputmode="tel"')}${f('email', t('co.email'), 'type="email"')}${f('taxId', t('co.tax'), 'inputmode="numeric"')}${f('prefix', t('co.prefix'), 'maxlength="8" autocapitalize="characters"')}</div>
      ${ta('address', t('co.address'))}${ta('bank', t('co.bank'))}${ta('footer', t('co.footer'))}
    </form>`,
    foot: ro ? `<span class="sp"></span><button class="btn" data-act="close-sheet">${t('btn.close')}</button>` : `<button type="button" class="btn ghost" data-act="close-sheet">${t('btn.cancel')}</button><button class="btn primary" type="submit" form="coform">${t('btn.save')}</button>` });
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

/* ---------- migration (admin) ---------- */
let MIG = null;
function migrateSheet() {
  MIG = null;
  sheet({ title: t('mig.title'), sub: t('mig.sub'), cls: 'full', body: `<div class="mig"><p class="note">${icon('info', 16)}<span>${t('mig.explain')}</span></p>
    <ul class="mig-names">${FOLDERS.map(F => `<li><b>${F.th}</b><small>${t('fo.' + F.slot)}</small></li>`).join('')}</ul><div id="migOut"></div></div>`,
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
  out.innerHTML = `<section class="card mig-rep">
    <h3>${dry ? t('mig.repDry') : t('mig.repDone')}</h3>
    <div class="mig-k"><div><b>${num(rows.length)}</b><small>${t('mig.kCust')}</small></div><div><b>${num(nCreate)}</b><small>${dry ? t('mig.kCreate') : t('mig.kCreated')}</small></div><div><b>${num(nAdopt)}</b><small>${t('mig.kAdopt')}</small></div><div><b>${num(nLoose)}</b><small>${t('mig.kLoose')}</small></div></div>
    <p class="muted">${t('mig.safe')}</p>
    ${need.length ? `<details ${need.length < 15 ? 'open' : ''}><summary>${t('mig.list', { n: need.length })}</summary><ul class="mig-list">${need.map(r => `<li><b>${esc(r.name)}</b><small>${r.create.length ? t('mig.willCreate', { n: r.create.length }) : ''}${r.adopt.length ? ' · ' + t('mig.willAdopt', { n: r.adopt.length }) : ''}${r.loose ? ' · ' + t('mig.loose', { n: r.loose }) : ''}</small></li>`).join('')}</ul></details>` : `<p>${t('mig.nothing')}</p>`}
  </section>`;
  if (dry && need.length) { btn.dataset.dry = ''; btn.textContent = t('mig.run'); btn.classList.add('danger-solid'); }
  else { btn.dataset.dry = '1'; btn.textContent = t('mig.dry'); btn.classList.remove('danger-solid'); }
  if (!dry) reload().catch(() => { });
}

/* ---------- assistant search ---------- */
function assistantSheet() {
  const chips = [t('a.c1'), t('a.c2'), t('a.c3'), t('a.c5')];
  sheet({ cls: 'full assistant', head: `<header class="sh-head"><div class="as-box">${icon('sparkle', 20)}<input id="asq" type="search" placeholder="${esc(t('a.ph'))}" autocomplete="off"></div><button class="hbtn" data-act="close-sheet" aria-label="${t('btn.close')}">${icon('x', 20)}</button></header>`,
    body: `<div class="chips">${chips.map(c => `<button class="chip" data-act="as-chip">${esc(c)}</button>`).join('')}</div><div class="as-res" id="asRes"><p class="as-tip">${t('a.tip')}</p></div>` });
  setTimeout(() => $('#asq')?.focus(), 350);
}
function drawAsk(q) {
  const el = $('#asRes'); if (!el) return;
  if (!q.trim()) { el.innerHTML = `<p class="as-tip">${t('a.tip')}</p>`; return; }
  const r = ask(q, S);
  el.innerHTML = `<p class="as-ans">${icon('sparkle', 16)}<span>${esc(r.answer)}</span></p>
    ${r.customers.map(c => `<button class="as-row" data-act="open-customer" data-id="${esc(c.id)}"><span class="ava" style="--h:${hue(c.id)}">${esc(initial(c.name))}</span><span><b>${esc(c.name)}</b><small>${c.plate ? esc(c.plate) : ''}</small></span>${icon('chev', 16)}</button>`).join('')}
    ${r.files.map(f => { const c = cust(f.customerId) || { name: '—' }; return `<button class="as-row" data-act="open-file" data-id="${esc(f.id)}">${ftIcon(f, 18)}<span><b>${esc(f.name)}</b><small>${esc(c.name)} · ${typeLabel(f.type)} · ${fmtDay(f.expiry || f.createdAt)}</small></span>${icon('chev', 16)}</button>`; }).join('')}`;
}

/* ---------- team & access (admin) ---------- */
const roleOpts = sel => ['admin', 'editor', 'viewer'].map(r => `<option value="${r}" ${r === sel ? 'selected' : ''}>${t('role.' + r)}</option>`).join('');
function teamSheet() {
  sheet({ title: t('team.title'), sub: t('team.sub'), cls: 'full', body: `
    <form class="team-add" data-form="team-add">
      <input name="email" type="email" required dir="ltr" placeholder="name@gmail.com" aria-label="${t('team.email')}" autocomplete="off">
      <select name="role" aria-label="${t('role.editor')}">${roleOpts('editor')}</select>
      <button class="btn primary">${icon('userplus', 18)}<span>${t('team.add')}</span></button>
    </form>
    <div class="roles">${['admin', 'editor', 'viewer'].map(r => `<span><em class="role-chip r-${r}">${t('role.' + r)}</em>${t('role.' + r + '.d')}</span>`).join('')}</div>
    <div class="team-list" id="teamList"><p class="as-tip"><span class="spin sm"></span>${t('team.loading')}</p></div>` });
  run(async () => drawTeam(await S.store.aclList()));
}
function drawTeam(list) {
  const el = $('#teamList'); if (!el) return;
  const me = S.me?.email;
  el.innerHTML = list.map(p => `
    <div class="team-row">
      <span class="ava" style="--h:${hue(p.email)}">${esc(p.email[0].toUpperCase())}</span>
      <span class="tmain"><b dir="ltr">${esc(p.email)}</b><small>${p.owner ? t('role.owner') : t('role.' + p.role + '.d')}${p.email === me ? ` · ${t('team.you')}` : ''}</small></span>
      ${p.owner ? `<em class="role-chip r-admin">${t('role.owner')}</em>` : `<select data-team-role="${esc(p.email)}" aria-label="${esc(p.email)}">${roleOpts(p.role)}</select>
      <button class="hbtn sm danger" data-act="team-remove" data-email="${esc(p.email)}" aria-label="${t('team.remove')}">${icon('trash', 15)}</button>`}
    </div>`).join('');
}

function changeLang(l) { setLang(l); applyStatic(); sortCustomers(); closeSheet(); mount('fade'); }

/* ================= actions ================= */
const EDIT_ACTS = new Set(['add-file', 'do-upload', 'up-more', 'new-customer', 'edit-customer', 'del-file', 'del-customer', 'ai-new', 'new-invoice', 'inv-save', 'inv-paid', 'inv-edit', 'dup-update', 'dup-apply', 'dup-create', 'pick-customer']);
const ACT = {
  go(el) { go(el.dataset.to); },
  tab(el) { const v = el.dataset.tab; go(v === 'customers' ? 'customers' : v); },
  back() { if (S.pushed && history.length > 1) history.back(); else go('customers'); },
  'open-customer'(el) { closeSheet(); openCustomer(el.dataset.id); },
  filter(el) { S.filter = el.dataset.f; if (S.view !== 'customers') return go('customers'); for (const b of $$('.chip[data-f]')) b.classList.toggle('on', b.dataset.f === S.filter); drawList(); },
  'inv-filter'(el) { S.invFilter = el.dataset.f; for (const b of $$('[data-act="inv-filter"]')) b.classList.toggle('on', b.dataset.f === S.invFilter); drawInvList(); },
  'close-sheet': closeSheet,
  'close-overlay'(el, e) { if (e.target === el) closeSheet(); },
  'confirm-yes'() { const r = confirmRes; confirmRes = null; closeSheet(); r?.(true); },
  add: addSheet,
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
  lang(el) { changeLang(el.dataset.v); },
  datefmt(el) { setDateFmt(el.dataset.v); mount('fade'); },
  reload() { location.reload(); },
  'new-customer'() { customerSheet(); },
  'edit-customer'() { customerSheet(cust(S.cid)); },
  'pick-customer'(el) { pickCustomerSheet(el.dataset.next || 'file'); },
  picked(el) {
    const id = el.dataset.id;
    if (el.dataset.next === 'invoice') return newInvoice(id);
    sourceSheet(files => startUpload(files, id));
  },
  'add-file'(el) {
    const folder = el.dataset.folder || '', cid = S.cid;
    sourceSheet(files => startUpload(files, cid, folder));
  },
  async src(el) {
    const cb = srcCb; if (!cb) return;
    const cam = el.dataset.src === 'cam';
    const files = await pickFiles({ capture: cam, accept: cam ? 'image/*' : cb.accept, multiple: !cam });
    if (files.length) { srcCb = null; cb.onPick(files); }
  },
  async 'up-more'() {
    const files = sizeFilter(await pickFiles({ accept: '' }));
    for (const file of files) U.items.push({ file, name: file.name, folder: '', picked: false, aiFolder: null, type: 'other', expiry: '', ai: aiOn() && readable(file) ? 'wait' : 'skip', n: null, url: isImage({ mime: file.type }) ? objUrl(file) : '', done: false });
    drawUpload(); aiQueue();
  },
  'up-remove'(el) { U.items.splice(+el.closest('.up-row').dataset.i, 1); U.items.length ? drawUpload() : closeSheet(); },
  'do-upload': doUpload,
  'pick-folder'(el) {
    const slot = el.dataset.folder, name = el.dataset.name;
    if (name === 'up') { const it = U.items[+el.dataset.i]; it.folder = slot; it.picked = true; it.type = typeFor(slot, it.n?.docType); if (slot === 'policy' && !it.expiry && it.n?.values.policyExpiry) it.expiry = it.n.values.policyExpiry; drawUpload(); }
    else if (name === 'rv') { R.v = { ...R.v, ...readForm($('#rvform'), ALL_FIELDS) }; R.folder = slot; for (const b of $$('[data-name="rv"]')) { b.classList.toggle('on', b.dataset.folder === slot); b.setAttribute('aria-checked', b.dataset.folder === slot); } }
    else if (name === 'move') return moveCur(slot);
  },
  'ai-new'(el) { if (!el.dataset.src) { closeSheet(); return sourceSheet(files => aiNewFiles(files), { title: t('add.ai'), accept: DOC_ACCEPT }); } return aiNew(el.dataset.src); },
  'ai-retry'() { const r = R; if (!r) return; aiNewFiles(r.files); },
  'ai-manual'() { if (!R) return; R.n = null; R.v = {}; reviewSheet(); },
  'pv-zoom'(el) { window.open(R.previews[+el.dataset.i], '_blank', 'noopener'); },
  'pv-open'(el) { window.open(objUrl(R.files[+el.dataset.i]), '_blank', 'noopener'); },
  'dup-back'() { if (R) reviewSheet(); },
  'dup-create'() { return createFromReview(); },
  'dup-update'(el) { if (R) dupUpdate(el.dataset.id); },
  'dup-apply'(el) { return dupApply(el.dataset.id, el); },
  'open-file'(el) { return openFile(el.dataset.id); },
  'open-link'(el) { window.open(el.dataset.url, '_blank', 'noopener'); },
  'open-root'() { if (S.me?.root) window.open('https://drive.google.com/drive/folders/' + encodeURIComponent(S.me.root), '_blank', 'noopener'); },
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
    await S.store.deleteCustomer(c.id); await reload(); toast(t('t.customerDeleted')); go('customers');
  },
  'new-invoice'() { closeSheet(); newInvoice(S.cid); },
  'inv-tab'(el) { syncInvForm(); I.tab = el.dataset.v; invoiceEditor(); },
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
    const x = await S.store.updateInvoice(inv.id, { paid: inv.t.total }, dateFmt() === 'be' ? 'be' : 'ce');
    await reload(); toast(t('inv.paidDone')); invoiceSheet(x.id);
  },
  'inv-share'() { if (curInv?.blob) return shareBlob(curInv.blob, (S.invoices.find(i => i.id === curInv.id)?.no || 'invoice') + '.pdf'); },
  'inv-print'(el) { const inv = S.invoices.find(i => i.id === el.dataset.id); if (inv) printInvoice(inv); },
  'co-logo'() { return pickLogo(); },
  'co-logo-rm'() { CO.remove = true; CO.logo = null; $('#logoBox').innerHTML = icon('image', 28); },
  'as-chip'(el) { const i = $('#asq'); i.value = el.textContent.trim(); drawAsk(i.value); },
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
function aiNewFiles(files) {
  // same as aiNew, but with files already picked (from the source sheet)
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
        foot: `<button class="btn ghost" data-act="ai-retry">${t('ai.retry')}</button><button class="btn primary" data-act="ai-manual">${t('ai.manualBtn')}</button>` });
      sheetClose = () => { R = null; };
    }
  });
}
async function moveCur(slot) {
  const f = cur?.f; if (!f || f.folder === slot) return;
  if (!await confirmBox(t('fo.moveQ', { x: esc(f.name), y: FOLDER[slot].th }), t('fo.move'), false)) return;
  await S.store.moveFile(f.id, slot);
  await reload(); toast(t('fo.moved', { x: FOLDER[slot].th }));
}
function syncInvForm() {
  // values are kept live by the input handler; nothing else to read
}

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
      if (!isAdmin() && S.mode === 'cloud') return toast(t('err.role'), 'err');
      const s = Object.fromEntries(new FormData(form));
      if (CO.logo) s.logo = CO.logo;
      if (CO.remove) s.removeLogo = true;
      if (btn) btn.disabled = true;
      try { S.company = await S.store.saveSettings(s); closeSheet(); toast(t('co.saved')); }
      finally { if (btn?.isConnected) btn.disabled = false; }
      return;
    }
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
  if (el.id === 'cq') { S.q = el.value; clearTimeout(qT); qT = setTimeout(drawList, 90); }
  else if (el.id === 'iq') { S.invQ = el.value; clearTimeout(qT); qT = setTimeout(drawInvList, 90); }
  else if (el.dataset.teamRole) run(async () => { drawTeam(await S.store.aclSet(el.dataset.teamRole, el.value)); toast(t('team.changed')); });
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

// drag & drop and paste on a customer page (desktop)
let dragN = 0;
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files') && canEdit() && !S.gate && S.view === 'customer';
addEventListener('dragenter', e => { if (hasFiles(e)) { dragN++; $('#drop').classList.add('on'); } });
addEventListener('dragleave', e => { if (hasFiles(e) && --dragN <= 0) { dragN = 0; $('#drop').classList.remove('on'); } });
addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragN = 0; $('#drop').classList.remove('on');
  const sec = e.target.closest?.('[data-folder]');
  startUpload(e.dataTransfer.files, S.cid, sec?.dataset.folder || '');
});
addEventListener('paste', e => { const f = e.clipboardData?.files; if (f?.length && canEdit() && !S.gate && S.view === 'customer' && !e.target.closest('input,textarea')) { e.preventDefault(); startUpload(f, S.cid); } });

addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !S.gate) { e.preventDefault(); assistantSheet(); }
  if (e.key === 'Escape') closeSheet();
});
document.addEventListener('error', e => { const img = e.target; if (img.matches?.('img.th')) img.outerHTML = `<span class="ft">${icon(img.dataset.ic || 'file', 26)}</span>`; }, true);

// Swipe a sheet down to close it (phone)
let drag = null;
document.addEventListener('pointerdown', e => {
  const g = e.target.closest('.sh-grab, .sh-head'); if (!g || e.pointerType === 'mouse' || e.target.closest('button,input')) return;
  const sh = g.closest('.sheet'); drag = { sh, y: e.clientY, dy: 0 };
  sh.style.transition = 'none';
});
document.addEventListener('pointermove', e => { if (!drag) return; drag.dy = Math.max(0, e.clientY - drag.y); drag.sh.style.transform = `translateY(${drag.dy}px)`; });
const endDrag = () => { if (!drag) return; const { sh, dy } = drag; drag = null; sh.style.transition = ''; sh.style.transform = ''; if (dy > 110) closeSheet(); };
document.addEventListener('pointerup', endDrag); document.addEventListener('pointercancel', endDrag);

addEventListener('online', () => document.body.classList.remove('offline'));
addEventListener('offline', () => { document.body.classList.add('offline'); toast(t('err.offline'), 'err'); });

/* ================= start ================= */
{ const st = document.createElement('style'); st.textContent = INVOICE_CSS; document.head.append(st); }
for (const el of $$('[data-ico]')) el.outerHTML = icon(el.dataset.ico, +el.dataset.s || 22);
applyStatic();
if (!navigator.onLine) document.body.classList.add('offline');
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
{ const r = parseHash(); S.view = r.view; S.cid = r.cid; }
mount('fade');
run(connect);
