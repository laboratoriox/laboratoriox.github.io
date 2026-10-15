// Editor de circuitos: tela com zoom, paleta de peças, fios, textos, propriedades e exportação.
import { h, modal, toast, clamp, makeCanvas, canvasToBlob } from '../util.js';
import { icon } from '../icons.js';
import { LIBRARY, CATEGORIES, partBox, symbolName, isPower, hasEditablePins } from './symbols.js';
import { snap10, distSeg } from './schem.js';
import { THEMES, paint, paintPart, canvasOut, toCanvas, toSVG } from './render.js';

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const isMobile = () => window.matchMedia('(max-width: 820px)').matches;
const slug = (s) => (String(s || 'circuito').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'circuito');
const QUICK = {
  R: ['100Ω', '220Ω', '470Ω', '1kΩ', '2.2kΩ', '4.7kΩ', '10kΩ', '100kΩ'], POT: ['1kΩ', '10kΩ', '100kΩ'],
  C: ['10pF', '100pF', '1nF', '100nF', '1µF'], CP: ['1µF', '10µF', '100µF', '470µF', '1000µF'], L: ['10µH', '100µH', '1mH'],
  VCC: ['+3.3V', '+5V', '+9V', '+12V', '-5V'], GND: ['GND', 'AGND', '0V'], BT: ['1.5V', '3.7V', '9V', '12V'], VDC: ['5V', '12V', '24V'],
};
const STATUS = { saved: 'Salvo', saving: 'Salvando…', dirty: 'Não salvo ainda', offline: 'Sem conexão — tentando de novo', error: 'Erro ao salvar', conflict: 'Alterado em outro aparelho' };

function download(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function preview(item) {
  const part = { id: 'p', t: item.t, x: 0, y: 0, r: 0, m: false, ref: '', val: item.val || '' };
  if (item.pins) part.pins = [...item.pins];
  const b = partBox(part), w = b.x1 - b.x0 + 10, hh = b.y1 - b.y0 + 10, sc = Math.min(56 / w, 36 / hh, 1.3), d = 2;
  const c = makeCanvas(56 * d, 36 * d); c.className = 'ce-prev'; const ctx = c.getContext('2d');
  ctx.setTransform(sc * d, 0, 0, sc * d, (56 / 2 - ((b.x0 + b.x1) / 2) * sc) * d, (36 / 2 - ((b.y0 + b.y1) / 2) * sc) * d);
  paintPart(canvasOut(ctx, sc), part, THEMES.dark, THEMES.dark.body, { labels: false });
  return c;
}

export function mountCircuitEditor(root, state, saver, { onExit, onSwitch }) {
  const sch = state.sch;
  let tool = 'sel', sheet = null;
  let sel = { parts: [], wires: [], texts: [] };
  let themeName = lsGet('atelie_ctheme') === 'light' ? 'light' : 'dark';
  let showGrid = lsGet('atelie_cgrid') !== '0';
  const view = { x: 60, y: 60, k: 1 };
  let placeId = null, ghost = null, ghostR = 0, ghostM = false;
  let wireStart = null, wireEnd = null, band = null, drag = null, spaceDown = false, hoverPin = null;
  let clip = null, pasteN = 0, fromPanel = false, raf = 0, anRev = -1, anVal = null, ignoreUp = false;
  const pointers = new Map();
  let pinch = null;

  const analysis = () => { if (anRev !== sch.rev) { anVal = sch.analyze(); anRev = sch.rev; } return anVal; };
  const selCount = () => sel.parts.length + sel.wires.length + sel.texts.length;
  const clearSel = () => { sel = { parts: [], wires: [], texts: [] }; };
  const isSel = (hit) => (hit.type === 'part' ? sel.parts : hit.type === 'wire' ? sel.wires : sel.texts).includes(hit.id);

  // ---------- estrutura ----------
  const canvas = h('canvas.ce-canvas', { tabIndex: 0, 'aria-label': 'Área do esquema elétrico' });
  const ctx = canvas.getContext('2d');
  const hint = h('div.ce-hint', { role: 'status' });
  const iconBtn = (ic, title, fn, cls = '') => h('button.ibtn' + cls, { type: 'button', title, 'aria-label': title, onclick: fn, html: ic });
  const undoB = iconBtn(icon.undo, 'Desfazer (Ctrl+Z)', () => sch.undo());
  const redoB = iconBtn(icon.redo, 'Refazer (Ctrl+Y)', () => sch.redo());
  const nameIn = h('input.docname', { value: state.name, maxLength: 80, 'aria-label': 'Nome do circuito', onchange: () => { const v = nameIn.value.trim() || 'Circuito sem título'; nameIn.value = v; saver.rename(v); } });
  const statusEl = h('div.save-status', { role: 'status', 'aria-live': 'polite' });
  const top = h('header.topbar', {}, iconBtn(icon.back, 'Voltar à galeria', () => onExit()),
    h('div.docinfo', {}, nameIn, statusEl), h('div.spacer'),
    ...(onSwitch ? [h('div.ce-seg', { role: 'tablist' }, h('button', { type: 'button', role: 'tab', 'aria-selected': 'true' }, 'Esquema'), h('button', { type: 'button', role: 'tab', 'aria-selected': 'false', onclick: () => onSwitch('pcb') }, 'Placa'))] : []),
    undoB, redoB, iconBtn(icon.download, 'Exportar', () => openExport()));

  const toolDefs = [['sel', 'Selecionar (V)', icon.cursor, 'Selecionar'], ['wire', 'Fio (W)', icon.wire, 'Fio'], ['parts', 'Peças (P)', icon.chip, 'Peças'], ['text', 'Texto (T)', icon.text, 'Texto'], ['pan', 'Mover a tela (H)', icon.hand, 'Mão']];
  const toolBtns = {};
  const rail = h('nav.ce-rail', { 'aria-label': 'Ferramentas' }, ...toolDefs.map(([id, title, ic, label]) => (toolBtns[id] = h('button.tool', { type: 'button', title, 'aria-label': title, onclick: () => onToolBtn(id) }, h('span.ic', { html: ic }), h('small', {}, label)))));

  const search = h('input.ce-search', { type: 'search', placeholder: 'Buscar peça… (resistor, led, 555)', 'aria-label': 'Buscar peça', oninput: () => buildPalette() });
  const palList = h('div.ce-pallist');
  const pal = h('aside.ce-pal', { 'aria-label': 'Peças' }, h('div.grab', { onclick: () => setSheet(null) }, h('span')), h('div.ce-palhead', {}, search), palList);
  const panel = h('aside.ce-panel', { 'aria-label': 'Propriedades' }, h('div.grab', { onclick: () => setSheet(null) }, h('span')));
  const panelBody = h('div.ce-panelbody'); panel.append(panelBody);

  const zbtn = (ic, title, fn) => h('button.ce-fab', { type: 'button', title, 'aria-label': title, onclick: fn, html: ic });
  const gridBtn = zbtn(icon.grid, 'Mostrar/ocultar grade', () => { showGrid = !showGrid; lsSet('atelie_cgrid', showGrid ? '1' : '0'); syncFabs(); draw(); });
  const themeBtn = zbtn(icon.theme, 'Fundo claro/escuro', () => { themeName = themeName === 'dark' ? 'light' : 'dark'; lsSet('atelie_ctheme', themeName); syncFabs(); draw(); });
  const fabs = h('div.ce-fabs', {}, zbtn(icon.zoomIn, 'Aproximar', () => zoomBy(1.3)), zbtn(icon.zoomOut, 'Afastar', () => zoomBy(1 / 1.3)), zbtn(icon.fit, 'Enquadrar tudo (0)', () => fit()), gridBtn, themeBtn);
  const selbar = h('div.ce-selbar', { hidden: true });
  const stage = h('main.ce-stage', {}, canvas, hint, fabs, selbar);
  const wrap = h('div.cedit', { dataset: {} }, top, rail, pal, stage, panel);
  root.replaceChildren(wrap);

  function syncFabs() { gridBtn.setAttribute('aria-pressed', String(showGrid)); themeBtn.setAttribute('aria-pressed', String(themeName === 'light')); }

  // ---------- paleta ----------
  function buildPalette() {
    const q = search.value.trim().toLowerCase();
    const groups = CATEGORIES.map((cat) => {
      const items = LIBRARY.filter((l) => l.cat === cat && (!q || (l.name + ' ' + l.id + ' ' + (l.val || '')).toLowerCase().includes(q)));
      if (!items.length) return null;
      const d = h('details.ce-cat', { open: !!q || cat === CATEGORIES[0] || cat === CATEGORIES[1] }, h('summary', {}, cat),
        h('div.ce-items', {}, ...items.map((it) => h('button.ce-item', { type: 'button', title: it.name, 'aria-pressed': String(placeId === it.id), onclick: () => choosePart(it.id) }, preview(it), h('span', {}, it.name)))));
      return d;
    }).filter(Boolean);
    palList.replaceChildren(...(groups.length ? groups : [h('p.hint', {}, 'Nenhuma peça com esse nome.')]));
  }
  function choosePart(id) {
    placeId = id; ghost = null; ghostR = 0; ghostM = false; wireStart = null; clearSel();
    tool = 'place'; if (isMobile()) setSheet(null);
    afterToolChange(); onSelChange();
  }

  // ---------- ferramentas e folhas (celular) ----------
  function setSheet(s) { sheet = s; if (s) wrap.dataset.sheet = s; else delete wrap.dataset.sheet; syncTools(); }
  function setTool(t) {
    if (t !== 'place') { placeId = null; ghost = null; }
    if (t !== 'wire') { wireStart = null; wireEnd = null; hoverPin = null; }
    tool = t; afterToolChange();
  }
  function afterToolChange() { syncTools(); updateHint(); canvas.dataset.tool = tool; buildPaletteState(); draw(); }
  function buildPaletteState() { palList.querySelectorAll('.ce-item').forEach((b) => { /* marca a peça escolhida */ }); [...palList.querySelectorAll('.ce-item')].forEach((b) => b.setAttribute('aria-pressed', String(!!placeId && b.title === (LIBRARY.find((l) => l.id === placeId)?.name)))); }
  function onToolBtn(id) {
    if (id === 'parts') {
      if (isMobile()) { setSheet(sheet === 'parts' ? null : 'parts'); return; }
      search.focus(); search.select(); return;
    }
    if (isMobile()) setSheet(null);
    setTool(id);
  }
  function syncTools() {
    for (const [id, b] of Object.entries(toolBtns)) b.setAttribute('aria-pressed', String(id === 'parts' ? (tool === 'place' || sheet === 'parts') : id === tool));
  }
  function updateHint() {
    let t = '';
    if (tool === 'wire') t = wireStart ? 'Toque no ponto final do fio. Toque duas vezes no mesmo ponto (ou Esc) para terminar.' : 'Toque ou arraste de um ponto a outro para ligar. Comece num pino de uma peça.';
    else if (tool === 'place') t = `Toque onde colocar “${symbolName(LIBRARY.find((l) => l.id === placeId)?.t || '')}”. R gira, M espelha, Esc termina.`;
    else if (tool === 'text') t = 'Toque onde quer escrever. Toque num texto para editar.';
    else if (tool === 'pan') t = 'Arraste para mover a tela.';
    else if (sch.isEmpty) t = 'Comece escolhendo uma peça em “Peças”. Dois dedos movem e dão zoom.';
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
    const { w, h: hh } = size(); const b = sch.bounds();
    if (!b) { view.k = 1; view.x = 60; view.y = 60; draw(); return; }
    const pad = 50, bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    view.k = clamp(Math.min((w - pad * 2) / bw, (hh - pad * 2) / bh), 0.2, 2);
    view.x = (w - bw * view.k) / 2 - b.x0 * view.k; view.y = (hh - bh * view.k) / 2 - b.y0 * view.k; draw();
  }
  function zoomAt(f, sx, sy) {
    const k = clamp(view.k * f, 0.15, 6), wx = (sx - view.x) / view.k, wy = (sy - view.y) / view.k;
    view.k = k; view.x = sx - wx * k; view.y = sy - wy * k; draw();
  }
  function zoomBy(f) { const { w, h: hh } = size(); zoomAt(f, w / 2, hh / 2); }
  const toWorld = (e) => { const r = canvas.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top; return { sx, sy, x: (sx - view.x) / view.k, y: (sy - view.y) / view.k }; };
  const tolW = () => clamp(9 / view.k, 3, 14);

  // ---------- desenho ----------
  const requestDraw = () => { if (!raf) raf = requestAnimationFrame(draw); };
  function draw() {
    raf = 0;
    const th = THEMES[themeName], dpr = window.devicePixelRatio || 1, W = canvas.width / dpr, H = canvas.height / dpr, k = view.k;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = th.bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * view.x, dpr * view.y);
    const x0 = -view.x / k, y0 = -view.y / k, x1 = (W - view.x) / k, y1 = (H - view.y) / k;
    if (showGrid) {
      const step = 10 * k >= 7 ? 10 : 50;
      if (step * k >= 7) {
        ctx.lineWidth = 1 / k;
        for (const major of [false, true]) {
          ctx.beginPath(); ctx.strokeStyle = major ? th.gridMajor : th.grid;
          for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) if ((x % 50 === 0) === major) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
          for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) if ((y % 50 === 0) === major) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
          ctx.stroke();
        }
      }
    }
    const out = canvasOut(ctx, k);
    paint(out, sch, th, { selected: sel, analysis: analysis() });
    if (ghost && tool === 'place') { ctx.globalAlpha = 0.75; paintPart(out, ghost, th, th.sel); ctx.globalAlpha = 1; }
    if (hoverPin) out.circle(hoverPin.x, hoverPin.y, 5, { stroke: th.sel, width: 1.6 });
    if (wireStart && wireEnd) {
      const dx = wireEnd[0] - wireStart[0], dy = wireEnd[1] - wireStart[1], vFirst = Math.abs(dy) > Math.abs(dx);
      const mid = dx === 0 || dy === 0 ? null : (vFirst ? [wireStart[0], wireEnd[1]] : [wireEnd[0], wireStart[1]]);
      out.poly(mid ? [wireStart, mid, wireEnd] : [wireStart, wireEnd], { stroke: th.sel, width: 2 });
      out.circle(wireStart[0], wireStart[1], 3.2, { fill: th.sel, stroke: th.sel });
    }
    if (band) out.rect(Math.min(band.x0, band.x1), Math.min(band.y0, band.y1), Math.max(band.x0, band.x1), Math.max(band.y0, band.y1), { stroke: th.sel, fill: 'rgba(120,140,255,.12)', width: 1, dash: [4, 3] });
  }

  // ---------- seleção ----------
  function selectHit(hit) {
    if (hit.type === 'part') sel.parts.push(hit.id);
    else if (hit.type === 'text') sel.texts.push(hit.id);
    else for (const id of sch.wireChain(hit.id)) sel.wires.push(id);
  }
  function deselectHit(hit) {
    if (hit.type === 'part') sel.parts = sel.parts.filter((i) => i !== hit.id);
    else if (hit.type === 'text') sel.texts = sel.texts.filter((i) => i !== hit.id);
    else { const ch = new Set(sch.wireChain(hit.id)); sel.wires = sel.wires.filter((i) => !ch.has(i)); }
  }
  function pruneSel() {
    const P = new Set(sch.parts.map((p) => p.id)), W = new Set(sch.wires.map((p) => p.id)), T = new Set(sch.texts.map((p) => p.id));
    sel = { parts: sel.parts.filter((i) => P.has(i)), wires: sel.wires.filter((i) => W.has(i)), texts: sel.texts.filter((i) => T.has(i)) };
  }
  function onSelChange() { renderSelbar(); renderPanel(); draw(); }

  function renderSelbar() {
    const n = selCount();
    if (!n || (tool !== 'sel' && tool !== 'pan')) { selbar.hidden = true; return; }
    selbar.hidden = false;
    const b = (ic, title, fn, cls = '') => h('button.ibtn' + cls, { type: 'button', title, 'aria-label': title, onclick: fn, html: ic });
    selbar.replaceChildren(
      ...(sel.parts.length ? [b(icon.rotate, 'Girar (R)', () => rotateSel()), b(icon.mirror, 'Espelhar (M)', () => rotateSel(true))] : []),
      b(icon.copy, 'Duplicar (Ctrl+D)', () => duplicate()),
      b(icon.edit, 'Editar nome e valor', () => { if (isMobile()) setSheet('info'); else focusFirstField(); }),
      b(icon.trash, 'Excluir (Delete)', () => deleteSel(), '.danger'));
  }
  function focusFirstField() { const el = panelBody.querySelector('input,textarea'); if (el) { el.focus(); el.select?.(); } }

  // ---------- ações ----------
  function rotateSel(mirror = false) {
    if (tool === 'place' && placeId) { if (mirror) ghostM = !ghostM; else ghostR = (ghostR + 1) % 4; if (ghost) { ghost.r = ghostR; ghost.m = ghostM; } draw(); return; }
    if (sel.parts.length) sch.rotateParts(sel.parts, { mirror });
  }
  function deleteSel() { if (!selCount()) return; sch.deleteItems(sel); clearSel(); onSelChange(); }
  function copySel() { if (!selCount()) return false; clip = sch.copyItems(sel); pasteN = 0; return true; }
  function pasteClip() { if (!clip) return; pasteN++; sel = sch.pasteItems(clip, 20 * pasteN, 20 * pasteN); setTool('sel'); onSelChange(); }
  function duplicate() { if (copySel()) pasteClip(); }
  function nudge(dx, dy) { if (!selCount()) return; sch.edit(() => sch.applyMove(sel, dx, dy)); }

  // ---------- texto ----------
  function textDialog(existing, x, y) {
    const ta = h('textarea', { rows: 3, maxLength: 200, value: existing?.s || '', 'aria-label': 'Texto', placeholder: 'Ex.: Fonte 5 V, Entrada, Saída…' });
    let z = existing?.z || 1;
    const sizes = [[1, 'Normal'], [2, 'Grande'], [3, 'Enorme']];
    const sb = sizes.map(([v, l]) => h('button.btn.sm', { type: 'button', 'aria-pressed': String(v === z), onclick: () => { z = v; sb.forEach((b, i) => b.setAttribute('aria-pressed', String(sizes[i][0] === v))); } }, l));
    const body = h('div.newform', {}, h('label.field.col', {}, h('span.flabel', {}, 'Texto'), ta), h('div.flabel', {}, 'Tamanho'), h('div.bgrow', {}, ...sb));
    const ok = () => { const s = ta.value.replace(/\s+$/g, ''); m.close(); if (!s.trim()) { if (existing) { sch.deleteItems({ texts: [existing.id] }); clearSel(); onSelChange(); } return; } if (existing) sch.setText(existing.id, { s, z }); else sch.addText(x, y, s, z); };
    const m = modal(existing ? 'Editar texto' : 'Novo texto', body, [
      ...(existing ? [h('button.btn.danger', { onclick: () => { m.close(); sch.deleteItems({ texts: [existing.id] }); clearSel(); onSelChange(); } }, 'Excluir')] : []),
      h('button.btn', { onclick: () => m.close() }, 'Cancelar'), h('button.btn.primary', { onclick: ok }, 'Salvar')]);
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) ok(); });
  }

  // ---------- fios ----------
  function snapPoint(w) {
    const pin = sch.pinAt(w.x, w.y, clamp(10 / view.k, 5, 14));
    if (pin) return { pt: [pin.pin.x, pin.pin.y], onPin: true };
    return { pt: [snap10(w.x), snap10(w.y)], onPin: false };
  }
  function touchesNet(pt) {
    if (sch.pinAt(pt[0], pt[1], 0.5)) return true;
    return sch.wires.some((w) => distSeg(pt[0], pt[1], w.a, w.b) < 0.5);
  }
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  function commitWire(a, b) { sch.addWire(a, b, { vFirst: Math.abs(b[1] - a[1]) > Math.abs(b[0] - a[0]) }); }

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
      const hit = sch.hit(w.x, w.y, tolW());
      if (hit) {
        if (isSel(hit) && shift) { deselectHit(hit); onSelChange(); drag = null; return; }
        if (!isSel(hit)) { if (!shift) clearSel(); selectHit(hit); onSelChange(); }
        drag = { type: 'move', sx: w.sx, sy: w.sy, wx: w.x, wy: w.y, moved: false, lx: 0, ly: 0 };
      } else {
        if (!shift && selCount()) { clearSel(); onSelChange(); }
        drag = { type: 'band', sx: w.sx, sy: w.sy, add: shift }; band = { x0: w.x, y0: w.y, x1: w.x, y1: w.y };
      }
    } else if (tool === 'wire') {
      const { pt } = snapPoint(w);
      if (!wireStart) { wireStart = pt; wireEnd = pt; drag = { type: 'wire', fresh: true }; } else { wireEnd = pt; drag = { type: 'wire', fresh: false }; }
      updateHint(); draw();
    } else if (tool === 'place') {
      movePlace(w); drag = { type: 'place' };
    } else if (tool === 'text') {
      drag = { type: 'text', sx: w.sx, sy: w.sy };
    }
  }
  function movePlace(w) {
    if (!placeId) return;
    const x = snap10(w.x), y = snap10(w.y);
    if (!ghost) ghost = sch.makePart(placeId, x, y, { r: ghostR, m: ghostM }); else { ghost.x = x; ghost.y = y; }
    requestDraw();
  }
  function onMove(e) {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size >= 2) { updatePinch(); return; }
    const w = toWorld(e);
    if (!drag) {
      if (tool === 'place' && e.pointerType === 'mouse') movePlace(w);
      else if (tool === 'wire') {
        const { pt, onPin } = snapPoint(w); hoverPin = onPin ? { x: pt[0], y: pt[1] } : null;
        if (wireStart) wireEnd = pt; requestDraw();
      }
      return;
    }
    if (drag.type === 'pan') { view.x = drag.vx + (w.sx - drag.sx); view.y = drag.vy + (w.sy - drag.sy); requestDraw(); }
    else if (drag.type === 'move') {
      if (!drag.moved && Math.hypot(w.sx - drag.sx, w.sy - drag.sy) < 5) return;
      const dx = snap10(w.x - drag.wx), dy = snap10(w.y - drag.wy);
      if (!drag.moved) { drag.moved = true; sch.beginTransient(); }
      if (dx !== drag.lx || dy !== drag.ly) { drag.lx = dx; drag.ly = dy; sch.setTransient(() => sch.applyMove(sel, dx, dy)); }
    } else if (drag.type === 'band') { band.x1 = w.x; band.y1 = w.y; requestDraw(); }
    else if (drag.type === 'wire') { const { pt, onPin } = snapPoint(w); wireEnd = pt; hoverPin = onPin ? { x: pt[0], y: pt[1] } : null; requestDraw(); }
    else if (drag.type === 'place') movePlace(w);
  }
  function onUp(e) {
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) { pinch = null; ignoreUp = pointers.size > 0; } return; }
    if (ignoreUp) { if (!pointers.size) ignoreUp = false; return; }
    const d = drag; drag = null; canvas.classList.remove('panning');
    if (!d) return;
    const w = toWorld(e);
    if (d.type === 'move') { if (d.moved) { sch.endTransient(true); } }
    else if (d.type === 'band') {
      const b = band; band = null;
      if (Math.hypot(w.sx - d.sx, w.sy - d.sy) > 4) {
        const r = sch.inRect(b.x0, b.y0, b.x1, b.y1);
        if (d.add) { sel = { parts: [...new Set([...sel.parts, ...r.parts])], wires: [...new Set([...sel.wires, ...r.wires])], texts: [...new Set([...sel.texts, ...r.texts])] }; } else sel = r;
      }
      onSelChange();
    } else if (d.type === 'wire') {
      const { pt } = snapPoint(w);
      if (d.fresh) {
        if (!same(pt, wireStart)) { commitWire(wireStart, pt); wireStart = null; wireEnd = null; }
      } else if (same(pt, wireStart)) { wireStart = null; wireEnd = null; }
      else { commitWire(wireStart, pt); if (touchesNet(pt)) { wireStart = null; wireEnd = null; } else { wireStart = pt; wireEnd = pt; } }
      hoverPin = null; updateHint(); draw();
    } else if (d.type === 'place') {
      if (ghost) {
        const p = ghost; sch.insertParts([p]);
        ghost = sch.makePart(placeId, p.x, p.y, { r: ghostR, m: ghostM });
        if (e.pointerType !== 'mouse') ghost = null;
      }
    } else if (d.type === 'text') {
      if (Math.hypot(w.sx - d.sx, w.sy - d.sy) < 8) {
        const hit = sch.hit(w.x, w.y, tolW());
        if (hit && hit.type === 'text') textDialog(sch.texts.find((t) => t.id === hit.id));
        else textDialog(null, w.x, w.y);
      }
    }
  }
  function onCancel(e) {
    pointers.delete(e.pointerId);
    if (drag?.type === 'move' && drag.moved) sch.endTransient(false);
    drag = null; band = null; pinch = null; canvas.classList.remove('panning'); draw();
  }
  function startPinch() {
    if (drag?.type === 'move' && drag.moved) sch.endTransient(false);
    drag = null; band = null; canvas.classList.remove('panning');
    const [a, b] = [...pointers.values()], r = canvas.getBoundingClientRect();
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2 - r.left, cy: (a.y + b.y) / 2 - r.top, v: { ...view } };
    pinch.wx = (pinch.cx - view.x) / view.k; pinch.wy = (pinch.cy - view.y) / view.k; draw();
  }
  function updatePinch() {
    const [a, b] = [...pointers.values()], r = canvas.getBoundingClientRect();
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1, cx = (a.x + b.x) / 2 - r.left, cy = (a.y + b.y) / 2 - r.top;
    view.k = clamp(pinch.v.k * d / pinch.d, 0.15, 6); view.x = cx - pinch.wx * view.k; view.y = cy - pinch.wy * view.k; requestDraw();
  }
  function onWheel(e) {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    if (e.ctrlKey || !e.shiftKey) zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)), e.clientX - r.left, e.clientY - r.top);
    else { view.x -= e.deltaY; view.y -= e.deltaX; draw(); }
  }
  function onDbl(e) {
    if (tool === 'wire' && wireStart) { wireStart = null; wireEnd = null; updateHint(); draw(); return; }
    if (tool !== 'sel') return;
    const w = toWorld(e), hit = sch.hit(w.x, w.y, tolW());
    if (hit?.type === 'text') textDialog(sch.texts.find((t) => t.id === hit.id));
    else if (hit?.type === 'part') { if (isMobile()) setSheet('info'); else focusFirstField(); }
  }

  // ---------- teclado ----------
  function onKey(e) {
    if (document.querySelector('.modal-back')) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) { if (e.key === 'Escape') t.blur(); return; }
    const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
    if (e.key === ' ') { spaceDown = true; e.preventDefault(); return; }
    if (mod && key === 'z') { e.preventDefault(); e.shiftKey ? sch.redo() : sch.undo(); return; }
    if (mod && key === 'y') { e.preventDefault(); sch.redo(); return; }
    if (mod && key === 's') { e.preventDefault(); saver.flush(); toast('Salvando…'); return; }
    if (mod && key === 'a') { e.preventDefault(); sel = { parts: sch.parts.map((p) => p.id), wires: sch.wires.map((p) => p.id), texts: sch.texts.map((p) => p.id) }; setTool('sel'); onSelChange(); return; }
    if (mod && key === 'c') { if (copySel()) e.preventDefault(); return; }
    if (mod && key === 'v') { if (clip) { e.preventDefault(); pasteClip(); } return; }
    if (mod && key === 'd') { e.preventDefault(); duplicate(); return; }
    if (mod) return;
    if (e.key === 'Escape') {
      if (wireStart) { wireStart = null; wireEnd = null; updateHint(); draw(); } else if (tool !== 'sel') setTool('sel'); else if (selCount()) { clearSel(); onSelChange(); }
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSel(); return; }
    if (e.key.startsWith('Arrow')) { e.preventDefault(); const s = e.shiftKey ? 50 : 10; nudge(e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0, e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0); return; }
    if (key === 'r') { rotateSel(); return; }
    if (key === 'm' || key === 'f') { rotateSel(true); return; }
    if (key === 'v') setTool('sel'); else if (key === 'w') setTool('wire'); else if (key === 't') setTool('text'); else if (key === 'h') setTool('pan');
    else if (key === 'p') onToolBtn('parts'); else if (key === '0') fit(); else if (key === '+' || key === '=') zoomBy(1.3); else if (key === '-') zoomBy(1 / 1.3);
    else if (key === 'g') { showGrid = !showGrid; lsSet('atelie_cgrid', showGrid ? '1' : '0'); syncFabs(); draw(); }
  }
  const onKeyUp = (e) => { if (e.key === ' ') spaceDown = false; };

  // ---------- painel de propriedades ----------
  const field = (label, input) => h('label.ce-field', {}, h('span.flabel', {}, label), input);
  function renderPanel() {
    if (fromPanel) return;
    const n = selCount();
    if (n === 1 && sel.parts.length === 1) panelBody.replaceChildren(partPanel(sch.part(sel.parts[0])));
    else if (n === 1 && sel.texts.length === 1) panelBody.replaceChildren(textPanel(sch.texts.find((t) => t.id === sel.texts[0])));
    else if (n > 1) panelBody.replaceChildren(multiPanel());
    else panelBody.replaceChildren(summaryPanel());
  }
  const actionRow = (...b) => h('div.ce-actions', {}, ...b);
  const act = (ic, label, fn, cls = '') => h('button.btn.sm' + cls, { type: 'button', onclick: fn }, h('span.ic', { html: ic }), label);
  function commit(fn) { fromPanel = true; try { fn(); } finally { fromPanel = false; } }
  function partPanel(p) {
    if (!p) return summaryPanel();
    const power = isPower(p.t);
    const refIn = h('input', { value: p.ref || '', maxLength: 16, 'aria-label': 'Nome da peça', onchange: () => commit(() => sch.setProps(p.id, { ref: refIn.value.trim() })) });
    const valIn = h('input', { value: p.val || '', maxLength: 40, 'aria-label': power ? 'Nome da ligação' : 'Valor', onchange: () => commit(() => sch.setProps(p.id, { val: valIn.value.trim() })) });
    const quick = QUICK[p.t] ? h('div.ce-quick', {}, ...QUICK[p.t].map((v) => h('button.btn.sm', { type: 'button', onclick: () => { valIn.value = v; commit(() => sch.setProps(p.id, { val: v })); } }, v))) : null;
    const rows = [h('h3', {}, symbolName(p.t)), ...(power ? [] : [field('Nome (ex.: R1, D2)', refIn)]), field(power ? 'Nome da ligação' : 'Valor', valIn), quick];
    if (hasEditablePins(p.t)) {
      const ta = h('textarea', { rows: Math.min(10, (p.pins || []).length + 1), value: (p.pins || []).join('\n'), 'aria-label': 'Nomes dos pinos', spellcheck: false, onchange: () => {
        const list = ta.value.split('\n').map((s) => s.trim().slice(0, 20)).filter(Boolean).slice(0, 40);
        if (!list.length) { ta.value = (p.pins || []).join('\n'); return; }
        commit(() => sch.setProps(p.id, { pins: list }));
      } });
      rows.push(field('Pinos (um nome por linha)', ta), h('p.hint', {}, 'Os pinos são numerados como num CI de verdade: de cima para baixo no lado esquerdo e depois de baixo para cima no direito. Fios ligados continuam presos aos pinos.'));
    }
    rows.push(actionRow(act(icon.rotate, 'Girar', () => rotateSel()), act(icon.mirror, 'Espelhar', () => rotateSel(true)), act(icon.copy, 'Duplicar', () => duplicate()), act(icon.trash, 'Excluir', () => deleteSel(), '.danger')));
    return h('section.ce-sec', {}, ...rows.filter(Boolean));
  }
  function textPanel(t) {
    if (!t) return summaryPanel();
    return h('section.ce-sec', {}, h('h3', {}, 'Texto'), h('p.ce-textprev', {}, t.s), actionRow(act(icon.edit, 'Editar', () => textDialog(t)), act(icon.trash, 'Excluir', () => deleteSel(), '.danger')));
  }
  function multiPanel() {
    return h('section.ce-sec', {}, h('h3', {}, `${selCount()} itens selecionados`), h('p.hint', {}, 'Arraste para mover tudo junto. Fios ligados esticam e acompanham.'),
      actionRow(...(sel.parts.length ? [act(icon.rotate, 'Girar', () => rotateSel()), act(icon.mirror, 'Espelhar', () => rotateSel(true))] : []), act(icon.copy, 'Duplicar', () => duplicate()), act(icon.trash, 'Excluir', () => deleteSel(), '.danger')));
  }
  function summaryPanel() {
    const an = analysis(), bom = sch.bom();
    const rows = bom.map((r) => h('tr', {}, h('td', {}, String(r.qty)), h('td', {}, r.refs.join(', ')), h('td', {}, r.name + (r.val ? ' · ' + r.val : ''))));
    const parts = sch.parts.filter((p) => !isPower(p.t)).length;
    return h('section.ce-sec', {}, h('h3', {}, 'Resumo do circuito'),
      h('p.hint', {}, `${parts} componente${parts === 1 ? '' : 's'} · ${an.nets.length} ligaç${an.nets.length === 1 ? 'ão' : 'ões'}` + (an.unconnected.length ? ` · ${an.unconnected.length} pino${an.unconnected.length === 1 ? '' : 's'} solto${an.unconnected.length === 1 ? '' : 's'} (círculo vazado)` : '')),
      rows.length ? h('table.ce-bom', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Qtd'), h('th', {}, 'Nome'), h('th', {}, 'Componente'))), h('tbody', {}, ...rows)) : h('p.hint', {}, 'Ainda não há peças. Escolha uma em “Peças” e toque na tela.'),
      actionRow(act(icon.download, 'Exportar…', () => openExport())));
  }

  // ---------- exportar ----------
  function openExport() {
    if (sch.isEmpty) { toast('O circuito está vazio.'); return; }
    const base = slug(nameIn.value);
    const png = (theme, transparent, suffix) => async () => {
      try { const c = toCanvas(sch, makeCanvas, theme, { scale: 3, transparent }); download(await canvasToBlob(c), `${base}${suffix}.png`); } catch (e) { toast('Não foi possível gerar a imagem: ' + e.message, 'err'); }
    };
    const item = (title, sub, fn) => h('button.ce-exp', { type: 'button', onclick: () => { m.close(); fn(); } }, h('strong', {}, title), h('span', {}, sub));
    const body = h('div.ce-explist', {},
      item('Imagem PNG', 'Fundo branco, ótima para imprimir ou enviar', png('light', false, '')),
      item('Imagem PNG transparente', 'Sem fundo, para colocar em documentos', png('light', true, '-transparente')),
      item('Imagem PNG escura', 'Fundo escuro, como na tela', png('dark', false, '-escuro')),
      item('SVG', 'Desenho vetorial que não perde qualidade', () => download(new Blob([toSVG(sch, 'light')], { type: 'image/svg+xml' }), `${base}.svg`)),
      item('Lista de materiais (CSV)', 'Abre no Excel / LibreOffice', () => download(new Blob([sch.bomCSV()], { type: 'text/csv;charset=utf-8' }), `${base}-materiais.csv`)),
      item('Lista de ligações (texto)', 'Quais pinos estão ligados entre si', () => download(new Blob([sch.netlistText(nameIn.value)], { type: 'text/plain;charset=utf-8' }), `${base}-ligacoes.txt`)));
    const m = modal('Exportar circuito', body, [h('button.btn', { onclick: () => m.close() }, 'Fechar')]);
  }

  // ---------- ligações com o resto ----------
  const offSch = sch.on((kind) => {
    pruneSel();
    updateUndo();
    if (kind !== 'transient') { renderPanel(); renderSelbar(); updateHint(); }
    requestDraw();
  });
  function updateUndo() { undoB.disabled = !sch.canUndo; redoB.disabled = !sch.canRedo; }
  let conflictShown = false;
  const onStatus = (e) => {
    const { status, message } = e.detail;
    statusEl.textContent = status === 'error' && message ? message : STATUS[status] || ''; statusEl.dataset.s = status;
    if (status === 'conflict' && !conflictShown) {
      conflictShown = true;
      const m = modal('Este circuito foi alterado em outro aparelho', h('p', {}, 'Para não perder nada, salve o que está na tela como uma cópia, ou carregue de novo a versão mais recente (o que você fez aqui desde o último salvamento será perdido).'), [
        h('button.btn', { onclick: () => { m.close(); location.reload(); } }, 'Carregar a versão mais recente'),
        h('button.btn.primary', { onclick: async () => { m.close(); try { const id = await saver.saveAsCopy(); toast('Cópia salva.'); location.hash = '#/c/' + id; location.reload(); } catch (err) { toast(err.message, 'err'); } } }, 'Salvar como cópia')]);
    }
  };
  saver.addEventListener('status', onStatus);
  onStatus({ detail: { status: saver.status } });

  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('wheel', onWheel, { passive: false }); canvas.addEventListener('dblclick', onDbl);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !drag) { hoverPin = null; if (tool === 'place') { ghost = null; } requestDraw(); } });
  document.addEventListener('keydown', onKey); document.addEventListener('keyup', onKeyUp);
  const ro = new ResizeObserver(() => resize()); ro.observe(canvas);

  buildPalette(); syncFabs(); syncTools(); updateHint(); updateUndo(); renderPanel(); canvas.dataset.tool = tool;
  resize(); fit();
  if (isMobile() && sch.isEmpty) setSheet('parts');

  return {
    destroy() {
      offSch(); ro.disconnect(); saver.removeEventListener('status', onStatus);
      document.removeEventListener('keydown', onKey); document.removeEventListener('keyup', onKeyUp);
      cancelAnimationFrame(raf);
    },
    // para os testes
    get sch() { return sch; }, view, setTool, choosePart,
  };
}
