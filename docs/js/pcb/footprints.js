// Pegadas (footprints) das peças na placa. Medidas em milímetros, y para baixo.
// pad: { n: nome, x, y, s: 'c' redondo | 'r' retangular | 'o' oval, w, h, d: furo (0 = SMD) }
// fp.pin[i] = qual pino do símbolo (posição no esquema) está ligado ao pad i. Sem isso, pad i = pino i.

const round2 = (v) => Math.round(v * 100) / 100;
const tht = (n, x, y, { s = 'c', w = 1.8, h = w, d = 0.8 } = {}) => ({ n: String(n), x: round2(x), y: round2(y), s, w, h, d });
const smd = (n, x, y, w, h) => ({ n: String(n), x: round2(x), y: round2(y), s: 'r', w, h, d: 0 });
const L = (...pts) => ['l', pts];
const C = (x, y, r) => ['c', x, y, r];
const box = (pads, silk) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
  for (const p of pads) { add(p.x - p.w / 2, p.y - p.h / 2); add(p.x + p.w / 2, p.y + p.h / 2); }
  for (const s of silk) { if (s[0] === 'l') s[1].forEach(([x, y]) => add(x, y)); else { add(s[1] - s[3], s[2] - s[3]); add(s[1] + s[3], s[2] + s[3]); } }
  return { x0, y0, x1, y1 };
};
const mk = (id, name, pads, silk, extra = {}) => ({ id, name, pads, silk, box: box(pads, silk), smd: pads.every((p) => !p.d), ...extra });
const rect = (w, h) => L([-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2], [-w / 2, -h / 2]);

// ---------- construtores ----------
function axial(pitch) {
  const body = Math.min(pitch - 3.4, 6.5), bh = 2.4;
  return mk(`AXIAL-${pitch}`, `Axial ${String(pitch).replace('.', ',')} mm (resistor, diodo pequeno)`,
    [tht(1, -pitch / 2, 0, { s: 'o', w: 2, h: 1.6 }), tht(2, pitch / 2, 0, { s: 'o', w: 2, h: 1.6 })],
    [rect(body, bh), L([-pitch / 2 + 1, 0], [-body / 2, 0]), L([body / 2, 0], [pitch / 2 - 1, 0])]);
}
function diode(pitch) {
  const body = Math.min(pitch - 4, 5.2), bh = 2.8, bx = body / 2;
  return mk(`DO41-${pitch}`, `Diodo DO-41 ${String(pitch).replace('.', ',')} mm`,
    [tht('A', -pitch / 2, 0, { s: 'r', w: 2, h: 2 }), tht('K', pitch / 2, 0, { s: 'c', w: 2, h: 2 })],
    [rect(body, bh), L([bx - 1, -bh / 2], [bx - 1, bh / 2]), L([-pitch / 2 + 1.2, 0], [-bx, 0]), L([bx, 0], [pitch / 2 - 1.2, 0])]);
}
function disc(pitch, kind = 'DISC') {
  const w = pitch + 1.5;
  return mk(`${kind}-${pitch}`, kind === 'DISC' ? `Capacitor disco ${String(pitch).replace('.', ',')} mm` : `Capacitor filme ${String(pitch).replace('.', ',')} mm`,
    [tht(1, -pitch / 2, 0), tht(2, pitch / 2, 0)], [rect(w, Math.max(3.5, pitch - 0.8))]);
}
function radial(d, pitch) {
  return mk(`RAD-${d}-${pitch}`, `Eletrolítico Ø${String(d).replace('.', ',')} mm, passo ${String(pitch).replace('.', ',')}`,
    [tht('+', -pitch / 2, 0, { s: 'r', w: 1.8 }), tht('−', pitch / 2, 0)], [C(0, 0, d / 2 + 0.2), L([-pitch / 2 - 1.8, -1], [-pitch / 2 - 1.8, 1]), L([-pitch / 2 - 2.3, 0], [-pitch / 2 - 1.3, 0])]);
}
function led(d) {
  const r = d / 2 + 0.3;
  return mk(`LED-${d}MM`, `LED ${d} mm`, [tht('A', -1.27, 0, { s: 'r', w: 1.8 }), tht('K', 1.27, 0)], [C(0, 0, r), L([r - 0.2, -1.2], [r - 0.2, 1.2])]);
}
function smd2(size, ids) {
  const t = { '0402': [0.5, 0.5, 0.5], '0603': [0.8, 0.9, 0.8], '0805': [1.0, 1.3, 1.0], '1206': [1.1, 1.8, 1.5] }[size];
  const [pw, ph, gap] = [t[0] + 0.3, t[1], t[2] + 0.3]; const off = (gap + pw) / 2 - 0.15;
  return mk(`SMD-${size}`, `SMD ${size} (resistor, capacitor, LED)`, [smd(1, -off, 0, pw, ph), smd(2, off, 0, pw, ph)], [L([-off - pw / 2, -ph / 2 - 0.2], [off + pw / 2, -ph / 2 - 0.2])]);
}
function to92(order) { // order: nomes dos 3 pads da esquerda para a direita, vistos de cima (lado plano para baixo)
  return mk(`TO92-${order}`, `TO-92 (${order.split('').join('-')} visto de frente)`,
    [tht(1, -2.54, 0, { s: 'r', w: 1.7, h: 1.7 }), tht(2, 0, 0, { w: 1.7 }), tht(3, 2.54, 0, { w: 1.7 })],
    [L([-2.4, 2.4], [2.4, 2.4], [2.9, 1.2], [2.9, -0.6], [1.7, -2.3], [-1.7, -2.3], [-2.9, -0.6], [-2.9, 1.2], [-2.4, 2.4])], { to92: order });
}
function to220() {
  return mk('TO220', 'TO-220 (3 pinos, vertical)', [tht(1, -2.54, 0, { s: 'r', w: 2, h: 2.2, d: 1.1 }), tht(2, 0, 0, { w: 2, h: 2.2, d: 1.1 }), tht(3, 2.54, 0, { w: 2, h: 2.2, d: 1.1 })],
    [rect(10.2, 4.6), L([-5.1, -1.8], [5.1, -1.8])]);
}
function dip(n) {
  const rows = n / 2, wide = n >= 28 ? 15.24 : 7.62, pads = [];
  for (let i = 0; i < rows; i++) pads.push(tht(i + 1, -wide / 2, (i - (rows - 1) / 2) * 2.54, { s: i === 0 ? 'r' : 'o', w: 1.6, h: 1.6 }));
  for (let i = 0; i < rows; i++) pads.push(tht(rows + 1 + i, wide / 2, ((rows - 1) / 2 - i) * 2.54, { s: 'o', w: 1.6, h: 1.6 }));
  const hh = rows * 2.54 / 2 + 0.3, hw = wide / 2 - 1.2;
  return mk(`DIP-${n}`, `DIP-${n} (CI de ${n} pinos)`, pads, [L([-hw, -hh], [-1, -hh], [-1, -hh + 0.1], [1, -hh + 0.1], [1, -hh], [hw, -hh], [hw, hh], [-hw, hh], [-hw, -hh]), C(-hw + 1, -hh + 1.2, 0.35)]);
}
function sip(n, pitch = 2.54, name) {
  const pads = [];
  for (let i = 0; i < n; i++) pads.push(tht(i + 1, (i - (n - 1) / 2) * pitch, 0, { s: i === 0 ? 'r' : 'c', w: Math.min(1.9, pitch - 0.5), d: pitch > 3 ? 1.0 : 0.8 }));
  const hw = (n * pitch) / 2;
  return mk(`SIP-${n}${pitch === 2.54 ? '' : '-' + pitch}`, name || `Fileira de ${n} pino${n > 1 ? 's' : ''} (${String(pitch).replace('.', ',')} mm)`, pads, [rect(hw * 2, pitch > 3 ? 4 : 2.54)]);
}
function term(n) {
  const pads = [];
  for (let i = 0; i < n; i++) pads.push(tht(i + 1, (i - (n - 1) / 2) * 5.08, 0, { s: i === 0 ? 'r' : 'c', w: 2.6, d: 1.3 }));
  return mk(`TERM-${n}`, `Borne parafuso ${n} vias (5,08 mm)`, pads, [rect(n * 5.08, 7.6)]);
}
const TACT = () => mk('TACT-6MM', 'Botão tátil 6×6 mm (4 pernas)', [tht(1, -3.25, -2.25, { w: 1.8 }), tht(2, 3.25, -2.25, { w: 1.8 }), tht(3, -3.25, 2.25, { w: 1.8 }), tht(4, 3.25, 2.25, { w: 1.8 })], [rect(6, 6)], { pin: [0, 1, 0, 1] });
const POT = () => mk('POT-5.0', 'Potenciômetro 3 pinos (5 mm)', [tht(1, -5, 0, { w: 2 }), tht(2, 5, 0, { w: 2 }), tht(3, 0, 0, { w: 2 })], [rect(14, 6)], { pin: [0, 1, 2] });
const BUZZ = () => mk('BUZZ-12MM', 'Buzzer redondo Ø12 mm (passo 7,6)', [tht('+', -3.8, 0, { s: 'r', w: 2 }), tht('−', 3.8, 0, { w: 2 })], [C(0, 0, 6.2)]);
const HC49 = () => mk('HC49', 'Cristal HC-49', [tht(1, -2.44, 0), tht(2, 2.44, 0)], [rect(10, 4.5)]);
const HOLE = (d) => mk(`HOLE-${d}`, `Furo de fixação ${String(d).replace('.', ',')} mm`, [{ n: '', x: 0, y: 0, s: 'c', w: d + 1.6, h: d + 1.6, d }], [C(0, 0, d / 2 + 1.2)], { free: true });

const cache = new Map();
/** Pegada pelo id. `pins` é a quantidade de pinos do símbolo (para fileiras e DIP). */
export function getFootprint(id) {
  if (cache.has(id)) return cache.get(id);
  let f = null, m;
  if ((m = /^AXIAL-([\d.]+)$/.exec(id))) f = axial(Number(m[1]));
  else if ((m = /^DO41-([\d.]+)$/.exec(id))) f = diode(Number(m[1]));
  else if ((m = /^DISC-([\d.]+)$/.exec(id))) f = disc(Number(m[1]));
  else if ((m = /^FILM-([\d.]+)$/.exec(id))) f = disc(Number(m[1]), 'FILM');
  else if ((m = /^RAD-([\d.]+)-([\d.]+)$/.exec(id))) f = radial(Number(m[1]), Number(m[2]));
  else if ((m = /^LED-(\d)MM$/.exec(id))) f = led(Number(m[1]));
  else if ((m = /^SMD-(0402|0603|0805|1206)$/.exec(id))) f = smd2(m[1]);
  else if ((m = /^TO92-([A-Z]{3})$/.exec(id))) f = to92(m[1]);
  else if (id === 'TO220') f = to220();
  else if ((m = /^DIP-(\d+)$/.exec(id)) && Number(m[1]) % 2 === 0 && Number(m[1]) >= 4 && Number(m[1]) <= 64) f = dip(Number(m[1]));
  else if ((m = /^SIP-(\d+)(?:-([\d.]+))?$/.exec(id)) && Number(m[1]) >= 1 && Number(m[1]) <= 64) f = sip(Number(m[1]), m[2] ? Number(m[2]) : 2.54);
  else if ((m = /^TERM-(\d)$/.exec(id))) f = term(Number(m[1]));
  else if (id === 'TACT-6MM') f = TACT();
  else if (id === 'POT-5.0') f = POT();
  else if (id === 'BUZZ-12MM') f = BUZZ();
  else if (id === 'HC49') f = HC49();
  else if ((m = /^HOLE-([\d.]+)$/.exec(id))) f = HOLE(Number(m[1]));
  if (f) cache.set(id, f);
  return f;
}

const BJT = ['TO92-EBC', 'TO92-CBE', 'TO220'];
const MOS = ['TO92-DGS', 'TO92-SGD', 'TO220'];
const CHOICES = {
  R: ['AXIAL-10.16', 'AXIAL-7.62', 'AXIAL-12.7', 'SMD-0805', 'SMD-1206', 'SMD-0603'],
  POT: ['POT-5.0', 'SIP-3'], C: ['DISC-5.08', 'FILM-7.5', 'DISC-2.54', 'SMD-0805', 'SMD-1206', 'SMD-0603'],
  CP: ['RAD-5-2', 'RAD-6.3-2.5', 'RAD-8-3.5', 'RAD-10-5'], L: ['AXIAL-10.16', 'AXIAL-12.7'], F: ['AXIAL-12.7', 'TERM-2'], XTAL: ['HC49'],
  LDR: ['DISC-5.08'], NTC: ['DISC-5.08'],
  D: ['DO41-10.16', 'DO41-7.62'], ZD: ['DO41-10.16', 'DO41-7.62'], SD: ['DO41-10.16', 'DO41-7.62'],
  LED: ['LED-5MM', 'LED-3MM', 'SMD-0805', 'SMD-1206'],
  NPN: BJT, PNP: BJT, NMOS: MOS, PMOS: MOS, BT: ['TERM-2', 'SIP-2'], SW: ['TACT-6MM', 'SIP-2', 'TERM-2'], PB: ['TACT-6MM', 'SIP-2', 'TERM-2'],
  SPDT: ['SIP-3'], MOTOR: ['TERM-2', 'SIP-2'], LAMP: ['TERM-2'], SPK: ['TERM-2', 'SIP-2'], BUZZ: ['BUZZ-12MM', 'SIP-2'],
};
// ordem dos pinos do símbolo → pads físicos, quando não for a mesma
const PIN_ORDER = {
  'TO92-EBC': { NPN: [2, 0, 1], PNP: [2, 0, 1] }, // pads E,B,C ← símbolo B,C,E
  'TO92-CBE': { NPN: [1, 0, 2], PNP: [1, 0, 2] },
  'TO92-DGS': { NMOS: [1, 0, 2], PMOS: [1, 0, 2] }, // pads D,G,S ← símbolo G,D,S
  'TO92-SGD': { NMOS: [2, 0, 1], PMOS: [2, 0, 1] },
};
/** Peças que não existem fisicamente na placa (fontes de teste, terra, rótulos, medidores). */
const NOT_PHYSICAL = new Set(['GND', 'VCC', 'NET', 'VDC', 'VAC', 'IDC', 'VM', 'AM']);
export const isPhysical = (part) => !NOT_PHYSICAL.has(part.t);

/** Lista de pegadas possíveis para uma peça do esquema. */
export function choicesFor(part) {
  const n = (part.pins ? part.pins.length : 0);
  if (part.t === 'IC') { const out = []; if (n % 2 === 0 && n >= 4) out.push(`DIP-${n}`); out.push(`SIP-${n}`); return out; }
  if (part.t === 'HDR') return [`SIP-${n || 2}`, `TERM-${n}`].filter((x) => getFootprint(x));
  if (part.t === 'OPAMP' || part.t === 'NOT' || /^(AND|NAND|OR|NOR|XOR)$/.test(part.t)) return ['SIP-3', 'SIP-4', 'SIP-5'].filter((id) => Number(id.slice(4)) >= (part.t === 'OPAMP' ? 3 : part.t === 'NOT' ? 2 : 3));
  if (part.t === 'TRAFO') return ['SIP-4'];
  if (part.t === '7805') return ['TO220', 'TO92-EBC'];
  return CHOICES[part.t] || ['SIP-2'];
}
export const defaultFootprint = (part) => {
  if (part.t === 'IC' && (part.pins || []).length === 8) return 'DIP-8';
  if (part.t === '7805') return 'TO220';
  return choicesFor(part)[0];
};
/** Para cada pad (por posição), o índice do pino do símbolo a que ele pertence. */
export function pinIndexMap(fp, part) {
  if (fp.pin) return fp.pin;
  const ord = PIN_ORDER[fp.id]?.[part?.t];
  if (ord) return ord;
  return fp.pads.map((_, i) => i);
}
export const footprintName = (id) => getFootprint(id)?.name || id;
export const ALL_FOOTPRINT_GROUPS = [
  ['Furo de fixação', ['HOLE-3.2', 'HOLE-2.5', 'HOLE-4.0']],
];
