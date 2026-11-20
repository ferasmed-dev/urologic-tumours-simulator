// Shared simulation engine. Pure functions only: no DOM, no randomness.
// Every entity is a plain object:
//   { id, mode, unit, tMax, dt, params:[...], series:[...], init(p, arm),
//     step(st, t, dt, p, arm, emit), steps(st, p, arm) -> [keys],
//     gauges?(st, p) -> [{key, value, lo, hi, unit}], schematic(st, p) -> {...},
//     outcome(st, p, arm) -> {key: value} }
// `arm` is 'untreated' (default view: the disease) or 'treated'.

export const ARMS = ['untreated', 'treated'];

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const lerp = (a, b, f) => a + (b - a) * f;
/** Exponential approach of x toward target with time constant tau. */
export const relax = (x, target, dt, tau) => target + (x - target) * Math.exp(-dt / Math.max(tau, 1e-9));
export const logistic = (x, mid, width) => 1 / (1 + Math.exp(-(x - mid) / width));

/** Piecewise-linear interpolation through [[x, y], ...] (x ascending), flat outside. */
export function interp(points, x) {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x0, y0] = points[i - 1];
    if (x <= x1) return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
  }
  return points[points.length - 1][1];
}

/** Default parameter values for an entity. */
export function defaults(ent) {
  const p = {};
  for (const d of ent.params) p[d.key] = d.def;
  return p;
}

/** Coerce and clamp user params against the entity spec (unknown keys dropped). */
export function sanitize(ent, params = {}) {
  const p = defaults(ent);
  for (const d of ent.params) {
    if (!(d.key in params)) continue;
    let v = params[d.key];
    if (d.type === 'range') {
      v = Number(v);
      if (!Number.isFinite(v)) continue;
      p[d.key] = clamp(v, d.min, d.max);
    } else if (d.type === 'bool') {
      p[d.key] = v === true || v === 'true' || v === 1 || v === '1';
    } else if (d.type === 'select') {
      if (d.options.includes(v)) p[d.key] = v;
    }
  }
  return p;
}

/**
 * Run one arm of an entity. Returns
 *   { t:[], s:{seriesKey:[]}, states:[], events:[{t,key,vars}], stepsAt:[[keys]], firstStep:{key:t}, out }
 */
export function run(ent, params = {}, arm = 'untreated') {
  const p = sanitize(ent, params);
  const n = Math.round(ent.tMax / ent.dt);
  const t = [];
  const s = {};
  for (const sd of ent.series) s[sd.key] = [];
  const states = [];
  const events = [];
  const stepsAt = [];
  const firstStep = {};
  const fired = new Set();
  let cur = 0;
  const emit = (key, vars = {}, once = true) => {
    const id = once ? key : key + '@' + cur;
    if (fired.has(id)) return;
    fired.add(id);
    events.push({ t: cur, key, vars });
  };
  let st = ent.init(p, arm, emit);
  for (let i = 0; i <= n; i++) {
    cur = +(i * ent.dt).toFixed(6);
    if (i > 0) st = ent.step({ ...st }, cur, ent.dt, p, arm, emit);
    t.push(cur);
    for (const sd of ent.series) {
      let v = sd.get ? sd.get(st, p) : ent.get?.[sd.key] ? ent.get[sd.key](st, p) : st[sd.key];
      if (!Number.isFinite(v)) v = 0;
      if (sd.min !== undefined) v = Math.max(sd.min, v);
      if (sd.max !== undefined) v = Math.min(sd.max, v);
      s[sd.key].push(v);
    }
    const keys = ent.steps(st, p, arm, cur);
    for (const k of keys) if (!(k in firstStep)) firstStep[k] = cur;
    stepsAt.push(keys);
    states.push(st);
  }
  const out = ent.outcome ? ent.outcome(st, p, arm, { t, s, events }) : {};
  return { p, arm, t, s, states, events, stepsAt, firstStep, out };
}

/** Run both arms. */
export function runBoth(ent, params = {}) {
  return { untreated: run(ent, params, 'untreated'), treated: run(ent, params, 'treated') };
}

/** Index of the sample closest to time x. */
export function indexAt(res, x) {
  const dt = res.t.length > 1 ? res.t[1] - res.t[0] : 1;
  return clamp(Math.round(x / dt), 0, res.t.length - 1);
}
