// Public model API: entities by block, presets, key decisions and "Model" tags. Pure (no DOM).
export * from './model/core.js';
export * as onco from './model/onco.js';
export * as renal from './model/renal.js';
export * as bladder from './model/bladder.js';
export * as upper from './model/upper.js';
import { RENAL } from './model/renal.js';
import { BLADDER } from './model/bladder.js';
import { UPPER } from './model/upper.js';
import { wallStage } from './model/onco.js';

export const MODES = [
  { id: 'renal', entities: RENAL },
  { id: 'bladder', entities: BLADDER },
  { id: 'upper', entities: UPPER },
];
export const ENTITIES = MODES.flatMap((m) => m.entities);
export const ENTITY = Object.fromEntries(ENTITIES.map((e) => [e.id, e]));
export const modeOf = (id) => ENTITY[id]?.mode;

/** T category label for a depth-of-invasion value (series flagged `stage: true`). */
export const stageLabel = (v) => wallStage(v);

/** Teaching presets; each has a deep link ?preset=<key>. Expected behaviour is checked in tests/model.test.js. */
export const PRESETS = {
  // Renal masses
  ccSmallSurveillance: { entity: 'clearCell', params: { size0: 1.8, isup: 1, age: 78, treatment: 'surveillance' } },
  ccT1aPartial: { entity: 'clearCell', params: { size0: 3.5 } },
  ccRadicalCkd: { entity: 'clearCell', params: { size0: 5, egfr0: 55, treatment: 'radical' } },
  ccLargeCentral: { entity: 'clearCell', params: { size0: 9, isup: 3, location: 'central', treatment: 'radical' } },
  ccCavalThrombus: { entity: 'clearCell', params: { size0: 8, isup: 3, thrombus: 'ivc', treatment: 'radical' } },
  ccStauffer: { entity: 'clearCell', params: { size0: 7, isup: 3, stauffer: true, treatment: 'radical' } },
  ccAblationElderly: { entity: 'clearCell', params: { size0: 2.8, age: 82, frail: true, treatment: 'ablation' } },
  ccAblationTooBig: { entity: 'clearCell', params: { size0: 5.5, age: 80, treatment: 'ablation' } },
  ccSurveillanceTrigger: { entity: 'clearCell', params: { size0: 3, isup: 3, age: 70, treatment: 'surveillance' } },
  papillaryPartial: { entity: 'papillary', params: {} },
  papillaryHighGrade: { entity: 'papillary', params: { size0: 6, isup: 4, location: 'central', treatment: 'radical' } },
  chromophobeLarge: { entity: 'chromophobe', params: { treatment: 'radical' } },
  oncocytomaSurveillance: { entity: 'oncocytoma', params: {} },
  oncocytomaRadical: { entity: 'oncocytoma', params: { size0: 5, treatment: 'radical' } },
  vhlThreeCm: { entity: 'hereditary', params: {} },
  vhlRadicalEach: { entity: 'hereditary', params: { strategy: 'radicalEach' } },
  bhdSlow: { entity: 'hereditary', params: { syndrome: 'bhd' } },
  hlrccAggressive: { entity: 'hereditary', params: { syndrome: 'hlrcc', size0: 2 } },
  amlSmall: { entity: 'aml', params: { size0: 2.5, treatment: 'surveillance' } },
  amlLargeEmbolization: { entity: 'aml', params: { size0: 6 } },
  amlAneurysm: { entity: 'aml', params: { size0: 3.5, aneurysm: true } },
  amlTscEverolimus: { entity: 'aml', params: { size0: 5, tsc: true, treatment: 'everolimus' } },
  amlEpithelioid: { entity: 'aml', params: { size0: 6, subtype: 'epithelioid', treatment: 'partial' } },
  wunderlichEmbolization: { entity: 'wunderlich', params: {} },
  wunderlichAnticoagDelay: { entity: 'wunderlich', params: { anticoag: true, tEmb: 4 } },
  bosniakI: { entity: 'bosniak', params: { category: 'I' } },
  bosniakIIF: { entity: 'bosniak', params: { category: 'IIF' } },
  bosniakIII: { entity: 'bosniak', params: {} },
  bosniakIV: { entity: 'bosniak', params: { category: 'IV', size0: 5 } },
  mrccIoTki: { entity: 'metastaticRcc', params: {} },
  mrccFavourableTki: { entity: 'metastaticRcc', params: { imdc: 'favourable', treatment: 'sunitinib' } },
  mrccPoorCytoreductive: { entity: 'metastaticRcc', params: { imdc: 'poor', treatment: 'nivoIpi', cytoreductive: true } },
  mrccChemotherapy: { entity: 'metastaticRcc', params: { treatment: 'chemotherapy' } },
  // Bladder
  nmibcLowRisk: { entity: 'nmibc', params: { grade: 'low', stage: 'Ta', treatment: 'single' } },
  nmibcIntermediate: { entity: 'nmibc', params: { grade: 'low', stage: 'Ta', multiple: true, recurrent: true, treatment: 'mmc' } },
  nmibcHighBcg: { entity: 'nmibc', params: {} },
  nmibcHighMmc: { entity: 'nmibc', params: { treatment: 'mmc' } },
  nmibcVeryHighBcg: { entity: 'nmibc', params: { cis: true, large: true } },
  nmibcVeryHighCystectomy: { entity: 'nmibc', params: { cis: true, large: true, treatment: 'cystectomy' } },
  nmibcSmoker: { entity: 'nmibc', params: { grade: 'low', stage: 'Ta', multiple: true, smoking: true, treatment: 'mmc' } },
  cisBcg: { entity: 'cis', params: {} },
  cisBcgFailure: { entity: 'cis', params: { bcgUnresponsive: true } },
  cisCystectomy: { entity: 'cis', params: { bcgUnresponsive: true, treatment: 'cystectomy' } },
  mibcNacCystectomy: { entity: 'mibc', params: {} },
  mibcCisplatinIneligible: { entity: 'mibc', params: { egfr: 45 } },
  mibcTrimodal: { entity: 'mibc', params: { treatment: 'tmt' } },
  mibcTrimodalNotIdeal: { entity: 'mibc', params: { stage: 'T3', hydronephrosis: true, treatment: 'tmt' } },
  mibcFrailUreterostomy: { entity: 'mibc', params: { stage: 'T3', nodes: true, age: 82, frail: true, treatment: 'rc', diversion: 'ureterostomy' } },
  mibcStuder: { entity: 'mibc', params: { age: 58, diversion: 'studer' } },
  mucEvPembro: { entity: 'metastaticUc', params: {} },
  mucGemCisAvelumab: { entity: 'metastaticUc', params: { treatment: 'gemCisAvelumab' } },
  mucCisplatinIneligible: { entity: 'metastaticUc', params: { egfr: 45, treatment: 'gemCis' } },
  mucFrail: { entity: 'metastaticUc', params: { frail: true, treatment: 'gemCarbo' } },
  squamousCatheter: { entity: 'nonUrothelial', params: {} },
  squamousSchistosomiasis: { entity: 'nonUrothelial', params: { risk: 'schistosomiasis', stage: 'T3' } },
  squamousChemoRt: { entity: 'nonUrothelial', params: { treatment: 'chemoRt' } },
  urachalAdenocarcinoma: { entity: 'nonUrothelial', params: { risk: 'urachal', treatment: 'partialUrachal' } },
  // Upper tract and urethra
  utucHighRiskRnu: { entity: 'utuc', params: {} },
  utucLowRiskEndoscopic: { entity: 'utuc', params: { grade: 'low', size: 1.5, treatment: 'endoscopic' } },
  utucHighRiskEndoscopic: { entity: 'utuc', params: { treatment: 'endoscopic' } },
  utucDistalSegmental: { entity: 'utuc', params: { grade: 'low', size: 1.5, location: 'ureterDistal', treatment: 'segmental' } },
  utucInvasiveAdjuvant: { entity: 'utuc', params: { invasionCT: true, egfr0: 70 } },
  urethraSuperficial: { entity: 'urethral', params: { stage: 'superficial', treatment: 'localResection' } },
  urethraInfiltrating: { entity: 'urethral', params: {} },
  urethraUndertreated: { entity: 'urethral', params: { treatment: 'localResection' } },
  urethraFemaleAdvanced: { entity: 'urethral', params: { sex: 'female', location: 'proximal', stage: 'advanced', treatment: 'multimodal' } },
};

/** Key decision at a given state (returns an i18n key under ent.<id>.dec). */
export function decision(id, st, p) { return ENTITY[id]?.decision ? ENTITY[id].decision(st, p) : null; }

/** Parameters/series that are simulator tuning choices or proxies ("Modelo" / "Model" tag in the UI). */
export const MODEL_TAGS = {
  clearCell: ['pM', 'growth'], papillary: ['pM', 'growth'], chromophobe: ['pM', 'growth'], oncocytoma: ['growth'],
  hereditary: ['pM'], aml: ['bleedYear', 'bleedCum'], wunderlich: ['hematoma', 'bleedRate'], bosniak: ['pM'],
  metastaticRcc: ['burden'], nmibc: ['D'], cis: ['D', 'residual'], mibc: ['D', 'pM'], metastaticUc: ['burden'],
  nonUrothelial: ['D', 'pM'], utuc: ['D', 'bladderRecur'], urethral: ['D', 'pM'],
};
export const isModelTagged = (id, key) => (MODEL_TAGS[id] || []).includes(key);
