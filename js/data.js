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
    ],
  },
};
const HERO_KEYS = Object.keys(HEROES);
