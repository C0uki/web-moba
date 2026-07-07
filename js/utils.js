// ---- 汎用ユーティリティ ----
'use strict';

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function lerp(a, b, t) { return a + (b - a) * t; }
function rand(a, b) { return a + Math.random() * (b - a); }
function randInt(a, b) { return Math.floor(rand(a, b + 1)); }

function distXY(ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); }
function distU(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }

// 正規化ベクトル {x, y, len}
function norm(dx, dy) {
  const l = Math.hypot(dx, dy);
  if (l < 0.0001) return null;
  return { x: dx / l, y: dy / l, len: l };
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---- パス(折れ線)関連 ----
function pathCumLen(path) {
  const acc = [0];
  for (let i = 1; i < path.length; i++) {
    acc.push(acc[i - 1] + distXY(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]));
  }
  return acc;
}

// パス上の割合 f (0-1) の座標
function pointAtFraction(path, f) {
  const acc = pathCumLen(path);
  const target = clamp(f, 0, 1) * acc[acc.length - 1];
  for (let i = 1; i < acc.length; i++) {
    if (target <= acc[i]) {
      const seg = (target - acc[i - 1]) / Math.max(0.001, acc[i] - acc[i - 1]);
      return [lerp(path[i - 1][0], path[i][0], seg), lerp(path[i - 1][1], path[i][1], seg)];
    }
  }
  return path[path.length - 1].slice();
}

// 点と線分の距離
function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  if (l2 < 0.0001) return distXY(px, py, x1, y1);
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / l2, 0, 1);
  return distXY(px, py, x1 + t * dx, y1 + t * dy);
}

function distToPath(path, x, y) {
  let m = Infinity;
  for (let i = 1; i < path.length; i++) {
    m = Math.min(m, distToSegment(x, y, path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]));
  }
  return m;
}

// パスの頂点のうち最も近いインデックス
function nearestVertex(path, x, y) {
  let bi = 0, bd = Infinity;
  for (let i = 0; i < path.length; i++) {
    const d = distXY(x, y, path[i][0], path[i][1]);
    if (d < bd) { bd = d; bi = i; }
  }
  return bi;
}

// シード付き乱数 (マップ装飾用)
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function formatTime(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

// ステルス中のユニットが敵陣から見えているか (近くに敵ユニットがいれば発見される)
function isRevealed(g, u) {
  if (!u.stealth) return true;
  const seekerTeam = enemyOf(u.team);
  if (g.detectVision && g.detectVision[seekerTeam] > 0) return true;
  for (const s of g.units) {
    if (s.team !== seekerTeam || s.dead) continue;
    if (distU(s, u) <= 260) return true;
  }
  return false;
}
