// ---- ボットAI ----
'use strict';

function aiThink(h, g) {
  if (h.dead || g.over) return;
  const foeTeam = enemyOf(h.team);
  const base = BASES[h.team];

  // 帰還中: 回復するまで戻る
  if (h.aiState === 'retreat') {
    if (h.hp >= h.maxHp * 0.85) {
      h.aiState = 'push';
      // レーン復帰: 一番近い頂点から再開
      h.laneWp = clamp(nearestVertex(h.lanePath, h.x, h.y), 1, h.lanePath.length - 1);
    } else {
      h.order = { type: 'move', x: base[0], y: base[1] };
      return;
    }
  }

  // HPが低い → 撤退開始
  if (h.hp < h.maxHp * 0.28) {
    h.aiState = 'retreat';
    h.order = { type: 'move', x: base[0], y: base[1] };
    aiCastAbilities(h, g, null, true);
    return;
  }

  // 最寄りの敵ヒーロー
  let foe = null, fd = Infinity;
  for (const e of g.heroes) {
    if (e.team !== foeTeam || e.dead) continue;
    const d = distU(h, e);
    if (d < fd) { fd = d; foe = e; }
  }

  // タワーダイブ回避: 敵タワー射程内で味方ミニオンが居ないなら下がる
  const dTower = g.towers.find(t =>
    t.team === foeTeam && !t.dead && distU(h, t) < t.range + 80);
  if (dTower) {
    let allyMinions = 0;
    for (const u of g.units) {
      if (u.kind === 'minion' && u.team === h.team && !u.dead && distU(u, dTower) < 350) allyMinions++;
    }
    if (allyMinions < 1 || h.hp < h.maxHp * 0.5) {
      const d = norm(h.x - dTower.x, h.y - dTower.y);
      if (d) {
        h.order = {
          type: 'move',
          x: clamp(h.x + d.x * 280, 30, CONFIG.WORLD - 30),
          y: clamp(h.y + d.y * 280, 30, CONFIG.WORLD - 30),
        };
        return;
      }
    }
  }

  // 敵ヒーローと交戦
  if (foe && fd < 620) {
    aiCastAbilities(h, g, foe, false);
    h.order = { type: 'attack', target: foe };
    return;
  }

  // ファーム: 近くの敵ミニオン
  let m = null, md = Infinity;
  for (const u of g.units) {
    if (u.kind !== 'minion' || u.team !== foeTeam || u.dead) continue;
    const d = distU(h, u);
    if (d < md) { md = d; m = u; }
  }
  if (m && md < 650) {
    h.order = { type: 'attack', target: m };
    return;
  }

  // 攻撃可能な敵構造物
  let st = null, sd = Infinity;
  for (const u of g.units) {
    if (u.team !== foeTeam || u.dead || u.invulnerable) continue;
    if (u.kind !== 'tower' && u.kind !== 'nexus') continue;
    const d = distU(h, u);
    if (d < sd) { sd = d; st = u; }
  }
  if (st && sd < 520) {
    // ミニオンの後ろ盾があるときだけ殴る
    let allyMinions = 0;
    for (const u of g.units) {
      if (u.kind === 'minion' && u.team === h.team && !u.dead && distU(u, st) < 400) allyMinions++;
    }
    if (allyMinions >= 1 || st.kind === 'nexus') {
      h.order = { type: 'attack', target: st };
      return;
    }
  }

  // 前線待機: 味方ミニオンの後ろ盾なしで敵タワーへ突っ込まない
  const nearTower = g.towers.find(t =>
    t.team === foeTeam && !t.dead && distU(h, t) < 640);
  if (nearTower) {
    let allyMinions = 0;
    for (const u of g.units) {
      if (u.kind === 'minion' && u.team === h.team && !u.dead && distU(u, nearTower) < 450) allyMinions++;
    }
    if (allyMinions === 0) { h.order = null; return; }
  }

  // レーンに沿って進軍
  const p = h.lanePath;
  if (h.laneWp < p.length) {
    const [tx, ty] = p[h.laneWp];
    if (distXY(h.x, h.y, tx, ty) < 90) h.laneWp++;
    if (h.laneWp < p.length) {
      const wp = p[h.laneWp];
      h.order = { type: 'move', x: wp[0], y: wp[1] };
    }
  }
}

function aiCastAbilities(h, g, foe, escaping) {
  h.def.abilities.forEach((ab, idx) => {
    if (h.cds[idx] > 0 || h.mana < ab.mana || !ab.ai) return;
    const mode = ab.ai.mode;

    if (escaping) {
      if (mode === 'mobility') {
        const base = BASES[h.team];
        g.castAbility(h, idx, base[0], base[1]);
      } else if (mode === 'defense') {
        g.castAbility(h, idx, h.x, h.y);
      }
      return;
    }

    if (!foe) return;
    const d = distU(h, foe);
    if (mode === 'damage' && d < ab.ai.range * 0.9 + h.radius) {
      g.castAbility(h, idx, foe.x, foe.y);
    } else if (mode === 'buff' && d < 540) {
      g.castAbility(h, idx, h.x, h.y);
    } else if (mode === 'defense' && h.hp < h.maxHp * 0.55 && d < 420) {
      g.castAbility(h, idx, h.x, h.y);
    } else if (mode === 'gap' && d > 180 && d < ab.ai.range && h.hp > h.maxHp * 0.55) {
      g.castAbility(h, idx, foe.x, foe.y);
    }
  });
}

// ビルド順に沿ってアイテム自動購入 (死亡中 or 泉に居る時に呼ばれる)
function aiTryBuy(h) {
  const build = h.def.aiBuild;
  for (let guard = 0; guard < 3; guard++) {
    const it = itemById(build[h.buildIdx % build.length]);
    if (!it || h.gold < it.cost) break;
    h.gold -= it.cost;
    h.items.push(it.id);
    h.buildIdx++;
  }
}
