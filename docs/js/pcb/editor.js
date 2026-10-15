// Editor da placa de circuito impresso: contorno, pegadas, trilhas (frente e verso), vias.
import { h, modal, toast, clamp } from '../util.js';
import { icon } from '../icons.js';
import { canvasOut } from '../circuit/render.js';
import { getFootprint, choicesFor, footprintName } from './footprints.js';
import { Board, snapTo, r2, distPtSeg, fpPoint, padShape, shapeDist, outlineRect, outlineRounded, outlineCircle, fpBoxPoly } from './board.js';
import { paintBoard, PCB_THEME } from './render.js';

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const isMobile = () => window.matchMedia('(max-width: 820px)').matches;
const STATUS = { saved: 'Salvo', saving: 'Salvando…', dirty: 'Não salvo ainda', offline: 'Sem conexão — tentando de novo', error: 'Erro ao salvar', conflict: 'Alterado em outro aparelho' };
const WIDTHS = [0.25, 0.4, 0.6, 1, 1.5, 2];
const GRIDS = [0.1, 0.25, 0.5, 1.27, 2.54];
const fmt = (v) => String(v).replace('.', ',');

/** Caminho em 45°: de P a Q, primeiro reto e depois na diagonal (ou direto, com Shift). */
export function route45(P, Q, direct = false) {
  const dx = Q[0] - P[0], dy = Q[1] - P[1], ax = Math.abs(dx), ay = Math.abs(dy);
  if (direct || dx === 0 || dy === 0 || Math.abs(ax - ay) < 1e-6) return [P, Q];
  const sx = Math.sign(dx), sy = Math.sign(dy);
  const M = ax > ay ? [r2(Q[0] - sx * ay), P[1]] : [P[0], r2(Q[1] - sy * ax)];
  return [P, M, Q];
}

export function mountPcbEditor(root, state, saver, { onExit, onSwitch }) {
  const sch = state.sch, board = state.board;
  let tool = 'sel', sheet = null, active = 'F';
  let sel = { fps: [], tracks: [], vias: [] }, selVertex = -1;
  let grid = Number(lsGet('atelie_pgrid')) || 0.5, trackW = Number(lsGet('atelie_ptw')) || board.rules.trackW;
  const vis = { F: true, B: true, silk: true, rat: true, refs: true, nets: false };
  const view = { x: 40, y: 40, k: 8 };
  let wireStart = null, wireEnd = null, wirePath = null, band = null, drag = null, spaceDown = false, hoverNet = null, hotPin = null, hotNet = null;
  let raf = 0, ignoreUp = false, pinch = null, fromPanel = false;
  const pointers = new Map();
  const th = PCB_THEME;

  const analysis = () => board.analyze(sch);
  const selCount = () => sel.fps.length + sel.tracks.length + sel.vias.length;
  const clearSel = () => { sel = { fps: [], tracks: [], vias: [] }; selVertex = -1; };

  // ---------- estrutura ----------
  const canvas = h('canvas.ce-canvas', { tabIndex: 0, 'aria-label': 'Área da placa de circuito impresso' });
  const ctx = canvas.getContext('2d');
  const hint = h('div.ce-hint', { role: 'status' });
  const iconBtn = (ic, title, fn, cls = '') => h('button.ibtn' + cls, { type: 'button', title, 'aria-label': title, onclick: fn, html: ic });
  const undoB = iconBtn(icon.undo, 'Desfazer (Ctrl+Z)', () => board.undo());
  const redoB = iconBtn(icon.redo, 'Refazer (Ctrl+Y)', () => board.redo());
  const nameIn = h('input.docname', { value: state.name, maxLength: 80, 'aria-label': 'Nome do circuito', onchange: () => { const v = nameIn.value.trim() || 'Circuito sem título'; nameIn.value = v; saver.rename(v); } });
  const statusEl = h('div.save-status', { role: 'status', 'aria-live': 'polite' });
  const seg = h('div.ce-seg', { role: 'tablist' }, h('button', { type: 'button', role: 'tab', 'aria-selected': 'false', onclick: () => onSwitch('sch') }, 'Esquema'), h('button', { type: 'button', role: 'tab', 'aria-selected': 'true' }, 'Placa'));
  const top = h('header.topbar', {}, iconBtn(icon.back, 'Voltar à galeria', () => onExit()), h('div.docinfo', {}, nameIn, statusEl), h('div.spacer'), seg, undoB, redoB);

  const toolDefs = [['sel', 'Selecionar (V)', icon.cursor, 'Selecionar'], ['track', 'Trilha (W)', icon.wire, 'Trilha'], ['via', 'Via (I)', icon.via, 'Via'], ['outline', 'Contorno da placa (O)', icon.board, 'Contorno'], ['pan', 'Mover a tela (H)', icon.hand, 'Mão'], ['panel', 'Painel', icon.sliders, 'Painel']];
  const toolBtns = {};
  const rail = h('nav.ce-rail', { 'aria-label': 'Ferramentas' }, ...toolDefs.map(([id, title, ic, label]) => (toolBtns[id] = h('button.tool' + (id === 'panel' ? '.only-m' : ''), { type: 'button', title, 'aria-label': title, onclick: () => (id === 'panel' ? setSheet(sheet === 'info' ? null : 'info') : setTool(id)) }, h('span.ic', { html: ic }), h('small', {}, label)))));
  const panel = h('aside.ce-panel', { 'aria-label': 'Painel da placa' }, h('div.grab', { onclick: () => setSheet(null) }, h('span')));
  const panelBody = h('div.ce-panelbody'); panel.append(panelBody);

  const fab = (ic, title, fn) => h('button.ce-fab', { type: 'button', title, 'aria-label': title, onclick: fn, html: ic });
  const layerFab = h('button.ce-fab.pe-layer', { type: 'button', title: 'Lado ativo: toque para trocar (L)', onclick: () => setActive(active === 'F' ? 'B' : 'F') });
  const fabs = h('div.ce-fabs', {}, fab(icon.zoomIn, 'Aproximar', () => zoomBy(1.3)), fab(icon.zoomOut, 'Afastar', () => zoomBy(1 / 1.3)), fab(icon.fit, 'Enquadrar (0)', () => fit()), layerFab);
  const selbar = h('div.ce-selbar', { hidden: true });
  const stage = h('main.ce-stage', {}, canvas, hint, fabs, selbar);
  const wrap = h('div.cedit.pedit', {}, top, rail, stage, panel);
  root.replaceChildren(wrap);

  function setSheet(s) { sheet = s; if (s) wrap.dataset.sheet = s; else delete wrap.dataset.sheet; syncTools(); renderSelbar(); }
  function setActive(l) { active = l; syncLayer(); draw(); renderPanel(); }
  function syncLayer() { layerFab.textContent = active; layerFab.dataset.l = active; layerFab.style.setProperty('--lc', th[active]); }
  function setTool(t) {
    if (t !== 'track') { wireStart = null; wireEnd = null; wirePath = null; hotNet = null; }
    tool = t; if (t !== 'outline') selVertex = -1; if (isMobile()) setSheet(null);
    syncTools(); updateHint(); canvas.dataset.tool = tool === 'outline' ? 'wire' : tool; renderSelbar(); renderPanel(); draw();
  }
  function syncTools() { for (const [id, b] of Object.entries(toolBtns)) b.setAttribute('aria-pressed', String(id === 'panel' ? sheet === 'info' : id === tool)); }
  function updateHint() {
    let t = '';
    if (tool === 'track') t = wireStart ? 'Toque o próximo ponto. Toque no pino de destino para terminar. “Via” troca de lado. Esc termina.' : `Toque num pino para começar a trilha (lado ${active === 'F' ? 'da frente' : 'de trás'}). Os fios finos mostram o que falta ligar.`;
    else if (tool === 'via') t = 'Toque onde quer uma via (furo que passa a trilha para o outro lado).';
    else if (tool === 'outline') t = 'Arraste os cantos para mudar o formato. Toque numa borda para criar um canto novo. Delete apaga o canto escolhido.';
    else if (tool === 'pan') t = 'Arraste para mover a tela.';
    else if (board.fps.length === 0) t = 'Toque em “Atualizar do esquema” no painel para trazer as peças para a placa.';
    hint.textContent = t; hint.hidden = !t;
  }

  // ---------- vista ----------
  const size = () => { const r = canvas.getBoundingClientRect(); return { w: r.width, h: r.height }; };
  function resize() {
    const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * dpr)), hh = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== hh) { canvas.width = w; canvas.height = hh; }
    draw();
  }
  function fit() {
    const { w, h: hh } = size(); const b = board.outlineBox(), pad = 40;
    const bw = Math.max(1, b.x1 - b.x0), bh = Math.max(1, b.y1 - b.y0);
    view.k = clamp(Math.min((w - pad * 2) / bw, (hh - pad * 2) / bh), 1, 60);
    view.x = (w - bw * view.k) / 2 - b.x0 * view.k; view.y = (hh - bh * view.k) / 2 - b.y0 * view.k; draw();
  }
  function zoomAt(f, sx, sy) { const k = clamp(view.k * f, 1.5, 120), wx = (sx - view.x) / view.k, wy = (sy - view.y) / view.k; view.k = k; view.x = sx - wx * k; view.y = sy - wy * k; draw(); }
  function zoomBy(f) { const { w, h: hh } = size(); zoomAt(f, w / 2, hh / 2); }
  const toWorld = (e) => { const r = canvas.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top; return { sx, sy, x: (sx - view.x) / view.k, y: (sy - view.y) / view.k }; };
  const tolW = () => clamp(10 / view.k, 0.3, 2);
  const fitMissing = () => { /* reservado */ };

  // ---------- desenho ----------
  const requestDraw = () => { if (!raf) raf = requestAnimationFrame(draw); };
  const refOf = (f) => (f.part ? sch.parts.find((p) => p.id === f.part)?.ref || '' : '');
  function draw() {
    raf = 0;
    const dpr = window.devicePixelRatio || 1, W = canvas.width / dpr, H = canvas.height / dpr, k = view.k;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = th.bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * view.x, dpr * view.y);
    const x0 = -view.x / k, y0 = -view.y / k, x1 = (W - view.x) / k, y1 = (H - view.y) / k;
    const step = grid * k >= 6 ? grid : (grid * 5 * k >= 6 ? grid * 5 : 0);
    if (step) {
      ctx.lineWidth = 1 / k; const major = step * 5;
      for (const mj of [false, true]) {
        ctx.beginPath(); ctx.strokeStyle = mj ? th.gridMajor : th.grid;
        for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) if ((Math.abs(Math.round(x / major) * major - x) < step / 100) === mj) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
        for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) if ((Math.abs(Math.round(y / major) * major - y) < step / 100) === mj) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
        ctx.stroke();
      }
    }
    const out = canvasOut(ctx, k), an = analysis();
    const hot = hotNet || (selCount() === 1 && sel.tracks.length === 1 ? an.objNet.get(sel.tracks[0]) : null) || hoverNet;
    paintBoard(out, board, th, { vis, active, sel, an, hot, refOf, showNets: vis.nets && k > 14 });
    if (tool === 'outline') {
      board.outline.forEach((p, i) => out.circle(p[0], p[1], 5 / k, { fill: i === selVertex ? '#fff' : th.sel, stroke: '#000', width: 1 / k }));
    }
    if (wirePath) out.poly(wirePath, { stroke: th[active], width: trackW });
    if (wireStart) out.circle(wireStart[0], wireStart[1], 0.5, { stroke: '#fff', width: 0.12 });
    if (hotPin) out.circle(hotPin[0], hotPin[1], 0.9, { stroke: '#fff', width: 0.12 });
    if (tool === 'via' && wireEnd) out.circle(wireEnd[0], wireEnd[1], board.rules.viaD / 2, { stroke: '#fff', width: 0.12 });
    if (band) { out.alpha(1); out.rect(Math.min(band.x0, band.x1), Math.min(band.y0, band.y1), Math.max(band.x0, band.x1), Math.max(band.y0, band.y1), { stroke: th.sel, fill: 'rgba(120,140,255,.12)', width: 1, dash: [4, 3] }); }
  }

  // ---------- pontos ----------
  /** Ponto magnético: centro de pad, ponta de trilha ou via por perto; senão a grade. */
  function snap(w) {
    const r = clamp(12 / view.k, 0.4, 2.5);
    let best = null, bd = r;
    for (const o of analysis().objs) if (o.kind === 'pad') { const d = Math.hypot(o.c[0] - w.x, o.c[1] - w.y); if (d < bd) { bd = d; best = { pt: [o.c[0], o.c[1]], pad: o }; } }
    for (const v of board.vias) { const d = Math.hypot(v.x - w.x, v.y - w.y); if (d < bd) { bd = d; best = { pt: [v.x, v.y] }; } }
    for (const t of board.tracks) if (t.l === active) for (const e of [t.a, t.b]) { const d = Math.hypot(e[0] - w.x, e[1] - w.y); if (d < bd) { bd = d; best = { pt: [e[0], e[1]] }; } }
    return best || { pt: [snapTo(w.x, grid), snapTo(w.y, grid)] };
  }
  const onCopper = (pt) => {
    const probe = { k: 'cap', a: pt, b: pt, r: 0 };
    return analysis().objs.some((o) => o.kind !== 'track' && o.layers.includes(active) && shapeDist(o.shape, probe) <= 0.001) || board.tracks.some((t) => t.l === active && (Math.hypot(t.a[0] - pt[0], t.a[1] - pt[1]) < 0.01 || Math.hypot(t.b[0] - pt[0], t.b[1] - pt[1]) < 0.01));
  };
  const same = (a, b) => Math.abs(a[0] - b[0]) < 0.005 && Math.abs(a[1] - b[1]) < 0.005;

  function commitPath(path) {
    board.edit(() => { for (let i = 0; i + 1 < path.length; i++) if (!same(path[i], path[i + 1])) { const t = { id: Math.random().toString(36).slice(2, 10), l: active, w: r2(trackW), a: [r2(path[i][0]), r2(path[i][1])], b: [r2(path[i + 1][0]), r2(path[i + 1][1])] }; board.tracks.push(t); } });
  }
  function dropVia() {
    const at = wireStart || wireEnd; if (!at) return;
    board.addVia(at[0], at[1]); const n = active === 'F' ? 'B' : 'F'; setActive(n); updateHint();
  }

  // ---------- ponteiro ----------
  function onDown(e) {
    canvas.focus({ preventScroll: true });
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    if (pointers.size === 2) { startPinch(); return; }
    if (pointers.size > 2 || ignoreUp) return;
    const w = toWorld(e), shift = e.shiftKey || e.ctrlKey || e.metaKey;
    if (e.button === 1 || e.button === 2 || spaceDown || tool === 'pan') { drag = { type: 'pan', sx: w.sx, sy: w.sy, vx: view.x, vy: view.y }; canvas.classList.add('panning'); return; }
    if (tool === 'sel') {
      const hit = board.hit(w.x, w.y, tolW(), null);
      if (hit) {
        const list = hit.type === 'fp' ? sel.fps : hit.type === 'track' ? sel.tracks : sel.vias;
        if (list.includes(hit.id) && shift) { list.splice(list.indexOf(hit.id), 1); onSelChange(); drag = null; return; }
        if (!list.includes(hit.id)) { if (!shift) clearSel(); if (hit.type === 'track') sel.tracks.push(...board.trackRun(hit.id)); else (hit.type === 'fp' ? sel.fps : sel.vias).push(hit.id); onSelChange(); }
        drag = { type: 'move', sx: w.sx, sy: w.sy, wx: w.x, wy: w.y, moved: false, lx: 0, ly: 0 };
      } else { if (!shift && selCount()) { clearSel(); onSelChange(); } drag = { type: 'band', sx: w.sx, sy: w.sy, add: shift }; band = { x0: w.x, y0: w.y, x1: w.x, y1: w.y }; }
    } else if (tool === 'track') {
      const s = snap(w);
      if (!wireStart) { wireStart = s.pt; wireEnd = s.pt; hotNet = s.pad?.net || null; drag = { type: 'track', fresh: true }; }
      else { wireEnd = s.pt; wirePath = route45(wireStart, wireEnd, e.shiftKey); drag = { type: 'track', fresh: false }; }
      updateHint(); draw();
    } else if (tool === 'via') {
      const s = snap(w); wireEnd = s.pt; drag = { type: 'via' }; draw();
    } else if (tool === 'outline') {
      const r = clamp(12 / view.k, 0.5, 3); let vi = -1, bd = r;
      board.outline.forEach((p, i) => { const d = Math.hypot(p[0] - w.x, p[1] - w.y); if (d < bd) { bd = d; vi = i; } });
      if (vi < 0) {
        let ei = -1, ed = r * 0.8;
        board.outline.forEach((p, i) => { const q = board.outline[(i + 1) % board.outline.length], d = distPtSeg([w.x, w.y], p, q); if (d < ed) { ed = d; ei = i; } });
        if (ei >= 0) { board.insertVertex(ei, snapTo(w.x, grid), snapTo(w.y, grid)); vi = ei + 1; }
      }
      if (vi >= 0) { selVertex = vi; board.beginTransient(); drag = { type: 'vertex', i: vi, moved: false }; }
      else { selVertex = -1; }
      draw();
    }
  }
  function onMove(e) {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size >= 2) { updatePinch(); return; }
    const w = toWorld(e);
    if (!drag) {
      if (tool === 'track') {
        const s = snap(w); hotPin = s.pad ? s.pt : null; hoverNet = !wireStart && s.pad ? s.pad.net : null;
        if (wireStart) { wireEnd = s.pt; wirePath = route45(wireStart, wireEnd, e.shiftKey); }
        requestDraw();
      } else if (tool === 'via') { wireEnd = snap(w).pt; requestDraw(); }
      return;
    }
    if (drag.type === 'pan') { view.x = drag.vx + (w.sx - drag.sx); view.y = drag.vy + (w.sy - drag.sy); requestDraw(); }
    else if (drag.type === 'move') {
      if (!drag.moved && Math.hypot(w.sx - drag.sx, w.sy - drag.sy) < 5) return;
      const dx = snapTo(w.x - drag.wx, grid), dy = snapTo(w.y - drag.wy, grid);
      if (!drag.moved) { drag.moved = true; board.beginTransient(); }
      if (dx !== drag.lx || dy !== drag.ly) { drag.lx = dx; drag.ly = dy; board.setTransient(() => board.applyMove(sel, dx, dy)); }
    } else if (drag.type === 'band') { band.x1 = w.x; band.y1 = w.y; requestDraw(); }
    else if (drag.type === 'track') { const s = snap(w); hotPin = s.pad ? s.pt : null; wireEnd = s.pt; wirePath = route45(wireStart, wireEnd, e.shiftKey); requestDraw(); }
    else if (drag.type === 'via') { wireEnd = snap(w).pt; requestDraw(); }
    else if (drag.type === 'vertex') { drag.moved = true; board.setTransient(() => board.moveVertex(drag.i, snapTo(w.x, grid), snapTo(w.y, grid))); }
  }
  function onUp(e) {
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) { pinch = null; ignoreUp = pointers.size > 0; } return; }
    if (ignoreUp) { if (!pointers.size) ignoreUp = false; return; }
    const d = drag; drag = null; canvas.classList.remove('panning');
    if (!d) return;
    const w = toWorld(e);
    if (d.type === 'move') { if (d.moved) board.endTransient(true); }
    else if (d.type === 'vertex') { board.endTransient(true); draw(); renderPanel(); }
    else if (d.type === 'band') {
      const b = band; band = null;
      if (Math.hypot(w.sx - d.sx, w.sy - d.sy) > 4) { const r = board.inRect(b.x0, b.y0, b.x1, b.y1); sel = d.add ? { fps: [...new Set([...sel.fps, ...r.fps])], tracks: [...new Set([...sel.tracks, ...r.tracks])], vias: [...new Set([...sel.vias, ...r.vias])] } : r; }
      onSelChange();
    } else if (d.type === 'track') {
      const s = snap(w), pt = s.pt;
      if (d.fresh) {
        if (!same(pt, wireStart)) { commitPath(route45(wireStart, pt, e.shiftKey)); wireStart = null; wireEnd = null; wirePath = null; hotNet = null; }
      } else if (same(pt, wireStart)) { wireStart = null; wireEnd = null; wirePath = null; hotNet = null; }
      else { commitPath(route45(wireStart, pt, e.shiftKey)); if (onCopper(pt)) { wireStart = null; wireEnd = null; wirePath = null; hotNet = null; } else { wireStart = pt; wireEnd = pt; wirePath = null; } }
      hotPin = null; updateHint(); draw();
    } else if (d.type === 'via') { const s = snap(w); board.addVia(s.pt[0], s.pt[1]); wireEnd = null; }
  }
  function onCancel(e) {
    pointers.delete(e.pointerId);
    if ((drag?.type === 'move' && drag.moved) || drag?.type === 'vertex') board.endTransient(false);
    drag = null; band = null; pinch = null; canvas.classList.remove('panning'); draw();
  }
  function startPinch() {
    if ((drag?.type === 'move' && drag.moved) || drag?.type === 'vertex') board.endTransient(false);
    drag = null; band = null; canvas.classList.remove('panning');
    const [a, b] = [...pointers.values()], r = canvas.getBoundingClientRect();
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2 - r.left, cy: (a.y + b.y) / 2 - r.top, v: { ...view } };
    pinch.wx = (pinch.cx - view.x) / view.k; pinch.wy = (pinch.cy - view.y) / view.k; draw();
  }
  function updatePinch() {
    const [a, b] = [...pointers.values()], r = canvas.getBoundingClientRect();
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1, cx = (a.x + b.x) / 2 - r.left, cy = (a.y + b.y) / 2 - r.top;
    view.k = clamp(pinch.v.k * d / pinch.d, 1.5, 120); view.x = cx - pinch.wx * view.k; view.y = cy - pinch.wy * view.k; requestDraw();
  }
  function onWheel(e) { e.preventDefault(); const r = canvas.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)), e.clientX - r.left, e.clientY - r.top); }
  function onDbl() { if (tool === 'track' && wireStart) { wireStart = null; wireEnd = null; wirePath = null; hotNet = null; updateHint(); draw(); } }

  // ---------- seleção e ações ----------
  function onSelChange() { renderSelbar(); renderPanel(); draw(); }
  function pruneSel() {
    const F = new Set(board.fps.map((x) => x.id)), T = new Set(board.tracks.map((x) => x.id)), V = new Set(board.vias.map((x) => x.id));
    sel = { fps: sel.fps.filter((i) => F.has(i)), tracks: sel.tracks.filter((i) => T.has(i)), vias: sel.vias.filter((i) => V.has(i)) };
    if (selVertex >= board.outline.length) selVertex = -1;
  }
  function renderSelbar() {
    if (!selCount() || tool !== 'sel') { selbar.hidden = true; return; }
    selbar.hidden = false;
    const b = (ic, title, fn, cls = '') => h('button.ibtn' + cls, { type: 'button', title, 'aria-label': title, onclick: fn, html: ic });
    selbar.replaceChildren(
      ...(sel.fps.length ? [b(icon.rotate, 'Girar 90° (R)', () => board.rotateFps(sel.fps)), b(icon.mirror, 'Passar para o outro lado (F)', () => board.flipFps(sel.fps))] : []),
      b(icon.edit, 'Propriedades', () => { if (isMobile()) setSheet('info'); }),
      b(icon.trash, 'Excluir (Delete)', () => deleteSel(), '.danger'));
  }
  function deleteSel() {
    if (tool === 'outline' && selVertex >= 0) { if (!board.deleteVertex(selVertex)) toast('A placa precisa de pelo menos 3 cantos.'); selVertex = -1; draw(); return; }
    if (!selCount()) return;
    const onlyBound = sel.fps.length && !sel.tracks.length && !sel.vias.length && sel.fps.every((id) => board.fp(id)?.part != null);
    if (onlyBound) { toast('Esta peça veio do esquema. Para tirar da placa, apague a peça no esquema.'); return; }
    board.deleteItems(sel); clearSel(); onSelChange();
  }
  function syncFromSch(quiet) {
    const res = board.syncFromSchematic(sch);
    if (!quiet) toast(res.added.length || res.removed.length || res.fixed.length ? `Placa atualizada: ${res.added.length} peça${res.added.length === 1 ? '' : 's'} nova${res.added.length === 1 ? '' : 's'}${res.removed.length ? `, ${res.removed.length} removida${res.removed.length === 1 ? '' : 's'}` : ''}.` : 'A placa já está igual ao esquema.');
    updateHint(); return res;
  }

  // ---------- teclado ----------
  function onKey(e) {
    if (document.querySelector('.modal-back')) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) { if (e.key === 'Escape') t.blur(); return; }
    const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
    if (e.key === ' ') { spaceDown = true; e.preventDefault(); return; }
    if (mod && key === 'z') { e.preventDefault(); e.shiftKey ? board.redo() : board.undo(); return; }
    if (mod && key === 'y') { e.preventDefault(); board.redo(); return; }
    if (mod && key === 's') { e.preventDefault(); saver.flush(); toast('Salvando…'); return; }
    if (mod && key === 'a') { e.preventDefault(); sel = { fps: board.fps.map((x) => x.id), tracks: board.tracks.map((x) => x.id), vias: board.vias.map((x) => x.id) }; setTool('sel'); onSelChange(); return; }
    if (mod) return;
    if (e.key === 'Escape') { if (wireStart) { wireStart = null; wireEnd = null; wirePath = null; hotNet = null; updateHint(); draw(); } else if (tool !== 'sel') setTool('sel'); else if (selCount()) { clearSel(); onSelChange(); } return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSel(); return; }
    if (e.key.startsWith('Arrow') && selCount()) { e.preventDefault(); const s = e.shiftKey ? grid * 10 : grid; board.edit(() => board.applyMove(sel, e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0, e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0)); return; }
    if (key === 'r' && sel.fps.length) board.rotateFps(sel.fps, e.shiftKey ? -90 : 90);
    else if (key === 'f' && sel.fps.length) board.flipFps(sel.fps);
    else if (key === 'v' && tool === 'track') dropVia();
    else if (key === 'v') setTool('sel'); else if (key === 'w') setTool('track'); else if (key === 'i') setTool('via'); else if (key === 'o') setTool('outline'); else if (key === 'h') setTool('pan');
    else if (key === 'l') setActive(active === 'F' ? 'B' : 'F'); else if (key === '0') fit(); else if (key === '+' || key === '=') zoomBy(1.3); else if (key === '-') zoomBy(1 / 1.3);
  }
  const onKeyUp = (e) => { if (e.key === ' ') spaceDown = false; };

  // ---------- painel ----------
  const field = (label, input) => h('label.ce-field', {}, h('span.flabel', {}, label), input);
  const act = (ic, label, fn, cls = '') => h('button.btn.sm' + cls, { type: 'button', onclick: fn }, ic ? h('span.ic', { html: ic }) : null, label);
  const pill = (label, on, fn, title) => h('button.btn.sm', { type: 'button', 'aria-pressed': String(on), title, onclick: fn }, label);
  const num = (value, min, max, step, onchange, label) => h('input', { type: 'number', value, min, max, step, inputMode: 'decimal', 'aria-label': label, onchange: (e) => onchange(Number(e.target.value)) });

  function renderPanel() {
    if (fromPanel) return;
    const kids = [];
    if (selCount() === 1 && sel.fps.length === 1) kids.push(fpSection(board.fp(sel.fps[0])));
    else if (selCount() === 1 && sel.tracks.length === 1) kids.push(trackSection());
    else if (selCount() > 1) kids.push(h('section.ce-sec', {}, h('h3', {}, `${selCount()} itens selecionados`), h('div.ce-actions', {}, ...(sel.fps.length ? [act(icon.rotate, 'Girar', () => board.rotateFps(sel.fps)), act(icon.mirror, 'Outro lado', () => board.flipFps(sel.fps))] : []), act(icon.trash, 'Excluir', deleteSel, '.danger'))));
    kids.push(boardSection(), layersSection(), linksSection());
    panelBody.replaceChildren(...kids);
  }
  function fpSection(f) {
    if (!f) return h('div');
    const part = f.part ? sch.parts.find((p) => p.id === f.part) : null, fp = getFootprint(f.fp);
    const opts = part ? choicesFor(part) : ['HOLE-2.5', 'HOLE-3.2', 'HOLE-4.0'];
    if (!opts.includes(f.fp)) opts.unshift(f.fp);
    const selEl = h('select', { 'aria-label': 'Pegada', onchange: () => { fromPanel = false; board.setFootprint(f.id, selEl.value); } }, ...opts.map((id) => h('option', { value: id, selected: id === f.fp }, footprintName(id))));
    return h('section.ce-sec', {}, h('h3', {}, part ? `${part.ref || '?'} · ${part.val || ''}` : 'Furo de fixação'),
      field('Pegada (formato na placa)', selEl),
      h('p.hint', {}, fp ? `${fp.pads.length} pad${fp.pads.length === 1 ? '' : 's'} · ${f.b ? 'lado de trás' : 'lado da frente'} · ${f.r || 0}°` : ''),
      h('div.ce-actions', {}, act(icon.rotate, 'Girar', () => board.rotateFps([f.id])), act(icon.mirror, 'Outro lado', () => board.flipFps([f.id])), part ? null : act(icon.trash, 'Excluir', deleteSel, '.danger')));
  }
  function trackSection() {
    const t = board.tracks.find((x) => x.id === sel.tracks[0]); if (!t) return h('div');
    const len = sel.tracks.reduce((a, id) => { const q = board.tracks.find((x) => x.id === id); return a + (q ? Math.hypot(q.a[0] - q.b[0], q.a[1] - q.b[1]) : 0); }, 0);
    return h('section.ce-sec', {}, h('h3', {}, `Trilha · ${t.l === 'F' ? 'frente' : 'verso'}`), h('p.hint', {}, `${fmt(r2(len))} mm em ${sel.tracks.length} trecho${sel.tracks.length === 1 ? '' : 's'}`),
      h('div.ce-quick', {}, ...WIDTHS.map((w) => pill(fmt(w), t.w === w, () => board.setTrackWidth(sel.tracks, w), `Largura ${fmt(w)} mm`))),
      h('div.ce-actions', {}, act(icon.trash, 'Excluir', deleteSel, '.danger')));
  }
  function boardSection() {
    const b = board.outlineBox(), W = r2(b.x1 - b.x0), H = r2(b.y1 - b.y0);
    let shape = 'rect';
    const wIn = num(W, 5, 400, 1, () => {}, 'Largura em mm'), hIn = num(H, 5, 400, 1, () => {}, 'Altura em mm'), rIn = num(4, 0, 50, 0.5, () => {}, 'Raio dos cantos em mm');
    const apply = (kind) => {
      const w = clamp(Number(wIn.value) || 60, 5, 400), hh = clamp(Number(hIn.value) || 40, 5, 400);
      if (kind === 'rect') board.setOutline(outlineRect(w, hh, b.x0, b.y0));
      else if (kind === 'round') board.setOutline(outlineRounded(w, hh, Number(rIn.value) || 4, b.x0, b.y0));
      else board.setOutline(outlineCircle(w, b.x0 + w / 2, b.y0 + w / 2));
      fit();
    };
    const an = analysis();
    return h('section.ce-sec', {}, h('h3', {}, 'Placa'),
      h('button.btn.primary', { type: 'button', onclick: () => { syncFromSch(false); fit(); } }, h('span.ic', { html: icon.board }), 'Atualizar do esquema'),
      h('p.hint', {}, board.fps.length ? `${board.fps.length} peça${board.fps.length === 1 ? '' : 's'} na placa · ${an.unrouted ? `faltam ${an.unrouted} ligaç${an.unrouted === 1 ? 'ão' : 'ões'}` : an.netsTotal ? 'tudo ligado' : 'nada a ligar'}${an.shorts.length ? ` · ${an.shorts.length} CURTO${an.shorts.length === 1 ? '' : 'S'}!` : ''}` : 'Ainda sem peças. Use o botão acima.'),
      h('div.ce-two', {}, field('Largura (mm)', wIn), field('Altura (mm)', hIn)),
      h('div.ce-two', {}, field('Raio dos cantos', rIn), h('div')),
      h('div.ce-actions', {}, act(null, 'Retângulo', () => apply('rect')), act(null, 'Arredondada', () => apply('round')), act(null, 'Redonda (Ø = largura)', () => apply('circle'))),
      h('div.ce-actions', {}, act(icon.plus, 'Furo de fixação', () => { const bb = board.outlineBox(); const f = board.addFree('HOLE-3.2', snapTo(bb.x0 + 4, grid), snapTo(bb.y0 + 4, grid)); sel = { fps: [f.id], tracks: [], vias: [] }; setTool('sel'); onSelChange(); })),
      h('p.hint', {}, 'Dica: use a ferramenta Contorno para desenhar qualquer formato, puxando os cantos.'));
  }
  function layersSection() {
    return h('section.ce-sec', {}, h('h3', {}, 'Camadas e trilhas'),
      h('div.ce-actions', {}, pill('Frente (vermelho)', active === 'F', () => setActive('F')), pill('Verso (azul)', active === 'B', () => setActive('B'))),
      h('div.flabel', {}, 'Largura da trilha (mm)'),
      h('div.ce-quick', {}, ...WIDTHS.map((w) => pill(fmt(w), trackW === w, () => { trackW = w; lsSet('atelie_ptw', String(w)); if (sel.tracks.length) board.setTrackWidth(sel.tracks, w); else renderPanel(); }))),
      h('div.flabel', {}, 'Grade (mm)'),
      h('div.ce-quick', {}, ...GRIDS.map((g) => pill(fmt(g), grid === g, () => { grid = g; lsSet('atelie_pgrid', String(g)); renderPanel(); draw(); }))),
      h('div.flabel', {}, 'Mostrar'),
      h('div.ce-quick', {}, ...[['F', 'Frente'], ['B', 'Verso'], ['silk', 'Serigrafia'], ['rat', 'Fios de ajuda'], ['refs', 'Nomes'], ['nets', 'Redes nos pads']].map(([k, label]) => pill(label, vis[k], () => { vis[k] = !vis[k]; renderPanel(); draw(); }))));
  }
  function linksSection() {
    const an = analysis(); const names = new Map();
    for (const o of an.objs) if (o.kind === 'pad' && o.net) names.set(o.net, true);
    const missing = new Map(); for (const r of an.ratsnest) missing.set(r.net, (missing.get(r.net) || 0) + 1);
    const nets = [...names.keys()].filter((n) => an.objs.filter((o) => o.kind === 'pad' && o.net === n).length >= 2);
    if (!nets.length) return h('div');
    return h('section.ce-sec', {}, h('h3', {}, 'Ligações'),
      h('div.ce-links', {}, ...nets.map((n) => { const m = missing.get(n) || 0; return h('button.ce-link', { type: 'button', 'aria-pressed': String(hotNet === n), onclick: () => { hotNet = hotNet === n ? null : n; draw(); renderPanel(); } }, h('span', {}, n), h('em', { className: m ? 'bad' : 'ok' }, m ? `faltam ${m}` : 'ligada')); })));
  }

  // ---------- ligação com o resto ----------
  const offBoard = board.on((kind) => { pruneSel(); undoB.disabled = !board.canUndo; redoB.disabled = !board.canRedo; if (kind !== 'transient') { renderPanel(); renderSelbar(); updateHint(); } requestDraw(); });
  const offSch = sch.on(() => { requestDraw(); });
  let conflictShown = false;
  const onStatus = (e) => {
    const { status, message } = e.detail;
    statusEl.textContent = status === 'error' && message ? message : STATUS[status] || ''; statusEl.dataset.s = status;
    if (status === 'conflict' && !conflictShown) {
      conflictShown = true;
      const m = modal('Este circuito foi alterado em outro aparelho', h('p', {}, 'Salve o que está na tela como uma cópia, ou carregue a versão mais recente (o que você fez aqui desde o último salvamento será perdido).'), [
        h('button.btn', { onclick: () => { m.close(); location.reload(); } }, 'Carregar a versão mais recente'),
        h('button.btn.primary', { onclick: async () => { m.close(); try { const id = await saver.saveAsCopy(); toast('Cópia salva.'); location.hash = '#/c/' + id; location.reload(); } catch (err) { toast(err.message, 'err'); } } }, 'Salvar como cópia')]);
    }
  };
  saver.addEventListener('status', onStatus); onStatus({ detail: { status: saver.status } });

  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('wheel', onWheel, { passive: false }); canvas.addEventListener('dblclick', onDbl);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !drag) { hotPin = null; hoverNet = null; requestDraw(); } });
  document.addEventListener('keydown', onKey); document.addEventListener('keyup', onKeyUp);
  const ro = new ResizeObserver(() => resize()); ro.observe(canvas);

  syncLayer(); syncTools(); updateHint(); renderPanel(); canvas.dataset.tool = tool; undoB.disabled = !board.canUndo; redoB.disabled = !board.canRedo;
  if (board.fps.length === 0 && sch.parts.length) { syncFromSch(true); }
  resize(); fit();
  if (isMobile() && board.fps.length === 0) setSheet('info');

  return {
    destroy() { offBoard(); offSch(); ro.disconnect(); saver.removeEventListener('status', onStatus); document.removeEventListener('keydown', onKey); document.removeEventListener('keyup', onKeyUp); cancelAnimationFrame(raf); },
    get board() { return board; }, view, setTool, setActive, fit,
  };
}
