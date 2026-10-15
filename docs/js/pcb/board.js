// Modelo da placa de circuito impresso (2 camadas): contorno, pegadas, trilhas, vias.
// Unidades em milímetros. Sem nada do navegador, então dá para testar no Node.
import { getFootprint, defaultFootprint, choicesFor, isPhysical, pinIndexMap } from './footprints.js';
import { pinsOf } from '../circuit/symbols.js';

const ALNUM = 'abcdefghijklmnopqrstuvwxyz0123456789';
export const uid = (n = 8) => { let s = ''; for (let i = 0; i < n; i++) s += ALNUM[Math.floor(Math.random() * ALNUM.length)]; return s; };
export const r2 = (v) => Math.round(v * 100) / 100;
export const snapTo = (v, g) => r2(Math.round(v / g) * g);
export const DEFAULT_RULES = { clear: 0.2, minW: 0.2, viaD: 0.8, viaH: 0.4, trackW: 0.4, edge: 0.3 };

// ---------- geometria ----------
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
export function distPtSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
function segsCross(a, b, c, d) {
  const d1 = cross(a, b, c), d2 = cross(a, b, d), d3 = cross(c, d, a), d4 = cross(c, d, b);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
export function distSegSeg(a, b, c, d) {
  if (segsCross(a, b, c, d)) return 0;
  return Math.min(distPtSeg(a, c, d), distPtSeg(b, c, d), distPtSeg(c, a, b), distPtSeg(d, a, b));
}
export function pointInPoly(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function polyEdges(pts) { const e = []; for (let i = 0; i < pts.length; i++) e.push([pts[i], pts[(i + 1) % pts.length]]); return e; }
/** Distância entre duas formas de cobre: { k:'cap', a, b, r } (trilha, via, pad redondo/oval) ou { k:'poly', pts }. Negativa = sobrepõe. */
export function shapeDist(s, t) {
  if (s.k === 'cap' && t.k === 'cap') return distSegSeg(s.a, s.b, t.a, t.b) - s.r - t.r;
  if (s.k === 'poly' && t.k === 'cap') return shapeDist(t, s);
  if (s.k === 'cap') {
    if (pointInPoly(s.a, t.pts) || pointInPoly(s.b, t.pts)) return -s.r;
    let m = Infinity; for (const [c, d] of polyEdges(t.pts)) m = Math.min(m, distSegSeg(s.a, s.b, c, d));
    return m - s.r;
  }
  if (pointInPoly(s.pts[0], t.pts) || pointInPoly(t.pts[0], s.pts)) return -1e-3;
  let m = Infinity;
  for (const [a, b] of polyEdges(s.pts)) for (const [c, d] of polyEdges(t.pts)) m = Math.min(m, distSegSeg(a, b, c, d));
  return m;
}
export function shapeBox(s) {
  if (s.k === 'cap') return { x0: Math.min(s.a[0], s.b[0]) - s.r, y0: Math.min(s.a[1], s.b[1]) - s.r, x1: Math.max(s.a[0], s.b[0]) + s.r, y1: Math.max(s.a[1], s.b[1]) + s.r };
  const xs = s.pts.map((p) => p[0]), ys = s.pts.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

// ---------- pegadas posicionadas ----------
const rot = (x, y, deg) => { const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t); return [Math.round((x * c - y * s) * 1e6) / 1e6, Math.round((x * s + y * c) * 1e6) / 1e6]; };
/** Ponto local da pegada → mundo (espelha se estiver no lado de baixo, gira, move). */
export function fpPoint(inst, lx, ly) {
  if (inst.b) lx = -lx;
  const [x, y] = rot(lx, ly, inst.r || 0);
  return [x + inst.x, y + inst.y];
}
export function padShape(inst, pad) {
  const [cx, cy] = fpPoint(inst, pad.x, pad.y);
  if (pad.s === 'c') return { k: 'cap', a: [cx, cy], b: [cx, cy], r: pad.w / 2 };
  const ang = (inst.b ? -(inst.r || 0) : (inst.r || 0));
  const ex = rot(1, 0, ang), ey = rot(0, 1, ang);
  const loc = (u, v) => [cx + ex[0] * u + ey[0] * v, cy + ex[1] * u + ey[1] * v];
  if (pad.s === 'o') {
    if (pad.w >= pad.h) { const hf = (pad.w - pad.h) / 2; return { k: 'cap', a: loc(-hf, 0), b: loc(hf, 0), r: pad.h / 2 }; }
    const hf = (pad.h - pad.w) / 2; return { k: 'cap', a: loc(0, -hf), b: loc(0, hf), r: pad.w / 2 };
  }
  const w = pad.w / 2, h = pad.h / 2;
  return { k: 'poly', pts: [loc(-w, -h), loc(w, -h), loc(w, h), loc(-w, h)] };
}
export function fpBoxPoly(inst) {
  const fp = getFootprint(inst.fp); if (!fp) return [[inst.x - 1, inst.y - 1], [inst.x + 1, inst.y - 1], [inst.x + 1, inst.y + 1], [inst.x - 1, inst.y + 1]];
  const b = fp.box, m = 0.4;
  return [[b.x0 - m, b.y0 - m], [b.x1 + m, b.y0 - m], [b.x1 + m, b.y1 + m], [b.x0 - m, b.y1 + m]].map(([x, y]) => fpPoint(inst, x, y));
}

export const outlineRect = (w, h, x = 0, y = 0) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
export function outlineRounded(w, h, r, x = 0, y = 0) {
  r = Math.max(0, Math.min(r, w / 2 - 0.01, h / 2 - 0.01)); if (r < 0.3) return outlineRect(w, h, x, y);
  const pts = [], n = 8, corner = (cx, cy, a0) => { for (let i = 0; i <= n; i++) { const a = a0 + (i / n) * (Math.PI / 2); pts.push([r2(cx + r * Math.cos(a)), r2(cy + r * Math.sin(a))]); } };
  corner(x + w - r, y + r, -Math.PI / 2); corner(x + w - r, y + h - r, 0); corner(x + r, y + h - r, Math.PI / 2); corner(x + r, y + r, Math.PI);
  return pts;
}
export function outlineCircle(d, cx = 0, cy = 0, n = 48) { const pts = []; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pts.push([r2(cx + (d / 2) * Math.cos(a)), r2(cy + (d / 2) * Math.sin(a))]); } return pts; }

export class Board {
  constructor(data) {
    this.fps = []; this.tracks = []; this.vias = []; this.outline = outlineRect(60, 40); this.rules = { ...DEFAULT_RULES };
    this.undoStack = []; this.redoStack = []; this.rev = 0; this.listeners = new Set(); this._base = null; this._an = null;
    if (data) this.load(data);
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(kind = 'change') { this.rev++; this._an = null; this.listeners.forEach((f) => f(kind)); }
  load(data) {
    const d = data && typeof data === 'object' ? data : {};
    if (Array.isArray(d.outline) && d.outline.length >= 3) this.outline = d.outline.map((p) => [Number(p[0]), Number(p[1])]);
    this.fps = (d.fps || []).map((f) => ({ ...f }));
    this.tracks = (d.tracks || []).map((t) => ({ id: t.id, l: t.l === 'B' ? 'B' : 'F', w: t.w, a: [...t.a], b: [...t.b] }));
    this.vias = (d.vias || []).map((v) => ({ ...v }));
    this.rules = { ...DEFAULT_RULES, ...(d.rules || {}) };
    this.undoStack = []; this.redoStack = []; this.emit('load');
  }
  toJSON() { return { v: 1, outline: this.outline, fps: this.fps, tracks: this.tracks, vias: this.vias, rules: this.rules }; }
  snapshot() { return JSON.stringify(this.toJSON()); }
  restore(s) { const d = JSON.parse(s); this.outline = d.outline; this.fps = d.fps; this.tracks = d.tracks; this.vias = d.vias; this.rules = d.rules; }
  get isEmpty() { return !this.fps.length && !this.tracks.length && !this.vias.length; }

  // ---------- histórico ----------
  edit(fn) {
    const before = this.snapshot(); const out = fn(); const after = this.snapshot();
    if (after !== before) { this.undoStack.push({ before, after }); this.redoStack.length = 0; if (this.undoStack.length > 120) this.undoStack.shift(); }
    this.emit(); return out;
  }
  beginTransient() { this._base = this.snapshot(); }
  setTransient(fn) { if (this._base == null) return; this.restore(this._base); fn(); this.emit('transient'); }
  endTransient(commit = true) {
    const base = this._base; this._base = null; if (base == null) return false;
    const now = this.snapshot();
    if (!commit) { this.restore(base); this.emit(); return false; }
    if (now === base) { this.emit(); return false; }
    this.undoStack.push({ before: base, after: now }); this.redoStack.length = 0; this.emit(); return true;
  }
  undo() { const e = this.undoStack.pop(); if (!e) return false; this.restore(e.before); this.redoStack.push(e); this.emit(); return true; }
  redo() { const e = this.redoStack.pop(); if (!e) return false; this.restore(e.after); this.undoStack.push(e); this.emit(); return true; }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  fp(id) { return this.fps.find((f) => f.id === id); }
  outlineBox() {
    const xs = this.outline.map((p) => p[0]), ys = this.outline.map((p) => p[1]);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  }
  setOutline(pts) { this.edit(() => { this.outline = pts.map((p) => [r2(p[0]), r2(p[1])]); }); }
  moveVertex(i, x, y) { this.outline[i] = [r2(x), r2(y)]; }
  insertVertex(i, x, y) { this.edit(() => { this.outline.splice(i + 1, 0, [r2(x), r2(y)]); }); }
  deleteVertex(i) { if (this.outline.length <= 3) return false; this.edit(() => { this.outline.splice(i, 1); }); return true; }

  // ---------- sincronizar com o esquema ----------
  /** Traz as peças do esquema para a placa: cria pegadas novas, tira as de peças apagadas, corrige pegadas que não servem mais. */
  syncFromSchematic(sch) {
    const res = { added: [], removed: [], fixed: [] };
    this.edit(() => {
      const parts = new Map(sch.parts.filter(isPhysical).map((p) => [p.id, p]));
      for (const f of [...this.fps]) {
        if (f.part == null) continue;
        const p = parts.get(f.part);
        if (!p) { this.fps.splice(this.fps.indexOf(f), 1); res.removed.push(f.part); continue; }
        if (!this._fpFits(f.fp, p)) { f.fp = defaultFootprint(p); res.fixed.push(p.ref); }
      }
      const have = new Set(this.fps.map((f) => f.part));
      const fresh = [...parts.values()].filter((p) => !have.has(p.id)).sort((a, b) => String(a.ref).localeCompare(String(b.ref), 'pt', { numeric: true }));
      this._place(fresh, res);
    });
    return res;
  }
  _fpFits(id, part) {
    const fp = getFootprint(id); if (!fp) return false;
    const n = pinsOf(part).length, map = pinIndexMap(fp, part);
    if (/^(DIP|SIP)-/.test(id) && fp.pads.length !== n) return false;
    return map.every((k) => k < n);
  }
  _place(parts, res) {
    if (!parts.length) return;
    const b = this.outlineBox(), margin = 3, gap = 2.5, maxW = Math.max(30, b.x1 - b.x0 - margin * 2);
    let cx = b.x0 + margin, cy = b.y0 + margin, rowH = 0;
    if (this.fps.length) cy = Math.max(b.y0 + margin, Math.max(...this.fps.flatMap((f) => fpBoxPoly(f).map((p) => p[1]))) + gap);
    for (const p of parts) {
      const id = defaultFootprint(p), fp = getFootprint(id); if (!fp) continue;
      const w = fp.box.x1 - fp.box.x0, hh = fp.box.y1 - fp.box.y0;
      if (cx + w > b.x0 + margin + maxW && cx > b.x0 + margin) { cx = b.x0 + margin; cy += rowH + gap; rowH = 0; }
      const inst = { id: uid(), part: p.id, fp: id, x: snapTo(cx - fp.box.x0, 0.5), y: snapTo(cy - fp.box.y0, 0.5), r: 0, b: false };
      this.fps.push(inst); res.added.push(p.id);
      cx += w + gap; rowH = Math.max(rowH, hh);
    }
  }

  // ---------- edição ----------
  addFree(fpId, x, y) {
    return this.edit(() => { const f = { id: uid(), part: null, fp: fpId, x: r2(x), y: r2(y), r: 0, b: false }; this.fps.push(f); return f; });
  }
  setFootprint(id, fpId) { this.edit(() => { const f = this.fp(id); if (f && getFootprint(fpId)) f.fp = fpId; }); }
  addTrack(l, w, a, b) {
    return this.edit(() => { if (a[0] === b[0] && a[1] === b[1]) return null; const t = { id: uid(), l: l === 'B' ? 'B' : 'F', w: r2(w), a: [r2(a[0]), r2(a[1])], b: [r2(b[0]), r2(b[1])] }; this.tracks.push(t); return t; });
  }
  addVia(x, y, d = this.rules.viaD, h = this.rules.viaH) {
    return this.edit(() => { const v = { id: uid(), x: r2(x), y: r2(y), d: r2(d), h: r2(h) }; this.vias.push(v); return v; });
  }
  setTrackWidth(ids, w) { this.edit(() => { for (const t of this.tracks) if (ids.includes(t.id)) t.w = r2(w); }); }
  deleteItems(sel) {
    this.edit(() => {
      const F = new Set(sel.fps || []), T = new Set(sel.tracks || []), V = new Set(sel.vias || []);
      this.fps = this.fps.filter((f) => !(F.has(f.id) && f.part == null)); // pegadas de peças do esquema só saem apagando a peça no esquema
      this.tracks = this.tracks.filter((t) => !T.has(t.id)); this.vias = this.vias.filter((v) => !V.has(v.id));
    });
  }
  rotateFps(ids, deg = 90) { this.edit(() => { for (const f of this.fps) if (ids.includes(f.id)) { this._withStretch([f], () => { f.r = (((f.r || 0) + deg) % 360 + 360) % 360; }); } }); }
  flipFps(ids) { this.edit(() => { for (const f of this.fps) if (ids.includes(f.id)) this._withStretch([f], () => { f.b = !f.b; }); }); }
  /** Executa uma mudança e arrasta as pontas de trilhas que estavam presas aos pads. */
  _withStretch(insts, fn) {
    const before = insts.map((f) => this._padPoints(f));
    fn();
    const after = insts.map((f) => this._padPoints(f));
    insts.forEach((f, k) => before[k].forEach((o, i) => { const n = after[k][i]; if (!n || (n[0] === o[0] && n[1] === o[1])) return; for (const t of this.tracks) for (const e of [t.a, t.b]) if (Math.abs(e[0] - o[0]) < 0.011 && Math.abs(e[1] - o[1]) < 0.011) { e[0] = r2(n[0]); e[1] = r2(n[1]); } }));
  }
  _padPoints(f) { const fp = getFootprint(f.fp); return fp ? fp.pads.map((p) => fpPoint(f, p.x, p.y)) : []; }
  /** Move itens selecionados. Trilhas presas aos pads das pegadas movidas esticam junto. */
  applyMove(sel, dx, dy) {
    const F = new Set(sel.fps || []), T = new Set(sel.tracks || []), V = new Set(sel.vias || []);
    const moved = this.fps.filter((f) => F.has(f.id));
    const olds = moved.map((f) => this._padPoints(f));
    for (const f of moved) { f.x = r2(f.x + dx); f.y = r2(f.y + dy); }
    const eq = (a, o) => Math.abs(a[0] - o[0]) < 0.011 && Math.abs(a[1] - o[1]) < 0.011;
    for (const t of this.tracks) {
      if (T.has(t.id)) { t.a = [r2(t.a[0] + dx), r2(t.a[1] + dy)]; t.b = [r2(t.b[0] + dx), r2(t.b[1] + dy)]; continue; }
      for (const e of [t.a, t.b]) if (olds.some((pts) => pts.some((o) => eq(e, o)))) { e[0] = r2(e[0] + dx); e[1] = r2(e[1] + dy); }
    }
    const vold = this.vias.filter((v) => V.has(v.id)).map((v) => [v.x, v.y]);
    for (const v of this.vias) if (V.has(v.id)) { v.x = r2(v.x + dx); v.y = r2(v.y + dy); }
    if (vold.length) for (const t of this.tracks) if (!T.has(t.id)) for (const e of [t.a, t.b]) if (vold.some((o) => eq(e, o))) { e[0] = r2(e[0] + dx); e[1] = r2(e[1] + dy); }
  }

  // ---------- busca ----------
  hit(x, y, tol = 0.5, layer = null) {
    for (const v of this.vias) if (Math.hypot(v.x - x, v.y - y) <= v.d / 2 + tol * 0.4) return { type: 'via', id: v.id };
    let best = null, bd = tol;
    for (const t of this.tracks) {
      if (layer && t.l !== layer) continue;
      const d = distPtSeg([x, y], t.a, t.b) - t.w / 2; if (d <= bd) { bd = d; best = { type: 'track', id: t.id }; }
    }
    if (best) {
      // pad tem prioridade sobre trilha que termina nele
      const f = this.fpAt(x, y, true); if (f) return { type: 'fp', id: f.id };
      return best;
    }
    const f = this.fpAt(x, y, false); if (f) return { type: 'fp', id: f.id };
    const t = this.tracks.find((tr) => distPtSeg([x, y], tr.a, tr.b) - tr.w / 2 <= tol);
    return t ? { type: 'track', id: t.id } : null;
  }
  fpAt(x, y, padsOnly) {
    let best = null, area = Infinity;
    for (const f of this.fps) {
      const fp = getFootprint(f.fp); if (!fp) continue;
      if (padsOnly) { if (fp.pads.some((p) => shapeDist(padShape(f, p), { k: 'cap', a: [x, y], b: [x, y], r: 0 }) <= 0)) { best = f; break; } continue; }
      const q = fpBoxPoly(f); if (pointInPoly([x, y], q)) { const b = shapeBox({ k: 'poly', pts: q }), a = (b.x1 - b.x0) * (b.y1 - b.y0); if (a < area) { area = a; best = f; } }
    }
    return best;
  }
  inRect(x0, y0, x1, y1) {
    if (x0 > x1) [x0, x1] = [x1, x0]; if (y0 > y1) [y0, y1] = [y1, y0];
    const inB = (b) => b.x1 >= x0 && b.x0 <= x1 && b.y1 >= y0 && b.y0 <= y1;
    return {
      fps: this.fps.filter((f) => inB(shapeBox({ k: 'poly', pts: fpBoxPoly(f) }))).map((f) => f.id),
      tracks: this.tracks.filter((t) => inB(shapeBox({ k: 'cap', a: t.a, b: t.b, r: t.w / 2 }))).map((t) => t.id),
      vias: this.vias.filter((v) => inB({ x0: v.x - v.d / 2, y0: v.y - v.d / 2, x1: v.x + v.d / 2, y1: v.y + v.d / 2 })).map((v) => v.id),
    };
  }
  /** Trilhas ligadas ponta com ponta (mesma camada, sem pad nem via no meio) a partir de uma. */
  trackRun(id) {
    const start = this.tracks.find((t) => t.id === id); if (!start) return [];
    const k = (l, p) => l + '|' + p[0] + ',' + p[1], ends = new Map();
    for (const t of this.tracks) for (const e of [t.a, t.b]) { const kk = k(t.l, e); (ends.get(kk) || ends.set(kk, []).get(kk)).push(t); }
    const stops = new Set();
    for (const f of this.fps) for (const p of this._padPoints(f)) { stops.add('F|' + p[0] + ',' + p[1]); stops.add('B|' + p[0] + ',' + p[1]); }
    for (const v of this.vias) { stops.add('F|' + v.x + ',' + v.y); stops.add('B|' + v.x + ',' + v.y); }
    const seen = new Set([id]), q = [start];
    while (q.length) { const t = q.pop(); for (const e of [t.a, t.b]) { const kk = k(t.l, e), here = ends.get(kk) || []; if (here.length === 2 && !stops.has(kk)) for (const o of here) if (!seen.has(o.id)) { seen.add(o.id); q.push(o); } } }
    return [...seen];
  }

  // ---------- cobre e ligações ----------
  /** Todos os objetos de cobre, com camadas e rede (a rede vem do esquema). */
  copper(sch) {
    const netOf = new Map();
    if (sch) for (const net of sch.analyze().nets) for (const p of net.pins) netOf.set(p.partId + '|' + (p.num ?? p.pin), net.label);
    const objs = [];
    for (const f of this.fps) {
      const fp = getFootprint(f.fp); if (!fp) continue;
      const part = sch?.parts.find((p) => p.id === f.part);
      const pins = part ? pinsOf(part) : [], map = part ? pinIndexMap(fp, part) : [];
      fp.pads.forEach((pad, i) => {
        const pin = pins[map[i]]; const net = pin ? netOf.get(part.id + '|' + (pin.num ?? pin.n)) || null : null;
        const layers = pad.d ? ['F', 'B'] : [f.b ? 'B' : 'F'];
        const sh = padShape(f, pad), c = sh.k === 'cap' ? [(sh.a[0] + sh.b[0]) / 2, (sh.a[1] + sh.b[1]) / 2] : [(sh.pts[0][0] + sh.pts[2][0]) / 2, (sh.pts[0][1] + sh.pts[2][1]) / 2];
        objs.push({ kind: 'pad', id: f.id + ':' + i, fpId: f.id, ref: part?.ref || '', pad: pad.n, shape: sh, layers, net, c, drill: pad.d });
      });
    }
    for (const t of this.tracks) objs.push({ kind: 'track', id: t.id, shape: { k: 'cap', a: t.a, b: t.b, r: t.w / 2 }, layers: [t.l], net: null, c: t.a });
    for (const v of this.vias) objs.push({ kind: 'via', id: v.id, shape: { k: 'cap', a: [v.x, v.y], b: [v.x, v.y], r: v.d / 2 }, layers: ['F', 'B'], net: null, c: [v.x, v.y], drill: v.h });
    return objs;
  }
  /** Pares de objetos vizinhos (para ligação e distâncias), usando uma grade. */
  static pairs(objs, margin = 0) {
    const cell = 5, grid = new Map(), out = [], seen = new Set();
    objs.forEach((o, i) => {
      const b = shapeBox(o.shape); o._b = b;
      for (let gx = Math.floor((b.x0 - margin) / cell); gx <= Math.floor((b.x1 + margin) / cell); gx++) for (let gy = Math.floor((b.y0 - margin) / cell); gy <= Math.floor((b.y1 + margin) / cell); gy++) {
        const k = gx + ',' + gy; const arr = grid.get(k) || grid.set(k, []).get(k);
        for (const j of arr) { const key = j * 100000 + i; if (!seen.has(key)) { seen.add(key); out.push([j, i]); } }
        arr.push(i);
      }
    });
    return out;
  }
  /**
   * Analisa a placa: junta o cobre que se toca, descobre a rede de cada ilha, acha curtos e
   * liga com "fios de ajuda" (ratsnest) o que ainda falta ligar.
   */
  analyze(sch) {
    if (this._an && this._an.schRev === (sch?.rev ?? -1)) return this._an;
    const objs = this.copper(sch), n = objs.length, parent = objs.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    for (const [i, j] of Board.pairs(objs)) {
      const a = objs[i], b = objs[j];
      if (!a.layers.some((l) => b.layers.includes(l))) continue;
      if (a.kind === 'pad' && b.kind === 'pad' && a.fpId === b.fpId) continue;
      if (shapeDist(a.shape, b.shape) <= 0.0005) parent[find(i)] = find(j);
    }
    const comps = new Map();
    objs.forEach((o, i) => { const r = find(i); let c = comps.get(r); if (!c) { c = { objs: [], nets: new Set() }; comps.set(r, c); } c.objs.push(o); if (o.net) c.nets.add(o.net); });
    const shorts = [];
    for (const c of comps.values()) if (c.nets.size > 1) shorts.push({ nets: [...c.nets], at: c.objs.find((o) => o.net)?.c, ids: c.objs.map((o) => o.id) });
    // fios de ajuda: por rede, árvore geradora mínima entre as ilhas
    const byNet = new Map();
    for (const c of comps.values()) for (const net of c.nets) { const arr = byNet.get(net) || byNet.set(net, []).get(net); arr.push(c); }
    const ratsnest = []; let netsTotal = 0, netsDone = 0;
    for (const [net, cs] of byNet) {
      const padsCount = new Set(cs.flatMap((c) => c.objs.filter((o) => o.kind === 'pad' && o.net === net).map((o) => o.id))).size;
      if (padsCount < 2) continue;
      netsTotal++;
      if (cs.length === 1) { netsDone++; continue; }
      const pts = cs.map((c) => c.objs.filter((o) => o.kind === 'pad' && o.net === net));
      const inT = new Set([0]), dist = (a, b) => { let m = Infinity, pa = null, pb = null; for (const p of a) for (const q of b) { const d = Math.hypot(p.c[0] - q.c[0], p.c[1] - q.c[1]); if (d < m) { m = d; pa = p; pb = q; } } return { d: m, pa, pb }; };
      while (inT.size < cs.length) {
        let best = null;
        for (const i of inT) for (let j = 0; j < cs.length; j++) if (!inT.has(j)) { const e = dist(pts[i], pts[j]); if (!best || e.d < best.d) best = { ...e, j }; }
        inT.add(best.j); ratsnest.push({ net, a: best.pa.c, b: best.pb.c, pa: best.pa.id, pb: best.pb.id, d: best.d });
      }
    }
    const objNet = new Map(); for (const c of comps.values()) if (c.nets.size === 1) for (const o of c.objs) objNet.set(o.id, [...c.nets][0]);
    this._an = { objNet, schRev: sch?.rev ?? -1, objs, comps: [...comps.values()], shorts, ratsnest, unrouted: ratsnest.length, netsTotal, netsDone, padNet: new Map(objs.filter((o) => o.kind === 'pad').map((o) => [o.id, o.net])) };
    return this._an;
  }
}
