import { GOOGLE_CLIENT_ID, APP_VERSION } from './config.js';
import { t, num, lang, setLang, applyDir, LANGS } from './i18n.js';
import { $, $$, esc, digits, norm, fmtDate, monthKey, monthName, expAttrs, expValue, parseExp, defaultExp, daysLeft, fmtSize, TYPES, typeLabel, isImage, isPdf, icon, hue, makeThumb } from './util.js';
import { LocalStore } from './store-local.js';
import { DriveStore, loadGis } from './store-drive.js';
import { guessType, guessCustomer, ask } from './assistant.js';
import { seedDemo } from './demo.js';

const S = {
  view: 'dash', customers: [], files: [], sel: null, store: null, gate: false,
  mode: localStorage.getItem('by_mode') || 'local',
  filters: { customer: '', type: '', period: '', q: '' },
  mobileDetail: false,
};
const clientId = () => GOOGLE_CLIENT_ID || localStorage.getItem('by_cid') || '';
const cust = id => S.customers.find(c => c.id === id);
const narrow = () => matchMedia('(max-width: 820px)').matches;
const sortCustomers = () => S.customers.sort((a, b) => a.name.localeCompare(b.name, lang));

/* ================= connect & load ================= */
async function connect() {
  S.gate = false; S.store = null;
  if (S.mode === 'drive') {
    const d = new DriveStore(clientId());
    if (clientId() && d.restore()) {
      try { await d.init(); S.store = d; } catch (e) { if (!e.auth) toast(e.message, 'err'); }
    }
    if (!S.store) { S.gate = true; if (clientId()) loadGis().catch(() => { }); mount(); return; }
  } else {
    const l = new LocalStore();
    await l.init();
    S.store = l;
  }
  await reload(true);
}

async function reload(remount = false) {
  const { customers, files } = await S.store.loadAll();
  S.customers = customers; sortCustomers();
  S.files = files.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!cust(S.sel)) S.sel = S.customers[0]?.id || null;
  if (S.filters.customer && !cust(S.filters.customer)) S.filters.customer = '';
  S.quota = await S.store.quota().catch(() => null);
  if (remount) mount(); else drawAll(false);
}

async function run(fn) {
  try { await fn(); }
  catch (e) {
    console.error(e);
    if (e.auth) { S.gate = true; closeSheet(); mount(); }
    toast(e.message || t('err.generic'), 'err');
  }
}

/* ================= filters ================= */
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
const activeFilters = () => Object.values(S.filters).filter(Boolean).length;
const noFilters = () => ({ customer: '', type: '', period: '', q: '' });

/* ================= views ================= */
const titleRow = (k, actions = '') => `<section class="title-row"><div><h1>${t(k + '.title')}</h1><p>${t(k + '.sub')}</p></div>${actions ? `<div class="title-actions">${actions}</div>` : ''}</section>`;
const addBtn = () => `<button class="btn primary" data-act="upload">${icon('plus')}<span>${t('btn.addFile')}</span></button>`;
const VIEWS = {
  dash: () => `${titleRow('dash', `<button class="btn ghost" data-act="new-customer">${icon('userplus')}<span>${t('btn.newCustomer')}</span></button>${addBtn()}`)}
    <section class="stats" id="stats"></section>
    <section class="filters" id="filters"></section>
    <section class="panel" id="panel"></section>`,
  files: () => `${titleRow('files', `<button class="btn ghost" data-act="camera">${icon('camera')}<span>${t('btn.camera')}</span></button>${addBtn()}`)}
    <section class="filters" id="filters"></section>
    <section class="grid" id="grid"></section>`,
  exp: () => `${titleRow('exp')}
    <section class="filters" id="filters"></section>
    <section class="explist" id="explist"></section>`,
};

let enterT;
function mount() {
  const v = $('#view');
  v.innerHTML = S.gate ? gateHtml() : VIEWS[S.view]();
  v.className = 'enter';
  if (!S.gate) drawAll(true);
  syncChrome();
  clearTimeout(enterT);
  enterT = setTimeout(() => v.classList.remove('enter'), 1700);
}
function drawAll(anim) {
  if (S.gate) return;
  drawStats(anim); drawFilters(true); drawResults(anim);
  syncChrome();
}
function drawResults(anim) {
  if (S.view === 'dash') drawPanel(anim);
  if (S.view === 'files') drawGrid();
  if (S.view === 'exp') drawExp();
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
  const drive = S.store?.kind === 'drive';
  $('#storeLbl').textContent = S.gate ? t('store.off') : drive ? 'Drive' : t('store.local');
  $('#storeDot').className = 'dot ' + (S.gate ? 'warn' : drive ? 'ok' : '');
}

function gateHtml() {
  const has = !!clientId();
  return `<section class="gate card">
    <div class="gate-ico">${icon('cloud', 40)}</div>
    <h1>${t('gate.title')}</h1>
    <p>${t(has ? 'gate.has' : 'gate.no')}</p>
    <div class="gate-actions">
      ${has ? `<button class="btn primary big" data-act="drive-connect">${icon('cloud')}<span>${t('gate.signin')}</span></button>` : `<button class="btn primary big" data-act="settings">${icon('sliders')}<span>${t('gate.settings')}</span></button>`}
      <button class="btn ghost" data-act="mode-local">${t('gate.local')}</button>
    </div>
  </section>`;
}

/* ---------- stat cards ---------- */
function drawStats(anim) {
  const el = $('#stats'); if (!el) return;
  const soon = S.files.filter(f => f.expiry && daysLeft(f.expiry) <= 30);
  const expired = soon.filter(f => daysLeft(f.expiry) < 0).length;

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
  const drive = S.store.kind === 'drive';
  const qLine = drive && S.quota?.limit ? t('s4.quota', { a: fmtSize(S.quota.used), b: fmtSize(S.quota.limit) }) : t(drive ? 's4.drive' : 's4.local');
  const big = n => `<b ${anim ? `data-count="${n}"` : ''}>${num(anim ? 0 : n)}</b>`;

  el.innerHTML = `
  <article class="card tilt c-exp" data-act="go" data-view="exp" style="--i:0">
    <header><span>${t('s1.title')}</span><i class="badge-ico ${soon.length ? 'warn' : 'ok'}">${icon(soon.length ? 'alert' : 'check', 15)}</i></header>
    <div class="big">${big(soon.length)}<small>${t('s1.unit')}</small></div>
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

  <article class="card tilt" data-act="new-customer" style="--i:2">
    <header><span>${t('s3.title')}</span><i class="badge-ico">${icon('users', 15)}</i></header>
    <div class="big">${big(S.customers.length)}<small>${t('s3.unit')}</small></div>
    <p class="delta good">${newC ? t('s3.new', { n: newC }) : t('s3.tap')}</p>
    <svg class="spark" viewBox="0 0 200 70"><defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6a4df5" stop-opacity=".28"/><stop offset="1" stop-color="#6a4df5" stop-opacity="0"/></linearGradient></defs>
      <path class="area" d="${line} L192 70 L8 70 Z" fill="url(#sg)"/><path class="ln" d="${line}" pathLength="1"/>
      ${xy.map((p, i) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${i === 7 ? 4 : 2.6}" style="--i:${i}"/>`).join('')}</svg>
  </article>

  <article class="card tilt c-store" style="--i:3">
    <header><span>${t('s4.title')}</span><button class="mini-btn" data-act="${drive ? 'open-root' : 'settings'}" title="${t(drive ? 's4.openRoot' : 's4.storage')}">${icon('arrow', 16)}</button></header>
    <div class="big"><b class="sz">${fmtSize(bytes)}</b></div>
    <p class="delta">${qLine}</p>
    <div class="kinds">
      <div><b>${num(nPdf)}</b><small>PDF</small></div>
      <div class="hi"><b>${num(nImg)}</b><small>${t('kind.photo')}</small></div>
      <div><b>${num(nOther)}</b><small>${t('kind.other')}</small></div>
      <button class="btn dark" data-act="upload">${t('btn.quick')}</button>
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
  const F = S.filters, opt = (v, l, cur) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(l)}</option>`;
  el.innerHTML = `
    <div class="f-label">${t('f.active')} <b class="f-count">${num(activeFilters())}</b>${activeFilters() ? `<button class="link" data-act="clear-filters">${t('f.clear')}</button>` : ''}</div>
    <label class="f"><select data-f="customer">${opt('', t('f.allCustomers'), F.customer)}${S.customers.map(c => opt(c.id, c.name, F.customer)).join('')}</select></label>
    ${S.view === 'exp' ? '' : `<label class="f"><select data-f="type">${opt('', t('f.allTypes'), F.type)}${Object.keys(TYPES).map(k => opt(k, typeLabel(k), F.type)).join('')}</select></label>
    <label class="f"><select data-f="period">${opt('', t('f.allTime'), F.period)}${[7, 30, 90, 365].map(d => opt(d, t('f.d' + d), F.period)).join('')}</select></label>`}
    <label class="f grow search">${icon('search', 18)}<input data-f="q" type="search" placeholder="${t('f.search')}" value="${esc(F.q)}" autocomplete="off"></label>`;
}

/* ---------- dark panel: customers + case file ---------- */
function ftBadge(f, size = 26, cls = '') {
  return `<span class="ft ${cls} ${isPdf(f) ? 'pdf' : ''}">${isPdf(f) ? 'PDF' : icon(isImage(f) ? 'image' : (TYPES[f.type] || TYPES.other).icon, size)}</span>`;
}
function fileTile(f, i, light = false) {
  const ty = TYPES[f.type] || TYPES.other, c = light ? cust(f.customerId) : null;
  const left = f.expiry ? daysLeft(f.expiry) : null;
  return `<button class="tile" data-act="open-file" data-id="${esc(f.id)}" style="--i:${Math.min(i, 14)}">
    <span class="thumb">${f.thumb ? `<img class="th" src="${esc(f.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-ic="${ty.icon}">` : ftBadge(f)}
      ${left !== null && left <= 30 ? `<em class="flag ${left < 0 ? 'bad' : 'warn'}">${left < 0 ? t('flag.expired') : t('flag.days', { n: left })}</em>` : ''}</span>
    <b>${esc(f.name)}</b>
    <small>${c ? esc(c.name) + ' · ' : ''}${typeLabel(f.type)} · ${fmtDate(f.createdAt, false)}</small>
  </button>`;
}

function drawPanel(anim) {
  const el = $('#panel'); if (!el) return;
  if (!S.customers.length) {
    el.innerHTML = `<div class="empty dark">
      <div class="gate-ico">${icon('users', 34)}</div><h3>${t('p.empty.title')}</h3>
      <p>${t('p.empty.text')}</p>
      <div class="gate-actions"><button class="btn white" data-act="new-customer">${icon('userplus')}<span>${t('p.empty.first')}</span></button>
      ${S.store.kind === 'local' ? `<button class="btn glassy" data-act="seed">${t('p.empty.demo')}</button>` : ''}</div></div>`;
    return;
  }
  const q = norm(S.filters.q), hay = c => norm(`${c.name} ${c.plate} ${c.phone} ${c.car}`);
  const list = S.customers.filter(c => !q || hay(c).includes(q) || S.files.some(f => f.customerId === c.id && matchFile(f, { skipCustomer: true })));
  if (list.length && !list.some(c => c.id === S.sel)) S.sel = list[0].id;
  const c = cust(S.sel);
  const mine = S.files.filter(f => f.customerId === S.sel);
  const ownMatch = c && q && hay(c).includes(q);
  const base = mine.filter(f => ownMatch ? (!S.filters.period || Date.now() - new Date(f.createdAt) <= S.filters.period * 864e5) : matchFile(f, { skipCustomer: true, skipType: true }));
  const shown = base.filter(f => !S.filters.type || f.type === S.filters.type);
  const tabs = [['', t('p.all'), base.length], ...Object.keys(TYPES).map(k => [k, typeLabel(k), base.filter(f => f.type === k).length])].filter((x, i) => i === 0 || x[2] || x[0] === S.filters.type);
  const nextExp = mine.filter(f => f.expiry).sort((a, b) => a.expiry.localeCompare(b.expiry))[0];

  el.innerHTML = `
  <header class="panel-head">
    <h3>${t('p.customers')} <span>${num(list.length)}</span></h3>
    <div class="tabs">${tabs.map(([k, l, n]) => `<button class="${S.filters.type === k ? 'on' : ''}" data-act="tab" data-type="${k}">${l}<i>${num(n)}</i></button>`).join('')}</div>
    <button class="icon-btn onDark" data-act="new-customer" title="${t('btn.newCustomer')}">${icon('userplus', 18)}</button>
  </header>
  <div class="panel-body ${S.mobileDetail ? 'show-detail' : ''}">
    <ul class="clist">${list.map((x, i) => {
      const n = S.files.filter(f => f.customerId === x.id).length;
      const e = S.files.some(f => f.customerId === x.id && f.expiry && daysLeft(f.expiry) <= 30);
      return `<li><button class="citem ${x.id === S.sel ? 'on' : ''}" data-act="select" data-id="${esc(x.id)}" style="--i:${Math.min(i, 12)}">
        <span class="ava" style="--h:${hue(x.id)}">${esc(x.name.trim()[0] || '?')}</span>
        <span class="cmain"><b>${esc(x.name)}</b><small>${esc(x.plate || x.car || x.phone || t('p.noinfo'))}</small></span>
        ${e ? `<em class="pill warn">${t('p.renew')}</em>` : ''}<em class="pill">${t('p.nfiles', { n })}</em></button></li>`;
    }).join('') || `<li class="none">${t('p.nomatch')}</li>`}</ul>
    <div class="detail ${anim ? 'anim' : ''}" id="detail">${c ? `
      <div class="dcard" data-customer="${esc(c.id)}">
        <header>
          <button class="icon-btn glassy back" data-act="back" title="${t('btn.back')}">${icon('chev', 18)}</button>
          <div class="dname"><small>${t('p.file')}</small><h2>${esc(c.name)}</h2></div>
          <div class="dmeta">${c.plate ? `<span>${icon('car', 15)}${esc(c.plate)}</span>` : ''}${c.car ? `<span>${esc(c.car)}</span>` : ''}${c.phone ? `<a href="tel:${esc(c.phone)}">${icon('phone', 15)}<bdi>${esc(digits(c.phone))}</bdi></a>` : ''}</div>
          <button class="icon-btn glassy" data-act="edit-customer" title="${t('p.edit')}">${icon('edit', 17)}</button>
        </header>
        <div class="tiles">
          ${shown.map((f, i) => fileTile(f, i)).join('')}
          <button class="tile add" data-act="upload" style="--i:${Math.min(shown.length, 14)}">${icon('plus', 22)}<b>${t('btn.addFile')}</b><small>${t('p.drop')}</small></button>
        </div>
        <footer>
          <div><small>${t('p.total')}</small><b>${num(mine.length)}</b></div>
          <div><small>${t('p.size')}</small><b>${fmtSize(mine.reduce((a, f) => a + (f.size || 0), 0))}</b></div>
          <div><small>${t('p.next')}</small><b>${nextExp ? fmtDate(nextExp.expiry) : '—'}</b></div>
          <span class="sp"></span>
          ${c.link ? `<button class="icon-btn glassy" data-act="open-link" data-url="${esc(c.link)}" title="${t('p.openFolder')}">${icon('external', 17)}</button>` : ''}
          <button class="icon-btn glassy" data-act="camera" title="${t('btn.camera')}">${icon('camera', 17)}</button>
          <button class="btn white" data-act="upload">${icon('plus', 18)}<span>${t('btn.upload')}</span></button>
        </footer>
      </div>` : `<div class="empty dark"><p>${t('p.pick')}</p></div>`}
    </div>
  </div>`;
}

/* ---------- all files ---------- */
function drawGrid() {
  const el = $('#grid'); if (!el) return;
  const list = S.files.filter(f => matchFile(f)), k = S.files.length ? 'g.none' : 'g.empty';
  el.innerHTML = list.length ? list.map((f, i) => fileTile(f, i, true)).join('')
    : `<div class="empty"><div class="gate-ico">${icon('folder', 34)}</div><h3>${t(k)}</h3><p>${t(k + '.text')}</p></div>`;
}

/* ---------- renewals ---------- */
function drawExp() {
  const el = $('#explist'); if (!el) return;
  const list = S.files.filter(f => f.expiry && matchFile(f, { skipType: true })).sort((a, b) => a.expiry.localeCompare(b.expiry));
  el.innerHTML = list.length ? list.map((f, i) => {
    const d = daysLeft(f.expiry), c = cust(f.customerId) || { name: '—' };
    const st = d < 0 ? ['bad', t('e.past', { n: -d })] : d === 0 ? ['bad', t('e.today')] : [d <= 30 ? 'warn' : 'ok', t('e.left', { n: d })];
    return `<div class="erow card" style="--i:${Math.min(i, 14)}">
      <span class="ava" style="--h:${hue(c.id || '')}">${esc(c.name.trim()[0] || '?')}</span>
      <button class="emain" data-act="open-file" data-id="${esc(f.id)}"><b>${esc(c.name)}</b><small>${esc(f.name)}${c.plate ? ' · ' + esc(c.plate) : ''}</small></button>
      <span class="edate"><small>${t('e.expiry')}</small><b>${fmtDate(f.expiry)}</b></span>
      <em class="pill st ${st[0]}">${st[1]}</em>
      ${c.phone ? `<a class="icon-btn" href="tel:${esc(c.phone)}" title="${esc(t('e.call', { x: c.name }))}">${icon('phone', 17)}</a>` : ''}
    </div>`;
  }).join('') : `<div class="empty"><div class="gate-ico">${icon('clock', 34)}</div><h3>${t('e.empty')}</h3><p>${t('e.empty.text')}</p></div>`;
}

/* ================= sheets ================= */
let urls = [], confirmRes = null;
function sheet(html, cls = '') {
  const root = $('#sheet-root');
  root.innerHTML = `<div class="overlay" data-act="close-overlay"><div class="sheet ${cls}" role="dialog" aria-modal="true"><i class="grab"></i>${html}</div></div>`;
  requestAnimationFrame(() => requestAnimationFrame(() => root.firstElementChild?.classList.add('in')));
}
function closeSheet() {
  const o = $('#sheet-root .overlay');
  if (confirmRes) { confirmRes(false); confirmRes = null; }
  if (!o) return;
  o.classList.remove('in');
  setTimeout(() => { if (o.isConnected) o.remove(); }, 320);
  urls.forEach(u => URL.revokeObjectURL(u)); urls = [];
}
const head = (title, sub = '') => `<header class="sh-head"><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div><button class="icon-btn" data-act="close-sheet" aria-label="${t('btn.close')}">${icon('x', 18)}</button></header>`;

/** `text` is HTML: escape any user-supplied parts before passing it in */
function confirmBox(text, ok = t('btn.delete')) {
  return new Promise(res => {
    sheet(`${head(t('sure'))}<p class="sh-text">${text}</p><div class="sh-actions"><button class="btn ghost" data-act="close-sheet">${t('btn.cancel')}</button><button class="btn danger" data-act="confirm-yes">${ok}</button></div>`, 'small');
    confirmRes = res;
  });
}

let toastT;
function toast(msg, kind = '') {
  const r = $('#toast-root');
  r.innerHTML = `<div class="toast ${kind}">${icon(kind === 'err' ? 'alert' : 'check', 17)}<span>${esc(msg)}</span></div>`;
  clearTimeout(toastT);
  toastT = setTimeout(() => r.firstElementChild?.classList.add('out'), 3400);
}

/* ---------- customer ---------- */
function customerSheet(c = {}) {
  sheet(`${head(t(c.id ? 'c.edit' : 'c.new'), t('c.sub'))}
  <form class="form" data-form="customer" data-id="${esc(c.id || '')}">
    <label>${t('c.name')}<input name="name" required value="${esc(c.name || '')}" placeholder="${t('c.name.ph')}" autocomplete="off"></label>
    <div class="two">
      <label>${t('c.phone')}<input name="phone" inputmode="tel" dir="ltr" value="${esc(c.phone || '')}"></label>
      <label>${t('c.plate')}<input name="plate" value="${esc(c.plate || '')}" placeholder="${t('c.plate.ph')}"></label>
    </div>
    <label>${t('c.car')}<input name="car" value="${esc(c.car || '')}" placeholder="${t('c.car.ph')}"></label>
    <div class="sh-actions">${c.id ? `<button type="button" class="btn danger-ghost" data-act="del-customer" data-id="${esc(c.id)}">${icon('trash', 17)}<span>${t('c.delete')}</span></button><span class="sp"></span>` : ''}
      <button type="button" class="btn ghost" data-act="close-sheet">${t('btn.cancel')}</button><button class="btn primary">${t('btn.save')}</button></div>
  </form>`);
  setTimeout(() => $('#sheet-root input[name=name]')?.focus(), 350);
}

/* ---------- upload ---------- */
let U = [];
function pending(file, fallbackCustomer, fallbackName = '') {
  const g = guessCustomer(file.name, S.customers), type = guessType(file.name);
  return {
    file, name: file.name, type, customerId: g?.id || fallbackCustomer || '__new', newName: fallbackName, expiry: type === 'policy' ? defaultExp() : '', p: 0,
    hint: [type !== 'other' ? t('u.hint.type', { x: typeLabel(type) }) : '', g ? t('u.hint.cust', { x: g.name }) : ''].filter(Boolean).join(' · '),
  };
}
async function startUpload(fileList) {
  const files = [...fileList].filter(f => f.size > 0);
  if (!files.length) return;
  if (S.gate || !S.store) return toast(t('u.connect'), 'err');
  const def = S.view === 'dash' ? S.sel : S.filters.customer || S.sel;
  U = files.map(f => pending(f, def));
  sheet(`${head(t('u.title'), t('u.sub'))}
    <div class="up-list" id="upList"></div>
    <div class="sh-actions"><button class="btn ghost" data-act="pick-more">${icon('plus', 17)}<span>${t('u.more')}</span></button><span class="sp"></span>
    <button class="btn ghost" data-act="close-sheet">${t('btn.cancel')}</button><button class="btn primary" data-act="do-upload" id="upGo"></button></div>`, 'wide');
  drawUpload();
}
function drawUpload() {
  const el = $('#upList'); if (!el) return;
  el.innerHTML = U.map((u, i) => `
    <div class="up-row" data-i="${i}" style="--i:${Math.min(i, 8)}">
      ${ftBadge({ mime: u.file.type, name: u.name, type: u.type }, 24)}
      <div class="up-main">
        <div class="up-top"><input data-u="name" value="${esc(u.name)}" aria-label="${t('u.fileName')}"><small>${fmtSize(u.file.size)}</small>
          <button class="icon-btn sm" data-act="up-remove" aria-label="${t('u.remove')}">${icon('x', 15)}</button></div>
        <div class="up-fields">
          <select data-u="customerId" aria-label="${t('u.customer')}">${S.customers.map(c => `<option value="${esc(c.id)}" ${c.id === u.customerId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}<option value="__new" ${u.customerId === '__new' ? 'selected' : ''}>${t('u.newCustomer')}</option></select>
          ${u.customerId === '__new' ? `<input data-u="newName" value="${esc(u.newName)}" placeholder="${t('u.newName')}">` : ''}
          <select data-u="type" aria-label="${t('fl.type')}">${Object.keys(TYPES).map(k => `<option value="${k}" ${k === u.type ? 'selected' : ''}>${typeLabel(k)}</option>`).join('')}</select>
          ${u.type === 'policy' ? `<input data-u="expiry" ${expAttrs()} value="${esc(u.expiry)}" placeholder="${t('u.expiry')}" title="${t('e.expiry')}" aria-label="${t('e.expiry')}">` : ''}
        </div>
        ${u.hint ? `<small class="hint">${icon('sparkle', 13)} ${t('u.hint')}: ${esc(u.hint)}</small>` : ''}
        <div class="prog"><i style="width:${u.p * 100}%"></i></div>
      </div>
    </div>`).join('');
  const go = $('#upGo'); if (go) go.textContent = t('u.save', { n: U.length });
}
async function doUpload(btn) {
  for (const u of U) {
    if (u.customerId === '__new' && !u.newName.trim()) return toast(t('u.needName'), 'err');
    if (u.type === 'policy' && u.expiry.trim() && !parseExp(u.expiry.trim())) return toast(t('u.badDate'), 'err');
  }
  btn.disabled = true; btn.textContent = t('u.saving');
  const created = {};
  let done = 0, last = null;
  try {
    for (const [i, u] of U.entries()) {
      if (u.p === 1) continue;
      let cid = u.customerId;
      if (cid === '__new') {
        const nm = u.newName.trim();
        created[nm] ||= (S.customers.find(c => norm(c.name) === norm(nm)) || await S.store.saveCustomer({ name: nm })).id;
        cid = created[nm];
      }
      const meta = { name: u.name.trim() || u.file.name, customerId: cid, type: u.type, expiry: u.type === 'policy' ? parseExp(u.expiry.trim()) || '' : '', note: '' };
      if (S.store.kind === 'local') meta.thumb = await makeThumb(u.file);
      const bar = $(`.up-row[data-i="${i}"] .prog i`);
      await S.store.addFile(u.file, meta, p => { if (bar) bar.style.width = p * 100 + '%'; });
      u.p = 1; done++; last = cid;
    }
  } finally {
    if (done) { if (last) S.sel = last; await reload(); }
    btn.disabled = false; drawUpload();
  }
  closeSheet();
  toast(t('u.done', { n: done }));
  if (S.view === 'dash' && narrow()) { S.mobileDetail = true; drawPanel(true); }
}

/* ---------- file preview & edit ---------- */
let cur = null;
async function openFile(id) {
  const f = S.files.find(x => x.id === id); if (!f) return;
  const c = cust(f.customerId) || { name: '—' };
  cur = { f, blob: null, url: '' };
  sheet(`${head(esc(f.name), `${esc(c.name)} · ${fmtSize(f.size)} · ${fmtDate(f.createdAt)}`)}
    <div class="preview" id="preview"><div class="spin"></div></div>
    <form class="form" data-form="file" data-id="${esc(f.id)}">
      <label>${t('u.fileName')}<input name="name" value="${esc(f.name)}" required></label>
      <div class="two">
        <label>${t('fl.type')}<select name="type">${Object.keys(TYPES).map(k => `<option value="${k}" ${k === f.type ? 'selected' : ''}>${typeLabel(k)}</option>`).join('')}</select></label>
        <label>${t('fl.expiry')}<input name="expiry" ${expAttrs()} value="${expValue(f.expiry)}"></label>
      </div>
      <label>${t('fl.note')}<input name="note" value="${esc(f.note || '')}" placeholder="${t('fl.note.ph')}"></label>
      <div class="sh-actions">
        <button type="button" class="icon-btn danger" data-act="del-file" data-id="${esc(f.id)}" title="${t('btn.delete')}">${icon('trash', 17)}</button>
        <button type="button" class="icon-btn" data-act="dl-file" title="${t('fl.download')}">${icon('download', 17)}</button>
        ${navigator.share ? `<button type="button" class="icon-btn" data-act="share-file" title="${t('fl.share')}">${icon('share', 17)}</button>` : ''}
        ${f.link ? `<button type="button" class="icon-btn" data-act="open-link" data-url="${esc(f.link)}" title="${t('fl.openDrive')}">${icon('external', 17)}</button>` : ''}
        <span class="sp"></span><button class="btn primary">${t('fl.saveChanges')}</button>
      </div>
    </form>`, 'wide');
  const blob = await S.store.getBlob(id);
  if (cur?.f.id !== id) return;
  const pv = $('#preview'); if (!pv) return;
  if (!blob) { pv.innerHTML = `<p class="sh-text">${t('fl.noContent')}</p>`; return; }
  cur.blob = blob; cur.url = URL.createObjectURL(blob); urls.push(cur.url);
  pv.innerHTML = isImage(f) ? `<img src="${cur.url}" alt="${esc(f.name)}">`
    : isPdf(f) ? `<iframe src="${cur.url}#toolbar=0" title="${esc(f.name)}"></iframe><button class="btn dark open-full" data-act="open-link" data-url="${cur.url}">${icon('external', 16)}<span>${t('fl.full')}</span></button>`
      : `<div class="nopv">${ftBadge(f, 30)}<p>${t('fl.noPreview')}</p></div>`;
}

/* ---------- assistant ---------- */
function assistantSheet() {
  const first = S.customers[0]?.name;
  const chips = [t('a.c1'), t('a.c2'), t('a.c3'), first ? t('a.c4', { x: first }) : '', t('a.c5'), t('a.c6')].filter(Boolean);
  sheet(`<div class="as-box">${icon('sparkle', 22)}<input id="asq" type="search" placeholder="${esc(t('a.ph'))}" autocomplete="off"><button class="icon-btn" data-act="close-sheet" aria-label="${t('btn.close')}">${icon('x', 18)}</button></div>
    <div class="chips">${chips.map(c => `<button data-act="as-chip">${esc(c)}</button>`).join('')}</div>
    <div class="as-res" id="asRes"><p class="as-tip">${t('a.tip')}</p></div>`, 'wide assistant');
  setTimeout(() => $('#asq')?.focus(), 350);
}
function drawAsk(q) {
  const el = $('#asRes'); if (!el) return;
  if (!q.trim()) { el.innerHTML = `<p class="as-tip">${t('a.tip')}</p>`; return; }
  const r = ask(q, S);
  el.innerHTML = `<p class="as-ans">${icon('sparkle', 16)}<span>${esc(r.answer)}</span></p>
    ${r.action ? `<button class="btn primary" data-act="as-new" data-name="${esc(r.action.name)}">${icon('userplus', 18)}<span>${t('a.create', { x: esc(r.action.name) })}</span></button>` : ''}
    ${r.customers.map(c => `<button class="as-row" data-act="as-customer" data-id="${esc(c.id)}"><span class="ava" style="--h:${hue(c.id)}">${esc(c.name.trim()[0] || '?')}</span><span><b>${esc(c.name)}</b><small>${t('a.open')}${c.plate ? ' · ' + esc(c.plate) : ''}</small></span>${icon('chev', 16)}</button>`).join('')}
    ${r.files.map(f => { const c = cust(f.customerId) || { name: '—' }; return `<button class="as-row" data-act="open-file" data-id="${esc(f.id)}">${ftBadge(f, 18, 'sm')}<span><b>${esc(f.name)}</b><small>${esc(c.name)} · ${typeLabel(f.type)} · ${f.expiry ? t('e.expiry') + ' ' + fmtDate(f.expiry) : fmtDate(f.createdAt)}</small></span>${icon('chev', 16)}</button>`; }).join('')}`;
}

/* ---------- settings ---------- */
function settingsSheet() {
  const drive = S.store?.kind === 'drive', cid = clientId();
  if (cid) loadGis().catch(() => { });
  sheet(`${head(t('settings'), t('set.sub'))}
    <div class="set">
      <div class="seg" role="group" aria-label="${t('set.lang')}">${Object.entries(LANGS).map(([k, l]) => `<button class="${k === lang ? 'on' : ''}" data-act="lang" data-l="${k}">${l}</button>`).join('')}</div>
      <div class="set-card ${drive ? 'on' : ''}">
        <div class="set-h">${icon('cloud', 22)}<div><b>Google Drive</b><small>${drive ? t('set.drive.on', { x: esc(S.store.user?.emailAddress || '') }) : t('set.drive.off')}</small></div></div>
        ${GOOGLE_CLIENT_ID ? '' : `<label class="cid">${t('set.cid')}<input id="cid" dir="ltr" value="${esc(cid)}" placeholder="xxxxxxxx.apps.googleusercontent.com" autocomplete="off"><small>${t('set.cid.help')}</small></label>`}
        <div class="sh-actions">${drive ? `<button class="btn ghost" data-act="open-root">${icon('external', 17)}<span>${t('set.folder')}</span></button><span class="sp"></span><button class="btn danger-ghost" data-act="drive-disconnect">${t('set.disconnect')}</button>` : `<span class="sp"></span><button class="btn primary" data-act="drive-connect">${icon('cloud', 18)}<span>${t('set.connect')}</span></button>`}</div>
      </div>
      <div class="set-card ${!drive && !S.gate ? 'on' : ''}">
        <div class="set-h">${icon('folder', 22)}<div><b>${t('set.local')}</b><small>${t('set.local.text')}</small></div></div>
        <div class="sh-actions">${!drive && !S.gate ? `<button class="btn ghost" data-act="seed">${t('set.seed')}</button><button class="btn danger-ghost" data-act="wipe">${t('set.wipe')}</button>` : `<span class="sp"></span><button class="btn ghost" data-act="mode-local">${t('set.use')}</button>`}</div>
      </div>
      <p class="ver">${t('set.ver', { v: digits(APP_VERSION) })}</p>
    </div>`, 'wide');
}

function changeLang(l) {
  setLang(l); applyStatic(); sortCustomers(); closeSheet(); mount();
}

/* ================= actions ================= */
const ACT = {
  go(el) { S.view = el.dataset.view; S.mobileDetail = false; if (S.view === 'exp') S.filters.type = ''; mount(); scrollTo({ top: 0, behavior: 'smooth' }); },
  'close-sheet': closeSheet,
  'close-overlay'(el, e) { if (e.target === el) closeSheet(); },
  'confirm-yes'() { const r = confirmRes; confirmRes = null; closeSheet(); r?.(true); },
  settings: settingsSheet,
  assistant: assistantSheet,
  lang(el) { changeLang(el.dataset.l); },
  upload() { $('#pick').click(); },
  camera() { $('#cam').click(); },
  'pick-more'() { $('#pick').dataset.more = '1'; $('#pick').click(); },
  'new-customer'() { customerSheet(); },
  'edit-customer'() { customerSheet(cust(S.sel)); },
  select(el) { S.sel = el.dataset.id; S.mobileDetail = true; drawPanel(true); if (narrow()) $('#panel').scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  back() { S.mobileDetail = false; drawPanel(false); },
  tab(el) { S.filters.type = el.dataset.type; drawFilters(); drawPanel(true); },
  'clear-filters'() { S.filters = noFilters(); drawFilters(true); drawResults(true); },
  'open-file'(el) { return openFile(el.dataset.id); },
  'open-link'(el) { window.open(el.dataset.url, '_blank', 'noopener'); },
  'open-root'() { if (S.store?.rootLink) window.open(S.store.rootLink, '_blank', 'noopener'); },
  'up-remove'(el) { U.splice(+el.closest('.up-row').dataset.i, 1); U.length ? drawUpload() : closeSheet(); },
  'do-upload': doUpload,
  'dl-file'() { if (!cur?.url) return; const a = document.createElement('a'); a.href = cur.url; a.download = cur.f.name; a.click(); },
  async 'share-file'() {
    if (!cur?.blob) return;
    const file = new File([cur.blob], cur.f.name, { type: cur.blob.type });
    try {
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: cur.f.name });
      else if (cur.f.link) await navigator.share({ title: cur.f.name, url: cur.f.link });
      else toast(t('t.noShare'), 'err');
    } catch (e) { if (e.name !== 'AbortError') throw e; }
  },
  async 'del-file'(el) {
    const f = S.files.find(x => x.id === el.dataset.id);
    if (!await confirmBox(t('del.file', { x: esc(f.name) }) + t(S.store.kind === 'drive' ? 'del.drive' : 'del.local'))) return;
    await S.store.deleteFile(f.id); await reload(); toast(t('t.fileDeleted'));
  },
  async 'del-customer'(el) {
    const c = cust(el.dataset.id), n = S.files.filter(f => f.customerId === c.id).length;
    if (!await confirmBox((n ? t('del.customerN', { x: esc(c.name), n }) : t('del.customer', { x: esc(c.name) })) + t(S.store.kind === 'drive' ? 'del.drive' : 'del.local'))) return;
    await S.store.deleteCustomer(c.id); S.mobileDetail = false; await reload(); toast(t('t.customerDeleted'));
  },
  'as-chip'(el) { const i = $('#asq'), more = el.textContent.includes('…'); i.value = el.textContent.replace('…', '').trim() + (more ? ' ' : ''); i.focus(); drawAsk(more ? '' : i.value); },
  'as-new'(el) { customerSheet({ name: el.dataset.name }); },
  'as-customer'(el) { closeSheet(); S.sel = el.dataset.id; S.view = 'dash'; S.mobileDetail = true; S.filters = noFilters(); mount(); $('#panel')?.scrollIntoView({ behavior: 'smooth' }); },
  async seed() { closeSheet(); await seedDemo(S.store, lang); await reload(true); toast(t('t.seeded')); },
  async wipe() {
    if (!await confirmBox(t('wipe.q'), t('wipe.ok'))) return;
    for (const c of S.customers) await S.store.deleteCustomer(c.id);
    await reload(true); toast(t('t.wiped'));
  },
  async 'mode-local'() { S.mode = 'local'; localStorage.setItem('by_mode', 'local'); closeSheet(); await connect(); },
  async 'drive-connect'() {
    const inp = $('#cid');
    if (inp) { const v = inp.value.trim(); if (v) localStorage.setItem('by_cid', v); else localStorage.removeItem('by_cid'); }
    const cid = clientId();
    if (!cid) return toast(t('t.needCid'), 'err');
    if (!/\.apps\.googleusercontent\.com$/.test(cid)) return toast(t('t.badCid'), 'err');
    const d = new DriveStore(cid);
    await d.signIn();
    await d.init();
    S.mode = 'drive'; localStorage.setItem('by_mode', 'drive');
    S.store = d; S.gate = false; S.sel = null;
    closeSheet(); await reload(true);
    toast(t('t.connected', { x: d.user?.emailAddress || '' }));
  },
  async 'drive-disconnect'() { S.store?.signOut?.(); S.mode = 'local'; localStorage.setItem('by_mode', 'local'); closeSheet(); await connect(); toast(t('t.disconnected')); },
};

/* ================= events ================= */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  if (el.tagName === 'A') e.preventDefault();
  const fn = ACT[el.dataset.act];
  if (fn) run(() => fn(el, e));
});

document.addEventListener('submit', e => {
  const form = e.target.closest('[data-form]'); if (!form) return;
  e.preventDefault();
  const d = Object.fromEntries(new FormData(form));
  run(async () => {
    if (form.dataset.form === 'customer') {
      const old = cust(form.dataset.id) || {};
      const c = await S.store.saveCustomer({ ...old, name: d.name.trim(), phone: d.phone.trim(), plate: d.plate.trim(), car: d.car.trim() });
      S.sel = c.id; closeSheet(); await reload(); if (S.view !== 'dash') { S.view = 'dash'; mount(); }
      toast(t(old.id ? 't.customerUpdated' : 't.customerAdded'));
    } else {
      const f = S.files.find(x => x.id === form.dataset.id);
      let expiry = '';
      if (d.expiry.trim()) { expiry = parseExp(d.expiry.trim()); if (!expiry) return toast(t('u.badDate'), 'err'); }
      await S.store.updateFile({ ...f, name: d.name.trim() || f.name, type: d.type, expiry, note: d.note.trim() });
      closeSheet(); await reload(); toast(t('t.saved'));
    }
  });
});

let qT;
document.addEventListener('input', e => {
  const el = e.target;
  if (el.id === 'langSel') changeLang(el.value);
  else if (el.dataset.f) {
    S.filters[el.dataset.f] = el.value;
    if (el.dataset.f === 'customer' && el.value) { S.sel = el.value; S.mobileDetail = true; }
    if (el.dataset.f === 'q') { clearTimeout(qT); qT = setTimeout(() => { drawFilters(); drawResults(false); }, 120); }
    else { drawFilters(true); drawResults(true); }
  } else if (el.dataset.u) {
    const u = U[+el.closest('.up-row').dataset.i];
    u[el.dataset.u] = el.value;
    if (el.tagName === 'SELECT') { if (el.dataset.u === 'type' && el.value === 'policy' && !u.expiry) u.expiry = defaultExp(); drawUpload(); }
  } else if (el.id === 'asq') drawAsk(el.value);
});

for (const id of ['pick', 'cam']) $('#' + id).addEventListener('change', e => {
  const inp = e.target, files = [...inp.files], more = inp.dataset.more;
  inp.value = ''; delete inp.dataset.more;
  if (more && U.length && $('#upList')) { for (const f of files) U.push(pending(f, U[0].customerId, U[0].newName)); drawUpload(); }
  else run(() => startUpload(files));
});

// drag & drop, and paste from the clipboard
let dragN = 0;
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
addEventListener('dragenter', e => { if (hasFiles(e)) { dragN++; $('#drop').classList.add('on'); } });
addEventListener('dragleave', e => { if (hasFiles(e) && --dragN <= 0) { dragN = 0; $('#drop').classList.remove('on'); } });
addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragN = 0; $('#drop').classList.remove('on');
  const dc = e.target.closest?.('[data-customer]'); if (dc) S.sel = dc.dataset.customer;
  run(() => startUpload(e.dataTransfer.files));
});
addEventListener('paste', e => { const f = e.clipboardData?.files; if (f?.length && !e.target.closest('input,textarea')) { e.preventDefault(); run(() => startUpload(f)); } });

addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); assistantSheet(); }
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

/* ================= start ================= */
for (const el of $$('[data-ico]')) el.outerHTML = icon(el.dataset.ico, el.closest('.tabbar') ? 22 : 18);
$('#langSel').innerHTML = Object.entries(LANGS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
applyStatic();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => { });
document.fonts?.ready.then(syncChrome);
run(connect);
