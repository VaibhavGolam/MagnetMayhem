'use strict';
(() => {
  // ====================================================================
  //  MAGNET MAYHEM
  //  Infinite procedurally generated world, streamed in 520-unit chunks.
  //  Fixed 120 Hz physics step, rendering with pre-baked glow sprites.
  // ====================================================================
  const TAU = Math.PI * 2, CH = 520, STEP = 1 / 120;
  const $ = id => document.getElementById(id);
  const cv = $('c'), ctx = cv.getContext('2d');
  let W = 1, H = 1, DPR = 1, S = 1;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth || 420; H = window.innerHeight || 800;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    S = Math.min(W, H) / 420;
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------------------------------------------------------------- tuning
  const BASE_R = 240;        // magnet influence range
  const FORCE = 1700;        // magnet pull/push strength (units/s^2)
  const BLACK_FORCE = 2300;
  const MAX_SPEED = 650;
  const DRAG = 0.35;         // per second
  const COLORS = { blue: '#2f8cff', red: '#ff3355', purple: '#b44cff', gold: '#ffb000', black: '#7a3cff', haz: '#ff8a1f', coin: '#ffe98a' };

  // ------------------------------------------------------------------ utils
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const fmt = n => Math.floor(n).toLocaleString('en-US');
  function hash(a, b, c) {
    let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function mulberry(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function strSeed(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };

  // ----------------------------------------------------------- persistence
  const DEF = { best: 0, games: 0, coins: 0, inter: 0, maxCombo: 0, ach: {}, skin: 'classic', top: [], daily: { date: '', best: 0 },
    tutDone: false, snd: true, mus: true, vib: true };
  const st = Object.assign({}, DEF, Store.get('stats', {}));
  const save = () => Store.set('stats', st);

  const SKINS = [
    { id: 'classic', name: 'CLASSIC', c: '#aee4ff', t: '#2f8cff', how: 'Free', ok: () => true },
    { id: 'plasma', name: 'PLASMA', c: '#f0b6ff', t: '#b44cff', how: 'Best score 2,000', ok: s => s.best >= 2000 },
    { id: 'neon', name: 'NEON', c: '#c8ffbf', t: '#2cff7a', how: 'Play 10 games', ok: s => s.games >= 10 },
    { id: 'fire', name: 'FIRE', c: '#ffd9a0', t: '#ff5a1f', how: 'Collect 500 coins', ok: s => s.coins >= 500 },
    { id: 'ice', name: 'ICE', c: '#ffffff', t: '#7fe3ff', how: 'Reach combo x8', ok: s => s.maxCombo >= 8 },
    { id: 'galaxy', name: 'GALAXY', c: '#cfc6ff', t: '#ff5bd6', how: 'Best score 8,000', ok: s => s.best >= 8000 },
    { id: 'hole', name: 'BLACK HOLE', c: '#14141f', t: '#ffffff', dark: true, how: 'Unlock 5 achievements', ok: () => achCount() >= 5 }
  ];
  const ACH = [
    { id: 'flight', name: 'FIRST FLIGHT', desc: 'Survive 30 seconds' },
    { id: 'master', name: 'MAGNET MASTER', desc: 'Perform 100 magnetic interactions' },
    { id: 'untouch', name: 'UNTOUCHABLE', desc: 'Survive 2 minutes without taking damage' },
    { id: 'chain', name: 'CHAIN REACTION', desc: 'Reach x10 combo' },
    { id: 'mayhem', name: 'MAYHEM', desc: 'Score 10,000 points' },
    { id: 'god', name: 'MAGNET GOD', desc: 'Score 100,000 points' }
  ];
  const achCount = () => Object.keys(st.ach).length;
  const skin = () => SKINS.find(s => s.id === st.skin) || SKINS[0];

  // --------------------------------------------------------------- state
  let state = 'menu';                 // menu | play | tutorial | over | paused
  let run = null;
  const P = { x: 0, y: 0, vx: 0, vy: 0, r: 11 };
  const cam = { x: 0, y: 0 };
  let mags = [], haz = [], walls = [], coins = [], pups = [];
  const genned = new Set();
  const texts = [];
  const trail = [];
  let holdL = false, holdR = false;
  const ptr = new Map();
  let shake = 0, flashA = 0, flashC = '#fff', menuT = 0, overAt = 0;

  // particle pool (preallocated, never garbage collected during play)
  const PN = 450;
  const parts = [];
  for (let i = 0; i < PN; i++) parts.push({ a: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, s: 2, c: '#fff' });
  let pi = 0;
  function spark(x, y, color, n, spd, size) {
    for (let i = 0; i < n; i++) {
      const p = parts[pi]; pi = (pi + 1) % PN;
      const a = Math.random() * TAU, v = spd * (0.3 + Math.random() * 0.7);
      p.a = true; p.x = x; p.y = y; p.vx = Math.cos(a) * v; p.vy = Math.sin(a) * v;
      p.life = p.max = 0.35 + Math.random() * 0.4; p.s = size * (0.6 + Math.random() * 0.8); p.c = color;
    }
  }
  function pop(x, y, text, color) {
    if (texts.length > 14) texts.shift();
    texts.push({ x, y, text, color: color || '#fff', t: 0 });
  }

  // ------------------------------------------------------- glow sprites
  const glowCache = {};
  function glowSprite(color) {
    if (glowCache[color]) return glowCache[color];
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, color + 'ff'); gr.addColorStop(0.3, color + '77'); gr.addColorStop(1, color + '00');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    glowCache[color] = c; return c;
  }

  // ----------------------------------------------------------- world gen
  const tierFor = sc => (sc < 500 ? 0 : sc < 1500 ? 1 : sc < 3000 ? 2 : sc < 5000 ? 3 : 4);

  function newRun(o) {
    o = o || {};
    run = {
      seed: o.seed != null ? o.seed : (Math.random() * 4294967296) >>> 0,
      daily: !!o.daily, tut: o.tut ? 0 : -1, tutT: 0, t: 0, score: 0, combo: 0, comboT: 0, maxCombo: 0, energy: 100,
      stall: 0, inter: 0, coinN: 0, streak: 0, damaged: false, shield: false, over: false, revived: false,
      tier: 0, freeze: 0, ghost: 0, over_: 0, storm: 0, surge: 0, chaos: 0, rush: 0, rushT: 0, swap: false, swapT: 0,
      nextEvent: 28, ht: 0, invuln: 0, trailT: 0, chunkT: 0, reason: '', hint: '', ach30: false
    };
    mags = []; haz = []; walls = []; coins = []; pups = []; genned.clear(); trail.length = 0; texts.length = 0;
    for (const p of parts) p.a = false;
    P.x = 0; P.y = 0; P.vx = 0; P.vy = -70;
    cam.x = 0; cam.y = 0; shake = 0;
    if (!o.tut) streamChunks(true);
  }

  function genChunk(cx, cy) {
    const key = cx + ',' + cy;
    if (genned.has(key)) return;
    genned.add(key);
    const r = mulberry(hash(run.seed, cx, cy));
    const tier = run.tier, ox = cx * CH, oy = cy * CH, start = cx === 0 && cy === 0;
    const placed = [];
    const free = (x, y, rad) => { for (const o of placed) if (Math.hypot(o.x - x, o.y - y) < o.r + rad) return false; return true; };
    const place = (rad, safeStart) => {
      for (let i = 0; i < 24; i++) {
        const x = ox + (r() - 0.5) * (CH - 70), y = oy + (r() - 0.5) * (CH - 70);
        if (safeStart && start && Math.hypot(x, y) < 190 + rad) continue;
        if (free(x, y, rad)) { placed.push({ x, y, r: rad }); return { x, y }; }
      }
      return null;
    };
    // magnets
    const nMag = 2 + ((r() * 2) | 0) + (tier >= 1 ? 1 : 0) + (tier >= 3 ? 1 : 0);
    for (let i = 0; i < nMag; i++) {
      const roll = r() * 100;
      let type = 'blue';
      const wB = 36, wR = 30, wG = 5, wP = tier >= 1 ? 14 : 0, wK = tier >= 1 ? (tier >= 3 ? 9 : 5) : 0;
      const tot = wB + wR + wG + wP + wK, x = roll / 100 * tot;
      if (x < wB) type = 'blue'; else if (x < wB + wR) type = 'red'; else if (x < wB + wR + wG) type = 'gold';
      else if (x < wB + wR + wG + wP) type = 'purple'; else type = 'black';
      const pos = place(type === 'black' ? 130 : 85, type === 'black');
      if (!pos) continue;
      mags.push({ x: pos.x, y: pos.y, type, r: type === 'black' ? 20 : type === 'gold' ? 13 : 15, R: type === 'black' ? 150 : BASE_R,
        mode: type === 'red' ? 'R' : type === 'purple' ? (r() < 0.5 ? 'A' : 'R') : 'A', timer: 2.5 + r() * 1.5,
        eng: 0, engTotal: 0, cool: 0, swing: 0, lastAng: null, was: false, ck: key });
    }
    // hazards (count grows with tier, always spaced so gaps stay passable)
    const nH = Math.floor(0.4 + r() * 1.3 + tier * 0.6);
    for (let i = 0; i < nH; i++) {
      const moving = tier >= 2 && r() < 0.5;
      const kind = !moving ? 'spike' : (r() < 0.5 ? 'slide' : 'orbit');
      const rad = 14 + r() * 7;
      const reach = kind === 'spike' ? rad : kind === 'slide' ? rad + 100 : rad + 90;
      const pos = place(reach + 20, true);
      if (!pos) continue;
      haz.push({ kind, x: pos.x, y: pos.y, cx: pos.x, cy: pos.y, r: rad, reach, amp: 70 + r() * 40, sp: 0.8 + r() * 0.7,
        ph: r() * TAU, axis: r() < 0.5 ? 0 : 1, orad: 60 + r() * 30, dir: r() < 0.5 ? -1 : 1, rot: r() * TAU, nm: false, ck: key });
    }
    // walls: single bars, plus gates (two bars with a 100 unit gap) at higher tiers
    if (r() < 0.45) {
      const pos = place(90, true);
      if (pos) { const horiz = r() < 0.5; walls.push({ x: pos.x, y: pos.y, w: horiz ? 110 + r() * 60 : 14, h: horiz ? 14 : 110 + r() * 60, ck: key }); }
    }
    if (tier >= 2 && r() < 0.35) {
      const pos = place(130, true);
      if (pos) {
        const horiz = r() < 0.5, len = 120;
        if (horiz) { walls.push({ x: pos.x - 50 - len / 2, y: pos.y, w: len, h: 14, ck: key }, { x: pos.x + 50 + len / 2, y: pos.y, w: len, h: 14, ck: key }); }
        else { walls.push({ x: pos.x, y: pos.y - 50 - len / 2, w: 14, h: len, ck: key }, { x: pos.x, y: pos.y + 50 + len / 2, w: 14, h: len, ck: key }); }
        for (let k = -1; k <= 1; k++) coins.push({ x: horiz ? pos.x + k * 30 : pos.x, y: horiz ? pos.y : pos.y + k * 30, r: 7, ck: key });
      }
    }
    // coins: rings around magnets (so swinging collects them) plus the odd straight line
    const coinOk = (x, y) => {
      for (const h of haz) if (Math.hypot(x - h.cx, y - h.cy) < h.reach + 14) return false;
      for (const w of walls) if (Math.abs(x - w.x) < w.w / 2 + 14 && Math.abs(y - w.y) < w.h / 2 + 14) return false;
      for (const m of mags) if (m.type === 'black' && Math.hypot(x - m.x, y - m.y) < 70) return false;
      return true;
    };
    for (const m of mags.filter(q => q.ck === key && (q.type === 'blue' || q.type === 'red' || q.type === 'purple'))) {
      if (r() > 0.55) continue;
      const n = 6 + ((r() * 3) | 0), rad = 55 + r() * 35, a0 = r() * TAU;
      for (let i = 0; i < n; i++) {
        const x = m.x + Math.cos(a0 + i * TAU / n) * rad, y = m.y + Math.sin(a0 + i * TAU / n) * rad;
        if (coinOk(x, y)) coins.push({ x, y, r: 7, ck: key });
      }
    }
    if (r() < 0.6) {
      const p = place(60, false);
      if (p) { const a = r() * TAU; for (let i = -2; i <= 2; i++) { const x = p.x + Math.cos(a) * i * 28, y = p.y + Math.sin(a) * i * 28; if (coinOk(x, y)) coins.push({ x, y, r: 7, ck: key }); } }
    }
    // power-ups are rare
    if (!start && r() < 0.1) {
      const p = place(40, true);
      if (p) pups.push({ x: p.x, y: p.y, type: ['over', 'shield', 'freeze', 'storm', 'ghost'][(r() * 5) | 0], r: 13, ck: key });
    }
  }

  function streamChunks(force) {
    const pcx = Math.round(P.x / CH), pcy = Math.round(P.y / CH);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) genChunk(pcx + dx, pcy + dy);
    if (force) return;
    // unload everything far away
    const far = o => { if (o.ck === 'tut' || o.ck === 'ev') return false; const [a, b] = o.ck.split(','); return Math.abs(+a - pcx) > 2 || Math.abs(+b - pcy) > 2; };
    mags = mags.filter(o => !far(o)); haz = haz.filter(o => !far(o)); walls = walls.filter(o => !far(o));
    coins = coins.filter(o => !far(o)); pups = pups.filter(o => !far(o));
  }

  // ----------------------------------------------------------- tutorial
  const TUT = [
    { text: 'BLUE ATTRACTS', hint: 'HOLD THE LEFT SIDE', color: COLORS.blue },
    { text: 'RED REPELS', hint: 'HOLD THE RIGHT SIDE', color: COLORS.red },
    { text: 'COMBINE THEM', hint: 'COLLECT 3 COINS USING BOTH', color: '#cfd6ff' },
    { text: "DON'T GET CRUSHED", hint: 'SURVIVE 4 SECONDS', color: COLORS.haz }
  ];
  const tm = (x, y, type) => mags.push({ x, y, type, r: 15, R: BASE_R, mode: type === 'red' ? 'R' : 'A', timer: 9, eng: 0, engTotal: 0, cool: 0, swing: 0, lastAng: null, was: false, ck: 'tut' });
  function tutSetup(step) {
    run.tut = step; run.tutT = 0; run.tutCoins = 0;
    mags = []; haz = []; walls = []; coins = []; pups = [];
    P.x = 0; P.y = 100; P.vx = 0; P.vy = 0; trail.length = 0;
    if (step === 0) tm(0, -130, 'blue');
    if (step === 1) tm(0, -30, 'red');
    if (step === 2) {
      tm(-110, -110, 'blue'); tm(110, -40, 'red');
      [[-60, -70], [0, -130], [60, -90]].forEach(c => coins.push({ x: c[0], y: c[1], r: 7, ck: 'tut' }));
    }
    if (step === 3) {
      tm(0, -200, 'blue');
      haz.push({ kind: 'slide', x: 0, y: -50, cx: 0, cy: -50, r: 17, reach: 160, amp: 110, sp: 1.2, ph: 0, axis: 0, orad: 0, dir: 1, rot: 0, nm: false, ck: 'tut' });
    }
    $('tutText').textContent = TUT[step].text; $('tutText').style.color = TUT[step].color;
    $('tutHint').textContent = TUT[step].hint;
    Sfx.click();
  }

  // ------------------------------------------------------------- scoring
  const mult = () => clamp(Math.max(1, run.combo) + Math.min(5, Math.floor(run.t / 15)), 1, 30);
  function addScore(base, x, y, label, color) {
    const v = base * mult(); run.score += v;
    if (label) pop(x, y, label + ' +' + fmt(v), color);
  }
  function bumpCombo(x, y) {
    run.combo++; run.comboT = 6; run.inter++;
    if (run.combo > run.maxCombo) run.maxCombo = run.combo;
    Sfx.combo(run.combo);
    if (run.combo >= 5) { shake = Math.max(shake, 3); }
    if (run.combo % 5 === 0) { flashA = 0.25; flashC = run.combo >= 10 ? '#ff7a3d' : '#ffd23f'; spark(P.x, P.y, '#ffd23f', 24, 260, 3); vibrate(15); }
  }
  function loseCombo(msg) {
    if (run.combo > 1 && msg) pop(P.x, P.y - 30, msg, '#ff8a8a');
    run.combo = 0; run.comboT = 0;
  }
  function vibrate(ms) { if (st.vib && navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) { /* ignore */ } } }

  // ------------------------------------------------------------- physics
  function forces(dt) {
    const r = run;
    const od = r.over_ > 0 ? 2 : 1, sg = r.surge > 0 ? 1.5 : 1, tb = 1 + 0.08 * Math.min(r.tier, 4);
    const aHeld = r.swap ? holdR : holdL, rHeld = r.swap ? holdL : holdR;
    let ax = 0, ay = 0, hum = 0;
    for (const m of mags) {
      if (m.type === 'gold') continue;
      const dx = m.x - P.x, dy = m.y - P.y, d = Math.hypot(dx, dy);
      const R = m.R * (od > 1 && m.type !== 'black' ? 1.25 : 1);
      let f = 0, dir = 0;
      if (d > 0.5 && d < R) {
        const fall = Math.pow(1 - d / R, m.type === 'black' ? 1.5 : 1.4);
        if (m.type === 'black') { dir = 1; f = BLACK_FORCE * fall * (d < 90 ? 2.2 : 1) * (m.bh ? 0.8 : 1); }
        else if (m.mode === 'A' && aHeld) { dir = 1; f = FORCE * fall * od * sg * tb; }
        else if (m.mode === 'R' && rHeld) { dir = -1; f = FORCE * fall * od * sg * tb; }
      }
      const engaged = f > 0 && m.type !== 'black';
      if (f > 0) { ax += dx / d * dir * f; ay += dy / d * dir * f; }
      if (engaged) {
        if (dir > 0) hum = Math.max(hum, 1 - d / R);
        if (!m.was) { if (dir < 0) { Sfx.boom(1 - d / R); shake = Math.max(shake, 4); } spark(P.x, P.y, dir > 0 ? COLORS.blue : COLORS.red, 8, 160, 2.5); }
        m.eng += dt; m.engTotal += dt;
        if (m.eng > 0.3 && m.cool <= 0) {
          m.cool = 1.5; m.eng = 0;
          if (r.tut < 0) { bumpCombo(); addScore(5, m.x, m.y - 24, '', '#fff'); }
          else Sfx.combo(2);
        }
        // swing detection: accumulated angle around a magnet while engaged = slingshot
        const ang = Math.atan2(P.y - m.y, P.x - m.x);
        if (m.lastAng !== null) {
          let da = ang - m.lastAng; if (da > Math.PI) da -= TAU; if (da < -Math.PI) da += TAU;
          m.swing += da;
          if (Math.abs(m.swing) > Math.PI * 0.9 && Math.hypot(P.vx, P.vy) > 180) {
            m.swing = 0;
            if (r.tut < 0) { addScore(50, m.x, m.y - 24, 'SLINGSHOT', '#7fe3ff'); r.comboT = 6; }
            Sfx.slingshot(); spark(P.x, P.y, '#7fe3ff', 20, 280, 3); flashA = 0.12; flashC = '#7fe3ff';
          }
        }
        m.lastAng = ang;
      } else { m.eng = Math.max(0, m.eng - dt * 2); m.swing = 0; m.lastAng = null; }
      m.was = engaged;
    }
    P.vx += ax * dt; P.vy += ay * dt;
    const sp = Math.hypot(P.vx, P.vy);
    Sfx.hum(hum, sp);
    return sp;
  }

  function die(reason, hint) {
    const r = run;
    if (r.over || r.invuln > 0) return;
    if (r.tut >= 0) { tutSetup(r.tut); pop(P.x, P.y, 'TRY AGAIN', '#ff8a8a'); return; }
    if (r.shield) {
      r.shield = false; r.invuln = 1.2; r.damaged = true; loseCombo('SHIELD BROKE');
      spark(P.x, P.y, '#7fe3ff', 40, 340, 3.5); shake = 8; Sfx.death(); vibrate(40);
      // bounce away from whatever hit us
      P.vx *= -0.6; P.vy *= -0.6; return;
    }
    r.over = true; r.reason = reason; r.hint = hint;
    spark(P.x, P.y, skin().t, 60, 420, 4); spark(P.x, P.y, '#ffffff', 25, 300, 3);
    shake = 14; flashA = 0.5; flashC = '#ff3355'; Sfx.death(); Sfx.hum(0, 0); vibrate(120);
    finishRun();
  }

  function update(dt) {
    const r = run;
    r.t += dt;
    const ts = r.freeze > 0 ? 0.3 : 1, wdt = dt * ts;
    if (r.tut < 0) r.tier = tierFor(r.score);
    // timers
    for (const k of ['freeze', 'ghost', 'over_', 'storm', 'surge', 'chaos', 'rush', 'invuln']) if (r[k] > 0) r[k] = Math.max(0, r[k] - dt);
    if (r.tut < 0) {
      // chunk streaming ~10x per second
      r.chunkT -= dt; if (r.chunkT <= 0) { r.chunkT = 0.1; streamChunks(false); }
      r.energy -= dt * (3.2 + r.tier * 0.6);
      if (r.energy <= 0) { r.energy = 0; die('OUT OF ENERGY', 'Collect coins to keep your charge up'); return; }
      // events
      r.nextEvent -= dt;
      if (r.nextEvent <= 0 && r.t > 25) { startEvent(); r.nextEvent = 25 + Math.random() * 15; }
      if (r.chaos > 0) { r.swapT -= dt; if (r.swapT <= 0) { r.swap = !r.swap; r.swapT = 1.4 + Math.random() * 0.8; Sfx.click(); } } else r.swap = false;
      if (r.rush > 0) { r.rushT -= dt; if (r.rushT <= 0) { r.rushT = 0.09; spawnRushCoin(); } }
      // survival achievements
      if (r.t >= 30 && !r.ach30) { r.ach30 = true; unlock('flight'); }
      if (r.t >= 120 && !r.damaged) unlock('untouch');
      if (r.combo >= 10) unlock('chain'); if (r.score >= 10000) unlock('mayhem'); if (r.score >= 100000) unlock('god');
      if (st.inter + r.inter >= 100) unlock('master');
    }
    // purple flips + cooldowns
    r.ht += wdt;
    for (let i = mags.length - 1; i >= 0; i--) {
      const m = mags[i];
      m.cool -= dt;
      if (m.type === 'purple') { m.timer -= wdt; if (m.timer <= 0) { m.mode = m.mode === 'A' ? 'R' : 'A'; m.timer = 2.5 + Math.random() * 1.5; } }
      if (m.bh) { m.life -= dt; if (m.life <= 0) mags.splice(i, 1); }
    }
    // moving hazards
    for (const h of haz) {
      if (h.kind === 'slide') { const o = Math.sin(r.ht * h.sp + h.ph) * h.amp; if (h.axis === 0) { h.x = h.cx + o; h.y = h.cy; } else { h.x = h.cx; h.y = h.cy + o; } }
      else if (h.kind === 'orbit') { const a = r.ht * h.sp * h.dir + h.ph; h.x = h.cx + Math.cos(a) * h.orad; h.y = h.cy + Math.sin(a) * h.orad; }
      h.rot += wdt * 1.5;
    }
    // forces + integration
    let sp = forces(dt);
    const dm = Math.exp(-DRAG * dt);
    P.vx *= dm; P.vy *= dm;
    sp = Math.hypot(P.vx, P.vy);
    if (sp > MAX_SPEED) { P.vx *= MAX_SPEED / sp; P.vy *= MAX_SPEED / sp; sp = MAX_SPEED; }
    P.x += P.vx * dt; P.y += P.vy * dt;

    // wall bounce
    if (r.ghost <= 0) {
      for (const w of walls) {
        const nx = clamp(P.x, w.x - w.w / 2, w.x + w.w / 2), ny = clamp(P.y, w.y - w.h / 2, w.y + w.h / 2);
        let dx = P.x - nx, dy = P.y - ny, d = Math.hypot(dx, dy);
        if (d < P.r) {
          if (d < 0.001) { dx = 0; dy = -1; d = 1; }
          const ux = dx / d, uy = dy / d;
          P.x = nx + ux * P.r; P.y = ny + uy * P.r;
          const vn = P.vx * ux + P.vy * uy;
          if (vn < 0) { P.vx -= 1.7 * vn * ux; P.vy -= 1.7 * vn * uy; if (-vn > 120) { spark(P.x, P.y, '#aab4ff', 6, 120, 2); Sfx.coin(0); shake = Math.max(shake, 2); } }
        }
      }
    }
    // magnet bodies (bounce) + gold pickup + black core
    for (let i = mags.length - 1; i >= 0; i--) {
      const m = mags[i];
      const dx = P.x - m.x, dy = P.y - m.y, d = Math.hypot(dx, dy);
      if (m.type === 'gold') {
        if (d < m.r + P.r + 4) {
          mags.splice(i, 1); if (r.tut < 0) { addScore(50, m.x, m.y, 'GOLD', COLORS.gold); r.energy = Math.min(100, r.energy + 25); r.comboT = 6; }
          spark(m.x, m.y, COLORS.gold, 26, 260, 3); Sfx.power(); vibrate(15);
        }
      } else if (m.type === 'black') {
        if (d < m.r + P.r * 0.6 && r.ghost <= 0) { die('SWALLOWED BY A BLACK MAGNET', 'Black magnets pull hard. Use RED to push away early'); if (r.over) return; }
      } else if (d < m.r + P.r && d > 0.001) {
        const ux = dx / d, uy = dy / d;
        P.x = m.x + ux * (m.r + P.r); P.y = m.y + uy * (m.r + P.r);
        const vn = P.vx * ux + P.vy * uy;
        if (vn < 0) { P.vx -= 1.6 * vn * ux; P.vy -= 1.6 * vn * uy; }
        if (-vn > 100) spark(P.x, P.y, '#ffffff', 5, 120, 2);
      }
    }
    // hazards
    if (r.ghost <= 0) {
      for (const h of haz) {
        const d = Math.hypot(P.x - h.x, P.y - h.y);
        if (d < P.r + h.r * 0.85) { die('HIT A SPIKE', 'Spikes are deadly. Push away with RED or swing wide'); if (r.over) return; break; }
        if (!h.nm && d < P.r + h.r + 16 && r.tut < 0) { h.nm = true; addScore(25, h.x, h.y - 20, 'NEAR MISS', '#ff8a1f'); r.comboT = 6; Sfx.slingshot(); }
      }
    }
    // coins (storm pulls them in)
    const stormR = r.storm > 0 ? 230 : 0;
    const bh = mags.find(m => m.bh);
    for (let i = coins.length - 1; i >= 0; i--) {
      const c = coins[i];
      let dx = P.x - c.x, dy = P.y - c.y, d = Math.hypot(dx, dy);
      if (stormR && d < stormR && d > 1) { c.x += dx / d * 620 * dt; c.y += dy / d * 620 * dt; dx = P.x - c.x; dy = P.y - c.y; d = Math.hypot(dx, dy); }
      if (bh) { const bx = bh.x - c.x, by = bh.y - c.y, bd = Math.hypot(bx, by); if (bd < 380 && bd > 5) { c.x += bx / bd * 90 * dt; c.y += by / bd * 90 * dt; } }
      if (c.life !== undefined) { c.life -= dt; if (c.life <= 0) { coins.splice(i, 1); continue; } }
      if (d < P.r + c.r + 3) {
        coins.splice(i, 1);
        if (r.tut >= 0) { r.tutCoins++; Sfx.coin(r.tutCoins); }
        else { r.coinN++; r.streak++; addScore(10, c.x, c.y, '', '#fff'); r.energy = Math.min(100, r.energy + 7); r.comboT = Math.max(r.comboT, 4); Sfx.coin(r.streak); }
        spark(c.x, c.y, COLORS.coin, 6, 150, 2);
      }
    }
    // power-ups
    for (let i = pups.length - 1; i >= 0; i--) {
      const p = pups[i];
      if (Math.hypot(P.x - p.x, P.y - p.y) < P.r + p.r + 3) {
        pups.splice(i, 1); applyPower(p.type, p.x, p.y);
      }
    }
    // combo decay
    if (r.tut < 0) {
      if (sp < 45) { r.stall += dt; if (r.stall > 2.5 && r.combo > 0) { loseCombo('COMBO LOST'); r.stall = 0; } } else r.stall = 0;
      if (r.combo > 0) { r.comboT -= dt; if (r.comboT <= 0) loseCombo('COMBO LOST'); }
      r.score += dt * 4;             // small survival trickle
    } else tutProgress(dt);
    // trail
    r.trailT -= dt;
    if (r.trailT <= 0) { r.trailT = 0.018; trail.push({ x: P.x, y: P.y }); if (trail.length > 16) trail.shift(); }
    // camera: closer lookahead as tier rises
    const look = 0.12 + 0.02 * r.tier;
    const tx = P.x + P.vx * look, ty = P.y + P.vy * look, k = Math.min(1, dt * 6);
    cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k;
  }

  function tutProgress(dt) {
    const r = run, s = r.tut;
    if (s === 0 && mags[0] && mags[0].engTotal > 0.5) nextTut();
    else if (s === 1 && mags[0] && mags[0].engTotal > 0.4) nextTut();
    else if (s === 2 && r.tutCoins >= 3) nextTut();
    else if (s === 3) { r.tutT += dt; if (r.tutT > 4) nextTut(); }
    if (s <= 2 && Math.hypot(P.x, P.y) > 700) tutSetup(s);   // drifted off, reset
  }
  function nextTut() {
    Sfx.power();
    if (run.tut >= 3) { st.tutDone = true; save(); startRun({}); return; }
    tutSetup(run.tut + 1);
  }

  // ------------------------------------------------------ powerups/events
  const PU = { over: ['OVERDRIVE', '#ff4bd8'], shield: ['SHIELD', '#7fe3ff'], freeze: ['TIME FREEZE', '#b8e6ff'], storm: ['MAGNET STORM', '#3dff7a'], ghost: ['GHOST', '#ffffff'] };
  function applyPower(type, x, y) {
    const r = run;
    if (type === 'over') r.over_ = 5; else if (type === 'shield') r.shield = true; else if (type === 'freeze') r.freeze = 3;
    else if (type === 'storm') r.storm = 6; else if (type === 'ghost') r.ghost = 4;
    Sfx.power(); spark(x, y, PU[type][1], 22, 240, 3); showBanner(PU[type][0], PU[type][1]); vibrate(20);
  }
  function startEvent() {
    const r = run, e = ['surge', 'chaos', 'blackhole', 'rush'][(Math.random() * 4) | 0];
    Sfx.event();
    if (e === 'surge') { r.surge = 8; showBanner('MAGNET STORM', '#ffd23f'); }
    else if (e === 'chaos') { r.chaos = 8; r.swapT = 1; showBanner('POLARITY CHAOS', '#b44cff'); }
    else if (e === 'rush') { r.rush = 5; showBanner('COIN RUSH', COLORS.coin); }
    else {
      const a = Math.random() * TAU;
      mags.push({ x: P.x + Math.cos(a) * 320, y: P.y + Math.sin(a) * 320, type: 'black', bh: true, life: 9, r: 22, R: 380, mode: 'A', timer: 0, eng: 0, engTotal: 0, cool: 0, swing: 0, lastAng: null, was: false, ck: 'ev' });
      showBanner('BLACK HOLE', '#7a3cff');
    }
  }
  function spawnRushCoin() {
    const sp = Math.hypot(P.vx, P.vy);
    let ux = sp > 40 ? P.vx / sp : Math.cos(run.t), uy = sp > 40 ? P.vy / sp : Math.sin(run.t);
    const px = -uy, py = ux, w = Math.sin(run.t * 4) * 70;
    coins.push({ x: P.x + ux * 340 + px * w, y: P.y + uy * 340 + py * w, r: 7, ck: 'ev', life: 7 });
  }

  // --------------------------------------------------------------- flow
  function unlock(id) {
    if (st.ach[id]) return;
    st.ach[id] = true; save();
    const a = ACH.find(x => x.id === id);
    toast('ACHIEVEMENT: ' + a.name); Sfx.power();
  }
  function toast(t) {
    const el = $('toast'); el.textContent = t; el.classList.add('show');
    clearTimeout(toast.h); toast.h = setTimeout(() => el.classList.remove('show'), 2200);
  }
  function showBanner(t, c) {
    const b = $('banner'); b.textContent = t; b.style.color = c; b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  }

  function finishRun() {
    const r = run;
    const sc = Math.floor(r.score);
    const isNew = sc > st.best;
    st.games++; st.coins += r.coinN; st.inter += r.inter; st.maxCombo = Math.max(st.maxCombo, r.maxCombo);
    if (isNew) st.best = sc;
    st.top.push(sc); st.top.sort((a, b) => b - a); st.top = st.top.slice(0, 10);
    let dailyBest = null;
    if (r.daily) {
      if (st.daily.date !== today()) st.daily = { date: today(), best: 0 };
      if (sc > st.daily.best) st.daily.best = sc;
      dailyBest = st.daily.best;
    }
    save();
    r.final = sc; r.isNew = isNew; r.dailyBest = dailyBest;
    state = 'over'; overAt = performance.now();
    setTimeout(() => { if (state === 'over') showOver(); }, 450);
  }

  function showOver() {
    const r = run;
    hideAll(); $('hud').classList.add('hidden');
    $('oReason').innerHTML = r.reason + '<small>' + r.hint + '</small>';
    $('oScore').textContent = fmt(r.final); $('oBest').textContent = fmt(st.best);
    $('oNew').classList.toggle('hidden', !r.isNew);
    const od = $('oDaily');
    if (r.daily) { od.classList.remove('hidden'); od.innerHTML = 'DAILY BEST <b>' + fmt(r.dailyBest) + '</b>'; } else od.classList.add('hidden');
    $('bRevive').classList.toggle('hidden', !(Ads.enabled && !r.revived && r.t > 15));
    $('over').classList.remove('hidden');
    Ads.banner(true);
  }

  function hideAll() { document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden')); }
  function showPanel(id) { hideAll(); $(id).classList.remove('hidden'); }

  function startRun(o) {
    hideAll(); Ads.banner(false);
    newRun(o);
    state = 'play';
    $('hud').classList.remove('hidden'); $('tutText').textContent = ''; $('tutHint').textContent = ''; $('tutSkip').classList.add('hidden');
    $('hBest').textContent = fmt(st.best);
    Sfx.resume(); Sfx.startMusic();
  }
  function startTutorial() {
    hideAll(); Ads.banner(false);
    newRun({ tut: true, seed: 12345 });
    state = 'tutorial';
    $('hud').classList.remove('hidden'); $('tutSkip').classList.remove('hidden');
    $('hBest').textContent = fmt(st.best);
    Sfx.resume(); Sfx.startMusic();
    tutSetup(0);
  }
  function toMenu() {
    state = 'menu'; run = null; mags = []; haz = []; walls = []; coins = []; pups = [];
    Sfx.hum(0, 0); Sfx.stopMusic();
    $('hud').classList.add('hidden'); $('tutSkip').classList.add('hidden');
    $('mBest').textContent = fmt(st.best);
    const dl = st.daily.date === today() ? 'TODAY\'S BEST ' + fmt(st.daily.best) : 'NEW ARENA EVERY DAY';
    $('dailyInfo').textContent = dl;
    showPanel('menu'); Ads.banner(true);
  }
  function pauseGame() {
    if (state !== 'play' && state !== 'tutorial') return;
    state = 'paused'; Sfx.hum(0, 0); showPanel('pause');
    $('pause').dataset.prev = run.tut >= 0 ? 'tutorial' : 'play';
  }
  function resumeGame() { state = $('pause').dataset.prev || 'play'; hideAll(); holdL = holdR = false; ptr.clear(); }

  function revive() {
    const r = run; r.revived = true; r.over = false; r.energy = Math.max(r.energy, 60); r.shield = true; r.invuln = 2;
    haz = haz.filter(h => Math.hypot(h.x - P.x, h.y - P.y) > 260);
    mags = mags.filter(m => m.type !== 'black' || Math.hypot(m.x - P.x, m.y - P.y) > 260);
    P.vx = 0; P.vy = 0; state = 'play'; hideAll(); $('hud').classList.remove('hidden'); Ads.banner(false);
  }

  // ------------------------------------------------------------ input
  function sideOf(x) { return x < W / 2 ? 'L' : 'R'; }
  function updateHold() {
    const v = Array.from(ptr.values());
    holdL = v.indexOf('L') >= 0; holdR = v.indexOf('R') >= 0;
    $('zL').classList.toggle('on', holdL); $('zR').classList.toggle('on', holdR);
  }
  cv.addEventListener('pointerdown', e => { Sfx.resume(); if (state === 'play' || state === 'tutorial') { ptr.set(e.pointerId, sideOf(e.clientX)); updateHold(); } e.preventDefault(); });
  cv.addEventListener('pointermove', e => { if (ptr.has(e.pointerId)) { ptr.set(e.pointerId, sideOf(e.clientX)); updateHold(); } });
  const release = e => { ptr.delete(e.pointerId); updateHold(); };
  cv.addEventListener('pointerup', release); cv.addEventListener('pointercancel', release); cv.addEventListener('pointerleave', release);
  window.addEventListener('keydown', e => { // desktop testing: A = attract, L = repel
    if (e.key === 'a' || e.key === 'ArrowLeft') { ptr.set('kA', 'L'); updateHold(); }
    if (e.key === 'l' || e.key === 'ArrowRight') { ptr.set('kL', 'R'); updateHold(); }
  });
  window.addEventListener('keyup', e => {
    if (e.key === 'a' || e.key === 'ArrowLeft') { ptr.delete('kA'); updateHold(); }
    if (e.key === 'l' || e.key === 'ArrowRight') { ptr.delete('kL'); updateHold(); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });

  const on = (id, fn) => $(id).addEventListener('click', () => { Sfx.resume(); Sfx.click(); fn(); });
  on('bPlay', () => (st.tutDone ? startRun({}) : startTutorial()));
  on('bDaily', () => startRun({ daily: true, seed: strSeed('daily-' + today()) }));
  on('bAgain', async () => {
    if (performance.now() - overAt < 350) return;
    const d = run && run.daily;
    await Ads.maybeInterstitial();
    startRun(d ? { daily: true, seed: strSeed('daily-' + today()) } : {});
  });
  on('bRevive', async () => { const ok = await Ads.rewarded(); if (ok) revive(); });
  on('bOverMenu', toMenu);
  on('bResume', resumeGame);
  on('bPauseMenu', toMenu);
  on('bSkins', () => { buildSkins(); showPanel('skins'); });
  on('bLeader', () => { buildLeader(); showPanel('leader'); });
  on('bSettings', () => { buildSettings(); showPanel('settings'); });
  on('tutSkip', () => { st.tutDone = true; save(); startRun({}); });
  on('bTut', startTutorial);
  document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => { Sfx.click(); toMenu(); }));

  function buildSkins() {
    const g = $('skinGrid'); g.innerHTML = '';
    for (const s of SKINS) {
      const ok = s.ok(st), b = document.createElement('button');
      b.className = 'skin' + (st.skin === s.id ? ' sel' : '') + (ok ? '' : ' lock');
      b.innerHTML = '<div class="ball" style="background:radial-gradient(circle at 35% 35%,' + s.c + ',' + s.t + ');box-shadow:0 0 14px ' + s.t + ';' + (s.dark ? 'border:2px solid #fff;' : '') + '"></div><div class="nm">' + s.name + '</div><div class="how">' + (ok ? (st.skin === s.id ? 'EQUIPPED' : 'TAP TO EQUIP') : '🔒 ' + s.how) + '</div>';
      b.addEventListener('click', () => { if (ok) { st.skin = s.id; save(); buildSkins(); Sfx.click(); } });
      g.appendChild(b);
    }
  }
  function buildLeader() {
    $('lDaily').textContent = fmt(st.daily.date === today() ? st.daily.best : 0);
    $('topList').innerHTML = st.top.length ? st.top.map(s => '<li>' + fmt(s) + '</li>').join('') : '<li style="color:#8b92b8">No runs yet</li>';
    $('achList').innerHTML = ACH.map(a => '<li class="' + (st.ach[a.id] ? '' : 'lock') + '"><b>' + a.name + '</b><span>' + a.desc + '</span></li>').join('');
  }
  function buildSettings() {
    const set = (id, label, key) => { const el = $(id); el.textContent = label; el.dataset.state = st[key] ? 'ON' : 'OFF'; el.classList.toggle('off', !st[key]); };
    set('tSnd', 'SOUND', 'snd'); set('tMus', 'MUSIC', 'mus'); set('tVib', 'VIBRATION', 'vib');
  }
  [['tSnd', 'snd'], ['tMus', 'mus'], ['tVib', 'vib']].forEach(([id, key]) => $(id).addEventListener('click', () => {
    st[key] = !st[key]; save(); Sfx.configure(st); buildSettings(); Sfx.click();
  }));

  // ----------------------------------------------------------- rendering
  function drawGlow(x, y, r, color, a) { ctx.globalAlpha = a; ctx.drawImage(glowSprite(color), x - r, y - r, r * 2, r * 2); }

  function render(dt) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#05060f'; ctx.fillRect(0, 0, W, H);
    menuT += dt;
    let cx = cam.x, cy = cam.y;
    if (state === 'menu') { cx = Math.cos(menuT * 0.2) * 120; cy = menuT * 18; }
    let shx = 0, shy = 0;
    if (shake > 0.1) { shx = (Math.random() - 0.5) * shake; shy = (Math.random() - 0.5) * shake; shake = Math.max(0, shake - dt * 45); }
    const ox = W / 2 - cx * S + shx, oy = H / 2 - cy * S + shy;
    const X = x => x * S + ox, Y = y => y * S + oy;

    // background dots on two parallax layers
    ctx.fillStyle = '#6b77d6';
    for (const L of [{ sp: 70, par: 0.5, a: 0.10, s: 1.4 }, { sp: 60, par: 1, a: 0.16, s: 2 }]) {
      ctx.globalAlpha = L.a;
      const g = L.sp * S, offx = (W / 2 - cx * S * L.par + shx) % g, offy = (H / 2 - cy * S * L.par + shy) % g;
      for (let x = offx - g; x < W + g; x += g) for (let y = offy - g; y < H + g; y += g) ctx.fillRect(x, y, L.s, L.s);
    }
    ctx.globalAlpha = 1;

    if (state === 'menu') { drawMenuBg(X, Y); drawFlash(dt); return; }
    if (!run) return;
    const r = run, vw = W / S / 2 + 90, vh = H / S / 2 + 90;
    const vis = (x, y, m) => Math.abs(x - cx) < vw + (m || 0) && Math.abs(y - cy) < vh + (m || 0);
    const t = performance.now() / 1000;
    const aHeld = r.swap ? holdR : holdL, rHeld = r.swap ? holdL : holdR;

    // walls
    for (const w of walls) {
      if (!vis(w.x, w.y, 100)) continue;
      ctx.fillStyle = '#1a1f4a'; ctx.strokeStyle = '#8a96ff'; ctx.lineWidth = 2;
      const x = X(w.x - w.w / 2), y = Y(w.y - w.h / 2), ww = w.w * S, hh = w.h * S;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, ww, hh, 6 * S) : ctx.rect(x, y, ww, hh); ctx.fill(); ctx.stroke();
    }
    // magnet range hints + beams
    for (const m of mags) {
      if (!vis(m.x, m.y, 260) || m.type === 'gold') continue;
      const active = m.type === 'black' ? true : (m.mode === 'A' ? aHeld : rHeld);
      if (m.type === 'black') continue;
      const col = m.mode === 'A' ? COLORS.blue : COLORS.red;
      ctx.strokeStyle = col; ctx.lineWidth = 1.5;
      ctx.globalAlpha = active ? 0.22 + 0.08 * Math.sin(t * 8) : 0.07;
      ctx.beginPath(); ctx.arc(X(m.x), Y(m.y), m.R * S, 0, TAU); ctx.stroke();
      if (active && m.was) {
        ctx.globalAlpha = 0.7; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(X(m.x), Y(m.y)); ctx.lineTo(X(P.x), Y(P.y)); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    // coins
    ctx.globalCompositeOperation = 'lighter';
    for (const c of coins) {
      if (!vis(c.x, c.y)) continue;
      drawGlow(X(c.x), Y(c.y), 16 * S, COLORS.coin, 0.7);
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    for (const c of coins) {
      if (!vis(c.x, c.y)) continue;
      const w = Math.abs(Math.cos(t * 4 + c.x * 0.05)) * 0.6 + 0.4;
      ctx.fillStyle = '#fff3b0'; ctx.beginPath(); ctx.ellipse(X(c.x), Y(c.y), c.r * S * w, c.r * S, 0, 0, TAU); ctx.fill();
    }
    // power-ups
    for (const p of pups) {
      if (!vis(p.x, p.y)) continue;
      const col = PU[p.type][1], x = X(p.x), y = Y(p.y), s = p.r * S * (1 + 0.1 * Math.sin(t * 6));
      ctx.globalCompositeOperation = 'lighter'; drawGlow(x, y, 34 * S, col, 0.8); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      ctx.fillStyle = '#0a0c20'; ctx.strokeStyle = col; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(x, y - s * 1.2); ctx.lineTo(x + s * 1.2, y); ctx.lineTo(x, y + s * 1.2); ctx.lineTo(x - s * 1.2, y); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = col; ctx.font = 'bold ' + Math.round(11 * S) + 'px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText({ over: 'O', shield: 'S', freeze: 'F', storm: 'M', ghost: 'G' }[p.type], x, y + 1);
    }
    // magnets
    for (const m of mags) {
      if (!vis(m.x, m.y, 60)) continue;
      drawMagnet(m, X(m.x), Y(m.y), t, aHeld, rHeld);
    }
    // hazards
    for (const h of haz) {
      if (!vis(h.x, h.y, 40)) continue;
      const x = X(h.x), y = Y(h.y), rr = h.r * S;
      ctx.globalCompositeOperation = 'lighter'; drawGlow(x, y, rr * 3, COLORS.haz, 0.55); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      ctx.fillStyle = '#2a1204'; ctx.strokeStyle = COLORS.haz; ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let i = 0; i < 16; i++) { const a = h.rot + i * TAU / 16, rad = i % 2 ? rr * 0.7 : rr * 1.25; ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // trail
    const sk = skin();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < trail.length; i++) {
      const k = i / trail.length;
      drawGlow(X(trail[i].x), Y(trail[i].y), (P.r * 1.6 * k + 3) * S, sk.t, 0.35 * k);
    }
    // player
    const px = X(P.x), py = Y(P.y);
    if (!(state === 'over' && r.over)) {
      drawGlow(px, py, P.r * 4.2 * S, sk.t, 0.85);
      if (r.over_ > 0) drawGlow(px, py, P.r * 6 * S, '#ff4bd8', 0.6 + 0.2 * Math.sin(t * 20));
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = r.ghost > 0 ? 0.5 : (r.invuln > 0 && ((t * 12) | 0) % 2 ? 0.4 : 1);
      const gr = ctx.createRadialGradient(px - 3 * S, py - 3 * S, 1, px, py, P.r * S);
      gr.addColorStop(0, sk.dark ? '#444' : '#ffffff'); gr.addColorStop(1, sk.c);
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(px, py, P.r * S, 0, TAU); ctx.fill();
      ctx.strokeStyle = sk.t; ctx.lineWidth = 2; ctx.stroke();
      if (r.shield) { ctx.strokeStyle = '#7fe3ff'; ctx.lineWidth = 2.5; ctx.globalAlpha = 0.8; ctx.beginPath(); ctx.arc(px, py, (P.r + 7) * S, 0, TAU); ctx.stroke(); }
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    // particles
    ctx.globalCompositeOperation = 'lighter';
    for (const p of parts) {
      if (!p.a) continue;
      p.life -= dt; if (p.life <= 0) { p.a = false; continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96;
      drawGlow(X(p.x), Y(p.y), p.s * 3.2 * S, p.c, p.life / p.max);
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    // floating texts
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = 'bold ' + Math.round(13 * S) + 'px system-ui';
    for (let i = texts.length - 1; i >= 0; i--) {
      const q = texts[i]; q.t += dt; if (q.t > 1) { texts.splice(i, 1); continue; }
      ctx.globalAlpha = 1 - q.t; ctx.fillStyle = q.color; ctx.fillText(q.text, X(q.x), Y(q.y) - q.t * 36 * S);
    }
    ctx.globalAlpha = 1;
    drawFlash(dt);
    updateHud();
  }

  function drawFlash(dt) {
    if (flashA > 0.01) { ctx.globalAlpha = flashA; ctx.fillStyle = flashC; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; flashA -= dt * 1.4; }
    // freeze tint
    if (run && run.freeze > 0) { ctx.globalAlpha = 0.08; ctx.fillStyle = '#7fe3ff'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  }

  function drawMagnet(m, x, y, t, aHeld, rHeld) {
    const rr = m.r * S;
    if (m.type === 'gold') {
      ctx.globalCompositeOperation = 'lighter'; drawGlow(x, y, rr * 4, COLORS.gold, 0.85); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffd23f'; ctx.beginPath();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + t * 1.2 + i * TAU / 10, rad = i % 2 ? rr * 0.55 : rr * 1.3; ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad); }
      ctx.closePath(); ctx.fill(); return;
    }
    if (m.type === 'black') {
      ctx.globalCompositeOperation = 'lighter'; drawGlow(x, y, rr * 5, COLORS.black, 0.6 + 0.2 * Math.sin(t * 5)); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      ctx.fillStyle = '#000'; ctx.strokeStyle = '#a074ff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 1.5; ctx.globalAlpha = 0.6;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); const a0 = t * 2 + i * TAU / 3; ctx.arc(x, y, rr * (1.6 + i * 0.3), a0, a0 + 1.4); ctx.stroke(); }
      ctx.globalAlpha = 1; return;
    }
    const col = m.type === 'purple' ? (m.mode === 'A' ? '#8a5cff' : '#e04cff') : (m.mode === 'A' ? COLORS.blue : COLORS.red);
    const active = m.mode === 'A' ? aHeld : rHeld;
    ctx.globalCompositeOperation = 'lighter'; drawGlow(x, y, rr * (active ? 5 : 3.4), col, active ? 0.95 : 0.55); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.fillStyle = '#0a0c24'; ctx.strokeStyle = col; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.fill(); ctx.stroke();
    // four arrows: pointing in = attract, out = repel
    ctx.fillStyle = col;
    const out = m.mode === 'R', spin = t * (out ? -0.8 : 0.8);
    for (let i = 0; i < 4; i++) {
      const a = spin + i * TAU / 4, c = Math.cos(a), s = Math.sin(a), d = rr * 0.62, tip = out ? rr * 0.85 : rr * 0.32, base = out ? rr * 0.38 : rr * 0.88, w = rr * 0.22;
      ctx.beginPath(); ctx.moveTo(x + c * tip, y + s * tip); ctx.lineTo(x + c * base - s * w, y + s * base + c * w); ctx.lineTo(x + c * base + s * w, y + s * base - c * w); ctx.closePath(); ctx.fill();
    }
    if (m.type === 'purple') { // countdown ring until the next flip
      ctx.strokeStyle = '#fff'; ctx.globalAlpha = 0.8; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, rr + 5 * S, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(m.timer / 4, 0, 1)); ctx.stroke(); ctx.globalAlpha = 1;
    }
  }

  function drawMenuBg(X, Y) {
    const t = menuT; const sk = skin();
    const cx = W / 2, cy = H * 0.72;
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(cx - 90 * S, cy - 40 * S, 90 * S, COLORS.blue, 0.5);
    drawGlow(cx + 100 * S, cy + 30 * S, 90 * S, COLORS.red, 0.5);
    const bx = cx + Math.cos(t * 1.4) * 100 * S, by = cy + Math.sin(t * 1.4) * 55 * S;
    drawGlow(bx, by, 50 * S, sk.t, 0.9);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.fillStyle = sk.c; ctx.beginPath(); ctx.arc(bx, by, 11 * S, 0, TAU); ctx.fill();
  }

  // HUD only touches the DOM when a value changes
  const hudCache = {};
  function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
  function updateHud() {
    const r = run;
    if (state !== 'play' && state !== 'tutorial') return;
    setText('hScore', fmt(r.score));
    const m = mult();
    setText('hCombo', 'COMBO ×' + m);
    const cb = $('hCombo'); const cls = 'combo' + (m >= 10 ? ' fire' : m >= 4 ? ' hot' : '');
    if (cb.className !== cls) cb.className = cls;
    if (r.score > st.best) setText('hBest', fmt(r.score));
    const e = $('energy');
    $('energy').style.visibility = r.tut >= 0 ? 'hidden' : 'visible';
    const w = r.energy.toFixed(0) + '%'; if (hudCache.en !== w) { hudCache.en = w; $('energyFill').style.width = w; e.classList.toggle('low', r.energy < 25); }
    // power-up chips
    const chips = [];
    if (r.shield) chips.push(['SHIELD', '#7fe3ff', '']);
    if (r.over_ > 0) chips.push(['OVERDRIVE', '#ff4bd8', r.over_.toFixed(0)]);
    if (r.freeze > 0) chips.push(['FREEZE', '#b8e6ff', r.freeze.toFixed(0)]);
    if (r.storm > 0) chips.push(['COIN MAGNET', '#3dff7a', r.storm.toFixed(0)]);
    if (r.ghost > 0) chips.push(['GHOST', '#ffffff', r.ghost.toFixed(0)]);
    const key = chips.map(c => c.join(':')).join('|');
    if (hudCache.chips !== key) {
      hudCache.chips = key;
      $('chips').innerHTML = chips.map(c => '<span class="chip" style="color:' + c[1] + '">' + c[0] + (c[2] ? ' ' + c[2] : '') + '</span>').join('');
    }
    // control labels follow polarity chaos
    const sw = r.swap ? 1 : 0;
    if (hudCache.sw !== sw) {
      hudCache.sw = sw;
      $('zL').className = 'zone ' + (sw ? 'rep' : 'atk') + (holdL ? ' on' : ''); $('zL').firstChild.textContent = sw ? 'REPEL' : 'ATTRACT';
      $('zR').className = 'zone ' + (sw ? 'atk' : 'rep') + (holdR ? ' on' : ''); $('zR').firstChild.textContent = sw ? 'ATTRACT' : 'REPEL';
    }
  }

  // ----------------------------------------------------------- main loop
  let last = 0, acc = 0;
  function frame(ts) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (ts - last) / 1000 || 0); last = ts;
    if ((state === 'play' || state === 'tutorial') && run) {
      acc += dt; let n = 0;
      while (acc >= STEP && n < 5) { update(STEP); acc -= STEP; n++; if (state !== 'play' && state !== 'tutorial') break; }
      if (n === 5) acc = 0;
    }
    render(dt);
  }

  // ----------------------------------------------------------------- boot
  function boot() {
    Sfx.configure(st);
    toMenu();
    Ads.init();
    const C = window.Capacitor && window.Capacitor.Plugins;
    if (C && C.StatusBar) { try { C.StatusBar.hide(); } catch (e) { /* ignore */ } }
    if (C && C.App) { try { C.App.addListener('appStateChange', s => { if (!s.isActive) pauseGame(); }); C.App.addListener('backButton', () => { if (state === 'play' || state === 'tutorial') pauseGame(); else if (state !== 'menu') toMenu(); else C.App.exitApp(); }); } catch (e) { /* ignore */ } }
    requestAnimationFrame(frame);
  }
  if (window.__MM_TEST) {
    window.__mm = { newRun, update, render, startRun, forces, P, get run() { return run; }, get state() { return state; }, set hold(v) { holdL = v[0]; holdR = v[1]; },
      counts: () => ({ mags: mags.length, haz: haz.length, walls: walls.length, coins: coins.length, pups: pups.length }), startTutorial, nextTut, setState: s => { state = s; } };
  } else boot();
})();
