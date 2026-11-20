// Shared oncology helpers. Pure functions only.
import { clamp } from './core.js';

/** Annual other-cause mortality hazard (Gompertz, Model: close to Spanish life tables at 60–85 y); frailty ×2.5. */
export const ageHazard = (age, frail = false) => Math.exp(-10.6 + 0.095 * age) * (frail ? 2.5 : 1);

/** Constant hazard (per unit of T) that gives a cumulative probability p by time T. */
export const hazardFromProb = (p, T) => -Math.log(1 - clamp(p, 0, 0.999)) / T;

/** Weibull scale λ for a given median and shape k: S(t) = exp(-(t/λ)^k). */
export const weibullScale = (median, k) => median / Math.pow(Math.LN2, 1 / k);
/** Weibull hazard at time t (same unit as the median). */
export function weibullHazard(t, median, k) {
  const lam = weibullScale(median, k);
  const tt = Math.max(t, 1e-3);
  return (k / lam) * Math.pow(tt / lam, k - 1);
}

/**
 * Depth of invasion through a urothelial wall, as a continuous index:
 * 0 = papillary on the surface (Ta) · 0.15–1 = lamina propria (T1) · 1–2 = muscularis propria (T2a < 1.5 ≤ T2b)
 * 2–3 = perivesical / peri-ureteral fat or renal parenchyma (T3) · ≥ 3 = adjacent organs (T4). (Model)
 */
export function wallStage(D, flat = false) {
  if (D < 0.15) return flat ? 'Tis' : 'Ta';
  if (D < 1) return 'T1';
  if (D < 1.5) return 'T2a';
  if (D < 2) return 'T2b';
  if (D < 3) return 'T3';
  return 'T4';
}
/** Numeric index of a T category (for comparisons). */
export const STAGE_RANK = { Tis: 0, Ta: 0, T1: 1, T2a: 2, T2b: 2, T3: 3, T4: 4 };
