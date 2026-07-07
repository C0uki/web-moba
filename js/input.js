// ---- 入力処理 ----
'use strict';

function setupInput(game, canvas) {
  const mouse = { sx: 0, sy: 0 };

  function mouseWorld() {
    return Renderer.screenToWorld(game, mouse.sx, mouse.sy);
  }

  function issueOrderAt(sx, sy) {
    const p = game.player;
    if (p.dead || game.over) return;

    // ミニマップ上なら移動指示
    const mm = Renderer.minimapToWorld(sx, sy);
    if (mm) {
      p.recallT = null;
      p.order = { type: 'move', x: mm.x, y: mm.y };
      return;
    }

    const w = Renderer.screenToWorld(game, sx, sy);
    // カーソル下の敵を探す
    let target = null, bd = Infinity;
    for (const u of game.units) {
      if (u.team !== enemyOf(p.team) || u.dead) continue;
      if (u.kind === 'hero' && u.stealth && !isRevealed(game, u)) continue;
      const d = distXY(w.x, w.y, u.x, u.y);
      if (d < u.radius + 26 && d < bd) { bd = d; target = u; }
    }
    p.recallT = null;
    if (target) {
      p.order = { type: 'attack', target };
      game.addEffect({ kind: 'click', x: target.x, y: target.y, ttl: 0.35, color: '#ff6b6b' });
    } else {
      p.order = { type: 'move', x: w.x, y: w.y };
      game.addEffect({ kind: 'click', x: w.x, y: w.y, ttl: 0.35, color: '#8bc34a' });
    }
  }

  canvas.addEventListener('contextmenu', e => e.preventDefault());

  canvas.addEventListener('mousedown', e => {
    SFX.init();
    if (e.button === 0 || e.button === 2) {
      issueOrderAt(e.clientX, e.clientY);
    }
  });

  window.addEventListener('mousemove', e => {
    mouse.sx = e.clientX;
    mouse.sy = e.clientY;
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const cam = game.camera;
    cam.zoom = clamp(cam.zoom * (e.deltaY > 0 ? 0.9 : 1.11), 0.55, 1.5);
  }, { passive: false });

  window.addEventListener('keydown', e => {
    const p = game.player;
    const key = e.key.toLowerCase();

    if (key === 'escape') {
      game.paused = !game.paused;
      return;
    }
    if (game.paused) return;

    switch (key) {
      case 'q': case 'w': case 'e': case 'r': {
        const idx = { q: 0, w: 1, e: 2, r: 3 }[key];
        const w = mouseWorld();
        game.castAbility(p, idx, w.x, w.y);
        break;
      }
      case 'a': {
        if (p.dead || game.over) break;
        const w = mouseWorld();
        p.recallT = null;
        p.order = { type: 'amove', x: w.x, y: w.y };
        game.addEffect({ kind: 'click', x: w.x, y: w.y, ttl: 0.35, color: '#ffd54f' });
        break;
      }
      case 's':
        if (p.dead) break;
        p.order = null;
        p.recallT = null;
        break;
      case 'b': {
        if (p.dead || game.over || p.recallT != null) break;
        if (distU(p, game.nexus[p.team]) <= CONFIG.FOUNTAIN_R) break; // 既に泉
        p.order = null;
        p.recallT = CONFIG.RECALL_TIME;
        SFX.play('recall');
        break;
      }
      case 'p':
        UI.toggleShop(game);
        break;
      case 'h':
        UI.toggleHelp();
        break;
      case 'm':
        SFX.muted = !SFX.muted;
        game.msg(SFX.muted ? 'ミュート ON' : 'ミュート OFF', 1.2);
        break;
    }
  });
}
