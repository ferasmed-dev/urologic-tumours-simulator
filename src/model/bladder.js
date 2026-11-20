// Bladder tumours: non-muscle-invasive papillary tumours, carcinoma in situ, muscle-invasive disease,
// advanced/metastatic urothelial carcinoma and non-urothelial histologies. Pure functions only.
import { clamp, relax } from './core.js';
import { ageHazard, hazardFromProb, weibullHazard, wallStage } from './onco.js';

const yrs = (months) => months / 12;

// ---------------------------------------------------------------------------
// 1. Non-muscle-invasive papillary tumours (Ta, T1): recurrence and progression by risk group
// ---------------------------------------------------------------------------
/** EAU risk group (simplified from the EAU 2021 NMIBC prognostic factor model). */
export function nmibcRisk(p) {
  if (p.grade === 'low' && p.stage === 'Ta' && !p.cis) {
    if (p.multiple && p.large && p.recurrent) return 'high';
    return !p.multiple && !p.large && !p.recurrent ? 'low' : 'intermediate';
  }
  if (p.stage === 'T1' && p.grade === 'high' && (p.cis || p.multiple || p.large)) return 'veryHigh';
  return 'high';
}
/** 5-year probabilities after TURBT alone (Model, from EORTC 2006 recurrence and EAU 2021 progression tables). */
export const NMIBC_R5 = { low: 0.31, intermediate: 0.5, high: 0.7, veryHigh: 0.78 };
export const NMIBC_P5 = { low: 0.01, intermediate: 0.06, high: 0.17, veryHigh: 0.45 };
/** 5-year probability of muscle invasion if the tumour is never resected (Model). */
export const NMIBC_U5 = { low: 0.1, intermediate: 0.2, high: 0.55, veryHigh: 0.85 };
/** Effect of each adjuvant regimen on the recurrence / progression hazard (Model, from meta-analyses: single instillation ≈ −35% recurrence; BCG ≈ −27% progression). */
export function nmibcEffect(tx, risk) {
  const lowInt = risk === 'low' || risk === 'intermediate';
  switch (tx) {
    case 'rtuOnly': return { rec: 1, prog: 1 };
    case 'single': return { rec: lowInt ? 0.65 : 0.9, prog: 1 };
    case 'mmc': return { rec: lowInt ? 0.55 : 0.8, prog: 1 };
    case 'bcg': return { rec: risk === 'low' ? 0.7 : risk === 'intermediate' ? 0.6 : 0.5, prog: lowInt ? 0.9 : 0.65 };
    case 'cystectomy': return { rec: 0, prog: 0.15 };
    default: return { rec: 1, prog: 1 };
  }
}
const RTU_AT = 0.5;
export const nmibc = {
  id: 'nmibc', mode: 'bladder', unit: 'mo', tMax: 60, dt: 0.25, view: 'wall',
  params: [
    { key: 'grade', type: 'select', options: ['low', 'high'], def: 'high' },
    { key: 'stage', type: 'select', options: ['Ta', 'T1'], def: 'T1' },
    { key: 'multiple', type: 'bool', def: false },
    { key: 'large', type: 'bool', def: false },
    { key: 'recurrent', type: 'bool', def: false },
    { key: 'cis', type: 'bool', def: false },
    { key: 'smoking', type: 'bool', def: false },
    { key: 'age', type: 'range', min: 40, max: 90, step: 1, def: 68, unit: 'y' },
    { key: 'treatment', type: 'select', options: ['rtuOnly', 'single', 'mmc', 'bcg', 'cystectomy'], def: 'bcg' },
  ],
  series: [
    { key: 'present', unit: '%', min: 0, max: 100 },
    { key: 'prog', unit: '%', min: 0, max: 100 },
    { key: 'D', unit: '', min: 0, max: 4, stage: true },
    { key: 'survival', unit: '%', min: 0, max: 100 },
  ],
  init(p) { const D0 = p.stage === 'T1' ? 0.5 : 0; return { D0, D: D0, present: 1, prog: 0, S: 1, rtu: false, cyst: false, risk: nmibcRisk(p) }; },
  step(st, t, dt, p, arm, emit) {
    const risk = st.risk;
    const smoke = p.smoking ? { rec: 1.3, prog: 1.2 } : { rec: 1, prog: 1 };
    if (arm === 'untreated') {
      const H = hazardFromProb(NMIBC_U5[risk], 60) * (p.cis ? 1.3 : 1) * smoke.prog;
      st.prog = 1 - Math.exp(-H * t);
      const t50 = Math.LN2 / H;
      st.D = Math.min(4, st.D0 + (1 - st.D0) * t / t50);
      if (st.D >= 1) emit('muscleInvasion');
    } else {
      if (!st.rtu && t >= RTU_AT) {
        st.rtu = true; emit('rtu', { stage: p.stage });
        if (risk !== 'low' && p.grade === 'high') emit('ctStaging');
        if (p.treatment === 'single') emit('single');
        if ((p.treatment === 'mmc' || p.treatment === 'single') && (risk === 'high' || risk === 'veryHigh')) emit('mmcHighRisk');
        if (p.treatment === 'bcg' && risk === 'low') emit('bcgOvertreatment');
        if (p.smoking) emit('smoking');
      }
      if (st.rtu && p.stage === 'T1' && p.treatment !== 'cystectomy' && t >= RTU_AT + 1) emit('reRtu');
      if (p.treatment === 'mmc' && t >= 1.5) emit('mmcInduction');
      if (p.treatment === 'bcg' && t >= 1.5) emit('bcgInduction');
      if (p.treatment === 'bcg' && t >= 4.5) emit('bcgMaintenance');
      if (p.treatment === 'cystectomy' && !st.cyst && t >= 1.5) { st.cyst = true; st.S *= 0.98; emit('cystectomy'); }
      st.D = t < RTU_AT ? st.D0 : 0;
      if (t >= RTU_AT) {
        const s = t - RTU_AT;
        const fx = nmibcEffect(p.treatment, risk);
        const recMult = p.treatment === 'cystectomy' && !st.cyst ? 1 : fx.rec;
        st.present = st.cyst ? 0 : 1 - Math.exp(-hazardFromProb(NMIBC_R5[risk], 1) * recMult * smoke.rec * Math.pow(s / 60, 0.7));
        st.prog = 1 - Math.exp(-hazardFromProb(NMIBC_P5[risk], 60) * fx.prog * smoke.prog * s);
      }
      if (st.rtu && st.present > 0.5) emit('recur50');
    }
    if (st.prog > 0.1) emit('prog10');
    st.S *= Math.exp(-(st.prog * 0.012 + ageHazard(p.age + t / 12) / 12) * dt);
    return st;
  },
  steps(st, p, arm) {
    const k = ['urothelium', p.grade === 'high' ? 'highGrade' : 'lowGrade'];
    if (p.stage === 'T1') k.push('lamina');
    if (st.rtu) k.push('rtu');
    if (st.rtu && p.treatment !== 'rtuOnly' && p.treatment !== 'cystectomy') k.push('instillation');
    if (st.cyst) k.push('cystectomy');
    if (st.present > 0.3 && st.rtu) k.push('recurrence');
    if (st.D >= 1) k.push('muscle');
    return k;
  },
  get: { present: (st) => st.present * 100, prog: (st) => st.prog * 100, survival: (st) => st.S * 100 },
  gauges(st, p) {
    const fx = nmibcEffect(p.treatment, st.risk);
    const sm = p.smoking ? 1.3 : 1;
    const r5 = 1 - Math.exp(-hazardFromProb(NMIBC_R5[st.risk], 1) * fx.rec * sm);
    const p5 = 1 - Math.exp(-hazardFromProb(NMIBC_P5[st.risk], 1) * fx.prog * (p.smoking ? 1.2 : 1));
    return [{ key: 'r5', value: r5 * 100, unit: '%', lo: 0, hi: 0, band: false }, { key: 'p5', value: p5 * 100, unit: '%', lo: 0, hi: 0, band: false }];
  },
  decision(st) { return st.risk; },
  schematic(st, p, arm) {
    return { kind: 'wall', site: 'bladder', D: st.D, papillary: !st.rtu, flatCis: p.cis && !st.rtu, recur: st.rtu ? st.present : 0, instill: st.rtu && ['single', 'mmc'].includes(p.treatment) ? 'mmc' : st.rtu && p.treatment === 'bcg' ? 'bcg' : null, removed: st.cyst, rtuLine: st.rtu && !st.cyst, stage: wallStage(st.D, false), mets: st.prog * 0.3 };
  },
};

// ---------------------------------------------------------------------------
// 2. Carcinoma in situ: flat, high grade, high risk
// ---------------------------------------------------------------------------
export const CIS_P5 = { untreated: 0.54, rtuOnly: 0.5, mmc: 0.45, bcg: 0.15, bcgFail: 0.5, cystectomy: 0.05 };
export const cis = {
  id: 'cis', mode: 'bladder', unit: 'mo', tMax: 60, dt: 0.25, view: 'wall',
  params: [
    { key: 'extensive', type: 'bool', def: false },
    { key: 'bcgUnresponsive', type: 'bool', def: false },
    { key: 'age', type: 'range', min: 40, max: 90, step: 1, def: 68, unit: 'y' },
    { key: 'treatment', type: 'select', options: ['rtuOnly', 'mmc', 'bcg', 'cystectomy'], def: 'bcg' },
  ],
  series: [
    { key: 'residual', unit: '%', min: 0, max: 100 },
    { key: 'prog', unit: '%', min: 0, max: 100 },
    { key: 'D', unit: '', min: 0, max: 4, stage: true },
    { key: 'survival', unit: '%', min: 0, max: 100 },
  ],
  init() { return { residual: 1, prog: 0, D: 0.05, S: 1, rtu: false, cyst: false }; },
  step(st, t, dt, p, arm, emit) {
    const ext = p.extensive ? 1.3 : 1;
    emit('cytology');
    if (arm === 'untreated') {
      const H = hazardFromProb(CIS_P5.untreated, 60) * ext;
      st.prog = 1 - Math.exp(-H * t);
      st.D = Math.min(4, 0.05 + 0.95 * t * H / Math.LN2);
      if (st.D >= 1) emit('muscleInvasion');
    } else {
      if (!st.rtu && t >= RTU_AT) { st.rtu = true; emit('rtu'); }
      const bcgFail = p.treatment === 'bcg' && p.bcgUnresponsive;
      const key = bcgFail ? 'bcgFail' : p.treatment;
      if (p.treatment === 'cystectomy' && !st.cyst && t >= 1.5) { st.cyst = true; st.S *= 0.98; emit('cystectomy'); }
      if (p.treatment === 'bcg' && t >= 1.5) emit('bcgInduction');
      if (p.treatment === 'bcg' && !p.bcgUnresponsive && t >= 4.5) emit('bcgResponse');
      if (bcgFail && t >= 6.5) emit('bcgUnresponsive');
      const target = st.cyst ? 0 : { rtuOnly: 0.8, mmc: 0.6, bcg: 0.25, bcgFail: 0.8, cystectomy: 1 }[key];
      st.residual = st.cyst ? 0 : t >= 1.5 ? relax(st.residual, target, dt, 1.5) : st.residual;
      const H = hazardFromProb(CIS_P5[key], 60) * ext;
      st.prog = 1 - Math.exp(-H * Math.max(0, t - RTU_AT));
      st.D = t < RTU_AT ? 0.05 : st.cyst ? 0 : 0.05 * st.residual;
    }
    if (st.prog > 0.2) emit('prog20');
    st.S *= Math.exp(-(st.prog * 0.012 + ageHazard(p.age + t / 12) / 12) * dt);
    return st;
  },
  steps(st, p) {
    const k = ['flat', 'cytology'];
    if (st.rtu) k.push('biopsies');
    if (p.treatment === 'bcg' && st.rtu) k.push(p.bcgUnresponsive ? 'bcgFailure' : 'bcg');
    if (st.cyst) k.push('cystectomy');
    if (st.D >= 1) k.push('muscle');
    return k;
  },
  get: { residual: (st) => st.residual * 100, prog: (st) => st.prog * 100, survival: (st) => st.S * 100 },
  decision(st, p) { return p.bcgUnresponsive ? 'cystectomyBcgUnresponsive' : p.treatment === 'mmc' || p.treatment === 'rtuOnly' ? 'bcgFirst' : 'bcg'; },
  schematic(st, p) {
    return { kind: 'wall', site: 'bladder', D: st.D, flatCis: !st.cyst && st.residual > 0.3, papillary: false, instill: st.rtu && p.treatment === 'bcg' ? 'bcg' : st.rtu && p.treatment === 'mmc' ? 'mmc' : null, removed: st.cyst, stage: st.D >= 0.15 ? wallStage(st.D) : 'Tis', mets: st.prog * 0.3, extensive: p.extensive };
  },
};

// ---------------------------------------------------------------------------
// 3. Muscle-invasive bladder cancer (cT2–T4a N0–1 M0)
// ---------------------------------------------------------------------------
/** 5-year survival after radical cystectomy alone by cT (Model, from large cystectomy series); N+ hazard ×1.9. */
export const MIBC_S5 = { T2: 0.7, T3: 0.5, T4a: 0.35 };
/** Median survival if untreated (months, Model: most untreated patients die within 2 years). */
export const MIBC_UNTREATED = { T2: 16, T3: 10, T4a: 6 };
const D0_STAGE = { T2: 1.2, T3: 2.3, T4a: 3.2 };
export const cisplatinEligible = (egfr, frail) => egfr >= 60 && !frail;
export const mibc = {
  id: 'mibc', mode: 'bladder', unit: 'mo', tMax: 60, dt: 0.25, view: 'wall',
  params: [
    { key: 'stage', type: 'select', options: ['T2', 'T3', 'T4a'], def: 'T2' },
    { key: 'nodes', type: 'bool', def: false },
    { key: 'egfr', type: 'range', min: 20, max: 110, step: 5, def: 75, unit: 'mL/min' },
    { key: 'age', type: 'range', min: 45, max: 90, step: 1, def: 68, unit: 'y' },
    { key: 'frail', type: 'bool', def: false },
    { key: 'completeRtu', type: 'bool', def: true },
    { key: 'hydronephrosis', type: 'bool', def: false },
    { key: 'treatment', type: 'select', options: ['nacRc', 'rc', 'tmt'], def: 'nacRc' },
    { key: 'diversion', type: 'select', options: ['bricker', 'studer', 'ureterostomy'], def: 'bricker' },
  ],
  series: [
    { key: 'survival', unit: '%', min: 0, max: 100 },
    { key: 'pM', unit: '%', min: 0, max: 100 },
    { key: 'D', unit: '', min: 0, max: 4, stage: true },
  ],
  init(p) { return { D: D0_STAGE[p.stage], S: 1, Sc: 1, pM: 0, phase: 'dx', definitive: null, nac: false, removed: false, tmt: false }; },
  step(st, t, dt, p, arm, emit) {
    const elig = cisplatinEligible(p.egfr, p.frail);
    const nodes = p.nodes ? 1.9 : 1;
    emit('ctStaging');
    let hC;
    if (arm === 'untreated') {
      hC = weibullHazard(t + 0.25, MIBC_UNTREATED[p.stage] * (p.nodes ? 0.7 : 1), 1.3);
      st.D = Math.min(4, D0_STAGE[p.stage] + 0.06 * t);
      st.pM = 1 - Math.exp(-t / ({ T2: 14, T3: 9, T4a: 6 }[p.stage] * (p.nodes ? 0.6 : 1)));
    } else {
      let tx = p.treatment;
      if (tx === 'nacRc' && !elig) { emit('cisIneligible'); tx = 'rc'; }
      if (tx === 'nacRc' && t >= 0.5 && !st.nac) { st.nac = true; emit('nac'); }
      const tDef = tx === 'nacRc' ? 4 : tx === 'rc' ? 1 : 1;
      if (t >= tDef && st.definitive === null) {
        st.definitive = t;
        if (tx === 'tmt') {
          st.tmt = true; emit(elig ? 'tmt' : 'tmtAltSensitizer');
          st.S *= 0.995;
        } else {
          st.removed = true; st.S *= 1 - 0.025 * (p.frail ? 2 : 1);
          emit('cystectomy', { diversion: p.diversion });
        }
      }
      let mult = nodes;
      if (tx === 'nacRc' && elig) mult *= 0.84;
      const ideal = p.stage === 'T2' && p.completeRtu && !p.hydronephrosis;
      if (tx === 'tmt' && !ideal) { mult *= 1.35; emit('tmtNotIdeal'); }
      if (tx === 'tmt' && !ideal && st.definitive !== null && t >= st.definitive + 11) emit('salvage');
      if (st.removed && p.diversion === 'ureterostomy' && t >= st.definitive + 9) emit('stomaStenosis');
      hC = hazardFromProb(1 - MIBC_S5[p.stage], 60) * mult;
      st.D = st.removed ? 0 : st.tmt ? relax(st.D, 0, dt, 1) : st.nac ? relax(st.D, D0_STAGE[p.stage] * 0.7, dt, 2) : D0_STAGE[p.stage];
      st.pM = Math.min(1, 1.1 * (1 - st.Sc));
    }
    st.Sc *= Math.exp(-hC * dt);
    st.S *= Math.exp(-(hC + ageHazard(p.age + t / 12, p.frail) / 12) * dt);
    if (st.pM > 0.5) emit('pM50');
    return st;
  },
  steps(st, p, arm) {
    const k = ['muscle'];
    if (p.nodes) k.push('nodes');
    if (st.nac) k.push('nac');
    if (st.removed) k.push('cystectomy', 'diversion');
    if (st.tmt) k.push('tmt');
    if (st.D >= 2) k.push('fat');
    if (st.D >= 3) k.push('organ');
    return k;
  },
  get: { survival: (st) => st.S * 100, pM: (st) => st.pM * 100 },
  gauges(st, p) { return [{ key: 'egfr', value: p.egfr, unit: 'mL/min', lo: 60, hi: 120 }, { key: 'periop', value: (p.treatment === 'tmt' ? 0.5 : 2.5 * (p.frail ? 2 : 1)), unit: '%', lo: 0, hi: 3 }]; },
  decision(st, p) {
    if (p.treatment === 'tmt') return p.stage === 'T2' && p.completeRtu && !p.hydronephrosis ? 'tmtCandidate' : 'tmtNotIdeal';
    return cisplatinEligible(p.egfr, p.frail) ? 'nacRc' : 'rcNoNac';
  },
  schematic(st, p) {
    return { kind: 'wall', site: 'bladder', D: st.D, papillary: !st.removed && !st.tmt, removed: st.removed, diversion: st.removed ? p.diversion : null, nodes: p.nodes && !st.removed, mets: st.pM, stage: wallStage(st.D), radiation: st.tmt };
  },
};

// ---------------------------------------------------------------------------
// 4. Advanced / metastatic urothelial carcinoma
// ---------------------------------------------------------------------------
/** Median overall survival from start of first line (months): EV-302, JAVELIN Bladder 100, KEYNOTE-052/-045, cisplatin/carboplatin series. */
export const MUC_MEDIAN = { none: 6, gemCis: 14, gemCisAvelumab: 21, gemCarbo: 9.3, evPembro: 31.5, pembrolizumab: 11 };
export const metastaticUc = {
  id: 'metastaticUc', mode: 'bladder', unit: 'mo', tMax: 48, dt: 0.25, view: 'wall',
  params: [
    { key: 'egfr', type: 'range', min: 20, max: 110, step: 5, def: 70, unit: 'mL/min' },
    { key: 'frail', type: 'bool', def: false },
    { key: 'treatment', type: 'select', options: ['evPembro', 'gemCisAvelumab', 'gemCis', 'gemCarbo', 'pembrolizumab'], def: 'evPembro' },
  ],
  series: [
    { key: 'burden', unit: '%', min: 0 },
    { key: 'survival', unit: '%', min: 0, max: 100 },
  ],
  init() { return { B: 100, S: 1, on: false, tx: null, nadir: 100 }; },
  step(st, t, dt, p, arm, emit) {
    const g = Math.LN2 / 2;
    if (arm === 'treated' && !st.on && t >= 0.5) {
      st.on = true; st.t0 = t;
      let tx = p.treatment;
      if ((tx === 'gemCis' || tx === 'gemCisAvelumab') && !cisplatinEligible(p.egfr, p.frail)) { emit('cisIneligible'); tx = p.frail ? 'pembrolizumab' : 'gemCarbo'; }
      if (tx === 'gemCarbo' && p.frail) { emit('platinumIneligible'); tx = 'pembrolizumab'; }
      if (tx === 'evPembro' && p.egfr < 30) { emit('evRenal'); tx = 'pembrolizumab'; }
      st.tx = tx; emit('start', { tx });
      if (tx === 'evPembro') emit('evToxicity');
      if (tx === 'evPembro' || tx === 'pembrolizumab' || tx === 'gemCisAvelumab') emit('immuneAe');
    }
    let kill = 0;
    if (st.on) {
      const s = t - st.t0;
      kill = {
        gemCis: 1.7 * g * Math.exp(-s / 5), gemCarbo: 1.4 * g * Math.exp(-s / 4),
        gemCisAvelumab: 1.7 * g * Math.exp(-s / 5) + (s > 4 ? 0.55 * g : 0),
        evPembro: 1.8 * g * Math.exp(-s / 12) + 0.45 * g, pembrolizumab: 0.75 * g * (1 - Math.exp(-s / 3)),
      }[st.tx];
      if (st.tx === 'gemCisAvelumab' && s >= 4) emit('maintenance');
    }
    st.B = clamp(st.B * Math.exp((g - kill) * dt), 1, 3000);
    st.nadir = Math.min(st.nadir, st.B);
    if (st.on && st.B < 70) emit('response');
    if (st.on && st.nadir < 90 && st.B > 1.2 * st.nadir) emit('progression');
    const median = MUC_MEDIAN[st.on ? st.tx : 'none'];
    st.S *= Math.exp(-weibullHazard(t + 0.5, median, 1.2) * dt);
    st.median = median;
    return st;
  },
  steps(st) {
    const k = ['disseminated'];
    if (st.tx && st.tx.startsWith('gem')) k.push('platinum');
    if (st.tx === 'evPembro') k.push('adc');
    if (st.tx && (st.tx === 'evPembro' || st.tx === 'pembrolizumab' || st.tx === 'gemCisAvelumab')) k.push('checkpoint');
    return k;
  },
  get: { burden: (st) => st.B, survival: (st) => st.S * 100 },
  gauges(st, p) { return [{ key: 'medianOS', value: st.median ?? MUC_MEDIAN.none, unit: 'mo', lo: 0, hi: 0, band: false }, { key: 'egfr', value: p.egfr, unit: 'mL/min', lo: 60, hi: 120 }]; },
  decision(st, p) { return p.egfr < 30 ? 'lowGfr' : 'evPembroFirst'; },
  schematic(st) { return { kind: 'wall', site: 'bladder', D: 3.4, papillary: true, nodes: true, mets: clamp(st.B / 150, 0.15, 1), stage: 'M1', metsFixed: true }; },
};

// ---------------------------------------------------------------------------
// 5. Non-urothelial bladder cancer: squamous cell carcinoma and adenocarcinoma
// ---------------------------------------------------------------------------
export const NONURO_RISK = { schistosomiasis: 'squamous', chronicCatheter: 'squamous', bladderStone: 'squamous', exstrophy: 'adenocarcinoma', urachal: 'adenocarcinoma' };
const NONURO_S5 = { squamous: { T2: 0.6, T3: 0.4, T4a: 0.25 }, adenocarcinoma: { T2: 0.55, T3: 0.35, T4a: 0.2 } };
export const nonUrothelial = {
  id: 'nonUrothelial', mode: 'bladder', unit: 'mo', tMax: 60, dt: 0.25, view: 'wall',
  params: [
    { key: 'risk', type: 'select', options: Object.keys(NONURO_RISK), def: 'chronicCatheter' },
    { key: 'stage', type: 'select', options: ['T2', 'T3', 'T4a'], def: 'T2' },
    { key: 'age', type: 'range', min: 40, max: 90, step: 1, def: 65, unit: 'y' },
    { key: 'treatment', type: 'select', options: ['rc', 'partialUrachal', 'chemoRt'], def: 'rc' },
  ],
  series: [
    { key: 'survival', unit: '%', min: 0, max: 100 },
    { key: 'pM', unit: '%', min: 0, max: 100 },
    { key: 'D', unit: '', min: 0, max: 4, stage: true },
  ],
  init(p) { return { D: D0_STAGE[p.stage], S: 1, Sc: 1, pM: 0, removed: false, done: false }; },
  step(st, t, dt, p, arm, emit) {
    const type = NONURO_RISK[p.risk];
    emit('histology', { type });
    let hC;
    if (arm === 'untreated') {
      hC = weibullHazard(t + 0.25, MIBC_UNTREATED[p.stage] * 0.8, 1.3);
      st.D = Math.min(4, D0_STAGE[p.stage] + 0.07 * t);
      st.pM = 1 - Math.exp(-t / ({ T2: 12, T3: 8, T4a: 5 }[p.stage]));
    } else {
      if (!st.done && t >= 1) {
        st.done = true;
        if (p.treatment === 'chemoRt') { emit('chemoRt'); emit('lessSensitive'); } else { st.removed = p.treatment === 'rc'; st.S *= 0.975; emit(p.treatment === 'rc' ? 'cystectomy' : 'partialUrachal'); }
        if (p.treatment === 'partialUrachal' && p.risk !== 'urachal') emit('partialNotUrachal');
      }
      let mult = 1;
      if (p.treatment === 'chemoRt') mult = 1.5;
      if (p.treatment === 'partialUrachal' && p.risk !== 'urachal') mult = 1.4;
      hC = hazardFromProb(1 - NONURO_S5[type][p.stage], 60) * mult;
      st.D = st.done && p.treatment !== 'chemoRt' ? 0 : st.done ? relax(st.D, D0_STAGE[p.stage] * 0.5, dt, 3) : D0_STAGE[p.stage];
      st.pM = Math.min(1, 1.1 * (1 - st.Sc));
    }
    st.Sc *= Math.exp(-hC * dt);
    st.S *= Math.exp(-(hC + ageHazard(p.age + t / 12) / 12) * dt);
    return st;
  },
  steps(st, p) {
    const type = NONURO_RISK[p.risk];
    const k = [type === 'squamous' ? 'chronicInflammation' : 'glandular', 'aggressive'];
    if (st.removed) k.push('cystectomy');
    return k;
  },
  get: { survival: (st) => st.S * 100, pM: (st) => st.pM * 100 },
  decision(st, p) { return p.risk === 'urachal' ? 'urachal' : 'radicalSurgery'; },
  schematic(st, p) { return { kind: 'wall', site: 'bladder', D: st.D, papillary: false, solid: true, removed: st.removed, diversion: st.removed ? 'bricker' : null, mets: st.pM, stage: wallStage(st.D), radiation: st.done && p.treatment === 'chemoRt' }; },
};

export const BLADDER = [nmibc, cis, mibc, metastaticUc, nonUrothelial];
