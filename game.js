'use strict';
// Палитра — гиперказуальная логистика цветов. Canvas 2D, без зависимостей.
// Ленты — это клетки сетки, у каждой своё направление. Рисуются кистью, стираются ластиком.

// ---------- константы ----------
const COL = { R: '#e8453c', O: '#f28a1a', Y: '#f2c200', G: '#2fae5b', B: '#2f6fe4', V: '#8b55d6' };
const NAME = { R: 'красный', O: 'оранжевый', Y: 'жёлтый', G: 'зелёный', B: 'синий', V: 'фиолетовый' };
const PRIM = ['R', 'Y', 'B'];
const SEC = ['O', 'G', 'V'];
const SPLIT = { O: ['R', 'Y'], G: ['Y', 'B'], V: ['R', 'B'] };
const MIX = {};
for (const k in SPLIT) { const [a, b] = SPLIT[k]; MIX[a + b] = k; MIX[b + a] = k; }
const PITCH = { R: 0, O: 2, Y: 4, G: 7, B: 9, V: 11 };
const DIRS = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];

const SPEED = 2.2;       // клеток в секунду
const SRC_INT = 1.5;     // источник выпускает кружок раз в N секунд
const WEEK = 45;         // длина недели, с
const BITE = 0.13;       // насколько один кружок утоляет голод приёмника
const PATIENCE0 = 45;    // за сколько секунд голодный приёмник лопается в начале
const PATIENCE_MIN = 16; // и к чему это время сжимается
const TOP = 70, BOT = 96;
const BG = '#efece6', INK = '#2a2a2d', BELT = '#d8d2c7';

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
const same = (a, b) => a.x === b.x && a.y === b.y;
const opp = (a, b) => a.x === -b.x && a.y === -b.y;
const axis = d => d.x ? 'h' : 'v';

const cv = $('#c'), ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;
const cam = { x: 0, y: 0, s: 40 };
let S = null;
let best = 0;
let frameNo = 0;
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
// Клетка: { x, y, node, flows }. flows — 0, 1 или 2 (мост) потока { dir, dot, jam }
const cell = (x, y) => S.cells.get(key(x, y));
function cellMk(x, y) {
  let c = S.cells.get(key(x, y));
  if (!c) { c = { x, y, node: null, flows: [] }; S.cells.set(key(x, y), c); }
  return c;
}
const inB = (x, y) => x >= S.b.x0 && x <= S.b.x1 && y >= S.b.y0 && y <= S.b.y1;
const mkFlow = dir => ({ dir: { x: dir.x, y: dir.y }, alt: [], dot: null, jam: 0, born: S.t, rr: 0 });
// Все выходы потока: основной и ответвления развилки
const outsOf = f => f.alt.length ? [f.dir, ...f.alt] : [f.dir];
const outOf = (f, d) => d.o || f.dir;
const busy = c => !!c && (!!c.node || c.flows.length > 0);

// В какой поток клетки попадёт кружок, едущий в направлении m
function pickFlow(c, m) {
  if (!c || !c.flows.length) return null;
  if (c.flows.length === 1) return opp(c.flows[0].dir, m) ? null : c.flows[0];
  return c.flows.find(f => same(f.dir, m)) || null;
}

function addNode(type, x, y, color) {
  const n = { id: S.id++, type, x, y, color, born: S.t, outQ: [], slots: [], timer: 0, pulse: 0, rr: 0 };
  if (type === 'rcv') Object.assign(n, { want: color, fill: 0, patience: PATIENCE0, pop: 0, fed: 0 });
  S.nodes.push(n);
  cellMk(x, y).node = n;
  return n;
}

function findSpot() {
  for (const minD of [3, 2]) {
    for (let i = 0; i < 300; i++) {
      const x = S.b.x0 + rnd(S.b.x1 - S.b.x0 + 1), y = S.b.y0 + rnd(S.b.y1 - S.b.y0 + 1);
      if (busy(cell(x, y))) continue;
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
    vb: null, portrait, nodes: [], cells: new Map(), parts: [], id: 1,
    inv: { belt: 40, mix: 1, split: 1, bridge: 1 },
    srcT: 26, rcvT: 18, srcCount: 0, hinted: {}, failNode: null,
  };
  S.vb = { ...S.b };
  if (portrait) { addNode('src', -2, -3, 'R'); addNode('src', 2, -3, 'B'); addNode('rcv', 0, 3, 'R'); }
  else { addNode('src', -4, -2, 'R'); addNode('src', -4, 2, 'B'); addNode('rcv', 4, 0, 'R'); }
  drag = null; erasing = null; place = null;
  setErase(false);
  fitCam(true);
  updPanel();
}

function hintFor(c) {
  if (S.hinted[c]) return;
  S.hinted[c] = true;
  const direct = directColors();
  if (SPLIT[c]) {
    const [a, b] = SPLIT[c];
    hint(`${dot(a)} ${NAME[a]} + ${dot(b)} ${NAME[b]} в белом смесителе = ${dot(c)} ${NAME[c]}`, 7);
  } else {
    const from = SEC.find(s => direct.has(s) && SPLIT[s].includes(c));
    if (from) hint(`Чёрный разделитель: ${dot(from)} ${NAME[from]} → ${SPLIT[from].map(dot).join(' + ')}`, 7);
  }
}

function pickWant() {
  const direct = directColors();
  const avail = producible();
  const taken = S.nodes.filter(n => n.type === 'rcv').map(n => n.want);
  const indirect = avail.filter(c => !direct.has(c));
  let pool = indirect.length && Math.random() < 0.6 ? indirect : avail;
  const fresh = pool.filter(c => !taken.includes(c));
  if (fresh.length && Math.random() < 0.7) pool = fresh;
  return pool[rnd(pool.length)];
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
  const c = pickWant();
  addNode('rcv', p.x, p.y, c);
  if (!directColors().has(c)) hintFor(c);
  tone(PITCH[c] - 5, 0.3, 0.05, 'triangle');
}

function grow() {
  const b = S.b;
  const [mx, my] = S.portrait ? [6, 10] : [11, 7];
  const wantX = S.week % 2 === 0;
  if ((wantX && b.x1 < mx) || b.y1 >= my) { if (b.x1 < mx) { b.x0--; b.x1++; } }
  else if (b.y1 < my) { b.y0--; b.y1++; }
}

function update(dt) {
  S.t += dt; frameNo++;
  S.srcT -= dt; if (S.srcT <= 0) { S.srcT = 30; spawnSrc(); }
  S.rcvT -= dt; if (S.rcvT <= 0) { S.rcvT = 30; spawnRcv(); }
  S.weekT += dt;
  if (S.weekT >= WEEK) { S.weekT = 0; S.week++; grow(); showWeek(); }

  for (const n of S.nodes) {
    n.pulse = Math.max(0, n.pulse - dt * 3);
    if (n.type === 'src') {
      n.timer += dt;
      if (n.timer >= SRC_INT && !n.outQ.length) { n.outQ.push(n.color); n.timer = 0; }
    } else if (n.type === 'rcv') updRcv(n, dt);
    emit(n);
  }
  for (const c of S.cells.values()) for (const f of c.flows) if (f.dot) moveDot(c, f, dt);
  for (const p of S.parts) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92; }
  S.parts = S.parts.filter(p => p.life > 0);
}

// Приёмник всё время голодает; каждый кружок его цвета отодвигает голод
function updRcv(n, dt) {
  n.pop = Math.max(0, n.pop - dt * 4);
  if (S.t - n.born < 0.6) return;
  n.patience = Math.max(PATIENCE_MIN, n.patience - dt * 0.07);
  n.fill += dt / n.patience;
  if (n.fill >= 1) gameOver(n);
}

function moveDot(c, f, dt) {
  const d = f.dot;
  if (d.fr === frameNo) return;
  // На развилке кружок выбирает ветку в центре клетки; если все нужные ветки заняты — ждёт
  if (f.alt.length && !d.o) {
    d.p = Math.min(d.p + SPEED * dt, 0.5);
    if (d.p < 0.5) return;
    const o = chooseOut(c, f, d.c);
    if (!o) return;
    d.o = { ...o };
  }
  const o = outOf(f, d);
  const nc = cell(c.x + o.x, c.y + o.y);
  const lim = busy(nc) ? 1 : 0.75; // на обрыве ленты кружок стоит у края
  d.p = Math.min(d.p + SPEED * dt, lim);
  if (d.p < 1) { f.jam = 0; return; }
  if (nc.node) {
    if (accept(nc.node, d.c)) { f.dot = null; f.jam = 0; }
    else f.jam = wrong(nc.node, d.c) ? f.jam + dt : 0;
    return;
  }
  const t = pickFlow(nc, o);
  if (t && !t.dot) { t.dot = d; d.p -= 1; d.m = { ...o }; d.o = null; d.fr = frameNo; f.dot = null; f.jam = 0; }
}

// Свободна ли следующая клетка в сторону o (для узла — примет ли он цвет прямо сейчас)
function freeTo(c, o, col) {
  const nc = cell(c.x + o.x, c.y + o.y);
  if (!nc) return false;
  if (nc.node) return nc.node.type !== 'src' && !wrong(nc.node, col) && (nc.node.type !== 'rcv' || nc.node.fill >= 0.03);
  const t = pickFlow(nc, o);
  return !!t && !t.dot;
}

// Ветки, которые ведут к тому, кому этот цвет нужен; среди свободных — по очереди
function chooseOut(c, f, col) {
  const live = outsOf(f).filter(o => busy(cell(c.x + o.x, c.y + o.y)));
  if (!live.length) return f.dir;
  const good = live.filter(o => dests(c, o).some(n => wants(n, col)));
  const free = (good.length ? good : live).filter(o => freeTo(c, o, col));
  if (!free.length) return null;
  return free[(f.rr++) % free.length];
}

// Все узлы, куда может приехать кружок, выйдя из клетки c в сторону o (с учётом развилок)
function dests(c, o) {
  const out = [], seen = new Set(), st = [[c, o]];
  while (st.length && seen.size < 300) {
    const [a, m] = st.pop();
    const nc = cell(a.x + m.x, a.y + m.y);
    if (!nc) continue;
    if (nc.node) { if (!out.includes(nc.node)) out.push(nc.node); continue; }
    const f = pickFlow(nc, m);
    if (!f) continue;
    const k = key(nc.x, nc.y) + (nc.flows.length === 2 ? axis(m) : '');
    if (seen.has(k)) continue;
    seen.add(k);
    for (const d of outsOf(f)) st.push([nc, d]);
  }
  return out;
}

function wants(n, c) {
  if (n.type === 'rcv') return c === n.want;
  if (n.type === 'mix') return PRIM.includes(c) && !n.slots.includes(c);
  if (n.type === 'split') return SEC.includes(c);
  return false;
}

// Цвет, который узел не примет никогда (а не просто занят): из-за него лента краснеет
function wrong(n, c) {
  if (n.type === 'rcv') return c !== n.want;
  if (n.type === 'mix') return !PRIM.includes(c);
  if (n.type === 'split') return !SEC.includes(c);
  return true;
}

// Узел выталкивает готовые кружки на соседние ленты. Сначала туда, где цвет нужен
function emit(n) {
  while (n.outQ.length) {
    const c = n.outQ[0];
    const outs = [];
    for (const e of DIRS) {
      const cc = cell(n.x + e.x, n.y + e.y);
      const f = pickFlow(cc, e);
      if (f && !f.dot) outs.push({ cc, f, e });
    }
    if (!outs.length) return;
    const good = outs.filter(o => dests(n, o.e).some(t => wants(t, c)));
    const pool = good.length ? good : outs;
    const o = pool[(n.rr++) % pool.length];
    o.f.dot = { c, p: 0, m: { ...o.e }, born: S.t, fr: frameNo };
    n.outQ.shift();
    if (n.type === 'src') n.pulse = 1;
  }
}

function accept(n, c) {
  if (n.type === 'rcv') {
    if (c !== n.want || n.fill < 0.03) return false;
    n.fill = Math.max(0, n.fill - BITE); n.pop = 1; n.fed++; S.score++;
    burst(n.x, n.y, COL[c], 5);
    tone(PITCH[c], 0.12, 0.05);
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

// ---------- кисть ----------
// Путь — список клеток. Пустые клетки становятся лентой, по уже лежащей ленте кисть
// перекрашивает направление, прямо поперёк ленты кладёт мост, а последняя клетка
// на чужой ленте означает «влиться в неё».
function planPath(p, apply) {
  let cost = 0, bridges = 0;
  const n = p.length;
  if (n < 2) return { cost, bridges };
  for (let i = 0; i < n; i++) {
    const q = p[i], c = cell(q.x, q.y);
    if (c && c.node) continue;
    const fl = c ? c.flows : [];
    const inM = i > 0 ? { x: q.x - p[i - 1].x, y: q.y - p[i - 1].y } : null;
    const outM = i < n - 1 ? { x: p[i + 1].x - q.x, y: p[i + 1].y - q.y } : null;
    if (!outM) {
      if (fl.length) continue;
      cost++;
      if (apply) cellMk(q.x, q.y).flows = [mkFlow(inM)];
      continue;
    }
    if (!fl.length) {
      cost++;
      if (apply) cellMk(q.x, q.y).flows = [mkFlow(outM)];
      continue;
    }
    // Начал рисовать с середины ленты — получается развилка, лента не поворачивает
    if (!inM) {
      if (fl.length === 2) continue;
      const f = fl[0];
      if (outsOf(f).some(d => same(d, outM))) continue;
      const leads = busy(cell(q.x + f.dir.x, q.y + f.dir.y));
      if (leads && !feedsFrom(c, outM)) { if (apply) f.alt.push({ ...outM }); continue; }
      if (apply) { f.dir = { ...outM }; f.alt = []; }
      continue;
    }
    if (inM && same(inM, outM)) {
      if (fl.length === 1 && axis(fl[0].dir) !== axis(outM) && S.inv.bridge - bridges > 0) {
        bridges++;
        if (apply) fl.push(mkFlow(outM));
        continue;
      }
      const f = fl.length === 2 && fl.find(f => axis(f.dir) === axis(outM));
      if (f) { if (apply) f.dir = { ...outM }; continue; }
    }
    if (!apply) continue;
    if (fl.length === 2) { dropDots(c); S.inv.bridge++; c.flows = [mkFlow(outM)]; }
    else { fl[0].dir = { ...outM }; fl[0].alt = []; if (fl[0].dot) fl[0].dot.o = null; }
  }
  if (apply) { S.inv.belt -= cost; S.inv.bridge -= bridges; }
  return { cost, bridges };
}

let drag = null, erasing = null, place = null, eraseMode = false;

// Ведём путь клетка за клеткой к пальцу, чтобы не было диагоналей и пропусков
function walk(from, tx, ty, fn) {
  let x = from.x, y = from.y, guard = 0;
  while ((x !== tx || y !== ty) && guard++ < 80) {
    const dx = tx - x, dy = ty - y;
    if (Math.abs(dx) >= Math.abs(dy)) x += Math.sign(dx); else y += Math.sign(dy);
    fn(x, y);
  }
}

function dragTo(tx, ty) {
  let guard = 0;
  while (guard++ < 80) {
    const p = drag.path, L = p[p.length - 1];
    if (L.x === tx && L.y === ty) break;
    const dx = tx - L.x, dy = ty - L.y;
    let sx = 0, sy = 0;
    if (Math.abs(dx) >= Math.abs(dy)) sx = Math.sign(dx); else sy = Math.sign(dy);
    const P = p[p.length - 2];
    if (P && P.x === L.x + sx && P.y === L.y + sy) { p.pop(); drag.ended = false; continue; }
    if (drag.ended) break;
    let ok = step(L.x + sx, L.y + sy);
    if (!ok) {
      const ax = sx ? 0 : Math.sign(dx), ay = sx ? Math.sign(dy) : 0;
      if (ax || ay) ok = step(L.x + ax, L.y + ay);
    }
    if (!ok) break;
  }
  drag.plan = planPath(drag.path, false);
  updPanel();
}

function step(x, y) {
  const p = drag.path;
  if (!inB(x, y) || p.some(q => q.x === x && q.y === y)) return false;
  const c = cell(x, y);
  if (c && c.node) {
    if (c.node === drag.start || c.node.type === 'src') return false;
    p.push({ x, y }); drag.ended = true;
    return true;
  }
  p.push({ x, y });
  if (planPath(p, false).cost > S.inv.belt) { p.pop(); bump('belt'); return false; }
  return true;
}

function commitDrag() {
  if (!drag || drag.path.length < 2) return;
  const r = planPath(drag.path, true);
  tone(7, 0.1, 0.04); tone(12, 0.12, 0.03);
  if (r.bridges) tone(16, 0.15, 0.03);
  if (!S.hinted.first) { S.hinted.first = true; hide('hint'); }
}

function dropDots(c) {
  for (const f of c.flows) if (f.dot) burst(c.x, c.y, COL[f.dot.c], 2);
}

// Ластик: стирает одну клетку — ленту или поставленный узел
function eraseAt(x, y) {
  const c = cell(x, y);
  if (!c) return;
  if (c.node) {
    const n = c.node;
    if (n.type !== 'mix' && n.type !== 'split') return;
    c.node = null;
    S.nodes = S.nodes.filter(m => m !== n);
    unlink(x, y);
    S.inv[n.type]++;
    burst(n.x, n.y, n.type === 'mix' ? '#cfc8bb' : '#1f1f22', 6);
    bump(n.type);
  } else if (c.flows.length) {
    dropDots(c);
    S.inv.belt++;
    if (c.flows.length === 2) S.inv.bridge++;
    c.flows = [];
    unlink(x, y);
    burst(x, y, '#c9c1b4', 3);
    bump('belt');
  } else return;
  tone(-3 + rnd(3), 0.06, 0.03, 'triangle');
  updPanel();
}

// Клетку стёрли: соседние развилки забывают ветку, которая туда вела
function unlink(x, y) {
  for (const e of DIRS) {
    const nc = cell(x - e.x, y - e.y);
    if (!nc || nc.flows.length !== 1) continue;
    const f = nc.flows[0];
    if (!f.alt.length) continue;
    f.alt = f.alt.filter(d => !same(d, e));
    if (same(f.dir, e) && f.alt.length) f.dir = f.alt.shift();
    if (f.dot && f.dot.o && same(f.dot.o, e)) { f.dot.o = null; f.dot.p = Math.min(f.dot.p, 0.5); }
  }
}

const canPlace = (x, y) => inB(x, y) && !busy(cell(x, y));

// ---------- ввод ----------
function toWorld(px, py) {
  const cy = TOP + (H - TOP - BOT) / 2;
  return { x: (px - W / 2) / cam.s + cam.x, y: (py - cy) / cam.s + cam.y };
}
const live = () => S && S.running && !S.over && !S.paused;
const cellAt = e => { const w = toWorld(e.clientX, e.clientY); return { x: Math.round(w.x), y: Math.round(w.y) }; };

cv.addEventListener('pointerdown', e => {
  audioInit();
  if (!live()) return;
  const { x, y } = cellAt(e);
  try { cv.setPointerCapture(e.pointerId); } catch (err) {}
  if (eraseMode || e.button === 2) {
    erasing = { x, y };
    eraseAt(x, y);
    return;
  }
  if (!inB(x, y)) return;
  const c = cell(x, y);
  if (c && c.node && c.node.type === 'rcv') return;
  drag = { start: c && c.node, path: [{ x, y }], ended: false, plan: { cost: 0, bridges: 0 } };
});
cv.addEventListener('pointermove', e => {
  if (!live()) return;
  const { x, y } = cellAt(e);
  if (erasing) {
    walk(erasing, x, y, eraseAt);
    erasing = { x, y };
  } else if (drag) dragTo(x, y);
});
function endPointer() {
  if (drag && live()) commitDrag();
  drag = null; erasing = null;
  if (S) updPanel();
}
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', () => { drag = null; erasing = null; if (S) updPanel(); });
cv.addEventListener('contextmenu', e => e.preventDefault());

function setErase(on) {
  eraseMode = on;
  $('#erase').classList.toggle('on', on);
  cv.style.cursor = on ? 'cell' : 'default';
}
$('#erase').addEventListener('click', () => { audioInit(); if (live()) setErase(!eraseMode); });

document.querySelectorAll('#panel .drag').forEach(el => el.addEventListener('pointerdown', e => {
  audioInit();
  if (!live()) return;
  const k = el.dataset.k;
  if (S.inv[k] <= 0) { bump(k); return; }
  setErase(false);
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
  if (drag && drag.plan) { shown.belt -= drag.plan.cost; shown.bridge -= drag.plan.bridges; }
  document.querySelectorAll('#panel .item[data-k]').forEach(el => {
    const v = shown[el.dataset.k];
    el.querySelector('b').textContent = v;
    el.classList.toggle('zero', v <= 0);
  });
}

const dot = c => `<span class="d" style="background:${COL[c]}"></span>`;
function showStart() {
  ov(`<h1>Палитра</h1>
    <p>Рисуй ленты от цветных источников к тёмным приёмникам. Каждый приёмник ест свой цвет и всё время голоден.</p>
    <p><span class="d w"></span> белый смеситель: ${dot('R')} + ${dot('Y')} = ${dot('O')}<br>
    <span class="d" style="background:#1f1f22"></span> чёрный разделитель: ${dot('O')} → ${dot('R')} + ${dot('Y')}</p>
    <p>Начни новую ленту с середины старой — будет развилка: кружки сами поедут туда, где их цвет нужен.</p>
    <p>Ластик в панели (или правая кнопка мыши) стирает по клеткам.</p>
    <button class="main" id="go">Играть</button>
    ${best ? `<small>Рекорд: ${best}</small>` : ''}`);
  $('#go').onclick = () => { audioInit(); newGame(); S.running = true; hide(); hint(`Проведи ленту от ${dot('R')} к квадрату с ${dot('R')}`); };
}
function showWeek() {
  S.paused = true; drag = null; erasing = null; place = null;
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
  S.paused = true; drag = null; erasing = null; place = null;
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
  const s = Math.min(72, (W - 24) / (bw + 0.8), (H - TOP - BOT - 16) / (bh + 0.8));
  const x = (b.x0 + b.x1) / 2, y = (b.y0 + b.y1) / 2;
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
function polyline(p) { ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y); for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y); }

// Соседняя клетка в стороне e подаёт кружки в поток f этой клетки?
function feeds(c, e, f) {
  if (outsOf(f).some(d => same(d, e))) return false;
  return feedsFrom(c, e);
}
function feedsFrom(c, e) {
  const nc = cell(c.x + e.x, c.y + e.y);
  if (!nc) return false;
  if (nc.node) return nc.node.type !== 'rcv';
  return nc.flows.some(g => outsOf(g).some(d => opp(d, e)));
}

function stroke(segs, w, color, dash) {
  ctx.beginPath();
  for (const s of segs) { ctx.moveTo(s[0].x, s[0].y); for (let i = 1; i < s.length; i++) ctx.lineTo(s[i].x, s[i].y); }
  ctx.lineWidth = w; ctx.strokeStyle = color;
  if (dash) { ctx.setLineDash([0.06, 0.44]); ctx.lineDashOffset = -S.t * SPEED; }
  ctx.stroke();
  if (dash) ctx.setLineDash([]);
}

function drawFlow(c, f, straight) {
  const ctr = { x: c.x, y: c.y };
  let segs, main;
  if (straight) {
    const a = { x: c.x - f.dir.x * 0.5, y: c.y - f.dir.y * 0.5 }, b = { x: c.x + f.dir.x * 0.5, y: c.y + f.dir.y * 0.5 };
    segs = [[a, b]]; main = [[a, b]];
  } else {
    const ins = DIRS.filter(e => feeds(c, e, f));
    const outs = outsOf(f).map(d => {
      const len = busy(cell(c.x + d.x, c.y + d.y)) ? 0.5 : 0.22;
      return { x: c.x + d.x * len, y: c.y + d.y * len };
    });
    segs = ins.map(e => [{ x: c.x + e.x * 0.5, y: c.y + e.y * 0.5 }, ctr]);
    for (const o of outs) segs.push([ctr, o]);
    main = outs.map(o => ins.length ? [segs[0][0], ctr, o] : [ctr, o]);
  }
  const k = easeOut(clamp((S.t - f.born) / 0.2));
  stroke(segs, 0.46 * k, BELT);
  if (f.jam > 1.2) {
    ctx.globalAlpha = 0.3 + 0.2 * Math.sin(S.t * 8);
    stroke(segs, 0.46, '#e8453c');
    ctx.globalAlpha = 1;
  }
  stroke(main, 0.07, 'rgba(255,255,255,.75)', true);
}

// Бортики моста под верхней лентой
function drawRails(c, f) {
  ctx.lineCap = 'butt';
  stroke([[{ x: c.x - f.dir.x * 0.5, y: c.y - f.dir.y * 0.5 }, { x: c.x + f.dir.x * 0.5, y: c.y + f.dir.y * 0.5 }]], 0.62, '#b4ac9e');
  ctx.lineCap = 'round';
}

function dotPos(c, f, d) {
  if (d.p < 0.5) return { x: c.x - d.m.x * (0.5 - d.p), y: c.y - d.m.y * (0.5 - d.p) };
  const o = outOf(f, d);
  return { x: c.x + o.x * (d.p - 0.5), y: c.y + o.y * (d.p - 0.5) };
}

function drawDot(c, f) {
  const d = f.dot, q = dotPos(c, f, d);
  const k = easeOut(clamp((S.t - d.born) / 0.15));
  circle(q.x, q.y, 0.15 * k, COL[d.c]);
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
    if (n.fill > 0.005) {
      ctx.beginPath(); ctx.arc(0, 0, 0.56, -Math.PI / 2, -Math.PI / 2 + n.fill * Math.PI * 2);
      ctx.strokeStyle = danger ? '#e8453c' : INK; ctx.stroke();
    }
    rr(-0.36, -0.32, 0.72, 0.72, 0.15); ctx.fillStyle = 'rgba(0,0,0,.1)'; ctx.fill();
    rr(-0.36, -0.36, 0.72, 0.72, 0.15); ctx.fillStyle = INK; ctx.fill();
    circle(0, 0, 0.16 * (1 + 0.35 * n.pop), COL[n.want]);
    if (S.over && S.failNode === n) {
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(S.overT * 10);
      ctx.beginPath(); ctx.arc(0, 0, 0.7 + Math.min(S.overT, 1.2) * 0.3, 0, Math.PI * 2); ctx.lineWidth = 0.08; ctx.strokeStyle = '#e8453c'; ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
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
  const cells = [...S.cells.values()].filter(c => c.flows.length);
  for (const c of cells) if (c.flows.length === 1) drawFlow(c, c.flows[0], false);
  for (const c of cells) if (c.flows.length === 2) {
    drawFlow(c, c.flows[0], true);
    drawRails(c, c.flows[1]);
    drawFlow(c, c.flows[1], true);
  }
  for (const c of cells) for (const f of c.flows) if (f.dot) drawDot(c, f);

  if (drag && drag.path.length > 1) {
    ctx.globalAlpha = 0.55;
    polyline(drag.path); ctx.lineWidth = 0.46; ctx.strokeStyle = '#b9b0a2'; ctx.stroke();
    ctx.globalAlpha = 1;
  }

  for (const n of S.nodes) drawNode(n);

  for (const p of S.parts) {
    const t = p.life / p.max;
    circle(p.x, p.y, p.r * t + 0.01, p.c);
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
