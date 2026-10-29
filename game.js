'use strict';
// Палитра — гиперказуальная логистика цветов. Canvas 2D, без зависимостей.

// ---------- константы ----------
const COL = { R: '#e8453c', O: '#f28a1a', Y: '#f2c200', G: '#2fae5b', B: '#2f6fe4', V: '#8b55d6' };
const NAME = { R: 'красный', O: 'оранжевый', Y: 'жёлтый', G: 'зелёный', B: 'синий', V: 'фиолетовый' };
const ORDER = ['R', 'O', 'Y', 'G', 'B', 'V'];
const PRIM = ['R', 'Y', 'B'];
const SEC = ['O', 'G', 'V'];
const SPLIT = { O: ['R', 'Y'], G: ['Y', 'B'], V: ['R', 'B'] };
const MIX = {};
for (const k in SPLIT) { const [a, b] = SPLIT[k]; MIX[a + b] = k; MIX[b + a] = k; }
const PITCH = { R: 0, O: 2, Y: 4, G: 7, B: 9, V: 11 };

const SPEED = 2.2;     // клеток в секунду
const GAP = 0.55;      // минимальный зазор между кружками
const SRC_INT = 1.5;   // источник выпускает кружок раз в N секунд
const WEEK = 45;       // длина недели, с
const TOP = 70, BOT = 96;
const BG = '#efece6', INK = '#2a2a2d', BELT = '#d8d2c7';
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';

const UPS = [
  { k: 'belt', n: 20, t: '+20 клеток ленты' },
  { k: 'mix', n: 1, t: '+1 смеситель' },
  { k: 'split', n: 1, t: '+1 разделитель' },
  { k: 'bridge', n: 2, t: '+2 моста' },
];

// ---------- утилиты ----------
const $ = s => document.querySelector(s);
const rnd = n => Math.floor(Math.random() * n);
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const easeOutBack = t => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const easeOut = t => 1 - Math.pow(1 - t, 3);
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const key = (x, y) => x + ',' + y;

const cv = $('#c'), ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;
const cam = { x: 0, y: 0, s: 40 };
let S = null;
let best = 0;
try { best = +localStorage.getItem('palitra_best') || 0; } catch (e) {}

// ---------- звук ----------
let AC = null;
function audioInit() {
  try {
    if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
    else if (AC.state === 'suspended') AC.resume();
  } catch (e) {}
}
function tone(semi, dur = 0.14, vol = 0.06, type = 'sine') {
  if (!AC) return;
  const t = AC.currentTime, o = AC.createOscillator(), g = AC.createGain();
  o.type = type;
  o.frequency.value = 523.25 * Math.pow(2, semi / 12);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(AC.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

// ---------- поле ----------
const cell = (x, y) => S.cells.get(key(x, y));
function cellMk(x, y) {
  let c = S.cells.get(key(x, y));
  if (!c) { c = { node: null, belts: [] }; S.cells.set(key(x, y), c); }
  return c;
}
const inB = (x, y) => x >= S.b.x0 && x <= S.b.x1 && y >= S.b.y0 && y <= S.b.y1;

function addNode(type, x, y, color) {
  const n = { id: S.id++, type, x, y, color, born: S.t, ins: [], outs: [], outQ: [], slots: [], timer: 0, pulse: 0, rr: 0 };
  if (type === 'rcv') Object.assign(n, { order: null, remain: null, fill: 0, patience: 1, wait: 0.8, done: 0, pop: 0 });
  S.nodes.push(n);
  cellMk(x, y).node = n;
  return n;
}

function findSpot() {
  for (const minD of [3, 2]) {
    for (let i = 0; i < 300; i++) {
      const x = S.b.x0 + rnd(S.b.x1 - S.b.x0 + 1), y = S.b.y0 + rnd(S.b.y1 - S.b.y0 + 1);
      const c = cell(x, y);
      if (c && (c.node || c.belts.length)) continue;
      if (S.nodes.some(n => Math.max(Math.abs(n.x - x), Math.abs(n.y - y)) < minD)) continue;
      return { x, y };
    }
  }
  return null;
}

const has = t => S.inv[t] > 0 || S.nodes.some(n => n.type === t);
const directColors = () => new Set(S.nodes.filter(n => n.type === 'src').map(n => n.color));

// Какие цвета вообще можно получить из текущих источников и инструментов
function producible() {
  const set = directColors();
  if (has('split')) [...set].forEach(c => SPLIT[c] && SPLIT[c].forEach(p => set.add(p)));
  if (has('mix')) for (const c of SEC) { const [a, b] = SPLIT[c]; if (set.has(a) && set.has(b)) set.add(c); }
  return [...set];
}

// ---------- игра ----------
function newGame() {
  const portrait = innerHeight > innerWidth;
  S = {
    t: 0, score: 0, week: 1, weekT: 0, paused: false, over: false, running: false, overT: 0,
    b: portrait ? { x0: -3, y0: -5, x1: 3, y1: 5 } : { x0: -6, y0: -3, x1: 6, y1: 3 },
    vb: null, portrait, nodes: [], belts: [], cells: new Map(), parts: [], id: 1,
    inv: { belt: 40, mix: 1, split: 1, bridge: 1 },
    srcT: 24, rcvT: 20, orders: 0, srcCount: 0, hinted: {}, failNode: null,
  };
  S.vb = { ...S.b };
  if (portrait) { addNode('src', -2, -3, 'R'); addNode('src', 2, -3, 'B'); addNode('rcv', 0, 3); }
  else { addNode('src', -4, -2, 'R'); addNode('src', -4, 2, 'B'); addNode('rcv', 4, 0); }
  drag = null; down = null; place = null;
  fitCam(true);
  updPanel();
}

function makeOrder(n) {
  const direct = directColors();
  let pick, total;
  if (S.orders === 0) {
    pick = [...direct]; total = 4;
  } else {
    const avail = producible();
    total = Math.min(3 + Math.floor(S.t / 40), 14);
    let k = total >= 7 ? 2 + rnd(2) : total >= 4 ? 1 + rnd(2) : 1;
    k = Math.min(k, avail.length);
    pick = [];
    const indirect = avail.filter(c => !direct.has(c));
    if (indirect.length && Math.random() < 0.6) pick.push(indirect[rnd(indirect.length)]);
    while (pick.length < k) { const c = avail[rnd(avail.length)]; if (!pick.includes(c)) pick.push(c); }
    for (const c of pick) if (!direct.has(c)) hintFor(c);
  }
  const ord = {};
  pick.forEach(c => ord[c] = 1);
  for (let i = pick.length; i < total; i++) ord[pick[rnd(pick.length)]]++;
  n.order = ord; n.remain = { ...ord }; n.fill = 0; n.patience = 50 + total * 6;
  S.orders++;
}

function hintFor(c) {
  if (S.hinted[c]) return;
  S.hinted[c] = true;
  const direct = directColors();
  if (SPLIT[c]) {
    const [a, b] = SPLIT[c];
    hint(`<span class="d" style="background:${COL[a]}"></span> ${NAME[a]} + <span class="d" style="background:${COL[b]}"></span> ${NAME[b]} в белом смесителе = <span class="d" style="background:${COL[c]}"></span> ${NAME[c]}`, 6);
  } else {
    const from = SEC.find(s => direct.has(s) && SPLIT[s].includes(c));
    if (from) hint(`Чёрный разделитель: <span class="d" style="background:${COL[from]}"></span> ${NAME[from]} → ${SPLIT[from].map(p => `<span class="d" style="background:${COL[p]}"></span>`).join(' + ')}`, 6);
  }
}

function spawnSrc() {
  const p = findSpot();
  if (!p) { S.srcT = 6; return; }
  const direct = directColors();
  let c;
  if (S.srcCount === 0) c = 'Y';
  else if (S.week >= 3 && Math.random() < 0.35) c = SEC[rnd(3)];
  else { const miss = PRIM.filter(x => !direct.has(x)); c = miss.length ? miss[rnd(miss.length)] : PRIM[rnd(3)]; }
  S.srcCount++;
  addNode('src', p.x, p.y, c);
  tone(PITCH[c] - 12, 0.3, 0.05, 'triangle');
}

function spawnRcv() {
  const p = findSpot();
  if (!p) { S.rcvT = 6; return; }
  addNode('rcv', p.x, p.y);
  tone(-5, 0.3, 0.05, 'triangle');
}

function grow() {
  const b = S.b;
  const [mx, my] = S.portrait ? [6, 10] : [11, 7];
  const wantX = S.week % 2 === 0;
  if ((wantX && b.x1 < mx) || b.y1 >= my) { if (b.x1 < mx) { b.x0--; b.x1++; } }
  else if (b.y1 < my) { b.y0--; b.y1++; }
}

function update(dt) {
  S.t += dt;
  S.srcT -= dt; if (S.srcT <= 0) { S.srcT = 30; spawnSrc(); }
  S.rcvT -= dt; if (S.rcvT <= 0) { S.rcvT = 34; spawnRcv(); }
  S.weekT += dt;
  if (S.weekT >= WEEK) { S.weekT = 0; S.week++; grow(); showWeek(); }

  for (const n of S.nodes) {
    n.pulse = Math.max(0, n.pulse - dt * 3);
    if (n.type === 'src') {
      n.timer += dt;
      if (n.timer >= SRC_INT && !n.outQ.length && n.outs.length) { n.outQ.push(n.color); n.timer = 0; }
    } else if (n.type === 'rcv') updRcv(n, dt);
    emit(n);
  }
  for (const b of S.belts) updBelt(b, dt);
  for (const p of S.parts) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92; }
  S.parts = S.parts.filter(p => p.life > 0);
}

function updRcv(n, dt) {
  n.pop = Math.max(0, n.pop - dt * 4);
  if (S.t - n.born < 0.4) return;
  if (!n.order) { n.wait -= dt; if (n.wait <= 0) makeOrder(n); return; }
  n.fill += dt / n.patience;
  if (n.fill >= 1) gameOver(n);
}

const entryFree = b => !b.dots.length || b.dots[b.dots.length - 1].s >= GAP;

function wants(n, c) {
  if (n.type === 'rcv') return !!(n.order && n.remain[c] > 0);
  if (n.type === 'mix') return PRIM.includes(c) && !n.slots.includes(c);
  if (n.type === 'split') return SEC.includes(c);
  return false;
}

// Цвет, который узел не примет никогда (а не просто занят): из-за него лента краснеет
function wrong(n, c) {
  if (n.type === 'rcv') return !!n.order && !(n.order[c] > 0 && n.remain[c] > 0);
  if (n.type === 'mix') return !PRIM.includes(c);
  if (n.type === 'split') return !SEC.includes(c);
  return true;
}

// Узел выталкивает готовые кружки на выходные ленты. Сначала туда, где цвет нужен
function emit(n) {
  while (n.outQ.length) {
    const c = n.outQ[0];
    const free = n.outs.filter(entryFree);
    if (!free.length) return;
    const b = free.find(b => wants(b.to, c)) || free[(n.rr++) % free.length];
    b.dots.push({ c, s: 0, born: S.t });
    n.outQ.shift();
    if (n.type === 'src') n.pulse = 1;
  }
}

function updBelt(b, dt) {
  const end = b.path.length - 1 - 0.42;
  let lim = end;
  for (const d of b.dots) { d.s = Math.min(d.s + SPEED * dt, lim); lim = d.s - GAP; }
  const f = b.dots[0];
  if (f && f.s >= end - 1e-6) {
    if (accept(b.to, f.c)) { b.dots.shift(); b.jamT = 0; }
    else if (wrong(b.to, f.c)) b.jamT += dt;
    else b.jamT = 0;
  } else b.jamT = 0;
}

function accept(n, c) {
  if (n.type === 'rcv') {
    if (!n.order || !(n.remain[c] > 0)) return false;
    n.remain[c]--; n.fill = Math.max(0, n.fill - 0.05); n.pop = 1; S.score++;
    burst(n.x, n.y, COL[c], 5);
    tone(PITCH[c], 0.12, 0.05);
    if (ORDER.every(k => !n.remain[k])) {
      n.order = null; n.wait = 1.4; n.done++; n.fill = 0;
      S.parts.push({ ring: true, x: n.x, y: n.y, vx: 0, vy: 0, life: 0.6, max: 0.6, c: INK });
      [0, 4, 7].forEach((s, i) => setTimeout(() => tone(s + 12, 0.25, 0.04), i * 70));
    }
    return true;
  }
  if (n.type === 'mix') {
    if (!PRIM.includes(c) || n.slots.includes(c) || n.outQ.length >= 2) return false;
    n.slots.push(c);
    if (n.slots.length === 2) {
      const m = MIX[n.slots.join('')];
      n.outQ.push(m); n.slots = []; n.pulse = 1;
      burst(n.x, n.y, COL[m], 4);
      tone(PITCH[m] + 12, 0.1, 0.035, 'triangle');
    }
    return true;
  }
  if (n.type === 'split') {
    if (!SEC.includes(c) || n.outQ.length) return false;
    n.outQ.push(...SPLIT[c]); n.pulse = 1;
    tone(PITCH[c] - 5, 0.1, 0.035, 'triangle');
    return true;
  }
  return false;
}

function burst(x, y, c, k) {
  for (let i = 0; i < k; i++) {
    const a = Math.random() * Math.PI * 2, v = 1.5 + Math.random() * 1.5;
    S.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.45, max: 0.45, c, r: 0.06 });
  }
}

function gameOver(n) {
  S.over = true; S.failNode = n; S.overT = 0;
  if (S.score > best) { best = S.score; try { localStorage.setItem('palitra_best', best); } catch (e) {} }
  tone(-12, 0.6, 0.06, 'triangle');
  setTimeout(showOver, 1200);
}

// ---------- ленты ----------
let drag = null, down = null, place = null;

function dragTo(tx, ty) {
  let guard = 0, back = false;
  while (guard++ < 80 && !drag.done) {
    const p = drag.path, L = p[p.length - 1];
    if (L.x === tx && L.y === ty) break;
    const dx = tx - L.x, dy = ty - L.y;
    let sx = 0, sy = 0;
    if (Math.abs(dx) >= Math.abs(dy)) sx = Math.sign(dx); else sy = Math.sign(dy);
    const P = p[p.length - 2];
    if (P && P.x === L.x + sx && P.y === L.y + sy) { backtrack(); back = true; continue; }
    if (drag.lock) { if (back) break; sx = drag.lock.x; sy = drag.lock.y; }
    let r = step(L.x + sx, L.y + sy);
    if (r === 'fail' && !drag.lock) {
      const ax = sx ? 0 : Math.sign(dx), ay = sx ? Math.sign(dy) : 0;
      if (ax || ay) r = step(L.x + ax, L.y + ay);
    }
    if (r !== 'ok') break;
  }
  updPanel();
}

function step(x, y) {
  const p = drag.path, L = p[p.length - 1], dx = x - L.x, dy = y - L.y;
  if (!inB(x, y) || p.some(q => q.x === x && q.y === y)) return 'fail';
  const c = cell(x, y);
  if (c && c.node) {
    if (c.node !== drag.from && c.node.type !== 'src') { p.push({ x, y }); commit(c.node); return 'done'; }
    return 'fail';
  }
  if (S.inv.belt - drag.cost <= 0) return 'fail';
  if (c && c.belts.length) {
    if (c.belts.length === 1 && S.inv.bridge - drag.bridges > 0) {
      const d = c.belts[0].dir;
      if ((d === 'h' && dx === 0) || (d === 'v' && dy === 0)) {
        p.push({ x, y, br: true }); drag.cost++; drag.bridges++; drag.lock = { x: dx, y: dy };
        return 'ok';
      }
    }
    return 'fail';
  }
  p.push({ x, y }); drag.cost++; drag.lock = null;
  return 'ok';
}

function backtrack() {
  const p = drag.path, q = p.pop();
  drag.cost--; if (q.br) drag.bridges--;
  const L = p[p.length - 1], P = p[p.length - 2];
  drag.lock = L.br ? { x: L.x - P.x, y: L.y - P.y } : null;
}

function commit(to) {
  const p = drag.path.map(q => ({ x: q.x, y: q.y }));
  const b = { id: S.id++, from: drag.from, to, path: p, dots: [], cost: drag.cost, bridges: drag.bridges, jamT: 0, born: S.t, br: [] };
  for (let i = 1; i < p.length - 1; i++) {
    const a = p[i - 1], c = p[i + 1];
    const dir = a.x === c.x ? 'v' : a.y === c.y ? 'h' : 't';
    cellMk(p[i].x, p[i].y).belts.push({ b, dir });
    if (drag.path[i].br) b.br.push(i);
  }
  S.inv.belt -= b.cost; S.inv.bridge -= b.bridges;
  b.from.outs.push(b); to.ins.push(b); S.belts.push(b);
  drag.done = true;
  tone(7, 0.1, 0.04); tone(12, 0.12, 0.03);
  if (!S.hinted.first) { S.hinted.first = true; hide('hint'); }
}

function delBelt(b) {
  for (let i = 1; i < b.path.length - 1; i++) {
    const c = cell(b.path[i].x, b.path[i].y);
    c.belts = c.belts.filter(e => e.b !== b);
  }
  for (const d of b.dots) { const q = posAt(b.path, d.s); burst(q.x, q.y, COL[d.c], 2); }
  S.inv.belt += b.cost; S.inv.bridge += b.bridges;
  b.from.outs = b.from.outs.filter(x => x !== b);
  b.to.ins = b.to.ins.filter(x => x !== b);
  S.belts = S.belts.filter(x => x !== b);
}

function removeAt(x, y) {
  const c = cell(x, y);
  if (!c) return;
  if (c.node) {
    const n = c.node;
    if (n.type !== 'mix' && n.type !== 'split') return;
    [...n.ins, ...n.outs].forEach(delBelt);
    c.node = null;
    S.nodes = S.nodes.filter(m => m !== n);
    S.inv[n.type]++;
    burst(n.x, n.y, n.type === 'mix' ? '#cfc8bb' : '#1f1f22', 6);
    bump(n.type);
  } else if (c.belts.length) {
    delBelt(c.belts[c.belts.length - 1].b);
    bump('belt');
  } else return;
  tone(-3, 0.08, 0.04, 'triangle');
  updPanel();
}

const canPlace = (x, y) => { if (!inB(x, y)) return false; const c = cell(x, y); return !c || (!c.node && !c.belts.length); };

// ---------- ввод ----------
function toWorld(px, py) {
  const cy = TOP + (H - TOP - BOT) / 2;
  return { x: (px - W / 2) / cam.s + cam.x, y: (py - cy) / cam.s + cam.y };
}
const live = () => S && S.running && !S.over && !S.paused;

cv.addEventListener('pointerdown', e => {
  audioInit();
  if (!live()) return;
  const w = toWorld(e.clientX, e.clientY), x = Math.round(w.x), y = Math.round(w.y);
  if (e.button === 2) { removeAt(x, y); return; }
  down = { x: e.clientX, y: e.clientY, cx: x, cy: y, moved: false };
  const c = cell(x, y);
  if (c && c.node && c.node.type !== 'rcv') drag = { from: c.node, path: [{ x, y }], cost: 0, bridges: 0, lock: null, done: false };
  try { cv.setPointerCapture(e.pointerId); } catch (err) {}
});
cv.addEventListener('pointermove', e => {
  if (!down || !live()) return;
  if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) down.moved = true;
  if (!drag || drag.done) return;
  const w = toWorld(e.clientX, e.clientY);
  dragTo(Math.round(w.x), Math.round(w.y));
});
function endPointer() {
  if (!down) return;
  if (S && !S.over && !down.moved && (!drag || drag.path.length === 1)) removeAt(down.cx, down.cy);
  drag = null; down = null;
  if (S) updPanel();
}
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', () => { drag = null; down = null; if (S) updPanel(); });
cv.addEventListener('contextmenu', e => e.preventDefault());

document.querySelectorAll('#panel .drag').forEach(el => el.addEventListener('pointerdown', e => {
  audioInit();
  if (!live()) return;
  const k = el.dataset.k;
  if (S.inv[k] <= 0) { bump(k); return; }
  place = { k, x: e.clientX, y: e.clientY };
  e.preventDefault();
}));
addEventListener('pointermove', e => { if (place) { place.x = e.clientX; place.y = e.clientY; } });
addEventListener('pointerup', () => {
  if (!place) return;
  const w = toWorld(place.x, place.y), x = Math.round(w.x), y = Math.round(w.y);
  if (live() && canPlace(x, y) && S.inv[place.k] > 0) {
    addNode(place.k, x, y); S.inv[place.k]--;
    tone(place.k === 'mix' ? 12 : 0, 0.12, 0.04, 'triangle');
  }
  place = null; updPanel();
});

$('#pause').addEventListener('click', () => { if (live()) showPause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && live()) showPause(); });

// ---------- интерфейс ----------
const ovEl = $('#ov'), hintEl = $('#hint');
let hintTimer = 0;
function hint(html, sec = 0) {
  hintEl.innerHTML = html; hintEl.classList.add('show');
  clearTimeout(hintTimer);
  if (sec) hintTimer = setTimeout(() => hintEl.classList.remove('show'), sec * 1000);
}
function hide(what) { if (what === 'hint') hintEl.classList.remove('show'); else ovEl.classList.remove('show'); }
function ov(html) { ovEl.innerHTML = `<div class="box">${html}</div>`; ovEl.classList.add('show'); }

function bump(k) {
  const el = document.querySelector(`#panel [data-k="${k}"]`);
  if (!el) return;
  el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
}

function updPanel() {
  const shown = { ...S.inv };
  if (drag && !drag.done) { shown.belt -= drag.cost; shown.bridge -= drag.bridges; }
  document.querySelectorAll('#panel .item').forEach(el => {
    const v = shown[el.dataset.k];
    el.querySelector('b').textContent = v;
    el.classList.toggle('zero', v <= 0);
  });
}

const dot = c => `<span class="d" style="background:${COL[c]}"></span>`;
function showStart() {
  ov(`<h1>Палитра</h1>
    <p>Тяни ленты от цветных источников к тёмным приёмникам и собирай заказы.</p>
    <p><span class="d w"></span> белый смеситель: ${dot('R')} + ${dot('Y')} = ${dot('O')}<br>
    <span class="d" style="background:#1f1f22"></span> чёрный разделитель: ${dot('O')} → ${dot('R')} + ${dot('Y')}</p>
    <p>Тап по ленте или смесителю убирает их. Не дай приёмнику ждать слишком долго.</p>
    <button class="main" id="go">Играть</button>
    ${best ? `<small>Рекорд: ${best}</small>` : ''}`);
  $('#go').onclick = () => { audioInit(); newGame(); S.running = true; hide(); hint('Тяни линию от цветного круга к тёмному квадрату'); };
}
function showWeek() {
  S.paused = true; drag = null; down = null; place = null;
  const opts = shuffle(UPS).slice(0, 2);
  ov(`<div class="k">Неделя ${S.week}</div><h2>Выбери одно</h2>
    <div class="cards">${opts.map((u, i) => `<button class="card" data-i="${i}"><span class="ico ${u.k}"></span><b>${u.t}</b></button>`).join('')}</div>`);
  ovEl.querySelectorAll('.card').forEach(btn => btn.onclick = () => {
    const u = opts[+btn.dataset.i];
    S.inv[u.k] += u.n; hide(); S.paused = false; updPanel(); bump(u.k);
    tone(12, 0.15, 0.04);
  });
}
function showPause() {
  S.paused = true; drag = null; down = null; place = null;
  ov(`<div class="k">Пауза</div><h2>${S.score}</h2><p>доставлено · неделя ${S.week}</p>
    <button class="main" id="go">Продолжить</button>`);
  $('#go').onclick = () => { audioInit(); hide(); S.paused = false; };
}
function showOver() {
  ov(`<div class="k">Приёмник не дождался</div><h2>${S.score}</h2><p>доставлено · неделя ${S.week}</p>
    <small>Рекорд: ${best}</small>
    <button class="main" id="go">Ещё раз</button>`);
  $('#go').onclick = () => { audioInit(); newGame(); S.running = true; hide(); };
}

// ---------- камера ----------
function fitCam(snap) {
  const b = snap ? S.b : S.vb;
  const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;
  // сверху запас под плашки заказов
  const s = Math.min(72, (W - 24) / (bw + 0.8), (H - TOP - BOT - 16) / (bh + 1.6));
  const x = (b.x0 + b.x1) / 2, y = (b.y0 + b.y1) / 2 - 0.4;
  return snap ? Object.assign(cam, { x, y, s }) : { x, y, s };
}
function camStep(dt) {
  const k = clamp(dt * 3);
  for (const f of ['x0', 'y0', 'x1', 'y1']) S.vb[f] += (S.b[f] - S.vb[f]) * k;
  const t = fitCam(false);
  cam.x += (t.x - cam.x) * k; cam.y += (t.y - cam.y) * k; cam.s += (t.s - cam.s) * k;
}

// ---------- рисование ----------
function circle(x, y, r, c) { ctx.beginPath(); ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill(); }
function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function txt(s, x, y, size, color) {
  ctx.save(); ctx.translate(x, y); ctx.scale(size / 100, size / 100);
  ctx.font = `700 100px ${FONT}`; ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(s, 0, 6); ctx.restore();
}
function posAt(p, s) {
  const i = Math.min(Math.floor(s), p.length - 2), f = s - i;
  return { x: p[i].x + (p[i + 1].x - p[i].x) * f, y: p[i].y + (p[i + 1].y - p[i].y) * f };
}
function polyline(p) { ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y); for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y); }

function drawBeltLine(p, color, alpha = 1) {
  ctx.globalAlpha = alpha;
  polyline(p); ctx.lineWidth = 0.46; ctx.strokeStyle = color; ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawDots(b, filter) {
  for (const d of b.dots) {
    const q = posAt(b.path, d.s);
    if (filter && !filter(q)) continue;
    const k = easeOut(clamp((S.t - d.born) / 0.15));
    circle(q.x, q.y, 0.15 * k, COL[d.c]);
  }
}

function drawBelt(b) {
  const grow = easeOut(clamp((S.t - b.born) / 0.25));
  drawBeltLine(b.path, BELT);
  if (b.jamT > 1.2) {
    ctx.globalAlpha = 0.25 + 0.2 * Math.sin(S.t * 8);
    polyline(b.path); ctx.lineWidth = 0.46; ctx.strokeStyle = '#e8453c'; ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if (grow < 1) { ctx.globalAlpha = 1 - grow; polyline(b.path); ctx.lineWidth = 0.6; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.globalAlpha = 1; }
  // поток: бегущие штрихи показывают направление
  ctx.setLineDash([0.06, 0.44]); ctx.lineDashOffset = -S.t * SPEED;
  polyline(b.path); ctx.lineWidth = 0.07; ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.stroke();
  ctx.setLineDash([]);
  drawDots(b);
}

function drawBridges(b) {
  for (const i of b.br) {
    const c = b.path[i], a = b.path[i - 1];
    const hz = a.y === c.y;
    const seg = hz ? [{ x: c.x - 0.5, y: c.y }, { x: c.x + 0.5, y: c.y }] : [{ x: c.x, y: c.y - 0.5 }, { x: c.x, y: c.y + 0.5 }];
    ctx.lineCap = 'butt';
    polyline(seg); ctx.lineWidth = 0.62; ctx.strokeStyle = '#b4ac9e'; ctx.stroke();
    polyline(seg); ctx.lineWidth = 0.46; ctx.strokeStyle = BELT; ctx.stroke();
    ctx.lineCap = 'round';
    drawDots(b, q => Math.abs(q.x - c.x) <= 0.5 && Math.abs(q.y - c.y) <= 0.5);
  }
}

function drawNode(n) {
  const k = easeOutBack(clamp((S.t - n.born) / 0.45));
  ctx.save(); ctx.translate(n.x, n.y); ctx.scale(k, k);
  if (n.type === 'src') {
    const r = 0.36 * (1 + 0.12 * n.pulse);
    circle(0, 0.035, r, 'rgba(0,0,0,.08)');
    circle(0, 0, r, COL[n.color]);
    circle(0, 0, 0.15 * clamp(n.timer / SRC_INT), 'rgba(255,255,255,.35)');
  } else if (n.type === 'mix') {
    const r = 0.34 * (1 + 0.15 * n.pulse);
    circle(0, 0.04, r, 'rgba(0,0,0,.12)');
    circle(0, 0, r, '#fff');
    if (n.slots.length) circle(0, 0, 0.12, COL[n.slots[0]]);
    else { ctx.strokeStyle = '#cfc8bb'; ctx.lineWidth = 0.05; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-0.1, 0); ctx.lineTo(0.1, 0); ctx.moveTo(0, -0.1); ctx.lineTo(0, 0.1); ctx.stroke(); }
  } else if (n.type === 'split') {
    const r = 0.34 * (1 + 0.15 * n.pulse);
    circle(0, 0.04, r, 'rgba(0,0,0,.12)');
    circle(0, 0, r, '#1f1f22');
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.05; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-0.11, 0); ctx.lineTo(0.11, 0); ctx.stroke();
    circle(0, -0.1, 0.035, '#fff'); circle(0, 0.1, 0.035, '#fff');
  } else if (n.type === 'rcv') {
    const danger = n.fill > 0.75;
    const sc = danger ? 1 + 0.05 * Math.sin(S.t * 10) : 1;
    ctx.scale(sc, sc);
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0, 0, 0.56, 0, Math.PI * 2); ctx.lineWidth = 0.07; ctx.strokeStyle = 'rgba(42,42,45,.1)'; ctx.stroke();
    if (n.fill > 0) {
      ctx.beginPath(); ctx.arc(0, 0, 0.56, -Math.PI / 2, -Math.PI / 2 + n.fill * Math.PI * 2);
      ctx.strokeStyle = danger ? '#e8453c' : INK; ctx.stroke();
    }
    rr(-0.36, -0.32, 0.72, 0.72, 0.15); ctx.fillStyle = 'rgba(0,0,0,.1)'; ctx.fill();
    rr(-0.36, -0.36, 0.72, 0.72, 0.15); ctx.fillStyle = INK; ctx.fill();
    if (!n.order && n.done) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.07; ctx.beginPath();
      ctx.moveTo(-0.13, 0); ctx.lineTo(-0.03, 0.1); ctx.lineTo(0.14, -0.1); ctx.stroke();
    }
    if (S.over && S.failNode === n) {
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(S.overT * 10);
      ctx.beginPath(); ctx.arc(0, 0, 0.7 + Math.min(S.overT, 1.2) * 0.3, 0, Math.PI * 2); ctx.lineWidth = 0.08; ctx.strokeStyle = '#e8453c'; ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}

function drawOrder(n) {
  if (!n.order) return;
  const items = ORDER.filter(c => n.order[c]);
  const w = items.length * 0.62 + 0.14, h = 0.42;
  const k = easeOutBack(clamp((S.t - n.born - 0.4) / 0.4)) * (1 + 0.08 * n.pop);
  ctx.save(); ctx.translate(n.x, n.y - 0.98); ctx.scale(k, k);
  rr(-w / 2, -h / 2 + 0.03, w, h, h / 2); ctx.fillStyle = 'rgba(0,0,0,.07)'; ctx.fill();
  rr(-w / 2, -h / 2, w, h, h / 2); ctx.fillStyle = '#fff'; ctx.fill();
  items.forEach((c, i) => {
    const x = -w / 2 + 0.07 + i * 0.62;
    const left = n.remain[c];
    ctx.globalAlpha = left ? 1 : 0.3;
    circle(x + 0.18, 0, 0.11, COL[c]);
    txt(String(left), x + 0.44, 0, 0.27, INK);
    ctx.globalAlpha = 1;
  });
  ctx.restore();
}

function draw() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
  const cy = TOP + (H - TOP - BOT) / 2;
  ctx.setTransform(DPR * cam.s, 0, 0, DPR * cam.s, DPR * (W / 2 - cam.x * cam.s), DPR * (cy - cam.y * cam.s));

  const v = S.vb;
  rr(v.x0 - 0.5, v.y0 - 0.5, v.x1 - v.x0 + 1, v.y1 - v.y0 + 1, 0.4);
  ctx.fillStyle = '#f7f5f0'; ctx.fill();
  ctx.fillStyle = 'rgba(42,42,45,.08)';
  for (let x = S.b.x0; x <= S.b.x1; x++) for (let y = S.b.y0; y <= S.b.y1; y++) { ctx.beginPath(); ctx.arc(x, y, 0.035, 0, Math.PI * 2); ctx.fill(); }

  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const b of S.belts) drawBelt(b);
  for (const b of S.belts) if (b.br.length) drawBridges(b);

  if (drag && !drag.done && drag.path.length > 1) {
    drawBeltLine(drag.path, '#c4bcae', 0.85);
    for (const q of drag.path) if (q.br) { circle(q.x, q.y, 0.08, '#8a857c'); }
  }

  for (const n of S.nodes) drawNode(n);
  for (const n of S.nodes) if (n.type === 'rcv') drawOrder(n);

  for (const p of S.parts) {
    const t = p.life / p.max;
    if (p.ring) {
      ctx.globalAlpha = t; ctx.beginPath(); ctx.arc(p.x, p.y, 0.5 + (1 - t) * 0.6, 0, Math.PI * 2);
      ctx.lineWidth = 0.06; ctx.strokeStyle = p.c; ctx.stroke(); ctx.globalAlpha = 1;
    } else circle(p.x, p.y, p.r * t + 0.01, p.c);
  }

  if (place) {
    const w = toWorld(place.x, place.y), x = Math.round(w.x), y = Math.round(w.y);
    const ok = canPlace(x, y);
    ctx.globalAlpha = 0.6;
    circle(ok ? x : w.x, ok ? y : w.y, 0.34, place.k === 'mix' ? '#fff' : '#1f1f22');
    if (!ok) { ctx.beginPath(); ctx.arc(w.x, w.y, 0.38, 0, Math.PI * 2); ctx.lineWidth = 0.04; ctx.strokeStyle = '#e8453c'; ctx.stroke(); }
    ctx.globalAlpha = 1;
  }
}

// ---------- цикл ----------
const scoreEl = $('#score b'), weekEl = $('#week span'), barEl = $('#week .bar i');
let lastScore = -1, lastWeek = -1;
function hud() {
  if (S.score !== lastScore) { lastScore = S.score; scoreEl.textContent = S.score; }
  if (S.week !== lastWeek) { lastWeek = S.week; weekEl.textContent = 'Неделя ' + S.week; }
  barEl.style.width = (S.weekT / WEEK * 100).toFixed(1) + '%';
}

function resize() {
  W = innerWidth; H = innerHeight; DPR = Math.min(devicePixelRatio || 1, 2);
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
}
addEventListener('resize', resize);

let lastT = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  if (live()) update(dt);
  else if (S.over) S.overT += dt;
  camStep(dt);
  draw();
  hud();
  requestAnimationFrame(frame);
}

resize();
newGame();
showStart();
requestAnimationFrame(frame);
// для отладки из консоли: palitra.step(10) прокручивает 10 секунд игры
window.palitra = { get S() { return S; }, cam, step(sec) { for (let i = 0; i < sec * 60; i++) if (live()) update(1 / 60); } };
