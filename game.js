// NEON ELITE — a tribute to Elite (Braben & Bell, 1984)
// Copyright © 2026 Melvin Carvalho — AGPL-3.0-or-later
// Zero assets: every pixel and every sound is generated from code.

'use strict';
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = 1280, H = 720;
const MQ = 34, HUD_H = 150;
const VX = 0, VY = MQ, VVW = W, VVH = H - MQ - HUD_H;
const CX = VX + VVW / 2, CY = VY + VVH / 2;
const MONO = '"Courier New", monospace';
const SIMSTEP = 1 / 60;

// ---------- deterministic RNG ----------
let _seed = 1;
function srand(s) { _seed = (s >>> 0) || 1; }
function rand() {
  _seed ^= _seed << 13; _seed >>>= 0;
  _seed ^= _seed >> 17;
  _seed ^= _seed << 5; _seed >>>= 0;
  return _seed / 4294967296;
}
function rng(a, b) { return a + rand() * (b - a); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ---------- audio ----------
let AC = null, AUDIO_ON = true;
function audio() { if (!AC && AUDIO_ON) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { AUDIO_ON = false; } } }
function blip(f0, f1, dur, type, vol) {
  if (!AC || !AUDIO_ON) return;
  const t = AC.currentTime;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type || 'square';
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(28, f1), t + dur);
  g.gain.setValueAtTime(vol || 0.08, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(AC.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
function rumble(vol, dur) {
  if (!AC || !AUDIO_ON) return;
  const t = AC.currentTime;
  const len = (AC.sampleRate * dur) | 0;
  const buf = AC.createBuffer(1, len, AC.sampleRate);
  const d = buf.getChannelData(0);
  let v = 0;
  for (let i = 0; i < len; i++) { v = v * 0.97 + (Math.random() * 2 - 1) * 0.4; d[i] = v * (1 - i / len); }
  const s = AC.createBufferSource(), g = AC.createGain(), f = AC.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = 260;
  s.buffer = buf; g.gain.value = vol;
  s.connect(f); f.connect(g); g.connect(AC.destination);
  s.start(t);
}
const SFX = {
  laser: () => blip(900, 300, 0.09, 'sawtooth', 0.07),
  hitUs: () => { blip(200, 90, 0.2, 'square', 0.09); rumble(0.08, 0.2); },
  hitThem: () => blip(600, 350, 0.08, 'square', 0.05),
  boom: () => { rumble(0.16, 0.6); blip(300, 50, 0.5, 'sawtooth', 0.09); },
  missile: () => blip(400, 700, 0.25, 'sawtooth', 0.08),
  lockon: () => blip(700, 900, 0.1, 'square', 0.05),
  jump: () => { blip(100, 1200, 0.9, 'sine', 0.1); rumble(0.06, 0.9); },
  dock: () => { blip(300, 500, 0.3, 'triangle', 0.08); blip(500, 700, 0.3, 'sine', 0.06); },
  scrape: () => { rumble(0.14, 0.4); blip(150, 60, 0.35, 'sawtooth', 0.1); },
  buy: () => blip(700, 950, 0.09, 'square', 0.06),
  sell: () => { blip(950, 1250, 0.09, 'square', 0.06); },
  deny: () => blip(200, 90, 0.15, 'square', 0.06),
  warn: () => blip(880, 880, 0.12, 'square', 0.06),
  rank: () => { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, f, 0.25, 'triangle', 0.09), i * 120)); },
  win: () => { [440, 554, 659, 880, 1109].forEach((f, i) => setTimeout(() => blip(f, f * 1.01, 0.35, 'triangle', 0.1), i * 140)); },
  fail: () => { [330, 311, 262, 196].forEach((f, i) => setTimeout(() => blip(f, f * 0.98, 0.4, 'sawtooth', 0.08), i * 170)); },
};

// ---------- 3D math: vectors and the ship's orthonormal frame ----------
function v3(x, y, z) { return [x, y, z]; }
function add3(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function mul3(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function len3(a) { return Math.hypot(a[0], a[1], a[2]); }
function norm3(a) { const l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
// rotate vector v around axis u (unit) by angle t — Rodrigues
function rotAxis(v, u, t) {
  const c = Math.cos(t), s = Math.sin(t);
  return add3(add3(mul3(v, c), mul3(cross3(u, v), s)), mul3(u, dot3(u, v) * (1 - c)));
}

// ---------- the galaxy: 48 worlds spun from one seed ----------
const GALAXY_SEED = 0xE117E;
const SYL = ['la', 've', 'ti', 'so', 'ra', 'qu', 'en', 'di', 'ze', 'ar', 'us', 'be', 'xi', 'or', 'ma', 'ce'];
const GOV = ['ANARCHY', 'FEUDAL', 'MULTI-GOV', 'DICTATOR', 'COMMUNIST', 'CONFEDERACY', 'DEMOCRACY', 'CORPORATE'];
const GOODS = [
  { name: 'FOOD', base: 6, eco: -1.4, unit: 't' },        // cheap on agri worlds
  { name: 'TEXTILES', base: 8, eco: -0.9, unit: 't' },
  { name: 'RADIOACTIVES', base: 21, eco: 0.4, unit: 't' },
  { name: 'MACHINERY', base: 36, eco: 1.1, unit: 't' },   // cheap on industrial worlds
  { name: 'COMPUTERS', base: 68, eco: 1.7, unit: 't' },
  { name: 'LUXURIES', base: 92, eco: 1.3, unit: 't' },
  { name: 'CONTRABAND', base: 45, eco: 0, unit: 't', illegal: true },
];
let GALAXY = [];
function genGalaxy() {
  srand(GALAXY_SEED);
  GALAXY = [];
  for (let i = 0; i < 48; i++) {
    let name = '';
    const n = 2 + (rand() * 2 | 0);
    for (let k = 0; k < n; k++) name += SYL[rand() * SYL.length | 0];
    name = name.toUpperCase();
    const economy = rand();                    // 0 = pure agricultural, 1 = pure industrial
    const gov = rand() * 8 | 0;
    GALAXY.push({
      id: i, name,
      x: rng(20, 480), y: rng(20, 300),
      economy, gov,
      tech: clamp(Math.round(economy * 6 + rng(0, 5)), 1, 12),
      danger: clamp((7 - gov) / 7 + rng(-0.15, 0.15), 0.05, 1),   // anarchy is dangerous
      seed: (rand() * 4294967296) >>> 0,
    });
  }
  // de-clump slightly
  for (let pass = 0; pass < 3; pass++) {
    for (const a of GALAXY) for (const b of GALAXY) {
      if (a === b) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d < 24 && d > 0) { b.x += dx / d * (24 - d); b.y += dy / d * (24 - d); }
    }
  }
  for (const s of GALAXY) { s.x = clamp(s.x, 15, 485); s.y = clamp(s.y, 15, 305); }
}
function hash32(str, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 2654435761); h ^= h >>> 15; }
  return (h >>> 0) / 4294967296;
}
function priceOf(good, sys) {
  // agricultural worlds sell food cheap and buy machinery dear; industry inverts it.
  // Pure stateless hash: the market never touches the simulation's RNG stream.
  const swing = good.eco * (sys.economy - 0.5) * 2;
  const jitter = (hash32(good.name, sys.seed) - 0.5) * 0.16;
  return Math.max(2, Math.round(good.base * (1 - swing * 0.45 + jitter)));
}
function distLY(a, b) { return Math.hypot(a.x - b.x, a.y - b.y) / 28; }   // map units -> light years

// ---------- ranks (canon ladder, honest thresholds) ----------
const RANKS = [
  ['HARMLESS', 0], ['MOSTLY HARMLESS', 2], ['POOR', 4], ['AVERAGE', 8],
  ['ABOVE AVERAGE', 12], ['COMPETENT', 18], ['DANGEROUS', 28], ['DEADLY', 40], ['ELITE', 64],
];
function rankOf(kills) {
  let r = RANKS[0][0];
  for (const [name, need] of RANKS) if (kills >= need) r = name;
  return r;
}

// ---------- ships: original wireframe hulls ----------
function hull(points, edges, scale) {
  return { pts: points.map(p => mul3(p, scale)), edges };
}
const HULLS = {
  kestrel: hull([ // the player's ship (drawn only on title/status)
    [0, 0, 4], [-3, 0, -2], [3, 0, -2], [0, 1, -1.4], [0, -0.6, -1.4], [-1.4, 0, -2.6], [1.4, 0, -2.6],
  ], [[0, 1], [0, 2], [1, 2], [0, 3], [1, 3], [2, 3], [0, 4], [1, 4], [2, 4], [1, 5], [2, 6], [5, 6]], 9),
  jackal: hull([ // pirate: barbed dart
    [0, 0, 5], [-2.6, 0.8, -3], [2.6, 0.8, -3], [0, -1.2, -2.4], [0, 1.6, -3.4], [-4, 0, -1], [4, 0, -1],
  ], [[0, 1], [0, 2], [1, 2], [0, 3], [1, 3], [2, 3], [1, 4], [2, 4], [0, 5], [0, 6], [1, 5], [2, 6]], 9),
  warden: hull([ // police: wedge with fins
    [0, 0, 4.4], [-2, 0, -2.6], [2, 0, -2.6], [0, 1.4, -2], [0, -1.4, -2], [-3.2, 0, -3.4], [3.2, 0, -3.4],
  ], [[0, 1], [0, 2], [1, 2], [0, 3], [1, 3], [2, 3], [0, 4], [1, 4], [2, 4], [1, 5], [2, 6]], 8),
  mule: hull([ // trader: fat box
    [-2, -1.4, 4], [2, -1.4, 4], [2, 1.4, 4], [-2, 1.4, 4], [-2.6, -1.8, -4], [2.6, -1.8, -4], [2.6, 1.8, -4], [-2.6, 1.8, -4],
  ], [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]], 9),
};
// the station: a hexagonal drum with the docking slot on its face
function stationHull() {
  const pts = [], edges = [];
  const R = 220, D = 90;
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2;
    pts.push([Math.cos(a) * R, Math.sin(a) * R, D]);
    pts.push([Math.cos(a) * R, Math.sin(a) * R, -D]);
  }
  for (let i = 0; i < 6; i++) {
    const j = (i + 1) % 6;
    edges.push([i * 2, j * 2], [i * 2 + 1, j * 2 + 1], [i * 2, i * 2 + 1]);
  }
  // the slot: a rectangle on the +z face
  const sw = 64, sh = 26;
  const base = pts.length;
  pts.push([-sw, -sh, D], [sw, -sh, D], [sw, sh, D], [-sw, sh, D]);
  edges.push([base, base + 1], [base + 1, base + 2], [base + 2, base + 3], [base + 3, base]);
  return { pts, edges, slot: [base, base + 1, base + 2, base + 3] };
}
const STATION = stationHull();

// ---------- game state ----------
let G = null;
function newGame(seed, opts) {
  opts = opts || {};
  genGalaxy();
  G = {
    seed, time: 0, tick: 0, showTitle: !!opts.attract,
    sysId: 0, credits: 100, fuel: 7, maxFuel: 7,
    cargo: {}, cargoCap: 20,
    kills: 0, wanted: 0, missiles: 2,
    laserHeat: 0, shieldF: 100, shieldA: 100, hull: 100,
    hasDockComp: false, hasBigBay: false,
    mode: 'docked', modeT: 0, screen: 'status',   // docked screens: status/market/equip/map
    // flight state
    pos: v3(0, 0, 0), fwd: v3(0, 0, 1), up: v3(0, 1, 0), right: v3(1, 0, 0),
    speed: 0, throttle: 0,
    ships: [], bolts: [], parts: [], msg: [], msgT: 0,
    station: null, planet: null,
    mapSel: 0, shake: 0, flashT: 0,
    stats: { jumps: 0, bought: 0, sold: 0, profit: 0, killsP: 0, killsPolice: 0, docks: 0, scrapes: 0 },
    log: [],
    autoDockT: 0, jumpT: 0, jumpTo: -1,
  };
  G.mapSel = G.sysId;
  say('Docked at ' + GALAXY[G.sysId].name + ' Haven. The stars are a market.');
}
function sys() { return GALAXY[G.sysId]; }
function say(s) { G.msg.unshift(s); if (G.msg.length > 3) G.msg.pop(); G.msgT = 5; }
function cargoTons() { let n = 0; for (const k in G.cargo) n += G.cargo[k]; return n; }

// ---------- launch / spaceflight world ----------
function launch() {
  if (G.mode !== 'docked') return;
  G.msg = [];
  const s = sys();
  srand(s.seed ^ 0x5AFE);
  G.mode = 'flight';
  G.screen = 'status';
  // the world: planet far ahead, station near it; we emerge just outside the slot
  G.planet = { pos: v3(rng(-4000, 4000), rng(-2500, 2500), 26000), r: 5200 };
  G.station = {
    pos: add3(G.planet.pos, v3(rng(-7000, 7000), rng(-4000, 4000), -9000)),
    spin: 0, spinRate: 0.14,
    axis: null,
  };
  // place us 1600 out from the slot face, pointed away
  G.pos = add3(G.station.pos, v3(0, 0, 1600));
  G.fwd = v3(0, 0, 1); G.up = v3(0, 1, 0); G.right = cross3(G.fwd, G.up);
  G.speed = 60; G.throttle = 0.35;
  G.ships = []; G.bolts = [];
  spawnEncounters();
  say('Clear of the station. ' + (G.wanted ? 'The Wardens remember you.' : 'Fly safe, commander.'));
}
function spawnEncounters() {
  const s = sys();
  const nPirates = Math.round(s.danger * 3 + rng(0, 1.2));
  for (let i = 0; i < nPirates; i++) spawnShip('jackal');
  if (s.gov >= 4) spawnShip('warden');
  if (rand() < 0.7) spawnShip('mule');
}
function spawnShip(type) {
  const off = v3(rng(-1, 1), rng(-1, 1), rng(-1, 1));
  const dist = rng(3500, 9000);
  G.ships.push({
    type, pos: add3(G.pos, mul3(norm3(off), dist)),
    fwd: norm3(v3(rng(-1, 1), rng(-1, 1), rng(-1, 1))),
    up: v3(0, 1, 0),
    hp: type === 'mule' ? 40 : type === 'warden' ? 70 : 55,
    speed: type === 'mule' ? 55 : 95,
    fireT: rng(1, 3), dead: false, hostile: type === 'jackal' || (type === 'warden' && G.wanted > 0),
    id: (rand() * 1e9) | 0,
  });
}

// ---------- flight sim ----------
function applyPitchRoll(pitch, roll, dt) {
  // canon Elite: pitch and roll only, no yaw
  if (roll) {
    G.up = norm3(rotAxis(G.up, G.fwd, roll * dt));
  }
  G.right = norm3(cross3(G.fwd, G.up));
  if (pitch) {
    G.fwd = norm3(rotAxis(G.fwd, G.right, pitch * dt));
    G.up = norm3(cross3(G.right, G.fwd));
  }
}
function worldToView(p) {
  const rel = sub3(p, G.pos);
  return [dot3(rel, G.right), dot3(rel, G.up), dot3(rel, G.fwd)];
}
function project(p) {
  const v = worldToView(p);
  if (v[2] < 1) return null;
  const f = 620 / v[2];
  return [CX + v[0] * f, CY - v[1] * f, v[2], f];
}
function simFlight(dt) {
  // throttle -> speed
  const maxSpd = 340;
  G.speed += (G.throttle * maxSpd - G.speed) * Math.min(1, dt * 2.2);
  G.pos = add3(G.pos, mul3(G.fwd, G.speed * dt));
  G.laserHeat = Math.max(0, G.laserHeat - dt * 26);
  G.shieldF = Math.min(100, G.shieldF + dt * 0.9);
  G.shieldA = Math.min(100, G.shieldA + dt * 0.9);
  // station spins forever
  G.station.spin += G.station.spinRate * dt;
  // docking or scraping: the slot lives on the +z face, and only there
  const toSt = sub3(G.pos, G.station.pos);
  const lat = Math.hypot(toSt[0], toSt[1]);
  if (Math.abs(toSt[2]) < 110 && lat < 250) {
    const slotAng = G.station.spin;
    const upAng = Math.atan2(G.up[0], G.up[1]);
    let dAng = Math.abs(((upAng - slotAng) % Math.PI));
    dAng = Math.min(dAng, Math.PI - dAng);
    // through the slot: laterally inside it, roll matched to the spin,
    // flying inward through the FRONT (+z) face
    const entryOk = lat < 95 && dAng < 0.3 && G.fwd[2] < -0.65 && toSt[2] > -30;
    if (entryOk) {
      dockNow();
      return;
    }
    // the hull does not forgive
    G.hull -= 10;
    G.stats.scrapes++;
    G.shake = 8; G.flashT = 0.3;
    SFX.scrape();
    say(toSt[2] < -30 ? 'That face has no door.' : 'Hull scrape! Match your roll to the slot.');
    const eject = norm3(v3(toSt[0], toSt[1], toSt[2] >= 0 ? 300 : -300));
    G.pos = add3(G.station.pos, mul3(eject, 480));
    if (G.hull <= 0) die('Broken on the station hull.');
    return;
  }
  simShips(dt);
  simBolts(dt);
  // hyperspace countdown
  if (G.jumpT > 0) {
    G.jumpT -= dt;
    if (G.jumpT <= 0) doJump();
  }
}
function dockNow() {
  G.msg = [];
  G.mode = 'docked';
  G.screen = 'status';
  G.stats.docks++;
  G.shieldF = G.shieldA = 100;
  G.laserHeat = 0;
  SFX.dock();
  say('Docked. ' + sys().name + ' Haven bids you welcome.');
  G.log.push({ ev: 'dock', sys: G.sysId, cr: G.credits, t: Math.round(G.time) });
}
function die(why) {
  if (G.mode === 'dead' || G.mode === 'dying') return;
  G.mode = 'dying';
  G.modeT = 0;
  G.deathWhy = why;
  G.shake = 10;
  addBurst(G.pos, '#33d6ff');
  SFX.boom();
}
function startJump(target) {
  const d = distLY(sys(), GALAXY[target]);
  if (target === G.sysId) { say('You are already there.'); SFX.deny(); return false; }
  if (d > G.fuel) { say(`Out of range: ${d.toFixed(1)} LY needs more fuel.`); SFX.deny(); return false; }
  if (G.mode !== 'flight') { say('Launch first.'); SFX.deny(); return false; }
  G.jumpTo = target;
  G.jumpT = 2.2;
  SFX.jump();
  say('Hyperdrive spooling: ' + GALAXY[target].name + '.');
  return true;
}
function doJump() {
  const d = distLY(sys(), GALAXY[G.jumpTo]);
  G.fuel = Math.max(0, G.fuel - d);
  G.sysId = G.jumpTo;
  G.jumpTo = -1;
  G.stats.jumps++;
  const s = sys();
  srand(s.seed ^ 0x5AFE);
  G.planet = { pos: v3(rng(-4000, 4000), rng(-2500, 2500), 26000), r: 5200 };
  G.station = { pos: add3(G.planet.pos, v3(rng(-7000, 7000), rng(-4000, 4000), -9000)), spin: 0, spinRate: 0.14 };
  G.pos = v3(0, 0, 0);
  G.ships = []; G.bolts = [];
  spawnEncounters();
  G.log.push({ ev: 'jump', sys: G.sysId, t: Math.round(G.time) });
  say('Witch-space spits you out at ' + s.name + '.');
}

// ---------- combat ----------
function fireLaser() {
  if (G.mode !== 'flight' || G.laserHeat > 92) return false;
  G.laserHeat += 9;
  G.lastHitPoint = null;
  SFX.laser();
  // instant beam down +fwd: hit the nearest ship within a narrow cone
  let best = null, bd = 1e9;
  for (const sh of G.ships) {
    if (sh.dead) continue;
    const v = worldToView(sh.pos);
    if (v[2] < 20 || v[2] > 6500) continue;
    const off = Math.hypot(v[0], v[1]);
    const coneR = v[2] * 0.045 + 26;
    if (off < coneR && v[2] < bd) { bd = v[2]; best = sh; }
  }
  G.boltFlashT = 0.07;
  if (best) {
    G.lastHitPoint = [...best.pos];
    for (let i = 0; i < 6; i++) {
      G.parts.push({ pos: [...best.pos], vel: mul3(norm3(v3(rng(-1, 1), rng(-1, 1), rng(-1, 1))), rng(40, 160)), color: '#ffd12a', life: rng(0.15, 0.35), t: 0 });
    }
    best.hp -= 8 + (rand() < 0.2 ? 6 : 0);
    best.hostile = true;
    if (best.type === 'mule') bumpWanted(1);
    if (best.type === 'warden') bumpWanted(2);
    SFX.hitThem();
    best.hurtT = 0.2;
    if (best.hp <= 0) killShip(best);
    return true;
  }
  return false;
}
function bumpWanted(n) {
  const before = G.wanted;
  G.wanted = clamp(G.wanted + n, 0, 5);
  if (G.wanted > before) {
    say('The Wardens flag your hull. Fugitive status ' + G.wanted + '.');
    for (const sh of G.ships) if (sh.type === 'warden') sh.hostile = true;
  }
}
function killShip(sh) {
  sh.dead = true;
  SFX.boom();
  const col2 = sh.type === 'jackal' ? '#ff2e6d' : sh.type === 'warden' ? '#5fd4ff' : '#c9a06b';
  addBurst(sh.pos, col2);
  // the hull comes apart into tumbling edges (canon died this way)
  const hd = HULLS[sh.type];
  for (const [a2, b2] of hd.edges) {
    G.parts.push({
      kind: 'edge', pos: [...sh.pos],
      a: [...hd.pts[a2]], b: [...hd.pts[b2]],
      vel: mul3(norm3(v3(rng(-1, 1), rng(-1, 1), rng(-1, 1))), rng(20, 90)),
      spin: rng(-3, 3), ang: rng(0, 6.28),
      color: col2, life: rng(1.2, 2.2), t: 0,
    });
  }
  if (sh.type === 'jackal') {
    const bounty = 18 + (rand() * 22 | 0);
    G.credits += bounty;
    G.kills++;
    G.stats.killsP++;
    const oldRank = rankOf(G.kills - 1), newRank = rankOf(G.kills);
    say(`Jackal destroyed. Bounty ${bounty} cr.`);
    if (newRank !== oldRank) { say('RATING: ' + newRank); SFX.rank(); }
  } else if (sh.type === 'warden') {
    G.kills++;
    G.stats.killsPolice++;
    bumpWanted(3);
    say('A Warden falls. They will not forget.');
  } else {
    G.kills++;
    bumpWanted(2);
    say('The trader breaks apart. Piracy suits you.');
  }
  G.log.push({ ev: 'kill', type: sh.type, t: Math.round(G.time) });
}
function fireMissile() {
  if (G.missiles <= 0) { say('No missiles.'); SFX.deny(); return false; }
  // lock: nearest hostile in front cone
  let best = null, bd = 1e9;
  for (const sh of G.ships) {
    if (sh.dead) continue;
    const v = worldToView(sh.pos);
    if (v[2] < 20) continue;
    const off = Math.hypot(v[0], v[1]) / v[2];
    if (off < 0.35 && v[2] < bd) { bd = v[2]; best = sh; }
  }
  if (!best) { say('No lock.'); SFX.deny(); return false; }
  G.missiles--;
  SFX.missile();
  G.bolts.push({ kind: 'missile', pos: [...G.pos], target: best.id, speed: 460, life: 12 });
  return true;
}
function simShips(dt) {
  for (const sh of G.ships) {
    if (sh.dead) continue;
    if (sh.hurtT > 0) sh.hurtT -= dt;
    const toUs = sub3(G.pos, sh.pos);
    const d = len3(toUs);
    if (sh.type === 'mule' && !sh.hostile) {
      // traders run for the planet
      const dir = norm3(sub3(G.planet.pos, sh.pos));
      sh.fwd = norm3(add3(mul3(sh.fwd, 0.95), mul3(dir, 0.05)));
    } else if (sh.hostile || sh.type === 'jackal') {
      // hunters run in, rake, and break off — never park
      const dir = d < 280 ? mul3(norm3(toUs), -1) : norm3(toUs);
      const agility = sh.type === 'warden' ? 0.085 : 0.065;
      sh.fwd = norm3(add3(mul3(sh.fwd, 1 - agility), mul3(dir, agility)));
      sh.fireT -= dt;
      const facing = dot3(sh.fwd, dir);
      if (sh.fireT <= 0 && ((d < 3200 && facing > 0.94) || (d < 900 && facing > 0.7) || d < 250)) {
        sh.fireT = rng(0.9, 1.7);
        // a visible bolt crosses the void; it lands where you were
        G.bolts.push({ kind: 'enemy', pos: [...sh.pos], aim: [...G.pos], speed: 1500, life: 4, dmg: rng(6, 13), from: [...sh.pos] });
      }
    } else if (sh.type === 'mule' && sh.hostile) {
      const dir = norm3(sub3(sh.pos, G.pos));
      sh.fwd = norm3(add3(mul3(sh.fwd, 0.93), mul3(dir, 0.07)));
    }
    const spd = (sh.hostile || sh.type === 'jackal') && d < 700 ? sh.speed * 0.45 : sh.speed;
    sh.pos = add3(sh.pos, mul3(sh.fwd, spd * dt));
    // hostiles that drift too far re-engage
    if (d > 14000 && sh.type === 'jackal') {
      sh.pos = add3(G.pos, mul3(norm3(v3(rng(-1, 1), rng(-1, 1), rng(-1, 1))), 7000));
    }
  }
}
function damageUs(dmg, front) {
  SFX.hitUs();
  G.shake = Math.max(G.shake, 5);
  G.flashT = 0.22;
  // shields are pools, not gates: whatever they cannot drink reaches the hull
  let sd = dmg * 6;
  if (front) {
    const ate = Math.min(G.shieldF, sd);
    G.shieldF -= ate; sd -= ate;
  } else {
    const ate = Math.min(G.shieldA, sd);
    G.shieldA -= ate; sd -= ate;
  }
  if (sd > 0.5) {
    G.hull -= sd / 6;
    if (G.hull <= 0) die('Your Kestrel comes apart among the stars.');
  }
}
function simBolts(dt) {
  for (const b of [...G.bolts]) {
    b.life -= dt;
    if (b.life <= 0) { G.bolts.splice(G.bolts.indexOf(b), 1); continue; }
    if (b.kind === 'enemy') {
      const dir = norm3(sub3(b.aim, b.pos));
      b.pos = add3(b.pos, mul3(dir, b.speed * dt));
      if (len3(sub3(b.aim, b.pos)) < 70) {
        // arrived at the aim point: did we stay to receive it?
        if (len3(sub3(G.pos, b.pos)) < 110) {
          const rel = norm3(sub3(b.from, G.pos));
          const fromFront = dot3(rel, G.fwd) > 0;
          G.hitDir = [dot3(rel, G.right), dot3(rel, G.up)];
          damageUs(b.dmg, fromFront);
        }
        G.bolts.splice(G.bolts.indexOf(b), 1);
      }
      continue;
    }
    if (b.kind === 'missile') {
      const t = G.ships.find(s => s.id === b.target && !s.dead);
      if (!t) { G.bolts.splice(G.bolts.indexOf(b), 1); continue; }
      const dir = norm3(sub3(t.pos, b.pos));
      b.pos = add3(b.pos, mul3(dir, b.speed * dt));
      if (len3(sub3(t.pos, b.pos)) < 90) {
        t.hp -= 60;
        if (t.hp <= 0) killShip(t);
        G.bolts.splice(G.bolts.indexOf(b), 1);
      }
    }
  }
}
function addBurst(pos, color) {
  for (let i = 0; i < 22; i++) {
    G.parts.push({
      pos: [...pos], vel: mul3(norm3(v3(rng(-1, 1), rng(-1, 1), rng(-1, 1))), rng(60, 320)),
      color, life: rng(0.5, 1.3), t: 0,
    });
  }
}

// ---------- market / equip ----------
function buyGood(gi) {
  const g = GOODS[gi];
  const p = priceOf(g, sys());
  if (G.credits < p) { say('Not enough credits.'); SFX.deny(); return false; }
  if (cargoTons() >= G.cargoCap) { say('Cargo bay is full.'); SFX.deny(); return false; }
  G.credits -= p;
  G.cargo[g.name] = (G.cargo[g.name] || 0) + 1;
  G.stats.bought++;
  SFX.buy();
  return true;
}
function sellGood(gi) {
  const g = GOODS[gi];
  if (!G.cargo[g.name]) { say('None aboard.'); SFX.deny(); return false; }
  const p = priceOf(g, sys());
  G.cargo[g.name]--;
  if (G.cargo[g.name] === 0) delete G.cargo[g.name];
  G.credits += p;
  G.stats.sold++;
  G.stats.profit += p;
  if (g.illegal && sys().gov >= 4) {
    if (rand() < 0.35) { bumpWanted(1); say('A customs scan flags the contraband.'); }
  }
  SFX.sell();
  return true;
}
const EQUIP = [
  { name: 'FUEL (FULL TANK)', cost: s => Math.ceil((7 - G.fuel) * 4), buy: () => { G.fuel = G.maxFuel; }, can: () => G.fuel < G.maxFuel - 0.01 },
  { name: 'MISSILE', cost: () => 30, buy: () => { G.missiles++; }, can: () => G.missiles < 4 },
  { name: 'CARGO BAY +10', cost: () => 250, buy: () => { G.cargoCap = 30; G.hasBigBay = true; }, can: () => !G.hasBigBay },
  { name: 'DOCKING COMPUTER', cost: () => 450, buy: () => { G.hasDockComp = true; }, can: () => !G.hasDockComp },
  { name: 'HULL PATCH +25', cost: () => 60, buy: () => { G.hull = Math.min(100, G.hull + 25); }, can: () => G.hull < 100 },
];
function buyEquip(i) {
  const e = EQUIP[i];
  if (!e.can()) { SFX.deny(); return false; }
  const c = e.cost();
  if (G.credits < c) { say('Not enough credits.'); SFX.deny(); return false; }
  G.credits -= c;
  e.buy();
  SFX.buy();
  say(e.name + ' installed.');
  return true;
}

// ---------- world sim ----------
function sim(dt) {
  G.time += dt; G.tick++; G.modeT += dt;
  if (G.shake > 0) G.shake = Math.max(0, G.shake - 18 * dt);
  if (G.flashT > 0) G.flashT -= dt;
  if (G.boltFlashT > 0) G.boltFlashT -= dt;
  if (G.msgT > 0) G.msgT -= dt;
  for (const p of [...G.parts]) {
    p.t += dt;
    if (p.t >= p.life) { G.parts.splice(G.parts.indexOf(p), 1); continue; }
    p.pos = add3(p.pos, mul3(p.vel, dt));
  }
  if (G.mode === 'dying') {
    // the ship tumbles; the stars keep going
    applyPitchRoll(0.7, 2.4, dt);
    G.speed *= 1 - dt * 0.5;
    G.pos = add3(G.pos, mul3(G.fwd, G.speed * dt));
    if (G.modeT > 1.6) { G.mode = 'dead'; G.modeT = 0; SFX.fail(); }
    return;
  }
  if (G.mode === 'flight') {
    simFlight(dt);
    // docking computer: it flies the true approach — axis first, then roll-match
    if (G.hasDockComp && G.autoDockT > 0) {
      G.autoDockT -= dt;
      const toSt2 = sub3(G.pos, G.station.pos);
      if (toSt2[2] < 200 && Math.hypot(toSt2[0], toSt2[1]) > 220) {
        // wrong side: swing wide to the slot face
        steerToward(add3(G.station.pos, v3(0, 0, 1500)), dt);
        G.throttle = 0.6;
      } else if (toSt2[2] > 320) {
        steerToward(G.station.pos, dt);
        G.throttle = 0.4;
      } else {
        steerToward(G.station.pos, dt, G.station.spin);
        G.throttle = 0.2;
      }
    }
  }
}

// ---------- rendering ----------
function drawWire(hullDef, pos, fwd, up, color, glow) {
  const right = norm3(cross3(fwd, up));
  const P = [];
  for (const p of hullDef.pts) {
    const world = add3(pos, add3(add3(mul3(right, p[0]), mul3(up, p[1])), mul3(fwd, p[2])));
    P.push(project(world));
  }
  ctx.save();
  if (glow) { ctx.shadowColor = color; ctx.shadowBlur = 6; }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (const [a, b] of hullDef.edges) {
    const A = P[a], B = P[b];
    if (!A || !B) continue;
    ctx.moveTo(A[0], A[1]);
    ctx.lineTo(B[0], B[1]);
  }
  ctx.stroke();
  ctx.restore();
  return P;
}
function drawScene() {
  // deep space
  const bg = ctx.createLinearGradient(0, VY, 0, VY + VVH);
  bg.addColorStop(0, '#04050c'); bg.addColorStop(0.5, '#05060f'); bg.addColorStop(1, '#04050a');
  ctx.fillStyle = bg;
  ctx.fillRect(VX, VY, VVW, VVH);
  ctx.save();
  ctx.beginPath(); ctx.rect(VX, VY, VVW, VVH); ctx.clip();
  if (G.shake > 0) ctx.translate(rng(-1, 1) * G.shake * 0.7, rng(-1, 1) * G.shake * 0.5);
  // starfield: a wrapping dust volume around the ship — speed you can see
  if (!G.stars) {
    G.stars = [];
    let h = 0x57a5;
    const r01 = () => { h ^= h << 13; h >>>= 0; h ^= h >> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
    for (let i = 0; i < 340; i++) {
      G.stars.push({ p: v3((r01() - 0.5) * 9000, (r01() - 0.5) * 9000, (r01() - 0.5) * 9000), b: 0.2 + r01() * 0.7, big: r01() < 0.1 });
    }
  }
  const WRAP = 9000;
  ctx.lineWidth = 1.2;
  for (const st of G.stars) {
    // wrap the dust cube around the ship
    for (let ax = 0; ax < 3; ax++) {
      let d = st.p[ax] - G.pos[ax];
      d = ((d % WRAP) + WRAP * 1.5) % WRAP - WRAP / 2;
      st.p[ax] = G.pos[ax] + d;
    }
    const pr = project(st.p);
    if (!pr) continue;
    if (pr[0] < VX || pr[0] > VX + VVW || pr[1] < VY || pr[1] > VY + VVH) continue;
    const streak = G.speed * 0.05;
    const prev = project(add3(st.p, mul3(G.fwd, -streak * 4)));
    ctx.globalAlpha = st.b;
    if (prev && streak > 3 && Math.hypot(prev[0] - pr[0], prev[1] - pr[1]) > 2) {
      ctx.strokeStyle = 'rgba(200,220,255,0.7)';
      ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(pr[0], pr[1]); ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(200,220,255,0.85)';
      ctx.fillRect(pr[0], pr[1], st.big ? 2.2 : 1.4, st.big ? 2.2 : 1.4);
    }
  }
  ctx.globalAlpha = 1;
  // the planet: a great ringed disc
  if (G.planet) {
    const pr = project(G.planet.pos);
    if (pr) {
      const rad = G.planet.r * pr[3] / 1;
      const rr = G.planet.r * 620 / worldToView(G.planet.pos)[2];
      ctx.save();
      const pg = ctx.createRadialGradient(pr[0] - rr * 0.3, pr[1] - rr * 0.3, rr * 0.1, pr[0], pr[1], rr);
      pg.addColorStop(0, 'rgba(80,170,220,0.5)');
      pg.addColorStop(0.7, 'rgba(30,80,140,0.35)');
      pg.addColorStop(1, 'rgba(10,30,70,0.15)');
      ctx.fillStyle = pg;
      ctx.beginPath(); ctx.arc(pr[0], pr[1], rr, 0, 7); ctx.fill();
      ctx.strokeStyle = hexA('#5fd4ff', 0.5);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // latitude rings
      ctx.strokeStyle = hexA('#5fd4ff', 0.14);
      for (let i = 1; i <= 3; i++) {
        ctx.beginPath();
        ctx.ellipse(pr[0], pr[1], rr * 0.92, rr * (0.24 * i), 0, 0, 7);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  // the station: rotating drum; slot rendered in its spun frame
  if (G.station) {
    const spin = G.station.spin;
    const sFwd = v3(0, 0, 1);
    const sUp = v3(Math.sin(spin), Math.cos(spin), 0);
    drawWire({ pts: STATION.pts, edges: STATION.edges.slice(0, 18) }, G.station.pos, sFwd, sUp, hexA('#7fdcff', 0.75), true);
    // slot edges brighter — the way in
    const slotEdges = STATION.edges.slice(18);
    drawWire({ pts: STATION.pts, edges: slotEdges }, G.station.pos, sFwd, sUp, '#ffd12a', true);
  }
  // ships
  for (const sh of G.ships) {
    if (sh.dead) continue;
    const col = sh.hurtT > 0 ? '#ffffff'
      : sh.type === 'jackal' ? '#ff2e6d'
      : sh.type === 'warden' ? '#5fd4ff'
      : '#c9a06b';
    drawWire(HULLS[sh.type], sh.pos, sh.fwd, sh.up, col, true);
  }
  // missiles
  for (const b of G.bolts) {
    const pr = project(b.pos);
    if (!pr) continue;
    const col = b.kind === 'enemy' ? '#ff2e6d' : '#ffd12a';
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const gl2 = ctx.createRadialGradient(pr[0], pr[1], 0, pr[0], pr[1], 10);
    gl2.addColorStop(0, hexA(col, 0.95)); gl2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gl2;
    ctx.beginPath(); ctx.arc(pr[0], pr[1], 10, 0, 7); ctx.fill();
    ctx.restore();
  }
  // debris
  for (const p of G.parts) {
    const k = 1 - p.t / p.life;
    if (p.kind === 'edge') {
      p.ang += p.spin * 0.016;
      const c2 = Math.cos(p.ang), s2 = Math.sin(p.ang);
      const rot = q2 => v3(q2[0] * c2 - q2[2] * s2, q2[1], q2[0] * s2 + q2[2] * c2);
      const A = project(add3(p.pos, rot(p.a))), B = project(add3(p.pos, rot(p.b)));
      if (A && B) {
        ctx.globalAlpha = k;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
      }
      continue;
    }
    const pr = project(p.pos);
    if (!pr) continue;
    ctx.globalAlpha = k;
    ctx.fillStyle = p.color;
    const s = Math.max(1, pr[3] * 160);
    ctx.fillRect(pr[0] - s / 2, pr[1] - s / 2, s, s);
  }
  ctx.globalAlpha = 1;
  // laser bolts: twin beams to the crosshair
  if (G.boltFlashT > 0) {
    const hp2 = G.lastHitPoint ? project(G.lastHitPoint) : null;
    const tx2 = hp2 ? hp2[0] : CX, ty2 = hp2 ? hp2[1] : CY;
    ctx.save();
    ctx.strokeStyle = hexA('#ff2e6d', 0.9);
    ctx.shadowColor = '#ff2e6d'; ctx.shadowBlur = 8;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(CX - 130, VY + VVH - 4);
    ctx.lineTo(tx2, ty2);
    ctx.moveTo(CX + 130, VY + VVH - 4);
    ctx.lineTo(tx2, ty2);
    ctx.stroke();
    if (hp2) {
      ctx.globalCompositeOperation = 'lighter';
      const fl = ctx.createRadialGradient(tx2, ty2, 0, tx2, ty2, 18);
      fl.addColorStop(0, 'rgba(255,255,255,0.95)'); fl.addColorStop(0.5, 'rgba(255,209,42,0.6)'); fl.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = fl;
      ctx.beginPath(); ctx.arc(tx2, ty2, 18, 0, 7); ctx.fill();
    }
    ctx.restore();
  }
  // crosshair
  ctx.strokeStyle = hexA('#e8f4ff', 0.75);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(CX - 16, CY); ctx.lineTo(CX - 5, CY);
  ctx.moveTo(CX + 5, CY); ctx.lineTo(CX + 16, CY);
  ctx.moveTo(CX, CY - 16); ctx.lineTo(CX, CY - 5);
  ctx.moveTo(CX, CY + 5); ctx.lineTo(CX, CY + 16);
  ctx.stroke();
  // damage flash: the edge that was struck burns brightest
  if (G.flashT > 0) {
    const a3 = G.flashT * 0.9;
    if (G.hitDir) {
      const [hx2, hy2] = G.hitDir;
      const gx = clamp(CX + hx2 * VVW, VX, VX + VVW), gy = clamp(CY - hy2 * VVH, VY, VY + VVH);
      const eg = ctx.createRadialGradient(gx, gy, 0, gx, gy, VVW * 0.7);
      eg.addColorStop(0, `rgba(255,50,60,${a3})`); eg.addColorStop(1, 'rgba(255,50,60,0)');
      ctx.fillStyle = eg;
    } else {
      ctx.fillStyle = `rgba(255,50,60,${a3 * 0.5})`;
    }
    ctx.fillRect(VX, VY, VVW, VVH);
  }
  // hyperspace tunnel
  if (G.jumpT > 0) {
    const k = 1 - G.jumpT / 2.2;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = hexA('#b06bff', 0.5);
    for (let i = 0; i < 14; i++) {
      const r = (i / 14 + (G.time * 0.8 % (1 / 14))) % 1;
      const rr = r * r * VVW * (0.4 + k);
      ctx.globalAlpha = (1 - r) * 0.7 * (0.3 + k);
      ctx.beginPath(); ctx.arc(CX, CY, rr, 0, 7); ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}
// ---------- the scanner: canon's 3D radar dish ----------
function drawScanner(hx, hy, hw, hh) {
  ctx.save();
  ctx.strokeStyle = hexA('#33d6ff', 0.5);
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.ellipse(hx, hy, hw, hh, 0, 0, 7); ctx.stroke();
  ctx.strokeStyle = hexA('#33d6ff', 0.2);
  ctx.beginPath(); ctx.ellipse(hx, hy, hw * 0.62, hh * 0.62, 0, 0, 7); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(hx, hy, hw * 0.3, hh * 0.3, 0, 0, 7); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(hx - hw, hy); ctx.lineTo(hx + hw, hy); ctx.stroke();
  // the ship at the center, nose forward
  ctx.fillStyle = '#e8f4ff';
  ctx.beginPath(); ctx.moveTo(hx, hy - 6); ctx.lineTo(hx - 4, hy + 4); ctx.lineTo(hx + 4, hy + 4); ctx.closePath(); ctx.fill();
  const R = 9500;
  const blips = [...G.ships.filter(s => !s.dead).map(s => ({ p: s.pos, col: s.type === 'jackal' ? '#ff2e6d' : s.type === 'warden' ? '#5fd4ff' : '#c9a06b', ring: false })),
    ...(G.station ? [{ p: G.station.pos, col: '#ffd12a', ring: true }] : [])];
  for (const b of blips) {
    const v = worldToView(b.p);
    if (Math.abs(v[0]) > R || Math.abs(v[2]) > R) continue;
    const sx = hx + (v[0] / R) * hw;
    const sy = hy - (v[2] / R) * hh;
    const alt = clamp((v[1] / R) * hh * 3.2, -44, 44);
    ctx.strokeStyle = hexA(b.col, 0.8);
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, sy - alt); ctx.stroke();
    if (b.ring) {
      ctx.beginPath(); ctx.arc(sx, sy - alt, 4, 0, 7); ctx.stroke();
    } else {
      ctx.fillStyle = b.col;
      ctx.fillRect(sx - 2.2, sy - alt - 2.2, 4.4, 4.4);
    }
    ctx.fillStyle = hexA(b.col, 0.4);
    ctx.fillRect(sx - 1.5, sy - 1.5, 3, 3);
  }
  // legend
  ctx.font = '600 7.5px Verdana, sans-serif';
  ctx.textAlign = 'left';
  const leg = [['PIRATE', '#ff2e6d'], ['POLICE', '#5fd4ff'], ['TRADER', '#c9a06b'], ['STATION', '#ffd12a']];
  leg.forEach(([nm, cl], i) => {
    ctx.fillStyle = cl;
    ctx.fillRect(hx - hw + 4, hy - hh + 6 + i * 11, 4, 4);
    ctx.fillStyle = 'rgba(180,205,235,0.7)';
    ctx.fillText(nm, hx - hw + 11, hy - hh + 11 + i * 11);
  });
  ctx.restore();
}
function bar(x, y, w, h, k, col) {
  ctx.fillStyle = 'rgba(255,255,255,0.09)';
  ctx.fillRect(x, y, w, h);
  if (k > 0.005) {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w * clamp(k, 0, 1), h);
  }
  ctx.strokeStyle = 'rgba(200,220,240,0.25)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}
function label(txt, x, y, align) {
  ctx.font = '700 10px Verdana, sans-serif';
  ctx.letterSpacing = '2px';
  ctx.textAlign = align || 'left';
  ctx.fillStyle = 'rgba(140,175,210,0.75)';
  ctx.fillText(txt, x, y);
  ctx.letterSpacing = '0px';
}
function drawHUD() {
  const HY = H - HUD_H;
  ctx.fillStyle = '#05080f';
  ctx.fillRect(0, HY, W, HUD_H);
  ctx.fillStyle = 'rgba(200,220,240,0.45)';
  ctx.fillRect(0, HY, W, 1.5);
  // left: shields, hull, fuel, laser
  label('FORE SHIELD', 24, HY + 22);
  bar(120, HY + 14, 160, 9, G.shieldF / 100, '#5fd4ff');
  label('AFT SHIELD', 24, HY + 42);
  bar(120, HY + 34, 160, 9, G.shieldA / 100, '#5fd4ff');
  label('HULL', 24, HY + 62);
  bar(120, HY + 54, 160, 9, G.hull / 100, G.hull < 30 ? '#ff5c5c' : '#5aff9e');
  label('LASER TEMP', 24, HY + 82);
  bar(120, HY + 74, 160, 9, G.laserHeat / 100, G.laserHeat > 75 ? '#ff5c5c' : '#ff8c42');
  label('FUEL', 24, HY + 102);
  bar(120, HY + 94, 160, 9, G.fuel / G.maxFuel, '#ffd12a');
  ctx.font = `700 10px ${MONO}`;
  ctx.fillStyle = 'rgba(200,225,250,0.8)';
  ctx.textAlign = 'left';
  ctx.fillText(G.fuel.toFixed(1) + ' LY', 288, HY + 102);
  label('SPEED', 24, HY + 122);
  bar(120, HY + 114, 160, 9, G.speed / 340, '#e8f4ff');
  // center: the scanner
  drawScanner(W / 2, HY + 76, 170, 52);
  ctx.font = '700 9px Verdana, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(140,175,210,0.6)';
  ctx.letterSpacing = '2px';
  ctx.fillText('SCANNER', W / 2, HY + 140);
  ctx.letterSpacing = '0px';
  // right: status
  label('CREDITS', 950, HY + 22);
  ctx.font = `800 15px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffd12a';
  ctx.fillText(G.credits.toFixed(0) + ' CR', 1050, HY + 23);
  label('CARGO', 950, HY + 44);
  ctx.font = `700 11px ${MONO}`;
  ctx.fillStyle = 'rgba(220,240,255,0.9)';
  ctx.fillText(cargoTons() + '/' + G.cargoCap + 't', 1050, HY + 45);
  label('MISSILES', 950, HY + 66);
  ctx.fillStyle = '#ffd12a';
  for (let i = 0; i < G.missiles; i++) {
    ctx.beginPath();
    ctx.moveTo(1050 + i * 18, HY + 66); ctx.lineTo(1056 + i * 18, HY + 58); ctx.lineTo(1062 + i * 18, HY + 66);
    ctx.closePath(); ctx.fill();
  }
  label('RATING', 950, HY + 88);
  ctx.font = `700 11px ${MONO}`;
  ctx.fillStyle = '#5aff9e';
  ctx.fillText(rankOf(G.kills) + ' (' + G.kills + ')', 1050, HY + 89);
  label('LEGAL', 950, HY + 110);
  ctx.fillStyle = G.wanted ? '#ff5c5c' : 'rgba(220,240,255,0.9)';
  ctx.fillText(G.wanted ? 'FUGITIVE ' + G.wanted : 'CLEAN', 1050, HY + 111);
  // messages above HUD — they fade, and they die
  if (G.msgT > 0) {
    ctx.font = '600 12px Verdana, sans-serif';
    ctx.textAlign = 'center';
    const a2 = Math.min(1, G.msgT);
    G.msg.slice(0, 2).forEach((m, i) => {
      ctx.fillStyle = `rgba(210,232,255,${(0.9 - i * 0.35) * a2})`;
      ctx.fillText(m, W / 2, HY - 14 - i * 18);
    });
  }
  // controls strip
  ctx.font = `700 9px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(150,180,215,0.7)';
  ctx.fillText(G.mode === 'flight'
    ? 'ARROWS PITCH/ROLL · W/S THROTTLE · SPACE LASER · M MISSILE · J JUMP (MAP TARGET) · C DOCK-COMP · G MAP'
    : '1 STATUS · 2 MARKET · 3 EQUIP · 4 GALAXY MAP · L LAUNCH', 24, H - 6);
}
function drawTopBar() {
  ctx.fillStyle = '#05080f';
  ctx.fillRect(0, 0, W, MQ);
  ctx.fillStyle = 'rgba(200,220,240,0.4)';
  ctx.fillRect(0, MQ - 1.5, W, 1.5);
  const s = sys();
  ctx.font = '700 13px Verdana, sans-serif';
  ctx.letterSpacing = '2px';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#7fdcff';
  ctx.fillText(s.name + ' · ' + GOV[s.gov] + ' · TECH ' + s.tech, 24, 23);
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(190,215,240,0.9)';
  ctx.fillText(G.mode === 'docked' ? 'DOCKED — ' + G.screen.toUpperCase() : G.mode === 'flight' ? 'OPEN SPACE' : '', W / 2, 23);
  ctx.textAlign = 'right';
  const eco = s.economy < 0.35 ? 'AGRICULTURAL' : s.economy > 0.65 ? 'INDUSTRIAL' : 'MIXED';
  ctx.fillStyle = s.economy < 0.35 ? '#5aff9e' : s.economy > 0.65 ? '#ff8c42' : 'rgba(190,215,240,0.9)';
  ctx.fillText(eco, W - 24, 23);
  ctx.letterSpacing = '0px';
}
// ---------- docked screens ----------
function drawDocked() {
  ctx.fillStyle = '#05060c';
  ctx.fillRect(VX, VY, VVW, VVH);
  const px = 90, pw = W - 180;
  // tab bar: the four rooms of the station, plus the door
  const TABS = [['status', 'STATUS [1]'], ['market', 'MARKET [2]'], ['equip', 'OUTFIT [3]'], ['map', 'CHART [4]'], ['launch', 'LAUNCH [L]']];
  TABS.forEach(([id, nm], i) => {
    const tx3 = 90 + i * 224, ty3 = VY + 8, tw3 = 208, th3 = 26;
    const on = G.screen === id;
    const hov2 = mouse.x > tx3 && mouse.x < tx3 + tw3 && mouse.y > ty3 && mouse.y < ty3 + th3;
    ctx.fillStyle = on ? 'rgba(51,214,255,0.18)' : hov2 ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)';
    ctx.strokeStyle = on ? '#33d6ff' : 'rgba(160,195,230,0.35)';
    ctx.lineWidth = on ? 1.8 : 1;
    ctx.fillRect(tx3, ty3, tw3, th3);
    ctx.strokeRect(tx3 + 0.5, ty3 + 0.5, tw3 - 1, th3 - 1);
    ctx.font = '700 10px Verdana, sans-serif';
    ctx.letterSpacing = '1px';
    ctx.textAlign = 'center';
    ctx.fillStyle = on ? '#ffffff' : 'rgba(190,215,240,0.8)';
    ctx.fillText(nm, tx3 + tw3 / 2, ty3 + 17);
    ctx.letterSpacing = '0px';
  });
  if (G.screen === 'status') {
    // the Kestrel rotating on a plinth
    ctx.save();
    ctx.beginPath(); ctx.rect(VX, VY, VVW, VVH); ctx.clip();
    const t = G.time * 0.5;
    const fwd = norm3(v3(Math.sin(t), 0.22, Math.cos(t)));
    const up = v3(0, 1, 0);
    const savedPos = G.pos, savedFwd = G.fwd, savedUp = G.up, savedRight = G.right;
    G.pos = v3(0, 0, 0); G.fwd = v3(0, 0, 1); G.up = v3(0, 1, 0); G.right = v3(1, 0, 0);
    drawWire(HULLS.kestrel, v3(0, -12, 320), fwd, up, '#33d6ff', true);
    G.pos = savedPos; G.fwd = savedFwd; G.up = savedUp; G.right = savedRight;
    ctx.restore();
    ctx.font = '900 26px "Arial Black", Arial, sans-serif';
    ctx.letterSpacing = '4px';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e8f4ff';
    ctx.fillText('KESTREL MK-I', W / 2, VY + 52);
    ctx.letterSpacing = '0px';
    ctx.font = `700 12px ${MONO}`;
    ctx.fillStyle = 'rgba(190,215,240,0.85)';
    const lines = [
      `COMMANDER — RATING: ${rankOf(G.kills)}`,
      `CREDITS ${G.credits.toFixed(0)} · KILLS ${G.kills} · JUMPS ${G.stats.jumps}`,
      `LEGAL: ${G.wanted ? 'FUGITIVE ' + G.wanted : 'CLEAN'} · HULL ${Math.ceil(G.hull)}%`,
      `EQUIPMENT: ${[G.hasBigBay && 'BIG BAY', G.hasDockComp && 'DOCK-COMP'].filter(Boolean).join(' · ') || 'STOCK'}`,
    ];
    lines.forEach((l, i) => ctx.fillText(l, W / 2, VY + VVH - 96 + i * 20));
  } else if (G.screen === 'market') {
    ctx.font = '900 20px "Arial Black", Arial, sans-serif';
    ctx.letterSpacing = '3px';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd12a';
    ctx.fillText('COMMODITY MARKET', W / 2, VY + 44);
    ctx.letterSpacing = '0px';
    ctx.font = `700 11px ${MONO}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(150,180,215,0.75)';
    ctx.fillText('COMMODITY', px, VY + 82);
    ctx.fillText('PRICE', px + 300, VY + 82);
    ctx.fillText('HELD', px + 420, VY + 82);
    ctx.fillText('BUY [Q-U] · SELL [A-J]', px + 540, VY + 82);
    GOODS.forEach((g, i) => {
      const y = VY + 124 + i * 44;
      const p = priceOf(g, sys());
      const held = G.cargo[g.name] || 0;
      const hov = mouse.y > y - 18 && mouse.y < y + 12;
      if (hov) { ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(px - 12, y - 22, pw + 24, 38); }
      ctx.font = `700 13px ${MONO}`;
      ctx.fillStyle = g.illegal ? '#ff8c9e' : 'rgba(225,240,255,0.95)';
      ctx.fillText(g.name + (g.illegal ? ' ⚠' : ''), px, y);
      ctx.fillStyle = '#ffd12a';
      ctx.fillText(p + ' cr', px + 300, y);
      ctx.fillStyle = held ? '#5aff9e' : 'rgba(160,195,230,0.5)';
      ctx.fillText(held + 't', px + 420, y);
      // buy / sell buttons, each wearing its key
      const bk = ['Q', 'W', 'E', 'R', 'T', 'Y', 'U'][i], sk = ['A', 'S', 'D', 'F', 'G', 'H', 'J'][i];
      drawBtn(px + 540, y - 17, 90, 26, `BUY [${bk}]`, G.credits >= p && cargoTons() < G.cargoCap);
      drawBtn(px + 650, y - 17, 90, 26, `SELL [${sk}]`, held > 0);
    });
  } else if (G.screen === 'equip') {
    ctx.font = '900 20px "Arial Black", Arial, sans-serif';
    ctx.letterSpacing = '3px';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#5fd4ff';
    ctx.fillText('SHIPYARD OUTFITTING', W / 2, VY + 44);
    ctx.letterSpacing = '0px';
    EQUIP.forEach((e, i) => {
      const y = VY + 124 + i * 52;
      const can = e.can();
      const c = e.cost();
      ctx.font = `700 13px ${MONO}`;
      ctx.textAlign = 'left';
      ctx.fillStyle = can ? 'rgba(225,240,255,0.95)' : 'rgba(160,195,230,0.4)';
      ctx.fillText(e.name, px, y);
      ctx.fillStyle = can ? '#ffd12a' : 'rgba(160,170,150,0.5)';
      ctx.fillText(c + ' cr', px + 360, y);
      drawBtn(px + 520, y - 17, 110, 28, !can ? 'FULL' : G.credits >= c ? 'INSTALL' : 'NEED CR', can && G.credits >= c);
    });
  } else if (G.screen === 'map') {
    drawMap();
  }
}
function drawBtn(x, y, w, h, txt, enabled) {
  ctx.fillStyle = enabled ? 'rgba(51,214,255,0.15)' : 'rgba(255,255,255,0.03)';
  ctx.strokeStyle = enabled ? hexA('#33d6ff', 0.7) : 'rgba(160,195,230,0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 5); ctx.fill(); ctx.stroke();
  ctx.font = '700 10px Verdana, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = enabled ? '#e8f4ff' : 'rgba(160,195,230,0.4)';
  ctx.fillText(txt, x + w / 2, y + h / 2 + 4);
  ctx.textAlign = 'left';
}
function mapGeom() {
  const mx = 150, my = VY + 40, mw = W - 300, mh = VVH - 80;
  return { mx, my, mw, mh, sx: mw / 500, sy: mh / 320 };
}
function drawMap() {
  const { mx, my, mw, mh, sx, sy } = mapGeom();
  ctx.strokeStyle = 'rgba(160,195,230,0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(mx, my, mw, mh);
  ctx.font = '900 16px "Arial Black", Arial, sans-serif';
  ctx.letterSpacing = '3px';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#b06bff';
  ctx.fillText('GALACTIC CHART', W / 2, VY + 28);
  ctx.letterSpacing = '0px';
  const cur = sys();
  // fuel range ring
  ctx.strokeStyle = hexA('#ffd12a', 0.4);
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.ellipse(mx + cur.x * sx, my + cur.y * sy, G.fuel * 28 * sx, G.fuel * 28 * sy, 0, 0, 7);
  ctx.stroke();
  ctx.setLineDash([]);
  for (const s of GALAXY) {
    const x = mx + s.x * sx, y = my + s.y * sy;
    const here = s.id === G.sysId, sel = s.id === G.mapSel;
    const inRange = distLY(cur, s) <= G.fuel;
    ctx.fillStyle = here ? '#5aff9e' : s.economy < 0.35 ? hexA('#5aff9e', 0.7) : s.economy > 0.65 ? hexA('#ff8c42', 0.75) : 'rgba(200,220,255,0.7)';
    ctx.beginPath(); ctx.arc(x, y, here ? 5 : 3.2, 0, 7); ctx.fill();
    if (sel) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(x, y, 9, 0, 7); ctx.stroke();
      ctx.font = `700 11px ${MONO}`;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffffff';
      const d = distLY(cur, s);
      ctx.fillText(`${s.name} · ${d.toFixed(1)} LY · ${GOV[s.gov]} · ${s.economy < 0.35 ? 'AGRI' : s.economy > 0.65 ? 'INDUST' : 'MIXED'}${inRange ? '' : ' · OUT OF RANGE'}`, mx + 8, my + mh - 10);
    } else {
      ctx.font = '600 8px Verdana, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(160,195,230,0.55)';
      ctx.fillText(s.name, x, y - 8);
    }
  }
  ctx.font = `700 9px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(150,180,215,0.8)';
  ctx.fillText('CLICK A STAR · GREEN=AGRI · ORANGE=INDUSTRIAL · RING=FUEL RANGE · J JUMPS', mx + 8, my + 16);
}
function drawTitle() {
  ctx.fillStyle = '#05060c';
  ctx.fillRect(0, 0, W, H);
  // a jackal prowls behind the title
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
  const t = G.time * 0.4;
  G.pos = v3(0, 0, 0); G.fwd = v3(0, 0, 1); G.up = v3(0, 1, 0); G.right = v3(1, 0, 0);
  srand(0x57a5);
  ctx.fillStyle = 'rgba(200,220,255,0.5)';
  for (let i = 0; i < 110; i++) {
    ctx.globalAlpha = rng(0.15, 0.7);
    ctx.fillRect(rng(0, W), rng(0, H), 1.4, 1.4);
  }
  ctx.globalAlpha = 0.75;
  drawWire(HULLS.jackal, v3(Math.sin(t) * 120, -40 + Math.cos(t * 0.7) * 40, 420), norm3(v3(Math.cos(t), 0.3, Math.sin(t))), v3(0, 1, 0), '#ff2e6d', true);
  drawWire(HULLS.kestrel, v3(-Math.sin(t) * 160, 60, 520), norm3(v3(-Math.cos(t * 0.8), -0.2, Math.sin(t * 0.8))), v3(0, 1, 0), '#33d6ff', true);
  ctx.globalAlpha = 1;
  ctx.restore();
  const by = 108, bh = 310;
  ctx.fillStyle = 'rgba(5,8,15,0.88)';
  ctx.fillRect(0, by, W, bh);
  ctx.save();
  ctx.shadowColor = '#33d6ff'; ctx.shadowBlur = 9;
  ctx.fillStyle = 'rgba(51,214,255,0.6)';
  ctx.fillRect(0, by, W, 1.5);
  ctx.fillRect(0, by + bh - 1.5, W, 1.5);
  ctx.restore();
  ctx.textAlign = 'center';
  const ly = 240;
  ctx.font = '900 92px "Arial Black", Arial, sans-serif';
  ctx.letterSpacing = '10px';
  ctx.save();
  ctx.shadowColor = '#33d6ff'; ctx.shadowBlur = 18;
  ctx.fillStyle = '#7fdcff'; ctx.fillText('NEON ELITE', W / 2, ly);
  ctx.shadowBlur = 4;
  ctx.fillStyle = '#ffffff'; ctx.fillText('NEON ELITE', W / 2, ly);
  ctx.restore();
  ctx.letterSpacing = '5px';
  ctx.font = '600 17px Verdana, sans-serif';
  ctx.fillStyle = '#7fb0d0';
  ctx.fillText('A TRIBUTE TO ELITE', W / 2, ly + 46);
  const a = (Math.sin(G.time * 4) + 1) / 2 * 0.45 + 0.55;
  ctx.globalAlpha = a;
  ctx.font = '900 24px "Arial Black", Arial, sans-serif';
  ctx.letterSpacing = '3px';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#33d6ff'; ctx.shadowBlur = 12;
  ctx.fillText('PRESS SPACE TO UNDOCK', W / 2, ly + 118);
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  ctx.font = '600 13px Verdana, sans-serif';
  ctx.letterSpacing = '3px';
  ctx.fillStyle = 'rgba(180,210,235,0.95)';
  ctx.fillText('100 CREDITS. A KESTREL. FORTY-EIGHT WORLDS THAT DO NOT CARE.', W / 2, 468);
  ctx.fillStyle = 'rgba(160,190,220,0.85)';
  ctx.fillText('TRADE · FIGHT · DOCK BY HAND · CLIMB FROM HARMLESS TO ELITE', W / 2, 496);
  ctx.letterSpacing = '0px';
}
function draw() {
  if (G.showTitle) { drawTitle(); return; }
  ctx.fillStyle = '#05060c';
  ctx.fillRect(0, 0, W, H);
  if (G.mode === 'flight' || G.mode === 'dead' || G.mode === 'dying') drawScene();
  else drawDocked();
  drawTopBar();
  if (G.mode !== 'dead') drawHUD();
  if (G.mode === 'dead') {
    ctx.fillStyle = 'rgba(4,5,10,0.65)';
    ctx.fillRect(0, 0, W, H);
    banner('SIGNAL LOST', '#ff5c5c', `${G.deathWhy || ''} · RATING ${rankOf(G.kills)} · ${G.kills} KILLS · ${G.stats.jumps} JUMPS`);
    bannerButton('NEW COMMANDER · SPACE', '#ff5c5c');
  }
}
function banner(title, color, sub) {
  ctx.save();
  const by = H / 2 - 78, bh = 140;
  ctx.fillStyle = 'rgba(5,8,15,0.94)';
  ctx.fillRect(0, by, W, bh);
  ctx.save();
  ctx.shadowColor = color; ctx.shadowBlur = 10;
  ctx.fillStyle = color;
  ctx.fillRect(0, by, W, 2);
  ctx.fillRect(0, by + bh - 2, W, 2);
  ctx.restore();
  ctx.textAlign = 'center';
  ctx.font = '900 40px "Arial Black", Arial, sans-serif';
  ctx.letterSpacing = '5px';
  ctx.shadowColor = color; ctx.shadowBlur = 24;
  ctx.fillStyle = color;
  ctx.fillText(title, W / 2, by + 58);
  ctx.shadowBlur = 0;
  ctx.font = '600 14px Verdana, sans-serif';
  ctx.letterSpacing = '3px';
  ctx.fillStyle = 'rgba(225,240,255,0.92)';
  ctx.fillText(sub, W / 2, by + 96);
  ctx.letterSpacing = '0px';
  ctx.restore();
}
function bannerButton(label2, color) {
  const bw2 = 300, bh2 = 40, bx2 = W / 2 - bw2 / 2, by2 = H / 2 + 76;
  const hov = mouse.x > bx2 && mouse.x < bx2 + bw2 && mouse.y > by2 && mouse.y < by2 + bh2;
  ctx.save();
  ctx.fillStyle = hov ? hexA(color, 0.3) : hexA(color, 0.12);
  ctx.strokeStyle = color; ctx.lineWidth = hov ? 2.5 : 1.5;
  ctx.beginPath(); ctx.roundRect(bx2, by2, bw2, bh2, 8); ctx.fill(); ctx.stroke();
  ctx.font = '800 15px Verdana, sans-serif';
  ctx.letterSpacing = '2px';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label2, W / 2, by2 + 26);
  ctx.letterSpacing = '0px';
  ctx.restore();
}

// ---------- input ----------
const keys = {};
let mouse = { x: 0, y: 0 };
window.addEventListener('keydown', e => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  keys[k] = true;
  if (e.key === ' ') e.preventDefault();
  audio();
  if (G.showTitle && (e.key === ' ' || e.key === 'Enter')) { G.showTitle = false; newGame((Math.random() * 1e9) >>> 0, {}); return; }
  if (G.mode === 'dead' && e.key === ' ' && G.modeT > 0.6) { newGame((Math.random() * 1e9) >>> 0, {}); return; }
  if (G.mode === 'docked') {
    if (G.screen === 'market') {
      const buyKeys = ['q', 'w', 'e', 'r', 't', 'y', 'u'], sellKeys = ['a', 's', 'd', 'f', 'g', 'h', 'j'];
      const bi = buyKeys.indexOf(k), si = sellKeys.indexOf(k);
      if (bi >= 0 && bi < GOODS.length) { buyGood(bi); return; }
      if (si >= 0 && si < GOODS.length) { sellGood(si); return; }
    }
    if (k === '1') G.screen = 'status';
    if (k === '2') G.screen = 'market';
    if (k === '3') G.screen = 'equip';
    if (k === '4') G.screen = 'map';
    if (k === 'l') launch();
  } else if (G.mode === 'flight') {
    if (k === ' ') fireLaser();
    if (k === 'm') fireMissile();
    if (k === 'j') startJump(G.mapSel);
    if (k === 'c' && G.hasDockComp) { G.autoDockT = 60; say('Docking computer engaged.'); }
    if (k === 'g') G.screen = G.screen === 'map' ? 'status' : 'map';
  }
});
window.addEventListener('keyup', e => { keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = false; });
canvas.addEventListener('mousemove', e => {
  const r = canvas.getBoundingClientRect();
  mouse.x = (e.clientX - r.left) * (W / r.width);
  mouse.y = (e.clientY - r.top) * (H / r.height);
  canvas.style.cursor = (G && (G.mode === 'docked' || G.mode === 'dead' || G.showTitle)) ? 'pointer' : 'crosshair';
});
canvas.addEventListener('mousedown', () => {
  audio();
  if (G.showTitle) { G.showTitle = false; newGame((Math.random() * 1e9) >>> 0, {}); return; }
  if (G.mode === 'dead' && G.modeT > 0.6) {
    const bx2 = W / 2 - 150, by2 = H / 2 + 76;
    if (mouse.x > bx2 && mouse.x < bx2 + 300 && mouse.y > by2 && mouse.y < by2 + 40) newGame((Math.random() * 1e9) >>> 0, {});
    return;
  }
  if (G.mode === 'docked') {
    const px = 90;
    // tabs
    const TABS2 = ['status', 'market', 'equip', 'map', 'launch'];
    TABS2.forEach((id, i) => {
      const tx3 = 90 + i * 224, ty3 = VY + 8;
      if (mouse.x > tx3 && mouse.x < tx3 + 208 && mouse.y > ty3 && mouse.y < ty3 + 26) {
        if (id === 'launch') launch(); else G.screen = id;
      }
    });
    if (G.screen === 'market') {
      GOODS.forEach((g, i) => {
        const y = VY + 124 + i * 44;
        if (mouse.y > y - 17 && mouse.y < y + 9) {
          if (mouse.x > px + 540 && mouse.x < px + 630) buyGood(i);
          if (mouse.x > px + 650 && mouse.x < px + 740) sellGood(i);
        }
      });
    } else if (G.screen === 'equip') {
      EQUIP.forEach((e2, i) => {
        const y = VY + 124 + i * 52;
        if (mouse.y > y - 17 && mouse.y < y + 11 && mouse.x > px + 520 && mouse.x < px + 630) buyEquip(i);
      });
    } else if (G.screen === 'map') {
      const { mx, my, sx, sy } = mapGeom();
      let best = null, bd = 20;
      for (const s of GALAXY) {
        const d = Math.hypot(mx + s.x * sx - mouse.x, my + s.y * sy - mouse.y);
        if (d < bd) { bd = d; best = s; }
      }
      if (best) { G.mapSel = best.id; blip(600, 750, 0.06, 'sine', 0.05); }
    }
  } else if (G.mode === 'flight') {
    if (G.screen === 'map') {
      const { mx, my, sx, sy } = mapGeom();
      let best = null, bd = 20;
      for (const s of GALAXY) {
        const d = Math.hypot(mx + s.x * sx - mouse.x, my + s.y * sy - mouse.y);
        if (d < bd) { bd = d; best = s; }
      }
      if (best) { G.mapSel = best.id; blip(600, 750, 0.06, 'sine', 0.05); }
    } else fireLaser();
  }
});
function pollFlightKeys(dt) {
  if (G.mode !== 'flight') return;
  const pitchRate = 1.15, rollRate = 1.9;
  let pitch = 0, roll = 0;
  if (keys.ArrowUp) pitch = -pitchRate;
  if (keys.ArrowDown) pitch = pitchRate;
  if (keys.ArrowLeft) roll = -rollRate;
  if (keys.ArrowRight) roll = rollRate;
  applyPitchRoll(pitch, roll, dt);
  if (keys.w) G.throttle = clamp(G.throttle + dt * 0.8, 0, 1);
  if (keys.s) G.throttle = clamp(G.throttle - dt * 0.8, 0, 1);
}

// ---------- main loop ----------
let last = 0, acc = 0;
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min((t - last) / 1000, 1 / 15);
  last = t;
  acc += dt;
  let n = 0;
  while (acc >= SIMSTEP && n < 5) { pollFlightKeys(SIMSTEP); sim(SIMSTEP); acc -= SIMSTEP; n++; }
  if (G.mode === 'flight' && G.screen === 'map') {
    ctx.fillStyle = '#05060c'; ctx.fillRect(0, 0, W, H);
    drawMap(); drawTopBar(); drawHUD();
  } else draw();
}

// ---------- harness: voyages as theorems ----------
function stepFor(s) { const n2 = Math.round(s / SIMSTEP); for (let i = 0; i < n2; i++) sim(SIMSTEP); }
function stepUntil(cond, cap) { let n2 = 0; while (!cond() && n2 < cap) { sim(SIMSTEP); n2++; } return n2; }
// steer the nose toward a world point using only pitch and roll (the canon constraint).
// Sign-agnostic: probe candidate micro-rotations and keep whichever closes the angle —
// immune to handedness mistakes by construction.
function frameAfter(pitch, roll, dt) {
  const save = [G.fwd, G.up, G.right];
  applyPitchRoll(pitch, roll, dt);
  const out = [G.fwd, G.up, G.right];
  [G.fwd, G.up, G.right] = save;
  return out;
}
function angleWith(fwd, target) {
  const rel = norm3(sub3(target, G.pos));
  return Math.acos(clamp(dot3(rel, fwd), -1, 1));
}
function steerToward(target, dt, rollGoal) {
  const pitchRate = 1.15, rollRate = 1.9;
  let bestP = 0, bestR = 0, bestA = angleWith(G.fwd, target);
  for (const p of [-pitchRate, 0, pitchRate]) {
    for (const r of [-rollRate, 0, rollRate]) {
      if (p === 0 && r === 0) continue;
      const [f2] = frameAfter(p, r, dt);
      const a2 = angleWith(f2, target);
      if (a2 < bestA - 1e-6) { bestA = a2; bestP = p; bestR = r; }
    }
  }
  if (rollGoal !== undefined) {
    // docking: roll converges on the slot angle while pitch alone tracks the target
    const upErr = ang => {
      let d = rollGoal - ang;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      return Math.abs(d);
    };
    let rollPick = 0, err0 = upErr(Math.atan2(G.up[0], G.up[1]));
    for (const r of [-rollRate, rollRate]) {
      const [, u2] = frameAfter(0, r, dt);
      if (upErr(Math.atan2(u2[0], u2[1])) < err0 - 1e-6) { rollPick = r; err0 = upErr(Math.atan2(u2[0], u2[1])); }
    }
    // pitch: best pitch-only candidate
    let pitchPick = 0, a0 = angleWith(G.fwd, target);
    for (const p of [-pitchRate, pitchRate]) {
      const [f2] = frameAfter(p, 0, dt);
      if (angleWith(f2, target) < a0 - 1e-6) { pitchPick = p; a0 = angleWith(f2, target); }
    }
    applyPitchRoll(pitchPick, rollPick, dt);
    return;
  }
  applyPitchRoll(bestP, bestR, dt);
}
function angleTo(target) {
  const v = worldToView(target);
  return Math.atan2(Math.hypot(v[0], v[1]), v[2]);
}
function botFlyTo(target, arriveDist, cap, fight) {
  let n = 0;
  while (n++ < cap && G.mode === 'flight') {
    const d = len3(sub3(target(), G.pos));
    if (d < arriveDist) return true;
    steerToward(target(), SIMSTEP);
    G.throttle = angleTo(target()) < 0.5 ? 1 : 0.4;
    if (fight) botFight();
    sim(SIMSTEP);
  }
  return false;
}
function botFight() {
  // shoot any hostile in the cone; missile when shields hurt
  let best = null, bd = 1e9;
  for (const sh of G.ships) {
    if (sh.dead || !(sh.hostile || sh.type === 'jackal')) continue;
    const v = worldToView(sh.pos);
    if (v[2] < 20) continue;
    if (v[2] < bd) { bd = v[2]; best = sh; }
  }
  if (!best) return;
  const ang = angleTo(best.pos);
  if (ang < 0.055 && bd < 5200) fireLaser();
  if (G.shieldF < 30 && G.missiles > 0 && ang < 0.3) fireMissile();
}
function botDock(align) {
  // fly to the approach point, line up on the axis, then run the slot roll-matched
  const st = () => G.station.pos;
  const approach = () => add3(st(), v3(0, 0, 1500));
  if (!botFlyTo(approach, 260, 60 * 240, false)) return 'lost';
  let n = 0;
  while (n++ < 60 * 120 && G.mode === 'flight') {
    const toSt = sub3(G.pos, st());
    const slotAng = align ? G.station.spin : G.station.spin + Math.PI / 2;   // crooked runs deliberately cross-wise
    if (toSt[2] > 320) {
      steerToward(st(), SIMSTEP);            // free steering: center the axis first
      G.throttle = 0.3;
    } else {
      steerToward(st(), SIMSTEP, slotAng);   // final approach: match the spin
      G.throttle = 0.2;
    }
    sim(SIMSTEP);
    if (G.mode === 'docked') return 'docked';
    if (G.hull <= 0) return 'dead';
    if (len3(sub3(st(), G.pos)) > 2600) return 'bounced';
  }
  return 'timeout';
}
function bestTrade() {
  // choose (system, good) maximizing profit per ton within fuel range, weighted by safety
  const cur = sys();
  let best = null;
  for (const s of GALAXY) {
    if (s.id === G.sysId) continue;
    const d = distLY(cur, s);
    if (d > G.fuel) continue;
    for (let gi = 0; gi < GOODS.length; gi++) {
      const g = GOODS[gi];
      if (g.illegal) continue;
      const here = priceOf(g, cur), there = priceOf(g, s);
      const margin = there - here;
      if (margin <= 1) continue;
      const score = margin - s.danger * 6;
      if (!best || score > best.score) best = { sysId: s.id, gi, margin, score, buyAt: here };
    }
  }
  return best;
}
function runVoyage(style, maxJumps, targetCr) {
  // one full trading career, deterministic
  let legs = 0;
  while (legs < maxJumps && G.mode !== 'dead' && G.credits < targetCr) {
    // dock phase: sell everything sellable, then plan
    for (let gi = 0; gi < GOODS.length; gi++) {
      const g = GOODS[gi];
      while ((G.cargo[g.name] || 0) > 0) sellGood(gi);
    }
    // refuel
    if (G.fuel < G.maxFuel - 0.01) {
      const c = Math.ceil((7 - G.fuel) * 4);
      if (G.credits >= c) { G.credits -= c; G.fuel = G.maxFuel; }
    }
    let plan = null;
    if (style === 'trader') {
      plan = bestTrade();
      if (plan) {
        while (G.credits >= plan.buyAt && cargoTons() < G.cargoCap) buyGood(plan.gi);
      }
    } else if (style === 'random') {
      srand(G.seed ^ (legs * 2654435761));
      const gi = rand() * (GOODS.length - 1) | 0;
      const n = rand() * 6 | 0;
      for (let i = 0; i < n; i++) buyGood(gi);
      const inRange = GALAXY.filter(s => s.id !== G.sysId && distLY(sys(), s) <= G.fuel);
      if (inRange.length) plan = { sysId: inRange[rand() * inRange.length | 0].id };
    } else if (style === 'blindcargo') {
      // trades routes intelligently but buys at random: the economy ablation
      const p2 = bestTrade();
      srand(G.seed ^ (legs * 40503));
      const gi = rand() * (GOODS.length - 1) | 0;
      const g = GOODS[gi];
      while (G.credits >= priceOf(g, sys()) && cargoTons() < G.cargoCap) buyGood(gi);
      plan = p2;
    }
    if (!plan) break;
    launch();
    G.mapSel = plan.sysId;
    // fly clear of the station, then jump
    stepFor(2);
    startJump(plan.sysId);
    stepUntil(() => G.jumpT <= 0 && G.sysId === plan.sysId, 60 * 10);
    if (G.mode === 'dead') break;
    legs++;
    // fly to the new station and dock (aligned, honest physics)
    const r = botDock(true);
    if (r !== 'docked') {
      // one retry from further out
      if (G.mode !== 'flight') break;
      const r2 = botDock(true);
      if (r2 !== 'docked') break;
    }
  }
  return legs;
}
function runVerify(mode) {
  try { runVerifyInner(mode); }
  catch (e) { document.title = 'ERR:' + String(e && e.stack || e).replace(/\n/g, ' | ').slice(0, 300); }
}
function runVerifyInner(mode) {
  AUDIO_ON = false;
  const seed = 19840;
  let outcome = 'FAILED', extra = {};
  newGame(seed, {});
  if (mode === 'solution' || mode === 'null' || mode === 'ablate-economy') {
    const style = mode === 'solution' ? 'trader' : mode === 'null' ? 'random' : 'blindcargo';
    const legs = runVoyage(style, 12, 2000);
    const wealth = G.credits + cargoTons() * 20;
    outcome = mode === 'solution'
      ? (G.credits >= 1000 && G.mode !== 'dead' ? 'WON' : 'FAILED')
      : (wealth < 400 || G.mode === 'dead' ? 'LOST' : 'RICH');   // controls must NOT get rich
    extra = {
      legs, credits: Math.round(G.credits), cargo: cargoTons(),
      dead: G.mode === 'dead', docks: G.stats.docks, scrapes: G.stats.scrapes,
      profitPerLeg: legs ? Math.round((G.credits - 100) / legs) : 0,
    };
  } else if (mode === 'duel') {
    launch();
    G.ships = [];
    spawnShip('jackal');
    G.ships[0].pos = add3(G.pos, mul3(G.fwd, 3000));
    const t0 = G.time;
    stepUntil(() => {
      botFight();
      steerToward(G.ships[0].dead ? G.pos : G.ships[0].pos, SIMSTEP);
      return G.ships[0].dead || G.mode === 'dead';
    }, 60 * 120);
    outcome = G.ships[0].dead && G.mode !== 'dead' ? 'WON' : 'LOST';
    extra = { time: Math.round(G.time - t0), hull: Math.ceil(G.hull), shieldF: Math.round(G.shieldF), kills: G.kills };
  } else if (mode === 'null-gunner') {
    launch();
    G.throttle = 0; G.speed = 0;   // the null gunner neither fights nor flees
    G.ships = [];
    spawnShip('jackal'); spawnShip('jackal');
    for (const sh of G.ships) sh.pos = add3(G.pos, mul3(G.fwd, 2600));
    stepUntil(() => G.mode === 'dead' || G.mode === 'dying', 60 * 400);
    stepFor(2);
    outcome = G.mode === 'dead' ? 'LOST' : 'SURVIVED';
    extra = { hull: Math.ceil(G.hull), shieldF: Math.round(G.shieldF), shieldA: Math.round(G.shieldA) };
  } else if (mode === 'dock-aligned' || mode === 'dock-crooked') {
    launch();
    G.ships = [];
    const r = botDock(mode === 'dock-aligned');
    outcome = mode === 'dock-aligned'
      ? (r === 'docked' ? 'DOCKED' : 'FAILED')
      : (r !== 'docked' && G.stats.scrapes > 0 ? 'REPELLED' : 'FAILED');
    extra = { result: r, scrapes: G.stats.scrapes, hull: Math.ceil(G.hull) };
  } else if (mode === 'mech-prices') {
    // the economy's law: food is cheap where it grows, machinery cheap where it is made
    const agri = GALAXY.filter(s => s.economy < 0.3);
    const ind = GALAXY.filter(s => s.economy > 0.7);
    const avg = (list, g) => list.reduce((a, s) => a + priceOf(g, s), 0) / list.length;
    const foodA = avg(agri, GOODS[0]), foodI = avg(ind, GOODS[0]);
    const machA = avg(agri, GOODS[3]), machI = avg(ind, GOODS[3]);
    outcome = foodA < foodI - 1 && machI < machA - 3 ? 'SOLVED' : 'FAILED';
    extra = { foodAgri: Math.round(foodA), foodInd: Math.round(foodI), machAgri: Math.round(machA), machInd: Math.round(machI), nAgri: agri.length, nInd: ind.length };
  } else if (mode === 'mech-fuel') {
    launch();
    const cur = sys();
    const far = GALAXY.map(s => ({ s, d: distLY(cur, s) })).sort((a, b) => b.d - a.d)[0];
    const refusedFar = !startJump(far.s.id) && far.d > G.fuel;
    const near = GALAXY.map(s => ({ s, d: distLY(cur, s) })).filter(x => x.d <= G.fuel && x.s.id !== G.sysId).sort((a, b) => a.d - b.d)[0];
    const f0 = G.fuel;
    startJump(near.s.id);
    stepUntil(() => G.sysId === near.s.id, 60 * 10);
    const spent = f0 - G.fuel;
    outcome = refusedFar && Math.abs(spent - near.d) < 0.05 ? 'SOLVED' : 'FAILED';
    extra = { refusedFar, dist: Math.round(near.d * 100) / 100, spent: Math.round(spent * 100) / 100 };
  } else if (mode === 'mech-market') {
    const cr0 = G.credits;
    const p = priceOf(GOODS[0], sys());
    buyGood(0);
    const afterBuy = G.credits === cr0 - p && (G.cargo.FOOD || 0) === 1;
    sellGood(0);
    const afterSell = G.credits === cr0 && !G.cargo.FOOD;
    let capped = true;
    G.credits = 100000;
    for (let i = 0; i < 40; i++) buyGood(0);
    capped = cargoTons() === G.cargoCap;
    outcome = afterBuy && afterSell && capped ? 'SOLVED' : 'FAILED';
    extra = { afterBuy, afterSell, tons: cargoTons(), cap: G.cargoCap };
  } else if (mode === 'mech-laser') {
    launch();
    G.ships = [];
    spawnShip('jackal');
    const sh = G.ships[0];
    sh.pos = add3(G.pos, mul3(G.fwd, 900));
    const hp0 = sh.hp;
    fireLaser();
    outcome = sh.hp < hp0 ? 'SOLVED' : 'FAILED';
    extra = { hp0, hpAfter: sh.hp };
  } else if (mode === 'mech-missile') {
    launch();
    G.ships = [];
    spawnShip('jackal');
    G.ships[0].pos = add3(G.pos, mul3(G.fwd, 2000));
    fireMissile();
    stepUntil(() => G.ships[0].dead, 60 * 30);
    outcome = G.ships[0].dead ? 'SOLVED' : 'FAILED';
    extra = { missilesLeft: G.missiles };
  } else if (mode === 'mech-bounty') {
    launch();
    G.ships = [];
    spawnShip('jackal');
    const cr0 = G.credits, k0 = G.kills;
    G.ships[0].hp = 5;
    G.ships[0].pos = add3(G.pos, mul3(G.fwd, 800));
    fireLaser();
    outcome = G.kills === k0 + 1 && G.credits > cr0 ? 'SOLVED' : 'FAILED';
    extra = { bounty: G.credits - cr0, kills: G.kills };
  } else if (mode === 'mech-rank') {
    const r0 = rankOf(0), r1 = rankOf(2), r2 = rankOf(64);
    outcome = r0 === 'HARMLESS' && r1 === 'MOSTLY HARMLESS' && r2 === 'ELITE' ? 'SOLVED' : 'FAILED';
    extra = { r0, r1, r2 };
  } else if (mode === 'mech-wanted') {
    launch();
    G.ships = [];
    spawnShip('mule');
    G.ships[0].pos = add3(G.pos, mul3(G.fwd, 800));
    const w0 = G.wanted;
    fireLaser();
    outcome = G.wanted > w0 ? 'SOLVED' : 'FAILED';
    extra = { wantedBefore: w0, wantedAfter: G.wanted };
  } else if (mode === 'mech-rotation') {
    launch();
    const s0 = G.station.spin;
    stepFor(5);
    outcome = Math.abs(G.station.spin - s0 - 0.14 * 5) < 0.01 ? 'SOLVED' : 'FAILED';
    extra = { spun: Math.round((G.station.spin - s0) * 100) / 100 };
  } else if (mode === 'mech-steer') {
    // the pursuit law: pitch+roll alone must close any angle
    launch();
    G.ships = [];
    const target = add3(G.pos, mul3(norm3(v3(0.7, -0.5, -0.5)), 4000));   // behind and off-axis
    const a0 = angleTo(target);
    for (let i = 0; i < 60 * 8; i++) { steerToward(target, SIMSTEP); sim(SIMSTEP); }
    const a1 = angleTo(target);
    outcome = a1 < 0.1 && a0 > 0.9 ? 'SOLVED' : 'FAILED';
    extra = { angleBefore: Math.round(a0 * 100) / 100, angleAfter: Math.round(a1 * 100) / 100 };
  }
  const report = { mode, outcome, seed, ...extra };
  document.title = 'VERIFY:' + JSON.stringify(report);
  const el = document.createElement('pre');
  el.id = 'verify-report';
  el.textContent = document.title;
  document.body.appendChild(el);
  draw();
}
function runShot(name) {
  AUDIO_ON = false;
  newGame(19840, {});
  if (name === 'title') {
    G.showTitle = true; G.time = 1.4;
  } else if (name === 'space') {
    launch();
    G.ships = [];
    stepFor(1);
    // look back at the station with the planet behind
    steerToward(G.station.pos, 0.001);
    for (let i = 0; i < 240; i++) { steerToward(G.station.pos, SIMSTEP); sim(SIMSTEP); }
  } else if (name === 'duel') {
    launch();
    G.ships = [];
    spawnShip('jackal');
    G.ships[0].pos = add3(G.pos, add3(mul3(G.fwd, 700), mul3(G.right, 80)));
    G.ships[0].fwd = mul3(G.fwd, -1);
    stepFor(0.3);
    fireLaser();
    draw();
    document.title = 'shot-ready';
    return;
  } else if (name === 'dock') {
    launch();
    G.ships = [];
    // approach the slot, camera lined up
    G.pos = add3(G.station.pos, v3(30, -20, -900));
    for (let i = 0; i < 120; i++) { steerToward(G.station.pos, SIMSTEP, G.station.spin); sim(SIMSTEP); G.throttle = 0.2; }
  } else if (name === 'market') {
    G.screen = 'market';
    G.cargo = { FOOD: 5, COMPUTERS: 2 };
  } else if (name === 'equip') {
    G.screen = 'equip';
    G.credits = 800;
  } else if (name === 'map') {
    G.screen = 'map';
    G.mapSel = 7;
  } else if (name === 'status') {
    G.screen = 'status';
    G.kills = 13; G.credits = 1450;
    G.time = 0.8;
  } else if (name === 'jump') {
    launch();
    G.ships = [];
    const near = GALAXY.map(s => ({ s, d: distLY(sys(), s) })).filter(x => x.d <= G.fuel && x.s.id !== G.sysId)[0];
    startJump(near.s.id);
    stepFor(1.4);
  } else if (name === 'battle') {
    launch();
    G.ships = [];
    spawnShip('jackal'); spawnShip('jackal'); spawnShip('warden');
    G.ships.forEach((sh, i) => { sh.pos = add3(G.pos, add3(mul3(G.fwd, 1000 + i * 500), mul3(G.right, (i - 1) * 400))); });
    G.shieldF = 55; G.hull = 82;
    stepFor(0.4);
    fireLaser();
    draw();
    document.title = 'shot-ready';
    return;
  } else if (name === 'dead') {
    G.mode = 'dead'; G.kills = 8; G.credits = 743; G.stats.jumps = 9;
  }
  draw();
  document.title = 'shot-ready';
}

const q = new URLSearchParams(location.search);
const shotName = q.get('shot');
const verifyMode = q.get('verify');
if (shotName) runShot(shotName);
else if (verifyMode !== null) runVerify(verifyMode || 'solution');
else { newGame(445566, { attract: true }); requestAnimationFrame(t => { last = t; requestAnimationFrame(frame); }); }
