/*
 * Campo magnético: uma grade de agulhas que se alinha às linhas de campo
 * de um ímã (dipolo). O ímã passeia sozinho e segue o mouse ou o dedo.
 * Ao carregar, as agulhas começam em ângulos aleatórios e se assentam.
 */
(() => {
  const canvas = document.getElementById('campo');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let w = 0, h = 0, dpr = 1, needles = [], gap = 30;
  let magnet = { x: 0, y: 0 };          // posição atual do ímã
  let target = { x: 0, y: 0 };          // para onde ele vai
  let pointerAt = -1e9;                 // instante do último toque do ponteiro
  let running = false, visible = true, raf = 0;
  const rgb = () => {
    const cs = getComputedStyle(document.documentElement);
    return { ink: cs.getPropertyValue('--needle').trim(), hot: cs.getPropertyValue('--needle-hot').trim() };
  };
  let colors = rgb();
  let clear = [];                        // áreas de texto onde não desenhamos agulhas
  function measureClear() {
    const r = canvas.getBoundingClientRect(), pad = 10;
    clear = ['.wordmark__jh', '.wordmark__lab', '.lede', '.jump'].map((q) => document.querySelector(q))
      .filter(Boolean).map((el) => {
        const b = el.getBoundingClientRect();
        return { x0: b.left - r.left - pad, y0: b.top - r.top - pad, x1: b.right - r.left + pad, y1: b.bottom - r.top + pad };
      });
  }
  const inText = (x, y) => clear.some((c) => x > c.x0 && x < c.x1 && y > c.y0 && y < c.y1);

  function resize() {
    const r = canvas.getBoundingClientRect();
    w = r.width; h = r.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    gap = w < 560 ? 24 : 30;
    const cols = Math.ceil(w / gap) + 1, rows = Math.ceil(h / gap) + 1;
    const ox = (w - (cols - 1) * gap) / 2, oy = (h - (rows - 1) * gap) / 2;
    needles = [];
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++)
        needles.push({ x: ox + i * gap, y: oy + j * gap, a: Math.random() * Math.PI * 2, t: 0 });
    measureClear();
    magnet.x = target.x = w * 0.72; magnet.y = target.y = h * 0.38;
    draw(performance.now(), true);
  }

  // ângulo do campo de um dipolo horizontal em (dx, dy)
  const dipole = (dx, dy) => {
    const r2 = dx * dx + dy * dy || 1;
    const bx = (3 * dx * dx) / r2 - 1, by = (3 * dx * dy) / r2;
    return Math.atan2(by, bx);
  };
  const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

  function draw(now, still) {
    ctx.clearRect(0, 0, w, h);

    if (!still) {
      // sem ponteiro por 2,5 s, o ímã volta a passear
      if (now - pointerAt > 2500) {
        const s = now * 0.00017;
        target.x = w * (0.5 + 0.36 * Math.sin(s * 1.3));
        target.y = h * (0.45 + 0.28 * Math.sin(s * 0.9 + 1.2));
      }
      const k = now - pointerAt < 2500 ? 0.22 : 0.035;
      magnet.x += (target.x - magnet.x) * k;
      magnet.y += (target.y - magnet.y) * k;
    }

    const reach = Math.max(180, Math.min(w, h) * 0.5);
    ctx.lineCap = 'round';
    const base = [], hot = [];
    for (const n of needles) {
      if (inText(n.x, n.y)) continue;
      const dx = n.x - magnet.x, dy = n.y - magnet.y;
      const d = Math.hypot(dx, dy);
      const near = Math.exp(-(d * d) / (reach * reach)); // 0..1
      // campo ambiente: ondas lentas; perto do ímã domina o dipolo
      const amb = Math.sin(n.x * 0.006 + now * 0.00008) * 1.4 + Math.cos(n.y * 0.007 - now * 0.00006) * 1.1;
      const tgt = dipole(dx, dy);
      const aim = amb + wrap(tgt - amb) * Math.min(1, near * 1.6);
      n.a += wrap(aim - n.a) * (still ? 1 : 0.07);
      n.t = near;
      const len = gap * (0.34 + 0.34 * near);
      (near > 0.12 ? hot : base).push([n, len]);
    }

    ctx.lineWidth = 1.4;
    ctx.strokeStyle = `rgba(${colors.ink}, .30)`;
    ctx.beginPath();
    for (const [n, len] of base) seg(n, len);
    ctx.stroke();

    // agulhas próximas ao ímã: uma passada por faixa de intensidade
    for (let band = 0; band < 4; band++) {
      const lo = 0.12 + band * 0.22, hi = lo + 0.22;
      ctx.strokeStyle = `rgba(${colors.hot}, ${0.35 + band * 0.2})`;
      ctx.lineWidth = 1.4 + band * 0.25;
      ctx.beginPath();
      for (const [n, len] of hot) if (n.t >= lo && n.t < hi + (band === 3 ? 1 : 0)) seg(n, len);
      ctx.stroke();
    }
  }
  function seg(n, len) {
    const c = Math.cos(n.a) * len / 2, s = Math.sin(n.a) * len / 2;
    ctx.moveTo(n.x - c, n.y - s);
    ctx.lineTo(n.x + c, n.y + s);
  }

  function loop(now) {
    if (!running) return;
    draw(now, false);
    raf = requestAnimationFrame(loop);
  }
  function start() { if (running || reduce || !visible || document.hidden) return; running = true; raf = requestAnimationFrame(loop); }
  function stop() { running = false; cancelAnimationFrame(raf); }

  function move(e) {
    const r = canvas.getBoundingClientRect();
    target.x = e.clientX - r.left; target.y = e.clientY - r.top;
    pointerAt = performance.now();
  }
  if (!reduce) {
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerdown', move, { passive: true });
  }

  new IntersectionObserver(([e]) => { visible = e.isIntersecting; visible ? start() : stop(); }).observe(canvas);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { colors = rgb(); if (!running) draw(performance.now(), true); });

  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { resize(); }, 120); });

  resize();
  start();
  // as fontes mudam o tamanho do texto depois de carregar
  document.fonts?.ready.then(() => { measureClear(); if (!running) draw(performance.now(), true); });
})();
