// ---- ゲームデータ定義 ----
'use strict';

const CONFIG = {
  WORLD: 3000,
  WAVE_INTERVAL: 25,
  FIRST_WAVE: 8,
  PASSIVE_GOLD: 1.7,
  START_GOLD: 500,
  FOUNTAIN_R: 380,
  FOUNTAIN_HEAL: 0.14,   // 最大値の割合/秒
  FOUNTAIN_DPS: 320,     // 敵が泉に入った時のダメージ/秒
  RECALL_TIME: 4.5,
  SHOP_RANGE: 650,
  XP_RANGE: 700,
  KILL_GOLD_BASE: 200,
  KILL_GOLD_PER_LVL: 25,
  RESPAWN_BASE: 6,
  RESPAWN_PER_LVL: 2,
  MAX_LEVEL: 18,
};

const TEAM_COLORS = { blue: '#5db1ff', red: '#ff6b6b' };
const TEAM_NAMES = { blue: '青', red: '赤' };
function enemyOf(team) { return team === 'blue' ? 'red' : 'blue'; }

const BASES = { blue: [270, 2730], red: [2730, 270] };

// レーンのパス (青拠点 → 赤拠点)
const LANE_PATHS = {
  top: [[270, 2730], [230, 2450], [230, 560], [300, 330], [560, 230], [2450, 230], [2730, 270]],
  mid: [[270, 2730], [700, 2300], [1500, 1500], [2300, 700], [2730, 270]],
  bot: [[270, 2730], [550, 2770], [2440, 2770], [2670, 2700], [2770, 2440], [2770, 550], [2730, 270]],
};
const LANE_KEYS = ['top', 'mid', 'bot'];

// タワー位置 (自陣拠点からのパス割合) tier1=外側(先に狙われる), tier2=内側
const TOWER_FRACTIONS = {
  blue: [0.42, 0.24],
  red: [0.58, 0.76],
};

const MINION_TYPES = {
  melee: { hp: 500, ad: 15, range: 55, atkCd: 1.2, speed: 235, radius: 14, gold: 22, xp: 58, aggro: 360 },
  ranged: { hp: 330, ad: 27, range: 300, atkCd: 1.5, speed: 235, radius: 12, gold: 28, xp: 64, aggro: 420 },
};

const TOWER_STATS = { hp: 3300, ad: 190, range: 400, atkCd: 1.5, radius: 34, goldKiller: 150, goldTeam: 120, xp: 200 };
const NEXUS_STATS = { hp: 4500, radius: 55 };

const BOT_NAMES = ['ユキ', 'レン', 'ソラ', 'カイ', 'ミコ', 'ハル', 'リン', 'アオイ', 'ツバサ', 'ノゾミ', 'アキラ', 'メイ'];

// 5v5でのレーン配分 (プレイヤーはmid固定、残り4枠に味方ボット、5枠全てに敵ボット)
const LANE_ASSIGN_5 = ['top', 'top', 'mid', 'bot', 'bot'];

// ---- アイテム ----
const ITEMS = [
  { id: 'sword', icon: '⚔', name: 'ロングソード', cost: 350, stats: { ad: 12 }, desc: '攻撃力 +12' },
  { id: 'staff', icon: '✦', name: '魔導の書', cost: 400, stats: { power: 24 }, desc: '魔力 +24' },
  { id: 'hp', icon: '♥', name: 'ルビー水晶', cost: 400, stats: { hp: 200 }, desc: '最大HP +200' },
  { id: 'armor', icon: '◆', name: '鎖かたびら', cost: 400, stats: { armor: 22 }, desc: '防御 +22' },
  { id: 'boots', icon: '➤', name: '俊足のブーツ', cost: 300, stats: { speed: 22 }, desc: '移動速度 +22' },
  { id: 'dagger', icon: '≫', name: '短剣', cost: 350, stats: { atkSpeed: 0.18 }, desc: '攻撃速度 +18%' },
  { id: 'vamp', icon: '✚', name: '吸血の鎌', cost: 500, stats: { ad: 8, lifesteal: 0.08 }, desc: '攻撃力+8 / 吸血8%' },
];
function itemById(id) { return ITEMS.find(it => it.id === id); }

// ---- アビリティ組み立てファクトリ ----
// 各ヒーローの kit は下記の共通パターンを組み合わせて定義する。
// ability: { key, name, desc, cd, mana, ai:{mode,range}, cast(g,h,tx,ty)→false=不発 }

// 突進して着地点周囲にダメージ (+スタン/スロー等)
function mkDash({ key, name, desc, cd, mana, range, speed = 1150, radius, color, dmg, opts = {} }) {
  return {
    key, name, desc, cd, mana,
    ai: { mode: 'gap', range },
    cast(g, h, tx, ty) {
      const d = norm(tx - h.x, ty - h.y);
      if (!d) return false;
      const dist = Math.min(range, d.len);
      const ex = clamp(h.x + d.x * dist, 30, CONFIG.WORLD - 30);
      const ey = clamp(h.y + d.y * dist, 30, CONFIG.WORLD - 30);
      h.dashState = {
        tx: ex, ty: ey, speed,
        onArrive() {
          g.aoeDamage(h, h.x, h.y, radius, dmg(h), opts);
          g.addEffect({ kind: 'ring', x: h.x, y: h.y, r: radius, ttl: 0.32, color, fill: true });
        },
      };
      if (h === g.player) SFX.play('dash');
      return true;
    },
  };
}

// マウス方向へ瞬間移動 (任意で自己バフ付与)
function mkBlink({ key, name, desc, cd, mana, range, color, buff }) {
  return {
    key, name, desc, cd, mana,
    ai: { mode: 'mobility', range },
    cast(g, h, tx, ty) {
      const d = norm(tx - h.x, ty - h.y);
      if (!d) return false;
      const dist = Math.min(range, d.len);
      g.addEffect({ kind: 'ring', x: h.x, y: h.y, r: 45, ttl: 0.3, color });
      h.x = clamp(h.x + d.x * dist, 30, CONFIG.WORLD - 30);
      h.y = clamp(h.y + d.y * dist, 30, CONFIG.WORLD - 30);
      g.addEffect({ kind: 'ring', x: h.x, y: h.y, r: 45, ttl: 0.3, color });
      if (buff) h.buffs.push(buff(h));
      if (h === g.player) SFX.play('dash');
      return true;
    },
  };
}

// 自分中心の範囲ダメージ (+スタン/スロー等)
function mkSelfNova({ key, name, desc, cd, mana, radius, color, dmg, opts = {} }) {
  return {
    key, name, desc, cd, mana,
    ai: { mode: 'damage', range: radius },
    cast(g, h) {
      g.aoeDamage(h, h.x, h.y, radius, dmg(h), opts);
      g.addEffect({ kind: 'ring', x: h.x, y: h.y, r: radius, ttl: 0.35, color, fill: true });
      return true;
    },
  };
}

// マウス方向の指定地点(射程内)に範囲ダメージ
function mkGroundNova({ key, name, desc, cd, mana, range, radius, color, dmg, opts = {} }) {
  return {
    key, name, desc, cd, mana,
    ai: { mode: 'damage', range },
    cast(g, h, tx, ty) {
      const d = norm(tx - h.x, ty - h.y);
      const dist = d ? Math.min(range, d.len) : 0;
      const ex = d ? clamp(h.x + d.x * dist, 30, CONFIG.WORLD - 30) : h.x;
      const ey = d ? clamp(h.y + d.y * dist, 30, CONFIG.WORLD - 30) : h.y;
      g.aoeDamage(h, ex, ey, radius, dmg(h), opts);
      g.addEffect({ kind: 'ring', x: ex, y: ey, r: radius, ttl: 0.4, color, fill: true });
      return true;
    },
  };
}

// 直線スキルショット (貫通可・任意でスロー/スタン付与)
function mkLine({ key, name, desc, cd, mana, range, speed = 1000, radius, color, pierce = false, dmg, opts = {} }) {
  return {
    key, name, desc, cd, mana,
    ai: { mode: 'damage', range },
    cast(g, h, tx, ty) {
      const d = norm(tx - h.x, ty - h.y);
      if (!d) return false;
      const amount = dmg(h);
      g.shootLine({
        src: h, x: h.x, y: h.y, dx: d.x, dy: d.y,
        speed, range, radius, color, pierce,
        onHitUnit(u) {
          g.dealDamage(h, u, amount, opts);
          g.addEffect({ kind: 'ring', x: u.x, y: u.y, r: 55, ttl: 0.25, color });
        },
      });
      return true;
    },
  };
}

// 自己バフ (+任意で自己回復)
function mkSelfBuff({ key, name, desc, cd, mana, t, stats, color, heal }) {
  return {
    key, name, desc, cd, mana,
    ai: { mode: 'buff', range: 0 },
    cast(g, h) {
      h.buffs.push({ t, stats });
      if (heal) h.heal(heal(h));
      g.addEffect({ kind: 'ring', x: h.x, y: h.y, r: 55, ttl: 0.4, color });
      return true;
    },
  };
}

// 自己シールド (+任意で追加バフ)
function mkSelfShield({ key, name, desc, cd, mana, amount, t, color, extraStats }) {
  return {
    key, name, desc, cd, mana,
    ai: { mode: 'defense', range: 0 },
    cast(g, h) {
      const amt = amount(h);
      h.shield = Math.max(h.shield, amt);
      h.shieldT = t;
      if (extraStats) h.buffs.push({ t, stats: extraStats });
      g.addEffect({ kind: 'ring', x: h.x, y: h.y, r: 65, ttl: 0.4, color });
      return true;
    },
  };
}

// 周囲の味方(自分含む)にシールド
function mkTeamShield({ key, name, desc, cd, mana, amount, t, radius, color }) {
  return {
    key, name, desc, cd, mana,
    ai: { mode: 'defense', range: 0 },
    cast(g, h) {
      const amt = amount(h);
      for (const ally of g.heroes) {
        if (ally.team !== h.team || ally.dead) continue;
        if (distU(ally, h) > radius) continue;
        ally.shield = Math.max(ally.shield, amt);
        ally.shieldT = t;
      }
      g.addEffect({ kind: 'ring', x: h.x, y: h.y, r: radius, ttl: 0.45, color });
      return true;
    },
  };
}

// 周囲の味方(自分含む)にバフ
function mkTeamBuff({ key, name, desc, cd, mana, t, stats, radius, color }) {
  return {
    key, name, desc, cd, mana,
    ai: { mode: 'buff', range: 0 },
    cast(g, h) {
      for (const ally of g.heroes) {
        if (ally.team !== h.team || ally.dead) continue;
        if (distU(ally, h) > radius) continue;
        ally.buffs.push({ t, stats });
      }
      g.addEffect({ kind: 'ring', x: h.x, y: h.y, r: radius, ttl: 0.4, color });
      return true;
    },
  };
}

// 周囲の味方(自分含む)を回復
function mkHeal({ key, name, desc, cd, mana, radius, color, heal }) {
  return {
    key, name, desc, cd, mana,
    ai: { mode: 'heal', range: radius },
    cast(g, h) {
      g.aoeHeal(h, h.x, h.y, radius, heal(h));
      g.addEffect({ kind: 'ring', x: h.x, y: h.y, r: radius, ttl: 0.4, color, fill: true });
      return true;
    },
  };
}

// チーム全体(距離無制限)を回復 — サポート系アルティメット向け
function mkGlobalTeamHeal({ key, name, desc, cd, mana, color, heal }) {
  return {
    key, name, desc, cd, mana,
    ai: { mode: 'heal', range: 99999 },
    cast(g, h) {
      const amt = heal(h);
      for (const ally of g.heroes) {
        if (ally.team !== h.team || ally.dead) continue;
        ally.heal(amt);
        if (h === g.player || ally === g.player) {
          g.floater(ally.x, ally.y - ally.radius - 14, '+' + Math.round(amt), '#8bffb0');
        }
      }
      g.addEffect({ kind: 'ring', x: h.x, y: h.y, r: 90, ttl: 0.5, color });
      return true;
    },
  };
}

// チーム全体(距離無制限)にシールド — アルティメット向け
function mkGlobalTeamShield({ key, name, desc, cd, mana, color, amount, t }) {
  return {
    key, name, desc, cd, mana,
    ai: { mode: 'defense', range: 0 },
    cast(g, h) {
      const amt = amount(h);
      for (const ally of g.heroes) {
        if (ally.team !== h.team || ally.dead) continue;
        ally.shield = Math.max(ally.shield, amt);
        ally.shieldT = t;
      }
      g.addEffect({ kind: 'ring', x: h.x, y: h.y, r: 90, ttl: 0.5, color });
      return true;
    },
  };
}

// ステルス化+移動速度上昇 (攻撃/被弾で解除)
function mkStealth({ key, name, desc, cd, mana, t, speed, color }) {
  return {
    key, name, desc, cd, mana,
    ai: { mode: 'buff', range: 0 },
    cast(g, h) {
      h.stealth = true;
      h.stealthT = t;
      h.buffs.push({ t, stats: { speed } });
      g.addEffect({ kind: 'ring', x: h.x, y: h.y, r: 50, ttl: 0.4, color });
      return true;
    },
  };
}

// 敵ステルスを一定時間看破する(自チームの視界を得る)
function mkReveal({ key, name, desc, cd, mana, t, color }) {
  return {
    key, name, desc, cd, mana,
    ai: { mode: 'buff', range: 0 },
    cast(g, h) {
      g.detectVision[h.team] = Math.max(g.detectVision[h.team], t);
      g.addEffect({ kind: 'ring', x: h.x, y: h.y, r: 300, ttl: 0.6, color });
      if (h === g.player) g.msg('索敵: ステルスを見破った!', 1.5);
      return true;
    },
  };
}

// 突進+処刑(残りHP割合に応じた追加ダメージ)
function mkExecuteDash({ key, name, desc, cd, mana, range, speed = 1250, radius, color, baseDmg, missingMult }) {
  return {
    key, name, desc, cd, mana,
    ai: { mode: 'gap', range },
    cast(g, h, tx, ty) {
      const d = norm(tx - h.x, ty - h.y);
      if (!d) return false;
      const dist = Math.min(range, d.len);
      const ex = clamp(h.x + d.x * dist, 30, CONFIG.WORLD - 30);
      const ey = clamp(h.y + d.y * dist, 30, CONFIG.WORLD - 30);
      h.dashState = {
        tx: ex, ty: ey, speed,
        onArrive() {
          const foe = enemyOf(h.team);
          for (const u of g.units) {
            if (u.team !== foe || u.dead) continue;
            if (u.kind !== 'hero' && u.kind !== 'minion') continue;
            if (distXY(h.x, h.y, u.x, u.y) > radius + u.radius) continue;
            const missing = 1 - u.hp / u.maxHp;
            const dmg = baseDmg(h) + missing * missingMult(h);
            g.dealDamage(h, u, dmg);
          }
          g.addEffect({ kind: 'ring', x: h.x, y: h.y, r: radius, ttl: 0.3, color });
        },
      };
      if (h === g.player) SFX.play('dash');
      return true;
    },
  };
}

// 連鎖ダメージ: クリック地点付近の敵から近くの敵へ跳ね回る
function mkChain({ key, name, desc, cd, mana, range, jumps, jumpRadius, color, dmg }) {
  return {
    key, name, desc, cd, mana,
    ai: { mode: 'damage', range },
    cast(g, h, tx, ty) {
      const foe = enemyOf(h.team);
      let cur = null, bd = Infinity;
      for (const u of g.units) {
        if (u.team !== foe || u.dead) continue;
        if (u.kind !== 'hero' && u.kind !== 'minion') continue;
        const d = distXY(tx, ty, u.x, u.y);
        if (d < 90 && d < bd) { bd = d; cur = u; }
      }
      if (!cur) {
        let bd2 = Infinity;
        for (const u of g.units) {
          if (u.team !== foe || u.dead) continue;
          if (u.kind !== 'hero' && u.kind !== 'minion') continue;
          const d = distU(h, u);
          if (d < range && d < bd2) { bd2 = d; cur = u; }
        }
      }
      if (!cur) return false;
      const hit = new Set();
      let amount = dmg(h);
      for (let i = 0; i < jumps && cur; i++) {
        g.dealDamage(h, cur, amount);
        g.addEffect({ kind: 'ring', x: cur.x, y: cur.y, r: 40, ttl: 0.25, color });
        hit.add(cur);
        amount *= 0.75;
        let next = null, nd = Infinity;
        for (const u of g.units) {
          if (u.team !== foe || u.dead || hit.has(u)) continue;
          if (u.kind !== 'hero' && u.kind !== 'minion') continue;
          const d = distU(cur, u);
          if (d < jumpRadius && d < nd) { nd = d; next = u; }
        }
        cur = next;
      }
      return true;
    },
  };
}

// ---- ヒーロー ----
// ability: { key, name, desc, cd, mana, ai:{mode,range}, cast(g,h,tx,ty)→false=不発 }
const HEROES = {
  blaze: {
    key: 'blaze', name: 'ブレイズ', title: '劫火の魔導士', color: '#ff8a50', letter: 'B',
    desc: '遠距離から火力を叩き込むメイジ。スキルコンボで敵を一気に焼き払う。打たれ弱いので立ち回りが重要。',
    hp: 540, hpGrow: 82, mana: 420, manaGrow: 48,
    ad: 52, adGrow: 3.0, power: 15, powerGrow: 9,
    armor: 16, armorGrow: 3.0, range: 430, atkCd: 1.15, speed: 280, radius: 22,
    aiBuild: ['staff', 'hp', 'staff', 'boots', 'staff', 'armor', 'staff'],
    abilities: [
      {
        key: 'Q', name: 'ファイアボール', cd: 4.5, mana: 40,
        desc: '直線に火球を放ち、最初に当たった敵にダメージ',
        ai: { mode: 'damage', range: 780 },
        cast(g, h, tx, ty) {
          const d = norm(tx - h.x, ty - h.y);
          if (!d) return false;
          const dmg = 80 + 18 * h.level + 0.75 * h.power;
          g.shootLine({
            src: h, x: h.x, y: h.y, dx: d.x, dy: d.y,
            speed: 950, range: 850, radius: 26, color: '#ff8a50', pierce: false,
            onHitUnit(u) {
              g.dealDamage(h, u, dmg);
              g.addEffect({ kind: 'ring', x: u.x, y: u.y, r: 65, ttl: 0.3, color: '#ff8a50' });
            },
          });
          return true;
        },
      },
      {
        key: 'W', name: 'フレイムノヴァ', cd: 9, mana: 60,
        desc: '周囲の敵にダメージ+スロー(40%/1.5秒)',
        ai: { mode: 'damage', range: 250 },
        cast(g, h) {
          const dmg = 70 + 14 * h.level + 0.6 * h.power;
          g.aoeDamage(h, h.x, h.y, 260, dmg, { slowF: 0.6, slowT: 1.5 });
          g.addEffect({ kind: 'ring', x: h.x, y: h.y, r: 260, ttl: 0.4, color: '#ffb74d', fill: true });
          return true;
        },
      },
      {
        key: 'E', name: 'ブリンク', cd: 14, mana: 50,
        desc: 'マウス方向に瞬間移動 (最大350)',
        ai: { mode: 'mobility', range: 350 },
        cast(g, h, tx, ty) {
          const d = norm(tx - h.x, ty - h.y);
          if (!d) return false;
          const dist = Math.min(350, d.len);
          g.addEffect({ kind: 'ring', x: h.x, y: h.y, r: 45, ttl: 0.35, color: '#b48ee0' });
          h.x = clamp(h.x + d.x * dist, 30, CONFIG.WORLD - 30);
          h.y = clamp(h.y + d.y * dist, 30, CONFIG.WORLD - 30);
          g.addEffect({ kind: 'ring', x: h.x, y: h.y, r: 45, ttl: 0.35, color: '#b48ee0' });
          if (h === g.player) SFX.play('dash');
          return true;
        },
      },
      mkGroundNova({
        key: 'R', name: 'インフェルノ', cd: 70, mana: 100, range: 750, radius: 230,
        color: '#ff5722', desc: '指定地点に大爆発を起こし、範囲内の敵に大ダメージ+スロー',
        dmg: h => 140 + 30 * h.level + 1.1 * h.power, opts: { slowF: 0.55, slowT: 1.2 },
      }),
    ],
  },

  thorn: {
    key: 'thorn', name: 'ソーン', title: '鉄壁の剣闘士', color: '#8bc34a', letter: 'T',
    desc: '接近戦で暴れる重戦士。シールドと突進で先陣を切り、タフさで敵陣を割る。初心者におすすめ。',
    hp: 680, hpGrow: 102, mana: 280, manaGrow: 32,
    ad: 62, adGrow: 3.6, power: 0, powerGrow: 0,
    armor: 28, armorGrow: 3.8, range: 105, atkCd: 1.0, speed: 295, radius: 24,
    aiBuild: ['sword', 'hp', 'armor', 'sword', 'hp', 'vamp', 'sword'],
    abilities: [
      {
        key: 'Q', name: '剛剣旋斬', cd: 5, mana: 30,
        desc: '周囲の敵を薙ぎ払いダメージ',
        ai: { mode: 'damage', range: 180 },
        cast(g, h) {
          const dmg = 45 + 12 * h.level + 0.7 * h.ad;
          g.aoeDamage(h, h.x, h.y, 190, dmg, {});
          g.addEffect({ kind: 'ring', x: h.x, y: h.y, r: 190, ttl: 0.3, color: '#aed581', fill: true });
          return true;
        },
      },
      {
        key: 'W', name: '鉄壁の構え', cd: 12, mana: 45,
        desc: 'シールドを張り防御+20 (3.5秒)',
        ai: { mode: 'defense', range: 0 },
        cast(g, h) {
          const amount = 110 + 26 * h.level;
          h.shield = Math.max(h.shield, amount);
          h.shieldT = 3.5;
          h.buffs.push({ t: 3.5, stats: { armor: 20 } });
          g.addEffect({ kind: 'ring', x: h.x, y: h.y, r: 70, ttl: 0.5, color: '#e0e0e0' });
          return true;
        },
      },
      {
        key: 'E', name: 'チャージ', cd: 10, mana: 50,
        desc: '突進し、着地点周囲にダメージ+スロー',
        ai: { mode: 'gap', range: 450 },
        cast(g, h, tx, ty) {
          const d = norm(tx - h.x, ty - h.y);
          if (!d) return false;
          const dist = Math.min(450, d.len);
          const ex = clamp(h.x + d.x * dist, 30, CONFIG.WORLD - 30);
          const ey = clamp(h.y + d.y * dist, 30, CONFIG.WORLD - 30);
          const dmg = 60 + 12 * h.level + 0.5 * h.ad;
          h.dashState = {
            tx: ex, ty: ey, speed: 1100,
            onArrive() {
              g.aoeDamage(h, h.x, h.y, 170, dmg, { slowF: 0.65, slowT: 1.5 });
              g.addEffect({ kind: 'ring', x: h.x, y: h.y, r: 170, ttl: 0.35, color: '#8bc34a', fill: true });
            },
          };
          if (h === g.player) SFX.play('dash');
          return true;
        },
      },
      mkSelfBuff({
        key: 'R', name: '血の渇望', cd: 75, mana: 70, t: 6,
        desc: '攻撃力・移動速度・吸血を大幅上昇(6秒)',
        stats: { ad: 40, speed: 35, lifesteal: 0.18 }, color: '#8bc34a',
      }),
    ],
  },

  vex: {
    key: 'vex', name: 'ヴェックス', title: '疾風の狩人', color: '#4fc3f7', letter: 'V',
    desc: '長射程の通常攻撃で削るマークスマン。攻撃速度バフと回避ステップで距離を保ちながら戦う。',
    hp: 560, hpGrow: 86, mana: 300, manaGrow: 36,
    ad: 58, adGrow: 3.4, power: 0, powerGrow: 0,
    armor: 18, armorGrow: 3.0, range: 520, atkCd: 1.05, speed: 285, radius: 21,
    aiBuild: ['sword', 'dagger', 'sword', 'vamp', 'dagger', 'hp', 'sword'],
    abilities: [
      {
        key: 'Q', name: '貫通の矢', cd: 6, mana: 45,
        desc: '直線上の敵全てを貫くダメージ',
        ai: { mode: 'damage', range: 880 },
        cast(g, h, tx, ty) {
          const d = norm(tx - h.x, ty - h.y);
          if (!d) return false;
          const dmg = 70 + 16 * h.level + 0.8 * h.ad;
          g.shootLine({
            src: h, x: h.x, y: h.y, dx: d.x, dy: d.y,
            speed: 1200, range: 950, radius: 20, color: '#4fc3f7', pierce: true,
            onHitUnit(u) { g.dealDamage(h, u, dmg); },
          });
          return true;
        },
      },
      {
        key: 'W', name: '速射', cd: 12, mana: 40,
        desc: '攻撃速度+60%・移動速度+40 (4秒)',
        ai: { mode: 'buff', range: 0 },
        cast(g, h) {
          h.buffs.push({ t: 4, stats: { atkSpeed: 0.6, speed: 40 } });
          g.addEffect({ kind: 'ring', x: h.x, y: h.y, r: 60, ttl: 0.4, color: '#4fc3f7' });
          return true;
        },
      },
      {
        key: 'E', name: 'タンブル', cd: 8, mana: 35,
        desc: '短距離ステップし攻撃速度+30% (2秒)',
        ai: { mode: 'mobility', range: 300 },
        cast(g, h, tx, ty) {
          const d = norm(tx - h.x, ty - h.y);
          if (!d) return false;
          const dist = Math.min(300, d.len);
          h.dashState = {
            tx: clamp(h.x + d.x * dist, 30, CONFIG.WORLD - 30),
            ty: clamp(h.y + d.y * dist, 30, CONFIG.WORLD - 30),
            speed: 1000,
            onArrive() { h.buffs.push({ t: 2, stats: { atkSpeed: 0.3 } }); },
          };
          if (h === g.player) SFX.play('dash');
          return true;
        },
      },
      mkLine({
        key: 'R', name: 'ドラゴンアロー', cd: 65, mana: 90, range: 1300, speed: 1600, radius: 26,
        color: '#29b6f6', pierce: true, desc: '超長射程の貫通する一射。当たった全ての敵に大ダメージ',
        dmg: h => 130 + 26 * h.level + 1.1 * h.ad,
      }),
    ],
  },

  kestrel: {
    key: 'kestrel', name: 'ケストレル', title: '影渡りの暗殺者', color: '#c77dff', letter: 'K',
    desc: '死角から仕留めるアサシン。ステルスで接近し、瀕死の獲物には止めの一撃が突き刺さる。被弾には弱いので一撃離脱が命。',
    hp: 480, hpGrow: 70, mana: 260, manaGrow: 30,
    ad: 66, adGrow: 3.8, power: 0, powerGrow: 0,
    armor: 14, armorGrow: 2.4, range: 105, atkCd: 0.95, speed: 305, radius: 20,
    aiBuild: ['sword', 'dagger', 'sword', 'vamp', 'sword', 'boots', 'sword'],
    abilities: [
      {
        key: 'Q', name: '処刑の突き', cd: 5, mana: 30,
        desc: '前方に突きダメージ。残りHPが低い敵ほど追加ダメージ',
        ai: { mode: 'gap', range: 260 },
        cast(g, h, tx, ty) {
          const d = norm(tx - h.x, ty - h.y);
          if (!d) return false;
          const dist = Math.min(220, d.len);
          const ex = clamp(h.x + d.x * dist, 30, CONFIG.WORLD - 30);
          const ey = clamp(h.y + d.y * dist, 30, CONFIG.WORLD - 30);
          h.dashState = {
            tx: ex, ty: ey, speed: 1300,
            onArrive() {
              const foe = enemyOf(h.team);
              for (const u of g.units) {
                if (u.team !== foe || u.dead) continue;
                if (u.kind !== 'hero' && u.kind !== 'minion') continue;
                if (distXY(h.x, h.y, u.x, u.y) > 130 + u.radius) continue;
                const missing = 1 - u.hp / u.maxHp;
                const dmg = 40 + 10 * h.level + 0.7 * h.ad + missing * (40 + 6 * h.level);
                g.dealDamage(h, u, dmg);
              }
              g.addEffect({ kind: 'ring', x: h.x, y: h.y, r: 130, ttl: 0.3, color: '#c77dff' });
            },
          };
          if (h === g.player) SFX.play('dash');
          return true;
        },
      },
      {
        key: 'W', name: '影さすステップ', cd: 13, mana: 45,
        desc: 'ステルス化+移動速度上昇 (2.5秒・攻撃/被弾で解除)',
        ai: { mode: 'buff', range: 0 },
        cast(g, h) {
          h.stealth = true;
          h.stealthT = 2.5;
          h.buffs.push({ t: 2.5, stats: { speed: 60 } });
          g.addEffect({ kind: 'ring', x: h.x, y: h.y, r: 50, ttl: 0.4, color: '#c77dff' });
          return true;
        },
      },
      {
        key: 'E', name: '追い討ち', cd: 9, mana: 40,
        desc: '素早く突進し接触した敵にダメージ',
        ai: { mode: 'gap', range: 380 },
        cast(g, h, tx, ty) {
          const d = norm(tx - h.x, ty - h.y);
          if (!d) return false;
          const dist = Math.min(380, d.len);
          const ex = clamp(h.x + d.x * dist, 30, CONFIG.WORLD - 30);
          const ey = clamp(h.y + d.y * dist, 30, CONFIG.WORLD - 30);
          const dmg = 55 + 12 * h.level + 0.6 * h.ad;
          h.dashState = {
            tx: ex, ty: ey, speed: 1250,
            onArrive() {
              g.aoeDamage(h, h.x, h.y, 140, dmg, {});
              g.addEffect({ kind: 'ring', x: h.x, y: h.y, r: 140, ttl: 0.3, color: '#9c4dff', fill: true });
            },
          };
          if (h === g.player) SFX.play('dash');
          return true;
        },
      },
      mkExecuteDash({
        key: 'R', name: '死の一閃', cd: 80, mana: 90, range: 500, speed: 1500, radius: 130,
        color: '#8e24aa', desc: '一瞬で懐に入り込み大ダメージ。残りHPが低いほど大幅増加',
        baseDmg: h => 70 + 16 * h.level + 0.9 * h.ad, missingMult: h => 130 + 20 * h.level,
      }),
    ],
  },

  sera: {
    key: 'sera', name: 'セラ', title: '癒しの巫女', color: '#4dd0e1', letter: 'S',
    desc: '味方を癒し守るサポート。単体火力は低いが、回復・シールド・速度バフで戦況を支える。味方の近くで戦おう。',
    hp: 520, hpGrow: 78, mana: 380, manaGrow: 44,
    ad: 38, adGrow: 2.0, power: 10, powerGrow: 6,
    armor: 18, armorGrow: 2.8, range: 460, atkCd: 1.2, speed: 275, radius: 21,
    aiBuild: ['hp', 'staff', 'boots', 'armor', 'staff', 'hp', 'armor'],
    abilities: [
      {
        key: 'Q', name: '癒しの光', cd: 7, mana: 50,
        desc: '自分と周囲の味方のHPを回復',
        ai: { mode: 'heal', range: 260 },
        cast(g, h) {
          const heal = 60 + 14 * h.level + 0.5 * h.power;
          g.aoeHeal(h, h.x, h.y, 260, heal);
          g.addEffect({ kind: 'ring', x: h.x, y: h.y, r: 260, ttl: 0.4, color: '#8bffb0', fill: true });
          return true;
        },
      },
      {
        key: 'W', name: '守りの盾', cd: 12, mana: 55,
        desc: '自分と周囲の味方にシールドを付与',
        ai: { mode: 'defense', range: 0 },
        cast(g, h) {
          const amt = 90 + 20 * h.level;
          for (const ally of g.heroes) {
            if (ally.team !== h.team || ally.dead) continue;
            if (distU(ally, h) > 260) continue;
            ally.shield = Math.max(ally.shield, amt);
            ally.shieldT = 3.5;
          }
          g.addEffect({ kind: 'ring', x: h.x, y: h.y, r: 260, ttl: 0.5, color: '#e0e0e0' });
          return true;
        },
      },
      {
        key: 'E', name: '疾風の加護', cd: 11, mana: 45,
        desc: '自分と周囲の味方の移動速度を上昇',
        ai: { mode: 'buff', range: 0 },
        cast(g, h) {
          for (const ally of g.heroes) {
            if (ally.team !== h.team || ally.dead) continue;
            if (distU(ally, h) > 280) continue;
            ally.buffs.push({ t: 3, stats: { speed: 50 } });
          }
          g.addEffect({ kind: 'ring', x: h.x, y: h.y, r: 280, ttl: 0.4, color: '#4dd0e1' });
          return true;
        },
      },
      mkGlobalTeamHeal({
        key: 'R', name: 'アンコール', cd: 85, mana: 95, color: '#8bffb0',
        desc: '距離を問わず味方チーム全員のHPを大きく回復',
        heal: h => 130 + 22 * h.level + 0.8 * h.power,
      }),
    ],
  },

  grom: {
    key: 'grom', name: 'グロム', title: '不屈の突撃兵', color: '#a1887f', letter: 'G',
    desc: '突っ込んでスタンを撒く前衛タンク。硬さと足止めで味方に戦機を作る、集団戦のイニシエーター。',
    hp: 760, hpGrow: 112, mana: 250, manaGrow: 28,
    ad: 56, adGrow: 3.0, power: 0, powerGrow: 0,
    armor: 34, armorGrow: 4.2, range: 105, atkCd: 1.1, speed: 270, radius: 25,
    aiBuild: ['hp', 'armor', 'sword', 'hp', 'armor', 'vamp', 'armor'],
    abilities: [
      {
        key: 'Q', name: '大地割り', cd: 8, mana: 40,
        desc: '周囲の敵にダメージ+スタン(1秒)',
        ai: { mode: 'damage', range: 200 },
        cast(g, h) {
          const dmg = 55 + 13 * h.level + 0.6 * h.ad;
          g.aoeDamage(h, h.x, h.y, 210, dmg, { stunT: 1.0 });
          g.addEffect({ kind: 'ring', x: h.x, y: h.y, r: 210, ttl: 0.35, color: '#ffb74d', fill: true });
          return true;
        },
      },
      {
        key: 'W', name: '鉄の意志', cd: 14, mana: 45,
        desc: '自身を回復し防御力+24 (4秒)',
        ai: { mode: 'defense', range: 0 },
        cast(g, h) {
          h.heal(90 + 18 * h.level);
          h.buffs.push({ t: 4, stats: { armor: 24 } });
          g.addEffect({ kind: 'ring', x: h.x, y: h.y, r: 70, ttl: 0.5, color: '#e0e0e0' });
          return true;
        },
      },
      {
        key: 'E', name: '殺到', cd: 10, mana: 40,
        desc: '突進し、着地点周囲の敵にダメージ+スタン(0.8秒)',
        ai: { mode: 'gap', range: 380 },
        cast(g, h, tx, ty) {
          const d = norm(tx - h.x, ty - h.y);
          if (!d) return false;
          const dist = Math.min(380, d.len);
          const ex = clamp(h.x + d.x * dist, 30, CONFIG.WORLD - 30);
          const ey = clamp(h.y + d.y * dist, 30, CONFIG.WORLD - 30);
          const dmg = 55 + 12 * h.level + 0.5 * h.ad;
          h.dashState = {
            tx: ex, ty: ey, speed: 1050,
            onArrive() {
              g.aoeDamage(h, h.x, h.y, 160, dmg, { stunT: 0.8 });
              g.addEffect({ kind: 'ring', x: h.x, y: h.y, r: 160, ttl: 0.35, color: '#a1887f', fill: true });
            },
          };
          if (h === g.player) SFX.play('dash');
          return true;
        },
      },
      mkSelfNova({
        key: 'R', name: '大地震', cd: 85, mana: 90, radius: 290, color: '#ffb74d',
        desc: '広範囲の敵にダメージ+長時間スタン(1.6秒)',
        dmg: h => 90 + 18 * h.level + 0.7 * h.ad, opts: { stunT: 1.6 },
      }),
    ],
  },

  nyx: {
    key: 'nyx', name: 'ナイクス', title: 'ヴォイドの魔導士', color: '#673ab7', letter: 'N',
    desc: '虚空の力を操るメイジ。スロー付きの直線弾と設置型の大爆発で戦線を制圧する。',
    hp: 530, hpGrow: 80, mana: 410, manaGrow: 46,
    ad: 34, adGrow: 2.0, power: 16, powerGrow: 9,
    armor: 15, armorGrow: 2.8, range: 440, atkCd: 1.15, speed: 280, radius: 21,
    aiBuild: ['staff', 'hp', 'staff', 'armor', 'boots', 'staff', 'staff'],
    abilities: [
      mkLine({
        key: 'Q', name: 'ヴォイドボルト', cd: 5, mana: 40, range: 760, radius: 22, color: '#9575cd',
        desc: '直線状の敵にダメージ+スロー', opts: { slowF: 0.6, slowT: 1.3 },
        dmg: h => 65 + 15 * h.level + 0.7 * h.power,
      }),
      mkSelfShield({
        key: 'W', name: 'シャドウベール', cd: 12, mana: 50, t: 3, color: '#673ab7',
        desc: '自身にシールドを付与', amount: h => 100 + 22 * h.level,
      }),
      mkBlink({
        key: 'E', name: 'ワープステップ', cd: 13, mana: 45, range: 340, color: '#b39ddb',
        desc: 'マウス方向へ瞬間移動',
      }),
      mkGroundNova({
        key: 'R', name: 'ヴォイドノヴァ', cd: 72, mana: 95, range: 700, radius: 220, color: '#4a148c',
        desc: '指定地点に大爆発を起こし、範囲内の敵に大ダメージ+スロー',
        dmg: h => 135 + 28 * h.level + 1.0 * h.power, opts: { slowF: 0.5, slowT: 1.5 },
      }),
    ],
  },

  pyra: {
    key: 'pyra', name: 'パイラ', title: '紅蓮の魔導士', color: '#ff5722', letter: 'P',
    desc: '炎で全てを焼き尽くすメイジ。貫通する炎の槍とメテオで広範囲を制圧する。',
    hp: 525, hpGrow: 79, mana: 405, manaGrow: 45,
    ad: 34, adGrow: 2.0, power: 17, powerGrow: 9,
    armor: 15, armorGrow: 2.8, range: 430, atkCd: 1.15, speed: 280, radius: 21,
    aiBuild: ['staff', 'hp', 'staff', 'armor', 'boots', 'staff', 'staff'],
    abilities: [
      mkLine({
        key: 'Q', name: '火炎の槍', cd: 4.5, mana: 38, range: 700, radius: 24, color: '#ff7043',
        pierce: true, desc: '直線を貫く火炎の槍', dmg: h => 60 + 14 * h.level + 0.65 * h.power,
      }),
      mkSelfNova({
        key: 'W', name: '灼熱波', cd: 9, mana: 55, radius: 230, color: '#ffab40',
        desc: '周囲の敵にダメージ', dmg: h => 65 + 13 * h.level + 0.55 * h.power,
      }),
      mkBlink({
        key: 'E', name: '火炎ダッシュ', cd: 12, mana: 45, range: 320, color: '#ff8a65',
        desc: 'マウス方向へ瞬間移動',
      }),
      mkGroundNova({
        key: 'R', name: 'メテオ', cd: 75, mana: 100, range: 720, radius: 250, color: '#d84315',
        desc: '指定地点に隕石を落とし大ダメージ', dmg: h => 150 + 32 * h.level + 1.15 * h.power,
      }),
    ],
  },

  glacia: {
    key: 'glacia', name: 'グラシア', title: '氷結の魔導士', color: '#00acc1', letter: 'Gc',
    desc: '氷で敵を縛るメイジ。強力なスロー効果で追撃と逃走をコントロールする。',
    hp: 535, hpGrow: 80, mana: 400, manaGrow: 45,
    ad: 34, adGrow: 2.0, power: 15, powerGrow: 8,
    armor: 16, armorGrow: 2.9, range: 430, atkCd: 1.18, speed: 278, radius: 21,
    aiBuild: ['staff', 'hp', 'staff', 'armor', 'boots', 'staff', 'staff'],
    abilities: [
      mkLine({
        key: 'Q', name: 'フロストシャード', cd: 5, mana: 40, range: 720, radius: 22, color: '#4dd0e1',
        desc: '直線状の敵にダメージ+強力なスロー', opts: { slowF: 0.55, slowT: 1.6 },
        dmg: h => 62 + 14 * h.level + 0.6 * h.power,
      }),
      mkSelfNova({
        key: 'W', name: '凍える大地', cd: 10, mana: 55, radius: 240, color: '#80deea',
        desc: '周囲の敵にダメージ+スロー', opts: { slowF: 0.6, slowT: 1.8 },
        dmg: h => 55 + 11 * h.level + 0.5 * h.power,
      }),
      mkBlink({
        key: 'E', name: '氷結ステップ', cd: 13, mana: 45, range: 330, color: '#b2ebf2',
        desc: 'マウス方向へ瞬間移動',
      }),
      mkGroundNova({
        key: 'R', name: 'ブリザード', cd: 78, mana: 100, range: 680, radius: 260, color: '#0097a7',
        desc: '指定地点に猛吹雪、大ダメージ+長時間の重いスロー',
        dmg: h => 120 + 26 * h.level + 1.0 * h.power, opts: { slowF: 0.4, slowT: 2.2 },
      }),
    ],
  },

  volt: {
    key: 'volt', name: 'ヴォルト', title: '雷光の魔導士', color: '#ffca28', letter: 'Vo',
    desc: '雷を操るメイジ。連鎖する稲妻で密集した敵をまとめて焼く。',
    hp: 520, hpGrow: 78, mana: 415, manaGrow: 47,
    ad: 34, adGrow: 2.0, power: 16, powerGrow: 9,
    armor: 15, armorGrow: 2.8, range: 440, atkCd: 1.15, speed: 282, radius: 21,
    aiBuild: ['staff', 'hp', 'staff', 'armor', 'boots', 'staff', 'staff'],
    abilities: [
      mkChain({
        key: 'Q', name: '連鎖する稲妻', cd: 6, mana: 45, range: 650, jumps: 3, jumpRadius: 280,
        color: '#fff176', desc: 'クリック地点付近の敵から近くの敵へ稲妻が連鎖',
        dmg: h => 55 + 13 * h.level + 0.6 * h.power,
      }),
      mkSelfShield({
        key: 'W', name: '静電シールド', cd: 12, mana: 50, t: 3, color: '#ffd54f',
        desc: '自身にシールドを付与', amount: h => 95 + 20 * h.level,
      }),
      mkBlink({
        key: 'E', name: '雷光ステップ', cd: 12, mana: 45, range: 330, color: '#fff9c4',
        desc: 'マウス方向へ瞬間移動',
      }),
      mkGroundNova({
        key: 'R', name: '雷霆', cd: 75, mana: 95, range: 700, radius: 230, color: '#f9a825',
        desc: '指定地点に雷を落とし大ダメージ+スタン',
        dmg: h => 130 + 27 * h.level + 1.05 * h.power, opts: { stunT: 0.6 },
      }),
    ],
  },

  ragnar: {
    key: 'ragnar', name: 'ラグナー', title: '猛る戦斧の戦士', color: '#d84315', letter: 'R',
    desc: '怒りに任せて暴れるバーサーカー。吸血と攻撃力アップで長期戦を制す。',
    hp: 690, hpGrow: 104, mana: 260, manaGrow: 30,
    ad: 60, adGrow: 3.5, power: 0, powerGrow: 0,
    armor: 26, armorGrow: 3.6, range: 105, atkCd: 1.0, speed: 292, radius: 24,
    aiBuild: ['sword', 'hp', 'armor', 'sword', 'hp', 'vamp', 'sword'],
    abilities: [
      mkSelfNova({
        key: 'Q', name: '大薙ぎ払い', cd: 5, mana: 30, radius: 195, color: '#ff8a65',
        desc: '周囲の敵を薙ぎ払いダメージ', dmg: h => 48 + 12 * h.level + 0.7 * h.ad,
      }),
      mkSelfBuff({
        key: 'W', name: '闘気', cd: 13, mana: 40, t: 4, stats: { ad: 22, lifesteal: 0.12 },
        color: '#ff7043', desc: '攻撃力・吸血を上昇',
      }),
      mkDash({
        key: 'E', name: '踏み込み', cd: 10, mana: 45, range: 430, radius: 165, color: '#d84315',
        desc: '突進し、着地点周囲にダメージ+スロー', opts: { slowF: 0.65, slowT: 1.3 },
        dmg: h => 55 + 11 * h.level + 0.5 * h.ad,
      }),
      mkSelfBuff({
        key: 'R', name: '血の暴走', cd: 80, mana: 70, t: 6, stats: { ad: 45, speed: 35, lifesteal: 0.2 },
        color: '#bf360c', desc: '攻撃力・移動速度・吸血を大幅上昇(6秒)',
      }),
    ],
  },

  ashen: {
    key: 'ashen', name: 'アッシェン', title: '双刃の剣士', color: '#757575', letter: 'A',
    desc: '素早い連続攻撃で敵を切り刻む剣士。瀕死の敵への追撃が得意。',
    hp: 500, hpGrow: 74, mana: 270, manaGrow: 31,
    ad: 64, adGrow: 3.7, power: 0, powerGrow: 0,
    armor: 16, armorGrow: 2.6, range: 108, atkCd: 0.98, speed: 300, radius: 21,
    aiBuild: ['sword', 'dagger', 'sword', 'vamp', 'sword', 'boots', 'sword'],
    abilities: [
      mkSelfNova({
        key: 'Q', name: '疾風連斬', cd: 4.5, mana: 28, radius: 175, color: '#bdbdbd',
        desc: '周囲の敵に素早い連続斬撃', dmg: h => 42 + 10 * h.level + 0.65 * h.ad,
      }),
      mkSelfShield({
        key: 'W', name: '見切り', cd: 12, mana: 42, t: 2.5, color: '#e0e0e0',
        desc: '自身にシールドを付与', amount: h => 90 + 18 * h.level,
      }),
      mkDash({
        key: 'E', name: '影踏み', cd: 9, mana: 40, range: 360, radius: 140, color: '#9e9e9e',
        desc: '素早く突進し接触した敵にダメージ', dmg: h => 50 + 10 * h.level + 0.55 * h.ad,
      }),
      mkExecuteDash({
        key: 'R', name: '断罪の乱舞', cd: 78, mana: 85, range: 430, radius: 150, color: '#616161',
        desc: '突進し大ダメージ。残りHPが低い敵ほど大幅増加',
        baseDmg: h => 60 + 13 * h.level + 0.6 * h.ad, missingMult: h => 110 + 18 * h.level,
      }),
    ],
  },

  brue: {
    key: 'brue', name: 'ブルー', title: '不動の巨漢', color: '#5d4037', letter: 'Br',
    desc: '鈍重だが打たれ強い前衛。シールドとスタンで戦線を支える。',
    hp: 745, hpGrow: 110, mana: 240, manaGrow: 27,
    ad: 54, adGrow: 2.9, power: 0, powerGrow: 0,
    armor: 33, armorGrow: 4.1, range: 260, atkCd: 1.1, speed: 268, radius: 25,
    aiBuild: ['hp', 'armor', 'sword', 'hp', 'armor', 'vamp', 'armor'],
    abilities: [
      mkGroundNova({
        key: 'Q', name: '衝撃波', cd: 7, mana: 35, range: 260, radius: 175, color: '#8d6e63',
        desc: '指定方向に衝撃波、ダメージ+スロー', opts: { slowF: 0.6, slowT: 1.2 },
        dmg: h => 50 + 12 * h.level + 0.55 * h.ad,
      }),
      mkSelfShield({
        key: 'W', name: '不撓の構え', cd: 13, mana: 45, t: 3.5, color: '#a1887f',
        desc: 'シールドと防御力を付与', amount: h => 130 + 24 * h.level, extraStats: { armor: 18 },
      }),
      mkDash({
        key: 'E', name: '大突進', cd: 11, mana: 45, range: 420, radius: 175, color: '#6d4c41',
        desc: '突進し、着地点周囲にダメージ+短いスタン', opts: { stunT: 0.6 },
        dmg: h => 52 + 11 * h.level + 0.5 * h.ad,
      }),
      mkSelfNova({
        key: 'R', name: '大旋風', cd: 82, mana: 85, radius: 260, color: '#4e342e',
        desc: '広範囲の敵にダメージ+長時間スロー', opts: { slowF: 0.5, slowT: 2.0 },
        dmg: h => 85 + 17 * h.level + 0.65 * h.ad,
      }),
    ],
  },

  dax: {
    key: 'dax', name: 'ダックス', title: '街の喧嘩屋', color: '#f4511e', letter: 'D',
    desc: '素早い踏み込みと回復で粘り強く戦うブロウラー。',
    hp: 560, hpGrow: 84, mana: 250, manaGrow: 29,
    ad: 60, adGrow: 3.4, power: 0, powerGrow: 0,
    armor: 20, armorGrow: 3.0, range: 105, atkCd: 1.0, speed: 298, radius: 22,
    aiBuild: ['sword', 'hp', 'armor', 'sword', 'hp', 'vamp', 'sword'],
    abilities: [
      mkExecuteDash({
        key: 'Q', name: 'かます一撃', cd: 5, mana: 28, range: 230, radius: 130, color: '#ff7043',
        desc: '素早く踏み込み一撃。残りHPが低い敵ほど追加ダメージ',
        baseDmg: h => 38 + 9 * h.level + 0.6 * h.ad, missingMult: h => 35 + 5 * h.level,
      }),
      mkSelfBuff({
        key: 'W', name: 'セカンドウィンド', cd: 14, mana: 35, t: 0.1, stats: {},
        color: '#ffab91', heal: h => 100 + 22 * h.level, desc: '自身のHPを回復',
      }),
      mkSelfBuff({
        key: 'E', name: 'スプリント', cd: 11, mana: 30, t: 3, stats: { speed: 70 },
        color: '#ffccbc', desc: '移動速度を大きく上昇',
      }),
      mkDash({
        key: 'R', name: 'ノックアウト', cd: 75, mana: 80, range: 460, speed: 1300, radius: 170,
        color: '#bf360c', desc: '高速で突進し、着地点周囲に大ダメージ+スタン', opts: { stunT: 1.2 },
        dmg: h => 90 + 17 * h.level + 0.65 * h.ad,
      }),
    ],
  },

  aria: {
    key: 'aria', name: 'アリア', title: '狩猟のクロスボウ使い', color: '#ec407a', letter: 'Ar',
    desc: '貫通する矢と足止めの罠で敵を追い詰めるマークスマン。',
    hp: 545, hpGrow: 83, mana: 290, manaGrow: 35,
    ad: 56, adGrow: 3.3, power: 0, powerGrow: 0,
    armor: 17, armorGrow: 2.9, range: 500, atkCd: 1.05, speed: 283, radius: 20,
    aiBuild: ['sword', 'dagger', 'sword', 'vamp', 'dagger', 'hp', 'sword'],
    abilities: [
      mkLine({
        key: 'Q', name: '貫通ボルト', cd: 6, mana: 42, range: 820, speed: 1150, radius: 18,
        color: '#f06292', pierce: true, desc: '直線上の敵全てを貫くダメージ',
        dmg: h => 62 + 14 * h.level + 0.75 * h.ad,
      }),
      mkSelfNova({
        key: 'W', name: '撒き菱', cd: 11, mana: 35, radius: 200, color: '#f8bbd0',
        desc: '足元に撒き菱をまき、ダメージ+スロー', opts: { slowF: 0.55, slowT: 2.0 },
        dmg: h => 20 + 5 * h.level + 0.2 * h.ad,
      }),
      mkBlink({
        key: 'E', name: '回避ステップ', cd: 9, mana: 35, range: 280, color: '#f48fb1',
        desc: 'マウス方向へ短距離ステップ',
      }),
      mkGroundNova({
        key: 'R', name: '矢の雨', cd: 72, mana: 85, range: 780, radius: 220, color: '#ad1457',
        desc: '指定地点に矢の雨を降らせ大ダメージ', dmg: h => 95 + 20 * h.level + 0.85 * h.ad,
      }),
    ],
  },

  ronin: {
    key: 'ronin', name: 'ロニン', title: '弓術の達人', color: '#37474f', letter: 'Ro',
    desc: '長射程の矢で着実に敵を削るレンジャー。',
    hp: 540, hpGrow: 82, mana: 285, manaGrow: 34,
    ad: 57, adGrow: 3.3, power: 0, powerGrow: 0,
    armor: 17, armorGrow: 2.9, range: 510, atkCd: 1.03, speed: 284, radius: 20,
    aiBuild: ['sword', 'dagger', 'sword', 'vamp', 'dagger', 'hp', 'sword'],
    abilities: [
      mkLine({
        key: 'Q', name: '飛燕の矢', cd: 6, mana: 40, range: 680, speed: 1150, radius: 20,
        color: '#607d8b', desc: '直線上の敵にダメージ', dmg: h => 58 + 13 * h.level + 0.7 * h.ad,
      }),
      mkSelfBuff({
        key: 'W', name: '集中', cd: 12, mana: 35, t: 4, stats: { atkSpeed: 0.35 },
        color: '#78909c', desc: '攻撃速度を上昇',
      }),
      mkBlink({
        key: 'E', name: '後退ステップ', cd: 9, mana: 35, range: 280, color: '#90a4ae',
        desc: 'マウス方向へ短距離ステップ',
      }),
      mkLine({
        key: 'R', name: '龍矢', cd: 68, mana: 85, range: 1250, speed: 1550, radius: 24,
        color: '#263238', pierce: true, desc: '超長射程の貫通する一矢、大ダメージ',
        dmg: h => 110 + 22 * h.level + 0.95 * h.ad,
      }),
    ],
  },

  mira: {
    key: 'mira', name: 'ミラ', title: '孤高の狙撃手', color: '#7e57c2', letter: 'M',
    desc: '超長射程の一撃と隠密で敵を仕留めるスナイパー。',
    hp: 500, hpGrow: 76, mana: 300, manaGrow: 34,
    ad: 52, adGrow: 3.0, power: 0, powerGrow: 0,
    armor: 15, armorGrow: 2.6, range: 560, atkCd: 1.1, speed: 280, radius: 20,
    aiBuild: ['sword', 'dagger', 'sword', 'vamp', 'dagger', 'hp', 'sword'],
    abilities: [
      mkLine({
        key: 'Q', name: 'スナイプショット', cd: 7, mana: 45, range: 900, speed: 1400, radius: 16,
        color: '#9575cd', desc: '超長射程の一撃', dmg: h => 70 + 16 * h.level + 0.85 * h.ad,
      }),
      mkStealth({
        key: 'W', name: 'カモフラージュ', cd: 15, mana: 45, t: 2.2, speed: 45, color: '#b39ddb',
        desc: 'ステルス化+移動速度上昇(攻撃/被弾で解除)',
      }),
      mkBlink({
        key: 'E', name: 'ホップ', cd: 10, mana: 35, range: 260, color: '#d1c4e9',
        desc: 'マウス方向へ短距離ステップ',
      }),
      mkLine({
        key: 'R', name: 'キルショット', cd: 70, mana: 90, range: 1100, speed: 1700, radius: 20,
        color: '#4527a0', desc: '超遠距離から必中の超高威力ショット',
        dmg: h => 135 + 26 * h.level + 1.1 * h.ad,
      }),
    ],
  },

  zeke: {
    key: 'zeke', name: 'ジーク', title: '早撃ちのガンナー', color: '#ffa726', letter: 'Z',
    desc: '連射と攻撃速度バフで手数を稼ぐガンナー。',
    hp: 550, hpGrow: 83, mana: 295, manaGrow: 35,
    ad: 57, adGrow: 3.3, power: 0, powerGrow: 0,
    armor: 18, armorGrow: 3.0, range: 490, atkCd: 1.0, speed: 286, radius: 20,
    aiBuild: ['sword', 'dagger', 'sword', 'vamp', 'dagger', 'hp', 'sword'],
    abilities: [
      mkLine({
        key: 'Q', name: 'バーストファイア', cd: 5.5, mana: 38, range: 650, speed: 1200, radius: 18,
        color: '#ffb74d', desc: '素早い連射弾', dmg: h => 52 + 12 * h.level + 0.65 * h.ad,
      }),
      mkSelfBuff({
        key: 'W', name: 'アドレナリン', cd: 13, mana: 40, t: 4, stats: { atkSpeed: 0.4, lifesteal: 0.1 },
        color: '#ffcc80', desc: '攻撃速度・吸血を上昇',
      }),
      mkBlink({
        key: 'E', name: 'ローリング', cd: 9, mana: 35, range: 300, color: '#ffe0b2',
        desc: 'マウス方向へ短距離ステップ',
      }),
      mkGroundNova({
        key: 'R', name: '弾幕', cd: 70, mana: 85, range: 650, radius: 210, color: '#e65100',
        desc: '指定地点に弾幕を張り大ダメージ', dmg: h => 90 + 19 * h.level + 0.8 * h.ad,
      }),
    ],
  },

  ivy: {
    key: 'ivy', name: 'アイビー', title: '毒使いの暗殺者', color: '#43a047', letter: 'I',
    desc: '突進と処刑技で瀕死の敵を仕留めるアサシン。',
    hp: 470, hpGrow: 69, mana: 265, manaGrow: 29,
    ad: 64, adGrow: 3.7, power: 0, powerGrow: 0,
    armor: 13, armorGrow: 2.3, range: 105, atkCd: 0.96, speed: 303, radius: 20,
    aiBuild: ['sword', 'dagger', 'sword', 'vamp', 'sword', 'boots', 'sword'],
    abilities: [
      mkExecuteDash({
        key: 'Q', name: '毒牙の一撃', cd: 5, mana: 30, range: 240, radius: 130, color: '#66bb6a',
        desc: '突進し一撃。残りHPが低い敵ほど追加ダメージ',
        baseDmg: h => 40 + 10 * h.level + 0.65 * h.ad, missingMult: h => 35 + 5 * h.level,
      }),
      mkStealth({
        key: 'W', name: '擬態', cd: 13, mana: 40, t: 2.5, speed: 55, color: '#81c784',
        desc: 'ステルス化+移動速度上昇',
      }),
      mkDash({
        key: 'E', name: '茂み駆け', cd: 9, mana: 35, range: 380, radius: 140, color: '#2e7d32',
        desc: '素早く突進し接触した敵にダメージ', dmg: h => 52 + 11 * h.level + 0.55 * h.ad,
      }),
      mkExecuteDash({
        key: 'R', name: '猛毒の刃', cd: 78, mana: 85, range: 480, radius: 140, color: '#1b5e20',
        desc: '高速で懐に入り大ダメージ。残りHPが低いほど大幅増加',
        baseDmg: h => 65 + 15 * h.level + 0.85 * h.ad, missingMult: h => 120 + 18 * h.level,
      }),
    ],
  },

  kade: {
    key: 'kade', name: 'ケイド', title: '刃舞う暗殺者', color: '#5c6bc0', letter: 'Kd',
    desc: '鋭い踏み込みで一気に距離を詰めるアサシン。',
    hp: 475, hpGrow: 70, mana: 260, manaGrow: 29,
    ad: 65, adGrow: 3.7, power: 0, powerGrow: 0,
    armor: 13, armorGrow: 2.3, range: 105, atkCd: 0.95, speed: 304, radius: 20,
    aiBuild: ['sword', 'dagger', 'sword', 'vamp', 'sword', 'boots', 'sword'],
    abilities: [
      mkSelfNova({
        key: 'Q', name: '刃の乱舞', cd: 4.5, mana: 28, radius: 165, color: '#7986cb',
        desc: '周囲の敵に素早い斬撃', dmg: h => 40 + 9 * h.level + 0.6 * h.ad,
      }),
      mkSelfShield({
        key: 'W', name: '見切りの構え', cd: 11, mana: 40, t: 2.2, color: '#9fa8da',
        desc: '自身にシールドを付与', amount: h => 85 + 17 * h.level,
      }),
      mkDash({
        key: 'E', name: 'ブリンクストライク', cd: 9, mana: 38, range: 400, radius: 130, color: '#3949ab',
        desc: '瞬時に間合いを詰めダメージ', dmg: h => 48 + 10 * h.level + 0.55 * h.ad,
      }),
      mkExecuteDash({
        key: 'R', name: 'デスマーク', cd: 80, mana: 85, range: 460, radius: 140, color: '#283593',
        desc: '一気に距離を詰め大ダメージ。瀕死の敵には致命的',
        baseDmg: h => 55 + 13 * h.level + 0.7 * h.ad, missingMult: h => 140 + 20 * h.level,
      }),
    ],
  },

  sable: {
    key: 'sable', name: 'セイブル', title: '闇に潜む刺客', color: '#212121', letter: 'Sb',
    desc: 'ステルスと処刑技で不意を打つアサシン。',
    hp: 465, hpGrow: 68, mana: 255, manaGrow: 28,
    ad: 66, adGrow: 3.8, power: 0, powerGrow: 0,
    armor: 12, armorGrow: 2.2, range: 105, atkCd: 0.94, speed: 306, radius: 19,
    aiBuild: ['sword', 'dagger', 'sword', 'vamp', 'sword', 'boots', 'sword'],
    abilities: [
      mkDash({
        key: 'Q', name: '闇斬り', cd: 5, mana: 30, range: 250, radius: 135, color: '#616161',
        desc: '突進しダメージ', dmg: h => 45 + 10 * h.level + 0.6 * h.ad,
      }),
      mkStealth({
        key: 'W', name: '消失', cd: 14, mana: 42, t: 2.8, speed: 60, color: '#424242',
        desc: 'ステルス化+移動速度上昇',
      }),
      mkBlink({
        key: 'E', name: 'クイックステップ', cd: 8, mana: 32, range: 280, color: '#757575',
        desc: 'マウス方向へ短距離ステップ',
      }),
      mkExecuteDash({
        key: 'R', name: '闇夜の処刑', cd: 80, mana: 88, range: 500, radius: 140, color: '#000000',
        desc: '影から飛び出し大ダメージ。残りHPが低い敵ほど大幅増加',
        baseDmg: h => 68 + 15 * h.level + 0.8 * h.ad, missingMult: h => 130 + 18 * h.level,
      }),
    ],
  },

  talon: {
    key: 'talon', name: 'タロン', title: 'ステルス狩りの猟兵', color: '#c0ca33', letter: 'Ta',
    desc: 'ステルスを見破る索敵能力を持つハンター。隠密キャラの天敵。',
    hp: 490, hpGrow: 72, mana: 265, manaGrow: 30,
    ad: 63, adGrow: 3.6, power: 0, powerGrow: 0,
    armor: 15, armorGrow: 2.5, range: 105, atkCd: 0.97, speed: 300, radius: 21,
    aiBuild: ['sword', 'dagger', 'sword', 'vamp', 'sword', 'boots', 'sword'],
    abilities: [
      mkDash({
        key: 'Q', name: '飛びかかり', cd: 5, mana: 30, range: 260, radius: 135, color: '#d4e157',
        desc: '突進しダメージ', dmg: h => 48 + 11 * h.level + 0.6 * h.ad,
      }),
      mkReveal({
        key: 'W', name: '索敵の眼', cd: 20, mana: 40, t: 6, color: '#e6ee9c',
        desc: '一定時間、敵のステルスを看破する',
      }),
      mkSelfBuff({
        key: 'E', name: '追跡本能', cd: 11, mana: 30, t: 3.5, stats: { speed: 55 },
        color: '#f0f4c3', desc: '移動速度を上昇',
      }),
      mkExecuteDash({
        key: 'R', name: '仕留めの一撃', cd: 78, mana: 82, range: 460, radius: 140, color: '#827717',
        desc: '一気に間合いを詰め大ダメージ。瀕死の敵には致命的',
        baseDmg: h => 60 + 14 * h.level + 0.75 * h.ad, missingMult: h => 125 + 18 * h.level,
      }),
    ],
  },

  lyra: {
    key: 'lyra', name: 'リラ', title: '調べの吟遊詩人', color: '#ba68c8', letter: 'L',
    desc: '回復・シールド・速度バフで味方を支えるサポート。',
    hp: 510, hpGrow: 77, mana: 375, manaGrow: 43,
    ad: 36, adGrow: 1.9, power: 11, powerGrow: 6,
    armor: 17, armorGrow: 2.7, range: 450, atkCd: 1.18, speed: 276, radius: 21,
    aiBuild: ['hp', 'staff', 'boots', 'armor', 'staff', 'hp', 'armor'],
    abilities: [
      mkHeal({
        key: 'Q', name: '癒しの旋律', cd: 7, mana: 48, radius: 250, color: '#ce93d8',
        desc: '自分と周囲の味方のHPを回復', heal: h => 55 + 13 * h.level + 0.5 * h.power,
      }),
      mkTeamShield({
        key: 'W', name: '調和の盾', cd: 12, mana: 52, t: 3.5, radius: 260, color: '#e1bee7',
        desc: '自分と周囲の味方にシールドを付与', amount: h => 85 + 18 * h.level,
      }),
      mkTeamBuff({
        key: 'E', name: 'テンポ', cd: 11, mana: 42, t: 3, stats: { speed: 48 }, radius: 270,
        color: '#f3e5f5', desc: '自分と周囲の味方の移動速度を上昇',
      }),
      mkGlobalTeamHeal({
        key: 'R', name: 'アンコール・フィナーレ', cd: 88, mana: 95, color: '#8bffb0',
        desc: '距離を問わず味方チーム全員のHPを大きく回復',
        heal: h => 120 + 20 * h.level + 0.75 * h.power,
      }),
    ],
  },

  faye: {
    key: 'faye', name: 'フェイ', title: '森の守り手', color: '#81c784', letter: 'F',
    desc: '回復とシールドで味方を支える自然のサポート。',
    hp: 515, hpGrow: 78, mana: 370, manaGrow: 43,
    ad: 36, adGrow: 1.9, power: 10, powerGrow: 6,
    armor: 18, armorGrow: 2.8, range: 445, atkCd: 1.2, speed: 275, radius: 21,
    aiBuild: ['hp', 'staff', 'boots', 'armor', 'staff', 'hp', 'armor'],
    abilities: [
      mkLine({
        key: 'Q', name: '自然の鞭', cd: 6, mana: 42, range: 580, speed: 950, radius: 20,
        color: '#a5d6a7', desc: '直線状の敵にダメージ+スロー', opts: { slowF: 0.6, slowT: 1.4 },
        dmg: h => 45 + 11 * h.level + 0.5 * h.power,
      }),
      mkHeal({
        key: 'W', name: '芽吹き', cd: 9, mana: 48, radius: 240, color: '#c8e6c9',
        desc: '自分と周囲の味方のHPを回復', heal: h => 50 + 12 * h.level + 0.45 * h.power,
      }),
      mkBlink({
        key: 'E', name: 'つる渡り', cd: 11, mana: 40, range: 320, color: '#dcedc8',
        desc: 'マウス方向へ瞬間移動',
      }),
      mkGlobalTeamShield({
        key: 'R', name: '聖域', cd: 85, mana: 95, color: '#66bb6a', t: 4,
        desc: '距離を問わず味方チーム全員にシールドを付与', amount: h => 110 + 18 * h.level,
      }),
    ],
  },

  oz: {
    key: 'oz', name: 'オズ', title: '放浪の錬金術師', color: '#ffb300', letter: 'O',
    desc: '酸のダメージと回復で戦線を支えるサポート。',
    hp: 520, hpGrow: 78, mana: 365, manaGrow: 42,
    ad: 38, adGrow: 2.0, power: 11, powerGrow: 6,
    armor: 18, armorGrow: 2.8, range: 440, atkCd: 1.2, speed: 276, radius: 21,
    aiBuild: ['hp', 'staff', 'boots', 'armor', 'staff', 'hp', 'armor'],
    abilities: [
      mkGroundNova({
        key: 'Q', name: '酸の小瓶', cd: 7, mana: 42, range: 520, radius: 170, color: '#ffca28',
        desc: '指定地点にダメージ+スロー', opts: { slowF: 0.6, slowT: 1.5 },
        dmg: h => 50 + 11 * h.level + 0.45 * h.power,
      }),
      mkHeal({
        key: 'W', name: '万能薬', cd: 10, mana: 48, radius: 230, color: '#ffe082',
        desc: '自分と周囲の味方のHPを回復', heal: h => 52 + 12 * h.level + 0.4 * h.power,
      }),
      mkBlink({
        key: 'E', name: 'クイックステップ', cd: 10, mana: 38, range: 300, color: '#ffecb3',
        desc: 'マウス方向へ短距離ステップ',
      }),
      mkGlobalTeamHeal({
        key: 'R', name: '大いなる秘薬', cd: 86, mana: 95, color: '#8bffb0',
        desc: '距離を問わず味方チーム全員のHPを大きく回復',
        heal: h => 115 + 19 * h.level + 0.7 * h.power,
      }),
    ],
  },

  whit: {
    key: 'whit', name: 'ウィット', title: '時渡りの魔術師', color: '#26a69a', letter: 'W',
    desc: '速度バフとシールドで戦況をコントロールするサポート。',
    hp: 515, hpGrow: 77, mana: 372, manaGrow: 43,
    ad: 36, adGrow: 1.9, power: 11, powerGrow: 6,
    armor: 17, armorGrow: 2.7, range: 450, atkCd: 1.19, speed: 277, radius: 21,
    aiBuild: ['hp', 'staff', 'boots', 'armor', 'staff', 'hp', 'armor'],
    abilities: [
      mkLine({
        key: 'Q', name: '時の矢', cd: 6, mana: 40, range: 620, speed: 1000, radius: 20,
        color: '#4db6ac', desc: '直線状の敵にダメージ+スロー', opts: { slowF: 0.6, slowT: 1.4 },
        dmg: h => 48 + 11 * h.level + 0.5 * h.power,
      }),
      mkTeamBuff({
        key: 'W', name: 'ヘイスト', cd: 11, mana: 42, t: 3.5, stats: { speed: 50 }, radius: 270,
        color: '#80cbc4', desc: '自分と周囲の味方の移動速度を上昇',
      }),
      mkBlink({
        key: 'E', name: '時渡り', cd: 12, mana: 40, range: 320, color: '#b2dfdb',
        desc: 'マウス方向へ瞬間移動',
      }),
      mkGlobalTeamShield({
        key: 'R', name: '時の盾', cd: 85, mana: 92, color: '#00897b', t: 4,
        desc: '距離を問わず味方チーム全員にシールドを付与', amount: h => 105 + 17 * h.level,
      }),
    ],
  },

  boulder: {
    key: 'boulder', name: 'ボルダー', title: '岩の巨人', color: '#795548', letter: 'Bo',
    desc: '投石と突進スタンで戦線を支えるタンク。',
    hp: 750, hpGrow: 111, mana: 235, manaGrow: 27,
    ad: 53, adGrow: 2.9, power: 0, powerGrow: 0,
    armor: 33, armorGrow: 4.1, range: 400, atkCd: 1.12, speed: 267, radius: 25,
    aiBuild: ['hp', 'armor', 'sword', 'hp', 'armor', 'vamp', 'armor'],
    abilities: [
      mkLine({
        key: 'Q', name: '岩石投げ', cd: 6, mana: 35, range: 560, speed: 900, radius: 26,
        color: '#a1887f', desc: '直線状の敵にダメージ+スロー', opts: { slowF: 0.6, slowT: 1.3 },
        dmg: h => 48 + 11 * h.level + 0.55 * h.ad,
      }),
      mkSelfShield({
        key: 'W', name: '石の肌', cd: 13, mana: 42, t: 3.5, color: '#bcaaa4',
        desc: 'シールドと防御力を付与', amount: h => 120 + 22 * h.level, extraStats: { armor: 20 },
      }),
      mkDash({
        key: 'E', name: '地鳴り突進', cd: 11, mana: 45, range: 400, radius: 170, color: '#6d4c41',
        desc: '突進し、着地点周囲にダメージ+スタン', opts: { stunT: 0.7 },
        dmg: h => 50 + 11 * h.level + 0.5 * h.ad,
      }),
      mkSelfNova({
        key: 'R', name: '大地震', cd: 85, mana: 85, radius: 300, color: '#4e342e',
        desc: '広範囲の敵にダメージ+長時間スタン', opts: { stunT: 1.5 },
        dmg: h => 85 + 17 * h.level + 0.65 * h.ad,
      }),
    ],
  },

  frostbeard: {
    key: 'frostbeard', name: 'フロストビアード', title: '氷の重戦士', color: '#0288d1', letter: 'Fr',
    desc: '冷気と防御で敵の勢いを止めるタンク。',
    hp: 755, hpGrow: 111, mana: 240, manaGrow: 27,
    ad: 54, adGrow: 2.9, power: 0, powerGrow: 0,
    armor: 34, armorGrow: 4.2, range: 105, atkCd: 1.1, speed: 266, radius: 25,
    aiBuild: ['hp', 'armor', 'sword', 'hp', 'armor', 'vamp', 'armor'],
    abilities: [
      mkSelfNova({
        key: 'Q', name: '氷結スラム', cd: 7, mana: 38, radius: 190, color: '#4fc3f7',
        desc: '周囲の敵にダメージ+スロー', opts: { slowF: 0.6, slowT: 1.4 },
        dmg: h => 48 + 11 * h.level + 0.55 * h.ad,
      }),
      mkSelfShield({
        key: 'W', name: '氷の鎧', cd: 13, mana: 42, t: 3.5, color: '#81d4fa',
        desc: 'シールドと防御力を付与', amount: h => 115 + 21 * h.level, extraStats: { armor: 20 },
      }),
      mkDash({
        key: 'E', name: '氷河の突進', cd: 11, mana: 45, range: 400, radius: 170, color: '#0277bd',
        desc: '突進し、着地点周囲にダメージ+スタン', opts: { stunT: 0.7 },
        dmg: h => 50 + 11 * h.level + 0.5 * h.ad,
      }),
      mkGroundNova({
        key: 'R', name: '絶対零度', cd: 85, mana: 90, range: 650, radius: 260, color: '#01579b',
        desc: '指定地点に大ダメージ+強力な長時間スロー',
        dmg: h => 95 + 19 * h.level + 0.65 * h.ad, opts: { slowF: 0.35, slowT: 2.5 },
      }),
    ],
  },

  warden: {
    key: 'warden', name: 'ウォーデン', title: '不落の守護者', color: '#90a4ae', letter: 'Wa',
    desc: 'シールドとスタンで味方を守るガーディアン。',
    hp: 730, hpGrow: 108, mana: 245, manaGrow: 28,
    ad: 52, adGrow: 2.8, power: 0, powerGrow: 0,
    armor: 32, armorGrow: 4.0, range: 105, atkCd: 1.12, speed: 270, radius: 24,
    aiBuild: ['hp', 'armor', 'sword', 'hp', 'armor', 'vamp', 'armor'],
    abilities: [
      mkSelfNova({
        key: 'Q', name: 'シールドバッシュ', cd: 8, mana: 38, radius: 195, color: '#b0bec5',
        desc: '周囲の敵にダメージ+短いスタン', opts: { stunT: 0.6 },
        dmg: h => 50 + 12 * h.level + 0.55 * h.ad,
      }),
      mkTeamShield({
        key: 'W', name: '守護の加護', cd: 13, mana: 48, t: 3.5, radius: 260, color: '#cfd8dc',
        desc: '自分と周囲の味方にシールドを付与', amount: h => 95 + 19 * h.level,
      }),
      mkDash({
        key: 'E', name: '割り込み', cd: 10, mana: 42, range: 380, radius: 160, color: '#78909c',
        desc: '突進し、着地点周囲にダメージ+スタン', opts: { stunT: 0.6 },
        dmg: h => 48 + 10 * h.level + 0.5 * h.ad,
      }),
      mkTeamBuff({
        key: 'R', name: '不落の要塞', cd: 85, mana: 85, t: 6, stats: { armor: 35 }, radius: 320,
        color: '#546e7a', desc: '自分と周囲の味方の防御力を大幅上昇(6秒)',
      }),
    ],
  },

  rook: {
    key: 'rook', name: 'ルーク', title: '鋼鉄の擁壁', color: '#6d4c41', letter: 'Rk',
    desc: '回復と防御バフで前線に居座るジャガーノート。',
    hp: 770, hpGrow: 113, mana: 230, manaGrow: 26,
    ad: 55, adGrow: 3.0, power: 0, powerGrow: 0,
    armor: 35, armorGrow: 4.3, range: 105, atkCd: 1.08, speed: 269, radius: 26,
    aiBuild: ['hp', 'armor', 'sword', 'hp', 'armor', 'vamp', 'armor'],
    abilities: [
      mkSelfNova({
        key: 'Q', name: '大盾の一撃', cd: 7, mana: 35, radius: 190, color: '#8d6e63',
        desc: '周囲の敵にダメージ', dmg: h => 50 + 12 * h.level + 0.55 * h.ad,
      }),
      mkSelfBuff({
        key: 'W', name: '不屈の心', cd: 14, mana: 40, t: 4, stats: { armor: 26 },
        color: '#a1887f', heal: h => 95 + 19 * h.level, desc: '自身を回復し防御力を上昇',
      }),
      mkDash({
        key: 'E', name: '猛進', cd: 10, mana: 42, range: 400, radius: 165, color: '#5d4037',
        desc: '突進し、着地点周囲にダメージ+スタン', opts: { stunT: 0.6 },
        dmg: h => 50 + 10 * h.level + 0.5 * h.ad,
      }),
      mkSelfBuff({
        key: 'R', name: 'コロッサス化', cd: 85, mana: 80, t: 8, stats: { ad: 25, armor: 30, speed: 20 },
        color: '#3e2723', desc: '一定時間、防御力・攻撃力・移動速度が大幅上昇',
      }),
    ],
  },
};
const HERO_KEYS = Object.keys(HEROES);
