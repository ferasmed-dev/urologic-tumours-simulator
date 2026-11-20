import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I18N, LANGS } from '../src/i18n.js';
import { ENTITIES, ENTITY, MODES, PRESETS, run, decision } from '../src/model.js';

/** Every run we can think of: defaults, each preset, and each select option, in both arms. */
function allRuns(ent) {
  const sets = [{}];
  for (const pr of Object.values(PRESETS)) if (pr.entity === ent.id) sets.push(pr.params);
  for (const d of ent.params) {
    if (d.type === 'select') for (const o of d.options) sets.push({ [d.key]: o });
    if (d.type === 'bool') sets.push({ [d.key]: true });
  }
  const out = [];
  for (const p of sets) for (const arm of ['untreated', 'treated']) out.push(run(ent, p, arm));
  return out;
}

function shape(o) {
  if (typeof o === 'function') return 'fn';
  if (Array.isArray(o)) return o.map(shape);
  if (o && typeof o === 'object') return Object.fromEntries(Object.keys(o).sort().map((k) => [k, shape(o[k])]));
  return typeof o;
}

test('Spanish and English dictionaries have the same structure', () => {
  assert.deepEqual(LANGS, ['es', 'en']);
  const strip = (o) => { const s = shape(o); delete s.quiz; return s; };
  assert.deepEqual(strip(I18N.en), strip(I18N.es));
  assert.equal(I18N.en.quiz.length, I18N.es.quiz.length);
});

for (const lang of LANGS) {
  const T = I18N[lang];
  test(`[${lang}] every mode, entity, parameter, series, gauge, option, step, event and decision has text`, () => {
    for (const m of MODES) assert.ok(T.mode[m.id]?.name && T.mode[m.id]?.backbone, m.id);
    for (const ent of ENTITIES) {
      const E = T.ent[ent.id];
      assert.ok(E, ent.id);
      for (const k of ['name', 'short', 'def', 'mech', 'dx', 'tx']) assert.ok(typeof E[k] === 'string' && E[k].length > 3, `${ent.id}.${k}`);
      assert.ok(Array.isArray(E.ref) && E.ref.length, `${ent.id}.ref`);
      assert.ok(T.unit[ent.unit] && T.unitAxis[ent.unit], `unit ${ent.unit}`);
      for (const d of ent.params) {
        assert.ok(E.p[d.key], `${ent.id}.p.${d.key}`);
        if (d.type === 'select') for (const o of d.options) assert.ok(T.opt[o], `opt ${o}`);
      }
      for (const sd of ent.series) assert.ok(E.s[sd.key], `${ent.id}.s.${sd.key}`);
      for (const r of allRuns(ent)) {
        for (const k of Object.keys(r.firstStep)) assert.ok(E.st[k], `${ent.id}.st.${k}`);
        for (const e of r.events) {
          const v = E.ev[e.key];
          assert.ok(v, `${ent.id}.ev.${e.key}`);
          const txt = typeof v === 'function' ? v(e.vars, T) : v;
          assert.ok(typeof txt === 'string' && !/undefined|NaN/.test(txt), `${ent.id}.ev.${e.key}: ${txt}`);
        }
        for (const i of [0, Math.floor(r.t.length / 3), r.t.length - 1]) {
          const st = r.states[i];
          assert.ok(E.dec[decision(ent.id, st, r.p)], `${ent.id}.dec.${decision(ent.id, st, r.p)}`);
          for (const g of ent.gauges ? ent.gauges(st, r.p) : []) assert.ok(E.g[g.key], `${ent.id}.g.${g.key}`);
          const sch = ent.schematic(st, r.p);
          if (sch.site) assert.ok(T.ui.site[sch.site] && T.ui.removed[sch.site], `site ${sch.site}`);
          if (sch.diversion) assert.ok(T.opt[sch.diversion], `diversion ${sch.diversion}`);
          for (const k of sch.kidneys || []) for (const t of k.tumours || []) if (t.bosniak) assert.ok(T.opt[t.bosniak]);
        }
      }
    }
  });

  test(`[${lang}] presets and quiz are complete and consistent`, () => {
    for (const k of Object.keys(PRESETS)) assert.ok(T.preset[k], `preset ${k}`);
    assert.ok(T.quiz.length >= 16);
    for (const q of T.quiz) {
      assert.ok(PRESETS[q.preset], q.preset);
      assert.equal(ENTITY[PRESETS[q.preset].entity].mode, q.mode, q.preset);
      assert.ok(q.a >= 0 && q.a < q.o.length);
    }
    for (const m of MODES) assert.ok(T.quiz.filter((q) => q.mode === m.id).length >= 4, m.id);
    assert.ok(T.quiz.length >= 16);
  });
}

test('quiz questions match across languages', () => {
  I18N.es.quiz.forEach((q, i) => {
    const e = I18N.en.quiz[i];
    assert.equal(q.preset, e.preset); assert.equal(q.a, e.a); assert.equal(q.mode, e.mode); assert.equal(q.o.length, e.o.length);
  });
});
