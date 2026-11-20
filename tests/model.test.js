import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, runBoth, defaults, sanitize, indexAt, ENTITIES, ENTITY, MODES, PRESETS, decision, onco, renal as R, bladder as B, upper as U } from '../src/model.js';

const last = (a) => a[a.length - 1];
const at = (r, k, t) => r.s[k][indexAt(r, t)];
const has = (r, k) => r.events.some((e) => e.key === k);

// ---------------------------------------------------------------------------
// Structure, purity, robustness
// ---------------------------------------------------------------------------
test('three blocks, 16 entities, unique ids, each with a view', () => {
  assert.equal(MODES.length, 3);
  assert.equal(ENTITIES.length, 16);
  assert.equal(new Set(ENTITIES.map((e) => e.id)).size, 16);
  for (const e of ENTITIES) assert.ok(['kidney', 'wall'].includes(e.view), e.id);
});

test('every entity runs both arms with finite, bounded series and a schematic of its view', () => {
  for (const ent of ENTITIES) for (const arm of ['untreated', 'treated']) {
    const r = run(ent, {}, arm);
    for (const sd of ent.series) for (const v of r.s[sd.key]) {
      assert.ok(Number.isFinite(v), `${ent.id}.${sd.key}`);
      if (sd.min !== undefined) assert.ok(v >= sd.min);
      if (sd.max !== undefined) assert.ok(v <= sd.max);
    }
    for (const i of [0, r.t.length - 1]) assert.equal(ent.schematic(r.states[i], r.p).kind, ent.view, ent.id);
  }
});

test('extreme parameter values stay finite', () => {
  for (const ent of ENTITIES) for (const edge of ['min', 'max']) {
    const params = {};
    for (const d of ent.params) {
      if (d.type === 'range') params[d.key] = d[edge];
      if (d.type === 'bool') params[d.key] = edge === 'max';
      if (d.type === 'select') params[d.key] = edge === 'min' ? d.options[0] : d.options[d.options.length - 1];
    }
    for (const arm of ['untreated', 'treated']) {
      const r = run(ent, params, arm);
      for (const [k, a] of Object.entries(r.s)) for (const v of a) assert.ok(Number.isFinite(v), `${ent.id}.${k} ${edge}`);
    }
  }
});

test('runs are pure and deterministic; arms start identical', () => {
  for (const ent of ENTITIES) {
    const p = defaults(ent);
    const copy = JSON.stringify(p);
    const a = run(ent, p, 'treated');
    assert.deepEqual(a.s, run(ent, p, 'treated').s);
    assert.equal(JSON.stringify(p), copy);
    const u = run(ent, p, 'untreated');
    for (const k of Object.keys(u.s)) assert.equal(u.s[k][0], a.s[k][0], `${ent.id}.${k}`);
  }
});

test('sanitize clamps and rejects bad input', () => {
  const p = sanitize(ENTITY.clearCell, { size0: 99, treatment: 'magic', isup: 'x' });
  assert.equal(p.size0, 15); assert.equal(p.treatment, 'partial'); assert.equal(p.isup, 2);
});

test('every entity gives a key decision', () => {
  for (const ent of ENTITIES) for (const arm of ['untreated', 'treated']) {
    const r = run(ent, {}, arm);
    for (const i of [0, r.t.length - 1]) assert.equal(typeof decision(ent.id, r.states[i], r.p), 'string', ent.id);
  }
});

// ---------------------------------------------------------------------------
// Staging and classification boundaries
// ---------------------------------------------------------------------------
test('renal cT categories follow TNM 8 size cut-offs and venous invasion', () => {
  assert.equal(R.rccTStage(4), 'T1a'); assert.equal(R.rccTStage(4.1), 'T1b'); assert.equal(R.rccTStage(7), 'T1b');
  assert.equal(R.rccTStage(7.5), 'T2a'); assert.equal(R.rccTStage(10.5), 'T2b');
  assert.equal(R.rccTStage(3, { thrombus: 'renalVein' }), 'T3a'); assert.equal(R.rccTStage(3, { thrombus: 'ivc' }), 'T3b');
});

test('urothelial wall depth maps to Ta/Tis, T1, T2a/b, T3, T4', () => {
  assert.equal(onco.wallStage(0), 'Ta'); assert.equal(onco.wallStage(0, true), 'Tis'); assert.equal(onco.wallStage(0.5), 'T1');
  assert.equal(onco.wallStage(1.2), 'T2a'); assert.equal(onco.wallStage(1.7), 'T2b'); assert.equal(onco.wallStage(2.5), 'T3'); assert.equal(onco.wallStage(3.5), 'T4');
});

test('NMIBC risk groups (simplified EAU 2021)', () => {
  const r = (x) => B.nmibcRisk({ grade: 'low', stage: 'Ta', multiple: false, large: false, recurrent: false, cis: false, ...x });
  assert.equal(r({}), 'low');
  assert.equal(r({ multiple: true }), 'intermediate');
  assert.equal(r({ grade: 'high' }), 'high');
  assert.equal(r({ grade: 'high', stage: 'T1' }), 'high');
  assert.equal(r({ grade: 'high', stage: 'T1', cis: true }), 'veryHigh');
});

test('Bosniak malignancy rises I → IV; UTUC low-risk criteria', () => {
  const p = ['I', 'II', 'IIF', 'III', 'IV'].map((c) => R.BOSNIAK[c].pMal);
  for (let i = 1; i < p.length; i++) assert.ok(p[i] >= p[i - 1]);
  assert.equal(p[0], 0); assert.equal(p[1], 0);
  assert.ok(U.utucLowRisk({ grade: 'low', size: 1.5, multifocal: false, invasionCT: false }));
  assert.ok(!U.utucLowRisk({ grade: 'low', size: 2.5, multifocal: false, invasionCT: false }));
  assert.ok(!U.utucLowRisk({ grade: 'high', size: 1, multifocal: false, invasionCT: false }));
});

// ---------------------------------------------------------------------------
// Mechanisms
// ---------------------------------------------------------------------------
test('metastatic risk rises with size and grade; oncocytoma never metastasises', () => {
  assert.ok(R.metHazard(7, 2) > R.metHazard(3, 2));
  assert.ok(R.metHazard(5, 4) > R.metHazard(5, 1));
  assert.equal(R.metHazard(10, 4, R.HIST.oncocytoma.met), 0);
});

test('partial nephrectomy preserves more kidney function than radical, with similar oncological control at ≤ 7 cm', () => {
  const pn = run(ENTITY.clearCell, { size0: 5, treatment: 'partial' }, 'treated');
  const rn = run(ENTITY.clearCell, { size0: 5, treatment: 'radical' }, 'treated');
  assert.ok(last(pn.s.egfr) > last(rn.s.egfr) + 10);
  assert.ok(Math.abs(last(pn.s.pM) - last(rn.s.pM)) < 1);
});

test('ablation controls small masses better than large ones', () => {
  assert.ok(R.ablationSuccess(2.5) > R.ablationSuccess(5));
});

test('AML bleeding risk jumps above 4 cm and with aneurysms', () => {
  assert.ok(R.amlBleedHazard(6, false, false) > 5 * R.amlBleedHazard(3, false, false));
  assert.ok(R.amlBleedHazard(3, true, false) > R.amlBleedHazard(3, false, false));
});

test('BCG lowers progression in high-risk NMIBC; mitomycin does not; single instillation lowers recurrence in low risk', () => {
  assert.ok(B.nmibcEffect('bcg', 'high').prog < 1);
  assert.equal(B.nmibcEffect('mmc', 'high').prog, 1);
  assert.ok(B.nmibcEffect('single', 'low').rec < 0.7);
});

test('cisplatin eligibility needs eGFR ≥ 60 and a fit patient', () => {
  assert.ok(B.cisplatinEligible(75, false));
  assert.ok(!B.cisplatinEligible(55, false));
  assert.ok(!B.cisplatinEligible(80, true));
});

test('nephroureterectomy costs kidney function; endoscopic treatment spares it', () => {
  const rnu = run(ENTITY.utuc, { treatment: 'rnu' }, 'treated');
  const urs = run(ENTITY.utuc, { grade: 'low', size: 1.5, treatment: 'endoscopic' }, 'treated');
  assert.ok(last(rnu.s.egfr) < 0.8 * rnu.s.egfr[0]);
  assert.ok(last(urs.s.egfr) > 0.9 * urs.s.egfr[0]);
});

test('treatment improves survival in every survival-tracking entity (default scenario)', () => {
  for (const id of ['mibc', 'metastaticUc', 'nonUrothelial', 'utuc', 'urethral', 'metastaticRcc', 'nmibc', 'cis']) {
    const b = runBoth(ENTITY[id], {});
    assert.ok(last(b.treated.s.survival) > last(b.untreated.s.survival), id);
  }
});

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------
const EXPECT = {
  ccSmallSurveillance: (b) => has(b.treated, 'surveillance') && !has(b.treated, 'surgery') && last(b.treated.s.pM) < 5,
  ccT1aPartial: (b) => last(b.treated.s.pM) < last(b.untreated.s.pM) && has(b.untreated, 'stage'),
  ccRadicalCkd: (b) => has(b.treated, 'radicalLowGfr') && last(b.treated.s.egfr) < 45,
  ccLargeCentral: (b) => last(b.treated.s.survival) > last(b.untreated.s.survival) && last(b.untreated.s.pM) > 50,
  ccCavalThrombus: (b) => has(b.treated, 'thrombectomy') && last(b.treated.s.pM) < last(b.untreated.s.pM),
  ccStauffer: (b) => has(b.treated, 'paraneoplasticResolved') && !has(b.untreated, 'paraneoplasticResolved'),
  ccAblationElderly: (b) => has(b.treated, 'surgery') && !has(b.treated, 'ablationTooBig') && last(b.treated.s.egfr) > 70,
  ccAblationTooBig: (b) => has(b.treated, 'ablationTooBig') && has(b.treated, 'localRecur'),
  ccSurveillanceTrigger: (b) => has(b.treated, 'trigger') && has(b.treated, 'surgery'),
  papillaryPartial: (b) => last(b.untreated.s.pM) < last(run(ENTITY.clearCell, { size0: 3.5 }, 'untreated').s.pM) && last(b.treated.s.size) === 0,
  papillaryHighGrade: (b) => last(b.untreated.s.pM) > 30 && last(b.treated.s.pM) < last(b.untreated.s.pM),
  chromophobeLarge: (b) => last(b.untreated.s.pM) < last(run(ENTITY.clearCell, { size0: 8, isup: 2 }, 'untreated').s.pM),
  oncocytomaSurveillance: (b) => last(b.untreated.s.pM) === 0 && !has(b.treated, 'surgery'),
  oncocytomaRadical: (b) => has(b.treated, 'benign') && last(b.treated.s.egfr) < last(b.untreated.s.egfr),
  vhlThreeCm: (b) => last(b.treated.s.pM) < 5 && last(b.untreated.s.pM) > 20 && last(b.treated.s.egfr) > 40,
  vhlRadicalEach: (b) => has(b.treated, 'dialysis'),
  bhdSlow: (b) => last(b.untreated.s.largest) < last(run(ENTITY.hereditary, {}, 'untreated').s.largest),
  hlrccAggressive: (b) => last(b.untreated.s.pM) > 80 && has(b.treated, 'promptSurgery'),
  amlSmall: (b) => last(b.untreated.s.bleedCum) < 5,
  amlLargeEmbolization: (b) => last(b.treated.s.bleedCum) < 0.2 * last(b.untreated.s.bleedCum) && last(b.treated.s.size) < last(b.untreated.s.size),
  amlAneurysm: (b) => last(b.untreated.s.bleedCum) > 2 * last(run(ENTITY.aml, { size0: 3.5 }, 'untreated').s.bleedCum),
  amlTscEverolimus: (b) => last(b.treated.s.size) < b.treated.s.size[0] && has(b.treated, 'everolimus'),
  amlEpithelioid: (b) => has(b.untreated, 'epithelioidMets') && last(b.treated.s.size) === 0,
  wunderlichEmbolization: (b) => last(b.treated.s.map) > 75 && last(b.untreated.s.map) < 55 && has(b.treated, 'stopped'),
  wunderlichAnticoagDelay: (b) => has(b.treated, 'classIII') && last(b.treated.s.hematoma) > last(run(ENTITY.wunderlich, {}, 'treated').s.hematoma),
  bosniakI: (b) => last(b.treated.s.pM) === 0 && has(b.treated, 'discharge'),
  bosniakIIF: (b) => b.treated.events.filter((e) => e.key === 'followUp').length === 6,
  bosniakIII: (b) => has(b.treated, 'overtreatment') && last(b.treated.s.size) === 0,
  bosniakIV: (b) => has(b.treated, 'surgery') && last(b.untreated.s.pM) > last(b.treated.s.pM),
  mrccIoTki: (b) => has(b.treated, 'response') && last(b.treated.s.survival) > 2 * last(b.untreated.s.survival),
  mrccFavourableTki: (b) => last(b.treated.s.survival) > last(b.untreated.s.survival),
  mrccPoorCytoreductive: (b) => has(b.treated, 'carmena'),
  mrccChemotherapy: (b) => has(b.treated, 'chemoResistant') && Math.abs(last(b.treated.s.survival) - last(b.untreated.s.survival)) < 0.01,
  nmibcLowRisk: (b) => has(b.treated, 'single') && last(b.treated.s.prog) < 2,
  nmibcIntermediate: (b) => last(b.treated.s.present) < 40,
  nmibcHighBcg: (b) => has(b.treated, 'reRtu') && has(b.treated, 'bcgMaintenance') && last(b.treated.s.prog) < 15 && has(b.untreated, 'muscleInvasion'),
  nmibcHighMmc: (b) => has(b.treated, 'mmcHighRisk') && last(b.treated.s.prog) > last(runBoth(ENTITY.nmibc, {}).treated.s.prog),
  nmibcVeryHighBcg: (b) => last(b.treated.s.prog) > 25 && at(b.untreated, 'D', 24) >= 1,
  nmibcVeryHighCystectomy: (b) => last(b.treated.s.present) === 0 && last(b.treated.s.prog) < 10,
  nmibcSmoker: (b) => last(b.treated.s.present) > last(runBoth(ENTITY.nmibc, { grade: 'low', stage: 'Ta', multiple: true, treatment: 'mmc' }).treated.s.present),
  cisBcg: (b) => has(b.treated, 'bcgResponse') && last(b.treated.s.prog) < 20,
  cisBcgFailure: (b) => has(b.treated, 'bcgUnresponsive') && last(b.treated.s.prog) > 40,
  cisCystectomy: (b) => last(b.treated.s.residual) === 0,
  mibcNacCystectomy: (b) => has(b.treated, 'nac') && has(b.treated, 'cystectomy') && last(b.treated.s.survival) > 60 && last(b.untreated.s.survival) < 5,
  mibcCisplatinIneligible: (b) => has(b.treated, 'cisIneligible') && last(b.treated.s.survival) < last(runBoth(ENTITY.mibc, {}).treated.s.survival),
  mibcTrimodal: (b) => has(b.treated, 'tmt') && !has(b.treated, 'cystectomy'),
  mibcTrimodalNotIdeal: (b) => has(b.treated, 'tmtNotIdeal') && has(b.treated, 'salvage'),
  mibcFrailUreterostomy: (b) => has(b.treated, 'stomaStenosis') && last(b.treated.s.survival) < 20,
  mibcStuder: (b) => b.treated.events.find((e) => e.key === 'cystectomy')?.vars.diversion === 'studer',
  mucEvPembro: (b) => last(b.treated.s.survival) > 25 && has(b.treated, 'evToxicity'),
  mucGemCisAvelumab: (b) => has(b.treated, 'maintenance') && last(b.treated.s.survival) < last(runBoth(ENTITY.metastaticUc, {}).treated.s.survival),
  mucCisplatinIneligible: (b) => has(b.treated, 'cisIneligible') && b.treated.states.at(-1).tx === 'gemCarbo',
  mucFrail: (b) => has(b.treated, 'platinumIneligible') && b.treated.states.at(-1).tx === 'pembrolizumab',
  squamousCatheter: (b) => last(b.treated.s.survival) < last(runBoth(ENTITY.mibc, { treatment: 'rc' }).treated.s.survival),
  squamousSchistosomiasis: (b) => last(b.treated.s.survival) < last(runBoth(ENTITY.nonUrothelial, {}).treated.s.survival),
  squamousChemoRt: (b) => has(b.treated, 'lessSensitive') && last(b.treated.s.survival) < last(runBoth(ENTITY.nonUrothelial, {}).treated.s.survival),
  urachalAdenocarcinoma: (b) => has(b.treated, 'partialUrachal') && !has(b.treated, 'partialNotUrachal'),
  utucHighRiskRnu: (b) => has(b.treated, 'rnu') && has(b.treated, 'bladderRecur') && last(b.treated.s.survival) > last(b.untreated.s.survival) + 30,
  utucLowRiskEndoscopic: (b) => has(b.treated, 'upperRecur') && last(b.treated.s.egfr) > 70,
  utucHighRiskEndoscopic: (b) => has(b.treated, 'endoscopicHighRisk') && last(b.treated.s.survival) < last(runBoth(ENTITY.utuc, {}).treated.s.survival),
  utucDistalSegmental: (b) => has(b.treated, 'segmental') && last(b.treated.s.egfr) > 70,
  utucInvasiveAdjuvant: (b) => has(b.treated, 'adjuvantCarbo') && has(b.treated, 'cisplatinLost'),
  urethraSuperficial: (b) => last(b.treated.s.survival) > 70,
  urethraInfiltrating: (b) => last(b.treated.s.survival) > last(b.untreated.s.survival) + 20,
  urethraUndertreated: (b) => has(b.treated, 'undertreatment') && last(b.treated.s.survival) < last(runBoth(ENTITY.urethral, {}).treated.s.survival),
  urethraFemaleAdvanced: (b) => last(b.treated.s.survival) < 40,
};

test('every preset is valid and behaves as documented', () => {
  assert.deepEqual(Object.keys(EXPECT).sort(), Object.keys(PRESETS).sort());
  for (const [k, pr] of Object.entries(PRESETS)) {
    const ent = ENTITY[pr.entity];
    const p = sanitize(ent, pr.params);
    for (const [pk, v] of Object.entries(pr.params)) assert.equal(p[pk], v, `${k}.${pk}`);
    assert.ok(EXPECT[k](runBoth(ent, pr.params)), k);
  }
});
