// Upper urinary tract urothelial carcinoma and urethral carcinoma. Pure functions only.
import { clamp, relax } from './core.js';
import { ageHazard, hazardFromProb, wallStage, STAGE_RANK } from './onco.js';
import { cisplatinEligible } from './bladder.js';

// ---------------------------------------------------------------------------
// 1. Upper tract urothelial carcinoma (renal pelvis, ureter)
// ---------------------------------------------------------------------------
/** EAU low-risk criteria: unifocal, < 2 cm, low grade (cytology and biopsy), no invasive features on CT urography. */
export const utucLowRisk = (p) => p.grade === 'low' && p.size < 2 && !p.multifocal && !p.invasionCT;
/** 5-year cancer-specific survival after nephroureterectomy by pT (Model, from EAU-cited series). */
export const UTUC_S5 = { 0: 0.93, 1: 0.9, 2: 0.78, 3: 0.55, 4: 0.15 };
export const utuc = {
  id: 'utuc', mode: 'upper', unit: 'mo', tMax: 60, dt: 0.25, view: 'wall',
  params: [
    { key: 'grade', type: 'select', options: ['low', 'high'], def: 'high' },
    { key: 'size', type: 'range', min: 0.5, max: 5, step: 0.5, def: 2.5, unit: 'cm' },
    { key: 'multifocal', type: 'bool', def: false },
    { key: 'location', type: 'select', options: ['pelvis', 'ureterProximal', 'ureterDistal'], def: 'pelvis' },
    { key: 'invasionCT', type: 'bool', def: false },
    { key: 'egfr0', type: 'range', min: 30, max: 110, step: 5, def: 80, unit: 'mL/min' },
    { key: 'age', type: 'range', min: 40, max: 90, step: 1, def: 70, unit: 'y' },
    { key: 'treatment', type: 'select', options: ['rnu', 'endoscopic', 'segmental'], def: 'rnu' },
    { key: 'adjuvant', type: 'bool', def: true },
  ],
  series: [
    { key: 'survival', unit: '%', min: 0, max: 100 },
    { key: 'D', unit: '', min: 0, max: 4, stage: true },
    { key: 'egfr', unit: 'mL/min', min: 0 },
    { key: 'bladderRecur', unit: '%', min: 0, max: 100 },
  ],
  init(p) {
    const low = utucLowRisk(p);
    const D0 = p.invasionCT ? 1.6 : low ? 0.05 : 0.6;
    return { D0, D: D0, S: 1, Sc: 1, egfr: p.egfr0, done: false, kind: null, bladder: 0, upperRecur: 0, pT: null, low };
  },
  step(st, t, dt, p, arm, emit) {
    const rate = (st.low ? 0.008 : 0.04) * 1.5; // thin wall: invasion progresses faster than in the bladder (Model)
    let hC;
    if (arm === 'untreated') {
      st.D = Math.min(4, st.D + rate * dt);
      hC = 0.002 * Math.exp(1.2 * st.D);
    } else {
      if (!st.done && t >= 1) {
        st.done = true;
        let kind = p.treatment;
        if (kind === 'segmental' && p.location !== 'ureterDistal') { emit('segmentalNotPossible'); kind = 'rnu'; }
        if (kind === 'endoscopic' && !st.low) emit('endoscopicHighRisk');
        st.kind = kind; st.pT = Math.floor(STAGE_RANK[wallStage(st.D)] ?? 0);
        if (kind === 'rnu') { st.egfrTarget = st.egfr * 0.72; emit('rnu'); st.S *= 0.99; }
        else if (kind === 'segmental') { st.egfr *= 0.97; emit('segmental'); }
        else emit('endoscopic');
        if (p.adjuvant) {
          if (kind === 'endoscopic' || st.pT < 2) emit('adjuvantNotIndicated');
          else { st.adj = true; emit(cisplatinEligible(kind === 'rnu' ? st.egfr * 0.72 : st.egfr, false) ? 'adjuvantCis' : 'adjuvantCarbo'); }
        }
      }
      if (!st.done) { st.D = Math.min(4, st.D + rate * dt); hC = 0.002 * Math.exp(1.2 * st.D); }
      else {
        let mult = st.adj ? 0.7 : 1;
        if (st.kind === 'endoscopic') {
          mult *= st.low ? 1.1 : 2.5;
          st.upperRecur = (st.low ? 0.5 : 0.7) * (1 - Math.exp(-(t - 1) / 12));
          st.D = st.low ? 0.05 * (1 - st.upperRecur) + 0.05 : Math.min(4, st.D + rate * 0.5 * dt);
          if (st.upperRecur > 0.3) emit('upperRecur');
        } else st.D = 0;
        hC = hazardFromProb(1 - UTUC_S5[st.pT], 60) * mult;
        st.bladder = 0.35 * (1 - Math.exp(-(t - 1) / 14)); // intravesical recurrence after UTUC (Model: 22–47%)
        if (st.bladder > 0.15) emit('bladderRecur');
      }
    }
    if (st.egfrTarget) { st.egfrTarget -= 0.08 * dt; st.egfr = relax(st.egfr, st.egfrTarget, dt, 3); } else st.egfr -= 0.08 * dt;
    st.Sc *= Math.exp(-hC * dt);
    st.S *= Math.exp(-(hC + ageHazard(p.age + t / 12) / 12) * dt);
    if (st.D >= 1) emit('muscle');
    if (st.egfr < 60) emit('cisplatinLost');
    return st;
  },
  steps(st, p) {
    const k = ['thinWall', 'haematuria'];
    if (st.D >= 1) k.push('invasion');
    if (st.kind === 'rnu') k.push('rnu', 'bladderFollowUp');
    if (st.kind === 'endoscopic') k.push('endoscopic');
    if (st.kind === 'segmental') k.push('segmental');
    if (st.adj) k.push('adjuvant');
    return k;
  },
  get: { survival: (st) => st.S * 100, bladderRecur: (st) => st.bladder * 100 },
  gauges(st, p) { return [{ key: 'size', value: p.size, unit: 'cm', lo: 0, hi: 2 }, { key: 'egfrNow', value: st.egfr, unit: 'mL/min', lo: 60, hi: 120 }]; },
  decision(st, p) { return utucLowRisk(p) ? 'kidneySparing' : 'rnu'; },
  schematic(st, p) {
    return { kind: 'wall', site: p.location === 'pelvis' ? 'pelvis' : 'ureter', D: st.D, papillary: st.kind !== 'rnu' && st.kind !== 'segmental', removed: st.kind === 'rnu' || st.kind === 'segmental', laser: st.kind === 'endoscopic', stage: wallStage(st.D), mets: Math.min(1, 1.1 * (1 - st.Sc)), recur: st.upperRecur };
  },
};

// ---------------------------------------------------------------------------
// 2. Urethral carcinoma
// ---------------------------------------------------------------------------
export const URETHRA_MATCH = { superficial: 'localResection', infiltrating: 'radicalLocal', advanced: 'multimodal' };
const URETHRA_S5 = { superficial: 0.85, infiltrating: 0.55, advanced: 0.25 };
const URETHRA_UNTREATED = { superficial: 48, infiltrating: 18, advanced: 8 };
const URETHRA_D0 = { superficial: 0.3, infiltrating: 1.5, advanced: 3 };
const TX_RANK = { localResection: 0, radicalLocal: 1, multimodal: 2 };
const ST_RANK = { superficial: 0, infiltrating: 1, advanced: 2 };
export const urethral = {
  id: 'urethral', mode: 'upper', unit: 'mo', tMax: 60, dt: 0.25, view: 'wall',
  params: [
    { key: 'sex', type: 'select', options: ['male', 'female'], def: 'male' },
    { key: 'location', type: 'select', options: ['distal', 'proximal'], def: 'distal' },
    { key: 'stage', type: 'select', options: ['superficial', 'infiltrating', 'advanced'], def: 'infiltrating' },
    { key: 'age', type: 'range', min: 40, max: 90, step: 1, def: 70, unit: 'y' },
    { key: 'treatment', type: 'select', options: ['localResection', 'radicalLocal', 'multimodal'], def: 'radicalLocal' },
  ],
  series: [
    { key: 'survival', unit: '%', min: 0, max: 100 },
    { key: 'D', unit: '', min: 0, max: 4, stage: true },
    { key: 'pM', unit: '%', min: 0, max: 100 },
  ],
  init(p) { return { D: URETHRA_D0[p.stage], S: 1, Sc: 1, done: false, pM: 0 }; },
  step(st, t, dt, p, arm, emit) {
    let hC;
    if (arm === 'untreated') {
      const lam = URETHRA_UNTREATED[p.stage] / Math.LN2;
      hC = 1 / lam;
      st.D = Math.min(4, st.D + 0.04 * dt);
    } else {
      if (!st.done && t >= 1) {
        st.done = true; emit(p.treatment, { sex: p.sex });
        const gap = ST_RANK[p.stage] - TX_RANK[p.treatment];
        if (gap > 0) emit('undertreatment'); if (gap < 0) emit('overtreatment');
      }
      const gap = ST_RANK[p.stage] - TX_RANK[p.treatment];
      const mult = gap > 0 ? 2.2 : 1;
      hC = st.done ? hazardFromProb(1 - URETHRA_S5[p.stage], 60) * mult : 1 / (URETHRA_UNTREATED[p.stage] / Math.LN2);
      st.D = st.done ? (gap > 0 ? Math.min(4, URETHRA_D0[p.stage] * 0.6 + 0.02 * (t - 1)) : 0) : URETHRA_D0[p.stage];
    }
    st.Sc *= Math.exp(-hC * dt);
    st.S *= Math.exp(-(hC + ageHazard(p.age + t / 12) / 12) * dt);
    st.pM = Math.min(1, 1.1 * (1 - st.Sc));
    if (p.location === 'distal') emit('squamousDistal');
    return st;
  },
  steps(st, p) {
    const k = ['urethrorrhagia', p.location === 'distal' ? 'squamous' : 'urothelial'];
    if (st.D >= 1) k.push('infiltration');
    if (st.done) k.push('treated');
    return k;
  },
  get: { survival: (st) => st.S * 100, pM: (st) => st.pM * 100 },
  decision(st, p) { return URETHRA_MATCH[p.stage] === p.treatment ? 'matched' : TX_RANK[p.treatment] < ST_RANK[p.stage] ? 'undertreated' : 'overtreated'; },
  schematic(st, p) { return { kind: 'wall', site: 'urethra', D: st.D, papillary: st.D < 1 && !st.done, solid: st.D >= 1, removed: st.done && p.treatment !== 'localResection', laser: st.done && p.treatment === 'localResection', stage: wallStage(st.D), mets: st.pM, sex: p.sex }; },
};

export const UPPER = [utuc, urethral];
