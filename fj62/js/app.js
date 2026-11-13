import { kvGet, kvSet, photoGet, photoSet, photoDel, photoClear } from './db.js';
import * as L from './logic.js';

const { ZONES, ZONE } = L;
const APP_VERSION = '1.0.0';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let state = null, calc = null, truck = null, truckLoading = false, installPrompt = null;
const ui = { tab: 'truck', zone: null, ztab: 'due', dueFilter: 'attention', dueZone: '', logQ: '', logZone: '', health: true, xray: false };
try { Object.assign(ui, JSON.parse(localStorage.getItem('fj62-ui') || '{}')); } catch { /* storage blocked */ }
const saveUi = () => { try { localStorage.setItem('fj62-ui', JSON.stringify({ tab: ui.tab, health: ui.health })); } catch { /* ignore */ } };

const TABS = [
  ['truck', 'Truck', '<path d="M3 13l2-6h10l3 4h3v5h-2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M9 17h6"/>'],
  ['due', 'Due', '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'],
  ['log', 'Log', '<path d="M5 4h11l3 3v13H5z"/><path d="M8 10h8M8 14h8M8 18h5"/>'],
  ['mods', 'Mods', '<path d="M14 7l3-3 3 3-3 3"/><path d="M17 10L7 20l-3-3L14 7"/>'],
  ['more', 'More', '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>'],
];
const icon = p => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;

// ---------------------------------------------------------------- shell
function renderShell() {
  $('#app').innerHTML = `
  <header class="top">
    <div class="brand"><img src="icons/icon.svg" alt="" width="28" height="28"><span id="brandName">FJ62 Garage</span></div>
    <button class="odo" data-act="odo" id="odoBtn" hidden></button>
    <button class="btn primary add" data-act="add" id="addBtn" hidden><span aria-hidden="true">＋</span> Add</button>
  </header>
  <div id="banner"></div>
  <main id="main">
    <section id="v-truck" class="view">
      <div class="stage-wrap">
        <div id="stage" class="stage"><div class="stage-msg" id="stageMsg">Loading 3D view…</div></div>
        <div id="zlabel" class="zlabel"></div>
        <div id="ztip" class="ztip"></div>
        <div class="stage-ui">
          <div class="seg views" role="group" aria-label="Camera views">
            ${[['iso', '3/4'], ['front', 'Front'], ['side', 'Side'], ['rear', 'Rear'], ['top', 'Top'], ['under', 'Under'], ['bay', 'Engine bay']].map(([v, n]) => `<button data-act="view" data-v="${v}">${n}</button>`).join('')}
          </div>
          <div class="seg toggles">
            <button data-act="xray" id="xrayBtn" aria-pressed="false">X-ray</button>
            <button data-act="health" id="healthBtn" aria-pressed="true">Health colors</button>
          </div>
        </div>
        <div class="stage-hint">Drag to rotate · pinch or scroll to zoom · tap a part</div>
        <div class="legend"><span><i class="lv3"></i>Critical</span><span><i class="lv2"></i>Overdue / no record</span><span><i class="lv1"></i>Due soon</span><span><i class="lv0"></i>OK</span></div>
      </div>
      <div class="zonebar" id="zonebar"></div>
      <div class="panel" id="zpanel"></div>
    </section>
    <section id="v-due" class="view page" hidden></section>
    <section id="v-log" class="view page" hidden></section>
    <section id="v-mods" class="view page" hidden></section>
    <section id="v-more" class="view page" hidden></section>
    <section id="v-welcome" class="view page" hidden></section>
  </main>
  <nav class="tabs" id="tabs">
    ${TABS.map(([id, n, p]) => `<button data-act="tab" data-tab="${id}" id="tab-${id}">${icon(p)}<span>${n}</span></button>`).join('')}
  </nav>
  <dialog id="dlg"></dialog>
  <dialog id="dlg2" class="viewer"></dialog>
  <div id="toast" role="status"></div>
  <input type="file" id="importInput" accept="application/json,.json" hidden>`;
}

function refresh() {
  calc = state ? L.compute(state) : null;
  renderAll();
}

function renderAll() {
  const has = !!state;
  $('#odoBtn').hidden = !has; $('#addBtn').hidden = !has; $('#tabs').hidden = !has;
  document.body.classList.toggle('no-data', !has);
  if (!has) {
    $$('.view').forEach(v => v.hidden = v.id !== 'v-welcome');
    renderWelcome();
    return;
  }
  $('#brandName').textContent = state.vehicle?.nickname || 'FJ62 Garage';
  $('#odoBtn').innerHTML = calc.est != null ? `≈ ${L.fmtMiles(calc.est)} <small>mi</small>` : 'Set odometer';
  $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
  $('#tab-more').classList.toggle('dot', !!state.meta?.unsavedSince);
  $$('.view').forEach(v => v.hidden = v.id !== 'v-' + ui.tab);
  renderBanner();
  ({ truck: renderTruck, due: renderDue, log: renderLog, mods: renderMods, more: renderMore })[ui.tab]();
}

function renderBanner() {
  const since = state.meta?.unsavedSince;
  const days = since ? (Date.now() - new Date(since)) / 86400000 : 0;
  $('#banner').innerHTML = since && days > 7
    ? `<div class="banner">You have changes from the last ${Math.floor(days)} days that are only on this device. <button class="btn small" data-act="export">Back up now</button></div>` : '';
}

// ---------------------------------------------------------------- welcome
function renderWelcome() {
  $('#v-welcome').innerHTML = `
  <div class="welcome">
    <img src="icons/icon.svg" alt="" width="72" height="72">
    <h1>FJ62 Garage</h1>
    <p>Your truck's service history, schedule, watch items and mods, on a 3D truck you can tap. Your data stays on this device. The site stores nothing.</p>
    <button class="btn primary big" data-act="import">Import my data file</button>
    <button class="btn ghost" data-act="start-blank">Start with an empty truck</button>
    <p class="muted small">On a second device, import the latest backup file from the first one (More → Back up).</p>
  </div>`;
}

// ---------------------------------------------------------------- truck view
async function ensureTruck() {
  if (truck || truckLoading) return;
  truckLoading = true;
  try {
    const { createTruck } = await import('./truck3d.js');
    $('#stageMsg')?.remove();
    truck = createTruck($('#stage'), {
      onSelect: z => selectZone(z === ui.zone ? z : z),
      onHover: (z, x, y) => {
        const tip = $('#ztip');
        if (!z) { tip.style.opacity = 0; return; }
        const r = $('#stage').getBoundingClientRect();
        tip.textContent = ZONE[z]?.name || z;
        tip.style.transform = `translate(${x - r.left + 14}px, ${y - r.top + 10}px)`;
        tip.style.opacity = 1;
      },
    });
    truck.setHealth(ui.health);
    truck.setLevels(calc.zoneLevel);
    if (ui.zone) truck.select(ui.zone, false);
    syncLabel();
  } catch (err) {
    console.error(err);
    const m = $('#stageMsg') || Object.assign(document.createElement('div'), { className: 'stage-msg' });
    m.id = 'stageMsg';
    m.textContent = '3D view could not start on this device. Use the system list below.';
    $('#stage').appendChild(m);
  } finally { truckLoading = false; }
}

function syncLabel() {
  const el = $('#zlabel');
  el.textContent = ui.zone ? ZONE[ui.zone].name : '';
  el.style.opacity = ui.zone ? 1 : 0;
  truck?.setLabel(el, ui.zone);
}

function selectZone(z) {
  ui.zone = z;
  if (z && !['due', 'history', 'watch', 'specs', 'mods'].includes(ui.ztab)) ui.ztab = 'due';
  truck?.select(z, true);
  syncLabel();
  renderTruck();
  if (z && window.matchMedia('(max-width: 899px)').matches) {
    $('#zonebar').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function renderTruck() {
  ensureTruck();
  truck?.setLevels(calc.zoneLevel);
  $('#xrayBtn').setAttribute('aria-pressed', String(ui.xray));
  $('#healthBtn').setAttribute('aria-pressed', String(ui.health));
  $('#zonebar').innerHTML = `<button class="chip ${!ui.zone ? 'on' : ''}" data-act="zone" data-z="">Whole truck</button>` +
    ZONES.map(z => {
      const lv = calc.zoneLevel[z.id], c = calc.zoneCounts[z.id];
      const n = c.critical + c.overdue;
      return `<button class="chip ${ui.zone === z.id ? 'on' : ''}" data-act="zone" data-z="${z.id}"><i class="lv${lv}"></i>${esc(z.name)}${n ? `<b>${n}</b>` : ''}</button>`;
    }).join('');
  const on = $('#zonebar .chip.on');
  on && on.scrollIntoView({ block: 'nearest', inline: 'center' });
  $('#zpanel').innerHTML = ui.zone ? zonePanel(ui.zone) : truckSummary();
}

function truckSummary() {
  const c = calc.counts;
  const crit = calc.tasks.filter(t => t.status === 'critical');
  const v = state.vehicle || {};
  const last = [...state.log].sort((a, b) => b.date.localeCompare(a.date))[0];
  return `
  <div class="ptitle"><h2>${esc([v.year, v.model].filter(Boolean).join(' ') || 'Your truck')}</h2><p class="muted">${esc(v.engine || '')}</p></div>
  <div class="stats">
    <button class="stat" data-act="odo"><span>Odometer (est.)</span><b>${L.fmtMiles(calc.est)}</b><small>last read ${calc.reading ? L.fmtDate(calc.reading.date) : '—'}</small></button>
    <button class="stat bad" data-act="goto-due" data-f="attention"><span>Needs attention</span><b>${c.critical + c.overdue + c.norecord}</b><small>${c.critical} critical · ${c.overdue} overdue · ${c.norecord} no record</small></button>
    <button class="stat" data-act="goto-due" data-f="soon"><span>Due soon</span><b>${c.soon}</b><small>next ${state.settings?.soonDays ?? 60} days</small></button>
    <button class="stat" data-act="tab" data-tab="log"><span>Documented spend</span><b>${L.fmtMoney0(calc.spend)}</b><small>${state.log.length} records${last ? ' · last ' + L.fmtDate(last.date) : ''}</small></button>
  </div>
  ${crit.length ? `<h3 class="sec">Do first</h3><div class="list">${crit.map(t => taskRow(t, true)).join('')}</div>` : ''}
  <p class="muted tip">Tap a part of the truck, or a system above, to see its history, what's due, symptoms to watch for, specs and mods.</p>`;
}

function zonePanel(z) {
  const zone = ZONE[z];
  const tasks = calc.tasks.filter(t => t.zone === z);
  const hist = state.log.filter(e => e.zones?.includes(z)).sort((a, b) => b.date.localeCompare(a.date));
  const watch = state.watch.filter(w => w.zones.includes(z));
  const checks = state.checks.filter(c => c.zones.includes(z));
  const specs = state.specs.filter(s => s.zones.includes(z));
  const parts = state.parts.filter(p => p.zones.includes(z));
  const mods = state.mods.filter(m => m.zones.includes(z));
  const lv = calc.zoneLevel[z];
  const openChecks = checks.filter(c => !c.resolved).length;
  const tabs = [['due', 'Due', tasks.filter(t => t.level >= 2).length || tasks.length], ['history', 'History', hist.length],
    ['watch', 'Watch', watch.length + openChecks], ['specs', 'Specs & parts', specs.length + parts.length], ['mods', 'Mods', mods.length]];
  let body = '';
  if (ui.ztab === 'due') body = tasks.length ? `<div class="list">${tasks.map(t => taskRow(t, false)).join('')}</div>` : empty('No schedule items for this system.');
  if (ui.ztab === 'history') body = hist.length ? `<div class="list">${hist.map(logRow).join('')}</div>` : empty('No history yet.');
  if (ui.ztab === 'watch') body = (checks.length ? `<h3 class="sec">Check first</h3>${checks.map(checkCard).join('')}` : '') +
    (watch.length ? `<h3 class="sec">Symptoms to watch for</h3>${watch.map(watchCard).join('')}` : '') || empty('Nothing on the watch list.');
  if (ui.ztab === 'specs') body = (specs.length ? `<h3 class="sec">Specs & fluids</h3>${specTable(specs)}` : '') +
    (parts.length ? `<h3 class="sec">Part numbers</h3>${partTable(parts)}` : '') || empty('No specs or part numbers yet.');
  if (ui.ztab === 'mods') body = mods.length ? mods.map(modCard).join('') : empty('No mods listed for this system.');
  return `
  <div class="ptitle zone-h">
    <button class="crumb" data-act="zone" data-z="">Truck</button><span class="muted">›</span>
    <h2><i class="lv${lv}"></i>${esc(zone.name)}</h2>
    <button class="btn small" data-act="add" data-z="${z}">＋ Log work</button>
  </div>
  <p class="muted blurb">${esc(zone.blurb)}</p>
  <div class="ztabs" role="tablist">${tabs.map(([id, n, c]) => `<button role="tab" class="${ui.ztab === id ? 'on' : ''}" data-act="ztab" data-t="${id}">${n}${c ? ` <small>${c}</small>` : ''}</button>`).join('')}</div>
  <div class="zbody">${body}</div>`;
}

const empty = s => `<p class="empty">${esc(s)}</p>`;

function taskRow(t, showZone = true) {
  return `<button class="row" data-act="task" data-id="${t.id}">
    <span class="pill s-${t.status}">${L.STATUS_LABEL[t.status]}</span>
    <span class="rmain"><b>${esc(t.name)}</b><small>${esc(L.dueText(t, calc.est))}${t.diy ? ' · ' + esc(t.diy) : ''}</small></span>
    ${showZone ? `<span class="ztag">${esc(ZONE[t.zone]?.name || '')}</span>` : ''}
  </button>`;
}

function logRow(e) {
  return `<button class="row log" data-act="entry" data-id="${e.id}">
    <span class="ldate"><b>${L.fmtDate(e.date)}</b><small>${e.miles != null ? (e.approx ? '~' : '') + L.fmtMiles(e.miles) + ' mi' : '—'}</small></span>
    <span class="rmain"><b>${esc(e.title)}</b><small>${esc(e.shop || '')}${e.zones?.length ? ' · ' + e.zones.map(z => ZONE[z]?.name).filter(Boolean).join(', ') : ''}</small></span>
    <span class="lcost">${e.cost != null ? L.fmtMoney(e.cost) : ''}${e.photos?.length ? `<small>📷 ${e.photos.length}</small>` : ''}</span>
  </button>`;
}

function watchCard(w) {
  return `<div class="card ${w.critical ? 'crit' : ''}">
    <h4>${w.critical ? '<span class="pill s-critical">Priority</span> ' : ''}${esc(w.issue)}</h4>
    <dl><dt>Watch for</dt><dd>${esc(w.symptoms)}</dd><dt>What it means</dt><dd>${esc(w.meaning)}</dd><dt>This truck</dt><dd>${esc(w.status)}</dd></dl>
  </div>`;
}

function checkCard(c) {
  return `<div class="card check ${c.resolved ? 'done' : ''}">
    <label class="ck"><input type="checkbox" data-act="check" data-id="${c.id}" ${c.resolved ? 'checked' : ''}> <b>${esc(c.check)}</b></label>
    <div class="meta"><span class="pill ${c.priority === 'High' ? 's-overdue' : 's-soon'}">${esc(c.priority)}</span> <span class="muted">In records: ${esc(c.records)}</span></div>
    <details><summary>Details</summary><dl>
      <dt>What the records show</dt><dd>${esc(c.shows)}</dd><dt>Why it matters</dt><dd>${esc(c.why)}</dd>
      <dt>Proof to look for</dt><dd>${esc(c.proof)}</dd><dt>If there's no proof</dt><dd>${esc(c.ifNone)}</dd></dl></details>
  </div>`;
}

const specTable = rows => `<table class="tbl">${rows.map(s => `<tr><th>${esc(s.item)}</th><td>${esc(s.spec)}</td></tr>`).join('')}</table>`;
const partTable = rows => `<table class="tbl">${rows.map(p => `<tr><th>${esc(p.part)}</th><td><code>${esc(p.number)}</code><small>${esc(p.where)}</small></td></tr>`).join('')}</table>`;

const MOD_STATUS = [['idea', 'Idea'], ['want', 'Want'], ['done', 'Done'], ['skip', 'Skip']];
function modCard(m) {
  return `<div class="card mod s-${m.status}">
    <div class="mod-h"><h4>${esc(m.name)}</h4>${m.low || m.high ? `<span class="cost">${L.fmtMoney0(m.low)}–${L.fmtMoney0(m.high)}</span>` : ''}</div>
    <div class="seg mini">${MOD_STATUS.map(([s, n]) => `<button data-act="mod-status" data-id="${m.id}" data-s="${s}" class="${m.status === s ? 'on' : ''}">${n}</button>`).join('')}</div>
    <dl>${m.install ? `<dt>Install</dt><dd>${esc(m.install)}</dd>` : ''}${m.ca ? `<dt>California</dt><dd>${esc(m.ca)}</dd>` : ''}${m.why ? `<dt>Why</dt><dd>${esc(m.why)}</dd>` : ''}${m.source ? `<dt>Price source</dt><dd>${esc(m.source)}</dd>` : ''}</dl>
    <button class="link" data-act="mod-edit" data-id="${m.id}">Edit</button>
  </div>`;
}

// ---------------------------------------------------------------- due view
function renderDue() {
  const f = ui.dueFilter, z = ui.dueZone;
  let list = calc.tasks.filter(t => !z || t.zone === z);
  if (f === 'attention') list = list.filter(t => t.level >= 2);
  else if (f === 'soon') list = list.filter(t => t.status === 'soon');
  const groups = ['critical', 'overdue', 'norecord', 'soon', 'ok', 'done'].map(s => [s, list.filter(t => t.status === s)]).filter(g => g[1].length);
  $('#v-due').innerHTML = `
  <div class="phead"><h1>Due</h1><p class="muted">Estimated ${L.fmtMiles(calc.est)} mi at ${L.fmtMiles(state.settings?.milesPerYear ?? 3000)} mi/yr. A job is due at whichever comes first, miles or months.</p></div>
  <div class="filters">
    <div class="seg">${[['attention', 'Needs attention'], ['soon', 'Due soon'], ['all', 'All']].map(([k, n]) => `<button data-act="due-filter" data-f="${k}" class="${f === k ? 'on' : ''}">${n}</button>`).join('')}</div>
    ${zoneSelect('dueZone', z)}
  </div>
  ${groups.length ? groups.map(([s, ts]) => `<h3 class="sec">${L.STATUS_LABEL[s]} <small>${ts.length}</small></h3><div class="list">${ts.map(t => taskRow(t, !z)).join('')}</div>`).join('') : empty('Nothing here. Nice.')}`;
}

function zoneSelect(name, val) {
  return `<select class="zsel" data-change="${name}" aria-label="Filter by system"><option value="">All systems</option>${ZONES.map(z => `<option value="${z.id}" ${val === z.id ? 'selected' : ''}>${esc(z.name)}</option>`).join('')}</select>`;
}

// ---------------------------------------------------------------- log view
function renderLog() {
  $('#v-log').innerHTML = `
  <div class="phead"><h1>Service log</h1></div>
  <div class="filters">
    <input type="search" id="logQ" placeholder="Search work, shop, part number…" value="${esc(ui.logQ)}" aria-label="Search the log">
    ${zoneSelect('logZone', ui.logZone)}
  </div>
  <div id="logList"></div>`;
  renderLogList();
}

function renderLogList() {
  const q = ui.logQ.trim().toLowerCase();
  const list = state.log.filter(e => (!ui.logZone || e.zones?.includes(ui.logZone)) &&
    (!q || [e.title, e.shop, e.details, e.ref, e.date].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => b.date.localeCompare(a.date));
  const total = list.reduce((s, e) => s + (Number(e.cost) || 0), 0);
  const years = {};
  for (const e of list) (years[e.date.slice(0, 4)] ||= []).push(e);
  $('#logList').innerHTML = `<p class="muted sum">${list.length} entries · ${L.fmtMoney(total)}</p>` +
    (list.length ? Object.keys(years).sort().reverse().map(y => `<h3 class="sec">${y} <small>${L.fmtMoney0(years[y].reduce((s, e) => s + (Number(e.cost) || 0), 0))}</small></h3><div class="list">${years[y].map(logRow).join('')}</div>`).join('') : empty('No matching entries.'));
}

// ---------------------------------------------------------------- mods view
const TIERS = [[1, 'Tier 1: Protect first'], [2, 'Tier 2: Daily use'], [3, 'Tier 3: Trail'], [4, 'Tier 4: Drivetrain'], [0, 'Already on the truck / ruled out']];
function renderMods() {
  const want = state.mods.filter(m => m.status === 'want');
  const lo = want.reduce((s, m) => s + (+m.low || 0), 0), hi = want.reduce((s, m) => s + (+m.high || 0), 0);
  $('#v-mods').innerHTML = `
  <div class="phead"><h1>Mods & upgrades</h1><p class="muted">Mark the ones you want to total the parts cost. Prices are parts unless noted.</p></div>
  <div class="stats one"><div class="stat"><span>Wanted (${want.length})</span><b>${L.fmtMoney0(lo)} – ${L.fmtMoney0(hi)}</b><small>parts, low to high</small></div></div>
  <button class="btn" data-act="mod-edit" data-id="">＋ Add a mod</button>
  ${TIERS.map(([t, n]) => {
    const ms = state.mods.filter(m => (+m.tier || 0) === t);
    return ms.length ? `<h3 class="sec">${n}</h3><div class="cards">${ms.map(modCard).join('')}</div>` : '';
  }).join('')}`;
}

// ---------------------------------------------------------------- more view
function renderMore() {
  const v = state.vehicle || {};
  const open = state.checks.filter(c => !c.resolved);
  const lastExp = state.meta?.lastExport;
  const vRows = [['Vehicle', [v.year, v.make, v.model].filter(Boolean).join(' ')], ['Body', v.body], ['Color', v.color], ['VIN', v.vin], ['Plate', v.plate],
    ['Built', v.built], ['In service', v.inService && L.fmtDate(v.inService)], ['Engine', v.engine], ['Transmission', v.transmission], ['Axle ratio', v.axleRatio],
    ['Registration', v.registration], ['Smog', v.smog], ['Notes', v.notes]].filter(r => r[1]);
  const readings = [...state.odometer].sort((a, b) => b.date.localeCompare(a.date));
  $('#v-more').innerHTML = `
  <div class="phead"><h1>More</h1></div>
  <section class="block">
    <h2>Backup</h2>
    <p class="muted">Your data lives only in this browser on this device. Export a backup file after changes, and keep it somewhere safe (Google Drive, email to yourself). Import it on your other devices.</p>
    <p class="${state.meta?.unsavedSince ? 'warn' : 'muted'}">${lastExp ? 'Last backup: ' + new Date(lastExp).toLocaleString() : 'No backup made on this device yet.'}${state.meta?.unsavedSince ? ' · Changes not backed up yet.' : ''}</p>
    <div class="btns">
      <button class="btn primary" data-act="export">Download backup</button>
      ${navigator.canShare ? '<button class="btn" data-act="share">Share backup…</button>' : ''}
      <button class="btn" data-act="import">Restore from file</button>
    </div>
  </section>
  <section class="block">
    <h2>Odometer</h2>
    <p>Estimated now: <b>${L.fmtMiles(calc.est)} mi</b>. Last reading ${calc.reading ? `${L.fmtMiles(calc.reading.miles)} on ${L.fmtDate(calc.reading.date)}` : 'none'}.</p>
    <label class="inline">Miles per year <input type="number" inputmode="numeric" min="0" step="100" value="${state.settings?.milesPerYear ?? 3000}" data-change="mpy"></label>
    <div class="btns"><button class="btn" data-act="odo">Add a reading</button></div>
    <details><summary>All readings (${readings.length})</summary><table class="tbl">${readings.map(r => `<tr><th>${L.fmtDate(r.date)}</th><td>${L.fmtMiles(r.miles)} mi ${r.note ? `<small>${esc(r.note)}</small>` : ''} <button class="link" data-act="del-reading" data-d="${r.date}" data-m="${r.miles}">remove</button></td></tr>`).join('')}</table></details>
  </section>
  <section class="block">
    <h2>Truck</h2>
    <table class="tbl">${vRows.map(([k, val]) => `<tr><th>${k}</th><td>${esc(val)}</td></tr>`).join('')}</table>
    <div class="btns"><button class="btn" data-act="vehicle">Edit truck details</button></div>
  </section>
  <section class="block">
    <h2>Check first <small>${open.length} open</small></h2>
    <details ${open.length ? 'open' : ''}><summary>High-risk items to confirm</summary>${state.checks.map(checkCard).join('')}</details>
  </section>
  <section class="block"><h2>Watch list</h2><details><summary>${state.watch.length} known FJ62 issues with symptoms</summary>${state.watch.map(watchCard).join('')}</details></section>
  <section class="block"><h2>Specs & fluids</h2><details><summary>${state.specs.length} specs</summary>${specTable(state.specs)}</details></section>
  <section class="block"><h2>Part numbers</h2><details><summary>${state.parts.length} part numbers from the invoices</summary>${partTable(state.parts)}</details></section>
  <section class="block"><h2>Paperwork gaps</h2><details><summary>${state.gaps.length} missing pages and records</summary><ul class="gaps">${state.gaps.map(g => `<li>${esc(g)}</li>`).join('')}</ul></details></section>
  <section class="block">
    <h2>App</h2>
    <div class="btns">
      ${installPrompt ? '<button class="btn" data-act="install">Install app</button>' : ''}
      <button class="btn danger" data-act="erase">Erase all data on this device</button>
    </div>
    <p class="muted small">FJ62 Garage ${APP_VERSION}. Works offline once loaded. To install on Android: Chrome menu → Add to Home screen / Install app.</p>
  </section>`;
}

// ---------------------------------------------------------------- dialogs
const dlg = () => $('#dlg');
function openDialog(html, cls = '') {
  const d = dlg();
  d.className = cls;
  d.innerHTML = html;
  if (!d.open) d.showModal();
  d.scrollTop = 0;
  return d;
}
const closeDialog = () => { const d = dlg(); if (d.open) d.close(); d.innerHTML = ''; d.onsubmit = null; };
const dlgHead = t => `<header class="dlg-h"><h2>${t}</h2><button type="button" class="icon" data-act="close" aria-label="Close">✕</button></header>`;

function openTask(id) {
  const t = calc.tasks.find(x => x.id === id);
  if (!t) return;
  const hist = state.log.filter(e => e.tasks?.includes(id)).sort((a, b) => b.date.localeCompare(a.date));
  openDialog(`${dlgHead(esc(t.name))}
  <div class="dlg-b">
    <p><span class="pill s-${t.status}">${L.STATUS_LABEL[t.status]}</span> <button class="ztag" data-act="zone-go" data-z="${t.zone}">${esc(ZONE[t.zone]?.name)}</button></p>
    <table class="tbl">
      <tr><th>Interval</th><td>${esc(L.intervalText(t))}</td></tr>
      <tr><th>DIY or shop</th><td>${esc(t.diy || '—')}</td></tr>
      <tr><th>Last done</th><td>${t.last ? `${L.fmtDate(t.last.date)}${t.last.miles != null ? ` at ${t.last.approx ? '~' : ''}${L.fmtMiles(t.last.miles)} mi` : ''}` : 'No record'}</td></tr>
      <tr><th>Next due</th><td>${esc(L.dueText(t, calc.est))}</td></tr>
    </table>
    ${t.how ? `<h3 class="sec">What the job involves</h3><p class="prose">${esc(t.how)}</p>` : ''}
    <h3 class="sec">History</h3>
    ${hist.length ? `<div class="list">${hist.map(logRow).join('')}</div>` : empty('Not in any record.')}
  </div>
  <footer class="dlg-f"><button class="btn ghost" data-act="task-edit" data-id="${t.id}">Edit interval</button><button class="btn primary" data-act="log-task" data-id="${t.id}">Log this job</button></footer>`);
}

function openTaskEdit(id) {
  const t = state.tasks.find(x => x.id === id);
  const d = openDialog(`<form>${dlgHead('Edit schedule item')}
  <div class="dlg-b">
    <label>Name<input name="name" required value="${esc(t.name)}"></label>
    <div class="grid2"><label>Every (miles)<input name="everyMiles" inputmode="numeric" value="${t.everyMiles ?? ''}"></label><label>Every (months)<input name="everyMonths" inputmode="numeric" value="${t.everyMonths ?? ''}"></label></div>
    <label class="check"><input type="checkbox" name="once" ${t.once ? 'checked' : ''}> One-time job</label>
    <label class="check"><input type="checkbox" name="critical" ${t.critical ? 'checked' : ''}> Critical (shows red when due)</label>
    <label>DIY or shop<input name="diy" value="${esc(t.diy || '')}"></label>
    <label>What the job involves<textarea name="how" rows="5">${esc(t.how || '')}</textarea></label>
  </div>
  <footer class="dlg-f"><button type="button" class="btn ghost" data-act="close">Cancel</button><button class="btn primary">Save</button></footer></form>`);
  d.onsubmit = e => {
    e.preventDefault();
    const f = new FormData(e.target);
    Object.assign(t, { name: f.get('name').trim(), everyMiles: num(f.get('everyMiles')), everyMonths: num(f.get('everyMonths')),
      once: f.has('once'), critical: f.has('critical'), diy: f.get('diy').trim(), how: f.get('how').trim() });
    closeDialog(); persist(); toast('Schedule item saved');
  };
}

async function openEntry(id) {
  const e = state.log.find(x => x.id === id);
  if (!e) return;
  const taskNames = (e.tasks || []).map(t => state.tasks.find(x => x.id === t)?.name).filter(Boolean);
  const d = openDialog(`${dlgHead(esc(e.title))}
  <div class="dlg-b">
    <table class="tbl">
      <tr><th>Date</th><td>${L.fmtDate(e.date)}</td></tr>
      <tr><th>Odometer</th><td>${e.miles != null ? (e.approx ? 'about ' : '') + L.fmtMiles(e.miles) + ' mi' : '—'}</td></tr>
      ${e.shop ? `<tr><th>Shop</th><td>${esc(e.shop)}</td></tr>` : ''}
      ${e.ref ? `<tr><th>Invoice</th><td>${esc(e.ref)}</td></tr>` : ''}
      <tr><th>Cost</th><td>${e.cost != null ? L.fmtMoney(e.cost) : '—'}${e.note ? ` <small>${esc(e.note)}</small>` : ''}</td></tr>
    </table>
    ${e.zones?.length ? `<div class="chips wrap">${e.zones.map(z => `<button class="chip" data-act="zone-go" data-z="${z}"><i class="lv${calc.zoneLevel[z] ?? 0}"></i>${esc(ZONE[z]?.name || z)}</button>`).join('')}</div>` : ''}
    ${taskNames.length ? `<h3 class="sec">Schedule items completed</h3><ul class="ticks">${taskNames.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    ${e.details ? `<h3 class="sec">Details</h3><p class="prose pre">${esc(e.details)}</p>` : ''}
    ${e.photos?.length ? `<h3 class="sec">Photos</h3><div class="thumbs" id="eThumbs"></div>` : ''}
  </div>
  <footer class="dlg-f"><button class="btn danger ghost" data-act="del-entry" data-id="${e.id}">Delete</button><button class="btn primary" data-act="edit-entry" data-id="${e.id}">Edit</button></footer>`);
  if (e.photos?.length) {
    const box = $('#eThumbs', d);
    for (const pid of e.photos) {
      const b = await photoGet(pid);
      if (!b) continue;
      const url = URL.createObjectURL(b);
      box.insertAdjacentHTML('beforeend', `<button class="thumb" data-act="photo" data-url="${url}"><img src="${url}" alt="Invoice photo"></button>`);
    }
  }
}

function openEntryForm(existing, preset = {}) {
  const e = existing ? structuredClone(existing) : {
    id: L.uid('e'), date: L.isoDate(new Date()), miles: calc.est != null ? Math.round(calc.est) : null, approx: false,
    shop: '', title: '', cost: null, zones: [], tasks: [], details: '', ref: '', kind: 'service', photos: [], ...preset,
  };
  const zones = new Set(e.zones), tasks = new Set(e.tasks);
  const keep = [...(e.photos || [])];
  const added = []; // {id, blob, url}
  const d = openDialog(`<form id="entryForm">${dlgHead(existing ? 'Edit entry' : 'Add to the log')}
  <div class="dlg-b">
    <div class="btns">
      <label class="btn primary"><input type="file" accept="image/*" capture="environment" hidden data-photo-in>📷 Snap invoice</label>
      <label class="btn"><input type="file" accept="image/*" multiple hidden data-photo-in>Choose photos</label>
    </div>
    <div class="thumbs" id="fThumbs"></div>
    <label>What was done<input name="title" required value="${esc(e.title)}" placeholder="e.g. Transfer case oil change"></label>
    <div class="grid2">
      <label>Date<input type="date" name="date" required value="${esc(e.date)}"></label>
      <label>Odometer<input name="miles" inputmode="numeric" value="${e.miles ?? ''}" placeholder="miles"></label>
    </div>
    <label class="check"><input type="checkbox" name="approx" ${e.approx ? 'checked' : ''}> Mileage is approximate</label>
    <div class="grid2">
      <label>Shop or who<input name="shop" value="${esc(e.shop)}" placeholder="DIY, shop name…"></label>
      <label>Cost ($)<input name="cost" inputmode="decimal" value="${e.cost ?? ''}"></label>
    </div>
    <div class="grid2">
      <label>Invoice / RO #<input name="ref" value="${esc(e.ref || '')}"></label>
      <label>Type<select name="kind">${['service', 'repair', 'parts', 'admin', 'other'].map(k => `<option ${e.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
    </div>
    <fieldset><legend>Systems it touched</legend><div class="chips wrap" id="fZones"></div></fieldset>
    <fieldset><legend>Schedule items this completes</legend><div id="fTasks"></div>
      <small class="muted">Ticking an item resets its maintenance clock to this date and mileage.</small></fieldset>
    <label>Details, parts, notes<textarea name="details" rows="6" placeholder="Parts used, part numbers, findings…">${esc(e.details)}</textarea></label>
  </div>
  <footer class="dlg-f"><button type="button" class="btn ghost" data-act="close">Cancel</button><button class="btn primary">Save</button></footer></form>`, 'wide');

  const drawZones = () => {
    $('#fZones', d).innerHTML = ZONES.map(z => `<button type="button" class="chip ${zones.has(z.id) ? 'on' : ''}" data-fz="${z.id}">${esc(z.name)}</button>`).join('');
  };
  const drawTasks = () => {
    const list = state.tasks.filter(t => zones.has(t.zone) || tasks.has(t.id));
    $('#fTasks', d).innerHTML = list.length ? list.map(t => `<label class="check"><input type="checkbox" data-ft="${t.id}" ${tasks.has(t.id) ? 'checked' : ''}> ${esc(t.name)} <small class="muted">${esc(ZONE[t.zone]?.name || '')}</small></label>`).join('')
      : '<p class="muted small">Pick the systems above to see their schedule items.</p>';
  };
  const drawThumbs = async () => {
    const box = $('#fThumbs', d);
    box.innerHTML = '';
    for (const pid of keep) {
      const b = await photoGet(pid);
      if (b) box.insertAdjacentHTML('beforeend', `<div class="thumb"><img src="${URL.createObjectURL(b)}" alt=""><button type="button" class="x" data-rm="${pid}" aria-label="Remove photo">✕</button></div>`);
    }
    for (const p of added) box.insertAdjacentHTML('beforeend', `<div class="thumb"><img src="${p.url}" alt=""><button type="button" class="x" data-rm="${p.id}" aria-label="Remove photo">✕</button></div>`);
  };
  drawZones(); drawTasks(); drawThumbs();

  d.onclick = ev => {
    const fz = ev.target.closest('[data-fz]');
    if (fz) { const z = fz.dataset.fz; zones.has(z) ? zones.delete(z) : zones.add(z); drawZones(); drawTasks(); return; }
    const rm = ev.target.closest('[data-rm]');
    if (rm) {
      const id = rm.dataset.rm;
      const i = keep.indexOf(id); if (i >= 0) keep.splice(i, 1);
      const j = added.findIndex(p => p.id === id); if (j >= 0) added.splice(j, 1);
      drawThumbs();
    }
  };
  d.onchange = async ev => {
    if (ev.target.matches('[data-ft]')) { ev.target.checked ? tasks.add(ev.target.dataset.ft) : tasks.delete(ev.target.dataset.ft); return; }
    if (ev.target.matches('[data-photo-in]')) {
      for (const file of ev.target.files) {
        const blob = await compressImage(file);
        added.push({ id: L.uid('p'), blob, url: URL.createObjectURL(blob) });
      }
      ev.target.value = '';
      drawThumbs();
    }
  };
  d.onsubmit = async ev => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    for (const p of added) await photoSet(p.id, p.blob);
    const removed = (existing?.photos || []).filter(p => !keep.includes(p));
    for (const p of removed) await photoDel(p);
    for (const t of tasks) { const z = state.tasks.find(x => x.id === t)?.zone; if (z) zones.add(z); }
    const out = { ...e, title: f.get('title').trim(), date: f.get('date'), miles: num(f.get('miles')), approx: f.has('approx'),
      shop: f.get('shop').trim(), cost: money(f.get('cost')), ref: f.get('ref').trim(), kind: f.get('kind'),
      zones: [...zones], tasks: [...tasks], details: f.get('details').trim(), photos: [...keep, ...added.map(p => p.id)] };
    const i = state.log.findIndex(x => x.id === out.id);
    if (i >= 0) state.log[i] = out; else state.log.push(out);
    closeDialog(); persist();
    toast(existing ? 'Entry updated' : 'Added to the log');
  };
}

function openOdo() {
  const d = openDialog(`<form>${dlgHead('Odometer reading')}
  <div class="dlg-b">
    <p class="muted">Estimated now: ${L.fmtMiles(calc.est)} mi. Enter what the gauge actually says to keep due dates accurate.</p>
    <div class="grid2"><label>Date<input type="date" name="date" required value="${L.isoDate(new Date())}"></label>
    <label>Miles<input name="miles" inputmode="numeric" required autofocus placeholder="${calc.est != null ? Math.round(calc.est) : ''}"></label></div>
    <label>Note<input name="note" placeholder="optional"></label>
  </div>
  <footer class="dlg-f"><button type="button" class="btn ghost" data-act="close">Cancel</button><button class="btn primary">Save reading</button></footer></form>`);
  d.onsubmit = ev => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const miles = num(f.get('miles'));
    if (miles == null) return toast('Enter the miles');
    state.odometer.push({ date: f.get('date'), miles, note: f.get('note').trim() });
    closeDialog(); persist(); toast('Reading saved');
  };
}

const VEHICLE_FIELDS = [['nickname', 'Nickname (shown at top)'], ['year', 'Year'], ['make', 'Make'], ['model', 'Model'], ['body', 'Body'], ['color', 'Color'],
  ['vin', 'VIN'], ['plate', 'Plate'], ['built', 'Built'], ['inService', 'In service (YYYY-MM-DD)'], ['engine', 'Engine'], ['transmission', 'Transmission'],
  ['axleRatio', 'Axle ratio'], ['registration', 'Registration'], ['smog', 'Smog'], ['notes', 'Notes']];
function openVehicle() {
  const v = state.vehicle || {};
  const d = openDialog(`<form>${dlgHead('Truck details')}
  <div class="dlg-b">${VEHICLE_FIELDS.map(([k, n]) => k === 'notes'
    ? `<label>${n}<textarea name="${k}" rows="3">${esc(v[k] ?? '')}</textarea></label>`
    : `<label>${n}<input name="${k}" value="${esc(v[k] ?? '')}"></label>`).join('')}</div>
  <footer class="dlg-f"><button type="button" class="btn ghost" data-act="close">Cancel</button><button class="btn primary">Save</button></footer></form>`);
  d.onsubmit = ev => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    state.vehicle = { ...v, ...Object.fromEntries(VEHICLE_FIELDS.map(([k]) => [k, f.get(k).trim()])) };
    closeDialog(); persist();
  };
}

function openModForm(id) {
  const m = state.mods.find(x => x.id === id) || { id: L.uid('m'), tier: 2, zones: [], name: '', low: null, high: null, install: '', ca: '', why: '', source: '', status: 'idea' };
  const zones = new Set(m.zones);
  const d = openDialog(`<form>${dlgHead(id ? 'Edit mod' : 'Add a mod')}
  <div class="dlg-b">
    <label>Name<input name="name" required value="${esc(m.name)}"></label>
    <div class="grid2"><label>Parts low ($)<input name="low" inputmode="decimal" value="${m.low ?? ''}"></label><label>Parts high ($)<input name="high" inputmode="decimal" value="${m.high ?? ''}"></label></div>
    <label>Tier<select name="tier">${TIERS.map(([t, n]) => `<option value="${t}" ${+m.tier === t ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <fieldset><legend>Systems</legend><div class="chips wrap" id="mZones"></div></fieldset>
    <label>Install<input name="install" value="${esc(m.install)}"></label>
    <label>California note<input name="ca" value="${esc(m.ca)}"></label>
    <label>Why<textarea name="why" rows="2">${esc(m.why)}</textarea></label>
    <label>Price source<input name="source" value="${esc(m.source)}"></label>
  </div>
  <footer class="dlg-f">${id ? '<button type="button" class="btn danger ghost" data-act="del-mod" data-id="' + m.id + '">Delete</button>' : '<button type="button" class="btn ghost" data-act="close">Cancel</button>'}<button class="btn primary">Save</button></footer></form>`);
  const draw = () => { $('#mZones', d).innerHTML = ZONES.map(z => `<button type="button" class="chip ${zones.has(z.id) ? 'on' : ''}" data-mz="${z.id}">${esc(z.name)}</button>`).join(''); };
  draw();
  d.onclick = ev => { const b = ev.target.closest('[data-mz]'); if (b) { const z = b.dataset.mz; zones.has(z) ? zones.delete(z) : zones.add(z); draw(); } };
  d.onsubmit = ev => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const out = { ...m, name: f.get('name').trim(), low: money(f.get('low')) ?? 0, high: money(f.get('high')) ?? 0, tier: +f.get('tier'),
      zones: [...zones], install: f.get('install').trim(), ca: f.get('ca').trim(), why: f.get('why').trim(), source: f.get('source').trim() };
    const i = state.mods.findIndex(x => x.id === out.id);
    if (i >= 0) state.mods[i] = out; else state.mods.push(out);
    closeDialog(); persist();
  };
}

function viewPhoto(url) {
  const d = $('#dlg2');
  d.innerHTML = `<button class="icon close" data-act="close2" aria-label="Close">✕</button><img src="${url}" alt="Invoice photo">`;
  d.showModal();
}

// ---------------------------------------------------------------- data
function num(v) { if (v == null) return null; const s = String(v).replace(/[,\s]/g, ''); if (!s) return null; const n = parseInt(s, 10); return Number.isFinite(n) ? n : null; }
function money(v) { if (v == null) return null; const s = String(v).replace(/[$,\s]/g, ''); if (!s) return null; const n = parseFloat(s); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; }

async function persist() {
  state.meta ||= {};
  state.meta.updated = new Date().toISOString();
  state.meta.unsavedSince ||= state.meta.updated;
  refresh();
  try { await kvSet('state', state); } catch (err) { toast('Could not save: ' + err.message); }
}

function normalize(d) {
  d.meta ||= {}; d.settings ||= { milesPerYear: 3000, soonDays: 60 };
  for (const k of ['odometer', 'tasks', 'log', 'watch', 'checks', 'mods', 'specs', 'parts', 'gaps']) if (!Array.isArray(d[k])) d[k] = [];
  for (const e of d.log) { e.id ||= L.uid('e'); e.zones ||= []; e.tasks ||= []; e.photos ||= []; }
  for (const k of ['watch', 'checks', 'specs', 'parts', 'mods']) for (const x of d[k]) x.zones ||= [];
  for (const m of d.mods) m.id ||= L.uid('m');
  return d;
}

async function compressImage(file) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const max = 2000, sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
    return blob || file;
  } catch { return file; }
}
const blobToDataURL = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
async function dataURLToBlob(u) { return (await fetch(u)).blob(); }

async function buildBackup() {
  const photosData = {};
  for (const e of state.log) for (const pid of e.photos || []) {
    const b = await photoGet(pid);
    if (b) photosData[pid] = await blobToDataURL(b);
  }
  const { unsavedSince, ...meta } = state.meta || {};
  const out = { ...state, meta: { ...meta, exported: new Date().toISOString() }, photosData };
  const name = `fj62-backup-${L.isoDate(new Date())}.json`;
  return new File([JSON.stringify(out)], name, { type: 'application/json' });
}

async function markBackedUp() {
  state.meta.lastExport = new Date().toISOString();
  delete state.meta.unsavedSince;
  await kvSet('state', state);
  refresh();
}

async function exportBackup() {
  const file = await buildBackup();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = file.name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  await markBackedUp();
  toast('Backup downloaded: ' + file.name);
}

async function shareBackup() {
  const file = await buildBackup();
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'FJ62 Garage backup' });
      await markBackedUp();
      return;
    }
  } catch (err) { if (err.name === 'AbortError') return; }
  toast('Sharing files is not supported here; downloading instead.');
  exportBackup();
}

async function importFile(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { return toast('That file is not valid JSON.'); }
  const err = L.validate(data);
  if (err) return alert(err);
  if (state?.log?.length && !confirm(`Replace everything on this device with "${file.name}"?\n\nIt has ${data.log.length} log entries. Your current data (${state.log.length} entries) will be overwritten. Export a backup first if unsure.`)) return;
  const photos = data.photosData || {};
  delete data.photosData;
  await photoClear();
  for (const [id, url] of Object.entries(photos)) await photoSet(id, await dataURLToBlob(url));
  normalize(data);
  data.meta.imported = new Date().toISOString();
  delete data.meta.unsavedSince;
  state = data;
  await kvSet('state', state);
  ui.zone = null; ui.tab = 'truck';
  refresh();
  toast(`Imported ${state.log.length} log entries and ${state.tasks.length} schedule items`);
}

// ---------------------------------------------------------------- events
document.addEventListener('click', async ev => {
  const el = ev.target.closest('[data-act]');
  if (!el) {
    if (ev.target === dlg()) closeDialog();
    if (ev.target === $('#dlg2')) $('#dlg2').close();
    return;
  }
  const act = el.dataset.act, id = el.dataset.id;
  switch (act) {
    case 'tab': ui.tab = el.dataset.tab; saveUi(); closeDialog(); renderAll(); window.scrollTo(0, 0); break;
    case 'zone': selectZone(el.dataset.z || null); break;
    case 'zone-go': closeDialog(); ui.tab = 'truck'; renderAll(); selectZone(el.dataset.z); break;
    case 'ztab': ui.ztab = el.dataset.t; renderTruck(); break;
    case 'view': truck?.view(el.dataset.v); break;
    case 'xray': ui.xray = !ui.xray; truck?.setXray(ui.xray); el.setAttribute('aria-pressed', String(ui.xray)); break;
    case 'health': ui.health = !ui.health; saveUi(); truck?.setHealth(ui.health); el.setAttribute('aria-pressed', String(ui.health)); break;
    case 'goto-due': ui.tab = 'due'; ui.dueFilter = el.dataset.f; ui.dueZone = ''; renderAll(); break;
    case 'due-filter': ui.dueFilter = el.dataset.f; renderDue(); break;
    case 'task': openTask(id); break;
    case 'task-edit': openTaskEdit(id); break;
    case 'log-task': {
      const t = state.tasks.find(x => x.id === id);
      openEntryForm(null, { title: t.name, zones: [t.zone], tasks: [t.id] });
      break;
    }
    case 'entry': openEntry(id); break;
    case 'edit-entry': openEntryForm(state.log.find(x => x.id === id)); break;
    case 'del-entry': {
      const e = state.log.find(x => x.id === id);
      if (!confirm(`Delete "${e.title}" (${L.fmtDate(e.date)})?`)) break;
      for (const p of e.photos || []) await photoDel(p);
      state.log = state.log.filter(x => x.id !== id);
      closeDialog(); persist(); toast('Entry deleted');
      break;
    }
    case 'add': openEntryForm(null, el.dataset.z ? { zones: [el.dataset.z] } : (ui.tab === 'truck' && ui.zone ? { zones: [ui.zone] } : {})); break;
    case 'photo': viewPhoto(el.dataset.url); break;
    case 'close': closeDialog(); break;
    case 'close2': $('#dlg2').close(); break;
    case 'odo': openOdo(); break;
    case 'del-reading': {
      if (!confirm('Remove this odometer reading?')) break;
      const i = state.odometer.findIndex(r => r.date === el.dataset.d && String(r.miles) === el.dataset.m);
      if (i >= 0) { state.odometer.splice(i, 1); persist(); }
      break;
    }
    case 'vehicle': openVehicle(); break;
    case 'mod-status': {
      const m = state.mods.find(x => x.id === id);
      m.status = el.dataset.s; persist();
      break;
    }
    case 'mod-edit': openModForm(id || null); break;
    case 'del-mod': if (confirm('Delete this mod?')) { state.mods = state.mods.filter(m => m.id !== id); closeDialog(); persist(); } break;
    case 'export': exportBackup(); break;
    case 'share': shareBackup(); break;
    case 'import': $('#importInput').click(); break;
    case 'start-blank': state = normalize(L.emptyState()); await kvSet('state', state); refresh(); break;
    case 'erase':
      if (!confirm('Erase all truck data and photos from this device? This cannot be undone. Make a backup first.')) break;
      if (!confirm('Really erase everything?')) break;
      await photoClear(); await kvSet('state', null); state = null; ui.zone = null; refresh();
      break;
    case 'install': installPrompt?.prompt(); installPrompt = null; break;
  }
});

document.addEventListener('change', ev => {
  const t = ev.target;
  if (t.id === 'importInput') { const f = t.files[0]; t.value = ''; if (f) importFile(f); return; }
  if (t.matches('[data-act="check"]')) {
    const c = state.checks.find(x => x.id === t.dataset.id);
    c.resolved = t.checked; persist();
    return;
  }
  const k = t.dataset.change;
  if (k === 'dueZone') { ui.dueZone = t.value; renderDue(); }
  if (k === 'logZone') { ui.logZone = t.value; renderLogList(); }
  if (k === 'mpy') { const n = num(t.value); if (n != null) { state.settings.milesPerYear = n; persist(); } }
});

document.addEventListener('input', ev => {
  if (ev.target.id === 'logQ') { ui.logQ = ev.target.value; renderLogList(); }
});

let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3200);
}

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; if (state && ui.tab === 'more') renderMore(); });

function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    const t = $('#toast');
    t.innerHTML = 'App updated. <button class="btn small" onclick="location.reload()">Reload</button>';
    t.classList.add('show');
  });
}

// ---------------------------------------------------------------- boot
(async function init() {
  renderShell();
  try {
    const saved = await kvGet('state');
    state = saved ? normalize(saved) : null;
  } catch (err) {
    console.error(err);
    toast('This browser is blocking storage, so data will not be saved.');
  }
  refresh();
  setupServiceWorker();
  try { navigator.storage?.persist?.(); } catch { /* optional */ }
})();
