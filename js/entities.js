// ---- ユニット定義 ----
'use strict';

class Unit {
  constructor(team, x, y) {
    this.team = team;
    this.x = x; this.y = y;
    this.kind = 'unit';
    this.radius = 16;
    this.maxHp = 100; this.hp = 100;
    this.armor = 0; this.ad = 10;
    this.range = 50; this.atkCdBase = 1.2; this.atkTimer = 0;
    this.speed = 220;
    this.dead = false;
    this.invulnerable = false;
    this.shield = 0; this.shieldT = 0;
    this.slowT = 0; this.slowF = 1;
    this.stunT = 0;
    this.stealth = false; this.stealthT = 0;
    this.lifesteal = 0;
    this.target = null;
    this.lastHurtT = -99;
  }

  get atkCd() { return this.atkCdBase; }
  get moveSpeed() { return this.speed * (this.slowT > 0 ? this.slowF : 1); }

  tickTimers(dt) {
    this.atkTimer -= dt;
    if (this.slowT > 0) { this.slowT -= dt; if (this.slowT <= 0) this.slowF = 1; }
    if (this.stunT > 0) this.stunT -= dt;
    if (this.shieldT > 0) {
      this.shieldT -= dt;
      if (this.shieldT <= 0) this.shield = 0;
    }
    if (this.stealthT > 0) {
      this.stealthT -= dt;
      if (this.stealthT <= 0) this.stealth = false;
    }
  }

  moveToward(tx, ty, dt, sp) {
    const dx = tx - this.x, dy = ty - this.y;
    const d = Math.hypot(dx, dy);
    if (d < 2) return true;
    const s = (sp || this.moveSpeed) * dt;
    if (s >= d) { this.x = tx; this.y = ty; return true; }
    this.x += dx / d * s;
    this.y += dy / d * s;
    return false;
  }

  inRangeOf(u) {
    return distU(this, u) <= this.range + this.radius + u.radius;
  }

  engage(g, dt, t) {
    if (this.inRangeOf(t)) {
      if (this.atkTimer <= 0) {
        this.performAttack(g, t);
        this.atkTimer = this.atkCd;
      }
    } else {
      this.moveToward(t.x, t.y, dt);
    }
  }

  performAttack(g, t) {
    if (this.range > 140) {
      g.shootHoming({
        src: this, target: t, speed: 1100, dmg: this.ad,
        color: TEAM_COLORS[this.team], size: this.kind === 'tower' ? 8 : 4,
      });
    } else {
      const done = g.dealDamage(this, t, this.ad);
      if (this.lifesteal > 0) this.heal(done * this.lifesteal);
    }
  }

  heal(a) {
    if (this.dead || a <= 0) return;
    this.hp = Math.min(this.maxHp, this.hp + a);
  }
}

// ---- ミニオン ----
class Minion extends Unit {
  constructor(team, lane, mtype, g) {
    const base = BASES[team];
    super(team, base[0] + rand(-40, 40), base[1] + rand(-40, 40));
    this.kind = 'minion';
    this.mtype = mtype;
    this.lane = lane;
    const def = MINION_TYPES[mtype];
    const scale = 1 + 0.035 * (g.time / 60); // 時間経過で強化
    this.maxHp = this.hp = def.hp * scale;
    this.ad = def.ad * scale;
    this.range = def.range;
    this.atkCdBase = def.atkCd;
    this.speed = def.speed;
    this.radius = def.radius;
    this.gold = Math.round(def.gold * (1 + 0.01 * (g.time / 60)));
    this.xp = def.xp;
    this.aggroRange = def.aggro;
    const path = LANE_PATHS[lane];
    this.path = team === 'blue' ? path : path.slice().reverse();
    this.wp = 1;
    this.aggroT = rand(0, 0.3);
  }

  update(g, dt) {
    this.tickTimers(dt);
    if (this.stunT > 0) return;
    this.aggroT -= dt;

    // 現在のターゲットの有効性チェック
    if (this.target && (this.target.dead || this.target.invulnerable ||
        distU(this, this.target) > this.aggroRange + 260 ||
        (this.target.kind === 'hero' && this.target.stealth && !isRevealed(g, this.target)))) {
      this.target = null;
    }
    if (!this.target && this.aggroT <= 0) {
      this.aggroT = 0.35;
      this.target = this.findTarget(g);
    }
    if (this.target) {
      this.engage(g, dt, this.target);
    } else {
      this.followPath(dt);
    }
  }

  findTarget(g) {
    const foe = enemyOf(this.team);
    let best = null, bestKey = Infinity;
    for (const u of g.units) {
      if (u.team !== foe || u.dead || u.invulnerable) continue;
      if (u.kind === 'hero' && u.stealth && !isRevealed(g, u)) continue;
      const d = distU(this, u);
      if (d > this.aggroRange) continue;
      // 優先度: ミニオン < タワー/ネクサス < ヒーロー
      const prio = u.kind === 'minion' ? 0 : (u.kind === 'hero' ? 2 : 1);
      const key = prio * 10000 + d;
      if (key < bestKey) { bestKey = key; best = u; }
    }
    return best;
  }

  followPath(dt) {
    if (this.wp >= this.path.length) return;
    const [tx, ty] = this.path[this.wp];
    if (distXY(this.x, this.y, tx, ty) < 55) {
      this.wp++;
      return;
    }
    this.moveToward(tx, ty, dt);
  }
}

// ---- タワー ----
class Tower extends Unit {
  constructor(team, x, y, lane, tier) {
    super(team, x, y);
    this.kind = 'tower';
    this.lane = lane;
    this.tier = tier;
    this.maxHp = this.hp = TOWER_STATS.hp;
    this.ad = TOWER_STATS.ad;
    this.range = TOWER_STATS.range;
    this.atkCdBase = TOWER_STATS.atkCd;
    this.radius = TOWER_STATS.radius;
    this.speed = 0;
    this.armor = 30;
  }

  update(g, dt) {
    if (this.dead) return;
    this.tickTimers(dt);
    if (this.target && (this.target.dead || distU(this, this.target) > this.range + this.radius + 40 ||
        (this.target.kind === 'hero' && this.target.stealth && !isRevealed(g, this.target)))) {
      this.target = null;
    }
    if (!this.target) {
      this.target = this.findTarget(g);
    }
    if (this.target && this.atkTimer <= 0) {
      this.performAttack(g, this.target);
      this.atkTimer = this.atkCd;
    }
  }

  findTarget(g) {
    const foe = enemyOf(this.team);
    let bestMinion = null, dm = Infinity;
    let bestHero = null, dh = Infinity;
    for (const u of g.units) {
      if (u.team !== foe || u.dead) continue;
      if (u.kind === 'hero' && u.stealth && !isRevealed(g, u)) continue;
      const d = distU(this, u);
      if (d > this.range + this.radius) continue;
      if (u.kind === 'minion' && d < dm) { dm = d; bestMinion = u; }
      else if (u.kind === 'hero' && d < dh) { dh = d; bestHero = u; }
    }
    return bestMinion || bestHero;
  }
}

// ---- ネクサス ----
class Nexus extends Unit {
  constructor(team, x, y) {
    super(team, x, y);
    this.kind = 'nexus';
    this.maxHp = this.hp = NEXUS_STATS.hp;
    this.radius = NEXUS_STATS.radius;
    this.speed = 0;
    this.armor = 20;
  }
  update() { /* 何もしない */ }
}

// ---- ヒーロー ----
class Hero extends Unit {
  constructor(team, defKey, opts = {}) {
    const base = BASES[team];
    super(team, base[0] + rand(-70, 70), base[1] + rand(-70, 70));
    this.kind = 'hero';
    this.def = HEROES[defKey];
    this.name = opts.name || this.def.name;
    this.isBot = !!opts.isBot;
    this.lane = opts.lane || 'mid';
    this.radius = this.def.radius || 22;

    this.level = 1;
    this.xp = 0;
    this.gold = CONFIG.START_GOLD;
    this.kills = 0; this.deaths = 0; this.cs = 0;
    this.items = [];
    this.buildIdx = 0;

    this.cds = new Array(this.def.abilities.length).fill(0);
    this.buffs = [];
    this.order = null;
    this.dashState = null;
    this.recallT = null;
    this.respawnT = 0;
    this.atkSpeedMult = 1;
    this.power = 0;

    // AI用
    const path = LANE_PATHS[this.lane];
    this.lanePath = team === 'blue' ? path : path.slice().reverse();
    this.laneWp = 1;
    this.aiState = 'push';
    this.thinkT = rand(0, 0.3);
    this.buyT = 0;

    this.recompute(true);
    this.hp = this.maxHp;
    this.mana = this.maxMana;
  }

  itemStats() {
    const s = { ad: 0, power: 0, hp: 0, armor: 0, speed: 0, atkSpeed: 0, lifesteal: 0 };
    for (const id of this.items) {
      const it = itemById(id);
      for (const k in it.stats) s[k] += it.stats[k];
    }
    return s;
  }

  buffStats() {
    const s = { ad: 0, power: 0, armor: 0, speed: 0, atkSpeed: 0 };
    for (const b of this.buffs) {
      for (const k in b.stats) s[k] = (s[k] || 0) + b.stats[k];
    }
    return s;
  }

  recompute(init) {
    const d = this.def, L = this.level;
    const it = this.itemStats(), bf = this.buffStats();

    const newMaxHp = d.hp + d.hpGrow * (L - 1) + it.hp;
    if (!init && newMaxHp > this.maxHp) this.hp += newMaxHp - this.maxHp;
    this.maxHp = newMaxHp;

    const newMaxMana = d.mana + d.manaGrow * (L - 1);
    if (!init && newMaxMana > (this.maxMana || 0)) this.mana += newMaxMana - this.maxMana;
    this.maxMana = newMaxMana;

    this.ad = d.ad + d.adGrow * (L - 1) + it.ad + bf.ad;
    this.power = (d.power || 0) + (d.powerGrow || 0) * (L - 1) + it.power + (bf.power || 0);
    this.armor = d.armor + d.armorGrow * (L - 1) + it.armor + bf.armor;
    this.speed = d.speed + it.speed + bf.speed;
    this.atkSpeedMult = 1 + it.atkSpeed + bf.atkSpeed;
    this.lifesteal = it.lifesteal + (bf.lifesteal || 0);
    this.range = d.range;
    this.atkCdBase = d.atkCd;
    this.hpRegen = 1.5 + 0.4 * L;
    this.manaRegen = 1.8 + 0.35 * L;
  }

  get atkCd() { return this.atkCdBase / this.atkSpeedMult; }

  xpNeed() { return 150 + 90 * (this.level - 1); }

  addXp(a, g) {
    if (this.level >= CONFIG.MAX_LEVEL) return;
    this.xp += a;
    while (this.level < CONFIG.MAX_LEVEL && this.xp >= this.xpNeed()) {
      this.xp -= this.xpNeed();
      this.level++;
      this.recompute();
      this.heal(70);
      g.addEffect({ kind: 'ring', x: this.x, y: this.y, r: 80, ttl: 0.6, color: '#ffd54f' });
      if (this === g.player) SFX.play('level');
    }
  }

  update(g, dt) {
    for (let i = 0; i < this.cds.length; i++) if (this.cds[i] > 0) this.cds[i] -= dt;
    this.buffs = this.buffs.filter(b => (b.t -= dt) > 0);
    this.recompute();
    this.tickTimers(dt);

    if (this.dead) {
      this.respawnT -= dt;
      if (this.isBot) aiTryBuy(this);
      if (this.respawnT <= 0) this.respawn(g);
      return;
    }

    // 自然回復
    this.heal(this.hpRegen * dt);
    this.mana = Math.min(this.maxMana, this.mana + this.manaRegen * dt);

    if (this.stunT > 0) return;

    // リコール詠唱中
    if (this.recallT != null) {
      this.recallT -= dt;
      if (this.recallT <= 0) {
        this.recallT = null;
        const base = BASES[this.team];
        g.addEffect({ kind: 'ring', x: this.x, y: this.y, r: 60, ttl: 0.4, color: '#8ec8ff' });
        this.x = base[0] + rand(-50, 50);
        this.y = base[1] + rand(-50, 50);
        g.addEffect({ kind: 'ring', x: this.x, y: this.y, r: 60, ttl: 0.4, color: '#8ec8ff' });
      }
      return;
    }

    if (this.isBot) {
      this.thinkT -= dt;
      if (this.thinkT <= 0) {
        this.thinkT = 0.25;
        aiThink(this, g);
      }
    }

    // ダッシュ中は他の行動不可
    if (this.dashState) {
      const ds = this.dashState;
      if (this.moveToward(ds.tx, ds.ty, dt, ds.speed)) {
        this.dashState = null;
        if (ds.onArrive) ds.onArrive();
      }
      return;
    }

    this.executeOrder(g, dt);
  }

  executeOrder(g, dt) {
    const o = this.order;
    if (!o) return;
    if (o.type === 'move') {
      if (this.moveToward(o.x, o.y, dt)) this.order = null;
    } else if (o.type === 'attack') {
      const t = o.target;
      if (!t || t.dead || (t.kind === 'hero' && t.stealth && !isRevealed(g, t))) { this.order = null; return; }
      this.engage(g, dt, t);
    } else if (o.type === 'amove') {
      const t = this.acquire(g, Math.max(this.range + 60, 420));
      if (t) {
        this.engage(g, dt, t);
      } else if (this.moveToward(o.x, o.y, dt)) {
        this.order = null;
      }
    }
  }

  // アタックムーブ用: 近くの敵を取得 (ヒーロー優先)
  acquire(g, r) {
    const foe = enemyOf(this.team);
    let best = null, bestKey = Infinity;
    for (const u of g.units) {
      if (u.team !== foe || u.dead || u.invulnerable) continue;
      if (u.kind === 'hero' && u.stealth && !isRevealed(g, u)) continue;
      const d = distU(this, u);
      if (d > r) continue;
      const prio = u.kind === 'hero' ? 0 : 1;
      const key = prio * 10000 + d;
      if (key < bestKey) { bestKey = key; best = u; }
    }
    return best;
  }

  performAttack(g, t) {
    if (this.range > 140) {
      const self = this;
      g.shootHoming({
        src: this, target: t, speed: 1150, dmg: this.ad,
        color: this.def.color, size: 5,
        onHit(u, done) {
          if (self.lifesteal > 0) self.heal(done * self.lifesteal);
        },
      });
    } else {
      const done = g.dealDamage(this, t, this.ad);
      if (this.lifesteal > 0) this.heal(done * this.lifesteal);
    }
  }

  die(g) {
    this.dead = true;
    this.hp = 0;
    this.deaths++;
    this.respawnT = CONFIG.RESPAWN_BASE + CONFIG.RESPAWN_PER_LVL * this.level;
    this.order = null;
    this.dashState = null;
    this.recallT = null;
    this.buffs = [];
    this.shield = 0; this.shieldT = 0;
    this.slowT = 0; this.stunT = 0;
    this.target = null;
  }

  respawn(g) {
    this.dead = false;
    const base = BASES[this.team];
    this.x = base[0] + rand(-70, 70);
    this.y = base[1] + rand(-70, 70);
    this.recompute();
    this.hp = this.maxHp;
    this.mana = this.maxMana;
    this.order = null;
    this.aiState = 'push';
    g.addEffect({ kind: 'ring', x: this.x, y: this.y, r: 70, ttl: 0.5, color: TEAM_COLORS[this.team] });
  }
}
