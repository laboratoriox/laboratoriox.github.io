// Roteamento, login por e-mail + código e galeria.
import { api, setUnauthorizedHandler } from './api.js';
import { h, $, toast, modal, relTime } from './util.js';
import { icon } from './icons.js';
import { newDocFromOptions, newDocFromImage } from './editor/doc.js';
import { loadDoc, Saver } from './editor/persist.js';
import { mountEditor } from './editor/ui.js';
import { state } from './editor/state.js';
import { loadCircuit, createCircuit, CircuitSaver } from './circuit/persist.js';
import { mountCircuitEditor } from './circuit/editor.js';
import { mountPcbEditor } from './pcb/editor.js';
import { Board } from './pcb/board.js';

const app = $('#app');
let session = null;     // { email }
let editorHandle = null;

setUnauthorizedHandler(() => { session = null; teardownEditor(); location.hash = '#/'; render(); });

function teardownEditor() {
  if (editorHandle) { editorHandle.destroy(); editorHandle = null; }
}

// ---------------- login ----------------
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function renderLogin() {
  teardownEditor();
  const status = h('p.login-status', { role: 'status', 'aria-live': 'polite' });
  const form = h('div.login-form');
  let email = '', timer = null;
  const say = (msg, err) => { status.textContent = msg || ''; status.classList.toggle('err', !!err); };
  const busy = (btn, on) => { if (btn) { btn.disabled = on; btn.toggleAttribute('aria-busy', on); } };

  function stepEmail(prefill) {
    clearInterval(timer);
    const input = h('input', { type: 'email', name: 'email', autocomplete: 'email', inputMode: 'email', autocapitalize: 'none', spellcheck: false, placeholder: 'seu@email.com', value: prefill || '', 'aria-label': 'Seu e-mail', required: true });
    const btn = h('button.btn.primary.big', { type: 'submit' }, 'Enviar código');
    const f = h('form', { novalidate: true, onsubmit: async (ev) => {
      ev.preventDefault();
      const v = input.value.trim().toLowerCase();
      if (!EMAIL_OK.test(v)) { say('Digite um e-mail válido.', true); input.focus(); return; }
      say(''); busy(btn, true);
      try { await api.requestCode(v); email = v; stepCode(); }
      catch (e) { say(e.message[0].toUpperCase() + e.message.slice(1) + (e.message.endsWith('.') ? '' : '.'), true); }
      finally { busy(btn, false); }
    } }, h('label.flabel', { for: 'em' }, 'Seu e-mail'), input, btn);
    input.id = 'em';
    form.replaceChildren(f);
    setTimeout(() => input.focus(), 50);
  }

  function stepCode() {
    say('');
    const input = h('input', { type: 'text', name: 'code', id: 'cd', inputMode: 'numeric', autocomplete: 'one-time-code', maxLength: 7, pattern: '[0-9]*', placeholder: '000000', 'aria-label': 'Código de 6 números', class: 'codebox' });
    const btn = h('button.btn.primary.big', { type: 'submit' }, 'Entrar');
    const again = h('button.linkbtn', { type: 'button', disabled: true }, '');
    let left = 60;
    const tick = () => {
      if (left > 0) { again.disabled = true; again.textContent = `Enviar de novo em ${left}s`; left--; }
      else { clearInterval(timer); again.disabled = false; again.textContent = 'Enviar de novo'; }
    };
    clearInterval(timer); tick(); timer = setInterval(tick, 1000);
    again.onclick = async () => {
      say(''); again.disabled = true;
      try { await api.requestCode(email); left = 60; clearInterval(timer); tick(); timer = setInterval(tick, 1000); say('Enviamos um novo código.'); }
      catch (e) { say(e.message[0].toUpperCase() + e.message.slice(1) + '.', true); again.disabled = false; }
    };
    const submit = async () => {
      const code = input.value.replace(/\D/g, '');
      if (code.length !== 6) { say('O código tem 6 números.', true); input.focus(); return; }
      say(''); busy(btn, true);
      try { const r = await api.verifyCode(email, code); clearInterval(timer); session = { email: r.email }; render(); }
      catch (e) { say(e.message[0].toUpperCase() + e.message.slice(1) + (e.message.endsWith('.') ? '' : '.'), true); input.select(); busy(btn, false); }
    };
    input.addEventListener('input', () => { input.value = input.value.replace(/[^\d ]/g, ''); if (input.value.replace(/\D/g, '').length === 6) submit(); });
    form.replaceChildren(h('form', { novalidate: true, onsubmit: (ev) => { ev.preventDefault(); submit(); } },
      h('p.sent', {}, 'Enviamos um código de 6 números para ', h('b', {}, email), '. Pode levar um minutinho; veja também o spam.'),
      h('label.flabel', { for: 'cd' }, 'Código'), input, btn,
      h('div.row2', {}, again, h('button.linkbtn', { type: 'button', onclick: () => { say(''); stepEmail(email); } }, 'Trocar e-mail'))));
    setTimeout(() => input.focus(), 50);
  }

  stepEmail();
  app.replaceChildren(h('main.login', {},
    h('div.login-card', {},
      h('a.back-site', { href: '../' }, h('span.ic', { html: icon.back }), 'Início'),
      h('h1.wordmark', {}, 'Ateliê'),
      h('div', { html: '<svg class="flourish" viewBox="0 0 320 40" aria-hidden="true"><path pathLength="1" d="M4 28 C 58 4, 108 42, 168 18 S 268 4, 316 22"/></svg>' }),
      h('p.login-lead', {}, 'Seu estúdio de desenho no navegador. Entre com seu e-mail para continuar seus desenhos em qualquer aparelho.'),
      form, status,
      h('p.fineprint', {}, 'Sem senha: enviamos um código de uso único para o seu e-mail. Guardamos seus desenhos sob um identificador criptografado do e-mail, não o e-mail em si, e só usamos o seu endereço para enviar o código.'))));
}

// ---------------- galeria ----------------
let galTab = 'desenhos';
try { if (sessionStorage.getItem('atelie_tab') === 'circuitos') galTab = 'circuitos'; } catch {}

async function renderGallery() {
  teardownEditor();
  const grid = h('div.cards', { 'aria-busy': 'true' });
  const header = h('header.gal-top', {},
    h('a.back-site', { href: '../', title: 'Voltar ao início do site' }, h('span.ic', { html: icon.back }), 'Início'),
    h('h1.wordmark.sm', {}, 'Ateliê'),
    h('div.spacer'),
    h('button.chip-user', { type: 'button', title: 'Sair', onclick: logout }, h('span', {}, session.email || 'Sair'), h('span.ic', { html: icon.logout })));
  const circ = () => galTab === 'circuitos';
  const tabBtn = (id, label) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(galTab === id), onclick: () => { galTab = id; try { sessionStorage.setItem('atelie_tab', id); } catch {} renderGallery(); } }, label);
  const tabs = h('div.gal-tabs', { role: 'tablist', 'aria-label': 'Tipo de projeto' }, tabBtn('desenhos', 'Desenhos'), tabBtn('circuitos', 'Circuitos'));
  const newBtn = () => h('button.btn.primary', { type: 'button', onclick: circ() ? openNewCircuit : openNew }, h('span.ic', { html: icon.plus }), circ() ? 'Novo circuito' : 'Novo desenho');
  app.replaceChildren(h('div.gallery', {}, header, h('main.gal-main', {},
    tabs, h('div.gal-head', {}, h('h2', {}, circ() ? 'Seus circuitos' : 'Seus desenhos'), newBtn()),
    grid)));

  let list = [];
  try { list = (await api.list()).drawings; } catch (e) { toast(e.message, 'err'); }
  grid.removeAttribute('aria-busy');
  list = list.filter((d) => (d.kind === 'circuit') === circ());
  if (!list.length) {
    grid.replaceChildren(h('div.empty', {}, h('p', {}, circ() ? 'Você ainda não tem circuitos. Aqui você desenha esquemas elétricos com peças, fios e nomes.' : 'Você ainda não tem desenhos.'),
      h('button.btn.primary', { type: 'button', onclick: circ() ? openNewCircuit : openNew }, circ() ? 'Criar o primeiro circuito' : 'Criar o primeiro desenho')));
    return;
  }
  const lazyThumb = (d) => {
    if (d.thumb) return h('img', { src: d.thumb, alt: '', loading: 'lazy' });
    const holder = h('span.noimg', {}, '…');
    api.thumb(d.id).then((r) => { holder.replaceWith(r.thumb ? h('img', { src: r.thumb, alt: '' }) : h('span.noimg', {}, 'Sem miniatura')); }).catch(() => { holder.textContent = 'Sem miniatura'; });
    return holder;
  };
  const href = (d) => (d.kind === 'circuit' ? `#/c/${d.id}` : `#/d/${d.id}`);
  grid.replaceChildren(...list.map((d) => h('article.card', {},
    h('a.thumb', { href: href(d), 'aria-label': `Abrir ${d.name}` }, lazyThumb(d)),
    h('div.cardinfo', {}, h('a.cname', { href: href(d) }, d.name), h('span.cmeta', {}, d.kind === 'circuit' ? `Esquema · ${relTime(d.updatedAt)}` : `${d.width}×${d.height} · ${relTime(d.updatedAt)}`)),
    h('button.ibtn.del', { type: 'button', title: 'Excluir', 'aria-label': `Excluir ${d.name}`, onclick: () => confirmDelete(d), html: icon.trash }))));
}

function confirmDelete(d) {
  const what = d.kind === 'circuit' ? 'circuito' : 'desenho';
  const m = modal(`Excluir este ${what}?`, h('p', {}, `“${d.name}” será apagado de todos os seus aparelhos. Não dá para desfazer.`), [
    h('button.btn', { onclick: () => m.close() }, 'Cancelar'),
    h('button.btn.danger', { onclick: async () => { m.close(); try { await api.remove(d.id); toast(`${what[0].toUpperCase()}${what.slice(1)} excluído.`); renderGallery(); } catch (e) { toast(e.message, 'err'); } } }, 'Excluir'),
  ]);
}

function openNewCircuit() {
  const name = h('input', { value: 'Circuito sem título', maxLength: 80, 'aria-label': 'Nome do circuito' });
  const go = async () => {
    create.disabled = true;
    try { const id = await createCircuit(name.value.trim() || 'Circuito sem título'); m.close(); location.hash = '#/c/' + id; }
    catch (e) { create.disabled = false; toast(e.message, 'err'); }
  };
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  const create = h('button.btn.primary', { type: 'button', onclick: go }, 'Criar');
  const m = modal('Novo circuito', h('div.newform', {}, h('label.field.col', {}, h('span.flabel', {}, 'Nome'), name),
    h('p.hint', {}, 'Um espaço para desenhar esquemas elétricos: peças, fios e nomes, separado dos seus desenhos.')), [h('button.btn', { onclick: () => m.close() }, 'Cancelar'), create]);
}

const PRESETS = [
  ['Tela 1920 × 1080', 1920, 1080], ['Quadrado 2048', 2048, 2048], ['A4 retrato (300 dpi)', 2480, 3508],
  ['A4 paisagem (300 dpi)', 3508, 2480], ['Ilustração 3000 × 2000', 3000, 2000], ['Quadrinho 1600 × 2400', 1600, 2400],
];
const MAX_SIDE = 4096, MAX_PIXELS = 16_000_000;

function openNew() {
  let w = 2048, hgt = 1536, bg = '#ffffff', bgMode = 'white';
  const name = h('input', { value: 'Sem título', maxLength: 80, 'aria-label': 'Nome' });
  const wIn = h('input', { type: 'number', value: w, min: 64, max: MAX_SIDE, inputMode: 'numeric', 'aria-label': 'Largura em pixels' });
  const hIn = h('input', { type: 'number', value: hgt, min: 64, max: MAX_SIDE, inputMode: 'numeric', 'aria-label': 'Altura em pixels' });
  const msg = h('p.hint');
  const check = () => {
    w = Math.round(Number(wIn.value)); hgt = Math.round(Number(hIn.value));
    const ok = w >= 64 && hgt >= 64 && w <= MAX_SIDE && hgt <= MAX_SIDE && w * hgt <= MAX_PIXELS;
    msg.textContent = ok ? `${((w * hgt) / 1e6).toFixed(1)} megapixels` : `Use de 64 a ${MAX_SIDE} px por lado, com no máximo ${MAX_PIXELS / 1e6} megapixels no total (limite dos navegadores de celular).`;
    msg.classList.toggle('err', !ok); create.disabled = !ok; return ok;
  };
  const presets = h('div.presetgrid', {}, ...PRESETS.map(([label, pw, ph]) => h('button.btn.sm', { type: 'button', onclick: () => { wIn.value = pw; hIn.value = ph; check(); } }, label)));
  const colorIn = h('input', { type: 'color', value: '#ffffff', 'aria-label': 'Cor de fundo', oninput: () => { bg = colorIn.value; bgMode = 'color'; setBg('color'); } });
  const bgBtns = {};
  const setBg = (m) => { bgMode = m; Object.entries(bgBtns).forEach(([k, b]) => b.setAttribute('aria-pressed', String(k === m))); };
  bgBtns.white = h('button.btn.sm', { type: 'button', onclick: () => { bg = '#ffffff'; setBg('white'); } }, 'Branco');
  bgBtns.transparent = h('button.btn.sm', { type: 'button', onclick: () => setBg('transparent') }, 'Transparente');
  bgBtns.color = h('button.btn.sm', { type: 'button', onclick: () => { bg = colorIn.value; setBg('color'); } }, 'Cor');
  setBg('white');
  wIn.addEventListener('input', check); hIn.addEventListener('input', check);
  const photoIn = h('input', { type: 'file', accept: 'image/*', hidden: true });
  photoIn.addEventListener('change', async () => {
    const f = photoIn.files[0]; photoIn.value = ''; if (!f) return;
    if (!/^image\//.test(f.type)) { toast('Escolha um arquivo de imagem (JPG, PNG ou WebP).', 'err'); return; }
    const url = URL.createObjectURL(f);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('x')); i.src = url; });
      pendingDoc = newDocFromImage(img, (f.name || 'Foto').replace(/\.[^.]+$/, '').slice(0, 60) || 'Foto');
      m.close(); location.hash = '#/novo';
    } catch { toast('Não consegui abrir essa imagem.', 'err'); } finally { URL.revokeObjectURL(url); }
  });
  const create = h('button.btn.primary', { type: 'button', onclick: () => {
    if (!check()) return;
    const doc = newDocFromOptions({ name: name.value.trim() || 'Sem título', width: w, height: hgt, background: bgMode === 'transparent' ? null : bg });
    pendingDoc = doc; m.close(); location.hash = '#/novo';
  } }, 'Criar');
  const body = h('div.newform', {},
    h('label.field.col', {}, h('span.flabel', {}, 'Nome'), name),
    h('div.flabel', {}, 'Tamanho da tela'), presets,
    h('div.dims', {}, h('label.field.col', {}, h('span.flabel', {}, 'Largura (px)'), wIn), h('span.times', {}, '×'), h('label.field.col', {}, h('span.flabel', {}, 'Altura (px)'), hIn)), msg,
    h('div.flabel', {}, 'Cor do papel'), h('div.bgrow', {}, bgBtns.white, bgBtns.transparent, bgBtns.color, colorIn),
    h('div.flabel', {}, 'Ou comece de uma foto'), h('div.bgrow', {}, h('button.btn.sm', { type: 'button', onclick: () => photoIn.click() }, 'Escolher foto…'), photoIn));
  const m = modal('Novo desenho', body, [h('button.btn', { onclick: () => m.close() }, 'Cancelar'), create]);
  check();
}

let pendingDoc = null;

// ---------------- editor ----------------
async function renderEditor(id) {
  teardownEditor();
  app.replaceChildren(h('div.loading', { role: 'status' }, 'Abrindo desenho…'));
  let doc;
  try {
    if (id === null) { doc = pendingDoc; pendingDoc = null; if (!doc) { location.hash = '#/'; return; } }
    else doc = await loadDoc(id);
  } catch (e) {
    toast(e.status === 404 ? 'Desenho não encontrado.' : e.message, 'err'); location.hash = '#/'; return;
  }
  const saver = new Saver(doc);
  const root = h('div.editor-root');
  app.replaceChildren(root);
  const exit = async () => {
    await saver.flush();
    if (saver.status === 'saving') await new Promise((r) => saver.addEventListener('status', () => saver.status !== 'saving' && r(), { once: true }));
    location.hash = '#/';
  };
  const handle = mountEditor(root, doc, saver, { onExit: exit });
  // ao sair da tela (voltar, trocar de rota), tenta enviar o que ainda não foi salvo
  editorHandle = { destroy() { saver.flush(); handle.destroy(); saver.destroy(); } };
  if (id === null) { saver.flush(); } // cria o desenho no servidor logo de início
}

async function renderCircuit(id, startView = 'sch') {
  teardownEditor();
  app.replaceChildren(h('div.loading', { role: 'status' }, 'Abrindo circuito…'));
  let st;
  try { st = await loadCircuit(id); }
  catch (e) { toast(e.status === 404 ? 'Circuito não encontrado.' : e.message, 'err'); location.hash = '#/'; return; }
  const saver = new CircuitSaver(st);
  const root = h('div.editor-root');
  app.replaceChildren(root);
  const exit = async () => {
    await saver.flush();
    if (saver.status === 'saving') await new Promise((r) => saver.addEventListener('status', () => saver.status !== 'saving' && r(), { once: true }));
    location.hash = '#/';
  };
  let handle = null;
  const show = (view) => {
    if (handle) handle.destroy();
    if (view === 'pcb') {
      if (!st.board) { st.board = new Board(); saver.watch(st.board); }
      handle = mountPcbEditor(root, st, saver, { onExit: exit, onSwitch: show });
      history.replaceState(null, '', '#/c/' + id + '/placa');
    } else {
      handle = mountCircuitEditor(root, st, saver, { onExit: exit, onSwitch: show });
      history.replaceState(null, '', '#/c/' + id);
    }
    window.__circuit = handle;
  };
  show(startView);
  editorHandle = { destroy() { saver.flush(); handle.destroy(); saver.destroy(); } };
}

async function logout() {
  try { await api.logout(); } catch {}
  session = null; render();
}

// ---------------- roteador ----------------
async function render() {
  if (!session) {
    try { session = await api.me(); } catch { session = null; }
  }
  if (!session) return renderLogin();
  const hash = location.hash;
  let m;
  if ((m = /^#\/d\/([a-f0-9]{16})$/.exec(hash))) return renderEditor(m[1]);
  if ((m = /^#\/c\/([a-f0-9]{16})(\/placa)?$/.exec(hash))) return renderCircuit(m[1], m[2] ? 'pcb' : 'sch');
  if (hash === '#/novo') return renderEditor(null);
  return renderGallery();
}
window.addEventListener('hashchange', render);
render();
