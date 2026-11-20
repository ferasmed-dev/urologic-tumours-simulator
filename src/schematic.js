// Hand-drawn SVG schematics: the kidney in the retroperitoneum (renal masses) and the urothelial wall
// in cross-section (bladder, upper tract, urethra). Pure rendering from a plain description produced by the model.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const f1 = (x) => x.toFixed(1);

// ---------------------------------------------------------------------------
// Kidney view
// ---------------------------------------------------------------------------
/** Bean-shaped kidney outline centred at (cx, cy); s = scale (1 ≈ 11 cm tall). Hilum faces right (medial). */
function kidneyPath(cx, cy, s) {
  const p = (x, y) => `${f1(cx + x * s)} ${f1(cy + y * s)}`;
  return `M${p(0, -110)} C${p(-60, -112)} ${p(-78, -50)} ${p(-78, 0)} C${p(-78, 55)} ${p(-58, 112)} ${p(0, 110)} C${p(40, 108)} ${p(52, 80)} ${p(46, 40)} C${p(30, 22)} ${p(30, -22)} ${p(46, -40)} C${p(52, -80)} ${p(40, -108)} ${p(0, -110)}Z`;
}

function tumourSvg(t, cx, cy, s, T) {
  const r = clamp(t.d * 8 * s, 4, 62 * s);
  // polar = exophytic at the upper pole, central = in the renal sinus; t.y (0–1) places multiple tumours along the kidney
  const y = t.y !== undefined ? cy + (t.y - 0.5) * 190 * s : t.pos === 'central' ? cy : cy - 78 * s;
  const x = t.pos === 'central' && t.y === undefined ? cx + 22 * s : cx - 48 * s + (t.y !== undefined ? (t.y * 37 % 30) * s : 0);
  const parts = [];
  if (t.hist === 'cyst') {
    const B = t.bosniak;
    const wall = { I: 1.2, II: 1.6, IIF: 2.4, III: 4, IV: 4 }[B];
    parts.push(`<circle class="cyst" cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}" stroke-width="${wall}"/>`);
    const nSept = { I: 0, II: 1, IIF: 3, III: 3, IV: 2 }[B];
    for (let i = 0; i < nSept; i++) {
      const a = (i + 1) * Math.PI / (nSept + 1);
      parts.push(`<line class="septum ${B === 'III' || B === 'IV' ? 'enh' : ''}" x1="${f1(x - r * Math.cos(a))}" y1="${f1(y - r * Math.sin(a))}" x2="${f1(x + r * Math.cos(a) * 0.9)}" y2="${f1(y + r * Math.sin(a) * 0.9)}" stroke-width="${B === 'III' || B === 'IV' ? 2.5 : 1}"/>`);
    }
    if (B === 'IIF' || B === 'III') parts.push(`<circle class="calc" cx="${f1(x + r * 0.6)}" cy="${f1(y - r * 0.5)}" r="2.2"/><circle class="calc" cx="${f1(x - r * 0.4)}" cy="${f1(y + r * 0.6)}" r="1.8"/>`);
    if (B === 'IV') parts.push(`<path class="nodule" d="M${f1(x - r * 0.2)} ${f1(y + r)} q${f1(r * 0.25)} ${f1(-r * 0.7)} ${f1(r * 0.6)} ${f1(-r * 0.15)}z"/>`);
    if (B === 'III' || B === 'IV') parts.push(`<circle class="enh-ring" cx="${f1(x)}" cy="${f1(y)}" r="${f1(r + 2)}"/>`);
    return parts.join('');
  }
  parts.push(`<circle class="tumour h-${t.hist}${t.ablated ? ' ablated' : ''}" cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}"/>`);
  if (t.hist === 'amlFat' || t.hist === 'amlSolid') {
    for (let i = 0; i < 4; i++) parts.push(`<path class="aml-vessel" d="M${f1(x - r * 0.7 + i * r * 0.4)} ${f1(y - r * 0.6)} q${f1(r * 0.2)} ${f1(r * 0.6)} 0 ${f1(r * 1.2)}"/>`);
  }
  if (t.hist === 'clearCell' || t.hist === 'papillary') parts.push(`<circle class="pseudocapsule" cx="${f1(x)}" cy="${f1(y)}" r="${f1(r + 1.5)}"/>`);
  if (t.ablated) parts.push(`<circle class="ablation-zone" cx="${f1(x)}" cy="${f1(y)}" r="${f1(r + 6)}"/><text class="lab small" x="${f1(x)}" y="${f1(y + r + 18)}" text-anchor="middle">${esc(T.ui.kidney.ablation)}</text>`);
  if (t.capsule) parts.push(`<path class="breach" d="M${f1(x - r * 0.9)} ${f1(y - r * 0.5)} l-8 -4 l4 -5 l-8 -3M${f1(x - r * 0.5)} ${f1(y - r * 0.95)} l-3 -8 l5 -2 l-2 -8"/>`);
  if (t.coil) parts.push(`<path class="coil" d="M${f1(x + r * 0.4)} ${f1(y)} c4 -6 8 6 12 0 c4 -6 8 6 12 0"/>`);
  if (t.aneurysm) parts.push(`<circle class="aneurysm" cx="${f1(x + r * 0.3)}" cy="${f1(y + r * 0.3)}" r="${f1(clamp(r * 0.18, 3, 9))}"/>`);
  return parts.join('');
}

function kidneyUnit(k, cx, cy, s, T) {
  const parts = [];
  if (k.removed) {
    parts.push(`<path class="kidney removed" d="${kidneyPath(cx, cy, s)}"/><text class="lab" x="${cx}" y="${cy}" text-anchor="middle">${esc(T.ui.kidney.removed)}</text>`);
    return parts.join('');
  }
  parts.push(`<path class="kidney" d="${kidneyPath(cx, cy, s)}"/>`);
  // medulla pyramids and sinus
  for (const [dx, dy] of [[-48, -55], [-58, 0], [-48, 55], [-25, -82], [-25, 82]]) parts.push(`<path class="pyramid" d="M${f1(cx + dx * s)} ${f1(cy + dy * s)} l${f1(16 * s)} ${f1(-9 * s)} l${f1(10 * s)} ${f1(10 * s)} z"/>`);
  parts.push(`<path class="sinus" d="M${f1(cx + 40 * s)} ${f1(cy - 30 * s)} C${f1(cx + 5 * s)} ${f1(cy - 34 * s)} ${f1(cx - 4 * s)} ${f1(cy + 34 * s)} ${f1(cx + 40 * s)} ${f1(cy + 30 * s)}"/>`);
  if (k.scar) parts.push(`<path class="scar" d="M${f1(cx - 66 * s)} ${f1(cy - 70 * s)} l${f1(18 * s)} ${f1(14 * s)} l${f1(-6 * s)} ${f1(18 * s)}"/>${s >= 1 ? `<text class="lab small halo" x="${f1(cx - 66 * s)}" y="${f1(cy - 92 * s)}" text-anchor="middle">${esc(T.ui.kidney.partial)}</text>` : ''}`);
  for (const t of k.tumours || []) parts.push(tumourSvg(t, cx, cy, s, T));
  return parts.join('');
}

function metsPanel(d, T, x0, y0) {
  const m = clamp(d.mets ?? 0, 0, 1);
  const op = (0.08 + 0.9 * m).toFixed(2);
  const icons = [['lung', 0], ['liver', 1], ['bone', 2], ['nodes', 3]];
  const parts = [`<text class="region" x="${x0}" y="${y0 - 10}">${esc(T.ui.kidney.mets)}</text>`];
  for (const [k, i] of icons) {
    const y = y0 + i * 30;
    const lit = k === 'nodes' ? (d.nodes ? 0.95 : op) : op;
    parts.push(`<circle class="met-dot" cx="${x0 + 8}" cy="${y}" r="8" opacity="${lit}"/><text class="lab small" x="${x0 + 22}" y="${y + 4}">${esc(T.ui.organ[k])}</text>`);
  }
  if (!d.metsFixed) parts.push(`<text class="lab val" x="${x0}" y="${y0 + 120}">${esc(T.ui.kidney.pM)} ${Math.round(m * 100)}%</text>`);
  return parts.join('');
}

function kidneyView(d, T) {
  const parts = [];
  parts.push(`<rect class="retro" x="0" y="0" width="480" height="340" rx="8"/>`);
  if (d.two) {
    d.kidneys.forEach((k, i) => {
      const cx = i === 0 ? 105 : 265;
      parts.push(`<path class="gerota" d="${kidneyPath(cx, 175, 0.86)}" transform="translate(${cx} 175) scale(1.12) translate(${-cx} -175)"/>`);
      parts.push(kidneyUnit(k, cx, 175, 0.72, T));
      parts.push(`<text class="lab" x="${cx}" y="330" text-anchor="middle">${esc(i === 0 ? T.ui.kidney.right : T.ui.kidney.left)}</text>`);
    });
  } else {
    const k = d.kidneys[0];
    const cx = 170; const cy = 180;
    // great vessels
    parts.push(`<rect class="ivc" x="300" y="10" width="26" height="320" rx="10"/><rect class="aorta" x="336" y="10" width="20" height="320" rx="9"/>`);
    parts.push(`<text class="lab small halo" x="313" y="26" text-anchor="middle">${esc(T.ui.kidney.ivc)}</text><text class="lab small halo" x="346" y="44" text-anchor="middle">${esc(T.ui.kidney.aorta)}</text>`);
    if (!k.removed) parts.push(`<path class="renal-vein" d="M${cx + 40} ${cy} C 250 ${cy - 4} 280 ${cy + 2} 302 ${cy}"/>`);
    if (d.thrombus && d.thrombus !== 'none') {
      parts.push(`<path class="thrombus" d="M${cx + 45} ${cy} C 250 ${cy - 4} 280 ${cy + 2} 312 ${cy}"/>`);
      if (d.thrombus === 'ivc') parts.push(`<rect class="thrombus-fill" x="303" y="${cy - 70}" width="20" height="78" rx="9"/>`);
    }
    // Gerota fascia and adrenal
    parts.push(`<path class="gerota" d="M${cx} 22 C ${cx - 110} 24 ${cx - 120} 120 ${cx - 115} 190 C ${cx - 110} 290 ${cx - 50} 330 ${cx + 10} 328 C ${cx + 70} 326 ${cx + 92} 280 ${cx + 88} 190 C ${cx + 86} 120 ${cx + 80} 24 ${cx} 22 Z"/>`);
    parts.push(`<path class="adrenal" d="M${cx - 30} 66 L${cx + 4} 36 L${cx + 34} 68 Z"/><text class="lab small" x="${cx + 40}" y="50">${esc(T.ui.kidney.adrenal)}</text>`);
    parts.push(`<text class="lab small" x="${cx - 112}" y="20">${esc(T.ui.kidney.gerota)}</text>`);
    if (d.hematoma) parts.push(`<path class="hematoma" opacity="${(0.25 + 0.6 * d.hematoma).toFixed(2)}" d="M${cx - 70} 60 C ${cx - 120} 120 ${cx - 125} 260 ${cx - 40} ${300 + 25 * d.hematoma} C ${cx + 30} ${320 + 10 * d.hematoma} ${cx + 85} 280 ${cx + 84} 230 C ${cx + 40} 300 ${cx - 90} 280 ${cx - 85} 180 C ${cx - 82} 110 ${cx - 50} 80 ${cx - 70} 60 Z"/><text class="lab val" x="${cx - 110}" y="318">${esc(T.ui.kidney.hematoma)}</text>`);
    parts.push(kidneyUnit(k, cx, cy, 1, T));
    // ureter
    if (!k.removed) parts.push(`<path class="ureter" d="M${cx + 38} ${cy + 26} C ${cx + 50} ${cy + 80} ${cx + 30} ${cy + 120} ${cx + 40} 334"/>`);
    if (d.surveillance) parts.push(`<g class="eye"><ellipse cx="${cx - 95}" cy="300" rx="12" ry="7"/><circle cx="${cx - 95}" cy="300" r="3"/></g><text class="lab small" x="${cx - 78}" y="304">${esc(T.ui.kidney.surveillance)}</text>`);
  }
  if (d.stage) { const lbl = d.stage === 'M1' ? 'M1' : 'c' + d.stage; parts.push(`<g class="stage-badge"><rect x="10" y="296" width="${14 + lbl.length * 9}" height="24" rx="6"/><text x="16" y="313">${esc(lbl)}</text></g>`); }
  parts.push(metsPanel(d, T, 392, 120));
  return { viewBox: '0 0 480 340', body: parts.join('') };
}

// ---------------------------------------------------------------------------
// Urothelial wall view
// ---------------------------------------------------------------------------
function tractInset(site, T) {
  const x0 = 392; const y0 = 14;
  const hl = (k) => (site === k ? ' hl' : '');
  return `<g class="inset">
    <rect x="${x0 - 6}" y="${y0 - 6}" width="86" height="118" rx="8" class="inset-bg"/>
    <path class="mini${hl('pelvis')}" d="M${x0 + 4} ${y0 + 6} c-8 6 -8 26 0 32 c8 4 14 -2 14 -16 c0 -14 -6 -20 -14 -16z"/>
    <path class="mini-line${hl('ureter')}" d="M${x0 + 16} ${y0 + 26} C ${x0 + 26} ${y0 + 46} ${x0 + 20} ${y0 + 62} ${x0 + 30} ${y0 + 76}"/>
    <path class="mini${hl('bladder')}" d="M${x0 + 22} ${y0 + 76} q14 -6 28 0 q6 16 -14 24 q-20 -8 -14 -24z"/>
    <path class="mini-line${hl('urethra')}" d="M${x0 + 36} ${y0 + 100} l0 12"/>
    <text class="lab small" x="${x0 + 40}" y="${y0 + 30}">${esc(T.ui.site[site])}</text>
  </g>`;
}

function wallView(d, T) {
  const upper = d.site === 'ureter' || d.site === 'pelvis';
  const thin = upper ? 0.55 : 1;
  const L = { lumen: 34, uro: 112, lam: 120, mus: 120 + 26 * thin, fat: 120 + 26 * thin + 70 * thin };
  L.organ = L.fat + 48; L.end = 330;
  const yOf = (D) => (D <= 1 ? L.lam + D * (L.mus - L.lam) : D <= 2 ? L.mus + (D - 1) * (L.fat - L.mus) : D <= 3 ? L.fat + (D - 2) * (L.organ - L.fat) : L.organ + Math.min(1, D - 3) * (L.end - L.organ - 10));
  const parts = [];
  parts.push(`<rect class="lumen" x="0" y="0" width="380" height="${L.uro}" rx="8"/>`);
  parts.push(`<rect class="uro" x="0" y="${L.uro}" width="380" height="${L.lam - L.uro}"/>`);
  parts.push(`<rect class="lam" x="0" y="${L.lam}" width="380" height="${L.mus - L.lam}"/>`);
  parts.push(`<rect class="mus" x="0" y="${L.mus}" width="380" height="${L.fat - L.mus}"/>`);
  for (let i = 0; i < 6; i++) parts.push(`<line class="mus-fiber" x1="0" y1="${f1(L.mus + (i + 0.5) * (L.fat - L.mus) / 6)}" x2="380" y2="${f1(L.mus + (i + 0.5) * (L.fat - L.mus) / 6)}"/>`);
  parts.push(`<rect class="fat" x="0" y="${L.fat}" width="380" height="${L.organ - L.fat}"/>`);
  for (let i = 0; i < 14; i++) parts.push(`<circle class="fat-cell" cx="${14 + i * 27}" cy="${f1(L.fat + (L.organ - L.fat) / 2 + (i % 2 ? 6 : -6))}" r="9"/>`);
  parts.push(`<rect class="organ" x="0" y="${L.organ}" width="380" height="${L.end - L.organ}" rx="6"/>`);
  // layer labels
  const lab = (y, k) => `<text class="lab small layer" x="6" y="${f1(y)}">${esc(T.ui.layer[k])}</text>`;
  parts.push(lab(L.uro - 4, upper ? 'urotheliumUpper' : 'urothelium'), lab((L.lam + L.mus) / 2 + 4, 'lamina'), lab((L.mus + L.fat) / 2 + 4, 'muscle'), lab(L.fat + 14, d.site === 'pelvis' ? 'parenchyma' : d.site === 'ureter' ? 'fatUpper' : d.site === 'urethra' ? 'fatUrethra' : 'fat'), lab(L.organ + 16, d.site === 'urethra' ? (d.sex === 'female' ? 'vagina' : 'corpora') : 'organ'));
  parts.push(`<text class="lab small" x="6" y="18">${esc(T.ui.layer.lumen)}</text>`);
  if (d.removed) {
    parts.push(`<rect class="removed-overlay" x="0" y="0" width="380" height="${L.end}" rx="8"/><text class="lab big" x="190" y="${(L.mus + L.fat) / 2}" text-anchor="middle">${esc(T.ui.removed[d.site])}</text>`);
    if (d.diversion) parts.push(`<g class="diversion"><circle cx="190" cy="${L.organ + 30}" r="14"/><text class="lab small" x="212" y="${L.organ + 34}">${esc(T.opt[d.diversion])}</text></g>`);
  } else {
    const cx = 200;
    // carcinoma in situ: flat, red, along the urothelium
    if (d.flatCis) parts.push(`<rect class="cis" x="${d.extensive ? 30 : 110}" y="${L.uro - 3}" width="${d.extensive ? 320 : 170}" height="${L.lam - L.uro + 5}" rx="2"/>`);
    // invasive component
    const D = clamp(d.D ?? 0, 0, 4);
    if (D > 0.1 || d.solid) {
      const yb = yOf(Math.max(D, 0.2));
      const w = 50 + 22 * D;
      parts.push(`<path class="invasion" d="M${cx - w / 2} ${L.uro} C ${cx - w / 2} ${f1((L.uro + yb) / 2)} ${cx - w / 4} ${f1(yb)} ${cx} ${f1(yb)} C ${cx + w / 4} ${f1(yb)} ${cx + w / 2} ${f1((L.uro + yb) / 2)} ${cx + w / 2} ${L.uro} Z"/>`);
    }
    if (d.papillary) {
      for (let i = -3; i <= 3; i++) {
        const h = 46 - Math.abs(i) * 7;
        parts.push(`<path class="frond" d="M${cx + i * 9 - 4} ${L.uro} C ${cx + i * 12 - 9} ${L.uro - h * 0.6} ${cx + i * 13 - 2} ${L.uro - h} ${cx + i * 11 + 2} ${L.uro - h} C ${cx + i * 11 + 9} ${L.uro - h * 0.8} ${cx + i * 9 + 6} ${L.uro - h * 0.4} ${cx + i * 9 + 4} ${L.uro} Z"/>`);
      }
    }
    if (d.solid && !d.papillary) parts.push(`<ellipse class="solid-mass" cx="${cx}" cy="${L.uro - 10}" rx="34" ry="16"/>`);
    // recurrences (expected), shown as small fronds elsewhere on the wall
    const rec = clamp(d.recur ?? 0, 0, 1);
    if (rec > 0.05) for (const x of [70, 320]) parts.push(`<g opacity="${(0.25 + 0.75 * rec).toFixed(2)}"><path class="frond" d="M${x - 6} ${L.uro} C ${x - 10} ${L.uro - 14} ${x - 2} ${L.uro - 22} ${x + 2} ${L.uro - 22} C ${x + 8} ${L.uro - 16} ${x + 6} ${L.uro - 8} ${x + 6} ${L.uro} Z"/></g>`);
    if (d.rtuLine) parts.push(`<path class="rtu-line" d="M140 ${L.uro} L140 ${f1(yOf(1.35))} L260 ${f1(yOf(1.35))} L260 ${L.uro}"/><text class="lab small halo" x="200" y="${f1(yOf(1.35) + 15)}" text-anchor="middle">${esc(T.ui.wall.rtu)}</text>`);
    if (d.instill) for (let i = 0; i < 9; i++) parts.push(`<circle class="drop ${d.instill}" cx="${30 + i * 40}" cy="${50 + (i % 3) * 14}" r="4"/>`);
    if (d.instill) parts.push(`<text class="lab small halo" x="200" y="20" text-anchor="middle">${esc(T.ui.wall[d.instill])}</text>`);
    if (d.radiation) for (let i = 0; i < 3; i++) parts.push(`<path class="rt" d="M${120 + i * 70} 8 q6 8 0 16 q-6 8 0 16 q6 8 0 16"/>`);
    if (d.radiation) parts.push(`<text class="lab small halo" x="290" y="20" text-anchor="middle">${esc(T.ui.wall.rt)}</text>`);
    if (d.laser) parts.push(`<path class="laser" d="M250 10 L238 40 L250 40 L236 74"/><text class="lab small" x="258" y="30">${esc(T.ui.wall.laser)}</text>`);
  }
  if (d.stage && !d.removed) { const lbl = d.stage === 'M1' ? 'M1' : d.stage; parts.push(`<g class="stage-badge"><rect x="10" y="${L.end - 30}" width="${14 + lbl.length * 9}" height="24" rx="6"/><text x="16" y="${L.end - 13}">${esc(lbl)}</text></g>`); }
  parts.push(tractInset(d.site, T));
  parts.push(metsPanel(d, T, 392, 172));
  return { viewBox: '0 0 480 340', body: parts.join('') };
}

export function renderSchematic(host, desc, T, lang, title) {
  const r = desc.kind === 'wall' ? wallView(desc, T) : kidneyView(desc, T);
  host.innerHTML = `<svg class="schem ${desc.kind}" viewBox="${r.viewBox}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title>${r.body}</svg>`;
}
