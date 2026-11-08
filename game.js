'use strict';
// Parkour Run — an endless rooftop runner.
// Controls: Space/W/Up = jump (press again in the air to double jump),
// S/Down = slide (in the air: drop fast), P/Esc = pause.
// Touch: tap the right side to jump, hold the left side to slide.

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

// ---------- Tuning ----------
const GRAVITY = 2600;
const JUMP_V = 860;          // first jump
const AIR_JUMP_V = 760;      // double jump
const JUMP_CUT = 0.45;       // releasing jump early cuts upward speed
const FAST_FALL_V = 1300;
const START_SPEED = 400;
const MAX_SPEED = 950;
const ACCEL = 9;             // px/s gained per second
const COYOTE = 0.1;
const JUMP_BUFFER = 0.12;
const STAND_H = 62, SLIDE_H = 28;
const AIR_TIME = 2 * JUMP_V / GRAVITY;
const STEP = 1 / 120;

// ---------- View ----------
let W = 960, H = 540, scale = 1, dpr = 1, offY = 0;
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const r = canvas.getBoundingClientRect();
  const vw = r.width || window.innerWidth, vh = r.height || window.innerHeight;
  // Keep at least 540 units tall and 760 units wide visible.
  scale = Math.min(vh / 540, vw / 760);
  W = vw / scale;
  H = vh / scale;
  offY = (H - 540) / 2; // world 0..540 is centered vertically
  canvas.width = Math.round(vw * dpr);
  canvas.height = Math.round(vh * dpr);
}
window.addEventListener('resize', resize);
resize();

// ---------- Helpers ----------
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
function mixColor(c1, c2, t) {
  const p = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const a = p(c1), b = p(c2);
  return `rgb(${Math.round(lerp(a[0], b[0], t))},${Math.round(lerp(a[1], b[1], t))},${Math.round(lerp(a[2], b[2], t))})`;
}
function overlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// ---------- Storage (may be unavailable) ----------
function loadBest() { try { return +localStorage.getItem('parkour-run-best') || 0; } catch (e) { return 0; } }
function saveBest(v) { try { localStorage.setItem('parkour-run-best', String(v)); } catch (e) { /* ignore */ } }
let best = loadBest();
let muted = false;
try { muted = localStorage.getItem('parkour-run-muted') === '1'; } catch (e) { /* ignore */ }

// ---------- Sound ----------
let audio = null;
function initAudio() {
  if (audio) { if (audio.state === 'suspended') audio.resume(); return; }
  try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audio = null; }
}
function tone(freq, dur, type = 'square', vol = 0.06, slide = 0) {
  if (!audio || muted) return;
  const t = audio.currentTime;
  const o = audio.createOscillator(), g = audio.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(audio.destination);
  o.start(t); o.stop(t + dur);
}
const sfx = {
  jump: () => tone(330, 0.12, 'square', 0.05, 300),
  air: () => tone(520, 0.12, 'square', 0.05, 400),
  land: () => tone(120, 0.06, 'triangle', 0.08, -40),
  coin: () => { tone(988, 0.06, 'square', 0.04); setTimeout(() => tone(1319, 0.1, 'square', 0.04), 55); },
  slide: () => tone(200, 0.15, 'sawtooth', 0.025, -120),
  nice: () => tone(660, 0.08, 'triangle', 0.06, 220),
  die: () => { tone(300, 0.4, 'sawtooth', 0.07, -250); setTimeout(() => tone(90, 0.35, 'triangle', 0.09, -40), 120); },
  milestone: () => { [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.1, 'square', 0.04), i * 70)); },
};

// ---------- Background (parallax skyline) ----------
const LAYERS = [
  { f: 0.1, tile: 1600, min: 140, max: 300, col: ['#3a2f6b', '#2a3a6e', '#1d1840'] },
  { f: 0.25, tile: 1800, min: 90, max: 240, col: ['#2b2257', '#1f2c58', '#151230'] },
  { f: 0.45, tile: 2000, min: 60, max: 190, col: ['#1e1842', '#172243', '#0e0c22'] },
];
for (const L of LAYERS) {
  L.b = [];
  let x = 0;
  while (x < L.tile) {
    const w = rand(50, 140);
    const h = rand(L.min, L.max);
    L.b.push({ x, w: Math.min(w, L.tile - x), h, ant: Math.random() < 0.25, seed: Math.random() * 1000 });
    x += w + rand(0, 12);
  }
}
const stars = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random() * 0.6, s: rand(0.6, 1.8), p: rand(0, 6) }));

// Sky palettes cycle with distance: dusk -> night -> dawn -> day
const SKIES = [
  { top: '#ff7a59', bot: '#ffd29a', sun: '#fff1c1', night: 0 },
  { top: '#14122b', bot: '#3b2a63', sun: '#e8e6ff', night: 1 },
  { top: '#5a4fcf', bot: '#ff9fb1', sun: '#ffe7d6', night: 0.4 },
  { top: '#3aa0ff', bot: '#bfe6ff', sun: '#fffbe0', night: 0 },
];
function skyAt(dist) {
  const cyc = 6000; // metres per full sky phase
  const p = (dist / cyc) % SKIES.length;
  const i = Math.floor(p), t = p - i;
  const s = t < 0.75 ? 0 : (t - 0.75) / 0.25; // hold, then blend
  const A = SKIES[i], B = SKIES[(i + 1) % SKIES.length];
  return { top: mixColor(A.top, B.top, s), bot: mixColor(A.bot, B.bot, s), sun: mixColor(A.sun, B.sun, s), night: lerp(A.night, B.night, s) };
}

// ---------- Game state ----------
let state = 'menu'; // menu | play | pause | over
let player, buildings, obstacles, coins, particles, texts;
let camX, speed, dist, coinCount, bonus, shake, time, deathTimer, flash, nextMilestone, newBest;

function reset() {
  player = {
    x: 0, y: 400, vy: 0, onGround: true, jumps: 1, coyote: 0, buffer: 0,
    sliding: false, slideTime: 0, phase: 0, squash: 0, dead: false, holdJump: false, spin: 0,
  };
  buildings = [{ x: -600, w: 1900, y: 400, seed: Math.random() * 1000 }];
  obstacles = []; coins = []; particles = []; texts = [];
  camX = -220; speed = START_SPEED; dist = 0; coinCount = 0; bonus = 0;
  shake = 0; time = 0; deathTimer = 0; flash = 0; nextMilestone = 500; newBest = false;
  while (buildings[buildings.length - 1].x < 3000) addBuilding();
}

function difficulty() { return clamp(dist / 4000, 0, 1); }

function addBuilding() {
  const last = buildings[buildings.length - 1];
  const d = difficulty();
  const reach = Math.max(speed, START_SPEED) * AIR_TIME; // single-jump distance at current speed
  const y = clamp(last.y + rand(-70, 70) * (0.4 + d * 0.6), 310, 450);
  const up = Math.max(0, last.y - y);
  const gapMax = Math.max(reach * 0.25, reach * lerp(0.45, 0.7, d) - up * 1.4);
  const gap = rand(reach * 0.18, gapMax);
  const w = rand(lerp(700, 380, d), lerp(1300, 900, d));
  const b = { x: last.x + last.w + gap, w, y, seed: Math.random() * 1000 };
  buildings.push(b);

  // Coins in an arc over the gap
  if (Math.random() < 0.6) {
    const n = Math.max(3, Math.floor(gap / 45));
    const x0 = last.x + last.w, y0 = Math.min(last.y, y);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      coins.push({ x: x0 + gap * t, y: y0 - 70 - Math.sin(t * Math.PI) * 80, got: false, t: Math.random() * 6 });
    }
  }

  // Obstacles on the roof
  const pad = 140;
  let x = b.x + pad + rand(0, 120);
  const spacing = Math.max(reach * 0.95, 320);
  while (x < b.x + b.w - pad - 40) {
    if (Math.random() < lerp(0.45, 0.85, d)) {
      const r = Math.random();
      let o;
      if (r < 0.4) o = { type: 'barrier', x, w: 34, h: 42 };
      else if (r < 0.7 + (1 - d) * 0.1) o = { type: 'beam', x, w: 90, h: 110, gapH: 40 };
      else o = { type: 'crate', x, w: 62, h: 66 };
      if (o.type === 'beam') { o.y = b.y - o.gapH - o.h; } else { o.y = b.y - o.h; }
      o.roof = b.y; o.passed = false;
      obstacles.push(o);
      // Row of coins to reward the right move
      if (Math.random() < 0.45) {
        const cy = o.type === 'beam' ? b.y - 16 : o.y - 40;
        for (let i = -1; i <= 1; i++) coins.push({ x: x + o.w / 2 + i * 32, y: cy, got: false, t: Math.random() * 6 });
      }
      x += spacing + rand(0, 200);
    } else {
      if (Math.random() < 0.4) {
        for (let i = 0; i < 5; i++) coins.push({ x: x + i * 36, y: b.y - 30, got: false, t: Math.random() * 6 });
      }
      x += rand(180, 300);
    }
  }
}

// ---------- Input ----------
const keys = { jump: false, slide: false };
let touchSlideId = null;

function pressJump() {
  initAudio();
  if (state === 'menu' || (state === 'over' && deathTimer > 0.6)) { startGame(); return; }
  if (state === 'pause') { state = 'play'; return; }
  if (state !== 'play') return;
  player.buffer = JUMP_BUFFER;
  player.holdJump = true;
}
function releaseJump() {
  player && (player.holdJump = false);
  if (player && player.vy < 0) player.vy *= JUMP_CUT;
}
function startGame() { reset(); state = 'play'; }
function togglePause() {
  if (state === 'play') state = 'pause';
  else if (state === 'pause') state = 'play';
}
function toggleMute() {
  muted = !muted;
  try { localStorage.setItem('parkour-run-muted', muted ? '1' : '0'); } catch (e) { /* ignore */ }
}

window.addEventListener('keydown', e => {
  const k = e.code;
  if (['Space', 'ArrowUp', 'KeyW'].includes(k)) {
    e.preventDefault();
    if (!e.repeat) { keys.jump = true; pressJump(); }
  } else if (['ArrowDown', 'KeyS'].includes(k)) {
    e.preventDefault(); keys.slide = true;
  } else if (k === 'KeyP' || k === 'Escape') {
    togglePause();
  } else if (k === 'KeyM') {
    toggleMute();
  } else if (k === 'Enter' && (state === 'menu' || state === 'over')) {
    pressJump();
  }
});
window.addEventListener('keyup', e => {
  const k = e.code;
  if (['Space', 'ArrowUp', 'KeyW'].includes(k)) { keys.jump = false; releaseJump(); }
  else if (['ArrowDown', 'KeyS'].includes(k)) keys.slide = false;
});

// UI buttons (pause / mute), in screen units
function uiButtons() {
  return [
    { id: 'pause', x: W - 56, y: 14, w: 42, h: 42 },
    { id: 'mute', x: W - 106, y: 14, w: 42, h: 42 },
  ];
}
function hitButton(px, py) {
  if (state !== 'play' && state !== 'pause') return null;
  for (const b of uiButtons()) if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return b.id;
  return null;
}
function toGame(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return { x: (clientX - r.left) / scale, y: (clientY - r.top) / scale };
}

canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  initAudio();
  for (const t of e.changedTouches) {
    const p = toGame(t.clientX, t.clientY);
    const btn = hitButton(p.x, p.y);
    if (btn === 'pause') { togglePause(); continue; }
    if (btn === 'mute') { toggleMute(); continue; }
    if (state === 'play' && p.x < W * 0.4) { touchSlideId = t.identifier; keys.slide = true; }
    else pressJump();
  }
}, { passive: false });
canvas.addEventListener('touchend', e => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === touchSlideId) { touchSlideId = null; keys.slide = false; }
    else releaseJump();
  }
}, { passive: false });
canvas.addEventListener('touchcancel', () => { touchSlideId = null; keys.slide = false; releaseJump(); });

canvas.addEventListener('mousedown', e => {
  const p = toGame(e.clientX, e.clientY);
  const btn = hitButton(p.x, p.y);
  if (btn === 'pause') return togglePause();
  if (btn === 'mute') return toggleMute();
  if (e.button === 2) { keys.slide = true; return; }
  pressJump();
});
window.addEventListener('mouseup', e => { if (e.button === 2) keys.slide = false; else releaseJump(); });
canvas.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') state = 'pause'; });
window.addEventListener('blur', () => { if (state === 'play') state = 'pause'; keys.jump = keys.slide = false; });

// ---------- Effects ----------
function burst(x, y, n, color, spd = 200, life = 0.6, grav = 600) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = Math.random() * spd;
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - spd * 0.3, life, max: life, color, size: rand(2, 4.5), grav });
  }
}
function popText(x, y, str, color = '#fff') { texts.push({ x, y, str, color, life: 1 }); }

// ---------- Update ----------
function playerBox(p = player) {
  const h = p.sliding ? SLIDE_H : STAND_H;
  const w = p.sliding ? 38 : 24;
  // Slightly forgiving hitbox
  return { x: p.x - w / 2 + 3, y: p.y - h + 4, w: w - 6, h: h - 6 };
}
function roofUnder(x, halfW) {
  for (const b of buildings) if (x + halfW > b.x && x - halfW < b.x + b.w) return b;
  return null;
}

function die(reason) {
  if (player.dead) return;
  player.dead = true;
  state = 'over';
  deathTimer = 0;
  shake = 14; flash = 1;
  burst(player.x, player.y - 30, 40, '#ff5d73', 380, 0.9);
  burst(player.x, player.y - 30, 20, '#ffffff', 260, 0.6);
  sfx.die();
  if (navigator.vibrate) { try { navigator.vibrate(120); } catch (e) { /* ignore */ } }
  const score = currentScore();
  if (score > best) { best = score; saveBest(best); newBest = true; }
  player.deathReason = reason;
  player.vy = -500;
}

function currentScore() { return Math.floor(dist) + coinCount * 10 + bonus; }

function step(dt) {
  time += dt;
  const p = player;

  if (state === 'over') {
    deathTimer += dt;
    // Ragdoll tumble
    p.vy += GRAVITY * dt; p.y += p.vy * dt; p.x += speed * 0.25 * dt; p.spin += dt * 10;
    speed *= 1 - dt * 2;
    camX += speed * dt * 0.3;
    updateFx(dt);
    return;
  }

  speed = Math.min(MAX_SPEED, speed + ACCEL * dt);
  const px0 = p.x, py0 = p.y;
  p.x += speed * dt;
  dist = Math.max(dist, p.x / 10); // 10 px = 1 metre

  // Slide
  const wantSlide = keys.slide;
  if (wantSlide && p.onGround && !p.sliding) { p.sliding = true; p.slideTime = 0; sfx.slide(); }
  if (p.sliding) {
    p.slideTime += dt;
    if (!p.onGround || (!wantSlide && p.slideTime > 0.25)) {
      // Only stand up if nothing is overhead
      const standBox = playerBox({ ...p, sliding: false });
      const blocked = obstacles.some(o => o.type === 'beam' && overlap(standBox, o));
      if (!blocked || !p.onGround) p.sliding = false;
    }
    if (p.onGround && Math.random() < 0.6) particles.push({ x: p.x - 14, y: p.y - 2, vx: -speed * 0.3 + rand(-30, 30), vy: rand(-80, -20), life: 0.35, max: 0.35, color: '#ffd29a', size: rand(1.5, 3), grav: 300 });
  }
  if (wantSlide && !p.onGround && p.vy < FAST_FALL_V) p.vy = Math.max(p.vy, 0) + (FAST_FALL_V - Math.max(p.vy, 0)) * 0.25;

  // Jump (buffered, with coyote time and one air jump)
  p.buffer -= dt;
  p.coyote -= dt;
  if (p.buffer > 0) {
    if (p.onGround || p.coyote > 0) {
      p.vy = -JUMP_V; p.onGround = false; p.coyote = 0; p.buffer = 0; p.sliding = false;
      p.squash = -0.25; sfx.jump();
      burst(p.x, p.y, 8, '#ffffff', 120, 0.35, 400);
    } else if (p.jumps > 0) {
      p.vy = -AIR_JUMP_V; p.jumps--; p.buffer = 0; p.spin = 0.001;
      sfx.air();
      burst(p.x, p.y - 10, 12, '#7ee0ff', 160, 0.45, 200);
    }
  }

  // Gravity (lighter while holding jump on the way up)
  const g = p.vy < 0 && p.holdJump ? GRAVITY * 0.85 : GRAVITY;
  if (!p.onGround) p.vy += g * dt;
  p.y += p.vy * dt;
  if (p.spin) { p.spin += dt * 14; if (p.spin > Math.PI * 2) p.spin = 0; }

  // Buildings
  const wasGround = p.onGround;
  p.onGround = false;
  for (const b of buildings) {
    const inX = p.x + 10 > b.x && p.x - 10 < b.x + b.w;
    if (!inX) continue;
    if (p.vy >= 0 && py0 <= b.y + 2 && p.y >= b.y) {
      p.y = b.y; p.vy = 0; p.onGround = true; p.jumps = 1;
      if (!wasGround) {
        p.squash = 0.3; sfx.land();
        for (let i = 0; i < 8; i++) particles.push({ x: p.x + rand(-10, 10), y: b.y, vx: rand(-120, 60), vy: rand(-120, -30), life: 0.4, max: 0.4, color: '#ffffff', size: rand(1.5, 3.5), grav: 500 });
        p.spin = 0;
      }
    } else if (p.y > b.y + 8 && px0 + 10 <= b.x + 1) {
      // Ran into the side of a building
      p.x = b.x - 10;
      die('Slammed into a wall');
      return;
    }
  }
  if (wasGround && !p.onGround && p.vy >= 0) p.coyote = COYOTE;

  if (p.y > 700) { die('Fell off the rooftops'); return; }

  // Obstacles
  const box = playerBox();
  for (const o of obstacles) {
    if (o.x > p.x + 60) break;
    if (o.x + o.w < p.x - 200) continue;
    if (overlap(box, o)) {
      die(o.type === 'beam' ? 'Clotheslined by a beam' : o.type === 'crate' ? 'Crashed into crates' : 'Tripped on a barrier');
      return;
    }
    if (!o.passed && p.x - 12 > o.x + o.w) {
      o.passed = true;
      // Close call bonus: cleared it by a small margin
      const clearance = o.type === 'beam' ? (o.y + o.h) - (p.y - (p.sliding ? SLIDE_H : STAND_H)) : o.y - p.y;
      if (o.type !== 'beam' && clearance < 30) { bonus += 25; popText(p.x, p.y - 80, 'CLOSE CALL +25', '#ffd84d'); sfx.nice(); }
      else if (o.type === 'beam') { bonus += 10; popText(p.x, p.y - 60, 'SLIDE +10', '#7ee0ff'); }
      else { bonus += 5; popText(p.x, p.y - 80, '+5', '#ffffff'); }
    }
  }

  // Coins
  for (const c of coins) {
    if (c.got) continue;
    if (c.x > p.x + 60) continue;
    const dx = c.x - p.x, dy = c.y - (p.y - (p.sliding ? 14 : 32));
    if (dx * dx + dy * dy < 34 * 34) {
      c.got = true; coinCount++; sfx.coin();
      burst(c.x, c.y, 8, '#ffd84d', 140, 0.4, 0);
    }
  }

  // Milestones
  if (dist >= nextMilestone) {
    popText(p.x + 120, 200, `${nextMilestone} m!`, '#7ee0ff');
    sfx.milestone();
    nextMilestone += 500;
  }

  // Squash recovery, run cycle
  p.squash *= Math.pow(0.0005, dt);
  if (p.onGround) p.phase += speed * dt * 0.028;

  // Camera
  const targetCam = p.x - Math.min(W * 0.26, 260);
  camX = targetCam;

  // World streaming
  while (buildings[buildings.length - 1].x < camX + W + 1200) addBuilding();
  while (buildings.length > 2 && buildings[1].x + buildings[1].w < camX - 200) buildings.shift();
  obstacles = obstacles.filter(o => o.x + o.w > camX - 300);
  coins = coins.filter(c => c.x > camX - 100);

  updateFx(dt);
}

function updateFx(dt) {
  for (const q of particles) { q.life -= dt; q.vy += q.grav * dt; q.x += q.vx * dt; q.y += q.vy * dt; }
  particles = particles.filter(q => q.life > 0);
  for (const t of texts) { t.life -= dt * 0.9; t.y -= 40 * dt; }
  texts = texts.filter(t => t.life > 0);
  shake *= Math.pow(0.002, dt);
  flash = Math.max(0, flash - dt * 3);
}

// ---------- Drawing ----------
function drawSky(sky) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, sky.top); g.addColorStop(1, sky.bot);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  if (sky.night > 0.05) {
    ctx.fillStyle = '#ffffff';
    for (const s of stars) {
      ctx.globalAlpha = sky.night * (0.5 + 0.5 * Math.sin(time * 2 + s.p));
      ctx.fillRect(((s.x * W - camX * 0.02) % W + W) % W, s.y * H, s.s, s.s);
    }
    ctx.globalAlpha = 1;
  }
  // Sun / moon
  const sx = W * 0.72, sy = offY + 150;
  const glow = ctx.createRadialGradient(sx, sy, 10, sx, sy, 160);
  glow.addColorStop(0, sky.sun); glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.globalAlpha = 0.35; ctx.fillStyle = glow; ctx.fillRect(sx - 160, sy - 160, 320, 320);
  ctx.globalAlpha = 1; ctx.fillStyle = sky.sun;
  ctx.beginPath(); ctx.arc(sx, sy, 42, 0, Math.PI * 2); ctx.fill();
}

function drawLayers(sky) {
  LAYERS.forEach((L, li) => {
    const col = sky.night > 0.5 ? L.col[2] : mixColor(L.col[0], L.col[1], Math.min(1, sky.night * 2));
    const off = ((camX * L.f) % L.tile + L.tile) % L.tile;
    const base = offY + 540 - 40 + li * 30;
    for (let rep = -1; rep * L.tile - off < W + L.tile; rep++) {
      const ox = rep * L.tile - off;
      if (ox > W || ox + L.tile < 0) continue;
      for (const b of L.b) {
        const x = ox + b.x;
        if (x > W || x + b.w < 0) continue;
        ctx.fillStyle = col;
        ctx.fillRect(x, base - b.h, b.w + 1, H - base + b.h);
        if (b.ant) { ctx.fillRect(x + b.w / 2 - 1.5, base - b.h - 30, 3, 30); }
        // windows on the nearest layer at night
        if (li === 2 && sky.night > 0.2) {
          ctx.fillStyle = `rgba(255,214,120,${0.5 * sky.night})`;
          for (let wy = base - b.h + 12; wy < base + 60; wy += 18)
            for (let wx = x + 8; wx < x + b.w - 8; wx += 14)
              if (Math.sin(b.seed + wx * 3.1 + wy * 7.7) > 0.55) ctx.fillRect(wx, wy, 5, 8);
        }
      }
    }
  });
}

function drawBuilding(b, sky) {
  const x = b.x - camX, y = b.y + offY;
  if (x > W || x + b.w < 0) return;
  const body = mixColor('#3b3561', '#1c1936', sky.night);
  ctx.fillStyle = body;
  ctx.fillRect(x, y, b.w, H - y + 10);
  // side shading
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x + b.w - 14, y, 14, H - y);
  ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(x, y, 8, H - y);
  // roof ledge
  ctx.fillStyle = mixColor('#6b63a8', '#3d3770', sky.night);
  ctx.fillRect(x - 4, y - 6, b.w + 8, 10);
  ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(x - 4, y - 6, b.w + 8, 2);
  // windows
  for (let wy = y + 28; wy < H; wy += 42) {
    for (let wx = x + 24; wx < x + b.w - 40; wx += 46) {
      const lit = Math.sin(b.seed + (wx - x) * 0.37 + (wy - y) * 1.91) > 0.2;
      ctx.fillStyle = lit ? `rgba(255,210,120,${0.25 + 0.6 * sky.night})` : 'rgba(0,0,0,0.25)';
      ctx.fillRect(wx, wy, 22, 26);
    }
  }
  // antenna / water tower decoration near back edge
  const s = Math.floor(b.seed) % 3;
  ctx.fillStyle = mixColor('#2a2550', '#100e22', sky.night);
  if (s === 0) {
    const tx = x + b.w - 90;
    ctx.fillRect(tx, y - 60, 46, 34);
    ctx.fillRect(tx + 4, y - 26, 4, 22); ctx.fillRect(tx + 38, y - 26, 4, 22);
    ctx.beginPath(); ctx.moveTo(tx - 4, y - 60); ctx.lineTo(tx + 23, y - 76); ctx.lineTo(tx + 50, y - 60); ctx.fill();
  } else if (s === 1) {
    ctx.fillRect(x + 40, y - 70, 3, 64);
    ctx.fillStyle = '#ff5d73';
    if (Math.sin(time * 4 + b.seed) > 0) { ctx.beginPath(); ctx.arc(x + 41.5, y - 72, 3, 0, Math.PI * 2); ctx.fill(); }
  }
}

function hazardStripes(x, y, w, h, c1, c2) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = c1; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = c2;
  for (let i = -h; i < w + h; i += 16) {
    ctx.beginPath(); ctx.moveTo(x + i, y + h); ctx.lineTo(x + i + 8, y + h); ctx.lineTo(x + i + 8 + h, y); ctx.lineTo(x + i + h, y); ctx.fill();
  }
  ctx.restore();
}

function drawObstacle(o) {
  const x = o.x - camX, y = o.y + offY;
  if (x > W || x + o.w < 0) return;
  if (o.type === 'barrier') {
    ctx.fillStyle = '#2b2550';
    ctx.fillRect(x + 4, y + 10, 5, o.h - 10); ctx.fillRect(x + o.w - 9, y + 10, 5, o.h - 10);
    hazardStripes(x, y, o.w, 14, '#ffb020', '#1b1730');
    hazardStripes(x, y + 22, o.w, 8, '#ffb020', '#1b1730');
  } else if (o.type === 'crate') {
    const rows = [[0, 0, o.w, o.h / 2], [8, -o.h / 2, o.w - 16, o.h / 2]];
    for (const [dx, dy, w, h] of rows) {
      const cx = x + dx, cy = y + o.h / 2 + dy;
      ctx.fillStyle = '#c47a3a'; ctx.fillRect(cx, cy, w, h);
      ctx.strokeStyle = '#7a4520'; ctx.lineWidth = 3;
      ctx.strokeRect(cx + 1.5, cy + 1.5, w - 3, h - 3);
      ctx.beginPath(); ctx.moveTo(cx + 3, cy + 3); ctx.lineTo(cx + w - 3, cy + h - 3); ctx.stroke();
    }
  } else if (o.type === 'beam') {
    // Posts sit behind the runner, so they are drawn faded and don't collide.
    const roof = o.roof + offY;
    ctx.fillStyle = 'rgba(20,16,40,0.55)';
    ctx.fillRect(x + 6, y, 6, roof - y); ctx.fillRect(x + o.w - 12, y, 6, roof - y);
    // Billboard
    ctx.fillStyle = '#ff5d73'; ctx.fillRect(x, y, o.w, o.h - 14);
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 15px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('SLIDE', x + o.w / 2, y + (o.h - 14) / 2 + 5);
    hazardStripes(x, y + o.h - 14, o.w, 14, '#ffb020', '#1b1730');
  }
}

function drawCoin(c) {
  if (c.got) return;
  const x = c.x - camX, y = c.y + offY + Math.sin(time * 4 + c.t) * 3;
  if (x < -20 || x > W + 20) return;
  const sx = Math.abs(Math.cos(time * 3 + c.t));
  ctx.fillStyle = '#ffd84d';
  ctx.beginPath(); ctx.ellipse(x, y, 9 * sx + 1.5, 9, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff4b8';
  ctx.beginPath(); ctx.ellipse(x - 2 * sx, y - 2, 3 * sx + 0.5, 3, 0, 0, Math.PI * 2); ctx.fill();
}

function limb(x, y, len1, a1, len2, a2) {
  const kx = x + Math.sin(a1) * len1, ky = y + Math.cos(a1) * len1;
  const fx = kx + Math.sin(a2) * len2, fy = ky + Math.cos(a2) * len2;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke();
}

function drawPlayer() {
  const p = player;
  const x = p.x - camX, y = p.y + offY;
  ctx.save();
  ctx.translate(x, y);
  const sq = p.squash;
  ctx.scale(1 + sq * 0.5, 1 - sq * 0.5);

  // shadow when on ground
  if (p.onGround) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(0, 0, 18, 4, 0, 0, Math.PI * 2); ctx.fill();
  }

  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const body = '#f4f1ff', accent = '#ff5d73';

  if (p.dead || p.spin) {
    ctx.translate(0, -32);
    ctx.rotate(p.spin);
    ctx.translate(0, 32);
  }

  if (p.sliding && !p.dead) {
    // Low slide pose
    ctx.strokeStyle = body; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(-14, -12); ctx.lineTo(10, -6); ctx.stroke(); // torso
    ctx.lineWidth = 6;
    limb(10, -6, 15, 1.9, 15, 1.6);   // front leg
    limb(10, -6, 14, 1.3, 13, 2.4);   // back leg
    ctx.strokeStyle = accent; ctx.lineWidth = 5;
    limb(-10, -12, 12, -2.2, 11, -1.7); // arm back
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(-22, -18, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = accent; ctx.fillRect(-30, -22, 16, 4); // headband
  } else {
    const ph = p.phase;
    let legA1, legA2, legB1, legB2, armA, armB, lean = 0.18;
    if (p.onGround && !p.dead) {
      const s = Math.sin(ph), c = Math.cos(ph);
      legA1 = s * 0.9; legA2 = legA1 - (c > 0 ? c * 1.3 : 0.15);
      legB1 = -s * 0.9; legB2 = legB1 - (c < 0 ? -c * 1.3 : 0.15);
      armA = -s * 1.1; armB = s * 1.1;
    } else {
      // tucked jump pose
      const t = clamp(-p.vy / 900, -1, 1);
      legA1 = 0.9 + t * 0.3; legA2 = -0.6;
      legB1 = -0.2; legB2 = -1.1 + t * 0.2;
      armA = -2.4 + t * 0.4; armB = 2.0; lean = 0.1;
    }
    const hipY = -30, shoulderY = -52;
    const shX = Math.sin(lean) * 22;
    ctx.strokeStyle = body; ctx.lineWidth = 6;
    // back limbs a bit darker
    ctx.strokeStyle = '#bdb7e0';
    limb(0, hipY, 15, legB1, 15, legB2 + 0.0);
    ctx.strokeStyle = '#d24a60'; ctx.lineWidth = 5;
    limb(shX, shoulderY, 12, armB, 12, armB - 0.9);
    // torso
    ctx.strokeStyle = body; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(0, hipY); ctx.lineTo(shX, shoulderY); ctx.stroke();
    // front limbs
    ctx.lineWidth = 6;
    limb(0, hipY, 15, legA1, 15, legA2);
    ctx.strokeStyle = accent; ctx.lineWidth = 5;
    limb(shX, shoulderY, 12, armA, 12, armA - 0.9);
    // head
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(shX + 3, shoulderY - 10, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = accent; ctx.fillRect(shX - 6, shoulderY - 15, 18, 4);
    // headband tails flutter
    ctx.strokeStyle = accent; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(shX - 6, shoulderY - 13);
    ctx.lineTo(shX - 16, shoulderY - 15 + Math.sin(time * 20) * 3);
    ctx.lineTo(shX - 24, shoulderY - 11 + Math.sin(time * 20 + 1) * 4); ctx.stroke();
  }
  ctx.restore();
}

function drawParticles() {
  for (const q of particles) {
    ctx.globalAlpha = clamp(q.life / q.max, 0, 1);
    ctx.fillStyle = q.color;
    ctx.fillRect(q.x - camX - q.size / 2, q.y + offY - q.size / 2, q.size, q.size);
  }
  ctx.globalAlpha = 1;
}

function drawTexts() {
  ctx.textAlign = 'center';
  ctx.font = 'bold 18px system-ui, sans-serif';
  for (const t of texts) {
    ctx.globalAlpha = clamp(t.life * 1.5, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillText(t.str, t.x - camX + 2, t.y + offY + 2);
    ctx.fillStyle = t.color; ctx.fillText(t.str, t.x - camX, t.y + offY);
  }
  ctx.globalAlpha = 1;
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function drawHUD() {
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(10,8,25,0.45)';
  roundRect(14, 14, 250, 64, 12); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 26px system-ui, sans-serif';
  ctx.fillText(currentScore().toLocaleString(), 28, 44);
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillStyle = '#c9c4ee';
  ctx.fillText(`${Math.floor(dist)} m`, 28, 66);
  ctx.fillStyle = '#ffd84d';
  ctx.beginPath(); ctx.arc(104, 61, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#c9c4ee'; ctx.fillText(`${coinCount}`, 115, 66);
  ctx.textAlign = 'right'; ctx.fillText(`BEST ${best.toLocaleString()}`, 250, 66); ctx.textAlign = 'left';

  // Speed bar
  const sp = (speed - START_SPEED) / (MAX_SPEED - START_SPEED);
  ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(28, 72, 222, 3);
  ctx.fillStyle = mixColor('#7ee0ff', '#ff5d73', sp); ctx.fillRect(28, 72, 222 * sp, 3);

  // Air-jump indicator
  if (!player.onGround && player.jumps > 0 && state === 'play') {
    ctx.fillStyle = '#7ee0ff'; ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('DOUBLE JUMP READY', player.x - camX, player.y + offY - 84);
  }

  // Buttons
  for (const b of uiButtons()) {
    ctx.fillStyle = 'rgba(10,8,25,0.45)'; roundRect(b.x, b.y, b.w, b.h, 10); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
    if (b.id === 'pause') {
      if (state === 'pause') { ctx.beginPath(); ctx.moveTo(b.x + 15, b.y + 11); ctx.lineTo(b.x + 31, b.y + 21); ctx.lineTo(b.x + 15, b.y + 31); ctx.fill(); }
      else { ctx.fillRect(b.x + 13, b.y + 11, 6, 20); ctx.fillRect(b.x + 23, b.y + 11, 6, 20); }
    } else {
      ctx.beginPath(); ctx.moveTo(b.x + 10, b.y + 17); ctx.lineTo(b.x + 16, b.y + 17); ctx.lineTo(b.x + 23, b.y + 10);
      ctx.lineTo(b.x + 23, b.y + 32); ctx.lineTo(b.x + 16, b.y + 25); ctx.lineTo(b.x + 10, b.y + 25); ctx.fill();
      if (muted) { ctx.beginPath(); ctx.moveTo(b.x + 27, b.y + 15); ctx.lineTo(b.x + 35, b.y + 27); ctx.moveTo(b.x + 35, b.y + 15); ctx.lineTo(b.x + 27, b.y + 27); ctx.stroke(); }
      else { ctx.beginPath(); ctx.arc(b.x + 25, b.y + 21, 7, -0.9, 0.9); ctx.stroke(); }
    }
  }
}

function panel(lines, sub) {
  ctx.fillStyle = 'rgba(10,8,25,0.68)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  let y = H / 2 - (lines.length * 26) / 2 - 20;
  for (const [text, size, color] of lines) {
    ctx.font = `bold ${size}px system-ui, sans-serif`;
    ctx.fillStyle = color || '#ffffff';
    ctx.fillText(text, W / 2, y);
    y += size * 1.3;
  }
  if (sub) {
    ctx.globalAlpha = 0.75 + 0.25 * Math.sin(time * 4);
    ctx.font = 'bold 18px system-ui, sans-serif'; ctx.fillStyle = '#ffd84d';
    ctx.fillText(sub, W / 2, y + 20);
    ctx.globalAlpha = 1;
  }
}

const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

function drawTouchHints() {
  if (!isTouch || state !== 'play' || dist > 150) return;
  ctx.globalAlpha = clamp(1 - dist / 150, 0, 1) * 0.8;
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(0, 0, W * 0.4, H);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 16px system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('HOLD HERE TO SLIDE', W * 0.2, H - 40);
  ctx.fillText('TAP HERE TO JUMP', W * 0.7, H - 40);
  ctx.globalAlpha = 1;
}

function render() {
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  const sky = skyAt(dist);
  ctx.save();
  if (shake > 0.3) ctx.translate(rand(-shake, shake), rand(-shake, shake));
  drawSky(sky);
  drawLayers(sky);
  for (const b of buildings) drawBuilding(b, sky);
  for (const o of obstacles) drawObstacle(o);
  for (const c of coins) drawCoin(c);
  drawParticles();
  if (state !== 'menu') drawPlayer();
  drawTexts();
  ctx.restore();

  if (flash > 0) { ctx.fillStyle = `rgba(255,93,115,${flash * 0.35})`; ctx.fillRect(0, 0, W, H); }

  if (state === 'menu') {
    panel([
      ['PARKOUR RUN', 54, '#ffffff'],
      ['Run the rooftops. Don\'t look down.', 18, '#c9c4ee'],
      ['', 10],
      [isTouch ? 'Tap right side: jump (tap again in the air to double jump)' : 'Space / ↑ : jump  (again in the air = double jump)', 15, '#ffffff'],
      [isTouch ? 'Hold left side: slide under signs' : '↓ / S : slide  (in the air = drop fast)', 15, '#ffffff'],
      [best ? `Best: ${best.toLocaleString()}` : '', 16, '#ffd84d'],
    ], isTouch ? 'TAP TO START' : 'PRESS SPACE TO START');
    if (isTouch && H > W) {
      ctx.fillStyle = '#c9c4ee'; ctx.font = '14px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Tip: turn your phone sideways for a wider view', W / 2, H - 30);
    }
  } else {
    drawHUD();
    drawTouchHints();
    if (state === 'pause') panel([['PAUSED', 44]], isTouch ? 'TAP TO RESUME' : 'PRESS SPACE OR P TO RESUME');
    if (state === 'over' && deathTimer > 0.5) {
      panel([
        [player.deathReason || 'Game over', 34, '#ff8a9a'],
        [`Score ${currentScore().toLocaleString()}`, 30, '#ffffff'],
        [`${Math.floor(dist)} m  ·  ${coinCount} coins  ·  ${bonus} style`, 16, '#c9c4ee'],
        [newBest ? 'NEW BEST!' : `Best ${best.toLocaleString()}`, 20, '#ffd84d'],
      ], deathTimer > 0.6 ? (isTouch ? 'TAP TO RUN AGAIN' : 'PRESS SPACE TO RUN AGAIN') : '');
    }
  }
}

// ---------- Main loop ----------
let last = performance.now(), acc = 0;
function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;
  if (state === 'menu') {
    // Attract mode: scroll the city slowly
    camX += 60 * dt; time += dt;
    while (buildings[buildings.length - 1].x < camX + W + 1200) addBuilding();
  } else if (state !== 'pause') {
    acc += dt;
    while (acc >= STEP) { step(STEP); acc -= STEP; }
  }
  render();
  requestAnimationFrame(frame);
}

reset();
requestAnimationFrame(frame);
