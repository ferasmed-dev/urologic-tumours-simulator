// Dependency-free SVG small multiples: one panel per variable, untreated vs treated,
// a playhead at the current time and a crosshair tooltip on hover.

const NS = 'http://www.w3.org/2000/svg';
function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

/** Clean axis ticks ("nice numbers") covering [lo, hi]. */
export function niceTicks(lo, hi, count = 3) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (hi - lo < 1e-9) { const pad = Math.abs(hi) * 0.1 || 1; lo -= pad; hi += pad; }
  const raw = (hi - lo) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
  const start = Math.floor(lo / step) * step;
  const ticks = [];
  for (let v = start; v <= hi + step * 0.5; v += step) ticks.push(+v.toFixed(10));
  return ticks;
}

/**
 * opts: { t:[], panels:[{ key, label, unit, model, untreated:[], treated:[] }], active:'untreated'|'treated',
 *         index, fmtNum(v, digits), fmtTime(t), legend:{untreated, treated}, axisLabel, onScrub(index) }
 */
export function renderCharts(host, opts) {
  host.innerHTML = '';
  const width = Math.max(280, host.clientWidth || 600);
  const panelH = 104;
  const m = { l: 52, r: 16, t: 22, b: 8 };
  const axisH = 30;
  const n = opts.panels.length;
  const H = m.t + n * panelH + axisH;
  const svg = el('svg', { viewBox: `0 0 ${width} ${H}`, width: '100%', height: H, class: 'chart', role: 'img', 'aria-label': opts.ariaLabel });
  host.appendChild(svg);
  const tMax = opts.t[opts.t.length - 1] || 1;
  const x = (tt) => m.l + (tt / tMax) * (width - m.l - m.r);
  const plotW = width - m.l - m.r;

  const panels = opts.panels.map((p, i) => {
    const top = m.t + i * panelH;
    const all = [...p.untreated, ...p.treated];
    let lo = Math.min(...all), hi = Math.max(...all);
    if (p.domain) {
      if (p.domain[0] !== undefined && p.domain[0] !== null) lo = Math.min(lo, p.domain[0]);
      if (p.domain[1] !== undefined && p.domain[1] !== null) hi = Math.max(hi, p.domain[1]);
    }
    const ticks = niceTicks(lo, hi, 3);
    const y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const ph = panelH - 34;
    const y = (v) => top + 18 + ph - ((v - y0) / (y1 - y0 || 1)) * ph;
    const g = el('g', {}, svg);
    // title (text tokens, never series colour)
    const title = el('text', { x: m.l, y: top + 10, class: 'panel-title' }, g);
    title.textContent = p.label + (p.unit ? ` (${p.unit})` : '');
    if (p.model) { const tag = el('tspan', { class: 'model-tag', dx: 6 }, title); tag.textContent = opts.modelLabel; }
    const step = ticks.length > 1 ? ticks[1] - ticks[0] : 1;
    const tickDigits = step < 0.1 ? 2 : step % 1 ? 1 : 0;
    for (const tv of ticks) {
      el('line', { x1: m.l, x2: width - m.r, y1: y(tv), y2: y(tv), class: 'grid' }, g);
      const lab = el('text', { x: m.l - 6, y: y(tv) + 3.5, class: 'tick', 'text-anchor': 'end' }, g);
      lab.textContent = opts.fmtNum(tv, tickDigits);
    }
    const line = (vals, cls) => {
      let d = '';
      vals.forEach((v, k) => { d += (k ? 'L' : 'M') + x(opts.t[k]).toFixed(1) + ' ' + y(v).toFixed(1); });
      el('path', { d, class: cls }, g);
    };
    const inactive = opts.active === 'untreated' ? 'treated' : 'untreated';
    line(p[inactive], `series ${inactive} inactive`);
    line(p[opts.active], `series ${opts.active} active`);
    return { p, y, top };
  });

  // shared x axis
  const axisY = m.t + n * panelH + 4;
  el('line', { x1: m.l, x2: width - m.r, y1: axisY, y2: axisY, class: 'axis' }, svg);
  for (const tv of niceTicks(0, tMax, Math.max(3, Math.min(8, Math.floor(plotW / 90))))) {
    if (tv > tMax + 1e-9) continue;
    el('line', { x1: x(tv), x2: x(tv), y1: axisY, y2: axisY + 4, class: 'axis' }, svg);
    const lab = el('text', { x: x(tv), y: axisY + 16, class: 'tick', 'text-anchor': 'middle' }, svg);
    lab.textContent = opts.fmtNum(tv, tv % 1 ? 1 : 0);
  }
  const ax = el('text', { x: width - m.r, y: axisY + 28, class: 'tick', 'text-anchor': 'end' }, svg);
  ax.textContent = opts.axisLabel;

  // playhead + current-value markers on the active arm
  const ph = el('g', { class: 'playhead' }, svg);
  const drawPlayhead = (idx) => {
    ph.innerHTML = '';
    const xx = x(opts.t[idx]);
    el('line', { x1: xx, x2: xx, y1: m.t, y2: axisY, class: 'playhead-line' }, ph);
    for (const pn of panels) {
      el('circle', { cx: xx, cy: pn.y(pn.p[opts.active][idx]), r: 4.5, class: `marker ${opts.active}` }, ph);
    }
  };
  drawPlayhead(opts.index);

  // hover crosshair + tooltip
  const hover = el('g', { class: 'hover', visibility: 'hidden' }, svg);
  const hit = el('rect', { x: m.l, y: m.t, width: plotW, height: n * panelH, class: 'hit' }, svg);
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  host.appendChild(tip);
  const idxFromEvent = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * width;
    const tt = Math.min(tMax, Math.max(0, ((px - m.l) / plotW) * tMax));
    const dt = opts.t[1] - opts.t[0];
    return Math.min(opts.t.length - 1, Math.max(0, Math.round(tt / dt)));
  };
  const show = (ev) => {
    const k = idxFromEvent(ev);
    hover.setAttribute('visibility', 'visible');
    hover.innerHTML = '';
    const xx = x(opts.t[k]);
    el('line', { x1: xx, x2: xx, y1: m.t, y2: axisY, class: 'crosshair' }, hover);
    for (const pn of panels) {
      el('circle', { cx: xx, cy: pn.y(pn.p.untreated[k]), r: 3.5, class: 'marker untreated' }, hover);
      el('circle', { cx: xx, cy: pn.y(pn.p.treated[k]), r: 3.5, class: 'marker treated' }, hover);
    }
    const rows = panels.map((pn) => `<tr><th>${pn.p.label}</th><td><i class="sw untreated"></i>${opts.fmtNum(pn.p.untreated[k], 1)}</td><td><i class="sw treated"></i>${opts.fmtNum(pn.p.treated[k], 1)}</td></tr>`).join('');
    tip.innerHTML = `<div class="tip-time">${opts.fmtTime(opts.t[k])}</div><table>${rows}</table>`;
    tip.hidden = false;
    const r = host.getBoundingClientRect();
    const left = ev.clientX - r.left;
    tip.style.left = Math.min(Math.max(8, left + 14), r.width - tip.offsetWidth - 8) + 'px';
    tip.style.top = Math.max(0, ev.clientY - r.top - tip.offsetHeight - 12) + 'px';
  };
  hit.addEventListener('pointermove', show);
  hit.addEventListener('pointerleave', () => { hover.setAttribute('visibility', 'hidden'); tip.hidden = true; });
  hit.addEventListener('click', (ev) => opts.onScrub && opts.onScrub(idxFromEvent(ev)));
  return { setIndex: drawPlayhead };
}
