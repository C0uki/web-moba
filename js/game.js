// ---- ゲーム本体 ----
'use strict';

class Game {
  constructor(playerHeroKey) {
    this.time = 0;
    this.over = false;
    this.paused = false;
    this.winner = null;

    this.units = [];
    this.heroes = [];
    this.towers = [];
    this.towerMap = { blue: {}, red: {} };
    this.nexus = {};
    this.projectiles = [];
    this.effects = [];
    this.pending = [];

    this.feedList = [];
    this.feedVer = 0;
    this.centerMsg = null;

    this.kills = { blue: 0, red: 0 };
    this.firstBlood = false;

    this.waveT = CONFIG.FIRST_WAVE;

    this.buildStructures();
    this.buildHeroes(playerHeroKey);

    this.camera = { x: this.player.x, y: this.player.y, zoom: 0.85 };

    this.msg('右クリックで移動・敵を攻撃 / Q W E でスキル!', 4);
  }

  // ---- セットアップ ----
  buildStructures() {
    for (const team of ['blue', 'red']) {
      for (const lane of LANE_KEYS) {
        const towers = TOWER_FRACTIONS[team].map((f, i) => {
          const [x, y] = pointAtFraction(LANE_PATHS[lane], f);
          return new Tower(team, x, y, lane, i + 1); // tier1=外側
        });
        this.towerMap[team][lane] = towers;
        for (const t of towers) { this.towers.push(t); this.units.push(t); }
      }
      const [bx, by] = BASES[team];
      const n = new Nexus(team, bx, by);
      this.nexus[team] = n;
      this.units.push(n);
    }
  }

  buildHeroes(playerKey) {
    const names = shuffle(BOT_NAMES);
    let ni = 0;

    this.player = new Hero('blue', playerKey, { isBot: false, name: 'あなた', lane: 'mid' });
    this.heroes.push(this.player);

    // 味方ボット2体 (プレイヤーと違うヒーロー優先)
    const allyKeys = shuffle(HERO_KEYS.filter(k => k !== playerKey));
    while (allyKeys.length < 2) allyKeys.push(HERO_KEYS[randInt(0, HERO_KEYS.length - 1)]);
    ['top', 'bot'].forEach((lane, i) => {
      this.heroes.push(new Hero('blue', allyKeys[i], { isBot: true, name: names[ni++], lane }));
    });

    // 敵ボット3体
    const foeKeys = shuffle(HERO_KEYS);
    LANE_KEYS.forEach((lane, i) => {
      this.heroes.push(new Hero('red', foeKeys[i], { isBot: true, name: names[ni++], lane }));
    });

    for (const h of this.heroes) this.units.push(h);
  }

  // ---- メインループ ----
  update(dt) {
    if (this.over) return;
    this.time += dt;

    // 予約イベント
    this.pending = this.pending.filter(p => {
      p.t -= dt;
      if (p.t <= 0) { p.fn(); return false; }
      return true;
    });

    // ミニオンウェーブ
    this.waveT -= dt;
    if (this.waveT <= 0) {
      this.waveT = CONFIG.WAVE_INTERVAL;
      this.spawnWave();
    }

    this.updateInvuln();

    for (const u of this.units) {
      if (!u.dead || u.kind === 'hero') u.update(this, dt);
    }

    this.updateProjectiles(dt);
    this.softCollide();
    this.fountains(dt);

    for (const h of this.heroes) h.gold += CONFIG.PASSIVE_GOLD * dt;

    this.effects = this.effects.filter(e => (e.t = (e.t || 0) + dt) < e.ttl);

    const before = this.feedList.length;
    this.feedList = this.feedList.filter(f => (f.ttl -= dt) > 0);
    if (this.feedList.length !== before) this.feedVer++;

    if (this.centerMsg && (this.centerMsg.ttl -= dt) <= 0) this.centerMsg = null;

    this.units = this.units.filter(u => !(u.dead && u.kind === 'minion'));

    // カメラ追従
    const p = this.player;
    if (!p.dead) {
      this.camera.x = p.x;
      this.camera.y = p.y;
    }
  }

  addPending(t, fn) { this.pending.push({ t, fn }); }

  spawnWave() {
    for (const team of ['blue', 'red']) {
      for (const lane of LANE_KEYS) {
        for (let i = 0; i < 5; i++) {
          const type = i < 3 ? 'melee' : 'ranged';
          this.addPending(i * 0.45 + 0.01, () => {
            if (this.over) return;
            this.units.push(new Minion(team, lane, type, this));
          });
        }
      }
    }
  }

  // タワー/ネクサスの無敵状態更新
  updateInvuln() {
    for (const team of ['blue', 'red']) {
      let anyLaneOpen = false;
      for (const lane of LANE_KEYS) {
        const [t1, t2] = this.towerMap[team][lane];
        t2.invulnerable = !t1.dead;
        if (t1.dead && t2.dead) anyLaneOpen = true;
      }
      this.nexus[team].invulnerable = !anyLaneOpen;
    }
  }

  // ---- 弾 ----
  shootHoming(o) {
    this.projectiles.push({
      kind: 'homing', x: o.src.x, y: o.src.y,
      src: o.src, target: o.target, speed: o.speed, dmg: o.dmg,
      color: o.color || '#fff', size: o.size || 4, onHit: o.onHit || null,
    });
  }

  shootLine(o) {
    this.projectiles.push({
      kind: 'line', x: o.x, y: o.y, dx: o.dx, dy: o.dy,
      src: o.src, team: o.src.team, speed: o.speed, range: o.range,
      radius: o.radius, color: o.color || '#fff', pierce: !!o.pierce,
      traveled: 0, hitSet: new Set(), onHitUnit: o.onHitUnit,
    });
  }

  updateProjectiles(dt) {
    for (const p of this.projectiles) {
      if (p.done) continue;
      if (p.kind === 'homing') {
        const t = p.target;
        if (!t || t.dead) { p.done = true; continue; }
        const d = norm(t.x - p.x, t.y - p.y);
        const step = p.speed * dt;
        if (!d || d.len <= step + t.radius * 0.5) {
          p.done = true;
          const done = this.dealDamage(p.src, t, p.dmg);
          if (p.onHit) p.onHit(t, done);
        } else {
          p.x += d.x * step;
          p.y += d.y * step;
        }
      } else {
        // 直線スキルショット: ヒーローとミニオンにのみ当たる
        const step = p.speed * dt;
        p.x += p.dx * step;
        p.y += p.dy * step;
        p.traveled += step;
        if (p.traveled >= p.range) { p.done = true; continue; }
        const foe = enemyOf(p.team);
        for (const u of this.units) {
          if (u.team !== foe || u.dead) continue;
          if (u.kind !== 'hero' && u.kind !== 'minion') continue;
          if (p.hitSet.has(u)) continue;
          if (distXY(p.x, p.y, u.x, u.y) < p.radius + u.radius) {
            p.hitSet.add(u);
            p.onHitUnit(u);
            if (!p.pierce) { p.done = true; break; }
          }
        }
      }
    }
    this.projectiles = this.projectiles.filter(p => !p.done);
  }

  // ---- ダメージ処理 ----
  dealDamage(src, target, amount, opts = {}) {
    if (!target || target.dead || this.over) return 0;
    if (target.invulnerable) {
      if (src === this.player) this.floater(target.x, target.y - 30, '無敵', '#9e9e9e');
      return 0;
    }
    let dmg = amount;
    if (!opts.trueDmg) {
      const armor = Math.max(0, target.armor || 0);
      dmg = amount * 100 / (100 + armor);
    }
    if (target.shield > 0) {
      const absorbed = Math.min(target.shield, dmg);
      target.shield -= absorbed;
      dmg -= absorbed;
    }
    target.hp -= dmg;
    target.lastHurtT = this.time;
    if (target.kind === 'hero' && target.recallT != null) target.recallT = null; // リコール中断

    if (opts.slowT) {
      target.slowT = Math.max(target.slowT, opts.slowT);
      target.slowF = Math.min(target.slowF, opts.slowF);
    }
    if (opts.stunT) target.stunT = Math.max(target.stunT, opts.stunT);

    // タワーのヘイト: ヒーローがヒーローを殴ると近くの敵タワーが反応
    if (src && src.kind === 'hero' && target.kind === 'hero') {
      for (const t of this.towers) {
        if (t.team === target.team && !t.dead && distU(t, src) < t.range + t.radius) {
          t.target = src;
        }
      }
    }

    if (dmg > 0 && (src === this.player || target === this.player)) {
      this.floater(target.x + rand(-14, 14), target.y - target.radius - 14,
        String(Math.round(dmg)),
        src === this.player ? '#ffd54f' : '#ff6b6b');
    }

    if (target.hp <= 0) this.onDeath(target, src);
    return dmg;
  }

  aoeDamage(src, x, y, r, amount, opts = {}) {
    const foe = enemyOf(src.team);
    const targets = [];
    for (const u of this.units) {
      if (u.team !== foe || u.dead) continue;
      if (u.kind !== 'hero' && u.kind !== 'minion') continue;
      if (distXY(x, y, u.x, u.y) <= r + u.radius) targets.push(u);
    }
    for (const u of targets) this.dealDamage(src, u, amount, opts);
  }

  // ---- 死亡処理 ----
  onDeath(u, killer) {
    if (u.dead) return;
    u.hp = 0;
    const killerHero = killer && killer.kind === 'hero' ? killer : null;

    if (u.kind === 'minion') {
      u.dead = true;
      this.awardXpAround(u.x, u.y, u.team, u.xp);
      if (killerHero && killerHero.team !== u.team) {
        killerHero.gold += u.gold;
        killerHero.cs++;
        if (killerHero === this.player) {
          this.floater(u.x, u.y - 20, '+' + u.gold, '#ffd54f');
        }
      }
    } else if (u.kind === 'hero') {
      const gold = CONFIG.KILL_GOLD_BASE + CONFIG.KILL_GOLD_PER_LVL * u.level;
      this.addEffect({ kind: 'ring', x: u.x, y: u.y, r: 90, ttl: 0.6, color: TEAM_COLORS[u.team] });
      u.die(this);
      if (killer && killer.team) this.kills[killer.team]++;
      if (killerHero) {
        killerHero.kills++;
        killerHero.gold += gold;
        if (!this.firstBlood) {
          this.firstBlood = true;
          this.msg('ファーストブラッド!', 2.5);
        }
        this.feed(`${this.heroLabel(killerHero)} が ${this.heroLabel(u)} を倒した!`, TEAM_COLORS[killerHero.team]);
      } else {
        this.feed(`${this.heroLabel(u)} は倒れた…`, '#9e9e9e');
      }
      this.awardXpAround(u.x, u.y, u.team, 120 + 25 * u.level);
      if (u === this.player) { SFX.play('death'); }
      else if (killerHero === this.player) { SFX.play('kill'); this.msg('敵を倒した!', 1.5); }
    } else if (u.kind === 'tower') {
      u.dead = true;
      this.addEffect({ kind: 'ring', x: u.x, y: u.y, r: 160, ttl: 0.8, color: '#ffab40', fill: true });
      const winTeam = enemyOf(u.team);
      if (killerHero && killerHero.team === winTeam) killerHero.gold += TOWER_STATS.goldKiller;
      for (const h of this.heroes) if (h.team === winTeam) h.gold += TOWER_STATS.goldTeam;
      this.awardXpAround(u.x, u.y, u.team, TOWER_STATS.xp);
      this.feed(`${TEAM_NAMES[u.team]}チームのタワーが破壊された!`, TEAM_COLORS[winTeam]);
      this.msg(u.team === 'red' ? '敵のタワーを破壊した!' : '味方のタワーが破壊された…', 2.5);
      SFX.play('tower');
    } else if (u.kind === 'nexus') {
      u.dead = true;
      this.endGame(enemyOf(u.team));
    }
  }

  heroLabel(h) { return h === this.player ? 'あなた' : `${h.name}(${h.def.name})`; }

  awardXpAround(x, y, victimTeam, xp) {
    const foe = enemyOf(victimTeam);
    for (const h of this.heroes) {
      if (h.team !== foe || h.dead) continue;
      if (distXY(x, y, h.x, h.y) <= CONFIG.XP_RANGE) h.addXp(xp, this);
    }
  }

  // ---- スキル ----
  castAbility(hero, i, tx, ty) {
    if (this.over || hero.dead || hero.stunT > 0 || hero.dashState) return;
    const ab = hero.def.abilities[i];
    if (!ab || hero.cds[i] > 0) return;
    if (hero.mana < ab.mana) {
      if (hero === this.player) this.msg('マナが足りない!', 1);
      return;
    }
    hero.recallT = null;
    const ok = ab.cast(this, hero, tx, ty);
    if (ok !== false) {
      hero.cds[i] = ab.cd;
      hero.mana -= ab.mana;
      if (hero === this.player) SFX.play('cast');
    }
  }

  // ---- 泉 ----
  fountains(dt) {
    for (const team of ['blue', 'red']) {
      const n = this.nexus[team];
      for (const h of this.heroes) {
        if (h.dead) continue;
        const d = distU(h, n);
        if (d > CONFIG.FOUNTAIN_R) continue;
        if (h.team === team) {
          h.heal(h.maxHp * CONFIG.FOUNTAIN_HEAL * dt);
          h.mana = Math.min(h.maxMana, h.mana + h.maxMana * CONFIG.FOUNTAIN_HEAL * dt);
          if (h.isBot) {
            h.buyT -= dt;
            if (h.buyT <= 0) { h.buyT = 1; aiTryBuy(h); }
          }
        } else {
          // 敵の泉ダイブは即死級
          this.dealDamage(null, h, CONFIG.FOUNTAIN_DPS * dt, { trueDmg: true });
        }
      }
    }
  }

  // ---- 衝突(押し出し) ----
  softCollide() {
    const movers = [];
    for (const u of this.units) {
      if (u.dead) continue;
      if (u.kind === 'minion' || u.kind === 'hero') movers.push(u);
    }
    for (let i = 0; i < movers.length; i++) {
      const a = movers[i];
      for (let j = i + 1; j < movers.length; j++) {
        const b = movers[j];
        const minD = a.radius + b.radius;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= minD * minD || d2 < 0.01) continue;
        const d = Math.sqrt(d2);
        const push = (minD - d) / 2;
        const nx = dx / d, ny = dy / d;
        if (!(a.kind === 'hero' && a.dashState)) { a.x -= nx * push; a.y -= ny * push; }
        if (!(b.kind === 'hero' && b.dashState)) { b.x += nx * push; b.y += ny * push; }
      }
    }
  }

  // ---- ショップ ----
  canShop() {
    const p = this.player;
    return p.dead || distU(p, this.nexus.blue) <= CONFIG.SHOP_RANGE;
  }

  buyItem(itemId) {
    const it = itemById(itemId);
    const p = this.player;
    if (!it || this.over) return;
    if (!this.canShop()) { this.msg('ショップは自陣の泉でのみ使える (Bでリコール)', 2); return; }
    if (p.gold < it.cost) { this.msg('ゴールドが足りない!', 1.5); return; }
    p.gold -= it.cost;
    p.items.push(it.id);
    p.recompute();
    SFX.play('buy');
  }

  // ---- 表示系 ----
  addEffect(e) { this.effects.push(e); }

  floater(x, y, txt, color) {
    this.effects.push({ kind: 'text', x, y, txt, color, ttl: 0.9, t: 0 });
  }

  feed(txt, color) {
    this.feedList.push({ txt, color: color || '#e8f0e8', ttl: 7 });
    if (this.feedList.length > 6) this.feedList.shift();
    this.feedVer++;
  }

  msg(txt, ttl) {
    this.centerMsg = { txt, ttl: ttl || 2.5 };
  }

  endGame(winner) {
    if (this.over) return;
    this.over = true;
    this.winner = winner;
    SFX.play(winner === 'blue' ? 'win' : 'lose');
  }
}
