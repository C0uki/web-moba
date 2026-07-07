// ---- 描画 ----
'use strict';

const Renderer = {
  canvas: null,
  ctx: null,
  cssW: 0,
  cssH: 0,
  trees: [],
  MINIMAP: 200,

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.makeTrees();
  },

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.cssW = window.innerWidth;
    this.cssH = window.innerHeight;
    this.canvas.width = Math.round(this.cssW * dpr);
    this.canvas.height = Math.round(this.cssH * dpr);
    this.dpr = dpr;
  },

  // ジャングルの木をシード乱数で配置 (レーン・川・拠点を避ける)
  makeTrees() {
    const rng = mulberry32(1234567);
    const W = CONFIG.WORLD;
    this.trees = [];
    let tries = 0;
    while (this.trees.length < 90 && tries < 3000) {
      tries++;
      const x = 90 + rng() * (W - 180);
      const y = 90 + rng() * (W - 180);
      if (Math.abs(x - y) / Math.SQRT2 < 190) continue; // 川
      if (distXY(x, y, BASES.blue[0], BASES.blue[1]) < 520) continue;
      if (distXY(x, y, BASES.red[0], BASES.red[1]) < 520) continue;
      let nearLane = false;
      for (const lane of LANE_KEYS) {
        if (distToPath(LANE_PATHS[lane], x, y) < 170) { nearLane = true; break; }
      }
      if (nearLane) continue;
      this.trees.push({ x, y, r: 16 + rng() * 20, shade: rng() });
    }
  },

  screenToWorld(game, sx, sy) {
    const cam = game.camera;
    return {
      x: (sx - this.cssW / 2) / cam.zoom + cam.x,
      y: (sy - this.cssH / 2) / cam.zoom + cam.y,
    };
  },

  minimapRect() {
    const M = this.MINIMAP;
    return { x: this.cssW - M - 14, y: this.cssH - M - 14, w: M, h: M };
  },

  minimapToWorld(sx, sy) {
    const r = this.minimapRect();
    if (sx < r.x || sy < r.y || sx > r.x + r.w || sy > r.y + r.h) return null;
    return {
      x: (sx - r.x) / r.w * CONFIG.WORLD,
      y: (sy - r.y) / r.h * CONFIG.WORLD,
    };
  },

  draw(game) {
    const c = this.ctx;
    const cam = game.camera;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = '#070d09';
    c.fillRect(0, 0, this.cssW, this.cssH);

    c.save();
    c.translate(this.cssW / 2, this.cssH / 2);
    c.scale(cam.zoom, cam.zoom);
    c.translate(-cam.x, -cam.y);

    this.drawMap(c);

    for (const z of game.zones) this.drawZone(c, z);

    // 構造物 → ミニオン → ヒーロー → 弾 → エフェクト
    for (const u of game.units) {
      if (u.kind === 'tower') this.drawTower(c, u);
      else if (u.kind === 'nexus') this.drawNexus(c, u, game);
    }
    for (const u of game.units) {
      if (u.kind === 'minion' && !u.dead) this.drawMinion(c, u);
    }
    for (const h of game.heroes) {
      if (h.dead) continue;
      const hiddenEnemy = h.team !== game.player.team && h.stealth;
      if (hiddenEnemy && !isRevealed(game, h)) continue;
      if (hiddenEnemy) {
        c.save();
        c.globalAlpha = 0.45;
        this.drawHero(c, h, game);
        c.restore();
      } else {
        this.drawHero(c, h, game);
      }
    }
    for (const p of game.projectiles) this.drawProjectile(c, p);
    for (const e of game.effects) this.drawEffect(c, e);

    c.restore();

    this.drawMinimap(c, game);
  },

  drawMap(c) {
    const W = CONFIG.WORLD;
    // 地面
    c.fillStyle = '#16241b';
    c.fillRect(0, 0, W, W);
    // 外壁
    c.strokeStyle = '#0a1410';
    c.lineWidth = 60;
    c.strokeRect(-30, -30, W + 60, W + 60);

    // 川 (左上→右下)
    c.strokeStyle = 'rgba(60, 120, 150, 0.28)';
    c.lineWidth = 260;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(120, 120);
    c.lineTo(W - 120, W - 120);
    c.stroke();

    // レーン
    c.strokeStyle = '#243627';
    c.lineWidth = 150;
    c.lineJoin = 'round';
    c.lineCap = 'round';
    for (const lane of LANE_KEYS) {
      const p = LANE_PATHS[lane];
      c.beginPath();
      c.moveTo(p[0][0], p[0][1]);
      for (let i = 1; i < p.length; i++) c.lineTo(p[i][0], p[i][1]);
      c.stroke();
    }
    // レーン中央線
    c.strokeStyle = 'rgba(255,255,255,0.05)';
    c.lineWidth = 4;
    c.setLineDash([26, 30]);
    for (const lane of LANE_KEYS) {
      const p = LANE_PATHS[lane];
      c.beginPath();
      c.moveTo(p[0][0], p[0][1]);
      for (let i = 1; i < p.length; i++) c.lineTo(p[i][0], p[i][1]);
      c.stroke();
    }
    c.setLineDash([]);

    // 泉
    for (const team of ['blue', 'red']) {
      const [bx, by] = BASES[team];
      c.beginPath();
      c.arc(bx, by, CONFIG.FOUNTAIN_R, 0, Math.PI * 2);
      c.fillStyle = team === 'blue' ? 'rgba(70,140,230,0.10)' : 'rgba(230,80,80,0.10)';
      c.fill();
      c.beginPath();
      c.arc(bx, by, CONFIG.FOUNTAIN_R, 0, Math.PI * 2);
      c.strokeStyle = team === 'blue' ? 'rgba(93,177,255,0.3)' : 'rgba(255,107,107,0.3)';
      c.lineWidth = 5;
      c.stroke();
    }

    // 木
    for (const t of this.trees) {
      c.beginPath();
      c.arc(t.x, t.y, t.r, 0, Math.PI * 2);
      c.fillStyle = t.shade > 0.5 ? '#1b2f1f' : '#182a1c';
      c.fill();
    }
  },

  drawZone(c, z) {
    const prog = clamp(z.age / z.duration, 0, 1);
    const pulse = 0.5 + 0.15 * Math.sin(z.age * 6);
    c.globalAlpha = (1 - prog * 0.35) * pulse;
    c.beginPath();
    c.arc(z.x, z.y, z.r, 0, Math.PI * 2);
    c.fillStyle = z.color;
    c.fill();
    c.globalAlpha = 1 - prog * 0.2;
    c.beginPath();
    c.arc(z.x, z.y, z.r, 0, Math.PI * 2);
    c.strokeStyle = z.color;
    c.lineWidth = 2;
    c.stroke();
    c.globalAlpha = 1;
  },

  drawBar(c, x, y, w, h, frac, color, extra) {
    c.fillStyle = 'rgba(0,0,0,0.65)';
    c.fillRect(x - 1, y - 1, w + 2, h + 2);
    c.fillStyle = color;
    c.fillRect(x, y, w * clamp(frac, 0, 1), h);
    if (extra && extra.shieldFrac > 0) {
      c.fillStyle = 'rgba(255,255,255,0.85)';
      c.fillRect(x, y, w * clamp(extra.shieldFrac, 0, 1), h * 0.45);
    }
  },

  hpColor(u, game) {
    return u.team === game.player.team ? '#65cf6e' : '#ff5a5a';
  },

  drawMinion(c, m) {
    c.beginPath();
    c.arc(m.x, m.y, m.radius, 0, Math.PI * 2);
    c.fillStyle = m.team === 'blue' ? '#2c5f8a' : '#8a3a3a';
    c.fill();
    c.lineWidth = 2;
    c.strokeStyle = TEAM_COLORS[m.team];
    c.stroke();
    if (m.mtype === 'ranged') {
      c.beginPath();
      c.arc(m.x, m.y, m.radius * 0.45, 0, Math.PI * 2);
      c.fillStyle = '#e8e0c8';
      c.fill();
    }
    this.drawBar(c, m.x - 20, m.y - m.radius - 12, 40, 5, m.hp / m.maxHp,
      m.team === 'blue' ? '#65cf6e' : '#ff5a5a');
  },

  drawTower(c, t) {
    if (t.dead) {
      // 瓦礫
      c.beginPath();
      c.arc(t.x, t.y, t.radius * 0.8, 0, Math.PI * 2);
      c.fillStyle = '#20291f';
      c.fill();
      return;
    }
    // 土台
    c.beginPath();
    c.arc(t.x, t.y, t.radius + 8, 0, Math.PI * 2);
    c.fillStyle = '#101a12';
    c.fill();
    // 本体
    c.beginPath();
    c.arc(t.x, t.y, t.radius, 0, Math.PI * 2);
    c.fillStyle = t.team === 'blue' ? '#1f4468' : '#68251f';
    c.fill();
    c.lineWidth = 4;
    c.strokeStyle = t.invulnerable ? '#777' : TEAM_COLORS[t.team];
    c.stroke();
    // 砲塔
    c.beginPath();
    c.arc(t.x, t.y, t.radius * 0.45, 0, Math.PI * 2);
    c.fillStyle = t.invulnerable ? '#555' : TEAM_COLORS[t.team];
    c.fill();
    this.drawBar(c, t.x - 40, t.y - t.radius - 22, 80, 8, t.hp / t.maxHp,
      t.team === 'blue' ? '#65cf6e' : '#ff5a5a');
  },

  drawNexus(c, n, game) {
    if (n.dead) return;
    const pulse = 1 + Math.sin(game.time * 2.2) * 0.05;
    c.save();
    c.translate(n.x, n.y);
    c.rotate(game.time * 0.35);
    c.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      const r = n.radius * pulse;
      if (i === 0) c.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    c.closePath();
    c.fillStyle = n.team === 'blue' ? '#1f4468' : '#68251f';
    c.fill();
    c.lineWidth = 5;
    c.strokeStyle = n.invulnerable ? '#777' : TEAM_COLORS[n.team];
    c.stroke();
    c.restore();
    this.drawBar(c, n.x - 55, n.y - n.radius - 26, 110, 9, n.hp / n.maxHp,
      n.team === 'blue' ? '#65cf6e' : '#ff5a5a');
  },

  drawHero(c, h, game) {
    // スロー/スタン表示
    if (h.slowT > 0) {
      c.beginPath();
      c.arc(h.x, h.y, h.radius + 7, 0, Math.PI * 2);
      c.strokeStyle = 'rgba(100,170,255,0.6)';
      c.lineWidth = 3;
      c.stroke();
    }

    // 本体
    c.beginPath();
    c.arc(h.x, h.y, h.radius, 0, Math.PI * 2);
    c.fillStyle = h.def.color;
    c.fill();
    c.lineWidth = 4;
    c.strokeStyle = TEAM_COLORS[h.team];
    c.stroke();

    // シールドリング
    if (h.shield > 0) {
      c.beginPath();
      c.arc(h.x, h.y, h.radius + 5, 0, Math.PI * 2);
      c.strokeStyle = 'rgba(255,255,255,0.8)';
      c.lineWidth = 3;
      c.stroke();
    }

    // ステルスリング
    if (h.stealth) {
      c.save();
      c.setLineDash([6, 5]);
      c.beginPath();
      c.arc(h.x, h.y, h.radius + 9, 0, Math.PI * 2);
      c.strokeStyle = 'rgba(220,220,255,0.75)';
      c.lineWidth = 2;
      c.stroke();
      c.setLineDash([]);
      c.restore();
    }

    // プレイヤーマーカー
    if (h === game.player) {
      c.beginPath();
      c.arc(h.x, h.y, h.radius + 11, 0, Math.PI * 2);
      c.strokeStyle = 'rgba(255,255,255,0.55)';
      c.lineWidth = 2;
      c.setLineDash([8, 7]);
      c.stroke();
      c.setLineDash([]);
    }

    // イニシャル
    c.fillStyle = '#10160f';
    c.font = `bold ${Math.round(h.radius * 1.1)}px sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(h.def.letter, h.x, h.y + 1);

    // 名前 + レベル
    c.font = 'bold 13px sans-serif';
    c.fillStyle = TEAM_COLORS[h.team];
    c.fillText(`${h.name} Lv${h.level}`, h.x, h.y - h.radius - 26);

    // HPバー (+マナ)
    const bw = 56;
    this.drawBar(c, h.x - bw / 2, h.y - h.radius - 18, bw, 7,
      h.hp / h.maxHp, this.hpColor(h, game),
      { shieldFrac: h.shield / h.maxHp });
    this.drawBar(c, h.x - bw / 2, h.y - h.radius - 9, bw, 3,
      h.mana / h.maxMana, '#5a9fe0');

    // リコール詠唱
    if (h.recallT != null) {
      const prog = 1 - h.recallT / CONFIG.RECALL_TIME;
      c.beginPath();
      c.arc(h.x, h.y, h.radius + 16, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
      c.strokeStyle = '#8ec8ff';
      c.lineWidth = 5;
      c.stroke();
    }

    // スタン
    if (h.stunT > 0) {
      c.fillStyle = '#ffd54f';
      c.font = 'bold 16px sans-serif';
      c.fillText('✦', h.x, h.y - h.radius - 40);
    }
  },

  drawProjectile(c, p) {
    const size = p.kind === 'line' ? p.radius * 0.6 : p.size;
    c.beginPath();
    c.arc(p.x, p.y, size + 3, 0, Math.PI * 2);
    c.fillStyle = 'rgba(255,255,255,0.18)';
    c.fill();
    c.beginPath();
    c.arc(p.x, p.y, size, 0, Math.PI * 2);
    c.fillStyle = p.color;
    c.fill();
  },

  drawEffect(c, e) {
    const prog = clamp(e.t / e.ttl, 0, 1);
    if (e.kind === 'ring') {
      const r = e.r * (0.35 + 0.65 * prog);
      c.globalAlpha = 1 - prog;
      if (e.fill) {
        c.beginPath();
        c.arc(e.x, e.y, r, 0, Math.PI * 2);
        c.fillStyle = e.color;
        c.globalAlpha = (1 - prog) * 0.35;
        c.fill();
        c.globalAlpha = 1 - prog;
      }
      c.beginPath();
      c.arc(e.x, e.y, r, 0, Math.PI * 2);
      c.strokeStyle = e.color;
      c.lineWidth = 4;
      c.stroke();
      c.globalAlpha = 1;
    } else if (e.kind === 'text') {
      c.globalAlpha = 1 - prog;
      c.fillStyle = e.color;
      c.font = 'bold 17px sans-serif';
      c.textAlign = 'center';
      c.fillText(e.txt, e.x, e.y - prog * 34);
      c.globalAlpha = 1;
    } else if (e.kind === 'click') {
      const r = 22 * (1 - prog);
      c.globalAlpha = 1 - prog;
      c.beginPath();
      c.arc(e.x, e.y, r, 0, Math.PI * 2);
      c.strokeStyle = e.color || '#8bc34a';
      c.lineWidth = 3;
      c.stroke();
      c.globalAlpha = 1;
    }
  },

  drawMinimap(c, game) {
    const r = this.minimapRect();
    const s = r.w / CONFIG.WORLD;
    c.save();
    c.translate(r.x, r.y);

    c.fillStyle = 'rgba(10, 18, 12, 0.9)';
    c.fillRect(0, 0, r.w, r.h);

    // レーン
    c.strokeStyle = '#2c4433';
    c.lineWidth = 5;
    c.lineCap = 'round';
    for (const lane of LANE_KEYS) {
      const p = LANE_PATHS[lane];
      c.beginPath();
      c.moveTo(p[0][0] * s, p[0][1] * s);
      for (let i = 1; i < p.length; i++) c.lineTo(p[i][0] * s, p[i][1] * s);
      c.stroke();
    }
    // 川
    c.strokeStyle = 'rgba(60,120,150,0.4)';
    c.lineWidth = 6;
    c.beginPath();
    c.moveTo(8, 8);
    c.lineTo(r.w - 8, r.h - 8);
    c.stroke();

    // タワー / ネクサス
    for (const t of game.towers) {
      if (t.dead) continue;
      c.fillStyle = TEAM_COLORS[t.team];
      c.fillRect(t.x * s - 3, t.y * s - 3, 6, 6);
    }
    for (const team of ['blue', 'red']) {
      const n = game.nexus[team];
      if (n.dead) continue;
      c.fillStyle = TEAM_COLORS[team];
      c.beginPath();
      c.arc(n.x * s, n.y * s, 5, 0, Math.PI * 2);
      c.fill();
    }

    // ミニオン
    for (const u of game.units) {
      if (u.kind !== 'minion' || u.dead) continue;
      c.fillStyle = TEAM_COLORS[u.team];
      c.fillRect(u.x * s - 1, u.y * s - 1, 2.5, 2.5);
    }

    // ヒーロー
    for (const h of game.heroes) {
      if (h.dead) continue;
      if (h.team !== game.player.team && h.stealth && !isRevealed(game, h)) continue;
      c.beginPath();
      c.arc(h.x * s, h.y * s, 4, 0, Math.PI * 2);
      c.fillStyle = h.def.color;
      c.fill();
      c.lineWidth = h === game.player ? 2 : 1;
      c.strokeStyle = h === game.player ? '#fff' : TEAM_COLORS[h.team];
      c.stroke();
    }

    // カメラ範囲
    const cam = game.camera;
    const vw = this.cssW / cam.zoom * s;
    const vh = this.cssH / cam.zoom * s;
    c.strokeStyle = 'rgba(255,255,255,0.5)';
    c.lineWidth = 1;
    c.strokeRect(cam.x * s - vw / 2, cam.y * s - vh / 2, vw, vh);

    c.strokeStyle = '#4d7a58';
    c.lineWidth = 2;
    c.strokeRect(0, 0, r.w, r.h);
    c.restore();
  },
};
