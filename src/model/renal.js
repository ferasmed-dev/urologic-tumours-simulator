// Renal masses: renal cell carcinoma subtypes, oncocytoma, hereditary syndromes, angiomyolipoma (and its rupture),
// Bosniak cystic masses and metastatic renal cell carcinoma. Pure functions only.
import { clamp, relax } from './core.js';
import { ageHazard, hazardFromProb, weibullHazard } from './onco.js';

const TREAT_AT = 1; // month at which the chosen treatment starts in the treated arm

// ---------------------------------------------------------------------------
// Growth, metastasis and staging of a solid renal tumour
// ---------------------------------------------------------------------------
/**
 * Histology-specific behaviour (Model).
 * k: exponential growth constant per year by ISUP grade (small renal masses grow ≈ 0.2–0.4 cm/year; high grade faster).
 * met: relative metastatic potential (clear cell 1; papillary and chromophobe lower; oncocytoma none).
 */
export const HIST = {
  clearCell: { k: [0.10, 0.16, 0.25, 0.40], met: 1, graded: true, size0: 5 },
  papillary: { k: [0.07, 0.10, 0.16, 0.28], met: 0.6, graded: true, size0: 3.5 },
  chromophobe: { k: [0.08], met: 0.4, graded: false, size0: 8 },
  oncocytoma: { k: [0.05], met: 0, graded: false, size0: 3.5 },
};
const GRADE_MET = [1, 1.5, 3, 6];
/** Annual hazard of metastasis from an untreated primary of diameter d (cm). Model: < 3 cm ≈ 1–3% at 5 y; rises ≈ 35%/cm. */
export function metHazard(d, isup = 2, met = 1) { return met * 0.004 * Math.exp(0.32 * (d - 3)) * GRADE_MET[clamp(isup, 1, 4) - 1]; }

/** cT category from diameter (TNM 8th edition) plus invasion/thrombus. */
export function rccTStage(d, { thrombus = 'none', isup = 2 } = {}) {
  if (d > 13 && isup >= 4) return 'T4'; // beyond Gerota / contiguous adrenal (Model: very large high-grade)
  if (thrombus === 'ivc') return 'T3b';
  if (thrombus === 'renalVein' || (d > 7 && isup >= 3)) return 'T3a';
  return d <= 4 ? 'T1a' : d <= 7 ? 'T1b' : d <= 10 ? 'T2a' : 'T2b';
}
/** Approximate 5-year recurrence after complete surgery, by pT (ranges from Leibovich/UISS series; Model). */
export const RECUR5 = { T1a: 0.03, T1b: 0.08, T2a: 0.18, T2b: 0.25, T3a: 0.35, T3b: 0.5, T4: 0.7 };
const GRADE_REC = [0.6, 0.8, 1.3, 2];
/** Ablation: probability of complete ablation by size (Model; local control falls above 3–4 cm). */
export const ablationSuccess = (d) => (d <= 3 ? 0.95 : d <= 4 ? 0.85 : 0.6);
export const RCC_TREATMENTS = ['surveillance', 'ablation', 'partial', 'radical'];

function rccEntity(id, hist) {
  const H = HIST[hist];
  const params = [
    { key: 'size0', type: 'range', min: 1, max: 15, step: 0.5, def: H.size0, unit: 'cm' },
  ];
  if (H.graded) params.push({ key: 'isup', type: 'range', min: 1, max: 4, step: 1, def: 2, unit: '' });
  params.push({ key: 'location', type: 'select', options: ['polar', 'central'], def: 'polar' });
  if (hist === 'clearCell') params.push({ key: 'thrombus', type: 'select', options: ['none', 'renalVein', 'ivc'], def: 'none' });
  params.push(
    { key: 'egfr0', type: 'range', min: 20, max: 110, step: 5, def: 80, unit: 'mL/min' },
    { key: 'age', type: 'range', min: 40, max: 90, step: 1, def: 62, unit: 'y' },
    { key: 'frail', type: 'bool', def: false },
  );
  if (hist === 'clearCell') params.push({ key: 'stauffer', type: 'bool', def: false });
  params.push({ key: 'treatment', type: 'select', options: RCC_TREATMENTS, def: hist === 'oncocytoma' ? 'surveillance' : 'partial' });
  const isupOf = (p) => (H.graded ? p.isup : hist === 'chromophobe' ? 2 : 1);
  const kOf = (p) => (H.graded ? H.k[p.isup - 1] : H.k[0]);
  const thrombusOf = (p) => p.thrombus || 'none';

  function operate(st, p, kind, emit) {
    const isup = isupOf(p);
    st.pathT = rccTStage(st.d, { thrombus: thrombusOf(p), isup });
    st.removed = true; st.kind = kind; st.dAtTx = st.d;
    const r5 = clamp(RECUR5[st.pathT] * GRADE_REC[isup - 1], 0, 0.95) * (H.met > 0 ? 1 : 0) * (hist === 'clearCell' ? 1 : H.met + 0.2);
    st.hR = hazardFromProb(r5, 5);
    const frail = p.frail ? 3 : 1;
    if (kind === 'ablation') {
      const s = ablationSuccess(st.d);
      st.localRisk5 = 1 - s;
      st.egfr *= 0.97;
      st.S *= 1 - 0.001 * frail;
      if (st.d > 4) emit('ablationTooBig');
    } else if (kind === 'partial') {
      st.egfr *= 0.92;
      st.S *= 1 - 0.005 * frail;
      if (p.location === 'central' || st.d > 7) emit('partialComplex');
    } else {
      st.egfrTarget = st.egfr * 0.72; st.egfr *= 0.62;
      st.S *= 1 - (thrombusOf(p) === 'ivc' ? 0.05 : 0.01) * frail;
      if (thrombusOf(p) !== 'none') emit('thrombectomy');
      if (st.egfr0 * 0.72 < 45) emit('radicalLowGfr');
    }
    emit('surgery', { kind, stage: st.pathT });
    if (hist === 'oncocytoma') emit('benign');
  }

  return {
    id, mode: 'renal', unit: 'mo', tMax: 60, dt: 0.25, view: 'kidney', hist,
    params,
    series: [
      { key: 'size', unit: 'cm', min: 0 },
      { key: 'pM', unit: '%', min: 0, max: 100 },
      { key: 'egfr', unit: 'mL/min', min: 0 },
      { key: 'survival', unit: '%', min: 0, max: 100 },
    ],
    init(p) {
      const st = { d: p.size0, pM: 0, egfr: p.egfr0, egfr0: p.egfr0, S: 1, Sc: 1, removed: false, kind: null, localRisk5: 0, localRecur: 0, tTx: null, surv: false, dHist: [p.size0], growth: kOf(p) * p.size0 * (1 - p.size0 / 20), stage: rccTStage(p.size0, { thrombus: thrombusOf(p), isup: isupOf(p) }) };
      st.alp = p.stauffer ? 320 : 85; st.ca = p.stauffer ? 11.0 : 9.6; st.hb = p.stauffer ? 17.2 : 14.5;
      return st;
    },
    step(st, t, dt, p, arm, emit) {
      const dy = dt / 12;
      const isup = isupOf(p);
      if (arm === 'treated' && st.tTx === null && t >= TREAT_AT) {
        st.tTx = t;
        if (p.treatment === 'surveillance') { st.surv = true; emit('surveillance'); } else operate(st, p, p.treatment, emit);
      }
      // active surveillance: imaging every 6 months; delayed intervention if ≥ 4 cm or growth > 0.5 cm/year
      if (st.surv && !st.removed && hist !== 'oncocytoma' && (t - st.tTx) > 0 && Math.abs(((t - st.tTx) % 6)) < dt / 2) {
        const g = st.growth;
        if (st.d >= 4 || g > 0.5) { emit('trigger'); operate(st, p, st.d <= 7 && p.location === 'polar' ? 'partial' : 'radical', emit); }
      }
      if (!st.removed) {
        const inc = kOf(p) * st.d * (1 - st.d / 20) * dy;
        st.d += inc; st.growth = inc / dy;
      } else { st.growth = 0; }
      // untreated: size/grade hazard, but never lower than 1.5 × the post-surgical risk of the current stage (venous invasion, T3)
      const hStage = 1.5 * hazardFromProb(clamp(RECUR5[rccTStage(st.d, { thrombus: thrombusOf(p), isup })] * GRADE_REC[isup - 1], 0, 0.95), 5) * (H.met > 0 ? (hist === 'clearCell' ? 1 : H.met + 0.2) : 0);
      const h = st.removed ? st.hR : Math.max(metHazard(st.d, isup, H.met), hStage);
      st.pM += h * (1 - st.pM) * dy;
      if (st.kind === 'ablation') st.localRecur = st.localRisk5 * (1 - Math.exp(-(t - st.tTx) / 24));
      // kidney function: age-related decline; after radical nephrectomy, compensatory hyperfiltration of the other kidney
      if (st.egfrTarget) st.egfrTarget -= 1.2 * dy;
      st.egfr = st.egfrTarget ? relax(st.egfr, st.egfrTarget, dt, 4) : st.egfr - 1.0 * dy;
      st.egfr = Math.max(5, st.egfr);
      // survival: other causes + metastatic disease + CKD excess (Model)
      const hc = st.pM * 0.5;
      const hOther = ageHazard(p.age + t / 12, p.frail) + 0.01 * Math.max(0, (60 - st.egfr) / 15);
      st.Sc *= Math.exp(-hc * dy); st.S *= Math.exp(-(hc + hOther) * dy);
      // paraneoplastic labs (Stauffer, hypercalcaemia, erythrocytosis) resolve after the primary is removed
      if (p.stauffer) { st.alp = relax(st.alp, st.removed ? 85 : 340, dt, 1.5); st.ca = relax(st.ca, st.removed ? 9.6 : 11.2, dt, 1.5); st.hb = relax(st.hb, st.removed ? 14.5 : 17.4, dt, 2); }
      const stg = st.removed ? st.stage : rccTStage(st.d, { thrombus: thrombusOf(p), isup });
      if (stg !== st.stage) { st.stage = stg; emit('stage', { s: stg }, false); }
      if (st.pM > 0.1) emit('pM10');
      if (st.egfr < 45) emit('ckd3b');
      if (p.stauffer && st.removed && st.alp < 130) emit('paraneoplasticResolved');
      if (st.localRecur > 0.1) emit('localRecur');
      return st;
    },
    steps(st, p) {
      const k = ['origin'];
      if (!st.removed) {
        k.push(st.d <= 7 ? 'confined' : 'large');
        if (st.stage === 'T3a' || st.stage === 'T4') k.push('capsule');
        if (thrombusOf(p) !== 'none') k.push('vein');
      }
      if (H.met > 0 && st.pM > 0.03) k.push('metRisk');
      if (p.stauffer) k.push(st.removed ? 'resolved' : 'paraneoplastic');
      if (st.surv && !st.removed) k.push('surveillance');
      if (st.kind === 'ablation') k.push('ablation');
      if (st.kind === 'partial') k.push('nephronSparing');
      if (st.kind === 'radical') k.push('radical');
      return k;
    },
    gauges(st, p) {
      const g = [{ key: 'growth', value: st.growth, unit: 'cm/y', lo: 0, hi: 0.5 }];
      if (st.kind === 'ablation') g.push({ key: 'localRecur', value: st.localRecur * 100, unit: '%', lo: 0, hi: 10 });
      if (p.stauffer) g.push({ key: 'alp', value: st.alp, unit: 'U/L', lo: 40, hi: 130 }, { key: 'ca', value: st.ca, unit: 'mg/dL', lo: 8.5, hi: 10.2 }, { key: 'hb', value: st.hb, unit: 'g/dL', lo: 12, hi: 16.5 });
      return g;
    },
    get: { size: (st) => (st.removed ? 0 : st.d), pM: (st) => st.pM * 100, survival: (st) => st.S * 100 },
    decision(st, p) {
      const d = st.removed ? st.dAtTx : st.d;
      if (hist === 'oncocytoma') return 'oncocytoma';
      if (d <= 2) return 'surveillance';
      if ((p.frail || p.age >= 80) && d <= 4) return 'ablationOrSurveillance';
      if (thrombusOf(p) !== 'none') return 'radicalThrombus';
      if (p.egfr0 < 45 || p.egfr0 * 0.72 < 45) return 'imperativePartial';
      if (d <= 7 && p.location === 'polar') return 'partial';
      return 'radical';
    },
    schematic(st, p) {
      return {
        kind: 'kidney', stage: st.stage, mets: st.pM, thrombus: st.removed ? 'none' : thrombusOf(p),
        kidneys: [{ removed: st.kind === 'radical', scar: st.kind === 'partial', tumours: st.kind === 'radical' || st.kind === 'partial' ? [] : [{ d: st.d, pos: p.location, hist, ablated: st.kind === 'ablation', capsule: st.stage === 'T3a' || st.stage === 'T4' }] }],
        surveillance: st.surv && !st.removed,
      };
    },
  };
}

export const clearCell = rccEntity('clearCell', 'clearCell');
export const papillary = rccEntity('papillary', 'papillary');
export const chromophobe = rccEntity('chromophobe', 'chromophobe');
export const oncocytoma = rccEntity('oncocytoma', 'oncocytoma');

// ---------------------------------------------------------------------------
// Hereditary renal cancer syndromes: many tumours over a lifetime, nephron sparing
// ---------------------------------------------------------------------------
/** every: years between new tumours (Model); HLRCC = a single aggressive tumour. */
export const SYNDROMES = {
  vhl: { hist: 'clearCell', k: 0.12, met: 1, isup: 2, every: 2 },
  hprcc: { hist: 'papillary', k: 0.08, met: 0.6, isup: 2, every: 3 },
  bhd: { hist: 'chromophobe', k: 0.06, met: 0.3, isup: 2, every: 4 },
  hlrcc: { hist: 'papillary', k: 0.45, met: 6, isup: 4, every: 99 },
};
const POS = [0.25, 0.75, 0.5, 0.15, 0.85, 0.4, 0.6, 0.3, 0.7, 0.55];
export const hereditary = {
  id: 'hereditary', mode: 'renal', unit: 'y', tMax: 20, dt: 0.05, view: 'kidney',
  params: [
    { key: 'syndrome', type: 'select', options: Object.keys(SYNDROMES), def: 'vhl' },
    { key: 'size0', type: 'range', min: 1, max: 4, step: 0.5, def: 2, unit: 'cm' },
    { key: 'egfr0', type: 'range', min: 40, max: 120, step: 5, def: 100, unit: 'mL/min' },
    { key: 'strategy', type: 'select', options: ['threeCm', 'immediate', 'radicalEach'], def: 'threeCm' },
  ],
  series: [
    { key: 'largest', unit: 'cm', min: 0 },
    { key: 'pM', unit: '%', min: 0, max: 100 },
    { key: 'egfr', unit: 'mL/min', min: 0 },
    { key: 'surgeries', unit: '', min: 0 },
  ],
  init(p) {
    return { tumours: [{ side: 0, pos: 0.3, d: p.size0, removed: false }], frac: [0.5, 0.5], pM: 0, egfr: p.egfr0, surgeries: 0, nextNew: SYNDROMES[p.syndrome].every, nNew: 1, dialysis: false };
  },
  step(st, t, dt, p, arm, emit) {
    const S = SYNDROMES[p.syndrome];
    st.tumours = st.tumours.map((x) => ({ ...x }));
    if (t >= st.nextNew) {
      const side = st.nNew % 2;
      st.tumours.push({ side, pos: POS[st.nNew % POS.length], d: 0.8, removed: false });
      st.nNew += 1; st.nextNew += S.every;
    }
    for (const x of st.tumours) if (!x.removed && st.frac[x.side] > 0) x.d += S.k * x.d * (1 - x.d / 20) * dt;
    if (arm === 'treated') {
      for (const side of [0, 1]) {
        if (st.frac[side] <= 0) continue;
        const live = st.tumours.filter((x) => x.side === side && !x.removed && x.d >= 1);
        if (!live.length) continue;
        const largest = Math.max(...live.map((x) => x.d));
        if (p.strategy === 'radicalEach') {
          st.frac[side] = 0; st.surgeries += 1; live.forEach((x) => { x.removed = true; });
          st.tumours.filter((x) => x.side === side).forEach((x) => { x.removed = true; });
          emit('radical', {}, false);
        } else if (p.strategy === 'immediate' || largest >= 3 || p.syndrome === 'hlrcc') {
          const loss = st.surgeries >= 2 ? 0.08 : 0.05; // re-operations on the same kidney cost more parenchyma (Model)
          st.frac[side] = Math.max(0, st.frac[side] - loss); st.surgeries += 1;
          live.forEach((x) => { x.removed = true; });
          emit(p.syndrome === 'hlrcc' ? 'promptSurgery' : 'enucleation', {}, false);
        }
      }
      if (p.syndrome === 'hlrcc' && p.strategy === 'threeCm') emit('hlrccNoWait');
    }
    const f = st.frac[0] + st.frac[1];
    st.egfr = f <= 0 ? 0 : Math.max(0, p.egfr0 * Math.pow(f, 0.55) - 0.8 * t);
    if (st.egfr < 15) { st.dialysis = true; emit('dialysis'); }
    const live = st.tumours.filter((x) => !x.removed && st.frac[x.side] > 0);
    // Tumours < 3 cm in VHL/hpRCC/BHD practically never metastasise (basis of the 3-cm rule); HLRCC does (Model)
    const h = live.reduce((a, x) => a + metHazard(x.d, S.isup, S.met) * (x.d < 3 && p.syndrome !== 'hlrcc' ? 0.1 : 1), 0);
    st.pM += h * (1 - st.pM) * dt;
    if (st.pM > 0.1) emit('pM10');
    if (live.some((x) => x.d >= 3)) emit('over3');
    return st;
  },
  steps(st, p) {
    const k = ['germline', 'multifocal'];
    if (st.tumours.some((x) => !x.removed && x.d >= 3)) k.push('over3');
    if (st.surgeries > 0) k.push('nephronSparing');
    if (st.frac.some((f) => f === 0)) k.push('kidneyLost');
    if (st.egfr < 30) k.push('ckd');
    if (p.syndrome === 'hlrcc') k.push('aggressive');
    return k;
  },
  get: {
    largest: (st) => { const l = st.tumours.filter((x) => !x.removed && st.frac[x.side] > 0); return l.length ? Math.max(...l.map((x) => x.d)) : 0; },
    pM: (st) => st.pM * 100,
  },
  gauges(st) { return [{ key: 'tumoursNow', value: st.tumours.filter((x) => !x.removed && st.frac[x.side] > 0).length, unit: '', lo: 0, hi: 0, band: false }]; },
  decision(st, p) { return p.syndrome === 'hlrcc' ? 'hlrccPrompt' : p.strategy === 'radicalEach' ? 'avoidRadical' : 'threeCm'; },
  schematic(st) {
    return {
      kind: 'kidney', mets: st.pM, two: true,
      kidneys: [0, 1].map((side) => ({ removed: st.frac[side] === 0, scar: st.frac[side] < 0.5 && st.frac[side] > 0, tumours: st.tumours.filter((x) => x.side === side && !x.removed).map((x) => ({ d: x.d, pos: 'polar', y: x.pos, hist: 'clearCell' })) })),
    };
  },
};

// ---------------------------------------------------------------------------
// Angiomyolipoma: growth and bleeding risk
// ---------------------------------------------------------------------------
export const AML_SUBTYPES = { classic: { hu: -80, growth: 1, met: 0 }, fatPoor: { hu: 35, growth: 1, met: 0 }, epithelioid: { hu: 60, growth: 6, met: 0.06 } };
/** Annual bleeding hazard (Model): low below 4 cm, rising with size; aneurysm ≥ 5 mm ×3; tuberous sclerosis ×1.5. */
export function amlBleedHazard(d, aneurysm, tsc) { return clamp((d < 4 ? 0.003 : 0.003 + 0.05 * (d - 4) / 4) * (aneurysm ? 3 : 1) * (tsc ? 1.5 : 1), 0, 0.6); }
export const aml = {
  id: 'aml', mode: 'renal', unit: 'y', tMax: 10, dt: 0.02, view: 'kidney',
  params: [
    { key: 'size0', type: 'range', min: 1, max: 12, step: 0.5, def: 5, unit: 'cm' },
    { key: 'subtype', type: 'select', options: Object.keys(AML_SUBTYPES), def: 'classic' },
    { key: 'tsc', type: 'bool', def: false },
    { key: 'aneurysm', type: 'bool', def: false },
    { key: 'treatment', type: 'select', options: ['surveillance', 'embolization', 'partial', 'everolimus'], def: 'embolization' },
  ],
  series: [
    { key: 'size', unit: 'cm', min: 0 },
    { key: 'bleedYear', unit: '%', min: 0 },
    { key: 'bleedCum', unit: '%', min: 0, max: 100 },
  ],
  init(p) { return { d: p.size0, cum: 0, pM: 0, treated: false, kind: null, target: null, tTx: null, everolimusOk: true }; },
  step(st, t, dt, p, arm, emit) {
    const A = AML_SUBTYPES[p.subtype];
    const rate = 0.15 * (p.tsc ? 4 : 1) * A.growth; // cm/year (Model: sporadic ≈ 0.1–0.2, TSC faster)
    if (arm === 'treated' && st.tTx === null && t >= 0.1) {
      st.tTx = t;
      if (p.treatment === 'surveillance') emit('surveillance');
      else if (p.treatment === 'embolization') { st.kind = 'embolization'; st.target = st.d * 0.6; emit('embolization'); }
      else if (p.treatment === 'partial') { st.kind = 'partial'; emit('partial'); }
      else if (p.treatment === 'everolimus') { st.kind = 'everolimus'; st.everolimusOk = p.tsc; if (p.tsc) { st.target = st.d * 0.75; emit('everolimus'); } else emit('everolimusTscOnly'); }
      if (p.subtype === 'epithelioid' && p.treatment !== 'partial') emit('epithelioidSurgery');
    }
    if (arm === 'treated' && p.treatment === 'surveillance' && !st.kind && st.d >= 4) { st.kind = 'embolization'; st.target = st.d * 0.6; emit('trigger'); }
    if (st.kind === 'partial') st.d = 0;
    else if (st.kind === 'everolimus' && st.everolimusOk) st.d = relax(st.d, st.target, dt, 0.4); // continuous mTOR inhibition holds the tumour
    else if (st.kind === 'embolization' && t - st.tTx < 2.5) st.d = relax(st.d, st.target, dt, 0.4);
    else st.d += rate * dt * (st.kind === 'embolization' ? 0.5 : 1);
    let h = st.d > 0 ? amlBleedHazard(st.d, p.aneurysm && st.kind !== 'embolization', p.tsc) : 0;
    if (st.kind === 'embolization') h *= 0.3;
    st.h = h;
    st.cum += h * (1 - st.cum) * dt;
    if (A.met && st.kind !== 'partial') { st.pM += A.met * (1 - st.pM) * dt; if (st.pM > 0.1) emit('epithelioidMets'); }
    if (st.d >= 4) emit('over4');
    if (st.cum > 0.2) emit('bleed20');
    return st;
  },
  steps(st, p) {
    const k = ['components'];
    k.push(p.subtype === 'classic' ? 'fatCt' : 'noFat');
    if (p.tsc) k.push('tsc');
    if (st.d >= 4 || p.aneurysm) k.push('aneurysms');
    if (st.kind === 'embolization') k.push('embolization');
    if (st.kind === 'everolimus' && st.everolimusOk) k.push('mtor');
    if (st.kind === 'partial') k.push('resected');
    return k;
  },
  get: { size: (st) => st.d, bleedYear: (st) => (st.h ?? 0) * 100, bleedCum: (st) => st.cum * 100 },
  gauges(st, p) {
    const g = [{ key: 'hu', value: AML_SUBTYPES[p.subtype].hu, unit: 'HU', lo: -200, hi: -10 }];
    if (p.subtype === 'epithelioid') g.push({ key: 'pM', value: st.pM * 100, unit: '%', lo: 0, hi: 5 });
    return g;
  },
  decision(st, p) {
    if (p.subtype === 'epithelioid') return 'epithelioidSurgery';
    if (p.tsc && st.d >= 3) return 'tscEverolimus';
    return st.d >= 4 || p.aneurysm ? 'treat' : 'observe';
  },
  schematic(st, p) {
    return { kind: 'kidney', kidneys: [{ scar: st.kind === 'partial', tumours: st.d > 0 ? [{ d: st.d, pos: 'polar', hist: p.subtype === 'classic' ? 'amlFat' : 'amlSolid', coil: st.kind === 'embolization', aneurysm: p.aneurysm && st.kind !== 'embolization' }] : [] }], mets: st.pM };
  },
};

// ---------------------------------------------------------------------------
// Wunderlich syndrome: spontaneous retroperitoneal haemorrhage from an angiomyolipoma (hours)
// ---------------------------------------------------------------------------
export const wunderlich = {
  id: 'wunderlich', mode: 'renal', unit: 'h', tMax: 12, dt: 0.05, view: 'kidney',
  params: [
    { key: 'size', type: 'range', min: 4, max: 15, step: 0.5, def: 8, unit: 'cm' },
    { key: 'anticoag', type: 'bool', def: false },
    { key: 'tEmb', type: 'range', min: 0.5, max: 6, step: 0.5, def: 1.5, unit: 'h' },
    { key: 'transfusion', type: 'bool', def: true },
  ],
  series: [
    { key: 'hb', unit: 'g/dL', min: 0 },
    { key: 'map', unit: 'mmHg', min: 0 },
    { key: 'hematoma', unit: 'mL', min: 0 },
  ],
  init() { return { lost: 0, rbc: 0, hb: 13, map: 85, q: 0, embolized: false }; },
  step(st, t, dt, p, arm, emit) {
    const q0 = (300 + 60 * (p.size - 4)) * (p.anticoag ? 1.8 : 1); // mL/h (Model)
    if (arm === 'treated' && !st.embolized && t >= p.tEmb) { st.embolized = true; emit('embolized'); }
    // bleeding slows as the Gerota fascia tamponades; embolization stops it within minutes
    st.q = st.embolized ? st.q * Math.exp(-dt / 0.15) : q0 * Math.exp(-t / 4);
    st.lost += st.q * dt;
    if (arm === 'treated' && p.transfusion && t >= 0.75) { st.rbc += 350 * dt * (st.hb < 9 ? 1 : 0.2); if (!st.tx) { st.tx = true; emit('transfusion'); } }
    const bv = 5000;
    const net = Math.max(0, st.lost - st.rbc);
    st.hb = 13 * (bv - st.lost + st.rbc) / bv; // crystalloid replaces lost volume (Model)
    st.map = clamp(85 - 28 * Math.max(0, (net - 700) / 1000), 25, 90);
    if (net > 750) emit('classII');
    if (net > 1500) emit('classIII');
    if (net > 2000) emit('classIV');
    if (st.embolized && st.q < 20) emit('stopped');
    return st;
  },
  steps(st, p, arm) {
    const k = ['rupture', 'retroperitoneal'];
    if (Math.max(0, st.lost - st.rbc) > 750) k.push('shock');
    if (st.embolized) k.push('embolization');
    if (st.tx) k.push('transfusion');
    return k;
  },
  get: { hematoma: (st) => st.lost },
  gauges(st) { return [{ key: 'bleedRate', value: st.q, unit: 'mL/h', lo: 0, hi: 50 }, { key: 'shockClass', value: Math.max(0, st.lost - st.rbc), unit: 'mL', lo: 0, hi: 750 }]; },
  decision(st) { return st.embolized && st.q < 20 ? 'stabilised' : st.map < 65 ? 'unstable' : 'embolize'; },
  schematic(st, p) {
    return { kind: 'kidney', kidneys: [{ tumours: [{ d: p.size, pos: 'polar', hist: 'amlFat', coil: st.embolized, aneurysm: !st.embolized }] }], hematoma: Math.min(1, st.lost / 2500) };
  },
};

// ---------------------------------------------------------------------------
// Bosniak classification of cystic renal masses
// ---------------------------------------------------------------------------
/** Approximate probability of malignancy per category (Bosniak 2019 / meta-analyses: I–II ≈ 0, IIF ≈ 10%, III ≈ 50%, IV ≈ 90%). */
export const BOSNIAK = {
  I: { pMal: 0, wall: 1, septa: 0, enh: 0 }, II: { pMal: 0, wall: 1.5, septa: 2, enh: 0 },
  IIF: { pMal: 0.1, wall: 2.5, septa: 4, enh: 10 }, III: { pMal: 0.5, wall: 4, septa: 4, enh: 25 }, IV: { pMal: 0.9, wall: 4, septa: 3, enh: 45 },
};
export const bosniak = {
  id: 'bosniak', mode: 'renal', unit: 'mo', tMax: 60, dt: 0.25, view: 'kidney',
  params: [
    { key: 'category', type: 'select', options: Object.keys(BOSNIAK), def: 'III' },
    { key: 'size0', type: 'range', min: 1, max: 10, step: 0.5, def: 4, unit: 'cm' },
  ],
  series: [
    { key: 'size', unit: 'cm', min: 0 },
    { key: 'pMal', unit: '%', min: 0, max: 100 },
    { key: 'pM', unit: '%', min: 0, max: 100 },
  ],
  init(p) { return { d: p.size0, pM: 0, removed: false, imaging: 0, fu: false }; },
  step(st, t, dt, p, arm, emit) {
    const B = BOSNIAK[p.category];
    if (!st.removed) st.d += (0.02 + 0.06 * B.pMal) * st.d * dt / 12;
    let h = B.pMal * metHazard(st.d, 2, 0.5);
    if (arm === 'treated') {
      if ((p.category === 'III' || p.category === 'IV') && !st.removed && t >= TREAT_AT) { st.removed = true; emit('surgery'); if (B.pMal < 0.9) emit('overtreatment'); }
      if (p.category === 'IIF' && [6, 12, 24, 36, 48, 60].some((m) => Math.abs(t - m) < dt / 2)) { st.imaging += 1; st.fu = true; emit('followUp', { n: st.imaging }, false); }
      if (p.category === 'I' || p.category === 'II') emit('discharge');
      if (st.removed) h = 0;
      if (st.fu) h *= 0.15; // upgrades detected on follow-up imaging are operated (Model)
    }
    st.pM += h * (1 - st.pM) * dt / 12;
    if (st.pM > 0.05) emit('pM5');
    return st;
  },
  steps(st, p, arm) {
    const k = ['ct'];
    k.push(p.category === 'I' ? 'simple' : p.category === 'II' ? 'minimal' : p.category === 'IIF' ? 'followup' : 'enhancing');
    if (st.removed) k.push('surgery');
    if (p.category === 'III' || p.category === 'IV') k.push('noBiopsy');
    return k;
  },
  get: { size: (st) => (st.removed ? 0 : st.d), pMal: (st, p) => BOSNIAK[p.category].pMal * 100, pM: (st) => st.pM * 100 },
  gauges(st, p) {
    const B = BOSNIAK[p.category];
    return [{ key: 'wall', value: B.wall, unit: 'mm', lo: 0, hi: 2 }, { key: 'septa', value: B.septa, unit: '', lo: 0, hi: 3 }, { key: 'enh', value: B.enh, unit: 'HU', lo: 0, hi: 20 }];
  },
  decision(st, p) { return { I: 'benign', II: 'benign', IIF: 'followUp', III: 'surgery', IV: 'surgery' }[p.category]; },
  schematic(st, p) { return { kind: 'kidney', kidneys: [{ scar: st.removed, tumours: st.removed ? [] : [{ d: st.d, pos: 'polar', hist: 'cyst', bosniak: p.category }] }], mets: st.pM }; },
};

// ---------------------------------------------------------------------------
// Metastatic renal cell carcinoma: systemic treatment by IMDC risk
// ---------------------------------------------------------------------------
/** Median overall survival (months). Untreated: Model; sunitinib: IMDC validation series (43 / 22.5 / 7.8). */
export const MRCC_MEDIAN = { untreated: { favourable: 26, intermediate: 12, poor: 5 }, sunitinib: { favourable: 43, intermediate: 22.5, poor: 7.8 } };
/** Hazard ratio vs sunitinib (KEYNOTE-426, CheckMate 214 long-term; RECORD-3 for first-line everolimus). Chemotherapy: no activity. */
export const MRCC_HR = {
  chemotherapy: null, sunitinib: { favourable: 1, intermediate: 1, poor: 1 },
  pembroAxi: { favourable: 0.84, intermediate: 0.73, poor: 0.73 }, nivoIpi: { favourable: 1, intermediate: 0.72, poor: 0.72 },
  everolimus: { favourable: 1.15, intermediate: 1.15, poor: 1.15 },
};
const SHAPE = 1.1;
export const metastaticRcc = {
  id: 'metastaticRcc', mode: 'renal', unit: 'mo', tMax: 60, dt: 0.25, view: 'kidney',
  params: [
    { key: 'imdc', type: 'select', options: ['favourable', 'intermediate', 'poor'], def: 'intermediate' },
    { key: 'treatment', type: 'select', options: ['pembroAxi', 'nivoIpi', 'sunitinib', 'everolimus', 'chemotherapy'], def: 'pembroAxi' },
    { key: 'cytoreductive', type: 'bool', def: false },
  ],
  series: [
    { key: 'burden', unit: '%', min: 0 },
    { key: 'survival', unit: '%', min: 0, max: 100 },
  ],
  init() { return { B: 100, S: 1, nadir: 100, on: false, cn: false }; },
  step(st, t, dt, p, arm, emit) {
    const td = { favourable: 6, intermediate: 3, poor: 1.5 }[p.imdc];
    const g = Math.LN2 / td;
    const on = arm === 'treated' && t >= TREAT_AT;
    if (on && !st.on) {
      st.on = true; st.t0 = t;
      if (p.treatment === 'chemotherapy') emit('chemoResistant'); else emit('start', { tx: p.treatment });
      if (p.treatment === 'everolimus') emit('mtorSecondLine');
      if (p.cytoreductive) { st.B *= 0.6; st.S *= 0.98; st.cn = true; emit('cytoreductive'); if (p.imdc !== 'favourable') emit('carmena'); }
    }
    let kill = 0;
    if (on) {
      const s = t - st.t0;
      const eff = p.imdc === 'poor' ? 0.85 : 1;
      kill = eff * { chemotherapy: 0, sunitinib: 1.6 * g * Math.exp(-s / 12), pembroAxi: 1.4 * g * Math.exp(-s / 24) + 0.5 * g, nivoIpi: 1.1 * g * (1 - Math.exp(-s / 3)), everolimus: 1.0 * g * Math.exp(-s / 8) }[p.treatment];
    }
    st.B = clamp(st.B * Math.exp((g - kill) * dt), 1, 2000);
    st.nadir = Math.min(st.nadir, st.B);
    if (on && st.B < 70) emit('response');
    if (on && st.nadir < 90 && st.B > 1.2 * st.nadir) emit('progression');
    let median = MRCC_MEDIAN.untreated[p.imdc];
    let hr = 1;
    if (on && p.treatment !== 'chemotherapy') {
      median = MRCC_MEDIAN.sunitinib[p.imdc];
      hr = MRCC_HR[p.treatment][p.imdc];
    }
    if (st.cn) hr *= { favourable: 1, intermediate: 1.05, poor: 1.2 }[p.imdc];
    const h = weibullHazard(t + 0.5, median, SHAPE) * hr;
    st.S *= Math.exp(-h * dt);
    st.medianNow = median * Math.pow(hr, -1 / SHAPE);
    return st;
  },
  steps(st, p) {
    const k = ['vhlHif', 'resistant'];
    if (st.on && p.treatment !== 'chemotherapy') k.push(p.treatment === 'everolimus' ? 'mtor' : p.treatment === 'sunitinib' ? 'antiangiogenic' : 'checkpoint');
    if (st.cn) k.push('cytoreductive');
    return k;
  },
  get: { burden: (st) => st.B, survival: (st) => st.S * 100 },
  gauges(st, p) { return [{ key: 'medianOS', value: st.medianNow ?? MRCC_MEDIAN.untreated[p.imdc], unit: 'mo', lo: 0, hi: 0, band: false }]; },
  decision(st, p) {
    if (p.treatment === 'chemotherapy') return 'noChemo';
    if (p.cytoreductive && p.imdc === 'poor') return 'avoidCn';
    return p.imdc === 'favourable' ? 'favourable' : 'ioCombination';
  },
  schematic(st, p) { return { kind: 'kidney', kidneys: [{ removed: st.cn, tumours: st.cn ? [] : [{ d: 9, pos: 'polar', hist: 'clearCell', capsule: true }] }], mets: clamp(st.B / 150, 0.15, 1), metsFixed: true, stage: 'M1' }; },
};

export const RENAL = [clearCell, papillary, chromophobe, oncocytoma, hereditary, aml, wunderlich, bosniak, metastaticRcc];
