// DOM, playback loop and views. All strings come from i18n.js.
import { ENTITY, MODES, PRESETS, run, sanitize, decision, isModelTagged, indexAt, stageLabel } from './model.js';
import { I18N, LANGS } from './i18n.js';
import { renderSchematic } from './schematic.js';
import { renderCharts } from './charts.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PLAY_SECONDS = 12; // a full run at 1×

const S = {
  view: 'sim', mode: 'renal', entity: 'clearCell', params: {}, arm: 'untreated', idx: 0, playing: false, speed: 1,
  preset: null, lang: 'es', table: false, compare: ['clearCell', 'nmibc', 'utuc'],
  quiz: { filter: 'all', i: 0, picked: null, checked: false, score: 0, answered: 0 },
};
let RES = null;
let chartCtl = null;
let raf = null;

const T = () => I18N[S.lang];
const E = (id = S.entity) => T().ent[id];
const ent = () => ENTITY[S.entity];
const locale = () => (S.lang === 'es' ? 'es-ES' : 'en-GB');

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
function fmtNum(v, digits) {
  if (!Number.isFinite(v)) return '—';
  const d = digits ?? (Math.abs(v) < 10 ? 1 : 0);
  return new Intl.NumberFormat(locale(), { maximumFractionDigits: d, minimumFractionDigits: 0 }).format(v);
}
const DIGITS = { size: 1, largest: 1, pM: 1, pMal: 0, survival: 0, egfr: 0, hb: 1, map: 0, hematoma: 0, bleedYear: 1, bleedCum: 1, burden: 0, present: 0, prog: 1, residual: 0, bladderRecur: 0, surgeries: 0 };
const seriesDigits = (key, v) => DIGITS[key] ?? (Math.abs(v) < 10 ? 1 : 0);
const seriesText = (sd, v) => (sd.stage ? stageLabel(v) : fmtNum(v, seriesDigits(sd.key, v)));
function fmtTime(t, unit = ent().unit) {
  const v = Math.abs(t - Math.round(t)) < 1e-6 ? Math.round(t) : fmtNum(t, 1);
  return T().unit[unit](typeof v === 'number' ? fmtNum(v, 0) : v);
}
function evText(entityId, e) {
  const v = E(entityId).ev[e.key];
  return typeof v === 'function' ? v(e.vars, T()) : v;
}
function unitLabel(u) {
  if (!u) return '';
  const w = T().unitWords;
  if (u in w) return w[u];
  if (S.lang === 'es') return u.replace('%/mo', '%/mes');
  return u;
}
function fmtParam(d, v) {
  const digits = d.step < 1 ? (d.step < 0.1 ? 2 : 1) : 0;
  return new Intl.NumberFormat(locale(), { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v);
}

// ---------------------------------------------------------------------------
// URL, storage, language
// ---------------------------------------------------------------------------
function encodeParams(p) { return Object.entries(p).map(([k, v]) => `${k}~${v}`).join('|'); }
function decodeParams(s) {
  const o = {};
  for (const part of (s || '').split('|')) { const [k, v] = part.split('~'); if (k) o[k] = v === 'true' ? true : v === 'false' ? false : (isNaN(+v) ? v : +v); }
  return o;
}
function shareURL() {
  const u = new URL(location.href);
  u.search = '';
  if (S.view !== 'sim') u.searchParams.set('view', S.view);
  if (S.view === 'sim') {
    if (S.preset) u.searchParams.set('preset', S.preset);
    else { u.searchParams.set('entity', S.entity); const changed = changedParams(); if (Object.keys(changed).length) u.searchParams.set('p', encodeParams(changed)); }
  }
  u.searchParams.set('lang', S.lang);
  return u.toString();
}
function changedParams() {
  const d = sanitize(ent(), {});
  const p = sanitize(ent(), S.params);
  return Object.fromEntries(Object.entries(p).filter(([k, v]) => d[k] !== v));
}
function syncURL() { history.replaceState(null, '', shareURL()); }
function initialLang(q) {
  const fromQ = q.get('lang');
  if (LANGS.includes(fromQ)) return fromQ;
  try { const s = localStorage.getItem('uts-onco-lang'); if (LANGS.includes(s)) return s; } catch { /* storage unavailable */ }
  return (navigator.language || 'es').toLowerCase().startsWith('es') ? 'es' : (navigator.language || '').toLowerCase().startsWith('en') ? 'en' : 'es';
}
function setLang(l) {
  S.lang = l;
  try { localStorage.setItem('uts-onco-lang', l); } catch { /* ignore */ }
  document.documentElement.lang = l;
  renderAll();
}

// ---------------------------------------------------------------------------
// State changes
// ---------------------------------------------------------------------------
function compute() {
  RES = { untreated: run(ent(), S.params, 'untreated'), treated: run(ent(), S.params, 'treated') };
  S.idx = Math.min(S.idx, RES.untreated.t.length - 1);
}
function setEntity(id, params = {}, preset = null, autoplay = true) {
  if (!ENTITY[id]) return;
  S.entity = id; S.mode = ENTITY[id].mode; S.params = { ...params }; S.preset = preset;
  S.arm = 'untreated'; // default view = the disease
  S.idx = 0;
  compute();
  renderSim();
  syncURL();
  if (autoplay) play(); else pause();
}
function setPreset(key, autoplay = true) {
  const pr = PRESETS[key];
  if (!pr) return;
  setEntity(pr.entity, pr.params, key, autoplay);
}
function setParam(key, value) {
  S.params = { ...sanitize(ent(), S.params), [key]: value };
  S.preset = null;
  compute();
  renderSim(true);
  syncURL();
}
function setArm(arm) { S.arm = arm; renderSim(true); }
function setIndex(i) { S.idx = Math.max(0, Math.min(RES.untreated.t.length - 1, Math.round(i))); updateFrame(); }
function setView(v) { S.view = v; pause(); renderAll(); syncURL(); }

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------
function play() {
  if (S.idx >= RES.untreated.t.length - 1) S.idx = 0;
  S.playing = true; updatePlayButton();
  let last = performance.now();
  let acc = 0;
  const n = RES.untreated.t.length - 1;
  const tick = (now) => {
    if (!S.playing) return;
    acc += ((now - last) / 1000) * S.speed * (n / PLAY_SECONDS);
    last = now;
    if (acc >= 1) { const step = Math.floor(acc); acc -= step; S.idx = Math.min(n, S.idx + step); updateFrame(); }
    if (S.idx >= n) { pause(); return; }
    raf = requestAnimationFrame(tick);
  };
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(tick);
}
function pause() { S.playing = false; cancelAnimationFrame(raf); updatePlayButton(); }
function updatePlayButton() {
  const b = $('#playBtn');
  if (!b) return;
  b.setAttribute('aria-label', S.playing ? T().ui.pause : T().ui.play);
  b.title = b.getAttribute('aria-label');
  b.innerHTML = S.playing ? '<svg viewBox="0 0 14 14"><rect x="2" y="1" width="3.5" height="12" rx="1"/><rect x="8.5" y="1" width="3.5" height="12" rx="1"/></svg>' : '<svg viewBox="0 0 14 14"><path d="M3 1.5v11l9.5-5.5z"/></svg>';
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------
function renderHeader() {
  const t = T().ui;
  document.title = t.title;
  $('#title').textContent = t.title;
  $('#subtitle').textContent = t.subtitle;
  $('#footer').textContent = t.footer;
  $('.skip').textContent = t.skip;
  const views = $('#views');
  views.setAttribute('aria-label', t.viewsLabel);
  views.setAttribute('role', 'tablist');
  views.innerHTML = ['sim', 'overview', 'compare', 'quiz'].map((v) => `<button role="tab" data-view="${v}" aria-selected="${S.view === v}">${esc(t.tabs[v])}</button>`).join('');
  views.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  const lang = $('#lang');
  lang.setAttribute('aria-label', t.langLabel);
  lang.innerHTML = LANGS.map((l) => `<button data-lang="${l}" aria-pressed="${S.lang === l}" lang="${l}">${l.toUpperCase()}</button>`).join('');
  lang.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { setLang(b.dataset.lang); syncURL(); }));
  for (const v of ['sim', 'overview', 'compare', 'quiz']) $('#view-' + v).hidden = S.view !== v;
}

// ---------------------------------------------------------------------------
// Simulator view
// ---------------------------------------------------------------------------
function paramControl(d) {
  const label = E().p[d.key];
  const tag = isModelTagged(S.entity, d.key) ? `<span class="model-tag" title="${esc(T().ui.modelNote)}">${esc(T().ui.model)}</span>` : '';
  const v = sanitize(ent(), S.params)[d.key];
  const id = 'p-' + d.key;
  if (d.type === 'bool') return `<label class="check" for="${id}"><input type="checkbox" id="${id}" data-key="${d.key}" ${v ? 'checked' : ''}> ${esc(label)}${tag}</label>`;
  if (d.type === 'select') return `<div class="param"><label for="${id}">${esc(label)}${tag}</label><select id="${id}" data-key="${d.key}">${d.options.map((o) => `<option value="${o}" ${o === v ? 'selected' : ''}>${esc(T().opt[o])}</option>`).join('')}</select></div>`;
  return `<div class="param"><label for="${id}"><span>${esc(label)}${tag}</span><output id="${id}-out">${esc(fmtParam(d, v))}${d.unit ? ' ' + esc(unitLabel(d.unit)) : ''}</output></label><input type="range" id="${id}" data-key="${d.key}" min="${d.min}" max="${d.max}" step="${d.step}" value="${v}"></div>`;
}

function presetOptions() {
  const t = T();
  const groups = MODES.map((m) => {
    const opts = Object.entries(PRESETS).filter(([, p]) => ENTITY[p.entity].mode === m.id).map(([k]) => `<option value="${k}" ${S.preset === k ? 'selected' : ''}>${esc(t.preset[k])}</option>`).join('');
    return `<optgroup label="${esc(t.mode[m.id].name)}">${opts}</optgroup>`;
  }).join('');
  return `<option value="" ${S.preset ? '' : 'selected'}>${esc(t.ui.chooseScenario)}</option>${groups}`;
}

function renderSim(keepLayout = false) {
  const host = $('#view-sim');
  const t = T();
  const e = ent();
  if (!keepLayout || !$('#simGrid')) {
    const modeTabs = MODES.map((m) => `<button role="tab" data-mode="${m.id}" aria-selected="${S.mode === m.id}">${esc(t.mode[m.id].name)}</button>`).join('');
    const chips = MODES.find((m) => m.id === S.mode).entities.map((x) => `<button data-entity="${x.id}" aria-pressed="${x.id === S.entity}">${esc(E(x.id).name)}</button>`).join('');
    host.innerHTML = `
      <div class="modebar">
        <div class="modes" role="tablist" aria-label="${esc(t.ui.modesLabel)}">${modeTabs}</div>
        <div class="scenario">
          <label for="presetSel" class="muted small">${esc(t.ui.scenario)}</label>
          <select id="presetSel">${presetOptions()}</select>
          <button class="btn" id="copyLink" type="button">${esc(t.ui.copyLink)}</button>
        </div>
      </div>
      <div class="chips" role="group" aria-label="${esc(t.ui.entitiesLabel)}">${chips}</div>
      <div class="sim-grid" id="simGrid">
        <div class="stack controls">
          <div class="card entity-head"><h2 id="entName"></h2><p class="muted" id="entShort"></p></div>
          <div class="card">
            <h3>${esc(t.ui.course)}</h3>
            <div class="arm" role="group" aria-label="${esc(t.ui.course)}">
              <button data-arm="untreated"><i class="sw untreated" aria-hidden="true"></i>${esc(t.arm.untreated)}</button>
              <button data-arm="treated"><i class="sw treated" aria-hidden="true"></i>${esc(t.arm.treated)}</button>
            </div>
            <div class="play">
              <button class="iconbtn" id="playBtn" type="button"></button>
              <button class="iconbtn" id="restartBtn" type="button" aria-label="${esc(t.ui.restart)}" title="${esc(t.ui.restart)}"><svg viewBox="0 0 14 14"><path d="M7 2a5 5 0 1 1-4.6 3H.8L3.4 1.7 6 5H4.1A3.4 3.4 0 1 0 7 3.6z"/></svg></button>
              <input type="range" id="scrub" min="0" step="1" aria-label="${esc(t.ui.time)}">
              <span class="time" id="timeLabel" aria-live="off"></span>
            </div>
            <div class="speed"><label for="speedSel">${esc(t.ui.speed)}</label><select id="speedSel">${[0.5, 1, 2, 4].map((s) => `<option value="${s}" ${s === S.speed ? 'selected' : ''}>${fmtNum(s, 1)}×</option>`).join('')}</select></div>
          </div>
          <div class="card"><h3>${esc(t.ui.params)}</h3><div id="params"></div></div>
        </div>
        <div class="stack">
          <div class="center">
            <div class="schem-host" id="schem"></div>
            <div class="stack">
              <div class="card decision" aria-live="polite"><h3>${esc(t.ui.keyDecision)}</h3><p id="decision"></p></div>
              <div class="tiles" id="tiles"></div>
              <div class="card" id="gaugesCard"><h3>${esc(t.ui.gauges)}</h3><div id="gauges"></div></div>
            </div>
          </div>
        </div>
        <div class="stack side">
          <div class="card"><h3>${esc(t.ui.whatsHappening)}</h3><ol class="steps" id="steps"></ol></div>
          <div class="card"><h3>${esc(t.ui.log)}</h3><ol class="log" id="log"></ol></div>
        </div>
      </div>
      <div class="card charts-card">
        <div class="charts-head">
          <h3>${esc(t.ui.charts)}</h3>
          <div class="legend"><span><i class="sw untreated"></i>${esc(t.ui.legendUntreated)}</span><span><i class="sw treated"></i>${esc(t.ui.legendTreated)}</span></div>
          <button class="btn" id="tableToggle" type="button"></button>
        </div>
        <div class="chart-host" id="charts"></div>
      </div>
      <div class="info-grid">
        <div class="card about"><h3>${esc(t.ui.about)}</h3><dl id="about"></dl></div>
        <div class="card refs"><h3>${esc(t.ui.ref)}</h3><ul id="refs"></ul><p class="backbone" id="backbone"></p></div>
      </div>`;
    host.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { const m = MODES.find((x) => x.id === b.dataset.mode); setEntity(m.entities[0].id); }));
    host.querySelectorAll('[data-entity]').forEach((b) => b.addEventListener('click', () => setEntity(b.dataset.entity)));
    $('#presetSel').addEventListener('change', (ev) => (ev.target.value ? setPreset(ev.target.value) : (S.preset = null, syncURL())));
    $('#copyLink').addEventListener('click', async (ev) => {
      const url = shareURL();
      try { await navigator.clipboard.writeText(url); } catch { /* clipboard unavailable: URL is in the address bar */ }
      ev.target.textContent = T().ui.linkCopied;
      setTimeout(() => { ev.target.textContent = T().ui.copyLink; }, 1600);
    });
    host.querySelectorAll('[data-arm]').forEach((b) => b.addEventListener('click', () => setArm(b.dataset.arm)));
    $('#playBtn').addEventListener('click', () => (S.playing ? pause() : play()));
    $('#restartBtn').addEventListener('click', () => { S.idx = 0; updateFrame(); play(); });
    $('#scrub').addEventListener('input', (ev) => { pause(); setIndex(+ev.target.value); });
    $('#speedSel').addEventListener('change', (ev) => { S.speed = +ev.target.value; });
    $('#tableToggle').addEventListener('click', () => { S.table = !S.table; renderChartsOrTable(); });
  } else {
    const sel = $('#presetSel'); if (sel) sel.innerHTML = presetOptions();
  }
  $('#entName').textContent = E().name;
  $('#entShort').textContent = E().short;
  host.querySelectorAll('[data-arm]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.arm === S.arm)));
  // parameters
  const params = $('#params');
  const focusedKey = document.activeElement?.dataset?.key;
  params.innerHTML = e.params.map(paramControl).join('');
  params.querySelectorAll('[data-key]').forEach((inp) => {
    const d = e.params.find((x) => x.key === inp.dataset.key);
    if (d.type === 'range') {
      inp.addEventListener('input', () => {
        const out = $('#p-' + d.key + '-out');
        out.textContent = fmtParam(d, +inp.value) + (d.unit ? ' ' + unitLabel(d.unit) : '');
        setParam(d.key, +inp.value);
      });
    } else if (d.type === 'bool') inp.addEventListener('change', () => setParam(d.key, inp.checked));
    else inp.addEventListener('change', () => setParam(d.key, inp.value));
  });
  if (focusedKey) { const f = params.querySelector(`[data-key="${focusedKey}"]`); if (f) f.focus(); }
  $('#scrub').max = RES.untreated.t.length - 1;
  updatePlayButton();
  // static info
  $('#about').innerHTML = ['def', 'mech', 'dx', 'tx'].map((k) => `<div><dt>${esc(t.ui[k])}</dt><dd>${esc(E()[k])}</dd></div>`).join('');
  $('#refs').innerHTML = E().ref.map((r) => `<li>${esc(r)}</li>`).join('');
  $('#backbone').textContent = t.mode[S.mode].backbone;
  $('#tableToggle').textContent = S.table ? t.ui.showCharts : t.ui.showTable;
  renderChartsOrTable();
  updateFrame();
}

// Minimum visible span per variable so small wiggles are not exaggerated.
const DOMAIN = { D: [0, 4], survival: [0, 100], pM: [0, 100], pMal: [0, 100], present: [0, 100], prog: [0, 100], residual: [0, 100], bladderRecur: [0, 100], bleedCum: [0, 100], egfr: [0, undefined], size: [0, undefined], largest: [0, undefined], hb: [0, 15], map: [20, 100], hematoma: [0, undefined], surgeries: [0, 5], burden: [0, undefined] };
function panels() {
  return ent().series.map((sd) => ({
    key: sd.key, sd, label: E().s[sd.key], unit: unitLabel(sd.unit), model: isModelTagged(S.entity, sd.key),
    untreated: RES.untreated.s[sd.key], treated: RES.treated.s[sd.key], domain: DOMAIN[sd.key] ?? (sd.unit === '%' ? [0, 100] : [sd.min ?? undefined, undefined]),
  }));
}

function renderChartsOrTable() {
  const host = $('#charts');
  if (!host) return;
  const t = T();
  $('#tableToggle').textContent = S.table ? t.ui.showCharts : t.ui.showTable;
  if (S.table) {
    chartCtl = null;
    const ps = panels();
    const stride = Math.max(1, Math.round(RES.untreated.t.length / 40));
    let rows = '';
    for (let i = 0; i < RES.untreated.t.length; i += stride) {
      rows += `<tr><td>${esc(fmtTime(RES.untreated.t[i]))}</td>${ps.map((p) => `<td>${seriesText(p.sd, p.untreated[i])}</td><td>${seriesText(p.sd, p.treated[i])}</td>`).join('')}</tr>`;
    }
    host.innerHTML = `<div class="datatable-wrap"><table class="data"><caption>${esc(t.ui.tableCaption(E().name))}</caption><thead><tr><th rowspan="2">${esc(t.ui.tableTime)}</th>${ps.map((p) => `<th colspan="2">${esc(p.label)}${p.unit ? ' (' + esc(p.unit) + ')' : ''}</th>`).join('')}</tr><tr>${ps.map(() => `<th>${esc(t.arm.untreated)}</th><th>${esc(t.arm.treated)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
    return;
  }
  chartCtl = renderCharts(host, {
    t: RES.untreated.t, panels: panels(), active: S.arm, index: S.idx,
    fmtNum, fmtTime: (x) => fmtTime(x), axisLabel: t.unitAxis[ent().unit], modelLabel: t.ui.model,
    ariaLabel: `${t.ui.charts}: ${E().name}`,
    onScrub: (i) => { pause(); setIndex(i); },
  });
}

/** Everything that depends on the current time index. */
function updateFrame() {
  if (!RES || S.view !== 'sim' || !$('#tiles')) return;
  const t = T();
  const res = RES[S.arm];
  const other = RES[S.arm === 'untreated' ? 'treated' : 'untreated'];
  const i = S.idx;
  const st = res.states[i];
  const now = res.t[i];
  $('#scrub').value = i;
  $('#timeLabel').textContent = fmtTime(now);
  // diagram
  renderSchematic($('#schem'), ent().schematic(st, res.p), t, S.lang, `${t.ui.schematic}: ${E().name}, ${t.arm[S.arm].toLowerCase()}, ${fmtTime(now)}`);
  // decision
  const dk = decision(S.entity, st, res.p);
  $('#decision').textContent = E().dec[dk] ?? '';
  // tiles
  $('#tiles').innerHTML = ent().series.map((sd) => {
    const v = res.s[sd.key][i];
    const ov = other.s[sd.key][i];
    const tag = isModelTagged(S.entity, sd.key) ? `<span class="model-tag" title="${esc(t.ui.modelNote)}">${esc(t.ui.model)}</span>` : '';
    return `<div class="tile" data-series="${sd.key}"><div class="lab">${esc(E().s[sd.key])}${tag}</div><div class="val" data-value="${v}">${seriesText(sd, v)}<small>${esc(unitLabel(sd.unit))}</small></div><div class="cmp"><i class="sw ${S.arm === 'untreated' ? 'treated' : 'untreated'}"></i>${esc(t.arm[S.arm === 'untreated' ? 'treated' : 'untreated'])}: ${seriesText(sd, ov)}</div></div>`;
  }).join('');
  // gauges
  const gauges = ent().gauges ? ent().gauges(st, res.p) : [];
  $('#gaugesCard').hidden = gauges.length === 0;
  $('#gauges').innerHTML = gauges.map((g) => {
    const banded = g.band !== false;
    const max = banded ? Math.max(g.hi * 1.6, g.value * 1.1, g.lo + 1e-6, 1e-6) : Math.max(g.hi, g.value, 1e-6);
    const out = banded && (g.value > g.hi + 1e-9 || g.value < g.lo - 1e-9);
    const pct = (x) => Math.max(0, Math.min(100, (x / max) * 100));
    const digits = g.unit === '' ? 2 : g.value < 10 ? 1 : 0;
    return `<div class="gauge"><div class="top-row"><span>${esc(E().g[g.key])}</span><span><b>${fmtNum(g.value, digits)}</b> ${esc(unitLabel(g.unit))}${out ? `<span class="flag">${g.value > g.hi ? '↑' : '↓'} ${esc(t.ui.outOfRange)}</span>` : ''}</span></div><div class="meter" ${banded ? `title="${esc(t.ui.normalRange)}: ${fmtNum(g.lo, digits)}–${fmtNum(g.hi, digits)}"` : ''}>${banded ? `<span class="band" style="left:${pct(g.lo)}%;width:${pct(g.hi) - pct(g.lo)}%"></span>` : ''}<span class="fill ${out ? 'out' : ''}" style="width:${pct(g.value)}%"></span></div></div>`;
  }).join('');
  // steps: those that occur in this arm, in narrative order
  const order = Object.keys(E().st);
  const active = new Set(res.stepsAt[i]);
  const occurring = order.filter((k) => k in res.firstStep);
  $('#steps').innerHTML = occurring.map((k) => {
    const cls = active.has(k) ? 'now' : res.firstStep[k] <= now ? 'done' : 'future';
    return `<li class="${cls}" data-step="${k}">${esc(E().st[k])}</li>`;
  }).join('');
  // log
  const evs = res.events.filter((e) => e.t <= now + 1e-9);
  $('#log').innerHTML = evs.length ? evs.map((e, k) => `<li class="${k === evs.length - 1 ? 'latest' : ''}"><time>${esc(fmtTime(e.t))}</time><span>${esc(evText(S.entity, e))}</span></li>`).join('') : `<li class="empty">${esc(t.ui.emptyLog)}</li>`;
  const lg = $('#log'); lg.scrollTop = lg.scrollHeight;
  if (chartCtl) chartCtl.setIndex(i);
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
function renderOverview() {
  const t = T();
  const host = $('#view-overview');
  host.innerHTML = `<p class="intro">${esc(t.ui.overviewIntro)}</p>` + MODES.map((m) => `
    <section class="ov-mode">
      <h2>${esc(t.mode[m.id].name)} <span class="muted small">· ${m.entities.length} ${esc(t.ui.entities)}</span></h2>
      <p>${esc(t.mode[m.id].backbone)}</p>
      <div class="ov-grid">${m.entities.map((x) => `<article class="card ov-card"><h4>${esc(E(x.id).name)}</h4><p>${esc(E(x.id).short)}</p><button class="btn" data-open="${x.id}">${esc(t.ui.open)}</button></article>`).join('')}</div>
    </section>`).join('');
  host.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => { S.view = 'sim'; renderHeader(); setEntity(b.dataset.open); }));
}

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------
function endSummary(id) {
  const e = ENTITY[id];
  const u = run(e, {}, 'untreated');
  const tr = run(e, {}, 'treated');
  return e.series.map((sd) => {
    const a = u.s[sd.key][u.s[sd.key].length - 1];
    const b = tr.s[sd.key][tr.s[sd.key].length - 1];
    return `<span class="end-line">${esc(E(id).s[sd.key])}: ${seriesText(sd, a)} → ${seriesText(sd, b)} ${esc(unitLabel(sd.unit))}</span>`;
  }).join('');
}
function renderCompare() {
  const t = T();
  const host = $('#view-compare');
  const select = (k) => `<select data-slot="${k}" aria-label="${k + 1}"><option value="">${esc(t.ui.none)}</option>${MODES.map((m) => `<optgroup label="${esc(t.mode[m.id].name)}">${m.entities.map((x) => `<option value="${x.id}" ${S.compare[k] === x.id ? 'selected' : ''}>${esc(E(x.id).name)}</option>`).join('')}</optgroup>`).join('')}</select>`;
  const ids = S.compare.filter(Boolean);
  const rows = ['def', 'mech', 'params', 'dx', 'tx', 'end'].map((r) => `<tr><th scope="row">${esc(t.ui.compareRows[r])}</th>${ids.map((id) => {
    if (r === 'params') return `<td>${esc(ENTITY[id].params.map((d) => E(id).p[d.key]).join(' · '))}</td>`;
    if (r === 'end') return `<td>${endSummary(id)}</td>`;
    return `<td>${esc(E(id)[r])}</td>`;
  }).join('')}</tr>`).join('');
  host.innerHTML = `<p class="intro">${esc(t.ui.compareIntro)}</p><div class="cmp-pick">${[0, 1, 2].map(select).join('')}</div>
    <div class="cmp-wrap"><table class="cmp"><thead><tr><th></th>${ids.map((id) => `<th scope="col">${esc(E(id).name)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
  host.querySelectorAll('[data-slot]').forEach((s) => s.addEventListener('change', () => { S.compare[+s.dataset.slot] = s.value || null; renderCompare(); }));
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------
function quizList() { return T().quiz.map((q, i) => ({ ...q, i })).filter((q) => S.quiz.filter === 'all' || q.mode === S.quiz.filter); }
function renderQuiz() {
  const t = T();
  const host = $('#view-quiz');
  const list = quizList();
  const Q = S.quiz;
  const filters = ['all', ...MODES.map((m) => m.id)].map((f) => `<button data-filter="${f}" aria-pressed="${Q.filter === f}">${esc(f === 'all' ? t.ui.quizAll : t.mode[f].name)}</button>`).join('');
  let body;
  if (Q.i >= list.length) {
    body = `<div class="card"><p class="q-text">${esc(t.ui.finished)}</p><p>${esc(t.ui.score(Q.score, list.length))}</p><div class="q-actions" style="margin-top:.8rem"><button class="btn primary" id="qRestart">${esc(t.ui.restartQuiz)}</button></div></div>`;
  } else {
    const q = list[Q.i];
    // deterministic per-question rotation so the right answer is not always in the same place
    const rot = (q.i * 3 + 1) % q.o.length;
    const order = q.o.map((_, k) => (k + rot) % q.o.length);
    const opts = order.map((k) => { const o = q.o[k];
      let cls = '';
      if (Q.checked && k === q.a) cls = 'right';
      else if (Q.checked && k === Q.picked) cls = 'wrong';
      return `<label class="${cls}"><input type="radio" name="qopt" value="${k}" ${Q.picked === k ? 'checked' : ''} ${Q.checked ? 'disabled' : ''}> <span>${esc(o)}</span></label>`;
    }).join('');
    const fb = Q.checked ? `<div class="feedback" role="status"><b>${esc(Q.picked === q.a ? t.ui.correct : t.ui.incorrect)}</b>${esc(q.ex)}</div>` : '';
    body = `<div class="card"><div class="q-meta"><span>${esc(t.ui.question(Q.i + 1, list.length))} · ${esc(t.mode[q.mode].name)}</span><span>${esc(t.ui.score(Q.score, Q.answered))}</span></div>
      <p class="q-text">${esc(q.q)}</p><div class="opts" role="radiogroup">${opts}</div>${fb}
      <div class="q-actions">${Q.checked ? `<button class="btn primary" id="qNext">${esc(t.ui.next)}</button><button class="btn" id="qSim" data-preset="${q.preset}">${esc(t.ui.seeInSim)}</button>` : `<button class="btn primary" id="qCheck" ${Q.picked === null ? 'disabled' : ''}>${esc(t.ui.check)}</button>`}</div></div>`;
  }
  host.innerHTML = `<div class="quiz"><p class="intro">${esc(t.ui.quizIntro)}</p><div class="filters" role="group">${filters}</div>${body}</div>`;
  host.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => { S.quiz = { filter: b.dataset.filter, i: 0, picked: null, checked: false, score: 0, answered: 0 }; renderQuiz(); }));
  host.querySelectorAll('input[name="qopt"]').forEach((r) => r.addEventListener('change', () => { Q.picked = +r.value; renderQuiz(); }));
  $('#qCheck')?.addEventListener('click', () => { Q.checked = true; Q.answered += 1; if (Q.picked === list[Q.i].a) Q.score += 1; renderQuiz(); });
  $('#qNext')?.addEventListener('click', () => { Q.i += 1; Q.picked = null; Q.checked = false; renderQuiz(); });
  $('#qSim')?.addEventListener('click', (ev) => { S.view = 'sim'; renderHeader(); setPreset(ev.target.dataset.preset); });
  $('#qRestart')?.addEventListener('click', () => { S.quiz = { filter: Q.filter, i: 0, picked: null, checked: false, score: 0, answered: 0 }; renderQuiz(); });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
function renderAll() {
  renderHeader();
  if (S.view === 'sim') renderSim();
  if (S.view === 'overview') renderOverview();
  if (S.view === 'compare') renderCompare();
  if (S.view === 'quiz') renderQuiz();
}

let resizeTimer = null;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (S.view === 'sim' && !S.table) renderChartsOrTable(); }, 150); });

function boot() {
  const q = new URLSearchParams(location.search);
  S.lang = initialLang(q);
  document.documentElement.lang = S.lang;
  const view = q.get('view');
  if (['sim', 'overview', 'compare', 'quiz'].includes(view)) S.view = view;
  const preset = q.get('preset');
  const entity = q.get('entity');
  if (preset && PRESETS[preset]) { S.preset = preset; S.entity = PRESETS[preset].entity; S.params = { ...PRESETS[preset].params }; }
  else if (entity && ENTITY[entity]) { S.entity = entity; S.params = decodeParams(q.get('p')); }
  S.mode = ENTITY[S.entity].mode;
  compute();
  renderAll();
  syncURL();
  if (S.view === 'sim' && q.get('autoplay') !== '0') play();
}

// Hook for automated checks (headless browser) and power users.
window.__sim = {
  get state() { return { ...S, params: sanitize(ent(), S.params) }; },
  results: () => RES,
  setPreset: (k) => setPreset(k, false), setEntity: (id, p) => setEntity(id, p, null, false), setParam, setArm, setIndex,
  setTime: (x) => setIndex(indexAt(RES.untreated, x)), setLang, setView, pause, play,
  tiles: () => Object.fromEntries([...document.querySelectorAll('.tile')].map((d) => [d.dataset.series, +d.querySelector('.val').dataset.value])),
};

boot();
