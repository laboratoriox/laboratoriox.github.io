// Desenho da placa na tela (e depois em PDF/SVG), a partir dos mesmos "pincéis" do esquema.
import { getFootprint } from './footprints.js';
import { fpPoint, fpBoxPoly } from './board.js';

export const PCB_THEME = {
  bg: '#0f1113', board: '#173b2a', edge: '#f2d43b', F: '#d6504a', B: '#3f7fe6', via: '#c9c28f', hole: '#0f1113',
  silkF: '#ece8d6', silkB: '#a5b9ee', ref: '#f2b705', rat: '#e4ebf7', sel: '#98a4ff', bad: '#ff4b4b', grid: 'rgba(255,255,255,.06)', gridMajor: 'rgba(255,255,255,.13)', text: '#cfd3da',
};

function padDraw(out, o, color) {
  const s = o.shape;
  if (s.k === 'poly') out.poly(s.pts, { fill: color, closed: true, width: 0.01 });
  else if (s.a[0] === s.b[0] && s.a[1] === s.b[1]) out.circle(s.a[0], s.a[1], s.r, { fill: color, width: 0.01 });
  else out.poly([s.a, s.b], { stroke: color, width: s.r * 2 });
}

/**
 * opts: { vis: {F,B,silk,rat,refs}, active: 'F'|'B', sel: {fps,tracks,vias}, hot: nome da rede, an: análise, board, showNets }
 */
export function paintBoard(out, board, th, opts = {}) {
  const vis = { F: true, B: true, silk: true, rat: true, refs: true, ...(opts.vis || {}) };
  const an = opts.an, active = opts.active || 'F', sel = opts.sel || {}, hot = opts.hot || null;
  const selF = new Set(sel.fps || []), selT = new Set(sel.tracks || []), selV = new Set(sel.vias || []);
  out.alpha(1);
  out.poly(board.outline, { fill: th.board, stroke: th.edge, width: 0.2, closed: true });
  const dim = (id) => (hot && an?.objNet.get(id) !== hot ? 0.28 : 1);
  const order = active === 'F' ? ['B', 'F'] : ['F', 'B'];
  for (const L of order) {
    if (!vis[L]) continue;
    const base = L === active ? 1 : 0.6, color = th[L];
    for (const t of board.tracks) if (t.l === L) { out.alpha(base * dim(t.id)); out.poly([t.a, t.b], { stroke: color, width: t.w }); }
    for (const o of an?.objs || []) if (o.kind === 'pad' && o.layers.includes(L)) { out.alpha(base * dim(o.id)); padDraw(out, o, color); }
  }
  out.alpha(1);
  for (const v of board.vias) {
    out.alpha(dim(v.id)); out.circle(v.x, v.y, v.d / 2, { fill: th.via, width: 0.01 }); out.circle(v.x, v.y, v.h / 2, { fill: th.hole, width: 0.01 });
  }
  out.alpha(1);
  for (const o of an?.objs || []) if (o.kind === 'pad' && o.drill) { const c = o.c; out.alpha(dim(o.id)); out.circle(c[0], c[1], o.drill / 2, { fill: th.hole, width: 0.01 }); }
  out.alpha(1);
  if (vis.silk) {
    for (const f of board.fps) {
      const fp = getFootprint(f.fp); if (!fp) continue;
      const col = f.b ? th.silkB : th.silkF; out.alpha(f.b ? 0.8 : 1);
      for (const s of fp.silk) {
        if (s[0] === 'l') out.poly(s[1].map(([x, y]) => fpPoint(f, x, y)), { stroke: col, width: 0.16 });
        else { const [cx, cy] = fpPoint(f, s[1], s[2]); out.circle(cx, cy, s[3], { stroke: col, width: 0.16 }); }
      }
    }
    out.alpha(1);
  }
  if (vis.refs && opts.refOf) {
    for (const f of board.fps) {
      const label = opts.refOf(f); if (!label) continue;
      const q = fpBoxPoly(f), ys = q.map((p) => p[1]), xs = q.map((p) => p[0]);
      out.text((Math.min(...xs) + Math.max(...xs)) / 2, Math.min(...ys) - 0.5, label, { size: 1.3, align: 'middle', color: th.ref, bold: true });
    }
  }
  if (opts.showNets && an) for (const o of an.objs) if (o.kind === 'pad' && o.net) out.text(o.c[0], o.c[1] + 0.3, o.net, { size: 0.75, align: 'middle', color: '#fff' });
  if (vis.rat && an) for (const r of an.ratsnest) { out.alpha(hot ? (r.net === hot ? 1 : 0.2) : 0.85); out.poly([r.a, r.b], { stroke: th.rat, width: hot && r.net === hot ? 0.16 : 0.09 }); }
  out.alpha(1);
  if (an) for (const s of an.shorts) if (s.at) out.circle(s.at[0], s.at[1], 1.6, { stroke: th.bad, width: 0.25 });
  for (const f of board.fps) if (selF.has(f.id)) out.poly(fpBoxPoly(f), { stroke: th.sel, width: 0.18, closed: true, dash: [1.2, 0.8] });
  for (const t of board.tracks) if (selT.has(t.id)) { out.alpha(0.9); out.poly([t.a, t.b], { stroke: th.sel, width: t.w + 0.2 }); out.alpha(1); }
  for (const v of board.vias) if (selV.has(v.id)) out.circle(v.x, v.y, v.d / 2 + 0.3, { stroke: th.sel, width: 0.2 });
  out.alpha(1);
}
