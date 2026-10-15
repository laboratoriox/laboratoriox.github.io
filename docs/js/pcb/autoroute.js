// Roteamento automático simples: busca A* em grade, 2 camadas, com vias, respeitando distância mínima.
import { shapeDist, shapeBox, distPtSeg, pointInPoly, r2 } from './board.js';

const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const TURN = [0, 0.15, 0.6, 1.5, 3];
const heapPush = (h, f, s) => { h.f.push(f); h.s.push(s); let i = h.f.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (h.f[p] <= h.f[i]) break; [h.f[p], h.f[i]] = [h.f[i], h.f[p]]; [h.s[p], h.s[i]] = [h.s[i], h.s[p]]; i = p; } };
const heapPop = (h) => {
  const f = h.f[0], s = h.s[0], lf = h.f.pop(), ls = h.s.pop();
  if (h.f.length) { h.f[0] = lf; h.s[0] = ls; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < h.f.length && h.f[l] < h.f[m]) m = l; if (r < h.f.length && h.f[r] < h.f[m]) m = r; if (m === i) break; [h.f[m], h.f[i]] = [h.f[i], h.f[m]]; [h.s[m], h.s[i]] = [h.s[i], h.s[m]]; i = m; } }
  return s;
};

/**
 * Roteia as ligações que faltam. opts: { pitch, w, clear, viaD, viaH, net (só essa rede), maxPops }
 * Altera a placa (um único passo de desfazer). Devolve { routed, failed: [{ net }], tracks, vias }.
 */
export function autoroute(board, sch, opts = {}) {
  const rules = board.rules, w = opts.w ?? rules.trackW, clear = opts.clear ?? rules.clear, viaD = opts.viaD ?? rules.viaD, viaH = opts.viaH ?? rules.viaH;
  const pitch = opts.pitch ?? 0.25, maxPops = opts.maxPops ?? 500000;
  const an = board.analyze(sch);
  const ob = board.outlineBox(), x0 = ob.x0, y0 = ob.y0, nx = Math.ceil((ob.x1 - x0) / pitch) + 1, ny = Math.ceil((ob.y1 - y0) / pitch) + 1, N = nx * ny;
  const cx = (i) => x0 + (i % nx) * pitch, cy = (i) => y0 + Math.floor(i / nx) * pitch;
  const cellOf = (p) => Math.max(0, Math.min(nx - 1, Math.round((p[0] - x0) / pitch))) + Math.max(0, Math.min(ny - 1, Math.round((p[1] - y0) / pitch))) * nx;
  const netIds = new Map(); const nid = (n) => { if (!n) return -1; if (!netIds.has(n)) netIds.set(n, netIds.size + 1); return netIds.get(n); };
  const owner = { F: new Int16Array(N), B: new Int16Array(N) };

  // borda e fora da placa
  const edgeR = rules.edge + w / 2;
  for (let i = 0; i < N; i++) {
    const p = [cx(i), cy(i)];
    let bad = !pointInPoly(p, board.outline);
    if (!bad) for (let k = 0; k < board.outline.length; k++) if (distPtSeg(p, board.outline[k], board.outline[(k + 1) % board.outline.length]) < edgeR) { bad = true; break; }
    if (bad) { owner.F[i] = -1; owner.B[i] = -1; }
  }
  const stamp = (shape, layers, net, extra = 0) => {
    const r = (shape.k === 'cap' ? shape.r : 0) + clear + w / 2 + extra, b = shapeBox(shape);
    const ix0 = Math.max(0, Math.floor((b.x0 - r - x0) / pitch)), ix1 = Math.min(nx - 1, Math.ceil((b.x1 + r - x0) / pitch));
    const iy0 = Math.max(0, Math.floor((b.y0 - r - y0) / pitch)), iy1 = Math.min(ny - 1, Math.ceil((b.y1 + r - y0) / pitch));
    for (let iy = iy0; iy <= iy1; iy++) for (let ix = ix0; ix <= ix1; ix++) {
      const p = [x0 + ix * pitch, y0 + iy * pitch], pr = { k: 'cap', a: p, b: p, r: 0 };
      const d = shape.k === 'cap' ? distPtSeg(p, shape.a, shape.b) - (shape.r) : shapeDist(shape, pr);
      if (d > clear + w / 2 + extra) continue;
      const c = ix + iy * nx;
      for (const L of layers) { const cur = owner[L][c]; if (cur === 0) owner[L][c] = net; else if (cur !== net) owner[L][c] = -1; }
    }
  };
  for (const o of an.objs) stamp(o.shape, o.layers, nid(o.kind === 'pad' ? o.net : an.objNet.get(o.id) || null));

  const todo = an.ratsnest.filter((e) => !opts.net || e.net === opts.net).sort((a, b) => a.d - b.d);
  const padById = new Map(an.objs.filter((o) => o.kind === 'pad').map((o) => [o.id, o]));
  const out = { routed: 0, failed: [], tracks: [], vias: [] };
  const S = N * 2 * 9;
  const gs = new Float32Array(S), stampv = new Uint32Array(S), parent = new Int32Array(S); let ver = 0;
  const li = { F: 0, B: 1 }, lname = ['F', 'B'];

  for (const e of todo) {
    const net = nid(e.net), pa = padById.get(e.pa), pb = padById.get(e.pb);
    const s = cellOf(pa.c), g = cellOf(pb.c);
    const forced = new Set(); for (const c0 of [s, g]) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const ix = (c0 % nx) + dx, iy = Math.floor(c0 / nx) + dy; if (ix >= 0 && iy >= 0 && ix < nx && iy < ny) forced.add(ix + iy * nx); }
    const ok = (L, c) => { const v = owner[lname[L]][c]; return v === 0 || v === net || (forced.has(c) && v !== -1) || (forced.has(c) && owner[lname[L]][c] === -1 && Math.abs((c % nx) - (g % nx)) + Math.abs(Math.floor(c / nx) - Math.floor(g / nx)) <= 2) || (forced.has(c) && Math.abs((c % nx) - (s % nx)) + Math.abs(Math.floor(c / nx) - Math.floor(s / nx)) <= 2); };
    const viaOk = (c) => { const ix = c % nx, iy = Math.floor(c / nx); for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const a = ix + dx, b2 = iy + dy; if (a < 0 || b2 < 0 || a >= nx || b2 >= ny) return false; const q = a + b2 * nx; for (const L of ['F', 'B']) { const v = owner[L][q]; if (v !== 0 && v !== net) return false; } } return true; };
    ver++;
    const heap = { f: [], s: [] };
    const gx = g % nx, gy = Math.floor(g / nx);
    const hh = (c) => { const dx = Math.abs((c % nx) - gx), dy = Math.abs(Math.floor(c / nx) - gy); return (Math.max(dx, dy) + 0.414 * Math.min(dx, dy)); };
    const sid = (c, L, d) => (c * 2 + L) * 9 + d;
    for (const L of pa.layers) { const st = sid(s, li[L], 8); gs[st] = 0; stampv[st] = ver; parent[st] = -1; heapPush(heap, hh(s), st); }
    let goal = -1, pops = 0;
    const goalLayers = new Set(pb.layers.map((l) => li[l]));
    while (heap.f.length && pops++ < maxPops) {
      const st = heapPop(heap), d = st % 9, cl = (st - d) / 9, L = cl % 2, c = (cl - L) / 2;
      if (c === g && goalLayers.has(L)) { goal = st; break; }
      const base = gs[st];
      const relax = (nst, cost, nc) => { const ng = base + cost; if (stampv[nst] !== ver || ng < gs[nst]) { stampv[nst] = ver; gs[nst] = ng; parent[nst] = st; heapPush(heap, ng + hh(nc), nst); } };
      const ix = c % nx, iy = Math.floor(c / nx);
      for (let k = 0; k < 8; k++) {
        const ax = ix + DIRS[k][0], ay = iy + DIRS[k][1]; if (ax < 0 || ay < 0 || ax >= nx || ay >= ny) continue;
        const nc = ax + ay * nx; if (!ok(L, nc)) continue;
        if (k % 2 === 1 && (!ok(L, ix + DIRS[k][0] + iy * nx) || !ok(L, ix + (iy + DIRS[k][1]) * nx))) continue;
        let turn = 0; if (d !== 8) { let t = Math.abs(k - d); if (t > 4) t = 8 - t; turn = TURN[t]; }
        relax(sid(nc, L, k), (k % 2 ? 1.414 : 1) + turn + (L === 1 ? 0.04 : 0), nc);
      }
      if (viaOk(c)) { const o2 = 1 - L; if (ok(o2, c)) relax(sid(c, o2, 8), 14, c); }
    }
    if (goal < 0) { out.failed.push({ net: e.net, a: e.a, b: e.b }); continue; }
    // monta o caminho
    const cells = []; for (let st = goal; st >= 0; st = parent[st]) { const d = st % 9, cl = (st - d) / 9, L = cl % 2; cells.push({ c: (cl - L) / 2, L }); }
    cells.reverse();
    const pts = [], viasAt = [];
    let seg = [{ p: pa.c, L: cells[0].L }];
    const segs = []; let curL = cells[0].L, cur = [pa.c];
    for (let i = 0; i < cells.length; i++) {
      const q = cells[i], p = [cx(q.c), cy(q.c)];
      if (q.L !== curL) { segs.push({ L: curL, pts: cur }); viasAt.push(cur[cur.length - 1]); cur = [cur[cur.length - 1]]; curL = q.L; }
      else cur.push(p);
    }
    cur.push(pb.c); segs.push({ L: curL, pts: cur });
    for (const sg of segs) {
      // tira pontos alinhados
      const q = [sg.pts[0]];
      for (let i = 1; i < sg.pts.length - 1; i++) { const a = q[q.length - 1], b = sg.pts[i], c = sg.pts[i + 1]; const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]); if (Math.abs(cr) > 1e-6) q.push(b); }
      q.push(sg.pts[sg.pts.length - 1]);
      for (let i = 0; i + 1 < q.length; i++) if (Math.hypot(q[i][0] - q[i + 1][0], q[i][1] - q[i + 1][1]) > 1e-4) out.tracks.push({ l: lname[sg.L], w, a: [r2(q[i][0]), r2(q[i][1])], b: [r2(q[i + 1][0]), r2(q[i + 1][1])], net: e.net });
    }
    for (const v of viasAt) out.vias.push({ x: r2(v[0]), y: r2(v[1]), d: viaD, h: viaH, net: e.net });
    // marca o novo cobre
    for (const t of out.tracks.filter((x) => x.net === e.net && !x.done)) { stamp({ k: 'cap', a: t.a, b: t.b, r: t.w / 2 }, [t.l], net); t.done = true; }
    for (const v of out.vias.filter((x) => x.net === e.net && !x.done)) { stamp({ k: 'cap', a: [v.x, v.y], b: [v.x, v.y], r: v.d / 2 }, ['F', 'B'], net); v.done = true; }
    out.routed++;
  }
  if (out.tracks.length || out.vias.length) {
    board.edit(() => {
      for (const t of out.tracks) board.tracks.push({ id: Math.random().toString(36).slice(2, 10), l: t.l, w: t.w, a: t.a, b: t.b });
      for (const v of out.vias) board.vias.push({ id: Math.random().toString(36).slice(2, 10), x: v.x, y: v.y, d: v.d, h: v.h });
    });
  }
  return out;
}
